import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { readSchemaCatalog } from "../.apm/extensions/cartograph/atlas/schema.mjs";
import { loadCombinedGraphs, loadFullGraph, loadPage } from "../.apm/extensions/cartograph/atlas/scan.mjs";
import { freshState, openAtlas, refreshAtlases, selectNode, setLayers, startServer } from "../.apm/extensions/cartograph/server.mjs";
import { allNodeLayersOn, applyLayerClick } from "../.apm/extensions/cartograph/public/layer-controls.js";
import { layerCounts, nodeLayer, nodeLayerKeys, normalizeLayers } from "../.apm/extensions/cartograph/public/node-layers.js";
import { layoutUniverse } from "../.apm/extensions/cartograph/public/universe.js";

const declarations = (...ids) => Object.fromEntries(ids.map((id) => [id, {
  file: `templates/${id}.md`,
  frontmatter: { required: ["type", "title"] },
}]));

function put(root, path, content) {
  const parts = path.split("/");
  mkdirSync(join(root, ...parts.slice(0, -1)), { recursive: true });
  writeFileSync(join(root, path), typeof content === "string" ? content : JSON.stringify(content));
}

function fixture(t) {
  const cwd = realpathSync(mkdtempSync(resolve("test/.schema-fixture-")));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const root = join(cwd, "observatory");
  put(root, "SCHEMA.json", {
    atlas_id: "observatory",
    templates: { by_type: declarations("work", "document", "protostar") },
  });
  put(root, "index.md", "# Observatory\n");
  put(root, "notes.md", "---\ntype: document\ntitle: Observation notes\n---\n");
  return { cwd, root };
}

function overlay(root, id = "observations", types = ["instrument", "observation", "calibration"]) {
  put(root, `schema.d/${id}.json`, {
    contribution_id: id,
    claimed_folders: ["templates/instrument.md"],
    templates: { by_type: declarations(...types) },
  });
}

function samplePages(root) {
  put(root, "archive/instrument.md", "---\ntype: instrument\ntitle: Telescope Alpha\n---\n");
  put(root, "observations/observation.md", [
    "---", "type: observation", "title: Fictional observation", "relates_to:",
    "  - path: archive/instrument.md", "    kind: uses", "---", "",
  ].join("\n"));
  put(root, "observations/core.md", "---\ntype: document\ntitle: Setup guide\n---\n");
  put(root, "observations/unknown.md", "---\ntype: field-note\ntitle: Unclassified note\n---\n");
}

async function until(predicate) {
  const deadline = Date.now() + 5000;
  while (!predicate() && Date.now() < deadline) await delay(20);
  assert.ok(predicate(), "schema update reaches the graph");
}

test("base declarations include types outside the legacy rendering set and empty types", (t) => {
  const { root, cwd } = fixture(t);
  const graph = loadFullGraph(root, cwd, { strict: true });
  assert.equal(graph.schemas.length, 1);
  assert.equal(graph.schemas[0].origin, "core");
  assert.equal(graph.schemas[0].label, "Core");
  assert.deepEqual(graph.schemas[0].types.map((type) => type.id), ["document", "protostar", "work"]);
  const node = graph.nodes.find((item) => item.path === "notes.md");
  assert.equal(node.kind, "page");
  assert.equal(node.declaredType, "document");
  assert.equal(node.schemaKey, graph.schemas[0].key);
  assert.equal(nodeLayer(node), node.typeKey);
  assert.equal(layerCounts(graph).get(node.typeKey), 1);
  assert.ok(nodeLayerKeys(graph).includes(graph.schemas[0].types.find((type) => type.id === "protostar").key));
  assert.deepEqual(graph.schemaDiagnostics, []);
});

test("custom records retain identity and links independently of their folders", (t) => {
  const { root, cwd } = fixture(t);
  overlay(root);
  samplePages(root);
  const graph = loadFullGraph(root, cwd, { strict: true });
  const schema = graph.schemas.find((item) => item.contributionId === "observations");
  const instrument = graph.nodes.find((node) => node.type === "instrument");
  assert.equal(instrument.id, "archive/instrument");
  assert.equal(instrument.kind, "page");
  assert.equal(instrument.schemaKey, schema.key);
  assert.equal(graph.nodes.find((node) => node.path === "observations/core.md").schemaLabel, "Core");
  assert.equal(graph.nodes.find((node) => node.type === "field-note").typeKey, undefined);
  assert.equal(graph.nodes.find((node) => node.path === "index.md").declaredType, "");
  assert.ok(graph.edges.some((edge) => edge.source === "observations/observation" &&
    edge.target === "archive/instrument" && edge.relKind === "uses"));
  const page = loadPage(root, instrument.id, cwd);
  assert.equal(page.typeKey, instrument.typeKey);
  assert.equal(page.schemaKey, instrument.schemaKey);
});

