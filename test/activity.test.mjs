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

function aliasFixture(t) {
  const base = fixture(t);
  const physical = join(base.root, "physical");
  mkdirSync(physical);
  writeFileSync(join(physical, "a.md"), "# Shared");
  const aliases = ["first", "second", "third"].map((id) => {
    const storeRoot = join(base.root, id);
    symlinkSync(physical, storeRoot);
    return { id, atlasKey: id, storeRoot, path: "a.md" };
  });
  const graph = {
    nodes: aliases.slice(0, 2),
    edges: [{ id: "aliases", source: "first", target: "second" }],
  };
  base.model.setGraph(graph);
  return {
    ...base, graph, aliases, physical,
    read: (id, pid = 99, kind = "read") => base.model.record({
      path: join(base.root, id, "a.md"), pid, kind,
    }),
  };
}

test("lexical alias reads retain distinct counts, timestamps and sequences through reordered rebuilds", (t) => {
  const { model, graph, read, advance } = aliasFixture(t);
  read("first");
  assert.deepEqual(model.snapshot().nodes.map(({ id }) => id), ["first"]);
  advance(100);
  read("second", 100, "write");
  advance(100);
  read("first", 101, "write");
  const before = model.snapshot();
  assert.deepEqual(before.nodes, [
    { id: "first", pid: 101, kind: "write", accessedAt: 1200, expiresAt: 6200, sequence: 3, count: 2, firstSequence: 1 },
    { id: "second", pid: 100, kind: "write", accessedAt: 1100, expiresAt: 6100, sequence: 2, count: 1, firstSequence: 2 },
  ]);
  for (const nodes of [[...graph.nodes].reverse(), graph.nodes]) {
    const rebuilt = { ...graph, nodes };
    assert.equal(model.setGraph(rebuilt), true);
    assert.deepEqual(model.snapshot().nodes, nodes.map(({ id }) => before.nodes.find((node) => node.id === id)));
    assert.deepEqual(model.snapshot().edges, before.edges);
    assert.equal(model.setGraph(rebuilt), false);
    assert.equal(model.sequence, 3);
  }
  advance(100);
  read("second", 102);
  assert.deepEqual(model.snapshot().nodes, [
    before.nodes[0],
    { ...before.nodes[1], pid: 102, kind: "read", accessedAt: 1300, expiresAt: 6300, sequence: 4, count: 2 },
  ]);
});

test("retained inactive and newly mounted lexical aliases never inherit active records", (t) => {
  const { model, graph, aliases, read, physical } = aliasFixture(t);
  read("first");
  read("first");
  const before = model.snapshot().nodes;
  model.setGraph({ ...graph });
  assert.deepEqual(model.snapshot().nodes, before);
  model.setGraph({ nodes: aliases, edges: [] });
  assert.deepEqual(model.snapshot().nodes, before);
  model.setGraph({ nodes: aliases.slice(1), edges: [] });
  assert.deepEqual(model.snapshot().nodes, []);
  assert.equal(read("first"), false);
  model.setGraph({ nodes: aliases, edges: [] });
  assert.deepEqual(model.snapshot().nodes, []);
  read("third");
  assert.deepEqual(model.snapshot().nodes.map(({ id, count, firstSequence, sequence }) => ({
    id, count, firstSequence, sequence,
  })), [{ id: "third", count: 1, firstSequence: 3, sequence: 3 }]);
  model.record({ path: realpathSync(join(physical, "a.md")), pid: 99, kind: "read" });
  const all = model.snapshot().nodes;
  assert.deepEqual(all.map(({ id, count }) => [id, count]).sort(), [["first", 1], ["second", 1], ["third", 2]]);
  assert.ok(all.every(({ sequence }) => sequence === 4));
});

test("ID qualification preserves each lexical alias even without mount metadata", (t) => {
  const { model, graph, read, advance } = aliasFixture(t);
  const local = { ...graph, nodes: graph.nodes.map(({ atlasKey, ...node }) => node) };
  model.setGraph(local);
  read("first");
  advance(100);
  read("first");
  advance(100);
  read("second");
  const before = model.snapshot().nodes;
  const qualified = {
    nodes: local.nodes.map((node) => ({ ...node, id: `${node.id}::a` })).reverse(),
    edges: [],
  };
  model.setGraph(qualified);
  assert.deepEqual(model.snapshot().nodes, before.map((node) => ({ ...node, id: `${node.id}::a` })).reverse());
  model.setGraph(local);
  assert.deepEqual(model.snapshot().nodes, before);
});

