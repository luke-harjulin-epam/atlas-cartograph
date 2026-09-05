import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { allNodeLayersOn, applyLayerClick, createLayerControls } from "../.apm/extensions/cartograph/public/layer-controls.js";
import { createStateControls } from "../.apm/extensions/cartograph/public/state-controls.js";
import { handleContentClick } from "../.apm/extensions/cartograph/public/content-navigation.js";
import { mountNodeBrowser } from "../.apm/extensions/cartograph/public/node-browser.js";
import { escapeHtml, renderMarkdown } from "../.apm/extensions/cartograph/public/markdown.js";
import { FrontendEvent, frontendDocument } from "./helpers/frontend-dom.mjs";

const html = readFileSync(new URL("../.apm/extensions/cartograph/public/index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../.apm/extensions/cartograph/public/app.js", import.meta.url), "utf8");
const all = Object.fromEntries(["experiences", "decisions", "work", "indexes", "other", "relations", "sources"].map((key) => [key, true]));
const settle = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function controlsFixture(layersRevision = 0) {
  const calls = [];
  const changes = [];
  const controls = createLayerControls((layers) => {
    const request = deferred();
    calls.push({ layers, ...request });
    return request.promise;
  }, (layers, status) => changes.push({ layers, ...status }));
  controls.snapshot(all, layersRevision);
  return { controls, calls, changes };
}

