import assert from "node:assert/strict";
import test from "node:test";
import * as browser from "../.apm/extensions/cartograph/public/universe.js";
import * as server from "../.apm/extensions/cartograph/atlas/universe.mjs";

function countMapOperations(run) {
  const NativeMap = globalThis.Map;
  const counts = { gets: 0, values: 0 };
  globalThis.Map = class extends NativeMap {
    get(key) {
      counts.gets++;
      return super.get(key);
    }
    *values() {
      for (const value of super.values()) {
        counts.values++;
        yield value;
      }
    }
  };
  try {
    return { result: run(), counts };
  } finally {
    globalThis.Map = NativeMap;
  }
}

function assertLayout(nodes, laid, expected) {
  assert.deepEqual(laid.map((node) => node.id), nodes.map((node) => node.id));
  assert.equal(laid.length, expected.length);
  for (let i = 0; i < laid.length; i++) {
    const [label, mass, lon, lat, shell] = expected[i];
    assert.equal(laid[i].galaxy, label);
    assert.equal(laid[i].galaxyLabel, label);
    assert.equal(laid[i].clusterKind, nodes[i].kind);
    for (const [key, value] of Object.entries({ mass, lon, lat, targetShell: shell })) {
      assert.ok(Math.abs(laid[i][key] - value) < 1e-12, `${nodes[i].id}: ${key}`);
    }
  }
}

test("Node and browser entry points share the same layout implementation", () => {
  assert.deepEqual(Object.keys(server), Object.keys(browser));
  for (const name of Object.keys(browser)) assert.equal(server[name], browser[name], name);
});

test("shared layout preserves all grouping modes without mutating graph data", () => {
  const nodes = [
    { id: "index", kind: "index", title: "Index", degree: 1, sourceCount: 0, atlasKey: "one" },
    { id: "work/task", kind: "work", title: "Task", degree: 1, sourceCount: 1, atlasKey: "one" },
    { id: "decisions/choice", kind: "decision", title: "Choice", degree: 0, sourceCount: 0, atlasKey: "two" },
  ];
  const edges = [{ source: "index", target: "work/task" }];
  const original = structuredClone({ nodes, edges });
  for (const grouping of ["layers", "proximity", "atlases"]) {
    const laid = server.layoutUniverse(nodes, edges, grouping);
    assert.deepEqual(laid, browser.layoutUniverse(nodes, edges, grouping));
    assert.deepEqual(laid.map((node) => node.id), nodes.map((node) => node.id));
    assert.ok(laid.every((node) => [node.mass, node.lat, node.lon, node.targetShell].every(Number.isFinite)));
  }
  assert.deepEqual(server.layoutUniverse(nodes, edges).map((node) => node.galaxy), ["Index", "Work", "Decisions"]);
  assert.deepEqual(server.layoutUniverse(nodes, edges, "atlases").map((node) => node.galaxy), ["one", "one", "two"]);
  assert.deepEqual({ nodes, edges }, original);
});

test("sorted sibling positions are stable across input order in every grouping", () => {
  const nodes = Array.from({ length: 19 }, (_, i) => ({
    id: `work/shared/${String(i).padStart(2, "0")}`, kind: "work",
    degree: i % 4, sourceCount: i % 3, atlasKey: "one",
  }));
  for (const grouping of ["layers", "atlases", "proximity"]) {
    const forward = browser.layoutUniverse(nodes, [], grouping);
    const backward = browser.layoutUniverse([...nodes].reverse(), [], grouping).reverse();
    assert.deepEqual(backward, forward);
  }
});

test("large single-Atlas layout does not rescan siblings for each node", () => {
  let idReads = 0;
  const count = 3200;
  const nodes = Array.from({ length: count }, (_, i) => ({
    get id() { idReads++; return `work/${String(count - i).padStart(4, "0")}`; },
    kind: "work", degree: 1, sourceCount: 1, atlasKey: "one",
  }));
  const laid = browser.layoutUniverse(nodes, [], "atlases");
  assert.equal(laid.length, count);
  assert.ok(idReads < count * 100, `${idReads} ID reads exceeded the non-quadratic work bound`);
  assert.ok(laid.every((node) => [node.mass, node.lat, node.lon, node.targetShell].every(Number.isFinite)));
});

