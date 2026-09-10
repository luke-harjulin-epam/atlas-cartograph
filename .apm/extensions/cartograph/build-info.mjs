import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const COMMIT = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

function stampFrom(value) {
  if (!value || typeof value !== "object") return null;
  const { commit, dirty } = value;
  if (typeof commit !== "string" || !COMMIT.test(commit) || typeof dirty !== "boolean") return null;
  return { commit, dirty };
}

function sourceRepository(runtime) {
  const repository = resolve(runtime, "../../..");
  if (resolve(runtime) !== join(repository, ".apm/extensions/cartograph")) return null;
  if (!existsSync(join(repository, ".git"))) return null;
  if (!existsSync(join(repository, ".github/extensions/cartograph/extension.mjs"))) return null;
  return repository;
}

function gitInfo(repository) {
  const git = (args) => execFileSync("git", args, {
    cwd: repository, encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  if (realpathSync(git(["rev-parse", "--show-toplevel"])) !== realpathSync(repository)) return null;
  return {
    commit: git(["rev-parse", "HEAD"]),
    dirty: Boolean(git(["status", "--porcelain", "--untracked-files=normal", "--", ".apm/extensions/cartograph"])),
  };
}

function fileStamp(runtime) {
  try {
    return stampFrom(JSON.parse(readFileSync(join(runtime, "cartograph-build.json"), "utf8")));
  } catch {
    return null;
  }
}

export function readBuildInfo(runtime = dirname(fileURLToPath(import.meta.url))) {
  const metadata = JSON.parse(readFileSync(join(runtime, "package.json"), "utf8"));
  const info = { version: metadata.version, commit: null, dirty: false };
  const repository = sourceRepository(runtime);
  if (repository) {
    const git = gitInfo(repository);
    if (git) return { ...info, ...git };
  }
  if (metadata.cartographBuild) {
    const stamped = stampFrom(metadata.cartographBuild);
    if (!stamped) throw new Error("Invalid Cartograph build metadata.");
    return { ...info, ...stamped };
  }
  return { ...info, ...fileStamp(runtime) };
}