test("same-path mount identities survive single/multi qualification without spreading state to new aliases", (t) => {
  const { model, aliases, read, advance } = aliasFixture(t);
  const first = { ...aliases[0], id: "a" };
  const second = { ...first, atlasKey: "other" };
  const combined = {
    nodes: [{ ...first, id: "first::a" }, { ...second, id: "other::a" }],
    edges: [],
  };
  model.setGraph({ nodes: [first], edges: [] });
  read("first");
  advance(100);
  read("first");
  const [before] = model.snapshot().nodes;
  model.setGraph(combined);
  assert.deepEqual(model.snapshot().nodes, [{ ...before, id: "first::a" }]);
  model.setGraph({ ...combined, nodes: [...combined.nodes].reverse() });
  assert.deepEqual(model.snapshot().nodes, [{ ...before, id: "first::a" }]);
  advance(100);
  read("first");
  const survivor = model.snapshot().nodes.find(({ id }) => id === "other::a");
  assert.equal(survivor.count, 1);
  assert.equal(survivor.firstSequence, 3);
  assert.equal(model.snapshot().nodes.find(({ id }) => id === "first::a").count, 3);
  model.setGraph({ nodes: [second], edges: [] });
  assert.deepEqual(model.snapshot().nodes, [{ ...survivor, id: "a" }]);
  advance(100);
  read("first");
  const [updated] = model.snapshot().nodes;
  assert.equal(updated.count, 2);
  assert.equal(updated.firstSequence, 3);
  model.setGraph(combined);
  assert.deepEqual(model.snapshot().nodes, [{ ...updated, id: "other::a" }]);
});

test("same-path aliases without mount metadata retain exact IDs but never guess an ambiguous rename", (t) => {
  const { model, aliases, read } = aliasFixture(t);
  const { atlasKey, ...first } = aliases[0];
  const second = { ...first, id: "second" };
  model.setGraph({ nodes: [first], edges: [] });
  read("first");
  const before = model.snapshot().nodes;
  model.setGraph({ nodes: [second, first], edges: [] });
  assert.deepEqual(model.snapshot().nodes, before);
  model.setGraph({ nodes: [first, second], edges: [] });
  assert.deepEqual(model.snapshot().nodes, before);
  model.setGraph({ nodes: [{ ...first, id: "renamed" }], edges: [] });
  assert.deepEqual(model.snapshot().nodes, []);
  read("first");
  assert.equal(model.snapshot().nodes[0].count, 1);
  assert.equal(model.snapshot().nodes[0].firstSequence, 2);
});

test("changing a lexical alias or its mount key does not transfer the same physical file's record", (t) => {
  const { model, aliases, read } = aliasFixture(t);
  for (const replacement of [
    { ...aliases[0], storeRoot: aliases[2].storeRoot },
    { ...aliases[0], atlasKey: "replacement" },
  ]) {
    model.setGraph({ nodes: aliases.slice(0, 2), edges: [] });
    read("first");
    read("second");
    const before = model.snapshot().nodes.find(({ id }) => id === "second");
    model.setGraph({ nodes: [replacement, aliases[1]], edges: [] });
    assert.deepEqual(model.snapshot().nodes, [before]);
  }
});

test("retargeting a symlink invalidates only that alias even when its ID and lexical path are unchanged", (t) => {
  const { model, graph, root, read, advance } = aliasFixture(t);
  read("first");
  advance(100);
  read("second");
  const before = model.snapshot().nodes.find(({ id }) => id === "second");
  const replacement = join(root, "replacement");
  mkdirSync(replacement);
  writeFileSync(join(replacement, "a.md"), "# Replacement");
  rmSync(join(root, "first"));
  symlinkSync(replacement, join(root, "first"));
  model.setGraph({ ...graph });
  assert.deepEqual(model.snapshot().nodes, [before]);
  advance(100);
  read("first");
  const fresh = model.snapshot().nodes.find(({ id }) => id === "first");
  assert.equal(fresh.count, 1);
  assert.equal(fresh.sequence, 3);
  assert.equal(fresh.firstSequence, 3);
  assert.equal(fresh.accessedAt, 1200);
  assert.equal(model.files.get("first"), realpathSync(join(replacement, "a.md")));
  assert.deepEqual(model.snapshot().nodes.find(({ id }) => id === "second"), before);
});

test("rebuilding and qualifying aliases expire their distinct intervals independently", (t) => {
  const { model, graph, read, advance } = aliasFixture(t);
  read("first");
  advance(3000);
  read("second");
  const before = model.snapshot().nodes.find(({ id }) => id === "second");
  advance(2000);
  model.setGraph({ ...graph, nodes: [...graph.nodes].reverse() });
  assert.deepEqual(model.snapshot().nodes, [before]);
  model.setGraph({
    nodes: graph.nodes.map((node) => ({ ...node, id: `${node.id}::a` })),
    edges: [],
  });
  assert.deepEqual(model.snapshot().nodes, [{ ...before, id: "second::a" }]);
  advance(3000);
  model.setGraph({ ...graph });
  assert.deepEqual(model.snapshot().nodes, []);
  read("first");
  assert.equal(model.snapshot().nodes[0].sequence, 3);
  assert.equal(model.snapshot().nodes[0].count, 1);
  assert.equal(model.snapshot().nodes[0].firstSequence, 3);
});