test("one-node-per-Atlas layout indexes labels without rescanning nodes", () => {
  let keyReads = 0;
  const count = 2048;
  const nodes = Array.from({ length: count }, (_, i) => ({
    id: `raw/${i}`, kind: "raw", degree: 0, sourceCount: 0,
    get atlasKey() { keyReads++; return `atlas-${count - i}`; },
    atlasLabel: `Atlas ${i}`,
  }));
  const laid = browser.layoutUniverse(nodes, [], "atlases");
  assert.ok(keyReads < count * 8, `${keyReads} Atlas key reads exceeded the linear work bound`);
  assert.deepEqual(laid.map((node) => node.id), nodes.map((node) => node.id));
  assert.deepEqual(laid.map((node) => node.galaxy), nodes.map((node) => node.atlasLabel));
  assert.equal(new Set(laid.map((node) => `${node.lon}:${node.lat}`)).size, count);
});

test("proximity compresses long union-find chains with linear map reads", () => {
  const count = 4096;
  const nodes = Array.from({ length: count }, (_, i) => ({
    id: `raw/${i}`, kind: i === 0 ? "index" : "raw", title: `Node ${i}`,
    degree: 1, sourceCount: 0,
  }));
  const edges = nodes.slice(1).map((node, i) => ({ source: nodes[i].id, target: node.id }));
  const { result: assigned, counts } = countMapOperations(() => browser.assignProximity(nodes, edges));
  assert.ok(counts.gets < count * 30, `${counts.gets} Map reads exceeded the linear work bound`);
  assert.deepEqual([...assigned.keys()], nodes.map((node) => node.id));
  for (const cluster of assigned.values()) {
    assert.deepEqual(cluster, { key: "comp:raw/0", label: "Node 0" });
  }
});

test("disconnected proximity nodes index labels without rescanning assignments", () => {
  const count = 2048;
  const nodes = Array.from({ length: count }, (_, i) => ({
    id: `raw/${i}`, title: `Isolated ${i}`, kind: "raw", degree: 0, sourceCount: 0,
  }));
  const { result: laid, counts } = countMapOperations(() => browser.layoutUniverse(nodes, [], "proximity"));
  assert.ok(counts.values < count * 8, `${counts.values} Map value visits exceeded the linear work bound`);
  assert.deepEqual(laid.map((node) => node.id), nodes.map((node) => node.id));
  assert.deepEqual(laid.map((node) => node.galaxy), nodes.map((node) => node.title));
  assert.equal(new Set(laid.map((node) => `${node.lon}:${node.lat}`)).size, count);
});

test("Atlas homes preserve first labels, fallbacks, separate keys, and positions", () => {
  const nodes = [
    { id: "raw/a", atlasKey: "z", atlasLabel: "First" },
    { id: "raw/b", atlasKey: "z", atlasLabel: "Later" },
    { id: "raw/c", atlasKey: "b", atlasLabel: "" },
    { id: "raw/d", atlasKey: "b", atlasLabel: "Not the first" },
    { id: "raw/e", atlasLabel: "Label only" },
    { id: "raw/f", atlasId: "ID only" },
    { id: "raw/g" },
    { id: "raw/h", atlasKey: "a", atlasLabel: "First" },
  ].map((node) => ({ kind: "raw", degree: 1, sourceCount: 0, ...node }));
  assertLayout(nodes, browser.layoutUniverse(nodes, [], "atlases"), [
    ["First", 0.5384, 5.774797342299137, 2.556429224716077, 0.807696],
    ["First", 0.5384, 5.658114857980122, 2.555292690885352, 0.807696],
    ["b", 0.5384, 3.3750671393916964, 2.0949786347584536, 0.727696],
    ["b", 0.5384, 3.2588509358373425, 2.0939642242264687, 0.727696],
    ["Label only", 0.5384, 4.857626451977686, 1.403748951083736, 0.807696],
    ["ID only", 0.5384, 2.4580131599981137, 1.0476891349204434, 0.727696],
    ["Atlas", 0.5384, 0.057933321885458966, 0.5861467150355143, 0.647696],
    ["First", 0.5384, 0.9759290820334465, 1.7385654625094555, 0.647696],
  ]);
});

