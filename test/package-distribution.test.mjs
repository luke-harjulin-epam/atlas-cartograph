import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const runtime = fileURLToPath(new URL("../.apm/extensions/cartograph/", import.meta.url));
const repository = fileURLToPath(new URL("../", import.meta.url));

function filesIn(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    assert.ok(!entry.isSymbolicLink(), `Bundle sources must not be symlinks: ${entry.name}`);
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesIn(path) : [path];
  });
}

test("APM source contains every runtime import and aligns package versions", () => {
  const packageInfo = JSON.parse(readFileSync(join(repository, "package.json"), "utf8"));
  const runtimeInfo = JSON.parse(readFileSync(join(runtime, "package.json"), "utf8"));
  const manifest = readFileSync(join(repository, "apm.yml"), "utf8");
  assert.equal(runtimeInfo.version, packageInfo.version);
  assert.equal(runtimeInfo.type, "module");
  assert.deepEqual(runtimeInfo.engines, packageInfo.engines);
  assert.ok(manifest.includes(`version: "${packageInfo.version}"`));
  assert.match(manifest, /includes:\n  - \.apm\/extensions\/cartograph\n/);
  assert.ok(!existsSync(join(repository, "src")), "Canonical runtime has no duplicate src tree");
  for (const path of filesIn(runtime).filter((file) => /\.(mjs|js)$/.test(file))) {
    const text = readFileSync(path, "utf8");
    for (const [, , specifier] of text.matchAll(/\b(?:from\s+|import\s*(?:\(\s*)?)(["'])([^"']+)\1/g)) {
      if (specifier.startsWith("node:") || specifier === "@github/copilot-sdk/extension") continue;
      assert.ok(specifier.startsWith("."), `Unexpected external import in ${path}: ${specifier}`);
      const target = resolve(dirname(path), specifier);
      const local = relative(runtime, target);
      assert.ok(local !== ".." && !local.startsWith(`..${sep}`), `Import leaves runtime bundle: ${path}`);
      assert.ok(existsSync(target), `Missing bundled import: ${path} -> ${specifier}`);
    }
  }
});

test("a copied canvas runs without the source repository or its package metadata", async (t) => {
  const consumer = realpathSync(mkdtempSync(join(tmpdir(), "cartograph-package-")));
  const deployed = join(consumer, ".github", "extensions", "cartograph");
  cpSync(runtime, deployed, { recursive: true });
  writeFileSync(join(consumer, "package.json"), '{"type":"commonjs"}\n');
  let entry;
  t.after(async () => {
    await entry?.close();
    rmSync(consumer, { recursive: true, force: true });
  });

  test("the UI shell and styles do not load third-party assets", () => {
    const html = readFileSync(join(runtime, "public", "index.html"), "utf8");
    const css = readFileSync(join(runtime, "public", "styles.css"), "utf8");
    assert.doesNotMatch(html, /<(?:link|script|img)\b[^>]*(?:href|src)=["'](?:https?:)?\/\//i);
    assert.doesNotMatch(css, /(?:url\(\s*["']?|@import\s*["'])(?:https?:)?\/\//i);
  });
  const { freshState, openAtlas, startServer } = await import(pathToFileURL(join(deployed, "server.mjs")));
  const { BUNDLED_MINI_ATLAS } = await import(pathToFileURL(join(deployed, "atlas", "catalog.mjs")));
  const { ActivityCamera } = await import(pathToFileURL(join(deployed, "public", "activity-camera.js")));
  assert.equal(typeof ActivityCamera, "function", "Nested metadata preserves browser ESM imports");
  assert.equal(BUNDLED_MINI_ATLAS, join(deployed, "fixtures", "mini-atlas"));
  const state = freshState(consumer, { skipIntro: true });
  openAtlas(state, BUNDLED_MINI_ATLAS);
  entry = await startServer("package-test", state, { activity: { platform: "darwin" } });
  assert.ok(state.graph.nodes.length > 0);
  for (const asset of ["index.html", "app.js", "activity-camera.js", "styles.css"]) {
    const response = await fetch(new URL(asset, entry.url));
    assert.equal(response.status, 200);
    assert.equal(await response.text(), readFileSync(join(deployed, "public", asset), "utf8"));
  }
  const response = await fetch(new URL("/api/activity/connection", entry.url), {
    headers: { "X-Cartograph-Client": "canvas" },
  });
  assert.equal(response.status, 200);
  const connection = await response.json();
  assert.ok(connection.command.includes(join(deployed, "activity", "collector.mjs")));
  assert.ok(!connection.command.includes(repository), "Collector path does not point back to source");
});
