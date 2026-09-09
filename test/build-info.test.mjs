import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readBuildInfo } from "../.apm/extensions/cartograph/build-info.mjs";

function fixture(t, path = ".apm/extensions/cartograph") {
  const root = mkdtempSync(join(tmpdir(), "cartograph-build-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const runtime = join(root, path);
  mkdirSync(runtime, { recursive: true });
  const metadata = (extra = {}) => writeFileSync(join(runtime, "package.json"),
    JSON.stringify({ name: "cartograph-canvas", version: "0.2.0", ...extra }));
  metadata();
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const init = () => {
    git("init", "--quiet");
    git("add", ".");
    git("-c", "user.name=Cartograph test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false",
      "commit", "--quiet", "-m", "Fixture");
    return git("rev-parse", "HEAD");
  };
  return { root, runtime, metadata, init };
}

test("source checkout build identity includes its commit and uncommitted runtime changes", (t) => {
  const { root, runtime, init } = fixture(t);
  mkdirSync(join(root, ".github/extensions/cartograph"), { recursive: true });
  writeFileSync(join(root, ".github/extensions/cartograph/extension.mjs"), "// Development shim\n");
  const commit = init();
  assert.deepEqual(readBuildInfo(runtime), { version: "0.2.0", commit, dirty: false });
  writeFileSync(join(root, "unrelated.txt"), "Not runtime code");
  assert.equal(readBuildInfo(runtime).dirty, false);
  writeFileSync(join(runtime, "new-asset.js"), "// Local runtime asset\n");
  assert.equal(readBuildInfo(runtime).dirty, true);
});

test("unversioned bundles explicitly report unavailable SHA", (t) => {
  const { runtime } = fixture(t);
  assert.deepEqual(readBuildInfo(runtime), { version: "0.2.0", commit: null, dirty: false });
});

test("deployed bundles never borrow the consumer repository's commit", (t) => {
  const { runtime, init } = fixture(t, ".github/extensions/cartograph");
  init();
  assert.equal(readBuildInfo(runtime).commit, null);
});

test("packaged build identity survives deployment and takes priority over Git", (t) => {
  const { runtime, metadata, init } = fixture(t, ".github/extensions/cartograph");
  const commit = "a".repeat(40);
  metadata({ cartographBuild: { commit, dirty: false } });
  assert.notEqual(init(), commit);
  assert.deepEqual(readBuildInfo(runtime), { version: "0.2.0", commit, dirty: false });
});

test("invalid packaged build metadata fails explicitly", (t) => {
  const { runtime, metadata } = fixture(t);
  for (const cartographBuild of [{ commit: "unknown", dirty: false }, { commit: "a".repeat(40) }]) {
    metadata({ cartographBuild });
    assert.throws(() => readBuildInfo(runtime), /Invalid Cartograph build metadata/);
  }
});
