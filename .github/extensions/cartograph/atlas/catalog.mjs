import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EXTENSION_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const BUNDLED_MINI_ATLAS = resolve(EXTENSION_ROOT, "fixtures/mini-atlas");

function env(name) {
  return String(process.env[name] ?? "").trim();
}

function parsePresets(raw) {
  if (!raw) return [];
  const out = [];
  for (const part of raw.split(",")) {
    const s = part.trim();
    if (!s) continue;
    const idx = s.indexOf(":");
    if (idx <= 0) continue;
    const label = s.slice(0, idx).trim();
    const root = s.slice(idx + 1).trim();
    if (label && root) out.push({ label, root });
  }
  return out;
}

export function workspacePresets(cwd) {
  const root = cwd || process.cwd();
  const workspaceMini = resolve(root, "fixtures/mini-atlas");
  const mini = existsSync(workspaceMini) ? workspaceMini : BUNDLED_MINI_ATLAS;
  return [
    { label: "Mini atlas", root: mini },
    { label: "Mounted atlas", root: resolve(root, "atlas") },
  ];
}

export function envPresets() {
  return parsePresets(env("ATLAS_PRESETS"));
}

export function defaultRootHint(cwd) {
  return env("ATLAS_ROOT") || env("ATLAS_VIEWER_ROOT") || env("OKF_WIKI_ROOT") || "";
}

export function resolveCwd(cwd) {
  const hint = cwd || process.cwd();
  return existsSync(hint) ? resolve(hint) : process.cwd();
}

export function allPresetSpecs(cwd) {
  const specs = [...envPresets(), ...workspacePresets(cwd)];
  const envRoot = defaultRootHint(cwd);
  if (envRoot) specs.unshift({ label: "ATLAS_ROOT", root: envRoot });
  return specs.filter((p, i, arr) => arr.findIndex((q) => q.root === p.root) === i);
}
