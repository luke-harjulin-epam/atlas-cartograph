import assert from "node:assert/strict";
import { appendFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repository = fileURLToPath(new URL("../", import.meta.url));

export function validateVersion(packageInfo, runtimeInfo, manifest, tag = "") {
  const version = packageInfo.version;
  assert.equal(typeof version, "string", "package.json needs a string version");
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/);
  assert.ok(match, `Invalid SemVer: ${version}`);
  const numeric = (part) => !/^0\d/.test(part);
  assert.ok(match.slice(1, 4).every(numeric), "SemVer numbers cannot have leading zeroes");
  assert.ok(!match[4] || match[4].split(".").every((part) => part && (!/^\d+$/.test(part) || numeric(part))),
    "Invalid SemVer prerelease identifiers");
  assert.ok(!match[5] || match[5].split(".").every(Boolean), "Invalid SemVer build identifiers");
  assert.equal(runtimeInfo.version, version, "Runtime and root package versions must match");
  const declarations = manifest.split(/\r?\n/).filter((line) => /^version:/.test(line));
  assert.deepEqual(declarations, [`version: "${version}"`],
    "apm.yml must declare exactly one matching, double-quoted top-level version");
  if (tag) assert.equal(tag, `v${version}`, "Release tag must be v followed by the package version");
  return { version, prerelease: Boolean(match[4]) };
}

export function checkVersion(root = repository, tag = "") {
  return validateVersion(
    JSON.parse(readFileSync(join(root, "package.json"), "utf8")),
    JSON.parse(readFileSync(join(root, ".apm/extensions/cartograph/package.json"), "utf8")),
    readFileSync(join(root, "apm.yml"), "utf8"),
    tag,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkVersion(repository, process.env.TAG || "");
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `version=${result.version}\nprerelease=${result.prerelease}\n`);
  }
  console.log(`Package version ${result.version}${result.prerelease ? " (prerelease)" : ""}`);
}
