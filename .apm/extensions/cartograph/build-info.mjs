import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function readBuildInfo(runtime = dirname(fileURLToPath(import.meta.url))) {
  const metadata = JSON.parse(readFileSync(join(runtime, "package.json"), "utf8"));
  const info = { version: metadata.version, commit: null, dirty: false };
  if (metadata.cartographBuild) {
    const { commit, dirty } = metadata.cartographBuild;
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit) || typeof dirty !== "boolean") {
      throw new Error("Invalid Cartograph build metadata.");
    }
    return { ...info, commit, dirty };
  }
  // Only a source checkout may use Git; never label a deployment with its consumer's SHA.
  const repository = resolve(runtime, "../../..");
  if (resolve(runtime) !== join(repository, ".apm/extensions/cartograph") ||
      !existsSync(join(repository, ".git")) ||
      !existsSync(join(repository, ".github/extensions/cartograph/extension.mjs"))) return info;
  const git = (args) => execFileSync("git", args, {
    cwd: repository, encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  if (realpathSync(git(["rev-parse", "--show-toplevel"])) !== realpathSync(repository)) return info;
  return {
    ...info,
    commit: git(["rev-parse", "HEAD"]),
    dirty: Boolean(git(["status", "--porcelain", "--untracked-files=normal", "--", ".apm/extensions/cartograph"])),
  };
}