test("receipts, template constraints and contribution extension payloads do not become graph metadata", (t) => {
  const { root, cwd } = fixture(t);
  overlay(root);
  const path = "schema.d/observations.json";
  const data = JSON.parse(readFileSync(join(root, path), "utf8"));
  data.observations = { content_root: "not-a-membership-rule", notes: "extension-payload-sentinel" };
  data.templates.by_type.instrument.sections = { required: ["constraint-payload-sentinel"] };
  data.templates.by_type.instrument.file = "../never-read-template-sentinel";
  put(root, path, data);
  put(root, "schema.d/observations.receipt.json", "{ malformed receipt is not a schema");
  put(root, "schema.d/.temporary.json", "{");
  const graph = loadFullGraph(root, cwd, { strict: true });
  assert.equal(graph.schemas.length, 2);
  assert.deepEqual(graph.schemaDiagnostics, []);
  const serialized = JSON.stringify([graph.schemas, graph.store.schemaCatalog]);
  for (const marker of ["extension-payload-sentinel", "constraint-payload-sentinel", "never-read-template-sentinel"]) {
    assert.ok(!serialized.includes(marker));
  }
});

test("multiple contributions and pagination retain every declaration", (t) => {
  const { root, cwd } = fixture(t);
  overlay(root);
  overlay(root, "weather", ["weather-reading", "forecast"]);
  for (let i = 0; i < 90; i++) {
    put(root, `readings/${i}.md`, `---\ntype: weather-reading\ntitle: Reading ${i}\n---\n`);
  }
  const graph = loadFullGraph(root, cwd, { strict: true });
  assert.equal(graph.complete, true);
  assert.equal(graph.schemas.length, 3);
  assert.equal(graph.nodes.filter((node) => node.schemaLabel === "weather").length, 90);
  assert.equal(graph.schemas.find((schema) => schema.label === "weather").types.length, 2);
});

test("same contribution and type names across stores use distinct controls and layout islands", (t) => {
  const { root, cwd } = fixture(t);
  overlay(root);
  samplePages(root);
  const second = join(cwd, "second");
  put(second, "SCHEMA.json", { atlas_id: "second", templates: { by_type: declarations("document") } });
  overlay(second);
  samplePages(second);
  const graph = loadCombinedGraphs([root, second], cwd, { strict: true });
  const instruments = graph.nodes.filter((node) => node.type === "instrument");
  assert.equal(instruments.length, 2);
  assert.notEqual(instruments[0].typeKey, instruments[1].typeKey);
  assert.notEqual(instruments[0].schemaKey, instruments[1].schemaKey);
  assert.notEqual(instruments[0].id, instruments[1].id);
  const before = structuredClone(graph.nodes);
  for (const grouping of ["layers", "atlases", "proximity"]) {
    const laid = layoutUniverse(graph.nodes, graph.edges, grouping);
    assert.ok(laid.every((node) => [node.lon, node.lat, node.targetShell].every(Number.isFinite)));
    if (grouping === "layers") {
      assert.notEqual(laid.find((node) => node.id === instruments[0].id).galaxyKey,
        laid.find((node) => node.id === instruments[1].id).galaxyKey);
    }
  }
  assert.deepEqual(graph.nodes, before);
});

