import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_ACTIVITY_DURATION_MS, activityFrame, activityNodeStyle, activityEdgeOpacity,
  activityPulse, indexActivityGraph, retainActivity,
} from "../.apm/extensions/cartograph/public/activity-rendering.js";
import { activityDuration, activityScopeLabel, activityStatus, playbackStatus, requestActivity, mountActivityControls } from "../.apm/extensions/cartograph/public/activity-controls.js";
import { GraphGL } from "../.apm/extensions/cartograph/public/graph-gl.js";
import { mountGraphCanvas } from "../.apm/extensions/cartograph/public/graph-canvas.js";
import { ACTIVITY_SPACING_MS } from "../.apm/extensions/cartograph/public/activity-playback.js";
import { GraphLifecycle } from "../.apm/extensions/cartograph/public/graph-lifecycle.js";
import { ActivityCamera } from "../.apm/extensions/cartograph/public/activity-camera.js";

const start = 1800000000000;
const nodes = ["a", "b", "c"].map((id, i) => ({
  id, title: id, kind: "work", degree: 1, sourceCount: 0,
  sx: i * 100, sy: 0, depth: 1, born: 0, lon: 0, r: 3,
}));
const graphEdges = [{ id: "ba", source: "b", target: "a", kind: "relates" }];
const graph = indexActivityGraph(nodes, graphEdges);
const activity = {
  enabled: true, durationMs: 5000,
  nodes: [
    { id: "a", accessedAt: start, expiresAt: start + 5000 },
    { id: "b", accessedAt: start + 1000, expiresAt: start + 6000 },
  ],
  edges: [{ id: "ba", source: "a", target: "b", startedAt: start + 1000, expiresAt: start + 6000 }],
  collector: { status: "waiting", message: "" },
};
const esloggerProvider = {
  id: "macos-eslogger", label: "macOS eslogger",
  description: "Observe OS file access with eslogger.",
  permissions: ["administrator", "full-disk-access"],
  operations: ["open", "read", "write", "read-write"],
  setup: {
    title: "Start the macOS collector",
    description: "Observing file opens in other apps requires macOS authorization. The system logger sees system-wide metadata; the unprivileged collector forwards only accesses to files in your open Atlas graphs.",
    steps: [
      "Open Terminal on the Mac running this canvas with Node.js 22 or later on its PATH. Grant Terminal Full Disk Access in System Settings → Privacy & Security if required.",
      "Run sudo /usr/bin/eslogger open close manually. Only eslogger runs as root; the Node collector must run as your normal user. Do not run the whole pipeline with sudo.",
      "Leave that terminal open. Status becomes Live only after the collector observes a valid OS event. Use Control-C to stop it.",
    ],
    notice: "The command contains a private connection token. Do not share it.",
  },
};
const directProvider = {
  id: "test-direct", label: "Test direct reporter", description: "Report events directly for tests.",
  permissions: [], operations: ["read", "write"],
  setup: {
    title: "Connect the test reporter",
    description: "A test component reports events directly.",
    steps: ["Enable reporting in the test component.", "Wait for an activity event."],
    notice: "Keep connection details private.",
  },
};

test("concurrent activity brightens all accessed nodes and dims the rest", () => {
  const frame = activityFrame(activity, start + 2000, graph);
  assert.equal(frame.nodes.size, 2);
  for (const id of ["a", "b"]) {
    const style = activityNodeStyle(frame, id, 0.6, 3);
    assert.ok(style.alpha > 0.6);
    assert.ok(style.size > 3);
  }
  assert.ok(activityNodeStyle(frame, "c", 0.6).alpha < 0.1);
  assert.ok(activityEdgeOpacity(frame) < 0.05);
});

test("activity edges follow temporal direction, not the stored relationship direction", () => {
  const frame = activityFrame(activity, start + 1300, graph);
  assert.equal(frame.edges.length, 1);
  assert.equal(frame.edges[0].source, "a");
  const lookup = new Map(nodes.map((node) => [node.id, node]));
  const first = activityPulse(frame.edges[0], lookup);
  const later = activityPulse(activityFrame(activity, start + 1500, graph).edges[0], lookup);
  assert.ok(first.head.x < later.head.x);
  assert.ok(first.wings.every((wing) => wing.x < first.head.x));
  assert.ok(first.trail.every((point) => point.x <= first.head.x));
});

test("activity edges stop at either endpoint's exact client-side expiry", () => {
  assert.equal(activityFrame(activity, start + 4999, graph).edges.length, 1);
  assert.equal(activityFrame(activity, start + 5000, graph).edges.length, 0);
  assert.equal(activityFrame(activity, start + 5000, graph).nodes.size, 1);
  const earlierTarget = { ...activity, nodes: [activity.nodes[0], { ...activity.nodes[1], expiresAt: start + 3000 }] };
  assert.equal(activityFrame(earlierTarget, start + 3000, graph).edges.length, 0);
  const earlierEdge = { ...activity, edges: [{ ...activity.edges[0], expiresAt: start + 2500 }] };
  assert.equal(activityFrame(earlierEdge, start + 2500, graph).edges.length, 0);
});

test("expiry and disabling restore the exact normal or selection styling without mutating state", () => {
  const original = structuredClone(activity);
  for (const frame of [activityFrame(activity, start + 6000, graph), activityFrame({ ...activity, enabled: false }, start + 2000, graph)]) {
    assert.equal(frame.nodes.size, 0);
    assert.equal(frame.edges.length, 0);
    assert.deepEqual(activityNodeStyle(frame, "a", 0.12, 4), { strength: 0, alpha: 0.12, size: 4, dim: 1 });
    assert.equal(activityEdgeOpacity(frame), 1);
  }
  assert.deepEqual(activity, original);
});

test("smooth fades return an expiring node to the dim state while another stays active", () => {
  const entering = activityFrame(activity, start + 50, graph);
  assert.ok(entering.amount > 0 && entering.amount < 1);
  const fade = activityFrame(activity, start + 4900, graph);
  const nearlyGone = activityFrame(activity, start + 4999, graph);
  const gone = activityFrame(activity, start + 5000, graph);
  assert.ok(fade.nodes.get("a") > nearlyGone.nodes.get("a"));
  assert.ok(Math.abs(activityNodeStyle(nearlyGone, "a", 0.6).alpha - activityNodeStyle(gone, "a", 0.6).alpha) < 0.001);
});

test("repeated accesses extend the highlight without replaying its entrance fade", () => {
  const first = retainActivity(null, activity, start + 2000);
  const incoming = { ...activity, nodes: activity.nodes.map((node) => ({ ...node, accessedAt: start + 2000, expiresAt: start + 7000 })) };
  const next = retainActivity(first, incoming, start + 2000);
  assert.equal(activityFrame(next, start + 2001, graph).nodes.get("a"), 1);
  assert.equal(activityFrame(next, start + 6500, graph).nodes.size, 2);
  assert.equal(incoming.nodes[0].highlightedAt, undefined);
});

