import assert from "node:assert/strict";
import { posix, win32 } from "node:path";
import test from "node:test";
import { isPathWithin } from "../.apm/extensions/cartograph/paths.mjs";

test("installation containment handles Windows separators, casing and drive boundaries", () => {
  const root = "C:\\project\\.github\\extensions\\cartograph";
  for (const child of [root, `${root}\\public`, `${root}\\public\\nested`, root.toUpperCase(), `${root}/atlas`]) {
    assert.equal(isPathWithin(root, child, win32), true, child);
  }
  for (const other of [`${root}-other`, `${root}\\..\\elsewhere`, "C:\\project", "D:\\project\\.github\\extensions\\cartograph"]) {
    assert.equal(isPathWithin(root, other, win32), false, other);
  }
});

test("POSIX containment keeps sibling-prefix directories outside", () => {
  const root = "/project/.github/extensions/cartograph";
  assert.equal(isPathWithin(root, root, posix), true);
  assert.equal(isPathWithin(root, `${root}/public`, posix), true);
  assert.equal(isPathWithin(root, `${root}/..hidden`, posix), true);
  assert.equal(isPathWithin(root, `${root}-other`, posix), false);
  assert.equal(isPathWithin(root, `${root}/../elsewhere`, posix), false);
  assert.equal(isPathWithin(root, "/project", posix), false);
});
