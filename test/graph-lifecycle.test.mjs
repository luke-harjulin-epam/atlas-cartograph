import test from "node:test";
import assert from "node:assert/strict";
import { GraphLifecycle, GRAPH_LIFECYCLE_DURATION_MS, lifecyclePoints, lifecycleNodeOpacity, lifecycleEdgeOpacity, lifecycleEdgeGlows } from "../.apm/extensions/cartograph/public/graph-lifecycle.js";
import { ActivityPlayback, ACTIVITY_SPACING_MS } from "../.apm/extensions/cartograph/public/activity-playback.js";
import { GRAPH_WATCH_HELP, graphWatchStatus, mountGraphWatchControls } from "../.apm/extensions/cartograph/public/graph-watch-controls.js";
import { GraphGL } from "../.apm/extensions/cartograph/public/graph-gl.js";

const start = 1800000000000;
const nodes = ["a", "b", "c"].map((id, i) => ({
  id, path: `${id}.md`, storeRoot: "/atlas", title: id, kind: "work",
  sx: 100 + i * 100, sy: 200, r: 3, depth: 1,
}));
const [a, b, c] = nodes;
const delta = (revision, created = [], deleted = [], origin = "filesystem", occurredAt = start) => ({
  revision, origin, occurredAt, durationMs: GRAPH_LIFECYCLE_DURATION_MS, created, deleted,
});
function fixture(initial = [a, b]) {
  let now = start;
  const model = new GraphLifecycle({ now: () => now });
  model.setGraph(initial, delta(0, [], [], "mount"));
  return { model, clock: (value) => { now = value; } };
}

test("bootstrap and mount never animate all nodes, even with recent retained deltas", () => {
  const model = new GraphLifecycle({ now: () => start });
  model.setGraph(nodes, delta(3, nodes, [a]));
  assert.equal(model.frame().births.size, 0);
  assert.equal(model.frame().ghosts.length, 0);
  model.setGraph([a], delta(4, [a], [b, c], "mount"), nodes);
  assert.equal(model.frame().births.size, 0);
  assert.equal(model.frame().ghosts.length, 0);
});

test("real deltas capture old positions separately from the interactive graph", () => {
  const { model } = fixture();
  const old = { ...a, sx: 412, sy: 71, lon: 2, lat: 1, shell: 0.6 };
  model.setGraph([b, c], delta(1, [c], [a]), [old, b]);
  const frame = model.frame();
  assert.deepEqual([...frame.births.keys()], ["c"]);
  assert.equal(frame.ghosts.length, 1);
  assert.deepEqual(frame.ghosts[0].node, old);
  assert.notEqual(frame.ghosts[0].node, old);
  old.sx = 900;
  assert.equal(frame.ghosts[0].node.sx, 412);
  assert.deepEqual(frame.births.get("c").rgb, [0.25, 1, 0.42]);
  assert.deepEqual(frame.ghosts[0].style.rgb, [1, 0.24, 0.3]);
  assert.equal([b, c].some((node) => node.id === "a"), false);
});

test("birth and dissolve lifetimes use wall time, not rendering frames or read duration", () => {
  const { model, clock } = fixture();
  model.setGraph([b, c], delta(1, [c], [a]), [a, b]);
  clock(start + 3499);
  assert.equal(model.frame().births.size, 1);
  assert.equal(model.frame().ghosts.length, 1);
  clock(start + 3500);
  assert.equal(model.frame().births.size, 1);
  assert.equal(model.frame().ghosts.length, 0);
  clock(start + 9999);
  assert.equal(model.frame().births.size, 1);
  clock(start + 10000);
  assert.deepEqual(model.frame(), { births: new Map(), ghosts: [], edges: new Map(), edgeGhosts: [] });
  assert.equal(model.births.size, 0);
  assert.equal(model.ghosts.size, 0);
});