test("All, schema groups, individual types and relationship toggles remain independent", (t) => {
  const { root, cwd } = fixture(t);
  overlay(root);
  samplePages(root);
  const graph = loadFullGraph(root, cwd);
  const schema = graph.schemas.find((item) => item.origin === "contribution");
  const keys = nodeLayerKeys(graph);
  const members = schema.types.map((type) => type.key);
  let layers = normalizeLayers({ sources: false }, keys);
  layers = applyLayerClick(layers, schema.key, keys, members);
  assert.deepEqual(keys.filter((key) => layers[key]), members);
  assert.equal(layers.sources, false);
  assert.equal(layers.relations, true);
  layers = applyLayerClick(layers, members[0], keys);
  assert.equal(layers[members[0]], false);
  layers = applyLayerClick(layers, "all", keys);
  assert.equal(allNodeLayersOn(layers), true);
  assert.equal(layers.sources, false);
  layers = applyLayerClick(layers, "sources", keys);
  assert.equal(layers.sources, true);
  assert.deepEqual(applyLayerClick(layers, "missing-key", keys), layers);
});

test("conflicting types and duplicate contributions are diagnosed without arbitrary ownership", (t) => {
  const { root, cwd } = fixture(t);
  overlay(root, "first", ["instrument", "document"]);
  overlay(root, "second", ["instrument", "calibration"]);
  samplePages(root);
  let graph = loadFullGraph(root, cwd);
  assert.equal(graph.nodes.find((node) => node.type === "instrument").schemaKey, undefined);
  assert.equal(graph.nodes.find((node) => node.path === "notes.md").schemaKey, undefined);
  assert.ok(graph.schemaDiagnostics.every((item) => item.code === "conflicting-type"));
  overlay(root, "duplicate", ["duplicate-type"]);
  const duplicate = JSON.parse(readFileSync(join(root, "schema.d/duplicate.json"), "utf8"));
  put(root, "schema.d/another.json", duplicate);
  graph = loadFullGraph(root, cwd);
  assert.ok(!graph.schemas.some((schema) => schema.contributionId === "duplicate"));
  assert.equal(graph.schemaDiagnostics.filter((item) => item.code === "duplicate-contribution").length, 2);
});

test("malformed and invalid schema inputs retain pages and return content-free diagnostics", (t) => {
  const { root, cwd } = fixture(t);
  put(root, "schema.d/broken.json", '{"unrelated-sensitive-sentinel":');
  put(root, "schema.d/array.json", []);
  put(root, "schema.d/no-id.json", { templates: { by_type: {} } });
  put(root, "schema.d/bad-types.json", { contribution_id: "bad-types", templates: { by_type: [] } });
  put(root, "schema.d/bad-type.json", { contribution_id: "bad-type", templates: { by_type: { broken: "bad" } } });
  const graph = loadFullGraph(root, cwd, { strict: true });
  assert.equal(graph.nodes.length, 2);
  for (const code of ["unreadable", "invalid-object", "invalid-contribution", "invalid-types", "invalid-type"]) {
    assert.ok(graph.schemaDiagnostics.some((item) => item.code === code), code);
  }
  assert.ok(!JSON.stringify(graph.schemaDiagnostics).includes("unrelated-sensitive-sentinel"));
  assert.ok(!JSON.stringify(graph.schemaDiagnostics).includes(root));
});

test("oversize and out-of-store metadata is refused without reading its payload", (t) => {
  const { root, cwd } = fixture(t);
  put(root, "schema.d/large.json", " ".repeat(1024 * 1024 + 1));
  put(cwd, "external.json", { contribution_id: "external", templates: { by_type: declarations("external-type") } });
  symlinkSync(join(cwd, "external.json"), join(root, "schema.d/external.json"));
  let catalog = readSchemaCatalog(root);
  assert.ok(catalog.diagnostics.some((item) => item.code === "invalid-file"));
  assert.ok(catalog.diagnostics.some((item) => item.code === "outside-store"));
  assert.ok(!catalog.schemas.some((schema) => schema.contributionId === "external"));
  rmSync(join(root, "schema.d"), { recursive: true });
  mkdirSync(join(cwd, "external-directory"));
  symlinkSync(join(cwd, "external-directory"), join(root, "schema.d"));
  catalog = readSchemaCatalog(root);
  assert.ok(catalog.diagnostics.some((item) => item.source === "schema.d" && item.code === "outside-store"));
});

