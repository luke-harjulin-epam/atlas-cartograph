import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AccessActivity } from "../.apm/extensions/cartograph/activity/model.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "cartograph-activity-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let clock = 1000;
  const model = new AccessActivity({ now: () => clock, ignorePids: [42] });
  const nodes = ["a", "b", "c"].map((id) => ({ id, path: `${id}.md`, storeRoot: root }));
  const graph = { nodes, edges: [{ id: "ab", source: "b", target: "a" }] };
  model.setGraph(graph);
  return {
    model, graph, root,
    advance: (ms) => { clock += ms; },
    access: (id, pid = 99) => model.record({ path: join(root, `${id}.md`), pid }),
  };
}

test("default lifetime is exactly five seconds, repeat accesses refresh only that node", (t) => {
  const { model, access, advance } = fixture(t);
  assert.equal(model.durationMs, 5000);
  access("a");
  advance(2000);
  access("b");
  access("a");
  assert.equal(model.snapshot().nodes.length, 2);
  advance(4999);
  assert.equal(model.snapshot().nodes.length, 2);
  advance(1);
  assert.deepEqual(model.snapshot().nodes, []);
  assert.deepEqual(model.snapshot().edges, []);
});

test("related pulse direction follows access order, not stored edge direction", (t) => {
  const { model, access, advance } = fixture(t);
  access("a");
  advance(1500);
  access("b");
  assert.deepEqual(model.snapshot().edges, [{
    id: "ab", source: "a", target: "b", startedAt: 2500, expiresAt: 6000,
  }]);
  access("c");
  assert.equal(model.snapshot().nodes.length, 3);
  assert.equal(model.snapshot().edges.length, 1);
  advance(3500);
  assert.deepEqual(model.snapshot().nodes.map((n) => n.id), ["b", "c"]);
  assert.deepEqual(model.snapshot().edges, []);
  advance(1500);
  assert.deepEqual(model.snapshot().nodes, []);
});

test("same-timestamp accesses expose coalesced counts and deterministic global sequences", (t) => {
  const { model, access } = fixture(t);
  access("a");
  access("b");
  assert.equal(model.snapshot().edges[0].source, "a");
  access("a");
  assert.equal(model.snapshot().edges[0].source, "b");
  access("a");
  access("b");
  access("c");
  access("a");
  const snapshot = model.snapshot();
  const common = { pid: 99, kind: undefined, accessedAt: 1000, expiresAt: 6000 };
  assert.deepEqual(snapshot.nodes, [
    { ...common, id: "a", sequence: 7, count: 4, firstSequence: 1 },
    { ...common, id: "b", sequence: 5, count: 2, firstSequence: 2 },
    { ...common, id: "c", sequence: 6, count: 1, firstSequence: 6 },
  ]);
  assert.deepEqual(snapshot.edges, [{
    id: "ab", source: "b", target: "a", startedAt: 1000, expiresAt: 6000,
  }]);
  assert.ok(snapshot.nodes.every((node) => !Object.hasOwn(node, "order")));
  assert.deepEqual(model.snapshot(), snapshot);
});

test("repeats retain only current active records while updating the latest observation", (t) => {
  const { model, root } = fixture(t);
  for (let i = 0; i < 10000; i++) {
    assert.equal(model.record({
      path: join(root, "a.md"), pid: i % 2 ? 100 : 99, kind: i % 2 ? "write" : "read",
    }), true);
  }
  assert.equal(model.active.size, 1);
  assert.deepEqual(model.snapshot().nodes, [{
    id: "a", pid: 100, kind: "write", accessedAt: 1000, expiresAt: 6000,
    sequence: 10000, count: 10000, firstSequence: 1,
  }]);
});

test("expired intervals reset counts and first sequences without resetting global ordering", (t) => {
  const { model, access, advance } = fixture(t);
  access("a");
  access("a");
  advance(5000);
  access("a");
  assert.deepEqual(model.snapshot().nodes, [{
    id: "a", pid: 99, kind: undefined, accessedAt: 6000, expiresAt: 11000,
    sequence: 3, count: 1, firstSequence: 3,
  }]);
  advance(5000);
  assert.deepEqual(model.snapshot().nodes, []);
  assert.equal(model.active.size, 0);
  access("a");
  assert.equal(model.snapshot().nodes[0].sequence, 4);
  assert.equal(model.snapshot().nodes[0].count, 1);
  assert.equal(model.snapshot().nodes[0].firstSequence, 4);
});

