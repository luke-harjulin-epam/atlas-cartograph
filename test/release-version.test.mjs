import assert from "node:assert/strict";
import test from "node:test";
import { checkVersion, validateVersion } from "../scripts/check-version.mjs";

function validate(version, tag = "") {
  return validateVersion({ version }, { version }, `name: atlas-cartograph\nversion: "${version}"\n`, tag);
}

test("release versions match all three manifests and the exact tag", () => {
  assert.doesNotThrow(() => checkVersion());
  for (const version of ["0.1.0", "1.2.3", "2.0.0+build.17"]) {
    assert.deepEqual(validate(version, `v${version}`), { version, prerelease: false });
  }
  for (const version of ["1.0.0-alpha.0", "1.0.0-beta.2", "1.0.0-rc.1+build.9"]) {
    assert.deepEqual(validate(version, `v${version}`), { version, prerelease: true });
  }
});

test("invalid versions and unsafe tag inputs fail closed", () => {
  for (const version of ["", "1.0", "01.0.0", "1.01.0", "1.0.01", "1.0.0-01", "1.0.0-a..b", "1.0.0+build..1", "1.0.0/x", "1.0.0\ninjected=true"]) {
    assert.throws(() => validate(version), undefined, version);
  }
  for (const tag of ["1.0.0", "v1.0.1", "v1.0.0;echo injected", "v1.0.0\ninjected=true", "refs/tags/v1.0.0"]) {
    assert.throws(() => validate("1.0.0", tag), /Release tag/, tag);
  }
});

test("manifest drift and duplicate version declarations fail before packaging", () => {
  assert.throws(() => validateVersion({ version: "1.0.0" }, { version: "1.0.1" }, 'version: "1.0.0"'), /versions must match/);
  for (const manifest of ['version: "1.0.1"', 'version: "1.0.0"\nversion: "1.0.1"', "# no version"]) {
    assert.throws(() => validateVersion({ version: "1.0.0" }, { version: "1.0.0" }, manifest), /apm.yml/);
  }
});
