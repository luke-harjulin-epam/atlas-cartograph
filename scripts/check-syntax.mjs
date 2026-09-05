import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { repository } from "./check-version.mjs";

function check(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) check(path);
    else if (/\.(mjs|js)$/.test(entry.name)) {
      execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
    }
  }
}

for (const directory of [".apm/extensions/cartograph", ".github/extensions", "scripts", "test"]) {
  check(join(repository, directory));
}