function appFixture({ reducedMotion = false, phase = "map" } = {}) {
  const document = frontendDocument(html);
  const calls = [];
  const opened = [];
  const queries = [];
  const graphs = [];
  const streams = [];
  const timers = [];
  const activities = [];
  const activityStatuses = [];
  const frames = new Map();
  const drawings = new Map();
  const motionListeners = new Set();
  const motion = {
    matches: reducedMotion,
    addEventListener(type, listener) { if (type === "change") motionListeners.add(listener); },
    removeEventListener(type, listener) { if (type === "change") motionListeners.delete(listener); },
  };
  let clock = 0;
  let frameId = 0;
  for (const canvas of document.querySelectorAll("canvas")) {
    canvas.clientWidth = 800;
    canvas.clientHeight = 600;
    const drawing = { frames: 0, arcs: [] };
    drawings.set(canvas.id, drawing);
    canvas.getContext = () => ({
      setTransform() { drawing.frames++; },
      fillRect() {}, save() {}, restore() {}, beginPath() {}, fill() {},
      moveTo() {}, lineTo() {}, stroke() {},
      arc(...args) { drawing.arcs.push(args); },
      createRadialGradient: () => ({ addColorStop() {} }),
      createLinearGradient: () => ({ addColorStop() {} }),
    });
  }
  const bootstrap = deferred();
  const context = vm.createContext({
    document, allNodeLayersOn, createLayerControls, createStateControls, handleContentClick, mountNodeBrowser, escapeHtml, renderMarkdown,
    window: { matchMedia: () => motion, open: (...args) => opened.push(args) },
    performance: { now: () => clock },
    requestAnimationFrame(callback) { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout(callback) { timers.push(callback); return timers.length; }, clearTimeout() {},
    mountActivityControls: () => ({ setActivity(activity) { activityStatuses.push(activity); }, autoFocusEnabled: () => true, setPlayback() {} }),
    mountGraphWatchControls: () => ({ setWatch() {} }),
    mountGraphCanvas: () => ({ setGraph(nodes) { graphs.push(nodes); }, setSelected() {}, setQuery(query) { queries.push(query); }, setActivity(activity) { activities.push(activity); }, clusters: () => [] }),
    EventSource: class {
      constructor() { streams.push(this); this.listeners = new Map(); }
      addEventListener(type, listener) { this.listeners.set(type, listener); }
    },
    fetch: (url, options) => {
      if (url === "/api/bootstrap") return bootstrap.promise;
      const request = deferred();
      if (url === "/api/ui") calls.push({ ...JSON.parse(options.body), ...request });
      return request.promise;
    },
  });
  vm.runInContext(app.replace(/^import .*;\n/gm, ""), context);
  const initial = {
    phase, root: "/atlas", roots: ["/atlas"], layers: all, layersRevision: 0, grouping: "layers",
    query: "", queryRevision: 0,
    graph: { nodes: [{ id: "node", title: "Node", kind: "experience", path: "node.md", storeRoot: "/atlas" }], edges: [], store: {} },
    selectedId: "node", previewOpen: true, page: {
      body: "[[other|Wiki]]\n\n[External](https://example.com)\n\n[Mail](mailto:hello@example.com)",
      relatesTo: [{ path: "related" }], sources: ["source"],
    },
  };
  function apply(next) { return vm.runInContext(`applyState(${JSON.stringify(next)})`, context); }
  apply(initial);
  return {
    document, calls, opened, queries, graphs, timers, bootstrap, apply, activities, activityStatuses,
    frames, drawings, motionListeners,
    frame() {
      clock += 16;
      const queued = [...frames.values()];
      frames.clear();
      for (const callback of queued) callback(clock);
    },
    setReducedMotion(matches) {
      motion.matches = matches;
      for (const listener of [...motionListeners]) listener({ matches });
    },
    applyActivity: (activity) => vm.runInContext(`applyActivity(${JSON.stringify(activity)})`, context),
    receiveActivity: (activity) => streams[0].listeners.get("activity")({ data: JSON.stringify(activity) }),
    receive: (next) => streams[0].onmessage({ data: JSON.stringify(next) }),
    state: () => JSON.parse(vm.runInContext("JSON.stringify(state)", context)),
  };
}

function activity(revision, overrides = {}) {
  return { revision, enabled: true, durationMs: 5000, nodes: [], edges: [],
    collector: { status: "live", message: "Receiving accesses." }, ...overrides };
}

test("newer collector SSE survives delayed full HTTP snapshots without dropping graph updates or errors", async () => {
  const { bootstrap, receiveActivity, apply, state, activities, activityStatuses } = appFixture();
  const old = activity(1, { durationMs: 1000 });
  const latest = activity(2, {
    durationMs: 9000, nodes: [{ id: "node", accessedAt: 10000, expiresAt: 19000, sequence: 1, count: 1, firstSequence: 1 }],
    collector: { status: "error", message: "Collector failed." },
  });
  apply({ stateRevision: 1, activity: old });
  receiveActivity(latest);
  bootstrap.resolve({ ok: true, json: async () => ({ state: {
    stateRevision: 2, activity: old, graph: { nodes: [], edges: [] },
    selectedId: null, previewOpen: false, error: "Graph refresh failed.",
  } }) });
  await settle();
  assert.deepEqual(state().activity, latest);
  assert.equal(state().stateRevision, 2);
  assert.equal(state().graph.nodes.length, 0);
  assert.equal(state().error, "Graph refresh failed.");
  assert.deepEqual(JSON.parse(JSON.stringify(activities.at(-1))), latest);
  assert.deepEqual(JSON.parse(JSON.stringify(activityStatuses.at(-1))), latest);
});

test("activity ordering is independent of state, observation and root revisions across resets", () => {
  const { receiveActivity, applyActivity, apply, state, activities } = appFixture();
  const latest = activity(8, { nodes: [{ id: "node", sequence: 20 }] });
  apply({ stateRevision: 100, activity: latest });
  const rendered = activities.length;
  for (const stale of [activity(7), activity(8), { enabled: false }, null]) {
    assert.equal(applyActivity(stale), false);
  }
  assert.equal(activities.length, rendered, "stale direct/config replies never reach playback");
  assert.deepEqual(state().activity, latest);
  apply({ stateRevision: 101, activity: activity(8, { enabled: false }), grouping: "atlases" });
  assert.deepEqual(state().activity, latest);
  assert.equal(state().grouping, "atlases");
  apply({ stateRevision: 99, activity: activity(1000) });
  assert.deepEqual(state().activity, latest, "rejected full states cannot advance the activity clock");
  const paused = activity(9, { enabled: false });
  receiveActivity(paused);
  assert.deepEqual(state().activity, paused);
  apply({ stateRevision: 102, root: "", roots: [], graph: null, phase: "welcome", activity: activity(10) });
  assert.equal(state().activity.revision, 10);
  const restarted = activity(11, { nodes: [{ id: "other", sequence: 1 }] });
  apply({ stateRevision: 103, root: "/other", roots: ["/other"], phase: "map",
    graph: { nodes: [{ id: "other", kind: "experience", path: "other.md", storeRoot: "/other" }], edges: [] },
    activity: restarted });
  receiveActivity(activity(9, { enabled: false }));
  assert.deepEqual(state().activity, restarted);
  assert.equal(state().root, "/other");
  assert.equal(state().stateRevision, 103);
});

test("reduced-motion intro and welcome draw static skies with no animation frames", () => {
  const { apply, frames, drawings, frame } = appFixture({ reducedMotion: true, phase: "crawl" });
  assert.equal(frames.size, 0);
  assert.equal(drawings.get("crawl-sky").frames, 1);
  frame();
  assert.equal(drawings.get("crawl-sky").frames, 1);
  apply({ phase: "welcome" });
  assert.equal(drawings.get("welcome-sky").frames, 1);
  assert.equal(frames.size, 0);
  apply({ phase: "welcome", error: "No stores" });
  assert.equal(drawings.get("welcome-sky").frames, 1, "ordinary snapshots do not redraw static skies");
  apply({ phase: "jump" });
  assert.equal(drawings.get("jump-sky").frames, 1);
  assert.equal(drawings.get("jump-sky").arcs.length, 420, "reduced jump draws dots rather than warp trails");
  assert.equal(frames.size, 0);
});

test("star animation responds to motion changes and cleans up RAF and media handlers on phase changes", () => {
  const { apply, frames, drawings, motionListeners, setReducedMotion, frame } = appFixture({ phase: "welcome" });
  assert.equal(frames.size, 1, "only the visible phase animates");
  assert.equal(motionListeners.size, 1);
  frame();
  const first = drawings.get("welcome-sky").arcs.slice(-420);
  frame();
  assert.notDeepEqual(drawings.get("welcome-sky").arcs.slice(-420), first, "normal stars continue moving");
  setReducedMotion(true);
  assert.equal(frames.size, 0);
  const staticFrames = drawings.get("welcome-sky").frames;
  frame();
  assert.equal(drawings.get("welcome-sky").frames, staticFrames);
  setReducedMotion(false);
  assert.equal(frames.size, 1);
  apply({ phase: "jump" });
  assert.equal(frames.size, 1, "phase changes replace rather than stack loops");
  assert.equal(motionListeners.size, 1);
  frame();
  assert.equal(drawings.get("welcome-sky").frames, staticFrames);
  assert.equal(drawings.get("jump-sky").frames, 1);
  apply({ phase: "map" });
  assert.equal(frames.size, 0);
  assert.equal(motionListeners.size, 0);
  setReducedMotion(true);
  assert.equal(frames.size, 0);
  apply({ phase: "welcome" });
  assert.equal(drawings.get("welcome-sky").frames, staticFrames + 1);
  assert.equal(frames.size, 0, "a newly visible phase reads the current preference");
  assert.equal(motionListeners.size, 1);
});

test("older bootstrap, action replies and SSE cannot resurrect deleted graph or preview state", async () => {
  const { document, calls, bootstrap, receive, apply, state, graphs, timers } = appFixture();
  apply({ stateRevision: 3, previewOpen: false });
  const old = state();
  document.getElementById("browse-nodes").click();
  document.getElementById("node-list").firstElementChild.firstElementChild.click();
  assert.equal(calls[0].action, "select");
  const latest = {
    ...old, stateRevision: 6, graph: { nodes: [], edges: [], store: {} },
    selectedId: null, previewOpen: false, page: null, chat: [],
    graphChanges: { revision: 2, origin: "filesystem", deleted: old.graph.nodes },
  };
  receive(latest);
  const expected = state();
  const rendered = graphs.length;
  const armed = timers.length;
  const stale = { ...old, phase: "jump", previewOpen: true, stateRevision: 4 };
  calls[0].resolve({ ok: true, json: async () => stale });
  bootstrap.resolve({ ok: true, json: async () => ({ state: { ...stale, stateRevision: 3 } }) });
  await settle();
  receive(stale);
  receive({ ...stale, stateRevision: 6 });
  assert.deepEqual(state(), expected);
  assert.equal(graphs.length, rendered, "discarded snapshots never reach graph reconciliation");
  assert.equal(timers.length, armed, "discarded jump phases never arm transition timers");
  assert.equal(document.getElementById("preview").classList.contains("hidden"), true);
  assert.equal(document.getElementById("node-list").children.length, 0);
  assert.equal(apply({ ...old }), false, "legacy data cannot downgrade an established revisioned stream");
});

test("full-state ordering guards field controllers while newer snapshots preserve pending query/layers", async () => {
  const { document, calls, apply, state } = appFixture();
  apply({ stateRevision: 1 });
  const input = document.getElementById("search");
  input.value = "typing";
  input.dispatchEvent(new FrontendEvent("input"));
  document.querySelector('[data-layer="sources"]').click();
  const layers = state().layers;
  apply({ stateRevision: 3, query: "", queryRevision: 0, layers: all, layersRevision: 0,
    selectedId: null, previewOpen: false, page: null, graph: { nodes: [], edges: [] } });
  assert.equal(state().query, "typing");
  assert.deepEqual(state().layers, layers);
  assert.equal(apply({ stateRevision: 2, query: "stale", queryRevision: 99,
    layers: all, layersRevision: 99 }), false);
  calls[0].resolve({ ok: true, json: async () => ({ query: "typing", queryRevision: 1 }) });
  calls[1].resolve({ ok: true, json: async () => ({ layers, layersRevision: 1 }) });
  await settle();
  assert.equal(state().query, "typing");
  assert.deepEqual(state().layers, layers);
  apply({ stateRevision: 4, query: "external", queryRevision: 2, layers: all, layersRevision: 2 });
  assert.equal(state().query, "external");
  assert.deepEqual(state().layers, all);
  assert.equal(state().graph.nodes.length, 0);
});

test("newer reconnect snapshots apply and arm a jump once; late bootstrap failures retain the live map", async () => {
  const { document, bootstrap, receive, state, timers } = appFixture();
  receive({ stateRevision: 5, phase: "jump" });
  const armed = timers.length;
  receive({ stateRevision: 7, phase: "jump" });
  assert.equal(timers.length, armed);
  receive({ stateRevision: 12, phase: "map" });
  const graph = state().graph;
  bootstrap.reject(new Error("Bootstrap unavailable"));
  await settle();
  assert.equal(state().phase, "map");
  assert.equal(state().stateRevision, 12);
  assert.deepEqual(state().graph, graph);
  assert.match(document.getElementById("map-error").textContent, /Bootstrap unavailable/);
  assert.equal(document.getElementById("map-error").classList.contains("hidden"), false);
  receive({ stateRevision: 13, phase: "map", error: null });
  assert.equal(document.getElementById("map-error").classList.contains("hidden"), true);
});

test("failed bootstrap HTTP responses surface errors without bypassing snapshot ordering", async () => {
  const { document, bootstrap, receive, state } = appFixture();
  receive({ stateRevision: 1, phase: "map" });
  const graph = state().graph;
  bootstrap.resolve({ ok: false, status: 500, json: async () => ({ error: "Cannot load stores" }) });
  await settle();
  assert.equal(state().phase, "map");
  assert.equal(state().stateRevision, 1);
  assert.deepEqual(state().graph, graph);
  assert.match(document.getElementById("map-error").textContent, /Cannot load stores/);
});

test("layer solo, additive, all and relationship semantics are preserved", () => {
  const solo = applyLayerClick(all, "experiences");
  assert.deepEqual(solo, { ...all, decisions: false, work: false, indexes: false, other: false });
  assert.deepEqual(applyLayerClick(solo, "experiences"), solo, "last visible category stays on");
  const added = applyLayerClick(solo, "decisions");
  assert.equal(added.decisions, true);
  assert.equal(added.experiences, true);
  assert.equal(allNodeLayersOn(added), false);
  const noRelations = applyLayerClick(added, "relations");
  assert.equal(noRelations.relations, false);
  assert.deepEqual(applyLayerClick(noRelations, "all"), { ...all, relations: false });
});

test("All remains inactive until the other node layer is restored", () => {
  let layers = applyLayerClick(all, "experiences");
  for (const key of ["decisions", "work", "indexes"]) layers = applyLayerClick(layers, key);
  assert.equal(layers.other, false);
  assert.equal(allNodeLayersOn(layers), false);
  const { document, apply } = appFixture();
  apply({ layers, layersRevision: 1 });
  assert.equal(document.querySelector('[data-layer="all"]').getAttribute("aria-pressed"), "false");
  layers = applyLayerClick(layers, "all");
  assert.equal(layers.other, true);
  assert.equal(allNodeLayersOn(layers), true);
  apply({ layers, layersRevision: 2 });
  assert.equal(document.querySelector('[data-layer="all"]').getAttribute("aria-pressed"), "true");
  assert.equal(allNodeLayersOn({ ...all, sources: false, relations: false }), true);
});

test("rapid search typing coalesces requests and keeps input, caret and map on latest intent", async () => {
  const { document, calls, queries, apply, state } = appFixture();
  const input = document.getElementById("search");
  let value = input.value;
  let writes = 0;
  Object.defineProperty(input, "value", {
    get: () => value,
    set: (next) => { value = next; writes++; input.selectionStart = next.length; },
  });
  for (const query of ["n", "no", "node"]) {
    input.value = query;
    input.dispatchEvent(new FrontendEvent("input"));
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0].query, "n");
  assert.equal(state().query, "node");
  assert.equal(queries.at(-1), "node");
  assert.equal(input.getAttribute("aria-busy"), "true");
  input.selectionStart = 2;
  writes = 0;
  apply({ query: "", queryRevision: 0, grouping: "atlases" });
  calls[0].resolve({ ok: true, json: async () => ({ query: "n", queryRevision: 1 }) });
  await settle();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].query, "node");
  apply({ query: "n", queryRevision: 1, selectedId: null });
  assert.equal(input.value, "node");
  calls[1].resolve({ ok: true, json: async () => ({ query: "node", queryRevision: 2 }) });
  await settle();
  apply({ query: "n", queryRevision: 1 });
  assert.equal(state().query, "node");
  assert.equal(state().queryRevision, 2);
  assert.equal(state().grouping, "atlases");
  assert.equal(state().selectedId, null);
  assert.equal(queries.at(-1), "node");
  assert.equal(writes, 0, "interim snapshots must not rewrite the edited input");
  assert.equal(input.selectionStart, 2);
  assert.equal(input.getAttribute("aria-busy"), "false");
  apply({ query: "remote", queryRevision: 3 });
  assert.equal(input.value, "remote", "later external changes are still accepted");
  assert.equal(queries.at(-1), "remote");
});

