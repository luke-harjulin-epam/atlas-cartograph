import test from "node:test";
import assert from "node:assert/strict";
import {
  ActivityCamera, activationCameraTarget, activationFocusNodes, activationSurfaceAngle, angleDelta, dampCameraValue, moveCameraLook,
} from "../.apm/extensions/cartograph/public/activity-camera.js";

const cam = () => ({ x: 25, y: -10, k: 1.2 });
const point = (id, sx, sy, extra = {}) => ({ id, title: id, sx, sy, ...extra });
const a = point("a", 100, 100);
const b = point("b", 700, 500);
const empty = () => ({ births: new Map(), ghosts: [], edges: new Map(), edgeGhosts: [] });

test("focus includes displayed reads, births, deletions and both changed relationship endpoints", () => {
  const c = point("c", 500, 300);
  const d = point("d", 250, 250);
  const ghost = point("deleted", 50, 50);
  const lifecycle = {
    births: new Map([["b", {}]]),
    ghosts: [{ node: ghost }],
    edges: new Map([["cd", { edge: { source: "c", target: "d" } }]]),
    edgeGhosts: [{ source: a, target: ghost }],
  };
  const active = { nodes: new Map([["a", 0], ["hidden", 1]]) };
  assert.deepEqual(new Set(activationFocusNodes([a, b, c, d], active, lifecycle).map(n => n.id)),
    new Set(["a", "b", "c", "d", "deleted"]));
  assert.deepEqual(activationFocusNodes([a], { nodes: new Map() }, empty()), []);
});

test("ghost endpoints follow physical files across remapping; queries and graph filtering remain authoritative", () => {
  const old = point("old", 0, 0, { path: "a.md", storeRoot: "/atlas" });
  const live = point("new", 500, 100, { path: "a.md", storeRoot: "/atlas", title: "Remapped" });
  const lifecycle = { ...empty(), edgeGhosts: [{ source: old, target: b }] };
  assert.deepEqual(activationFocusNodes([live, b], null, lifecycle), [live, b]);
  assert.deepEqual(activationFocusNodes([live, b], null, lifecycle, "remap"), [live]);
  assert.deepEqual(activationFocusNodes([], { nodes: new Map([["a", 1]]) }, empty()), []);
});

test("framing centers all endpoints with padding and zooms out for a wider set", () => {
  const camera = cam();
  const one = activationCameraTarget([a], camera, 800, 600);
  const wide = activationCameraTarget([a, b], camera, 800, 600);
  assert.equal(one.k, 20);
  assert.ok(wide.k < one.k);
  for (const p of [a, b]) {
    const x = 400 + wide.x + (p.sx - 400 - camera.x) / camera.k * wide.k;
    const y = 300 + wide.y + (p.sy - 300 - camera.y) / camera.k * wide.k;
    assert.ok(x >= 80 && x <= 720);
    assert.ok(y >= 90 && y <= 510);
  }
  const x = 400 + one.x + (a.sx - 400 - camera.x) / camera.k * one.k;
  const y = 300 + one.y + (a.sy - 300 - camera.y) / camera.k * one.k;
  assert.ok(Math.abs(x - 400) < 1e-9);
  assert.ok(Math.abs(y - 300) < 1e-9);
});

test("compact related activations occupy a readable area instead of stopping at three-times zoom", () => {
  const camera = { x: 0, y: 0, k: 1 };
  // Four nearby nodes on an Atlas surface, matching a roughly 24 by 18 pixel patch at home zoom.
  const patch = [point("a", 388, 291), point("b", 412, 291), point("c", 388, 309), point("d", 412, 309)];
  const target = activationCameraTarget(patch, camera, 800, 600);
  assert.equal(target.k, 20, "Use the existing manual zoom ceiling for a tight active patch");
  assert.equal(24 * target.k, 480);
  assert.equal(18 * target.k, 360);
  assert.equal(Math.abs(target.x), 0);
  assert.equal(Math.abs(target.y), 0);

  const wider = patch.map((node) => ({ ...node, sx: 400 + (node.sx - 400) * 4, sy: 300 + (node.sy - 300) * 4 }));
  const fitted = activationCameraTarget(wider, camera, 800, 600);
  assert.ok(fitted.k < target.k, "Fit every active endpoint rather than applying a minimum zoom");
  assert.equal(72 * fitted.k, 420, "Use 70% of the viewport height, preserving control/label padding");
});

