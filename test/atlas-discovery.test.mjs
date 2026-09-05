import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { allPresetSpecs, BUNDLED_MINI_ATLAS, discoverAtlasPresets } from "../.apm/extensions/cartograph/atlas/catalog.mjs";
import { freshState, hydrateStores, openAtlas, openDefaultAtlases, selectNode, startServer } from "../.apm/extensions/cartograph/server.mjs";

const runtime = fileURLToPath(new URL("../.apm/extensions/cartograph/", import.meta.url));

function workspace(t) {
  const cwd = realpathSync(mkdtempSync(resolve("test/.atlas-discovery-")));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  for (const name of ["ATLAS_ROOT", "ATLAS_VIEWER_ROOT", "OKF_WIKI_ROOT", "ATLAS_PRESETS"]) {
    const value = process.env[name];
    delete process.env[name];
    t.after(() => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    });
  }
  return cwd;
}

function store(root, id) {
  mkdirSync(root, { recursive: true });
  if (id) writeFileSync(join(root, "SCHEMA.json"), JSON.stringify({ atlas_id: id }));
  writeFileSync(join(root, "index.md"), `---\ntitle: ${id || "Atlas index"}\n---\n\n# Atlas\n`);
  return root;
}

test("absent .atlas opens the picker, never a bundled sample or legacy/env preset", (t) => {
  const cwd = workspace(t);
  const legacy = store(join(cwd, "atlas"), "legacy");
  process.env.ATLAS_ROOT = legacy;
  const state = freshState(cwd);
  assert.equal(state.phase, "crawl", "freshState retains its existing initialization contract");
  assert.equal(openDefaultAtlases(state), state);
  assert.equal(state.phase, "welcome");
  assert.equal(state.graph, null);
  assert.equal(state.root, "");
  assert.deepEqual(state.roots, []);
  assert.ok(state.stores.some((item) => item.root === legacy), "legacy choices remain available");
  rmSync(legacy, { recursive: true });
  delete process.env.ATLAS_ROOT;
  hydrateStores(state);
  assert.ok(state.stores.some((item) => item.root === BUNDLED_MINI_ATLAS));
  assert.equal(state.graph, null);
});

test("nested .atlas stores mount together once with distinct IDs and no legacy store", (t) => {
  const cwd = workspace(t);
  const first = store(join(cwd, ".atlas", "github.com", "org", "store"));
  const second = store(join(cwd, ".atlas", "gitlab.com", "org", "store"));
  store(join(cwd, "atlas"), "legacy");
  const state = openDefaultAtlases(freshState(cwd));
  assert.equal(state.error, null);
  assert.equal(state.phase, "map");
  assert.deepEqual(state.roots, [first, second]);
  assert.equal(state.grouping, "atlases");
  assert.equal(state.graph.stores.length, 2);
  assert.equal(state.graph.nodes.length, 2);
  assert.equal(new Set(state.graph.nodes.map((node) => node.id)).size, 2);
  assert.deepEqual(state.graph.stores.map((item) => item.root), state.roots);
  assert.deepEqual(state.stores.slice(0, 2).map((item) => item.root), state.roots);
  assert.equal(state.graphChanges.origin, "mount");
  assert.deepEqual(state.graphChanges.created, []);
  assert.deepEqual(state.activity.nodes, []);
  assert.equal(openDefaultAtlases(freshState(cwd), { skipIntro: false }).phase, "jump");
});

test("duplicate Atlas keys during default discovery leave the picker with an actionable error", (t) => {
  const cwd = workspace(t);
  const first = store(join(cwd, ".atlas", "local", "first"), "duplicate");
  const second = store(join(cwd, ".atlas", "local", "second"), "duplicate");
  const state = openDefaultAtlases(freshState(cwd));
  assert.equal(state.phase, "welcome");
  assert.equal(state.graph, null);
  assert.deepEqual(state.roots, []);
  assert.match(state.error, /Duplicate Atlas key "duplicate"/);
  assert.ok(state.error.includes(first));
  assert.ok(state.error.includes(second));
});

test(".atlas itself is a store, not an extra mount for each content directory", (t) => {
  const cwd = workspace(t);
  const root = store(join(cwd, ".atlas"), "workspace");
  store(join(root, "work", "nested-index"));
  const state = openDefaultAtlases(freshState(cwd));
  assert.deepEqual(state.roots, [root]);
  assert.equal(state.graph.stores.length, 1);
  assert.equal(state.graph.nodes.length, 2);
  assert.equal(state.grouping, "layers");
});

test(".atlas namespaces are data, including names normally skipped in source trees", (t) => {
  const cwd = workspace(t);
  const root = store(join(cwd, ".atlas", "github.com", "build", "staging"), "data");
  const state = openDefaultAtlases(freshState(cwd));
  assert.equal(state.error, null);
  assert.deepEqual(state.roots, [root]);
  assert.equal(state.graph.store.atlasId, "data");
});

