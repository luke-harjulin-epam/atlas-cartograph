import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, renameSync, rmSync, chmodSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { addAtlas, dropAtlas, freshState, openAtlas, selectNode, startServer } from "../.apm/extensions/cartograph/server.mjs";
import { graphChanges } from "../.apm/extensions/cartograph/atlas/live.mjs";

async function until(predicate, message) {
  const deadline = Date.now() + 5000;
  while (!predicate() && Date.now() < deadline) await delay(20);
  assert.ok(predicate(), message);
}

function page(title, body = "") {
  return `---\ntype: work\ntitle: ${title}\n---\n\n# ${title}\n\n${body}\n`;
}

async function setup(t, { native = false } = {}) {
  const temp = mkdtempSync(join(tmpdir(), "cartograph-live-"));
  const root = join(temp, "atlas");
  mkdirSync(root);
  writeFileSync(join(root, "SCHEMA.json"), '{"atlas_id":"one"}');
  writeFileSync(join(root, "index.md"), page("Index"));
  const state = freshState(temp, { skipIntro: true });
  openAtlas(state, root);
  state.phase = "map";
  const source = { roots: [], closes: 0 };
  const watcherFactory = ({ onChange, onStatus }) => {
    source.change = onChange;
    source.status = onStatus;
    return {
      setRoots(roots) {
        source.roots = roots;
        onStatus({ status: roots.length ? "live" : "idle", message: "Test watcher" });
      },
      close() { source.closes++; },
    };
  };
  const entry = await startServer("live-test", state, {
    activity: { platform: "darwin" },
    graphWatch: { ...(native ? {} : { watcherFactory }), debounceMs: 40, maxWaitMs: 200 },
  });
  t.after(async () => { await entry.close(); rmSync(temp, { recursive: true, force: true }); });
  const node = (path) => state.graph?.nodes.find((item) => item.path === path);
  const change = () => source.change(root);
  return { entry, state, root, temp, source, node, change };
}

test("live scans add, edit and delete nodes while preserving query, grouping and selection", async (t) => {
  const { state, root, node, change, entry } = await setup(t);
  selectNode(state, "index");
  state.query = "my filter";
  state.grouping = "proximity";
  state.layers.sources = false;
  const layers = { ...state.layers };
  writeFileSync(join(root, "new.md"), page("New", "[[index]]"));
  change();
  await until(() => node("new.md"), "creation reaches graph without manual reload");
  assert.deepEqual(state.graphChanges.created.map((item) => item.path), ["new.md"]);
  assert.deepEqual(state.graphChanges.deleted, []);
  assert.equal(state.graphChanges.origin, "filesystem");
  assert.equal(state.graphChanges.durationMs, 2000);
  assert.ok(state.graph.edges.some((edge) => edge.source === "new" && edge.target === "index"));
  assert.deepEqual(state.graphChanges.createdEdges, state.graph.edges);
  assert.deepEqual(state.graphChanges.deletedEdges, []);
  const originalEdges = [...state.graph.edges];
  assert.equal(state.selectedId, "index");
  assert.equal(state.previewOpen, true);
  assert.equal(state.query, "my filter");
  assert.equal(state.grouping, "proximity");
  assert.deepEqual(state.layers, layers);
  assert.equal(state.phase, "map");
  assert.deepEqual(state.activity.nodes, []);
  const creationRevision = state.graphChanges.revision;
  change();
  await delay(90);
  assert.equal(state.graphChanges.revision, creationRevision, "duplicate notifications do not replay lifecycle events");

  writeFileSync(join(root, "new.md"), page("Renamed title"));
  writeFileSync(join(root, "index.md"), page("Index", "Updated preview body"));
  change();
  await until(() => state.page?.body.includes("Updated preview"), "selected page content refreshes");
  assert.equal(node("new.md").title, "Renamed title");
  assert.deepEqual(state.graphChanges.created, []);
  assert.deepEqual(state.graphChanges.deleted, []);
  assert.ok(!state.graph.edges.some((edge) => edge.source === "new"));
  assert.deepEqual(state.graphChanges.createdEdges, []);
  assert.deepEqual(state.graphChanges.deletedEdges, originalEdges);

  selectNode(state, "new");
  rmSync(join(root, "new.md"));
  change();
  await until(() => !node("new.md"), "deletion reaches graph");
  assert.equal(state.selectedId, null);
  assert.equal(state.previewOpen, false);
  assert.equal(state.page, null);
  assert.equal(state.graphChanges.deleted[0].title, "Renamed title");
  assert.equal(state.graphChanges.deleted[0].storeRoot, root);
  assert.deepEqual(state.graphChanges.created, []);
  assert.equal(state.query, "my filter");
  const response = await fetch(new URL("/api/bootstrap", entry.url));
  const boot = await response.json();
  assert.deepEqual(boot.state.graphChanges, state.graphChanges);
  assert.equal(boot.state.graphWatch.status, "live");
});