test("query failure rolls back visibly and clearing the search remains a valid edit", async () => {
  const { document, calls, queries, apply, state } = appFixture();
  const input = document.getElementById("search");
  const type = (query) => { input.value = query; input.dispatchEvent(new FrontendEvent("input")); };
  apply({ query: "confirmed", queryRevision: 1 });
  type("failed");
  calls[0].resolve({ ok: false, status: 503, json: async () => ({ error: "Unavailable" }) });
  await settle();
  assert.equal(input.value, "confirmed");
  assert.equal(queries.at(-1), "confirmed");
  assert.match(document.getElementById("search-error").textContent, /Unavailable.*Last confirmed view restored/);
  assert.equal(document.getElementById("search-error").classList.contains("hidden"), false);
  apply({ query: "remote", queryRevision: 2 });
  type("");
  assert.equal(calls[1].query, "");
  calls[1].resolve({ ok: true, json: async () => ({ query: "", queryRevision: 3 }) });
  await settle();
  assert.equal(state().query, "");
  assert.equal(input.value, "");
  assert.equal(queries.at(-1), "");
  assert.equal(document.getElementById("search-error").classList.contains("hidden"), true);
  assert.equal(input.getAttribute("aria-busy"), "false");
});

test("newer remote query snapshots beat delayed acknowledgements after pending typing ends", async () => {
  const { document, calls, apply, state } = appFixture();
  const input = document.getElementById("search");
  input.value = "local";
  input.dispatchEvent(new FrontendEvent("input"));
  apply({ query: "remote", queryRevision: 2 });
  assert.equal(input.value, "local");
  calls[0].resolve({ ok: true, json: async () => ({ query: "local", queryRevision: 1 }) });
  await settle();
  assert.equal(input.value, "remote");
  assert.equal(state().queryRevision, 2);
  apply({ query: "local", queryRevision: 1 });
  assert.equal(input.value, "remote");
});