test("heartbeats, duplicate or older revisions, and repeated edits never replay or extend effects", () => {
  const { model, clock } = fixture();
  const first = delta(1, [c], [a]);
  model.setGraph([b, c], first, [a, b]);
  clock(start + 1000);
  model.setGraph([b, c], first, [b, c]);
  model.setGraph([b, { ...c, title: "edited" }], delta(2), [b, c]);
  model.setGraph([b, c], delta(3), [b, c]);
  model.setGraph([b, c], delta(1, [c], [a], "filesystem", start + 1000), [a, b]);
  assert.equal(model.revision, 3);
  clock(start + 10000);
  assert.deepEqual(model.frame(), { births: new Map(), ghosts: [], edges: new Map(), edgeGhosts: [] });
  model.setGraph([b, c], first, [a, b]);
  assert.equal(model.frame().births.size, 0);
});

test("metadata edits and visible graph changes without explicit deltas have no lifecycle", () => {
  const { model } = fixture();
  model.setGraph([a], delta(1), [a, b]);
  model.setGraph([a, { ...b, title: "renamed", kind: "decision" }], delta(2), [a]);
  model.setGraph(nodes, undefined, [a, b]);
  assert.deepEqual(model.frame(), { births: new Map(), ghosts: [], edges: new Map(), edgeGhosts: [] });
});

test("hidden or already-present creations and hidden deletions are not animated later", () => {
  const { model } = fixture([b]);
  model.setGraph([b], delta(1, [b, c], [a]), [b]);
  assert.deepEqual(model.frame(), { births: new Map(), ghosts: [], edges: new Map(), edgeGhosts: [] });
  model.setGraph([b, c], delta(1, [b, c], [a]), [b]);
  assert.equal(model.frame().births.size, 0);
});

test("layer filtering prunes ghosts and births without mistaking filters for deletes", () => {
  const { model } = fixture();
  const changes = delta(1, [c], [a]);
  model.setGraph([b, c], changes, [a, b]);
  model.setGraph([b], changes, [b, c], (node) => node.id === "b");
  assert.deepEqual(model.frame(), { births: new Map(), ghosts: [], edges: new Map(), edgeGhosts: [] });
  model.setGraph(nodes, changes, [b]);
  assert.deepEqual(model.frame(), { births: new Map(), ghosts: [], edges: new Map(), edgeGhosts: [] });
});

test("deleting the last visible file retains its ghost until expiry, not heartbeat", () => {
  const { model, clock } = fixture([a]);
  const changes = delta(1, [], [a]);
  model.setGraph([], changes, [a]);
  model.setGraph([], changes, []);
  assert.equal(model.frame().ghosts.length, 1);
  clock(start + 3500);
  assert.equal(model.frame().ghosts.length, 0);
});

test("mount/drop cancels effects even if the graph is unchanged, with no replay on reopen", () => {
  for (const graph of [[], [b, c]]) {
    const { model } = fixture();
    model.setGraph([b, c], delta(1, [c], [a]), [a, b]);
    model.setGraph(graph, delta(2, [], [], "mount"), [b, c]);
    assert.deepEqual(model.frame(), { births: new Map(), ghosts: [], edges: new Map(), edgeGhosts: [] });
    model.setGraph(nodes, delta(2, [], [], "mount"), graph);
    assert.deepEqual(model.frame(), { births: new Map(), ghosts: [], edges: new Map(), edgeGhosts: [] });
  }
  const { model } = fixture([a]);
  model.setGraph([], delta(1, [], [a]), [a]);
  model.setGraph([], undefined);
  assert.equal(model.frame().ghosts.length, 0);
});

test("recreating a deleted file cancels its ghost rather than layering a red duplicate", () => {
  const { model, clock } = fixture();
  model.setGraph([b], delta(1, [], [a]), [a, b]);
  clock(start + 100);
  model.setGraph([a, b], delta(2, [a], [], "filesystem", start + 100), [b]);
  assert.equal(model.frame().ghosts.length, 0);
  assert.deepEqual([...model.frame().births.keys()], ["a"]);
});

test("explicit filesystem deltas distinguish file identities even if an ID is reused", () => {
  const { model } = fixture();
  const replacement = { ...a, path: "replacement.md", sx: 700 };
  const changes = delta(1, [replacement], [a]);
  model.setGraph([replacement, b], changes, [a, b]);
  model.setGraph([replacement, b], changes, [replacement, b]);
  assert.equal(model.frame().births.size, 1);
  assert.equal(model.frame().ghosts.length, 1);
  assert.equal(model.frame().ghosts[0].node.path, a.path);
  assert.equal(model.frame().ghosts[0].node.sx, a.sx);
});

