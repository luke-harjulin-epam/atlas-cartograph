import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { BUNDLED_MINI_ATLAS, discoverAtlasPresets } from "../.apm/extensions/cartograph/atlas/catalog.mjs";
import { freshState, openDefaultAtlases } from "../.apm/extensions/cartograph/server.mjs";

const repository = fileURLToPath(new URL("../", import.meta.url));
const fixtures = join(repository, ".atlas", "local");

function filesIn(root, prefix = "") {
  return readdirSync(join(root, prefix), { withFileTypes: true }).flatMap((entry) => {
    assert.ok(!entry.isSymbolicLink(), `Development fixtures must be portable: ${entry.name}`);
    const path = join(prefix, entry.name);
    return entry.isDirectory() ? filesIn(root, path) : [path];
  }).sort();
}

test("repository development Atlases mount together on a fresh checkout without running a workload", (t) => {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "cartograph-development-")));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  cpSync(join(repository, ".atlas"), join(cwd, ".atlas"), { recursive: true });
  const expectedRoots = ["mini-atlas", "stress-test-atlas"].map((name) => join(cwd, ".atlas", "local", name));
  assert.deepEqual(discoverAtlasPresets(cwd).map(({ root }) => root), expectedRoots);
  const state = openDefaultAtlases(freshState(cwd));
  assert.equal(state.error, null);
  assert.equal(state.phase, "map");
  assert.deepEqual(state.roots, expectedRoots);
  assert.deepEqual(state.graph.stores.map(({ atlasId }) => atlasId), ["cartograph-mini", "cartograph-stress-test"]);
  assert.equal(state.graph.nodes.length, 510);
  assert.equal(state.graph.edges.length, 1519);
  assert.equal(new Set(state.graph.nodes.map(({ id }) => id)).size, 510);
  assert.deepEqual(state.activity.nodes, []);
  assert.deepEqual(state.graphChanges.created, []);
  assert.deepEqual(state.graphChanges.deleted, []);
});

test("the repository mini Atlas stays identical to the self-contained packaged sample", () => {
  const local = join(fixtures, "mini-atlas");
  const paths = filesIn(BUNDLED_MINI_ATLAS);
  assert.deepEqual(filesIn(local), paths);
  for (const path of paths) {
    assert.deepEqual(readFileSync(join(local, path)), readFileSync(join(BUNDLED_MINI_ATLAS, path)), path);
  }
});

test("the preserved stress baseline has all 500 read targets and 1508 relationships", () => {
  const root = join(fixtures, "stress-test-atlas");
  const paths = filesIn(root);
  assert.equal(paths.filter((path) => path.endsWith(".md")).length, 505);
  assert.equal(paths.filter((path) => /read-\d{3}\.md$/.test(path)).length, 500);
  assert.equal(paths.length, 506);
  const state = openDefaultAtlases(freshState(repository), { root });
  assert.equal(state.error, null);
  assert.equal(state.graph.store.atlasId, "cartograph-stress-test");
  assert.equal(state.graph.nodes.length, 505);
  assert.equal(state.graph.edges.length, 1508);
  for (const path of paths) {
    assert.doesNotMatch(readFileSync(join(root, path), "utf8"), /\/Users\/|\/home\/|session-state\/|-----BEGIN .*PRIVATE KEY-----/);
  }
});