test("filtered layers and missing relationships never gain activity edges", () => {
  const filtered = indexActivityGraph(nodes.slice(1), graphEdges);
  const frame = activityFrame(activity, start + 2000, filtered);
  assert.equal(frame.nodes.size, 1);
  assert.equal(frame.edges.length, 0);
  assert.equal(activityFrame(activity, start + 2000, indexActivityGraph(nodes, [])).edges.length, 0);
  assert.equal(activityFrame(activity, start + 2000, indexActivityGraph([], [])).amount, 0);
});

test("reduced motion uses a static directional arrow without travelling particles", () => {
  const lookup = new Map(nodes.map((node) => [node.id, node]));
  const first = activityPulse(activityFrame(activity, start + 2000, graph).edges[0], lookup, true);
  const next = activityPulse(activityFrame(activity, start + 2300, graph).edges[0], lookup, true);
  assert.deepEqual(first, next);
  assert.deepEqual(first.trail, []);
  assert.ok(first.wings.every((wing) => wing.x < first.head.x));
});

test("invalid and future timestamps do not produce highlights", () => {
  assert.equal(activityFrame(activity, start - 1, graph).amount, 0);
  assert.equal(activityFrame({ ...activity, nodes: [{ id: "a", accessedAt: NaN, expiresAt: start + 5000 }] }, start + 2000, graph).amount, 0);
});

test("duration settings are seconds with default five and 0.1–300 limits", () => {
  assert.equal(DEFAULT_ACTIVITY_DURATION_MS, 5000);
  assert.equal(activityDuration("5"), 5000);
  assert.equal(activityDuration("0.1"), 100);
  assert.equal(activityDuration("300"), 300000);
  for (const value of ["", "x", "0", "-1", "0.09", "301", "Infinity"]) assert.throws(() => activityDuration(value));
});

test("status does not claim Live until the collector does", () => {
  assert.equal(activityStatus(undefined).label, "Waiting");
  assert.equal(activityStatus(activity).label, "Waiting");
  assert.equal(activityStatus({ ...activity, collector: { status: "live" } }).label, "Live");
  assert.equal(activityStatus({ ...activity, enabled: false }).label, "Off");
  assert.equal(activityStatus(activity, false).label, "Disconnected");
  for (const status of ["disconnected", "error", "paused", "unsupported"]) assert.notEqual(activityStatus({ ...activity, collector: { status } }).label, "Live");
});

test("scope labels identify the current session instead of promising whole-application coverage", () => {
  const label = activityScopeLabel({ mode: "session", rootPid: 41529, excludePids: [61723] });
  assert.match(label, /this Copilot session \(PID 41529\)/);
  assert.match(label, /Cartograph and its child processes are excluded/);
  assert.match(activityScopeLabel({ mode: "all", excludePids: [] }), /all applications/);
  assert.match(activityScopeLabel(), /Waiting/);
});

test("activity HTTP requests send the canvas header and reject failed responses", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (path, options) => {
    calls.push({ path, options });
    return { ok: calls.length < 3, status: 403, json: async () => calls.length < 3 ? activity : { error: "Forbidden" } };
  });
  await requestActivity("/api/activity/connection");
  await requestActivity("/api/activity/config", { method: "POST", body: JSON.stringify({ enabled: false, durationMs: 5000 }) });
  assert.equal(calls[0].options.headers["X-Cartograph-Client"], "canvas");
  assert.equal(calls[1].options.headers["Content-Type"], "application/json");
  assert.equal(calls[0].options.cache, "no-store");
  await assert.rejects(requestActivity("/api/activity/config"), /Forbidden/);
});

function fakeElement(tag = "div") {
  const listeners = new Map();
  const classes = new Set();
  return {
    style: {}, dataset: {}, open: false, value: "", checked: true, textContent: "",
    tagName: tag.toUpperCase(), children: [], replacements: 0,
    set innerHTML(_value) { assert.fail("UI text must never be assigned as HTML"); },
    replaceChildren(...children) { this.children = children; this.replacements++; },
    classList: {
      add: (name) => classes.add(name), remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
      toggle: (name, force) => force ? classes.add(name) : classes.delete(name),
    },
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
    fire: (type, event = {}) => listeners.get(type)?.(event),
  };
}

function installGlobals(t, values) {
  for (const [key, value] of Object.entries(values)) {
    const before = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => before ? Object.defineProperty(globalThis, key, before) : delete globalThis[key]);
  }
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

function controlsFixture(t) {
  const elements = new Map();
  const root = fakeElement();
  root.querySelector = (id) => { if (!elements.has(id)) elements.set(id, fakeElement()); return elements.get(id); };
  installGlobals(t, { document: { activeElement: null, createElement: fakeElement } });
  const received = [];
  const controls = mountActivityControls(root, (next) => received.push(next));
  return { root, controls, received, get: (id) => root.querySelector(`#${id}`), elements };
}

test("scope is displayed independently of provider setup metadata", (t) => {
  const { controls, get } = controlsFixture(t);
  controls.setActivity({ ...activity, scope: { mode: "session", rootPid: 400, excludePids: [500] } });
  assert.match(get("activity-scope").textContent, /PID 400/);
  controls.setActivity({ ...activity, scope: { mode: "all", excludePids: [] } });
  assert.match(get("activity-scope").textContent, /all applications/);
});

test("Knowledge Activation camera toggle defaults on and stays independent of read monitoring", (t) => {
  const { root, get } = controlsFixture(t);
  const changes = [];
  const controls = mountActivityControls(root, () => assert.fail("Camera toggles must not configure read monitoring"),
    enabled => changes.push(enabled));
  assert.equal(controls.autoFocusEnabled(), true);
  get("activity-auto-focus").checked = false;
  get("activity-auto-focus").fire("change");
  controls.setActivity({ ...activity, enabled: false });
  controls.setPlayback({ pendingCount: 1 });
  assert.equal(controls.autoFocusEnabled(), false);
  get("activity-auto-focus").checked = true;
  get("activity-auto-focus").fire("change");
  assert.deepEqual(changes, [false, true]);
  const html = readFileSync(new URL("../.apm/extensions/cartograph/public/index.html", import.meta.url), "utf8");
  assert.match(html, /<summary>Knowledge Activation /);
  const summary = html.match(/<summary>([\s\S]*?)<\/summary>/)[1].replace(/<[^>]*>/g, "");
  assert.match(summary, /Changes idle\s+400 ms/);
  assert.match(html, /id="activity-auto-focus"[^>]*checked/);
});

