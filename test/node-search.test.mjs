import assert from "node:assert/strict";
import test from "node:test";
import { describeNode, matchesNodeQuery, nodeSearchText } from "../.apm/extensions/cartograph/public/node-search.js";
import { activationFocusNodes } from "../.apm/extensions/cartograph/public/activity-camera.js";

const node = {
  id: "north::reading", title: "Calibration result", type: "instrument", kind: "work",
  path: "observations/sensor.md", atlasLabel: "Northern observatory", atlasKey: "north",
  storeRoot: "/workspace/observatory",
};

test("one matcher covers title, ID, type, kind, Atlas and full path", () => {
  for (const query of ["calibration", "north::reading", "INSTRUMENT", "work", "Northern observatory", "observations/sensor.md", "/workspace/observatory", ""]) {
    assert.equal(matchesNodeQuery(node, query), true, query);
  }
  assert.equal(matchesNodeQuery(node, "not present"), false);
  assert.ok(describeNode(node).includes("Northern observatory"));
});

test("declared custom types remain searchable by their independent rendering kind", () => {
  const typed = { ...node, kind: "page", typeKey: "science:instrument", schemaLabel: "Science" };
  assert.equal(describeNode(typed).toLowerCase().includes("page"), false);
  assert.equal(matchesNodeQuery(typed, "instrument"), true);
  assert.equal(matchesNodeQuery(typed, "page"), true);
});

test("pre-indexed map nodes agree with search results including store-label fallbacks", () => {
  const raw = { id: "page", title: "Result", kind: "page", path: "page.md" };
  const state = { graph: { store: { label: "Remote science", atlasId: "science", root: "/science" } } };
  const indexed = { ...raw, searchText: nodeSearchText(raw, state) };
  for (const query of ["science", "/science", "page.md", "result", "missing"]) {
    assert.equal(matchesNodeQuery(indexed, query), matchesNodeQuery(raw, query, state));
  }
});

test("indexed renderer matching does not rebuild descriptions every frame", () => {
  const indexed = { ...node, searchText: nodeSearchText(node) };
  Object.defineProperty(indexed, "title", { get() { assert.fail("Unexpected description rebuild"); } });
  for (let frame = 0; frame < 120; frame++) assert.equal(matchesNodeQuery(indexed, "sensor.md"), true);
});

test("activity framing uses the same metadata queries as search results", () => {
  const activity = { nodes: new Map([[node.id, 1]]) };
  for (const query of ["northern", "instrument", "sensor.md"]) {
    assert.deepEqual(activationFocusNodes([node], activity, null, query), [node]);
  }
  assert.deepEqual(activationFocusNodes([node], activity, null, "missing"), []);
});