test("unrelated edit-only revisions preserve effects across graph ID renumbering", () => {
  const { model, clock } = fixture();
  model.setGraph([b, c], delta(1, [c], [a]), [a, b]);
  const renamed = [b, c].map((node) => ({ ...node, id: `/atlas::${node.id}` }));
  clock(start + 1000);
  model.setGraph(renamed, delta(2), [b, c]);
  assert.deepEqual([...model.frame().births.keys()], [renamed[1].id]);
  assert.equal(model.frame().ghosts.length, 1);
  assert.equal(model.frame().ghosts[0].node.path, a.path);
  clock(start + 3499);
  model.setGraph(renamed, delta(3), renamed);
  assert.equal(model.frame().births.size, 1);
  assert.equal(model.frame().ghosts.length, 1);
  clock(start + 10000);
  assert.deepEqual(model.frame(), { births: new Map(), ghosts: [], edges: new Map(), edgeGhosts: [] });
});

test("delta IDs may differ from old or visible IDs without inventing new file identities", () => {
  const { model } = fixture();
  const visibleC = { ...c, id: "new-id-c" };
  model.setGraph([b, visibleC], delta(1, [c], [{ ...a, id: "old-id-a" }]), [a, b]);
  assert.deepEqual([...model.frame().births.keys()], ["new-id-c"]);
  assert.equal(model.frame().ghosts[0].node.id, a.id);
  assert.equal(model.frame().ghosts[0].node.sx, a.sx);
});

test("stale, future and invalid event times are consumed without replay", () => {
  for (const time of [start - 10000, start + 1, NaN, Infinity]) {
    const { model, clock } = fixture();
    const changes = delta(1, [c], [a], "filesystem", time);
    model.setGraph([b, c], changes, [a, b]);
    assert.deepEqual(model.frame(), { births: new Map(), ghosts: [], edges: new Map(), edgeGhosts: [] });
    clock(start + 500);
    model.setGraph([b, c], changes, [a, b]);
    assert.deepEqual(model.frame(), { births: new Map(), ghosts: [], edges: new Map(), edgeGhosts: [] });
  }
});

test("reduced motion is a static green/red marker until the exact wall-clock expiry", () => {
  const { model } = fixture();
  model.setGraph([b, c], delta(1, [c], [a]), [a, b]);
  const lookup = new Map([b, c].map((node) => [node.id, node]));
  const first = model.frame(start, true);
  const later = model.frame(start + 3499, true);
  assert.deepEqual(first, later);
  assert.equal(first.ghosts[0].style.particles, false);
  assert.equal(first.ghosts[0].style.scale, 1);
  assert.deepEqual(lifecyclePoints(first, lookup), lifecyclePoints(later, lookup));
  assert.equal(lifecyclePoints(first, lookup).length, 4);
  assert.equal(lifecyclePoints(model.frame(start + 3499), lookup).length, 4);
  assert.equal(lifecyclePoints(model.frame(start + 3500, true), lookup).length, 2);
  assert.equal(lifecyclePoints(model.frame(start + 10000, true), lookup).length, 0);
});

test("birth/deletion remains independent of read playback, including off and queued activations", (t) => {
  let now = start;
  t.mock.method(Date, "now", () => now);
  const lifecycle = new GraphLifecycle({ now: () => now });
  const playback = new ActivityPlayback();
  const edges = [{ id: "ab", source: "a", target: "b" }, { id: "bc", source: "b", target: "c" }];
  lifecycle.setGraph([a, b], delta(0, [], [], "mount"));
  playback.setGraph([a, b], edges);
  playback.update({ enabled: true, durationMs: 5000, nodes: [a, b].map(({ id }) => ({ id, accessedAt: start, expiresAt: start + 5000 })) });
  playback.frame();
  now += 120;
  assert.deepEqual([...playback.frame().nodes.keys()], ["a"]);
  lifecycle.setGraph([a, b, c], delta(1, [c], [], "filesystem", now), [a, b]);
  playback.setGraph([a, b, c], edges);
  assert.deepEqual([...playback.frame().nodes.keys()], ["a"]);
  assert.equal(lifecycle.frame().births.size, 1);
  now = start + ACTIVITY_SPACING_MS;
  playback.frame();
  now += 120;
  assert.deepEqual([...playback.frame().nodes.keys()], ["a", "b"]);
  lifecycle.setGraph([b, c], delta(2, [], [a], "filesystem", now), [a, b, c]);
  playback.setGraph([b, c], edges);
  assert.deepEqual([...playback.frame().nodes.keys()], ["b"]);
  assert.equal(playback.frame().edges.length, 0);
  assert.equal(lifecycle.frame().ghosts.length, 1);
  playback.update({ enabled: false, nodes: [] });
  assert.equal(playback.frame().nodes.size, 0);
  assert.equal(lifecycle.frame().births.size, 1);
  assert.equal(lifecycle.frame().ghosts.length, 1);
});