test("controls fetch secrets only when expanded, clear them on close, and surface toggle failures", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (path) => {
    calls.push(path);
    return { ok: path.endsWith("connection"), status: 500, json: async () => path.endsWith("connection") ? { command: "private-command" } : { error: "No connection" } };
  });
  const { root, controls, received } = controlsFixture(t);
  controls.setActivity(activity);
  assert.equal(calls.length, 0);
  root.open = true;
  root.fire("toggle");
  await settle();
  assert.equal(calls.length, 1);
  assert.equal(root.querySelector("#activity-command").textContent, "private-command");
  root.open = false;
  root.fire("toggle");
  assert.equal(root.querySelector("#activity-command").textContent, "");
  root.querySelector("#activity-enabled").checked = false;
  await root.querySelector("#activity-enabled").fire("change");
  assert.equal(root.querySelector("#activity-enabled").checked, true);
  assert.match(root.querySelector("#activity-config-error").textContent, /not saved.*No connection/);
  assert.equal(received.length, 0);
});

test("provider setup has a generic fallback and no built-in macOS privilege prompts", (t) => {
  const { get } = controlsFixture(t);
  assert.equal(get("activity-setup-title").textContent, "Activity provider setup");
  assert.equal(get("activity-setup-steps").children.length, 0);
  assert.equal(get("activity-provider-label").classList.contains("hidden"), true);
  assert.doesNotMatch(activityStatus(undefined).message, /macOS|eslogger|sudo|Full Disk Access/i);
  const html = readFileSync(new URL("../.apm/extensions/cartograph/public/index.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /macOS|eslogger|sudo|Full Disk Access/i);
});

test("eslogger setup comes from provider metadata and is not rebuilt for heartbeats", (t) => {
  const { controls, get } = controlsFixture(t);
  const state = { ...activity, provider: esloggerProvider };
  controls.setActivity(state);
  assert.equal(get("activity-provider-label").textContent, esloggerProvider.label);
  assert.equal(get("activity-setup-title").textContent, esloggerProvider.setup.title);
  assert.equal(get("activity-setup-description").textContent, esloggerProvider.setup.description);
  assert.equal(get("activity-setup-notice").textContent, esloggerProvider.setup.notice);
  const list = get("activity-setup-steps");
  assert.deepEqual(list.children.map((item) => item.textContent), esloggerProvider.setup.steps);
  const items = list.children;
  const replacements = list.replacements;
  controls.setActivity({ ...structuredClone(state), collector: { status: "live", message: "Observing activity." } });
  controls.setConnected(false);
  controls.setConnected(true);
  assert.equal(list.children, items);
  assert.equal(list.replacements, replacements);
});

test("an alternative provider replaces all macOS and administrator setup prompts", (t) => {
  const { controls, get, elements } = controlsFixture(t);
  controls.setActivity({ ...activity, provider: esloggerProvider });
  controls.setActivity({ ...activity, provider: directProvider });
  assert.equal(get("activity-provider-label").textContent, directProvider.label);
  assert.equal(get("activity-setup-title").textContent, directProvider.setup.title);
  assert.equal(get("activity-setup-description").textContent, directProvider.setup.description);
  assert.deepEqual(get("activity-setup-steps").children.map((item) => item.textContent), directProvider.setup.steps);
  const visibleText = [...elements.values()].flatMap((element) => [element.textContent, ...element.children.map((child) => child.textContent)]).join(" ");
  assert.doesNotMatch(visibleText, /macOS|eslogger|sudo|root|Full Disk Access|Node\.js 22/i);
});

test("provider setup strings are literal text rather than executable HTML", (t) => {
  const { controls, get } = controlsFixture(t);
  const payload = '<img src=x onerror="globalThis.providerInjected=true">';
  controls.setActivity({
    ...activity, provider: {
      ...directProvider, label: payload,
      setup: { title: payload, description: payload, steps: [payload, "<script>throw new Error('injected')</script>"], notice: payload },
    },
  });
  for (const id of ["activity-provider-label", "activity-setup-title", "activity-setup-description", "activity-setup-notice"]) {
    assert.equal(get(id).textContent, payload);
  }
  const steps = get("activity-setup-steps").children;
  assert.equal(steps[0].tagName, "LI");
  assert.equal(steps[0].textContent, payload);
  assert.equal(steps[0].children.length, 0);
  assert.equal(globalThis.providerInjected, undefined);
});

test("null commands intentionally support direct reporting without exposing connection tokens", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (path) => {
    calls.push(path);
    return { ok: true, json: async () => ({ command: null, providerId: directProvider.id, token: "never-display-this-token", endpoint: "/private-endpoint", pid: 123 }) };
  });
  const { root, controls, get, elements } = controlsFixture(t);
  controls.setActivity({ ...activity, provider: directProvider });
  assert.equal(calls.length, 0);
  root.open = true;
  root.fire("toggle");
  await settle();
  assert.equal(calls.length, 1);
  assert.equal(get("activity-command").textContent, "");
  assert.equal(get("activity-command-wrap").classList.contains("hidden"), true);
  assert.equal(get("activity-connection-error").classList.contains("hidden"), true);
  assert.match(get("activity-connection-status").textContent, /Connection ready.*reports activity directly.*No terminal command/);
  assert.equal(get("activity-status").textContent, "Waiting");
  assert.ok([...elements.values()].every((element) => !element.textContent.includes("never-display-this-token")));
  root.open = false;
  root.fire("toggle");
  assert.equal(get("activity-connection-status").textContent, "");
});

test("missing, empty, and invalid non-null commands remain visible errors", async (t) => {
  let response;
  t.mock.method(globalThis, "fetch", async () => ({ ok: true, json: async () => response }));
  const { root, get } = controlsFixture(t);
  root.open = true;
  for (const command of [undefined, "", "  ", false, 42, {}]) {
    response = { providerId: directProvider.id, command };
    root.fire("toggle");
    await settle();
    assert.match(get("activity-connection-error").textContent, /valid activity command/);
    assert.equal(get("activity-connection-error").classList.contains("hidden"), false);
    assert.equal(get("activity-command-wrap").classList.contains("hidden"), true);
    assert.equal(get("activity-connection-status").classList.contains("hidden"), true);
  }
});

test("WebGL packs bright concurrent nodes, dim surroundings, and restores query/selection state", () => {
  const renderer = Object.create(GraphGL.prototype);
  renderer.scratch = new Float32Array(1000);
  const frame = { nodes, edges: graphEdges, selectedId: "c", query: "c", t: 10, reduce: true };
  const pack = (overlay) => {
    const count = renderer.packNodes({ ...frame, activityFrame: overlay }, "c", (node) => node.id === "c", new Set(["c"]));
    return Array.from(renderer.scratch.slice(0, count * 7));
  };
  const baseline = pack(activityFrame(null));
  const active = pack(activityFrame(activity, start + 2000, graph));
  assert.equal(active.length, 5 * 7); // two activity halos plus three normal halo slots
  assert.ok(active[6] > baseline[6]);
  assert.ok(active[2 * 7 + 6] > baseline[1 * 7 + 6]);
  assert.ok(active[4 * 7 + 6] < baseline[2 * 7 + 6]);
  assert.deepEqual(pack(activityFrame(activity, start + 6000, graph)), baseline);
});