test("close manual framing is retained when the active group can fit at that scale", () => {
  const camera = { x: 0, y: 0, k: 12 };
  const patch = [point("a", 280, 240), point("b", 520, 360)];
  const target = activationCameraTarget(patch, camera, 800, 600);
  assert.ok(target.k >= camera.k, "An already-close camera must not be pulled back to three-times zoom");
  assert.ok(target.k <= 20);
});

test("camera targets are invariant under the current pan/zoom; invalid and empty geometry is ignored", () => {
  const before = activationCameraTarget([a, b], cam(), 800, 600);
  const camera = { x: -250, y: 190, k: 2.5 };
  const moved = [a, b].map(n => ({
    ...n,
    sx: 400 + camera.x + (n.sx - 400 - cam().x) / cam().k * camera.k,
    sy: 300 + camera.y + (n.sy - 300 - cam().y) / cam().k * camera.k,
  }));
  const after = activationCameraTarget(moved, camera, 800, 600);
  for (const key of ["x", "y", "k"]) assert.ok(Math.abs(before[key] - after[key]) < 1e-9);
  assert.equal(activationCameraTarget([], cam(), 800, 600), null);
  assert.equal(activationCameraTarget([point("bad", NaN, Infinity)], cam(), 800, 600), null);
  assert.equal(activationCameraTarget([a], cam(), 0, 0), null);
});

test("auto framing defaults on and throttles geometry fitting under heavy activity", () => {
  const follower = new ActivityCamera();
  const first = follower.update([a], cam(), 800, 600, 0);
  assert.equal(first.k, 20);
  assert.equal(follower.update([a, b], cam(), 800, 600, 199), first);
  const next = follower.update([a, b], cam(), 800, 600, 200);
  assert.ok(next.k < first.k);
  assert.deepEqual(follower.saved, cam());
});

test("expiry holds briefly, restores the pre-activation view and releases camera control", () => {
  const follower = new ActivityCamera();
  const camera = cam();
  const target = follower.update([a], camera, 800, 600, 0);
  Object.assign(camera, target);
  assert.equal(follower.update([], camera, 800, 600, 999), target);
  const restoration = follower.update([], camera, 800, 600, 1000);
  assert.deepEqual(restoration, cam());
  Object.assign(camera, restoration);
  assert.equal(follower.update([], camera, 800, 600, 1200), null);
  assert.equal(follower.saved, null);
});

test("new activity during restoration keeps the original baseline", () => {
  const follower = new ActivityCamera();
  const camera = cam();
  Object.assign(camera, follower.update([a], camera, 800, 600, 0));
  follower.update([], camera, 800, 600, 1000);
  follower.update([b], camera, 800, 600, 1200);
  assert.deepEqual(follower.saved, cam());
  assert.notDeepEqual(follower.target, cam());
});

test("manual navigation pauses for five seconds and discards stale restoration", () => {
  const follower = new ActivityCamera();
  follower.update([a], cam(), 800, 600, 0);
  follower.manual(500);
  const manual = { x: -50, y: 40, k: 2 };
  assert.equal(follower.update([b], manual, 800, 600, 5499), null);
  assert.equal(follower.saved, null);
  assert.ok(follower.update([b], manual, 800, 600, 5500));
  assert.deepEqual(follower.saved, manual);
});

test("off, reduced motion, selection blocking and graph reset cancel automatic movement", () => {
  const follower = new ActivityCamera();
  const camera = cam();
  follower.update([a], camera, 800, 600, 0);
  follower.setEnabled(false);
  assert.equal(follower.update([a], camera, 800, 600, 200), null);
  assert.deepEqual(camera, cam());
  follower.setEnabled(true);
  assert.equal(follower.update([a], camera, 800, 600, 400, { reducedMotion: true }), null);
  assert.equal(follower.update([a], camera, 800, 600, 600, { blocked: true }), null);
  assert.ok(follower.update([a], camera, 800, 600, 800));
  follower.clear();
  assert.equal(follower.update([], camera, 800, 600, 2000), null);
});