test("debouncing coalesces atomic saves into an edit instead of delete/create", async (t) => {
  const { state, root, node, change } = await setup(t);
  const baseline = state.graphChanges.revision;
  const temporary = join(root, ".index-saving");
  writeFileSync(temporary, page("Updated index"));
  change();
  renameSync(temporary, join(root, "index.md"));
  change();
  await until(() => node("index.md").title === "Updated index", "atomic save is reloaded");
  assert.equal(state.graphChanges.revision, baseline + 1);
  assert.deepEqual(state.graphChanges.created, []);
  assert.deepEqual(state.graphChanges.deleted, []);
});

test("multiple Atlases watch and reconcile independently, including colliding local IDs", async (t) => {
  const { state, entry, root, temp, source } = await setup(t);
  const other = join(temp, "other");
  mkdirSync(other);
  writeFileSync(join(other, "SCHEMA.json"), '{"atlas_id":"two"}');
  writeFileSync(join(other, "index.md"), page("Other index"));
  addAtlas(state, other);
  entry.broadcast();
  assert.deepEqual(source.roots, [root, other]);
  const selected = state.graph.nodes.find((node) => node.storeRoot === other);
  selectNode(state, selected.id);
  writeFileSync(join(root, "same.md"), page("First"));
  writeFileSync(join(other, "same.md"), page("Second"));
  source.change(root);
  source.change(other);
  await until(() => state.graph.nodes.length === 4, "both roots are refreshed");
  assert.equal(state.graphChanges.created.length, 2);
  assert.equal(state.selectedId, selected.id);
  rmSync(join(root, "same.md"));
  source.change(root);
  await until(() => state.graph.nodes.length === 3, "only deleted root's node is removed");
  assert.equal(state.graphChanges.deleted[0].storeRoot, root);
  assert.ok(state.graph.nodes.some((node) => node.path === "same.md" && node.storeRoot === other));
  dropAtlas(state, root);
  entry.broadcast();
  assert.deepEqual(source.roots, [other]);
  assert.equal(state.graphChanges.origin, "mount");
  assert.deepEqual(state.graphChanges.deleted, []);
  const revision = state.graphChanges.revision;
  source.change(root);
  await delay(90);
  assert.equal(state.graphChanges.revision, revision);
});

test("invalid or unreadable scans preserve the last graph and surface an independent error", async (t) => {
  const { state, root, change, node } = await setup(t);
  const before = state.graph;
  const revision = state.graphChanges.revision;
  writeFileSync(join(root, "SCHEMA.json"), "{ incomplete");
  change();
  await until(() => state.graphWatch.status === "error", "parse failure is visible");
  assert.equal(state.graph, before);
  assert.equal(state.graphChanges.revision, revision);
  assert.match(state.graphWatch.message, /keeping the last graph/);
  assert.notEqual(state.activity.collector.status, "live");
  writeFileSync(join(root, "SCHEMA.json"), '{"atlas_id":"one"}');
  change();
  await until(() => state.graphWatch.status === "live", "watcher recovers after a valid save");
  if (process.getuid?.() !== 0 && process.platform !== "win32") {
    const file = join(root, "index.md");
    chmodSync(file, 0);
    t.after(() => { if (node("index.md")) { try { chmodSync(file, 0o600); } catch (error) { if (error.code !== "ENOENT") throw error; } } });
    change();
    await until(() => state.graphWatch.status === "error", "permission failure is visible");
    assert.equal(state.graph, before);
    assert.deepEqual(state.graphChanges.deleted, []);
    chmodSync(file, 0o600);
    change();
    await until(() => state.graphWatch.status === "live", "permission restoration recovers");
  }
});

test("watcher failures are surfaced and pending refreshes cancel when the Atlas is closed", async (t) => {
  const { state, entry, root, source, change } = await setup(t);
  source.status({ status: "error", message: "Permission denied by filesystem" });
  assert.equal(state.graphWatch.status, "error");
  assert.match(state.graphWatch.message, /Permission denied/);
  writeFileSync(join(root, "later.md"), page("Later"));
  change();
  openAtlas(state, "");
  entry.broadcast();
  const revision = state.graphChanges.revision;
  assert.deepEqual(source.roots, []);
  assert.equal(state.graphWatch.status, "idle");
  await delay(100);
  assert.equal(state.graph, null);
  assert.equal(state.graphChanges.revision, revision);
});