test("rapid layer clicks serialize and coalesce against local intent, not interim or late SSE", async () => {
  const { controls, calls, changes } = controlsFixture();
  controls.click("experiences");
  controls.click("decisions");
  controls.click("sources");
  const desired = changes.at(-1).layers;
  assert.equal(calls.length, 1);
  assert.equal(desired.decisions, true);
  assert.equal(desired.sources, false);
  assert.deepEqual(controls.snapshot(all, 0), desired);
  calls[0].resolve({ layers: calls[0].layers, layersRevision: 1 });
  await settle();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].layers, desired);
  assert.deepEqual(controls.snapshot(calls[0].layers, 1), desired);
  calls[1].resolve({ layers: calls[1].layers, layersRevision: 2 });
  await settle();
  assert.equal(changes.at(-1).pending, false);
  assert.deepEqual(controls.snapshot(all, 0), desired);
  assert.deepEqual(controls.snapshot(calls[0].layers, 1), desired);
  controls.click("decisions");
  assert.equal(calls[2].layers.decisions, false);
  calls[2].resolve({ layers: calls[2].layers, layersRevision: 3 });
  await settle();
});

test("failed requests restore confirmed layers without poisoning future clicks", async () => {
  const { controls, calls, changes } = controlsFixture();
  controls.click("relations");
  calls[0].resolve({ layers: calls[0].layers, layersRevision: 1 });
  await settle();
  const confirmed = { ...all, relations: false };
  controls.click("experiences");
  calls[1].reject(new Error("HTTP 503"));
  await settle();
  assert.deepEqual(changes.at(-1).layers, confirmed);
  assert.match(changes.at(-1).error, /HTTP 503.*Last confirmed view restored/);
  assert.equal(changes.at(-1).pending, false);
  assert.deepEqual(controls.snapshot(calls[1].layers, 0), confirmed, "late stale snapshot cannot restore failed intent");
  controls.click("sources");
  assert.deepEqual(calls[2].layers, { ...confirmed, sources: false });
  calls[2].resolve({ layers: calls[2].layers, layersRevision: 2 });
  await settle();
  assert.equal(changes.at(-1).error, null);
});