test("WebGL activity draws arrow geometry and drops pulses exactly at endpoint expiry", () => {
  const renderer = Object.create(GraphGL.prototype);
  renderer.gl = { TRIANGLES: 4 };
  renderer.scratch = new Float32Array(1000);
  const draws = [];
  renderer.drawLines = (data, count) => draws.push({ type: "lines", data: Array.from(data.slice(0, count * 6)) });
  renderer.drawPoints = (data, stride, count) => draws.push({ type: "points", data: Array.from(data.slice(0, stride * count)) });
  const lookup = new Map(nodes.map((node) => [node.id, node]));
  renderer.drawActivity({ activityFrame: activityFrame(activity, start + 2000, graph) }, lookup);
  assert.equal(draws[0].data.length, 108);
  assert.equal(draws[1].data.length, 63);
  draws.length = 0;
  renderer.drawActivity({ activityFrame: activityFrame(activity, start + 2000, graph), reduce: true }, lookup);
  assert.equal(draws.length, 1);
  assert.equal(draws[0].type, "lines");
  draws.length = 0;
  renderer.drawActivity({ activityFrame: activityFrame(activity, start + 5000, graph) }, lookup);
  assert.equal(draws.length, 0);
});

test("mounted 2D renderer follows the activation path without replacing graph, selection, or camera", (t) => {
  const operations = [];
  const stack = [];
  const context = new Proxy({ globalAlpha: 1 }, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === "save") return () => stack.push({ ...target });
      if (key === "restore") return () => { for (const k of Object.keys(target)) delete target[k]; Object.assign(target, stack.pop()); };
      if (String(key).startsWith("create")) return () => ({ addColorStop() {} });
      return (...args) => operations.push({ type: key, args, alpha: target.globalAlpha, fill: target.fillStyle, stroke: target.strokeStyle });
    },
  });
  const canvas = { ...fakeElement("canvas"), setAttribute() {}, remove() {}, getContext: (type) => type === "2d" ? context : null };
  const preference = { ...fakeElement(), matches: true };
  let tick;
  let now = start + 2000;
  installGlobals(t, {
    document: { createElement: () => canvas },
    window: { matchMedia: () => preference, devicePixelRatio: 1 },
    ResizeObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: (fn) => { tick = fn; return 1; },
    cancelAnimationFrame() {},
  });
  t.mock.method(Date, "now", () => now);
  const wrap = {
    ...fakeElement(), insertBefore() {}, querySelector: () => null,
    getBoundingClientRect: () => ({ width: 800, height: 600 }),
  };
  const map = mountGraphCanvas(wrap, {});
  map.setGraph(nodes, [...graphEdges,
    { id: "bc", source: "b", target: "c", kind: "relates" },
    { id: "ac", source: "a", target: "c", kind: "relates" },
  ]);
  map.setSelected("c");
  map.setQuery("c");
  const frame = () => { operations.length = 0; tick(performance.now()); return [...operations]; };
  frame();
  const before = frame().filter((op) => op.type === "arc").map((op) => op.args.slice(0, 2));
  const clusters = map.clusters();
  map.setActivity({ ...activity, nodes: [
    ...activity.nodes, { id: "c", accessedAt: start + 1500, expiresAt: start + 6500 },
  ] });
  frame();
  now += 120;
  assert.equal(frame().filter((op) => op.type === "fill" && op.fill === "#efffff").length, 1);
  now += ACTIVITY_SPACING_MS - 120;
  frame();
  now += 120;
  const live = frame();
  assert.equal(live.filter((op) => op.type === "fill" && op.fill === "#efffff").length, 2);
  assert.ok(live.some((op) => op.type === "stroke" && op.stroke === "rgba(140,235,225,0.75)"));
  now = start + 2000 + 2 * ACTIVITY_SPACING_MS;
  frame();
  now += 120;
  const path = frame();
  assert.equal(path.filter((op) => op.type === "fill" && op.fill === "#efffff").length, 3);
  assert.equal(path.filter((op) => op.type === "stroke" && op.stroke === "rgba(140,235,225,0.75)").length, 2);
  now = start + 7000;
  assert.equal(frame().filter((op) => op.type === "stroke" && op.stroke === "rgba(140,235,225,0.75)").length, 1);
  now = start + 7000 + ACTIVITY_SPACING_MS;
  assert.ok(!frame().some((op) => op.type === "stroke" && op.stroke === "rgba(140,235,225,0.75)"));
  now = start + 7000 + 2 * ACTIVITY_SPACING_MS;
  const after = frame();
  assert.equal(after.filter((op) => op.type === "fill" && op.fill === "#efffff").length, 0);
  assert.deepEqual(after.filter((op) => op.type === "arc").map((op) => op.args.slice(0, 2)), before);
  assert.deepEqual(map.clusters(), clusters);
  assert.equal(map.focusCluster(), null);
  map.destroy();
});

test("WebGL fallback uses paced playback but never paces a supplied activity frame twice", (t) => {
  const renderer = Object.create(GraphGL.prototype);
  renderer.gl = { viewport() {}, clearColor() {}, clear() {}, blendFunc() {} };
  renderer.drawQuad = () => {};
  renderer.drawCore = () => {};
  renderer.drawNodeCores = () => {};
  renderer.packEdges = () => 0;
  renderer.packNodes = () => 0;
  let overlay;
  renderer.drawActivity = (frame) => { overlay = frame.activityFrame; };
  let now = start + 2000;
  t.mock.method(Date, "now", () => now);
  const frame = {
    nodes,
    edges: [...graphEdges, { id: "bc", source: "b", target: "c" }, { id: "ac", source: "a", target: "c" }],
    activity: { ...activity, nodes: [
      ...activity.nodes, { id: "c", accessedAt: start + 1500, expiresAt: start + 6500 },
    ] },
    bg: [], query: "", w: 800, h: 600,
  };
  renderer.draw(frame);
  now += 120;
  renderer.draw(frame);
  assert.deepEqual([...overlay.nodes.keys()], ["a"]);
  now += ACTIVITY_SPACING_MS - 120;
  renderer.draw(frame);
  now += 120;
  renderer.draw(frame);
  assert.deepEqual([...overlay.nodes.keys()], ["a", "b"]);
  now = start + 2000 + 2 * ACTIVITY_SPACING_MS;
  renderer.draw(frame);
  now += 120;
  renderer.draw(frame);
  assert.deepEqual(overlay.edges.map(({ source, target }) => [source, target]), [["a", "b"], ["b", "c"]]);
  const supplied = activityFrame(activity, now, graph);
  renderer.draw({ ...frame, activityFrame: supplied });
  assert.equal(overlay, supplied);
});

const graphChange = (revision, created = [], deleted = [], occurredAt = start, origin = "filesystem") => ({
  revision, created, deleted, occurredAt, origin, durationMs: 2000,
});
const isLifecycleFill = (op, deleted = false) => op.type === "fill" && op.fill === (deleted ? "rgb(255,61,77)" : "rgb(64,255,107)");

