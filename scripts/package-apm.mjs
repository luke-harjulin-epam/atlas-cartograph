import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { checkVersion, repository } from "./check-version.mjs";

const apm = process.env.APM_BIN || "apm";
const apmVersion = "0.29.0";
const { version, prerelease } = checkVersion(repository, process.env.TAG || "");
const source = join(repository, ".apm/extensions/cartograph");
const staging = realpathSync(mkdtempSync(join(tmpdir(), "cartograph-release-")));
const producer = join(staging, "producer");
const consumer = join(staging, "consumer");
const home = join(staging, "home");
const apmHome = join(staging, "apm-home");
const env = { ...process.env, HOME: home, APM_HOME: apmHome, APM_NO_SCRIPTS: "1" };
const archiveName = `atlas-cartograph-${version}.tar.gz`;
let entry;

function run(args, cwd) {
  execFileSync(apm, args, { cwd, env, stdio: "inherit" });
}

function filesIn(root, prefix = "") {
  return readdirSync(join(root, prefix), { withFileTypes: true }).flatMap((item) => {
    assert.ok(!item.isSymbolicLink(), `Unexpected symlink: ${item.name}`);
    const path = prefix ? `${prefix}/${item.name}` : item.name;
    return item.isDirectory() ? filesIn(root, path) : [path];
  }).sort();
}

try {
  for (const directory of [producer, consumer, home, apmHome]) mkdirSync(directory, { recursive: true });
  const installedVersion = execFileSync(apm, ["--version"], { env, encoding: "utf8" });
  assert.match(installedVersion, /\bversion 0\.29\.0(?:\s|$)/, `Packaging requires APM ${apmVersion}`);
  for (const file of ["apm.yml", "apm.lock.yaml"]) cpSync(join(repository, file), join(producer, file));
  cpSync(source, join(producer, ".apm/extensions/cartograph"), { recursive: true });
  run(["experimental", "enable", "canvas"], producer);
  run(["install", "--frozen", "--dry-run", "--target", "copilot"], producer);
  run(["audit", "--ci"], producer);
  // APM 0.29.0's --json path generates metadata but does not emit this bundle.
  // Its pack default is an uninstallable "minimal", even with a configured target.
  run(["pack", "--format", "plugin", "--target", "copilot", "--dry-run"], producer);
  run(["pack", "--format", "plugin", "--target", "copilot", "--archive", "--archive-format", "tar.gz"], producer);
  const archive = join(producer, "build", archiveName);
  const sourceFiles = filesIn(source);
  const archiveFiles = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" }).trim().split("\n").sort();
  const prefix = `atlas-cartograph-${version}/`;
  assert.deepEqual(archiveFiles, [
    `${prefix}apm.lock.yaml`, `${prefix}plugin.json`,
    ...sourceFiles.map((file) => `${prefix}extensions/cartograph/${file}`),
  ].sort(), "Archive must contain exactly the runtime and APM metadata");
  const plugin = JSON.parse(execFileSync("tar", ["-xOf", archive, `${prefix}plugin.json`], { encoding: "utf8" }));
  assert.equal(plugin.name, "atlas-cartograph");
  assert.equal(plugin.version, version);

  // This compatibility grant is confined to a disposable offline-bundle consumer.
  writeFileSync(join(consumer, "apm.yml"), [
    "name: cartograph-release-smoke", 'version: "0.0.0"', "targets: [copilot]", "dependencies: {}",
    "allowExecutables:", "  atlas-cartograph:", "    canvas: true", "",
  ].join("\n"));
  writeFileSync(join(consumer, "package.json"), '{"type":"commonjs"}\n');
  run(["install", archive, "--target", "copilot"], consumer);
  run(["audit", "--ci"], consumer);
  const deployed = join(consumer, ".github/extensions/cartograph");
  assert.deepEqual(filesIn(deployed), sourceFiles, "Installed bundle must contain every runtime file");
  for (const file of sourceFiles) {
    assert.deepEqual(readFileSync(join(deployed, file)), readFileSync(join(source, file)), file);
  }
  const smokeRoot = join(consumer, ".atlas/local/smoke");
  cpSync(join(deployed, "fixtures/mini-atlas"), smokeRoot, { recursive: true });
  const { freshState, openDefaultAtlases, startServer } = await import(pathToFileURL(join(deployed, "server.mjs")));
  const state = openDefaultAtlases(freshState(consumer));
  assert.equal(state.error, null);
  assert.deepEqual(state.roots, [smokeRoot]);
  assert.ok(state.graph.nodes.length > 0);
  entry = await startServer("release-smoke", state, { activity: { platform: "unsupported" } });
  for (const asset of sourceFiles.filter((file) => /^public\/.*\.(?:html|js|css)$/.test(file))) {
    const response = await fetch(new URL(asset.slice("public/".length), entry.url));
    assert.equal(response.status, 200, asset);
    assert.equal(await response.text(), readFileSync(join(deployed, asset), "utf8"));
  }
  const bootstrap = await fetch(new URL("/api/bootstrap", entry.url), {
    headers: { "X-Cartograph-Client": "canvas" },
  });
  assert.equal(bootstrap.status, 200);
  assert.equal((await bootstrap.json()).state.graph.nodes.length, state.graph.nodes.length);

  const output = join(repository, "build/release");
  mkdirSync(output, { recursive: true });
  assert.deepEqual(readdirSync(output), [], "build/release must be empty to avoid stale release artifacts");
  const bytes = readFileSync(archive);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  cpSync(archive, join(output, archiveName));
  writeFileSync(join(output, `${archiveName}.sha256`), `${sha256}  ${archiveName}\n`);
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).trim();
  writeFileSync(join(output, "release.json"), `${JSON.stringify({
    name: "atlas-cartograph", version, prerelease, commit, tag: process.env.TAG || null, apmVersion,
    format: "plugin", archive: archiveName, sha256, runtimeFiles: sourceFiles.length,
  }, null, 2)}\n`);
  console.log(`Ready: build/release/${archiveName}`);
} finally {
  try {
    await entry?.close();
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