test("proximity preserves component seeds, predefined groups, assignment order, and positions", () => {
  const nodes = [
    { id: "raw/a", title: "First member" },
    { id: "raw/b", kind: "decision", title: "Decision seed" },
    { id: "raw/c", kind: "index", title: "Index seed" },
    { id: "raw/d", title: "Second group" },
    { id: "raw/e", kind: "module", title: "Module seed" },
    { id: "raw/f", title: "Isolated" },
    { id: "work/project/page", title: "Folder page" },
    { id: "work/project/index", title: "Folder index" },
    { id: "raw/w", kind: "work", workId: "known", title: "Named work" },
    { id: "raw/k", work_id: "known" },
  ].map((node) => ({ kind: "raw", degree: 1, sourceCount: 0, ...node }));
  const edges = [
    ["raw/a", "raw/b"], ["raw/b", "raw/c"], ["raw/c", "raw/a"],
    ["raw/d", "raw/e"], ["raw/e", "raw/e"], ["raw/a", "missing"],
    ["raw/c", "work/project/page"], ["raw/e", "raw/w"], ["work/project/index", "raw/k"],
  ].map(([source, target]) => ({ source, target }));
  const expectedAssignments = [
    ["work/project/page", { key: "folder:work/project", label: "Project" }],
    ["work/project/index", { key: "folder:work/project", label: "Project" }],
    ["raw/w", { key: "work:known", label: "Named work" }],
    ["raw/k", { key: "work:known", label: "Named work" }],
    ["raw/a", { key: "comp:raw/c", label: "Index seed" }],
    ["raw/b", { key: "comp:raw/c", label: "Index seed" }],
    ["raw/c", { key: "comp:raw/c", label: "Index seed" }],
    ["raw/d", { key: "comp:raw/e", label: "Module seed" }],
    ["raw/e", { key: "comp:raw/e", label: "Module seed" }],
    ["raw/f", { key: "comp:raw/f", label: "Isolated" }],
  ];
  assert.deepEqual([...browser.assignProximity(nodes, edges)], expectedAssignments);
  const laid = browser.layoutUniverse(nodes, edges, "proximity");
  assert.deepEqual(browser.layoutUniverse(nodes, [...edges].reverse(), "proximity"), laid);
  assertLayout(nodes, laid, [
    ["Index seed", 0.5384, 0.05816650083545838, 0.644023223376719, 0.647696],
    ["Index seed", 0.7664, 6.2531086959351505, 0.6761335125153636, 0.634016],
    ["Index seed", 0.85, 6.254763010816241, 0.6103352841728577, 0.629],
    ["Module seed", 0.5384, 2.457779905626335, 1.1597103588941353, 0.727696],
    ["Module seed", 0.8044, 2.3422632372082735, 1.1588787772188798, 0.711736],
    ["Isolated", 0.5384, 4.857976389726765, 1.571287910518742, 0.807696],
    ["Project", 0.5384, 0.8709468854877302, 1.9813325004183702, 0.647696],
    ["Project", 0.5384, 0.9655645699204634, 1.9851902288604806, 0.647696],
    ["Named work", 0.8196, 3.256873213772321, 2.497129544596127, 0.710824],
    ["Named work", 0.5384, 3.376009093233082, 2.498443371731024, 0.727696],
  ]);
});

test("empty layouts preserve every grouping mode", () => {
  for (const grouping of ["layers", "atlases", "proximity"]) {
    assert.deepEqual(browser.layoutUniverse([], [], grouping), []);
  }
});