test("WebGL packs the shared lifecycle points, with ghosts outside node and edge packing", () => {
  const { model } = fixture();
  model.setGraph([b, c], delta(1, [c], [a]), [a, b]);
  const renderer = Object.create(GraphGL.prototype);
  renderer.scratch = new Float32Array(1000);
  let drawn;
  renderer.drawPoints = (data, stride, count) => { drawn = Array.from(data.slice(0, stride * count)); };
  const frame = model.frame(start + 500);
  const lookup = new Map([b, c].map((node) => [node.id, node]));
  renderer.drawLifecycle(frame, lookup);
  const expected = lifecyclePoints(frame, lookup).flatMap(({ x, y, size, rgb, alpha }) => [x, y, size, ...rgb, alpha]);
  assert.deepEqual(drawn, Array.from(new Float32Array(expected)));
  assert.equal(lookup.has("a"), false);
  drawn = null;
  renderer.drawLifecycle(model.frame(start + 10000), lookup);
  assert.equal(drawn, null);
});

test("watcher status is independent of collector state and renders only public text", () => {
  const elements = new Map();
  const root = { querySelector: (id) => {
    if (!elements.has(id)) elements.set(id, {
      dataset: {}, textContent: "", classList: { toggle(name, value) { this[name] = value; } },
      set innerHTML(_) { assert.fail("Unsafe HTML"); },
    });
    return elements.get(id);
  } };
  const controls = mountGraphWatchControls(root);
  assert.equal(graphWatchStatus({ collector: { status: "live" } }).label, "Changes idle");
  controls.setWatch({ status: "live", message: "Watching <atlas>", token: "secret-connection-token" });
  assert.equal(elements.get("#graph-watch-status").textContent, "Changes live");
  assert.equal(elements.get("#graph-watch-message").textContent, "Watching <atlas>");
  assert.equal(elements.get("#graph-watch-state").textContent, "Watching");
  assert.equal(elements.get("#graph-watch-error").classList.hidden, true);
  controls.setWatch({ status: "error", message: "Directory unavailable" });
  assert.equal(elements.get("#graph-watch-status").dataset.status, "error");
  assert.equal(elements.get("#graph-watch-error").textContent, "Directory unavailable");
  assert.equal(elements.get("#graph-watch-error").classList.hidden, false);
  controls.setConnected(false);
  assert.equal(elements.get("#graph-watch-status").textContent, "Changes disconnected");
  controls.setConnected(true);
  assert.equal(elements.get("#graph-watch-message").textContent, "Directory unavailable");
  assert.ok([...elements.values()].every((el) => !el.textContent.includes("secret-connection-token")));
  assert.match(GRAPH_WATCH_HELP, /any app without extra permissions/);
  assert.match(GRAPH_WATCH_HELP, /independent of the read collector/);
});

test("created nodes fade from zero to full opacity and deleted nodes fade out over 3500 ms", () => {
  const { model } = fixture();
  model.setGraph([b, c], delta(1, [c], [a]), [a, b]);
  const samples = [0, 875, 1750, 2625, 3499].map((elapsed) => model.frame(start + elapsed));
  const expected = [0, 0.15625, 0.5, 0.84375];
  for (const [i, frame] of samples.entries()) {
    const birth = frame.births.get("c");
    const ghost = frame.ghosts[0].style;
    if (i < expected.length) assert.equal(birth.nodeOpacity, expected[i]);
    assert.equal(ghost.nodeOpacity, 1 - birth.nodeOpacity);
    assert.equal(ghost.alpha, ghost.nodeOpacity);
    assert.equal(lifecycleEdgeOpacity(frame, "b", "c"), birth.nodeOpacity);
    assert.equal(lifecycleNodeOpacity(frame, "b"), 1);
    assert.equal(birth.scale, 1);
    assert.equal(ghost.scale, 1);
    assert.equal(ghost.particles, false);
  }
  assert.equal(samples[0].births.get("c").alpha, 0);
  assert.ok(samples.at(-1).births.get("c").alpha > 0.7, "Green glow continues after the opacity fade");
  assert.equal(lifecycleNodeOpacity(model.frame(start + 3500), "c"), 1);
  assert.equal(model.frame(start + 3500).ghosts.length, 0);
});