test("filesystem watching detects nested create, edit, delete, and root recreation", async (t) => {
  const { state, root, node } = await setup(t, { native: true });
  assert.equal(state.graphWatch.status, "live");
  mkdirSync(join(root, "work"));
  writeFileSync(join(root, "work", "task.md"), page("Task", "[[index]]"));
  await until(() => node("work/task.md"), "native watcher discovers nested file");
  writeFileSync(join(root, "work", "task.md"), page("Edited"));
  await until(() => node("work/task.md")?.title === "Edited", "native watcher detects content edits");
  writeFileSync(join(root, "work", ".saving"), page("Atomic edit"));
  renameSync(join(root, "work", ".saving"), join(root, "work", "task.md"));
  await until(() => node("work/task.md")?.title === "Atomic edit", "native watcher follows atomic saves");
  assert.deepEqual(state.graphChanges.created, []);
  assert.deepEqual(state.graphChanges.deleted, []);
  const baseline = state.graphChanges.revision;
  readFileSync(join(root, "work", "task.md"));
  await delay(150);
  assert.equal(state.graphChanges.revision, baseline, "reads never generate lifecycle activity");
  rmSync(join(root, "work"), { recursive: true });
  await until(() => !node("work/task.md"), "native watcher detects directory deletion");
  rmSync(root, { recursive: true });
  await until(() => state.graph.nodes.length === 0, "removing root clears its actual graph nodes");
  assert.equal(state.phase, "map");
  assert.equal(state.graphWatch.status, "error");
  mkdirSync(root);
  writeFileSync(join(root, "index.md"), page("Recreated"));
  await until(() => node("index.md")?.title === "Recreated", "parent watcher reattaches a recreated root");
  assert.equal(state.graphWatch.status, "live");
});

test("live graph changes update authenticated collector targets without creating read activity", async (t) => {
  const { entry, state, root, change, node } = await setup(t);
  // Receiver target lookup is local to the service; no OS collector or elevated process is required.
  const connection = await (await fetch(new URL("/api/activity/connection", entry.url), {
    headers: { "X-Cartograph-Client": "canvas" },
  })).json();
  assert.ok(connection.token);
  const headers = { Authorization: `Bearer ${connection.token}` };
  const targets = async () => (await (await fetch(new URL("/api/activity/targets", entry.url), { headers })).json()).paths;
  const path = join(root, "target.md");
  writeFileSync(path, page("Target"));
  change();
  await until(() => node("target.md"), "new file enters graph");
  assert.ok((await targets()).includes(path));
  assert.deepEqual(state.activity.nodes, []);
  rmSync(path);
  change();
  await until(() => !node("target.md"), "removed file leaves graph");
  assert.ok(!(await targets()).includes(path));
});

test("delta identity uses each Atlas file path rather than temporary qualified graph IDs", () => {
  const node = { id: "index", path: "index.md", storeRoot: "/atlas" };
  const changes = graphChanges({ nodes: [node] }, { nodes: [{ ...node, id: "one::index" }] }, 2, 100);
  assert.deepEqual(changes.created, []);
  assert.deepEqual(changes.deleted, []);
});

test("relationship deltas ignore ID renumbering but detect new directions, kinds and file identities", () => {
  const a = { id: "a", path: "a.md", storeRoot: "/atlas" };
  const b = { id: "b", path: "b.md", storeRoot: "/atlas" };
  const edge = { id: "ab", source: "a", target: "b", kind: "relates", relKind: "related" };
  const before = { nodes: [a, b], edges: [edge] };
  const remappedEdge = { ...edge, id: "qualified", source: "one::a", target: "one::b" };
  const after = { nodes: [{ ...a, id: "one::a" }, { ...b, id: "one::b" }], edges: [remappedEdge] };
  assert.deepEqual(graphChanges(before, after, 1, 100).createdEdges, []);
  assert.deepEqual(graphChanges(before, after, 1, 100).deletedEdges, []);
  for (const changed of [
    { ...edge, source: "b", target: "a" },
    { ...edge, kind: "source" },
    { ...edge, relKind: "implements" },
  ]) {
    assert.deepEqual(graphChanges(before, { ...before, edges: [edge, changed] }, 1, 100).createdEdges, [changed]);
  }
  assert.deepEqual(graphChanges(before, {
    ...before, nodes: [a, { ...b, storeRoot: "/other-atlas" }],
  }, 1, 100).createdEdges, [edge]);
  assert.deepEqual(graphChanges(before, { ...before, edges: [] }, 1, 100).createdEdges, []);
  assert.deepEqual(graphChanges(before, { ...before, edges: [] }, 1, 100).deletedEdges, [edge]);
  assert.deepEqual(graphChanges(before, { nodes: [a], edges: [] }, 1, 100).deletedEdges, [edge]);
});

