import assert from "node:assert/strict";
import test from "node:test";
import * as browser from "../.apm/extensions/cartograph/public/universe.js";
import * as server from "../.apm/extensions/cartograph/atlas/universe.mjs";

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