test("failure with newer clicks pending sends latest full intent and rolls back if that also fails", async () => {
  const { controls, calls, changes } = controlsFixture();
  controls.click("experiences");
  controls.click("decisions");
  const latest = changes.at(-1).layers;
  calls[0].reject(new Error("offline"));
  await settle();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].layers, latest);
  assert.deepEqual(controls.snapshot(all, 0), latest);
  calls[1].reject(new Error("still offline"));
  await settle();
  assert.deepEqual(changes.at(-1).layers, all);
  assert.equal(changes.at(-1).pending, false);
});

for (const ackRevision of [1, 2]) {
  test(`newer SSE supersedes a delayed ${ackRevision === 1 ? "lower" : "equal"}-revision acknowledgement`, async () => {
    const { controls, calls, changes } = controlsFixture();
    controls.click("experiences");
    const desired = changes.at(-1).layers;
    const external = { ...all, sources: false };
    assert.deepEqual(controls.snapshot(external, 2), desired, "in-flight intent stays optimistic");
    assert.deepEqual(controls.snapshot(all, 1), desired);
    assert.deepEqual(controls.snapshot(all, 2), desired, "equal revisions cannot replace confirmed data");
    calls[0].resolve({ layers: calls[0].layers, layersRevision: ackRevision });
    await settle();
    assert.deepEqual(changes.at(-1).layers, external, "idle state adopts newest authority, not the late ack");
    assert.equal(changes.at(-1).pending, false);
    assert.equal(controls.layersRevision, 2);
    assert.deepEqual(controls.snapshot(calls[0].layers, 1), external);
    assert.deepEqual(controls.snapshot(calls[0].layers, 2), external);
  });
}