function lifecycleCanvasFixture(t, reduce = true, options = {}) {
  let map;
  t.after(() => map?.destroy());
  const operations = [];
  const stack = [];
  let point;
  const context = new Proxy({ globalAlpha: 1 }, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === "save") return () => stack.push({ ...target });
      if (key === "restore") return () => { for (const k of Object.keys(target)) delete target[k]; Object.assign(target, stack.pop()); };
      if (String(key).startsWith("create")) return () => ({ addColorStop() {} });
      return (...args) => {
        if (key === "arc") point = args.slice(0, 2);
        operations.push({ type: key, args, point, alpha: target.globalAlpha, fill: target.fillStyle, stroke: target.strokeStyle });
      };
    },
  });
  const canvas = { ...fakeElement("canvas"), setAttribute() {}, remove() {}, getContext: (type) => type === "2d" ? context : null };
  const preference = { ...fakeElement(), matches: reduce };
  let tick;
  let now = start;
  installGlobals(t, {
    document: { createElement: () => canvas },
    window: { matchMedia: () => preference, devicePixelRatio: 1 },
    ResizeObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: (fn) => { tick = fn; return 1; },
    cancelAnimationFrame() {},
  });
  t.mock.method(Date, "now", () => now);
  const zoom = fakeElement();
  const wrap = {
    ...fakeElement(), insertBefore() {}, querySelector: (selector) => selector === "[data-zoom]" ? zoom : null,
    getBoundingClientRect: () => ({ width: 800, height: 600, left: 0, top: 0 }),
  };
  const selected = [];
  map = mountGraphCanvas(wrap, { ...options, onSelect: (id) => selected.push(id) });
  const frame = (time = performance.now()) => { operations.length = 0; tick(time); return [...operations]; };
  const pointer = (type, [x, y]) => wrap.fire(type, {
    target: { closest: () => null }, button: 0, pointerId: 1, pointerType: "mouse",
    clientX: x, clientY: y, preventDefault() {},
  });
  return { map, frame, pointer, selected, preference, zoom, wrap, clock: (value) => { now = value; } };
}

test("mounted camera follows read activity, expands for many nodes and restores after expiry", (t) => {
  const { map, frame, clock, zoom } = lifecycleCanvasFixture(t, false);
  const spread = Array.from({ length: 40 }, (_, i) => ({
    ...nodes[0], id: `node-${i}`, title: `Node ${i}`, kind: ["work", "experience", "decision", "index"][i % 4],
  }));
  const began = performance.now();
  const advance = (from, to) => {
    for (let ms = from; ms <= to; ms += 20) { clock(start + ms); frame(began + ms); }
  };
  map.setGraph(spread, []);
  advance(0, 8000);
  map.setActivity({ enabled: true, durationMs: 5000, nodes: [{ id: spread[0].id, accessedAt: start + 8000, expiresAt: start + 13000 }] });
  advance(8020, 10000);
  assert.ok(parseInt(zoom.textContent) >= 290);
  map.setActivity({ enabled: true, durationMs: 5000, nodes: spread.map(n => ({
    id: n.id, accessedAt: start + 10000, expiresAt: start + 15000,
  })) });
  advance(10020, 16000);
  assert.ok(parseInt(zoom.textContent) < 299, "A spread of changing nodes should zoom out");
  advance(16020, 26000);
  assert.equal(zoom.textContent, "100%");
});

test("mounted camera frames relationship-only changes even with read monitoring off", (t) => {
  const { map, frame, clock, zoom } = lifecycleCanvasFixture(t, false);
  const began = performance.now();
  map.setGraph(nodes, [], "layers", graphChange(0, [], [], start, "mount"));
  for (let ms = 0; ms <= 8000; ms += 20) { clock(start + ms); frame(began + ms); }
  map.setActivity({ enabled: false, nodes: [] });
  map.setGraph(nodes, graphEdges, "layers", {
    ...graphChange(1, [], [], start + 8000), createdEdges: graphEdges,
  });
  for (let ms = 8020; ms <= 9500; ms += 20) { clock(start + ms); frame(began + ms); }
  assert.notEqual(zoom.textContent, "100%");
  map.setAutoFocus(false);
  const stopped = zoom.textContent;
  for (let ms = 9520; ms <= 13000; ms += 20) { clock(start + ms); frame(began + ms); }
  assert.equal(zoom.textContent, stopped, "Disabling does not restore the old zoom");
});

test("mounted camera yields to wheel input and selected nodes, with reduced-motion opt-out", (t) => {
  const { map, frame, clock, zoom, wrap, preference } = lifecycleCanvasFixture(t, false);
  const began = performance.now();
  const advance = (from, to) => {
    for (let ms = from; ms <= to; ms += 20) { clock(start + ms); frame(began + ms); }
  };
  map.setGraph(nodes, graphEdges);
  map.setActivity({ enabled: true, durationMs: 30000, nodes: [{ id: "a", accessedAt: start, expiresAt: start + 30000 }] });
  advance(0, 2000);
  assert.ok(parseInt(zoom.textContent) >= 290);
  wrap.fire("wheel", { preventDefault() {}, deltaY: 1, clientX: 400, clientY: 300 });
  const manual = zoom.textContent;
  advance(2020, 6000);
  assert.equal(zoom.textContent, manual);
  advance(6020, 9000);
  assert.ok(parseInt(zoom.textContent) >= 290);
  map.setSelected("b");
  wrap.fire("wheel", { preventDefault() {}, deltaY: 1, clientX: 400, clientY: 300 });
  const selectedZoom = zoom.textContent;
  advance(9020, 15000);
  assert.equal(zoom.textContent, selectedZoom);
  map.setSelected(null);
  preference.fire("change", { matches: true });
  advance(15020, 22000);
  assert.equal(zoom.textContent, selectedZoom);
});