const surface = (lat, lon, extra = {}) => ({ ...a, lat, lon, ...extra });
const frontDepth = (node, look) => {
  const x = Math.sin(node.lat) * Math.cos(node.lon), y = Math.cos(node.lat), z = Math.sin(node.lat) * Math.sin(node.lon);
  return y * Math.sin(look.pitch) + (x * Math.sin(look.yaw) + z * Math.cos(look.yaw)) * Math.cos(look.pitch);
};

test("surface angle faces the active patch toward the camera, not its rear or a tangent", () => {
  for (const [lat, lon] of [[Math.PI / 2, 0], [Math.PI / 2, Math.PI / 2], [0.7, 2], [2.3, -2.8]]) {
    const patch = [surface(lat - 0.05, lon - 0.05), surface(lat + 0.05, lon + 0.05)];
    const look = activationSurfaceAngle(patch, { yaw: 0.55, pitch: 0.72 });
    assert.ok(patch.every(n => frontDepth(n, look) < -0.99));
  }
});

test("dispersed/opposing activity holds orientation; poles and wraparound stay stable", () => {
  const view = { yaw: 7, pitch: 0.2 };
  assert.equal(activationSurfaceAngle([surface(Math.PI / 2, 0), surface(Math.PI / 2, Math.PI)], view), null);
  assert.equal(activationSurfaceAngle([a], view), null);
  assert.deepEqual(activationSurfaceAngle([surface(0, 2)], view), { yaw: 7, pitch: -1.2 });
  const nearSeam = { yaw: Math.PI - 0.01, pitch: 0 };
  const look = activationSurfaceAngle([surface(Math.PI / 2, Math.PI / 2 - 0.01)], nearSeam);
  assert.ok(Math.abs(look.yaw - nearSeam.yaw) < 0.03);
  assert.ok(Math.abs(angleDelta(-Math.PI + 0.01, Math.PI - 0.01) - 0.02) < 1e-9);
});

test("surface deadband resists small changes and holds its chosen side under diffuse load", () => {
  const follower = new ActivityCamera();
  const camera = { ...cam(), yaw: 0, pitch: 0 };
  const first = follower.update([surface(Math.PI / 2, 0)], camera, 800, 600, 0);
  const jitter = follower.update([surface(Math.PI / 2, 0.02)], camera, 800, 600, 200);
  assert.equal(first.yaw, jitter.yaw);
  const diffuse = follower.update([surface(Math.PI / 2, 0), surface(Math.PI / 2, Math.PI)], camera, 800, 600, 400);
  assert.equal(first.yaw, diffuse.yaw);
});

test("manual orbit preserves automatic framing and overrides only angle for five seconds", () => {
  const follower = new ActivityCamera();
  const camera = { ...cam(), yaw: 0, pitch: 0 };
  const targets = [surface(Math.PI / 2, 0)];
  follower.update(targets, camera, 800, 600, 0);
  camera.yaw = 1;
  camera.pitch = 0.3;
  follower.orbit(200, camera);
  const target = follower.update(targets, camera, 800, 600, 400);
  assert.equal(target.k, 20);
  assert.equal(target.yaw, 1);
  assert.deepEqual(follower.saved, { ...cam(), yaw: 1, pitch: 0.3 });
  follower.move(camera, target, 0.02, { now: 400 });
  assert.ok(camera.k > cam().k);
  assert.equal(camera.yaw, 1);
  assert.equal(follower.update(targets, camera, 800, 600, 5400, { orbiting: true }).yaw, 1);
  assert.notEqual(follower.update(targets, camera, 800, 600, 5600).yaw, 1);
});

test("idle restoration preserves the user's orbit rather than snapping back to the old angle", () => {
  const follower = new ActivityCamera();
  const camera = { ...cam(), yaw: 0, pitch: 0 };
  const targets = [surface(Math.PI / 2, 0)];
  follower.update(targets, camera, 800, 600, 0);
  camera.yaw = 1;
  camera.pitch = -0.2;
  follower.orbit(200, camera);
  follower.update(targets, camera, 800, 600, 400);
  camera.k = 3;
  assert.deepEqual(follower.update([], camera, 800, 600, 1400), { ...cam(), yaw: 1, pitch: -0.2 });
});