test("newer snapshots do not discard queued local clicks; final acknowledgement advances the revision", async () => {
  const { controls, calls, changes } = controlsFixture();
  controls.click("experiences");
  controls.click("decisions");
  const desired = changes.at(-1).layers;
  assert.deepEqual(controls.snapshot({ ...all, sources: false }, 3), desired);
  calls[0].resolve({ layers: calls[0].layers, layersRevision: 1 });
  await settle();
  assert.deepEqual(calls[1].layers, desired);
  assert.deepEqual(controls.snapshot(all, 2), desired);
  calls[1].resolve({ layers: calls[1].layers, layersRevision: 4 });
  await settle();
  assert.deepEqual(changes.at(-1).layers, desired);
  assert.equal(changes.at(-1).pending, false);
  assert.equal(controls.layersRevision, 4);
});

test("after a successful local edit, later external and reconnect revisions become authoritative", async () => {
  const { controls, calls } = controlsFixture();
  controls.click("relations");
  calls[0].resolve({ layers: calls[0].layers, layersRevision: 1 });
  await settle();
  const external = { ...all, sources: false };
  assert.deepEqual(controls.snapshot(external, 7), external, "reconnect may skip revisions");
  assert.deepEqual(controls.snapshot(calls[0].layers, 1), external);
  assert.deepEqual(controls.snapshot(all, 7), external);
  assert.deepEqual(controls.snapshot(all), external, "unversioned data cannot downgrade a versioned connection");
  controls.click("sources");
  assert.deepEqual(calls[1].layers, all, "next click derives from the external update, not old local intent");
  calls[1].resolve({ layers: all, layersRevision: 8 });
  await settle();
});