test("creation glow fades over ten seconds independently of arrival and retains its deadline across remapping", () => {
  const { model } = fixture();
  model.setGraph([a, b, c], delta(1, [c]), [a, b]);
  const alphas = [1750, 3500, 5000, 7500, 9999].map((elapsed) => model.frame(start + elapsed).births.get("c").alpha);
  assert.ok(alphas.every((alpha, index) => alpha > 0 && (!index || alpha < alphas[index - 1])));
  assert.equal(alphas[2], 0.5);
  assert.ok(alphas.at(-1) < 0.000001);
  assert.equal(model.frame(start + 9999).births.get("c").nodeOpacity, 1);
  const remapped = { ...c, id: "new-c" };
  model.setGraph([a, b, remapped], delta(2), [a, b, c]);
  assert.equal(model.frame(start + 9999).births.get("new-c").alpha, alphas.at(-1));
  assert.equal(model.frame(start + 10000).births.size, 0);
});

test("reduced motion keeps a static birth marker until the ten-second timeout", () => {
  const { model } = fixture();
  model.setGraph([a, b, c], delta(1, [c]), [a, b]);
  const first = model.frame(start, true).births.get("c");
  const last = model.frame(start + 9999, true).births.get("c");
  assert.deepEqual(first, last);
  assert.equal(last.alpha, 0.85);
  assert.equal(model.frame(start + 10000, true).births.size, 0);
});

test("late creation deltas retain remaining glow without replaying expired deletions or relationships", () => {
  const { model, clock } = fixture();
  clock(start + 4000);
  model.setGraph([b, c], { ...delta(1, [c], [a]), createdEdges: [{ id: "bc" }] },
    [a, b], undefined, [{ id: "bc", source: "b", target: "c", kind: "relates" }]);
  const frame = model.frame();
  assert.equal(frame.births.get("c").nodeOpacity, 1);
  assert.ok(frame.births.get("c").alpha > 0);
  assert.equal(frame.ghosts.length, 0);
  assert.equal(frame.edges.size, 0);
  clock(start + 10000);
  assert.equal(model.frame().births.size, 0);
});

test("deleting a partially faded-in node never flashes it back to full opacity", () => {
  const { model, clock } = fixture();
  model.setGraph([a, b, c], delta(1, [c]), [a, b]);
  clock(start + 1750);
  assert.equal(model.frame().births.get("c").nodeOpacity, 0.5);
  model.setGraph([a, b], delta(2, [], [c], "filesystem", start + 1750), [a, b, c]);
  assert.equal(model.frame().ghosts[0].style.alpha, 0.5);
  assert.equal(model.frame(start + 3500).ghosts[0].style.alpha, 0.25);
  assert.equal(model.frame(start + 5250).ghosts.length, 0);
});

test("WebGL fades normal node and edge packing, not only the colored overlay", () => {
  const { model } = fixture();
  model.setGraph(nodes, delta(1, [c]), [a, b]);
  const renderer = Object.create(GraphGL.prototype);
  renderer.scratch = new Float32Array(1000);
  const renderNodes = nodes.map((node) => ({ ...node, born: 0, lon: 0 }));
  const base = {
    nodes: renderNodes, edges: [{ id: "bc", source: "b", target: "c", kind: "relates" }],
    selectedId: null, query: "", t: 0, reduce: false,
  };
  const lookup = new Map(renderNodes.map((node) => [node.id, node]));
  for (const [elapsed, opacity] of [[0, 0], [1750, 0.5], [3500, 1]]) {
    const frame = { ...base, lifecycleFrame: model.frame(start + elapsed) };
    renderer.packNodes(frame, "", () => true, new Set());
    assert.ok(Math.abs(renderer.scratch[2 * 7 + 6] - 0.95 * 0.55 * opacity) < 1e-6);
    renderer.packEdges(frame, lookup, "", () => true, new Set());
    assert.ok(Math.abs(renderer.scratch[5] - 0.22 * opacity) < 1e-6);
  }
});