test("foreign files and the viewer's own PID never activate nodes", (t) => {
  const { model, access, root } = fixture(t);
  assert.equal(access("a", 42), false);
  assert.equal(access("outside"), false);
  assert.equal(model.record({ path: `${root}-elsewhere/a.md`, pid: 99 }), false);
  assert.equal(model.record({ path: "a.md", pid: 99 }), false);
  assert.equal(model.snapshot().nodes.length, 0);
  assert.equal(access("a"), true);
  const [node] = model.snapshot().nodes;
  assert.equal(node.sequence, 1);
  assert.equal(node.count, 1);
  assert.equal(node.firstSequence, 1);
});

test("settings validate, apply to current activity, and pausing clears highlights", (t) => {
  const { model, access, advance } = fixture(t);
  for (const durationMs of [0, -1, NaN, 99, 300001, 1.5, "5000", null]) {
    assert.throws(() => model.configure({ durationMs }), RangeError);
  }
  assert.throws(() => model.configure({ enabled: "true" }), TypeError);
  access("a");
  advance(250);
  model.configure({ durationMs: 100 });
  assert.equal(model.snapshot().nodes.length, 0);
  model.configure({ durationMs: 1000 });
  access("a");
  access("a");
  assert.equal(model.snapshot().nodes[0].count, 2);
  model.configure({ enabled: false });
  assert.equal(model.snapshot().enabled, false);
  assert.equal(model.snapshot().nodes.length, 0);
  assert.equal(access("b"), false);
  model.configure({ enabled: true });
  assert.equal(access("a"), true);
  const snapshot = model.snapshot();
  assert.equal(snapshot.enabled, true);
  assert.equal(snapshot.nodes[0].sequence, 4);
  assert.equal(snapshot.nodes[0].count, 1);
  assert.equal(snapshot.nodes[0].firstSequence, 4);
});

test("duration changes preserve current interval metadata until the updated expiry", (t) => {
  const { model, access, advance } = fixture(t);
  access("a");
  advance(500);
  access("a");
  const [before] = model.snapshot().nodes;
  model.configure({ durationMs: 1000 });
  assert.deepEqual(model.snapshot().nodes, [{ ...before, expiresAt: 2500 }]);
  advance(999);
  assert.equal(model.snapshot().nodes[0].count, 2);
  advance(1);
  assert.deepEqual(model.snapshot().nodes, []);
  access("a");
  assert.equal(model.snapshot().nodes[0].sequence, 3);
  assert.equal(model.snapshot().nodes[0].count, 1);
  assert.equal(model.snapshot().nodes[0].firstSequence, 3);
});

test("multiple atlas roots, cross-atlas edges, and graph ID changes retain precise path identity", (t) => {
  const { model, graph, root, access } = fixture(t);
  const secondRoot = join(root, "second");
  access("a");
  access("a");
  const [before] = model.snapshot().nodes;
  const combined = {
    nodes: [
      ...graph.nodes.map((n) => ({ ...n, id: `first::${n.id}` })),
      { id: "second::a", storeRoot: secondRoot, path: "a.md" },
    ],
    edges: [{ id: "cross", source: "second::a", target: "first::a" }],
  };
  model.setGraph(combined);
  assert.deepEqual(model.snapshot().nodes, [{ ...before, id: "first::a" }]);
  model.record({ path: join(secondRoot, "a.md"), pid: 99 });
  assert.equal(model.snapshot().edges[0].source, "first::a");
  const second = model.snapshot().nodes.find((node) => node.id === "second::a");
  assert.equal(second.sequence, 3);
  assert.equal(second.count, 1);
  assert.equal(second.firstSequence, 3);
  access("a");
  model.setGraph(graph);
  assert.deepEqual(model.snapshot().nodes, [{ ...before, sequence: 4, count: 3 }]);
  assert.equal(model.record({ path: join(secondRoot, "a.md"), pid: 99 }), false);
  model.setGraph(null);
  assert.equal(model.paths.size, 0);
  assert.deepEqual(model.snapshot().nodes, []);
});