test("mounted camera keeps framing during a captured manual orbit and preserves its angle afterward", (t) => {
  const samples = [];
  const move = ActivityCamera.prototype.move;
  t.mock.method(ActivityCamera.prototype, "move", function(cam, target, dt, options) {
    move.call(this, cam, target, dt, options);
    samples.push({ ...cam, target: { ...target }, orbiting: options.orbiting });
  });
  const { map, frame, clock, pointer, wrap, selected } = lifecycleCanvasFixture(t, false);
  const spread = Array.from({ length: 40 }, (_, i) => ({
    ...nodes[0], id: `node-${i}`, title: `Node ${i}`, kind: ["work", "experience", "decision", "index"][i % 4],
  }));
  let capture;
  wrap.setPointerCapture = (id) => { capture = id; };
  wrap.hasPointerCapture = (id) => capture === id;
  wrap.releasePointerCapture = () => { capture = null; };
  const began = performance.now();
  const advance = (from, to) => {
    for (let ms = from; ms <= to; ms += 20) { clock(start + ms); frame(began + ms); }
  };
  map.setGraph(spread, []);
  map.setActivity({ enabled: true, durationMs: 30000, nodes: [{
    id: spread[0].id, accessedAt: start, expiresAt: start + 30000,
  }] });
  advance(0, 4000);
  const before = samples.at(-1);
  pointer("pointerdown", [0, 0]);
  assert.equal(capture, 1);
  pointer("pointermove", [100, 0]);
  const manuallyRotatedYaw = before.yaw + 1.4;
  map.setActivity({ enabled: true, durationMs: 30000, nodes: spread.map(n => ({
    id: n.id, accessedAt: start + 4000, expiresAt: start + 34000,
  })) });
  samples.length = 0;
  advance(4020, 6000);
  assert.equal(samples.length, 100, "Framing must not pause while the pointer is held");
  assert.ok(samples.every(s => s.orbiting && Math.abs(s.yaw - manuallyRotatedYaw) < 1e-9));
  assert.ok(samples.at(-1).k < before.k - 0.1, "The wider active set must still zoom out during rotation");
  pointer("pointerup", [100, 0]);
  assert.equal(capture, null);
  advance(6020, 10800);
  assert.ok(Math.abs(samples.at(-1).yaw - manuallyRotatedYaw) < 1e-9);
  assert.deepEqual(selected, [], "Orbiting must not turn into a node selection");
});

test("mounted Canvas draws real births and noninteractive old-position ghosts without replaying edits", (t) => {
  const { map, frame, pointer, selected, clock } = lifecycleCanvasFixture(t);
  map.setGraph(nodes.slice(0, 2), graphEdges, "layers", graphChange(0, [], [], start, "mount"));
  const initial = frame();
  assert.equal(initial.filter((op) => isLifecycleFill(op) || isLifecycleFill(op, true)).length, 0);
  const oldPosition = initial.find((op) => op.type === "fill" && op.fill === "#e8f2ff").point;
  pointer("pointerdown", oldPosition);
  const changes = graphChange(1, [nodes[2]], [nodes[0]]);
  map.setGraph(nodes.slice(1), [], "layers", changes);
  map.setQuery("b");
  map.setActivity({ enabled: false, nodes: [] });
  const live = frame();
  assert.equal(live.filter((op) => isLifecycleFill(op)).length, 1);
  const ghost = live.filter((op) => isLifecycleFill(op, true));
  assert.equal(ghost.length, 1);
  assert.deepEqual(ghost[0].point, oldPosition);
  assert.equal(map.clusters().reduce((count, cluster) => count + cluster.count, 0), 2);
  pointer("pointerup", oldPosition);
  pointer("pointerdown", oldPosition);
  pointer("pointerup", oldPosition);
  assert.ok(!selected.includes("a"));
  map.setGraph(nodes.slice(1), [], "layers", changes);
  clock(start + 1000);
  map.setGraph(nodes.slice(1), [], "layers", graphChange(2));
  map.setGraph(nodes.slice(1), [], "layers", graphChange(3));
  clock(start + 1999);
  assert.equal(frame().filter((op) => isLifecycleFill(op, true)).length, 1);
  clock(start + 2000);
  assert.equal(frame().filter((op) => isLifecycleFill(op) || isLifecycleFill(op, true)).length, 0);
  map.setGraph(nodes.slice(1), [], "layers", changes);
  assert.equal(frame().filter((op) => isLifecycleFill(op) || isLifecycleFill(op, true)).length, 0);
});

test("mounted Canvas prunes hidden ghosts and cancels lifecycle on unchanged mount and graph drop", (t) => {
  const { map, frame, clock } = lifecycleCanvasFixture(t);
  map.setGraph(nodes.slice(0, 2), [], "layers", graphChange(0, [], [], start, "mount"));
  frame();
  const changes = graphChange(1, [nodes[2]], [nodes[0]]);
  map.setGraph(nodes.slice(1), [], "layers", changes);
  assert.equal(frame().filter((op) => isLifecycleFill(op, true)).length, 1);
  map.setGraph(nodes.slice(1), [], "layers", changes, (node) => node.id !== "a");
  assert.equal(frame().filter((op) => isLifecycleFill(op, true)).length, 0);
  assert.equal(frame().filter((op) => isLifecycleFill(op)).length, 1);
  map.setGraph(nodes.slice(1), [], "layers", graphChange(2, [], [], start, "mount"));
  assert.equal(frame().filter((op) => isLifecycleFill(op)).length, 0);
  clock(start + 100);
  map.setGraph([], [], "layers", graphChange(3, [], nodes.slice(1), start + 100));
  assert.equal(frame().filter((op) => isLifecycleFill(op, true)).length, 2);
  assert.equal(map.clusters().length, 0);
  map.setGraph([], [], "layers", graphChange(4, [], [], start + 100, "mount"));
  assert.equal(frame().filter((op) => isLifecycleFill(op, true)).length, 0);
});

test("mounted Canvas changes reduced motion live and expires even when simulation time is frozen", (t) => {
  const { map, frame, clock, preference } = lifecycleCanvasFixture(t, false);
  map.setGraph(nodes.slice(0, 2), [], "layers", graphChange(0, [], [], start, "mount"));
  frame();
  map.setGraph(nodes.slice(1), [], "layers", graphChange(1, [nodes[2]], [nodes[0]]));
  clock(start + 500);
  assert.equal(frame().filter((op) => isLifecycleFill(op, true)).length, 1);
  preference.fire("change", { matches: true });
  const reduced = frame().filter((op) => isLifecycleFill(op, true));
  assert.equal(reduced.length, 1);
  assert.equal(reduced[0].alpha, 0.85);
  clock(start + 1999);
  assert.equal(frame().find((op) => isLifecycleFill(op, true)).alpha, 0.85);
  clock(start + 2000);
  assert.equal(frame().filter((op) => isLifecycleFill(op) || isLifecycleFill(op, true)).length, 0);
});

test("mounted Canvas removes deleted read-path nodes immediately but never enqueues births", (t) => {
  const { map, frame, clock } = lifecycleCanvasFixture(t);
  map.setGraph(nodes.slice(0, 2), graphEdges, "layers", graphChange(0, [], [], start, "mount"));
  map.setSelected("b");
  map.setQuery("b");
  map.setActivity({ ...activity, nodes: activity.nodes.map((node) => ({ ...node, accessedAt: start, expiresAt: start + 5000 })) });
  frame();
  clock(start + 400);
  frame();
  clock(start + 520);
  const path = frame();
  assert.equal(path.filter((op) => op.type === "fill" && op.fill === "#efffff").length, 2);
  assert.equal(path.filter((op) => op.type === "stroke" && op.stroke === "rgba(140,235,225,0.75)").length, 1);
  map.setGraph(nodes.slice(1), [], "layers", graphChange(1, [nodes[2]], [nodes[0]], start + 520));
  const deleted = frame();
  assert.equal(deleted.filter((op) => op.type === "fill" && op.fill === "#efffff").length, 1);
  assert.equal(deleted.filter((op) => op.type === "stroke" && op.stroke === "rgba(140,235,225,0.75)").length, 0);
  assert.equal(deleted.filter((op) => isLifecycleFill(op)).length, 1);
  assert.equal(deleted.filter((op) => isLifecycleFill(op, true)).length, 1);
  map.setActivity({ enabled: false, nodes: [] });
  const readOff = frame();
  assert.equal(readOff.filter((op) => op.type === "fill" && op.fill === "#efffff").length, 0);
  assert.equal(readOff.filter((op) => isLifecycleFill(op)).length, 1);
  assert.equal(readOff.filter((op) => isLifecycleFill(op, true)).length, 1);
  assert.ok(readOff.some((op) => op.type === "fill" && op.fill === "#f4fbff"));
  assert.ok(!readOff.some((op) => op.type === "fillText" && op.args[0] === "c"));
});