const ab = { id: "ab", source: "a", target: "b", kind: "relates" };
const edgeDelta = (revision = 1, occurredAt = start) => ({
  ...delta(revision, [], [], "filesystem", occurredAt), createdEdges: [ab],
});

test("new relationships fade in, glow and return to normal at exactly 3500 ms", () => {
  const { model } = fixture();
  model.setGraph([a, b], edgeDelta(), [a, b], undefined, [ab]);
  const lookup = new Map([a, b].map((node) => [node.id, node]));
  for (const [elapsed, opacity, glow] of [[0, 0, 0], [875, 0.15625, 0.52734375], [1750, 0.5, 1], [2625, 0.84375, 0.52734375]]) {
    const frame = model.frame(start + elapsed);
    assert.equal(lifecycleEdgeOpacity(frame, "a", "b", "ab"), opacity);
    assert.equal(frame.edges.get("ab").style.alpha, glow);
    assert.equal(frame.births.size, 0);
    const glows = lifecycleEdgeGlows(frame, lookup);
    assert.equal(glows.length, 3);
    assert.equal(glows[2].alpha, glow * 0.9);
    assert.deepEqual(glows[2].source, { x: a.sx, y: a.sy });
  }
  const expired = model.frame(start + 3500);
  assert.equal(expired.edges.size, 0);
  assert.equal(lifecycleEdgeOpacity(expired, "a", "b", "ab"), 1);
  assert.deepEqual(lifecycleEdgeGlows(expired, lookup), []);
});

test("relationship effects never replay on bootstrap, mount, filtering, metadata edits or duplicate snapshots", () => {
  const boot = new GraphLifecycle({ now: () => start });
  boot.setGraph([a, b], edgeDelta(), [], undefined, [ab]);
  assert.equal(boot.frame().edges.size, 0);
  const { model, clock } = fixture();
  model.setGraph([a, b], edgeDelta(), [a, b], undefined, [ab]);
  clock(start + 1750);
  model.setGraph([a, b], edgeDelta(), [a, b], undefined, [ab]);
  model.setGraph([a, b], delta(2), [a, b], undefined, [ab]);
  assert.equal(model.frame().edges.get("ab").style.alpha, 1);
  clock(start + 3500);
  assert.equal(model.frame().edges.size, 0);
  model.setGraph([a, b], edgeDelta(3, start + 3500), [a, b], undefined, [ab]);
  assert.equal(model.frame().edges.size, 1);
  model.setGraph([a, b], edgeDelta(3, start + 3500), [a, b], undefined, []);
  model.setGraph([a, b], edgeDelta(3, start + 3500), [a, b], undefined, [ab]);
  assert.equal(model.frame().edges.size, 0);
  model.setGraph([a, b], edgeDelta(4, start + 3500), [a, b], undefined, [ab]);
  model.setGraph([a, b], delta(5, [], [], "mount"), [a, b], undefined, [ab]);
  assert.equal(model.frame().edges.size, 0);
});

test("relationship effects retain identity across graph renumbering and stop when endpoints disappear", () => {
  const { model, clock } = fixture();
  model.setGraph([a, b], edgeDelta(), [a, b], undefined, [ab]);
  clock(start + 875);
  const qualified = [{ ...a, id: "one::a" }, { ...b, id: "one::b" }];
  const edge = { ...ab, id: "qualified", source: "one::a", target: "one::b" };
  model.setGraph(qualified, delta(2), [a, b], undefined, [edge]);
  assert.equal(model.frame().edges.get("qualified").style.nodeOpacity, 0.15625);
  assert.equal(model.frame().edges.has("ab"), false);
  model.setGraph([qualified[0]], delta(3), qualified, undefined, [edge]);
  assert.equal(model.frame().edges.size, 0);
});