test("a repository named knowledge does not turn its containing namespace into a store", (t) => {
  const cwd = workspace(t);
  const first = store(join(cwd, ".atlas", "github.com", "team", "knowledge"), "knowledge");
  const second = store(join(cwd, ".atlas", "github.com", "team", "other"), "other");
  const state = openDefaultAtlases(freshState(cwd));
  assert.deepEqual(state.roots, [first, second]);
  assert.equal(state.graph.stores.length, 2);
});

test("explicit relative roots, paths with spaces, samples and unavailable roots override discovery", (t) => {
  const cwd = workspace(t);
  store(join(cwd, ".atlas", "auto"), "auto");
  const explicit = store(join(cwd, "chosen store"), "chosen");
  let state = openDefaultAtlases(freshState(cwd), { root: "./chosen store", skipIntro: true });
  assert.deepEqual(state.roots, [explicit]);
  assert.equal(state.graph.store.atlasId, "chosen");
  state = openDefaultAtlases(freshState(cwd), { root: BUNDLED_MINI_ATLAS });
  assert.deepEqual(state.roots, [BUNDLED_MINI_ATLAS]);
  assert.equal(state.phase, "map");
  state = openDefaultAtlases(freshState(cwd), { root: "missing" });
  assert.deepEqual(state.roots, [join(cwd, "missing")]);
  assert.equal(state.phase, "welcome");
  assert.equal(state.graph.store.available, false);
  assert.ok(state.error);
});

test("picker puts .atlas first, deduplicates canonical mounts, and excludes installed runtimes and caches", (t) => {
  const cwd = workspace(t);
  const root = store(join(cwd, ".atlas", "github.com", "org", "store"), "actual");
  const legacy = store(join(cwd, "atlas"), "legacy");
  const cache = store(join(cwd, "apm_modules", "package", "fixtures", "mini-atlas"), "cache");
  const installed = store(join(cwd, ".github", "extensions", "cartograph", "fixtures", "mini-atlas"), "installed");
  const packaged = store(join(cwd, ".apm", "extensions", "cartograph", "fixtures", "mini-atlas"), "packaged");
  symlinkSync(root, join(cwd, ".atlas", "alias"), "dir");
  symlinkSync(join(cwd, ".atlas"), join(cwd, ".atlas", "cycle"), "dir");
  symlinkSync(join(cwd, ".atlas"), join(cwd, "visible-alias"), "dir");
  symlinkSync(cache, join(cwd, ".atlas", "cache-alias"), "dir");
  symlinkSync(installed, join(cwd, "installed-alias"), "dir");
  symlinkSync(packaged, join(cwd, ".atlas", "packaged-alias"), "dir");
  symlinkSync(BUNDLED_MINI_ATLAS, join(cwd, ".atlas", "runtime-alias"), "dir");
  process.env.ATLAS_ROOT = legacy;
  process.env.ATLAS_PRESETS = `Duplicate:${join(".atlas", "alias")},Legacy:atlas`;
  assert.deepEqual(discoverAtlasPresets(cwd).map((item) => item.root), [root]);
  assert.deepEqual(allPresetSpecs(cwd).map((item) => resolve(cwd, item.root)), [root, legacy]);
  const state = openDefaultAtlases(freshState(cwd));
  assert.deepEqual(state.roots, [root]);
  assert.deepEqual(state.stores.map((item) => item.root), [root, legacy]);
});

test("invalid .atlas paths and scan failures surface errors without replacing a valid graph", (t) => {
  const cwd = workspace(t);
  const explicit = store(join(cwd, "chosen"), "chosen");
  const state = freshState(cwd, { skipIntro: true });
  openAtlas(state, explicit);
  selectNode(state, "index");
  const graph = state.graph;
  const page = state.page;
  writeFileSync(join(cwd, ".atlas"), "not a directory");
  assert.throws(() => discoverAtlasPresets(cwd), /must be a directory/);
  openDefaultAtlases(state);
  assert.equal(state.graph, graph);
  assert.equal(state.page, page);
  assert.equal(state.selectedId, "index");
  assert.deepEqual(state.roots, [explicit]);
  assert.match(state.error, /Cannot open Atlas stores:.*\.atlas/);
  const override = openDefaultAtlases(freshState(cwd), { root: explicit });
  assert.equal(override.phase, "map", "a broken .atlas does not block explicit roots");
  assert.equal(override.graph.store.atlasId, "chosen");
  assert.match(override.error, /Cannot list Atlas stores:/);
  rmSync(join(cwd, ".atlas"));
  const invalid = store(join(cwd, ".atlas", "invalid"), "invalid");
  writeFileSync(join(invalid, "SCHEMA.json"), "{");
  openDefaultAtlases(state);
  assert.equal(state.graph, graph);
  assert.equal(state.page, page);
  assert.match(state.error, /Cannot open Atlas stores:/);
});