test("graph deletion drops interval metadata even if the same file is later restored", (t) => {
  const { model, graph, access } = fixture(t);
  access("a");
  access("a");
  access("b");
  const before = model.snapshot().nodes.find((node) => node.id === "b");
  model.setGraph({ nodes: graph.nodes.filter((node) => node.id !== "a"), edges: [] });
  assert.deepEqual(model.snapshot().nodes, [before]);
  assert.equal(access("a"), false);
  model.setGraph(graph);
  assert.deepEqual(model.snapshot().nodes, [before]);
  access("a");
  const restored = model.snapshot().nodes.find((node) => node.id === "a");
  assert.equal(restored.sequence, 4);
  assert.equal(restored.count, 1);
  assert.equal(restored.firstSequence, 4);
  assert.equal(model.snapshot().edges[0].source, "b");
  model.setGraph(null);
  assert.equal(model.active.size, 0);
  model.setGraph(graph);
  access("a");
  assert.equal(model.snapshot().nodes[0].sequence, 5);
  assert.equal(model.snapshot().nodes[0].count, 1);
  assert.equal(model.snapshot().nodes[0].firstSequence, 5);
});

test("both symlink and canonical paths match without basename collisions", (t) => {
  const { model, graph, root } = fixture(t);
  const physical = join(root, "physical");
  mkdirSync(physical);
  writeFileSync(join(physical, "a.md"), "# Example");
  symlinkSync(physical, join(root, "alias"));
  model.setGraph({
    nodes: [{ ...graph.nodes[0], storeRoot: join(root, "alias") }],
    edges: [],
  });
  assert.equal(model.record({ path: realpathSync(join(physical, "a.md")), pid: 99 }), true);
  assert.equal(model.record({ path: join(root, "alias", "a.md"), pid: 99 }), true);
  assert.equal(model.record({ path: join(root, "a.md"), pid: 99 }), false);
  assert.equal(model.snapshot().nodes[0].sequence, 2);
  assert.equal(model.snapshot().nodes[0].count, 2);
  assert.equal(model.snapshot().nodes[0].firstSequence, 1);
});

test("one observation shares its sequence across physical-file aliases without alias edges", (t) => {
  const { model, graph, root } = fixture(t);
  const physical = join(root, "physical");
  mkdirSync(physical);
  writeFileSync(join(physical, "a.md"), "# Example");
  symlinkSync(physical, join(root, "alias"));
  const nodes = [
    { ...graph.nodes[0], id: "physical", storeRoot: physical },
    { ...graph.nodes[0], id: "alias", storeRoot: join(root, "alias") },
  ];
  model.setGraph({ nodes, edges: [{ id: "same-file", source: "physical", target: "alias" }] });
  const event = { path: realpathSync(join(physical, "a.md")), pid: 99, kind: "read" };
  assert.equal(model.record(event), true);
  assert.equal(model.record(event), true);
  const snapshot = model.snapshot();
  assert.equal(snapshot.nodes.length, 2);
  for (const node of snapshot.nodes) {
    assert.equal(node.sequence, 2);
    assert.equal(node.count, 2);
    assert.equal(node.firstSequence, 1);
    assert.equal(Object.hasOwn(node, "order"), false);
  }
  assert.deepEqual(snapshot.edges, []);
  model.setGraph({
    nodes: nodes.map((node) => ({ ...node, id: `renamed::${node.id}` })), edges: [],
  });
  assert.deepEqual(model.snapshot().nodes, snapshot.nodes.map((node) => ({
    ...node, id: `renamed::${node.id}`,
  })));
  model.record(event);
  for (const node of model.snapshot().nodes) {
    assert.equal(node.sequence, 3);
    assert.equal(node.count, 3);
    assert.equal(node.firstSequence, 1);
  }
});