test("unreadable schema files produce diagnostics without page loss", (t) => {
  if (process.getuid?.() === 0 || process.platform === "win32") return t.skip("requires Unix permission enforcement");
  const { root, cwd } = fixture(t);
  overlay(root);
  const file = join(root, "schema.d/observations.json");
  chmodSync(file, 0);
  try {
    const graph = loadFullGraph(root, cwd, { strict: true });
    assert.equal(graph.nodes.length, 2);
    assert.ok(graph.schemaDiagnostics.some((item) => item.code === "unreadable"));
  } finally {
    chmodSync(file, 0o600);
  }
});

test("legacy and undeclared pages remain renderable with no schema", (t) => {
  const { root, cwd } = fixture(t);
  rmSync(join(root, "SCHEMA.json"));
  let graph = loadFullGraph(root, cwd);
  assert.equal(graph.nodes.length, 2);
  assert.deepEqual(graph.schemas, []);
  assert.ok(graph.nodes.every((node) => node.typeKey === undefined));
  put(root, "SCHEMA.md", "# Legacy schema");
  put(root, "knowledge/topic.md", "# Topic");
  graph = loadFullGraph(root, cwd);
  assert.equal(graph.store.format, "okf-wiki");
  assert.deepEqual(graph.schemas, []);
  assert.ok(graph.nodes.some((node) => node.path === "knowledge/topic.md"));
});

test("removing declarations prunes old filters and reveals undeclared pages without changing identities", (t) => {
  const { root, cwd } = fixture(t);
  overlay(root);
  samplePages(root);
  const state = freshState(cwd, { skipIntro: true });
  openAtlas(state, root);
  const node = state.graph.nodes.find((item) => item.type === "instrument");
  const oldKey = node.typeKey;
  selectNode(state, node.id);
  setLayers(state, { [oldKey]: false, other: false, sources: false });
  const previous = state.layersRevision;
  rmSync(join(root, "schema.d/observations.json"));
  assert.equal(refreshAtlases(state), true);
  assert.equal(Object.hasOwn(state.layers, oldKey), false);
  assert.equal(state.layers.other, true);
  assert.equal(state.layers.sources, false);
  assert.ok(state.layersRevision > previous);
  assert.equal(state.selectedId, node.id);
  assert.equal(state.page.typeKey, undefined);
  overlay(root);
  refreshAtlases(state);
  assert.equal(state.graph.nodes.find((item) => item.id === node.id).typeKey, oldKey);
  assert.equal(state.layers[oldKey], true);
  setLayers(state, { [oldKey]: false });
  selectNode(state, node.id);
  assert.equal(state.layers[oldKey], true);
  assert.throws(() => setLayers(state, { [oldKey]: "false" }), /boolean/);
});

test("native schema-only changes update metadata without page lifecycle effects or restart", async (t) => {
  const { root, cwd } = fixture(t);
  samplePages(root);
  const state = freshState(cwd, { skipIntro: true });
  state.activity.enabled = false;
  openAtlas(state, root);
  const node = state.graph.nodes.find((item) => item.type === "instrument");
  selectNode(state, node.id);
  state.query = "Telescope";
  state.grouping = "proximity";
  const entry = await startServer("schema-live", state, {
    activity: { platform: "unsupported" },
    graphWatch: { debounceMs: 20, maxWaitMs: 100 },
  });
  t.after(() => entry.close());
  overlay(root);
  await until(() => state.graph.schemas.some((schema) => schema.contributionId === "observations"));
  assert.equal(state.selectedId, node.id);
  assert.ok(state.page.typeKey);
  assert.equal(state.query, "Telescope");
  assert.equal(state.grouping, "proximity");
  assert.deepEqual(state.graphChanges.created, []);
  assert.deepEqual(state.graphChanges.deleted, []);
  assert.deepEqual(state.graphChanges.createdEdges, []);
  assert.deepEqual(state.graphChanges.deletedEdges, []);
  overlay(root, "observations", ["instrument", "observation", "calibration", "spectrum"]);
  await until(() => state.graph.schemas.some((schema) => schema.types.some((type) => type.id === "spectrum")));
  rmSync(join(root, "schema.d/observations.json"));
  await until(() => !state.graph.schemas.some((schema) => schema.contributionId === "observations"));
  assert.equal(state.page.typeKey, undefined);
  assert.deepEqual(state.graphChanges.deleted, []);
  const response = await fetch(new URL("/api/bootstrap", entry.url), {
    headers: { "X-Cartograph-Client": "canvas" },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).state.graph.schemas.length, 1);
});