test("automatic orbit restores its initial orientation when no user orbit intervened", () => {
  const follower = new ActivityCamera();
  const camera = { ...cam(), yaw: 0.5, pitch: 0.4 };
  follower.update([surface(Math.PI / 2, 0)], camera, 800, 600, 0);
  camera.yaw = -Math.PI / 2;
  const restored = follower.update([], camera, 800, 600, 1000);
  assert.equal(restored.yaw, 0.5);
  assert.equal(restored.pitch, 0.4);
  assert.ok(follower.saved, "Matching pan/zoom alone must not terminate orientation restoration");
});

test("critical damping starts gently, settles without overshoot and is frame-rate independent", () => {
  const step = dampCameraValue(0, 100, 0, 0.55, 1 / 60);
  assert.ok(step.value > 0 && step.value < 1);
  const simulate = (fps) => {
    let state = { value: 0, velocity: 0 };
    for (let i = 0; i < fps * 2; i++) {
      const next = dampCameraValue(state.value, 100, state.velocity, 0.55, 1 / fps);
      assert.ok(next.value >= state.value && next.value <= 100);
      state = next;
    }
    return state.value;
  };
  assert.ok(simulate(60) > 99);
  assert.ok(Math.abs(simulate(30) - simulate(120)) < 1e-8);
  assert.deepEqual(dampCameraValue(4, 100, 3, 0.55, 0), { value: 4, velocity: 3 });
});

test("pan/zoom/orbit motion is speed-limited and does not reset velocity on repeated observations", () => {
  const follower = new ActivityCamera();
  const camera = { ...cam(), yaw: Math.PI - 0.01, pitch: 0 };
  const target = { x: 10000, y: -10000, k: 3, yaw: -Math.PI + 0.01, pitch: 1 };
  let last = { ...camera };
  for (let i = 0; i < 180; i++) {
    follower.move(camera, target, 1 / 60, { now: i * 1000 / 60 });
    assert.ok(Math.abs(camera.x - last.x) * 60 <= 1200);
    assert.ok(Math.abs(Math.log(camera.k / last.k)) * 60 <= 1.5);
    assert.ok(Math.abs(angleDelta(camera.yaw, last.yaw)) * 60 <= 1.5);
    last = { ...camera };
  }
  assert.ok(Math.abs(angleDelta(target.yaw, camera.yaw)) < 0.001);
  assert.ok(camera.x < target.x, "A far target must not teleport into view");
});

test("zoom-in waits for sustained shrinkage but zoom-out immediately accepts a wider set", () => {
  const follower = new ActivityCamera();
  const camera = cam();
  const wide = follower.update([a, b], camera, 800, 600, 0);
  assert.equal(follower.update([a], camera, 800, 600, 200).k, wide.k);
  assert.equal(follower.update([a], camera, 800, 600, 600).k, wide.k);
  assert.equal(follower.update([a], camera, 800, 600, 800).k, 20);
  assert.equal(follower.update([a, b], camera, 800, 600, 1000).k, wide.k);
});

test("a lone distant activation reaches close zoom and centered framing within two seconds", () => {
  for (const fps of [30, 60, 120]) {
    const follower = new ActivityCamera();
    const camera = { x: 0, y: 0, k: 0.22, yaw: 0, pitch: 0 };
    let previous = { ...camera };
    for (let frame = 0; frame < fps * 2; frame++) {
      const now = frame * 1000 / fps;
      const node = point("distant", 400 + camera.x + 500 * camera.k, 300 + camera.y - 350 * camera.k);
      const target = follower.update([node], camera, 800, 600, now);
      follower.move(camera, target, 1 / fps, { now });
      assert.ok(camera.k >= previous.k && camera.k <= 20, "Zoom must not overshoot");
      assert.ok(Math.log(camera.k / previous.k) * fps <= 4.5, "Close-in zoom remains speed limited");
      assert.equal(camera.yaw, previous.yaw, "Zoom acceleration must not introduce orbit motion");
      previous = { ...camera };
    }
    assert.ok(camera.k > 19, `At ${fps} fps, reach at least 95% of close zoom in two seconds`);
    assert.ok(Math.hypot(camera.x + 500 * camera.k, camera.y - 350 * camera.k) < 80,
      "The accelerated zoom must bring the node into view, not leave translation behind");
  }
});