test("reduced-motion relationship glows are static and new endpoints still gate animated glows", () => {
  const { model } = fixture();
  model.setGraph([a, b], { ...edgeDelta(), created: [b] }, [a], undefined, [ab]);
  const lookup = new Map([a, b].map((node) => [node.id, node]));
  assert.equal(lifecycleEdgeGlows(model.frame(), lookup)[2].alpha, 0);
  assert.equal(lifecycleEdgeGlows(model.frame(start + 1750), lookup)[2].alpha, 0.45);
  const reduced = model.frame(start + 500, true);
  assert.equal(lifecycleEdgeOpacity(reduced, "a", "b", "ab"), 1);
  assert.deepEqual(lifecycleEdgeGlows(reduced, lookup), lifecycleEdgeGlows(model.frame(start + 3499, true), lookup));
});

test("WebGL packs relationship glow widths as triangles and fades ordinary edges independently", () => {
  const { model } = fixture();
  model.setGraph([a, b], edgeDelta(), [a, b], undefined, [ab]);
  const renderer = Object.create(GraphGL.prototype);
  renderer.scratch = new Float32Array(1000);
  renderer.gl = { TRIANGLES: 4 };
  let draw;
  renderer.drawLines = (data, count, mode) => { draw = { data: [...data.slice(0, count * 6)], count, mode }; };
  const lookup = new Map([a, b].map((node) => [node.id, node]));
  const frame = model.frame(start + 1750);
  renderer.drawLifecycleEdges(frame, lookup);
  assert.equal(draw.count, 18);
  assert.equal(draw.mode, 4);
  assert.equal(draw.data[1] - draw.data[7], 10);
  assert.ok(Math.abs(draw.data[77] - 0.9) < 1e-6);
  renderer.packEdges({ edges: [ab], lifecycleFrame: frame }, lookup, "", () => true, new Set());
  assert.ok(Math.abs(renderer.scratch[5] - 0.11) < 1e-6);
  draw = null;
  renderer.drawLifecycleEdges(model.frame(start + 3500), lookup);
  assert.equal(draw, null);
});

const removedEdgeDelta = (revision = 1, occurredAt = start) => ({
  ...delta(revision, [], [], "filesystem", occurredAt), deletedEdges: [ab],
});

test("deleted relationships glow red and fade out on the same 3500 ms envelope as deleted nodes", () => {
  const { model } = fixture();
  model.setGraph([a, b], removedEdgeDelta(), [a, b], undefined, [], [ab]);
  const lookup = new Map([a, b].map((node) => [node.id, node]));
  for (const [elapsed, opacity] of [[0, 1], [875, 0.84375], [1750, 0.5], [2625, 0.15625]]) {
    const frame = model.frame(start + elapsed);
    assert.equal(frame.edges.size, 0);
    assert.equal(frame.edgeGhosts.length, 1);
    assert.equal(frame.edgeGhosts[0].style.alpha, opacity);
    assert.deepEqual(frame.edgeGhosts[0].style.rgb, [1, 0.24, 0.3]);
    const glows = lifecycleEdgeGlows(frame, lookup);
    assert.equal(glows.length, 3);
    assert.equal(glows[2].alpha, 0.9 * opacity);
  }
  assert.ok(model.frame(start + 3499).edgeGhosts[0].style.alpha < 0.000001);
  assert.deepEqual(model.frame(start + 3500).edgeGhosts, []);
  assert.equal(model.edgeGhosts.size, 0);
});

test("edge ghosts follow surviving file identities and retain snapshots for deleted endpoints", () => {
  const { model } = fixture();
  const oldA = { ...a }, oldB = { ...b };
  model.setGraph([b], { ...removedEdgeDelta(), deleted: [a] }, [oldA, oldB], undefined, [], [ab]);
  oldA.sx = 9999;
  const frame = model.frame(start + 1000);
  const liveB = { ...b, id: "one::b", sx: 777 };
  const impostor = { ...a, storeRoot: "/other", sx: 888 };
  const glow = lifecycleEdgeGlows(frame, new Map([[liveB.id, liveB], [impostor.id, impostor]]))[2];
  assert.equal(glow.source.x, a.sx);
  assert.equal(glow.target.x, liveB.sx);
  assert.equal(frame.ghosts.length, 1);
  assert.equal(frame.edgeGhosts.length, 1);
});