test("unreadable discovery directories and store files are visible, not empty graphs", (t) => {
  if (process.getuid?.() === 0 || process.platform === "win32") {
    t.skip("POSIX permission checks require a non-root user");
    return;
  }
  const cwd = workspace(t);
  const root = store(join(cwd, ".atlas", "nested", "atlas"), "protected");
  const branch = join(cwd, ".atlas", "nested");
  chmodSync(branch, 0);
  try {
    assert.throws(() => discoverAtlasPresets(cwd), /EACCES|EPERM/);
    const state = openDefaultAtlases(freshState(cwd));
    assert.equal(state.phase, "welcome");
    assert.equal(state.graph, null);
    assert.match(state.error, /EACCES|EPERM/);
  } finally {
    chmodSync(branch, 0o700);
  }
  const state = openDefaultAtlases(freshState(cwd));
  const graph = state.graph;
  chmodSync(join(root, "index.md"), 0);
  try {
    openDefaultAtlases(state);
    assert.equal(state.graph, graph);
    assert.match(state.error, /EACCES|EPERM/);
  } finally {
    chmodSync(join(root, "index.md"), 0o600);
  }
});

test("discovery has an explicit depth bound instead of silently opening a partial graph", (t) => {
  const cwd = workspace(t);
  store(join(cwd, ".atlas", ...Array.from({ length: 10 }, (_, i) => `level${i}`)), "deep");
  assert.throws(() => discoverAtlasPresets(cwd), /Atlas discovery limit exceeded/);
  const state = openDefaultAtlases(freshState(cwd));
  assert.equal(state.phase, "welcome");
  assert.equal(state.graph, null);
  assert.match(state.error, /discovery limit/);
});

test("bootstrap reports picker errors while keeping the last valid graph accessible", async (t) => {
  const cwd = workspace(t);
  store(join(cwd, ".atlas", "store"), "valid");
  const state = openDefaultAtlases(freshState(cwd));
  const graph = state.graph;
  const entry = await startServer("discovery-test", state, {
    activity: { platform: "unsupported" },
    graphWatch: { watcherFactory: () => ({ setRoots() {}, close() {} }) },
  });
  t.after(() => entry.close());
  rmSync(join(cwd, ".atlas"), { recursive: true });
  writeFileSync(join(cwd, ".atlas"), "not a directory");
  const response = await fetch(new URL("/api/bootstrap", entry.url), { headers: { "X-Cartograph-Client": "canvas" } });
  assert.equal(response.status, 200);
  const boot = await response.json();
  assert.equal(state.graph, graph);
  assert.deepEqual(boot.state.graph, graph);
  assert.match(boot.state.error, /Cannot list Atlas stores:/);
  rmSync(join(cwd, ".atlas"));
  store(join(cwd, ".atlas", "store"), "valid");
  hydrateStores(state);
  assert.equal(state.error, null, "successful discovery clears its previous error");
  state.error = "An unrelated graph error";
  hydrateStores(state);
  assert.equal(state.error, "An unrelated graph error", "discovery preserves other errors");
});

test("canvas and standalone dev both call the shared default-opening helper", () => {
  const extension = readFileSync(join(runtime, "extension.mjs"), "utf8");
  const dev = readFileSync(join(runtime, "dev.mjs"), "utf8");
  assert.match(extension, /openDefaultAtlases\(state, input\)/);
  assert.match(dev, /openDefaultAtlases\(state, \{ root: process\.argv\[2\], skipIntro: true \}\)/);
  assert.match(extension, /overriding automatic discovery/);
  assert.ok(!extension.includes("Defaults to atlas/ or fixtures/mini-atlas"));
});

test("standalone dev serves discovered mounts and lets the CLI path override them", async (t) => {
  const cwd = workspace(t);
  const first = store(join(cwd, ".atlas", "github.com", "org", "one"), "one");
  const second = store(join(cwd, ".atlas", "github.com", "org", "two"), "two");
  const explicit = store(join(cwd, "chosen store"), "chosen");
  for (const args of [[], ["chosen store"]]) {
    const child = spawn(process.execPath, [join(runtime, "dev.mjs"), ...args], {
      cwd, stdio: ["ignore", "pipe", "pipe"],
    });
    const exited = once(child, "exit");
    let stderr = "";
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    try {
      const url = await new Promise((resolveUrl, reject) => {
        const timer = setTimeout(() => reject(new Error(`Dev server did not start: ${stderr}`)), 10000);
        let stdout = "";
        child.stdout.setEncoding("utf8").on("data", (chunk) => {
          stdout += chunk;
          const match = stdout.match(/Cartograph: (http:\/\/127\.0\.0\.1:\d+\/)/);
          if (match) { clearTimeout(timer); resolveUrl(match[1]); }
        });
        child.once("error", (error) => { clearTimeout(timer); reject(error); });
        child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Dev server exited (${code}): ${stderr}`)); });
      });
      const response = await fetch(new URL("/api/bootstrap", url), { headers: { "X-Cartograph-Client": "canvas" } });
      assert.equal(response.status, 200);
      const { state } = await response.json();
      assert.equal(state.phase, "map");
      assert.deepEqual(state.roots, args.length ? [explicit] : [first, second]);
      assert.equal(state.graph.nodes.length, args.length ? 1 : 2);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
      await exited;
    }
  }
});
