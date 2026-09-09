import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { checkVersion, repository } from "./check-version.mjs";

const apm = process.env.APM_BIN || "apm";
const apmVersion = "0.30.0";
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
  assert.match(installedVersion, /\bversion 0\.30\.0(?:\s|$)/, `Packaging requires APM ${apmVersion}`);
  for (const file of ["apm.yml", "apm.lock.yaml"]) cpSync(join(repository, file), join(producer, file));
  cpSync(source, join(producer, ".apm/extensions/cartograph"), { recursive: true });
  run(["experimental", "enable", "canvas"], producer);
  run(["install", "--frozen", "--dry-run", "--target", "copilot"], producer);
  run(["audit", "--ci"], producer);
  // APM 0.30.0 still emits an uninstallable "minimal" target without this flag.
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
  // APM's legacy plugin tar preserves workstation ownership in its headers.
  // Rearchive only the verified members; all content is audited after install.
  const unpacked = join(staging, "archive");
  mkdirSync(unpacked);
  execFileSync("tar", ["-xzf", archive, "-C", unpacked]);
  assert.deepEqual(filesIn(unpacked), archiveFiles);
  for (const file of archiveFiles) {
    const path = join(unpacked, file);
    chmodSync(path, statSync(path).mode & 0o111 ? 0o755 : 0o644);
    utimesSync(path, 0, 0);
  }
  const inventory = join(staging, "archive-files");
  writeFileSync(inventory, `${archiveFiles.join("\n")}\n`);
  const tarVersion = execFileSync("tar", ["--version"], { encoding: "utf8" });
  assert.match(tarVersion, /bsdtar|GNU tar/, "Packaging requires BSD or GNU tar");
  const ownership = tarVersion.includes("bsdtar")
    ? ["--uid", "0", "--gid", "0", "--uname", "", "--gname", ""]
    : ["--owner=0", "--group=0", "--numeric-owner"];
  execFileSync("tar", ["--format=ustar", ...ownership, "-czf", archive, "-C", unpacked, "-T", inventory]);
  assert.deepEqual(execFileSync("tar", ["-tzf", archive], { encoding: "utf8" }).trim().split("\n").sort(), archiveFiles);
  const tarBytes = gunzipSync(readFileSync(archive));
  let members = 0;
  for (let offset = 0; offset < tarBytes.length;) {
    const header = tarBytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const octal = (start, end) => {
      const value = header.toString("ascii", start, end).replace(/\0/g, "").trim();
      assert.match(value, /^[0-7]+$/, "Archive numeric metadata must be ordinary octal");
      return Number.parseInt(value, 8);
    };
    assert.equal(octal(108, 116), 0, "Archive user ID must be anonymous");
    assert.equal(octal(116, 124), 0, "Archive group ID must be anonymous");
    assert.equal(octal(136, 148), 0, "Archive file time must be normalized");
    assert.ok(header.subarray(265, 329).every((byte) => byte === 0), "Archive owner/group names must be empty");
    assert.ok(header[156] === 0 || header[156] === 48, "Archive may contain only regular file entries");
    offset += 512 + Math.ceil(octal(124, 136) / 512) * 512;
    members++;
  }
  assert.equal(members, archiveFiles.length, "Every archive member must have normalized metadata");
  const plugin = JSON.parse(execFileSync("tar", ["-xOf", archive, `${prefix}plugin.json`], { encoding: "utf8" }));
  assert.equal(plugin.name, "atlas-cartograph");
  assert.equal(plugin.version, version);

  const consumerManifest = [
    "name: cartograph-release-smoke", 'version: "0.0.0"', "targets: [copilot]", "dependencies: {}",
  ];
  writeFileSync(join(consumer, "apm.yml"), `${consumerManifest.join("\n")}\nexecutables:\n  allow: {}\n`);
  // Ask APM for its exact-content approval identity instead of duplicating its
  // digest algorithm or granting trust to every artifact claiming this name.
  const preview = execFileSync(apm, ["install", archive, "--target", "copilot"], {
    cwd: consumer, env: { ...env, NO_COLOR: "1", TERM: "dumb" }, encoding: "utf8",
  });
  const keys = [...preview.matchAll(/"(atlas-cartograph#[^"]+)":/g)]
    .map((match) => match[1].replace(/\s/g, ""));
  assert.equal(keys.length, 1, `APM must report one exact canvas bundle approval identity:\n${preview}`);
  const approvalPrefix = `atlas-cartograph#${version}@sha256:`;
  assert.ok(keys[0].startsWith(approvalPrefix), "Approval must match this package and version");
  assert.match(keys[0].slice(approvalPrefix.length), /^[a-f0-9]{64}$/, "Approval must contain a SHA-256 digest");
  assert.deepEqual(filesIn(consumer), ["apm.yml"], "Unapproved install must not deploy files");
  writeFileSync(join(consumer, "apm.yml"), [
    ...consumerManifest, "executables:", "  allow:", `    "${keys[0]}":`, "      canvas: true", "",
  ].join("\n"));
  writeFileSync(join(consumer, "package.json"), '{"type":"commonjs"}\n');
  run(["install", archive, "--target", "copilot"], consumer);
  run(["audit", "--ci"], consumer);
  const deployed = join(consumer, ".github/extensions/cartograph");
  assert.deepEqual(filesIn(deployed), sourceFiles, "Installed bundle must contain every runtime file");
  for (const file of sourceFiles) {
    assert.deepEqual(readFileSync(join(deployed, file)), readFileSync(join(source, file)), file);
  }
  execFileSync(process.execPath, [
    "--import", join(repository, "test/helpers/native-canvas-register.mjs"),
    join(repository, "test/helpers/native-canvas-smoke.mjs"), deployed,
  ], { cwd: deployed, env, stdio: "inherit", timeout: 30000 });
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