test("edge deletion requires a previously visible edge and explicit filesystem evidence", () => {
  for (const [changes, previousEdges] of [
    [delta(1), [ab]],
    [removedEdgeDelta(), []],
    [{ ...removedEdgeDelta(), origin: "mount" }, [ab]],
    [removedEdgeDelta(1, start - 3500), [ab]],
    [removedEdgeDelta(1, start + 1), [ab]],
  ]) {
    const { model } = fixture();
    model.setGraph([a, b], changes, [a, b], undefined, [], previousEdges);
    assert.equal(model.frame().edgeGhosts.length, 0);
  }
  const model = new GraphLifecycle({ now: () => start });
  model.setGraph([a, b], removedEdgeDelta(), [a, b], undefined, [], [ab]);
  assert.equal(model.frame().edgeGhosts.length, 0);
});

test("deletion ghosts do not replay or extend on duplicate revisions or metadata edits", () => {
  const { model, clock } = fixture();
  model.setGraph([a, b], removedEdgeDelta(), [a, b], undefined, [], [ab]);
  clock(start + 1750);
  model.setGraph([a, b], removedEdgeDelta(), [a, b]);
  model.setGraph([a, b], delta(2), [a, b]);
  assert.equal(model.frame().edgeGhosts[0].style.alpha, 0.5);
  clock(start + 3500);
  assert.equal(model.frame().edgeGhosts.length, 0);
});

test("recreation, node/relationship filters and unmount cancel edge ghosts without replay", () => {
  for (const stop of [
    (model) => model.setGraph([a, b], delta(2), [a, b], undefined, [ab]),
    (model) => model.setGraph([b], delta(2), [a, b], (node) => node.id === "b"),
    (model) => model.setGraph([a, b], delta(2), [a, b], undefined, [], [], () => false),
    (model) => model.setGraph([], delta(2, [], [], "mount"), [a, b]),
  ]) {
    const { model } = fixture();
    model.setGraph([a, b], removedEdgeDelta(), [a, b], undefined, [], [ab]);
    stop(model);
    assert.equal(model.frame().edgeGhosts.length, 0);
    model.setGraph([a, b], delta(2), [a, b], undefined, []);
    assert.equal(model.frame().edgeGhosts.length, 0);
  }
});

test("deleting a new relationship mid-fade does not flash it or its new endpoints brighter", () => {
  for (const createNode of [false, true]) {
    const { model, clock } = fixture();
    model.setGraph([a, b], { ...edgeDelta(), created: createNode ? [b] : [] },
      createNode ? [a] : [a, b], undefined, [ab]);
    clock(start + 1750);
    model.setGraph([a, b], removedEdgeDelta(2, start + 1750), [a, b], undefined, [], [ab]);
    assert.equal(model.frame().edgeGhosts[0].style.alpha, 0.5);
    assert.equal(model.frame(start + 3500).edgeGhosts[0].style.alpha, 0.25);
  }
});

test("reduced-motion deletion ghosts stay static and WebGL packs red without restoring live edges", () => {
  const { model } = fixture();
  model.setGraph([], { ...removedEdgeDelta(), deleted: [a, b] }, [a, b], undefined, [], [ab]);
  const first = model.frame(start, true), last = model.frame(start + 3499, true);
  assert.deepEqual(lifecycleEdgeGlows(first, new Map()), lifecycleEdgeGlows(last, new Map()));
  const renderer = Object.create(GraphGL.prototype);
  renderer.scratch = new Float32Array(1000);
  renderer.gl = { TRIANGLES: 4 };
  let draw;
  renderer.drawLines = (data, count, mode) => { draw = { data: [...data.slice(0, count * 6)], count, mode }; };
  renderer.drawLifecycleEdges(model.frame(start + 1750), new Map());
  assert.equal(draw.count, 18);
  assert.equal(draw.mode, 4);
  assert.deepEqual(draw.data.slice(2, 5), [...new Float32Array([1, 0.24, 0.3])]);
  assert.ok(Math.abs(draw.data[77] - 0.45) < 1e-6);
  assert.equal(renderer.packEdges({ edges: [] }, new Map(), "", () => true, new Set()), 0);
  draw = null;
  renderer.drawLifecycleEdges(model.frame(start + 3500), new Map());
  assert.equal(draw, null);
});