test("adding a relationship between existing files publishes a distinct birth without read activity", async (t) => {
  const { state, root, node, change } = await setup(t);
  writeFileSync(join(root, "other.md"), page("Other"));
  change();
  await until(() => node("other.md"), "both endpoints exist before the relationship");
  writeFileSync(join(root, "other.md"), page("Other", "[[index]]"));
  change();
  await until(() => state.graph.edges.length === 1, "new relationship reaches the graph");
  assert.deepEqual(state.graphChanges.created, []);
  assert.deepEqual(state.graphChanges.deleted, []);
  assert.deepEqual(state.graphChanges.createdEdges, state.graph.edges);
  assert.deepEqual(state.activity.edges, []);
  writeFileSync(join(root, "other.md"), page("Edited", "[[index]]"));
  change();
  await until(() => node("other.md").title === "Edited", "metadata edit arrives");
  assert.deepEqual(state.graphChanges.createdEdges, []);
  const relationship = state.graph.edges[0];
  writeFileSync(join(root, "other.md"), page("Edited"));
  change();
  await until(() => state.graph.edges.length === 0, "relationship deletion reaches the graph");
  assert.deepEqual(state.graphChanges.deletedEdges, [relationship]);
  assert.deepEqual(state.graphChanges.deleted, []);
  assert.deepEqual(state.activity.edges, []);
  writeFileSync(join(root, "other.md"), page("Edited", "[[index]]"));
  change();
  await until(() => state.graph.edges.length === 1, "relationship is recreated");
  rmSync(join(root, "other.md"));
  change();
  await until(() => !node("other.md"), "endpoint deletion reaches the graph");
  assert.deepEqual(state.graphChanges.deletedEdges, [relationship]);
  assert.deepEqual(state.graphChanges.deleted.map((item) => item.path), ["other.md"]);
});

test("relative roots normalize to the same identity used by lifecycle visibility and watcher sources", async (t) => {
  const { state, entry, source, root, temp } = await setup(t);
  openAtlas(state, "./atlas");
  entry.broadcast();
  assert.deepEqual(state.roots, [root]);
  assert.equal(state.root, root);
  assert.equal(state.graph.nodes[0].storeRoot, state.roots[0]);
  assert.deepEqual(source.roots, [root]);
  addAtlas(state, root);
  assert.equal(state.roots.length, 1);
  dropAtlas(state, "./atlas");
  entry.broadcast();
  assert.deepEqual(state.roots, []);
  assert.deepEqual(freshState(temp, { root: "./atlas" }).roots, [root]);
});

test("deleting the defining index of an already mounted Atlas does not delete its other nodes", async (t) => {
  const { state, root, change, node } = await setup(t);
  writeFileSync(join(root, "remaining.md"), page("Remaining"));
  change();
  await until(() => node("remaining.md"), "second file appears");
  rmSync(join(root, "SCHEMA.json"));
  rmSync(join(root, "index.md"));
  change();
  await until(() => !node("index.md"), "index deletion is observed");
  assert.ok(node("remaining.md"));
  assert.deepEqual(state.graphChanges.deleted.map((item) => item.path), ["index.md"]);
  assert.equal(state.graph.store.available, true);
  writeFileSync(join(root, "remaining.md"), page("Still watched"));
  change();
  await until(() => node("remaining.md")?.title === "Still watched", "mounted store remains live without its index");
});

test("existing SSE clients receive graph deltas without reconnecting or polling", async (t) => {
  const { entry, root, change } = await setup(t);
  const abort = new AbortController();
  const response = await fetch(new URL("/events", entry.url), { signal: abort.signal });
  const reader = response.body.getReader();
  try {
    const initial = new TextDecoder().decode((await reader.read()).value);
    assert.match(initial, /"graphWatch":/);
    writeFileSync(join(root, "streamed.md"), page("Streamed"));
    change();
    const next = new TextDecoder().decode((await reader.read()).value);
    assert.match(next, /^data: /);
    assert.match(next, /"origin":"filesystem"/);
    assert.match(next, /"created":\[\{"id":"streamed"/);
    assert.match(next, /"title":"Streamed"/);
  } finally {
    abort.abort();
  }
});
