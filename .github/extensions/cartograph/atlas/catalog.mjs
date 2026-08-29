import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const EXTENSION_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
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

const SKIP_WALK = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".vercel",
  ".tanstack",
  ".grok",
  "log",
  "staging",
]);

function isAtlasDir(dir) {
  if (existsSync(join(dir, "SCHEMA.json")) || existsSync(join(dir, "SCHEMA.md"))) return true;
  if (existsSync(join(dir, "knowledge")) && existsSync(join(dir, "index.md"))) return true;
  if (existsSync(join(dir, "index.md")) && (existsSync(join(dir, "experiences")) || existsSync(join(dir, "work")) || existsSync(join(dir, "decisions")))) {
    return true;
  }
  return false;
}

function walkAtlasDirs(dir, acc = [], depth = 0) {
  if (!dir || !existsSync(dir) || depth > 6) return acc;
  if (isAtlasDir(dir)) {
    acc.push(dir);
    if (depth > 0) return acc;
  }
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const name of names) {
    if (name.startsWith(".") && name !== ".") continue;
    if (SKIP_WALK.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walkAtlasDirs(full, acc, depth + 1);
  }
  return acc;
}

function labelFor(root, cwd) {
  const abs = resolve(root);
  if (abs === resolve(cwd, "atlas")) return "Workspace atlas";
  if (abs === resolve(cwd)) return "This workspace";
  if (abs.endsWith("fixtures/mini-atlas") || abs.endsWith("fixtures\\mini-atlas")) return "Mini atlas";
  return basename(abs);
}

export function workspacePresets(cwd) {
  const root = cwd && existsSync(cwd) ? resolve(cwd) : "";
  const inInstall = root && (root === EXTENSION_ROOT || root.startsWith(`${EXTENSION_ROOT}/`));
  const found = root && !inInstall
    ? walkAtlasDirs(root).map((dir) => ({
        label: labelFor(dir, root),
        root: resolve(dir),
      }))
    : [];
  const workspaceMini = root ? resolve(root, "fixtures/mini-atlas") : "";
  const mini = workspaceMini && existsSync(workspaceMini) ? workspaceMini : BUNDLED_MINI_ATLAS;
  found.push({ label: "Mini atlas", root: mini });
  if (root && !inInstall) found.push({ label: "Mounted atlas", root: resolve(root, "atlas") });
  return found;
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
