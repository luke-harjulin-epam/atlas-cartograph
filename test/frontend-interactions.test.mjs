import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { allNodeLayersOn, applyLayerClick, createLayerControls } from "../.apm/extensions/cartograph/public/layer-controls.js";
import { handleContentClick } from "../.apm/extensions/cartograph/public/content-navigation.js";
import { mountNodeBrowser } from "../.apm/extensions/cartograph/public/node-browser.js";
import { escapeHtml, renderMarkdown } from "../.apm/extensions/cartograph/public/markdown.js";
import { frontendDocument } from "./helpers/frontend-dom.mjs";

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

function appFixture() {
  const document = frontendDocument(html);
  const calls = [];
  const opened = [];
  const context = vm.createContext({
    document, allNodeLayersOn, createLayerControls, handleContentClick, mountNodeBrowser, escapeHtml, renderMarkdown,
    window: { matchMedia: () => ({ matches: false }), open: (...args) => opened.push(args) },
    performance: { now: () => 0 }, requestAnimationFrame() {}, setTimeout() {}, clearTimeout() {},
    mountActivityControls: () => ({ setActivity() {}, autoFocusEnabled: () => true, setPlayback() {} }),
    mountGraphWatchControls: () => ({ setWatch() {} }),
    mountGraphCanvas: () => ({ setGraph() {}, setSelected() {}, setQuery() {}, setActivity() {}, clusters: () => [] }),
    EventSource: class { addEventListener() {} },
    fetch: (url, options) => {
      const request = deferred();
      if (url === "/api/ui") calls.push({ ...JSON.parse(options.body), ...request });
      return request.promise;
    },
  });
  vm.runInContext(app.replace(/^import .*;\n/gm, ""), context);
  const initial = {
    phase: "map", root: "/atlas", roots: ["/atlas"], layers: all, layersRevision: 0, grouping: "layers",
    graph: { nodes: [{ id: "node", title: "Node", kind: "experience", path: "node.md", storeRoot: "/atlas" }], edges: [], store: {} },
    selectedId: "node", previewOpen: true, page: {
      body: "[[other|Wiki]]\n\n[External](https://example.com)\n\n[Mail](mailto:hello@example.com)",
      relatesTo: [{ path: "related" }], sources: ["source"],
    },
  };
  function apply(next) { vm.runInContext(`applyState(${JSON.stringify(next)})`, context); }
  apply(initial);
  return {
    document, calls, opened, apply,
    state: () => JSON.parse(vm.runInContext("JSON.stringify(state)", context)),
  };
}

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
  apply({ layers: all, layersRevision: 0, grouping: "atlases", query: "new", selectedId: null });
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