test("after a failed write, higher external revisions are accepted and seed subsequent clicks", async () => {
  const { controls, calls, changes } = controlsFixture();
  controls.click("relations");
  calls[0].resolve({ layers: calls[0].layers, layersRevision: 1 });
  await settle();
  controls.click("experiences");
  calls[1].reject(new Error("HTTP 503"));
  await settle();
  assert.deepEqual(changes.at(-1).layers, { ...all, relations: false });
  const external = { ...all, work: false };
  assert.deepEqual(controls.snapshot(external, 2), external);
  assert.equal(controls.layersRevision, 2);
  controls.click("work");
  assert.deepEqual(calls[2].layers, all);
  calls[2].resolve({ layers: all, layersRevision: 3 });
  await settle();
  assert.equal(changes.at(-1).error, null);
});

test("a confirmed SSE update is retained if its HTTP acknowledgement subsequently fails", async () => {
  const { controls, calls, changes } = controlsFixture();
  controls.click("relations");
  const confirmed = { ...calls[0].layers };
  controls.snapshot(confirmed, 1);
  calls[0].reject(new Error("connection closed"));
  await settle();
  assert.deepEqual(changes.at(-1).layers, confirmed);
  assert.equal(controls.layersRevision, 1);
  assert.deepEqual(controls.snapshot(all, 2), all);
});

test("versionless legacy snapshots protect pending clicks without taking lifelong ownership", async () => {
  const { controls, calls, changes } = controlsFixture(null);
  controls.click("experiences");
  controls.click("decisions");
  const desired = changes.at(-1).layers;
  assert.deepEqual(controls.snapshot(all), desired);
  calls[0].resolve({ layers: calls[0].layers });
  await settle();
  assert.deepEqual(calls[1].layers, desired);
  calls[1].resolve({ layers: calls[1].layers });
  await settle();
  assert.deepEqual(changes.at(-1).layers, desired);
  const external = { ...all, sources: false };
  assert.deepEqual(controls.snapshot(external), external);
  controls.click("sources");
  assert.deepEqual(calls[2].layers, all);
  calls[2].reject(new Error("offline"));
  await settle();
  assert.deepEqual(changes.at(-1).layers, external);
  assert.deepEqual(controls.snapshot(all), all, "legacy idle sync also resumes after failure");
  assert.equal(controls.layersRevision, null);
});

test("actual preview and chat clicks each navigate once, including after snapshot rerenders", () => {
  const { document, calls, opened, apply } = appFixture();
  apply({});
  for (const container of ["preview-relates", "preview-body"]) {
    for (const button of document.getElementById(container).querySelectorAll("button")) {
      const before = calls.length;
      const event = button.click();
      assert.equal(calls.length, before + 1);
      assert.equal(calls.at(-1).action, "select");
      assert.equal(calls.at(-1).nodeId, button.getAttribute("data-target"));
      assert.equal(event.propagationStopped, true);
      assert.equal(event.defaultPrevented, true);
    }
  }
  const before = calls.length;
  for (const anchor of document.getElementById("preview-body").querySelectorAll("a")) anchor.click();
  assert.equal(calls.length, before);
  assert.deepEqual(opened, [
    ["https://example.com", "_blank", "noopener,noreferrer"],
    ["mailto:hello@example.com", "_blank", "noopener,noreferrer"],
  ]);
  apply({ chat: [{ role: "graph", text: "[[other]] [External](https://example.com)" }] });
  document.getElementById("chat-log").querySelector(".wikilink").click();
  assert.equal(calls.length, before + 1);
  document.getElementById("chat-log").querySelector("a").click();
  assert.equal(opened.length, 3);
});