test("WebGL fallback consumes deltas once, snapshots old projected positions, and honors supplied lifecycle frames", (t) => {
  const renderer = Object.create(GraphGL.prototype);
  renderer.gl = { viewport() {}, clearColor() {}, clear() {}, blendFunc() {} };
  renderer.drawQuad = () => {};
  renderer.drawCore = () => {};
  renderer.drawNodeCores = () => {};
  let drawn;
  let liveNodes;
  renderer.packEdges = () => 0;
  renderer.packNodes = (frame) => { liveNodes = frame.nodes; return 0; };
  renderer.drawActivity = () => {};
  renderer.drawLifecycleEdges = () => {};
  renderer.drawLifecycle = (frame) => { drawn = frame; };
  let now = start;
  t.mock.method(Date, "now", () => now);
  const first = nodes.slice(0, 2).map((node) => ({ ...node }));
  const frame = { nodes: first, edges: graphEdges, bg: [], query: "", w: 800, h: 600, reduce: true, graphChanges: graphChange(0, [], [], start, "mount") };
  renderer.draw(frame);
  assert.deepEqual(drawn, { births: new Map(), ghosts: [], edges: new Map(), edgeGhosts: [] });
  const oldX = first[0].sx;
  first[0].sx = 812;
  const next = { ...frame, nodes: nodes.slice(1), edges: [], graphChanges: {
    ...graphChange(1, [nodes[2]], [nodes[0]]), deletedEdges: graphEdges,
  } };
  renderer.draw(next);
  assert.equal(drawn.ghosts[0].node.sx, oldX);
  assert.equal(drawn.edgeGhosts[0].target.sx, oldX);
  assert.equal(drawn.edgeGhosts[0].edge.id, graphEdges[0].id);
  assert.deepEqual([...drawn.births.keys()], ["c"]);
  assert.deepEqual(liveNodes.map((node) => node.id), ["b", "c"]);
  assert.equal(renderer.playback.graph.nodes.has("a"), false);
  now = start + 1999;
  renderer.draw(next);
  assert.equal(drawn.ghosts.length, 1);
  now = start + 2000;
  renderer.draw(next);
  assert.deepEqual(drawn, { births: new Map(), ghosts: [], edges: new Map(), edgeGhosts: [] });
  const external = new GraphLifecycle({ now: () => now });
  external.setGraph(nodes, graphChange(0, [], [], now, "mount"));
  external.setGraph(nodes.slice(1), graphChange(1, [], [nodes[0]], now), nodes);
  const supplied = external.frame(now, true);
  renderer.draw({ ...next, lifecycleFrame: supplied });
  assert.equal(drawn, supplied);
  renderer.draw({ ...next, nodes: [], graphChanges: graphChange(2, [], [], now, "mount") });
  assert.deepEqual(drawn, { births: new Map(), ghosts: [], edges: new Map(), edgeGhosts: [] });
});

test("mounted Canvas fades the entire new node and its connected ray, then fades its deletion marker", (t) => {
  const { map, frame, clock } = lifecycleCanvasFixture(t, false);
  map.setGraph(nodes.slice(0, 2), [], "layers", graphChange(0, [], [], start, "mount"));
  frame();
  const created = { ...nodes[2], kind: "decision" };
  map.setGraph([...nodes.slice(0, 2), created], [{ id: "bc", source: "b", target: "c", kind: "relates" }],
    "layers", graphChange(1, [created]));
  const star = (ops) => ops.find((op) => op.type === "fill" && op.fill === "#8ec8c0");
  const label = (ops) => ops.find((op) => op.type === "fillText" && op.args[0] === created.title);
  const ray = (ops) => ops.find((op) => op.type === "stroke" && String(op.stroke).startsWith("rgba(150, 200, 255"));
  const initial = frame();
  assert.equal(star(initial).alpha, 0);
  assert.equal(label(initial).alpha, 0);
  assert.equal(ray(initial).alpha, 0);
  clock(start + 1000);
  const halfway = frame();
  const nodeAlpha = star(halfway).alpha;
  assert.ok(nodeAlpha > 0 && nodeAlpha <= 0.5);
  assert.equal(label(halfway).alpha, 0.5);
  assert.equal(ray(halfway).alpha, 0.5);
  clock(start + 2000);
  const settled = frame();
  assert.ok(star(settled).alpha > nodeAlpha);
  assert.equal(label(settled).alpha, 1);
  map.setGraph(nodes.slice(0, 2), [], "layers", graphChange(2, [], [created], start + 2000));
  assert.equal(frame().find((op) => isLifecycleFill(op, true)).alpha, 1);
  clock(start + 3000);
  const deletion = frame();
  assert.equal(deletion.find((op) => isLifecycleFill(op, true)).alpha, 0.5);
  assert.equal(label(deletion).alpha, 0.5);
  clock(start + 4000);
  const removed = frame();
  assert.equal(removed.filter((op) => isLifecycleFill(op, true)).length, 0);
  assert.equal(label(removed), undefined);
});

test("mounted Canvas glows only newly created relationships without inventing read pulses", (t) => {
  const { map, frame, clock } = lifecycleCanvasFixture(t, false);
  const edge = { id: "bc", source: "b", target: "c", kind: "relates" };
  const glows = (ops) => ops.filter((op) => op.type === "stroke" && op.stroke === "rgb(64,255,107)");
  map.setGraph(nodes, graphEdges, "layers", graphChange(0, [], [], start, "mount"));
  assert.equal(glows(frame()).length, 0);
  const change = { ...graphChange(1), createdEdges: [edge] };
  map.setGraph(nodes, [...graphEdges, edge], "layers", change);
  assert.ok(glows(frame()).every((op) => op.alpha === 0));
  clock(start + 1000);
  const bright = frame();
  assert.deepEqual(glows(bright).map((op) => op.alpha), [0.1, 0.25, 0.9]);
  assert.ok(!bright.some((op) => op.type === "stroke" && op.stroke === "rgba(140,235,225,0.75)"));
  map.setGraph(nodes, [...graphEdges, edge], "layers", change);
  clock(start + 2000);
  assert.equal(glows(frame()).length, 0);
  map.setGraph(nodes, [...graphEdges, edge], "layers", { ...graphChange(2, [], [], start + 2000), createdEdges: [edge] });
  clock(start + 2500);
  assert.ok(glows(frame()).some((op) => op.alpha > 0));
  map.setGraph(nodes, graphEdges, "layers", graphChange(3, [], [], start + 2500));
  assert.equal(glows(frame()).length, 0);
});