test("multi-node zoom-in, singleton zoom-out and idle restoration retain normal timing", () => {
  for (const mode of ["multiple", "out", "restore"]) {
    const follower = new ActivityCamera();
    const camera = { ...cam(), yaw: 0, pitch: 0 };
    const target = follower.update(mode === "multiple" ? [a, { ...a, id: "b" }] : [a],
      camera, 800, 600, 0);
    if (mode === "out") camera.k = 25;
    if (mode === "restore") {
      camera.k = 0.22;
      follower.update([], camera, 800, 600, 1000);
    }
    const goal = mode === "restore" ? follower.saved : target;
    const expected = dampCameraValue(Math.log(camera.k), Math.log(goal.k), 0, 0.65, 1 / 60, 1.5);
    follower.move(camera, goal, 1 / 60, { now: 1000 });
    assert.equal(camera.k, Math.exp(expected.value), mode);
  }
});

test("zoom-out restoration keeps the active Atlas in view throughout the return flight", () => {
  for (const fps of [30, 60, 120]) {
    const follower = new ActivityCamera();
    const camera = { x: 0, y: 0, k: 1 };
    const world = { x: 200, y: -150 };
    const node = point("one", 400 + world.x, 300 + world.y);
    const close = follower.update([node], camera, 800, 600, 0);
    Object.assign(camera, close);
    const from = { ...camera };
    for (let frame = 0; frame <= fps * 6; frame++) {
      const now = 1000 + frame * 1000 / fps;
      const target = follower.update([], camera, 800, 600, now);
      if (target) follower.move(camera, target, 1 / fps, { now });
      const x = 400 + camera.x + world.x * camera.k;
      const y = 300 + camera.y + world.y * camera.k;
      assert.ok(x >= 400 - 1e-6 && x <= 600 + 1e-6, `Lost horizontal focus: ${x}`);
      assert.ok(y >= 150 - 1e-6 && y <= 300 + 1e-6, `Lost vertical focus: ${y}`);
      const progress = (camera.k - from.k) / (1 - from.k);
      assert.ok(Math.abs(camera.x - from.x * (1 - progress)) < 1e-6);
    }
    assert.deepEqual(camera, { x: 0, y: 0, k: 1 });
    assert.equal(follower.restoration, null);
  }
});

test("new activity and manual navigation discard a stale restoration trajectory", () => {
  const follower = new ActivityCamera();
  const camera = cam();
  Object.assign(camera, follower.update([a], camera, 800, 600, 0));
  follower.update([], camera, 800, 600, 1000);
  assert.ok(follower.restoration);
  follower.update([b], camera, 800, 600, 1200);
  assert.equal(follower.restoration, null);
  follower.update([], camera, 800, 600, 2200);
  follower.manual(2300);
  assert.equal(follower.restoration, null);
  assert.equal(follower.saved, null);
});

test("navigation takes the shortest speed-limited arc even after many manual revolutions", () => {
  for (const fps of [30, 60, 120]) {
    const camera = { yaw: Math.PI * 9 - 0.01, pitch: -0.4 };
    const target = { yaw: -Math.PI + 0.01, pitch: 0.5 };
    const velocity = { yaw: 0, pitch: 0 };
    const initialYaw = camera.yaw;
    for (let i = 0; i < fps * 4; i++) {
      const previous = { ...camera };
      moveCameraLook(camera, target, velocity, 1 / fps);
      assert.ok(Math.abs(camera.yaw - previous.yaw) * fps <= 1.5);
      assert.ok(Math.abs(camera.pitch - previous.pitch) * fps <= 1.5);
      assert.ok(Math.abs(camera.yaw - initialYaw) <= 0.021, "Never unwind accumulated full revolutions");
    }
    assert.ok(Math.abs(angleDelta(target.yaw, camera.yaw)) < 0.002);
    assert.ok(Math.abs(target.pitch - camera.pitch) < 0.002);
    moveCameraLook(camera, { yaw: 0, pitch: 0 }, velocity, 0, true);
    assert.ok(Math.abs(angleDelta(camera.yaw, 0)) < 1e-10);
    assert.deepEqual(velocity, { yaw: 0, pitch: 0 });
    moveCameraLook(camera, { yaw: camera.yaw, pitch: Math.PI }, velocity, 0, true);
    assert.equal(camera.pitch, 1.2, "Polar navigation cannot request an unreachable pitch");
  }
});