test("unhandled controls still bubble and internal anchors use the single navigation path", () => {
  const { document, calls } = appFixture();
  const body = document.getElementById("preview-body");
  body.innerHTML = '<a href="atlas://memory/node">Node</a><button type="button">Unrelated</button>';
  const link = body.querySelector("a").click();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].nodeId, "atlas://memory/node");
  assert.equal(link.propagationStopped, true);
  const unrelated = body.querySelector("button").click();
  assert.equal(unrelated.defaultPrevented, false);
  assert.equal(unrelated.propagationStopped, false);
  assert.equal(calls.length, 1);
});

test("actual layer wiring updates buttons immediately, keeps grouping/SSE data, and handles non-2xx JSON", async () => {
  const { document, calls, apply, state } = appFixture();
  document.querySelector('[data-layer="experiences"]').click();
  document.querySelector('[data-layer="decisions"]').click();
  assert.equal(calls.length, 1);
  assert.equal(document.querySelector('[data-layer="decisions"]').getAttribute("aria-pressed"), "true");
  apply({ layers: all, layersRevision: 0, grouping: "atlases", query: "new", queryRevision: 1, selectedId: null });
  assert.equal(state().layers.work, false);
  calls[0].resolve({ ok: true, json: async () => ({ layers: calls[0].layers, layersRevision: 1, grouping: "layers" }) });
  await settle();
  assert.equal(calls.length, 2);
  assert.equal(state().grouping, "atlases");
  assert.equal(state().query, "new");
  assert.equal(state().selectedId, null);
  calls[1].resolve({ ok: false, status: 403, json: async () => ({ error: "Forbidden" }) });
  await settle();
  assert.equal(state().layers.decisions, false, "restore first successful solo operation");
  assert.match(document.getElementById("layer-error").textContent, /Forbidden/);
  assert.equal(document.getElementById("layer-error").classList.contains("hidden"), false);
  assert.equal(document.getElementById("layer-status").textContent, "");
  apply({ layers: calls[1].layers, layersRevision: 0 });
  assert.equal(state().layers.decisions, false);
  assert.equal(state().layersRevision, 1);
  apply({ layers: all, layersRevision: 2 });
  assert.deepEqual(state().layers, all, "external revisions are rendered after failure");
  assert.equal(state().layersRevision, 2);
  assert.equal(document.querySelector('[data-layer="all"]').getAttribute("aria-pressed"), "true");
  apply({ layers: calls[0].layers, layersRevision: 1 });
  assert.deepEqual(state().layers, all);
  assert.equal(state().layersRevision, 2, "app state revision never moves backwards");
});

test("browser selection reveals hidden layers and opens a preview with a keyboard return path", async () => {
  const { document, calls, apply, state } = appFixture();
  apply({ selectedId: null, previewOpen: false, layers: { ...all, experiences: false }, layersRevision: 1 });
  document.getElementById("browse-nodes").click();
  const button = document.getElementById("node-list").firstElementChild.firstElementChild;
  assert.match(button.textContent, /Hidden layer/);
  button.click();
  assert.equal(calls[0].action, "layers");
  assert.equal(calls[0].layers.experiences, true);
  assert.equal(calls[1].action, "select");
  assert.equal(calls[1].nodeId, "node");
  calls[0].resolve({ ok: true, json: async () => ({ layers: calls[0].layers, layersRevision: 2 }) });
  calls[1].resolve({ ok: true, json: async () => ({ selectedId: "node", previewOpen: true }) });
  await settle();
  assert.equal(document.activeElement, document.getElementById("preview-close"));
  assert.equal(button.getAttribute("aria-pressed"), "true");
  document.getElementById("preview-close").click();
  assert.equal(calls[2].action, "preview");
  assert.equal(calls[2].open, false);
  calls[2].resolve({ ok: true, json: async () => ({ selectedId: "node", previewOpen: false }) });
  await settle();
  assert.equal(document.activeElement, button);
  assert.equal(state().selectedId, "node");
  assert.equal(state().previewOpen, false);
  apply({ layers: { ...all, experiences: false }, layersRevision: 1 });
  assert.equal(document.activeElement, button);
  assert.equal(state().layers.experiences, true);
  assert.equal(calls.filter((call) => call.action === "select").length, 1);
});