test("mounted Canvas fades removed relationships red without keeping read-path connections alive", (t) => {
  const { map, frame, clock } = lifecycleCanvasFixture(t, false);
  const edge = graphEdges[0];
  const glows = (ops) => ops.filter((op) => op.type === "stroke" && op.stroke === "rgb(255,61,77)");
  map.setGraph(nodes, graphEdges, "layers", graphChange(0, [], [], start, "mount"));
  map.setActivity({ ...activity, nodes: activity.nodes.map((node) => ({ ...node, accessedAt: start })) });
  frame();
  clock(start + 1000);
  frame();
  const change = { ...graphChange(1, [], [], start + 1000), deletedEdges: [edge] };
  map.setGraph(nodes, [], "layers", change);
  assert.deepEqual(glows(frame()).map((op) => op.alpha), [0.1, 0.25, 0.9]);
  clock(start + 2000);
  const halfway = frame();
  assert.deepEqual(glows(halfway).map((op) => op.alpha), [0.05, 0.125, 0.45]);
  assert.ok(!halfway.some((op) => op.type === "stroke" && op.stroke === "rgba(140,235,225,0.75)"));
  clock(start + 3000);
  assert.equal(glows(frame()).length, 0);
});

test("mounted Canvas keeps deleted endpoint geometry outside picking and hides filtered edge ghosts", (t) => {
  const { map, frame, clock, pointer, selected } = lifecycleCanvasFixture(t, false);
  const glows = (ops) => ops.filter((op) => op.type === "stroke" && op.stroke === "rgb(255,61,77)");
  map.setGraph(nodes, graphEdges, "layers", graphChange(0, [], [], start, "mount"));
  frame();
  const change = { ...graphChange(1, [], nodes), deletedEdges: graphEdges };
  map.setGraph([], [], "layers", change);
  const removed = frame();
  assert.equal(glows(removed).length, 3);
  const position = removed.find((op) => isLifecycleFill(op, true)).point;
  pointer("pointerdown", position); pointer("pointerup", position);
  assert.ok(selected.every((id) => id == null));
  map.setGraph([], [], "layers", change, () => true, () => false);
  assert.equal(glows(frame()).length, 0);
  map.setGraph([], [], "layers", change);
  assert.equal(glows(frame()).length, 0);
  clock(start + 2000);
  assert.equal(frame().filter((op) => isLifecycleFill(op, true)).length, 0);
});

test("playback controls show pressure, lag, counts and honest loss status without rebuilding unchanged lists", (t) => {
  const { controls, get } = controlsFixture(t);
  const stats = {
    pendingCount: 50, oldestPendingMs: 6400, spacingMs: 50,
    aggregatedCount: 123, cancelledCount: 2,
    repeatedNodes: [{ id: "a", label: "<unsafe>", count: 100 }],
    repeatedEdges: [{ id: "ab", label: "A -> B", count: 3 }],
  };
  controls.setPlayback(stats);
  assert.equal(get("activity-playback-status").dataset.status, "overloaded");
  assert.match(get("activity-playback-status").textContent, /50 queued.*6.4s lag.*50 ms/);
  assert.match(get("activity-playback-detail").textContent, /123 observations merged; 2 pending observations cancelled/);
  assert.match(get("activity-playback-detail").textContent, /Capture loss is unknown/);
  assert.equal(get("activity-repeat-counts").children[0].textContent, "<unsafe>: 100 observations");
  assert.equal(get("activity-repeat-counts").children[1].textContent, "3 traversals; latest direction: A -> B");
  const replacements = get("activity-repeat-counts").replacements;
  controls.setPlayback({ ...stats, oldestPendingMs: 6600 });
  assert.equal(get("activity-repeat-counts").replacements, replacements);
  controls.setActivity({ ...activity, enabled: false });
  assert.equal(get("activity-playback-status").textContent, "400 ms");
  assert.equal(get("activity-repeat-counts").children.length, 0);
  assert.equal(playbackStatus({ pendingCount: 7, oldestPendingMs: 10, spacingMs: 250 }).status, "catching-up");
  assert.equal(playbackStatus({ pendingCount: 1, oldestPendingMs: 2200, spacingMs: 100 }).status, "catching-up");
  assert.equal(playbackStatus().status, "normal");
});

test("mounted Canvas shows aggregated node counts and limits playback status updates", (t) => {
  const updates = [];
  const { map, frame, clock } = lifecycleCanvasFixture(t, true, { onPlayback: (stats) => updates.push(stats) });
  map.setGraph(nodes, graphEdges);
  map.setActivity({ ...activity, nodes: [
    { id: "c", accessedAt: start, expiresAt: start + 5000, sequence: 3, firstSequence: 1, count: 3 },
  ] });
  frame();
  assert.equal(updates.length, 1);
  clock(start + 100);
  frame();
  assert.equal(updates.length, 1);
  clock(start + 200);
  const rendered = frame();
  assert.equal(updates.length, 2);
  assert.equal(updates[1].aggregatedCount, 2);
  assert.equal(updates[1].repeatedNodes[0].count, 3);
  assert.ok(rendered.some((op) => op.type === "fillText" && op.args[0] === "c x3"));
});

test("WebGL exposes the same aggregation counts and throttled status without changing full highlight lifetimes", (t) => {
  const renderer = Object.create(GraphGL.prototype);
  renderer.gl = { viewport() {}, clearColor() {}, clear() {}, blendFunc() {} };
  renderer.drawQuad = () => {};
  renderer.drawCore = () => {};
  renderer.drawNodeCores = () => {};
  renderer.packEdges = () => 0;
  renderer.packNodes = () => 0;
  renderer.drawActivity = () => {};
  let now = start;
  t.mock.method(Date, "now", () => now);
  const updates = [];
  const frame = {
    nodes, edges: graphEdges, bg: [], query: "", w: 800, h: 600,
    onPlayback: (stats) => updates.push(stats),
    activity: { ...activity, nodes: [
      { id: "c", accessedAt: start, expiresAt: start + 5000, sequence: 3, firstSequence: 1, count: 3 },
    ] },
  };
  renderer.draw(frame);
  now += 100;
  renderer.draw(frame);
  assert.equal(updates.length, 1);
  now += 100;
  renderer.draw(frame);
  assert.equal(updates.length, 2);
  assert.equal(updates[1].aggregatedCount, 2);
  assert.equal(updates[1].repeatedNodes[0].count, 3);
  assert.equal(renderer.playback.active.get("c").expiresAt, start + 5000);
});
