import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const runtime = fileURLToPath(new URL("../.apm/extensions/cartograph/", import.meta.url));
const register = fileURLToPath(new URL("./helpers/native-canvas-register.mjs", import.meta.url));
const smoke = fileURLToPath(new URL("./helpers/native-canvas-smoke.mjs", import.meta.url));

function exercise(directory) {
  execFileSync(process.execPath, ["--import", register, smoke, directory], {
    cwd: directory, stdio: "pipe", timeout: 30000,
  });
}

test("canonical native entrypoint registers without hooks and resolves each workspace safely", () => {
  exercise(runtime);
});

test("deployed native entrypoint runs from its installation directory in a CommonJS consumer", (t) => {
  const consumer = realpathSync(mkdtempSync(join(tmpdir(), "cartograph-native-package-")));
  t.after(() => rmSync(consumer, { recursive: true, force: true }));
  const deployed = join(consumer, ".github", "extensions", "cartograph");
  cpSync(runtime, deployed, { recursive: true });
  writeFileSync(join(consumer, "package.json"), '{"type":"commonjs"}\n');
  exercise(deployed);
});
