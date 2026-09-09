import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isPathWithin } from "../paths.mjs";

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
  "apm_modules",
  ".git",
  "dist",
  "build",
  ".vercel",
  ".tanstack",
  ".grok",
  "log",
  "staging",
]);

export function isInstalledPath(path) {
  const abs = resolve(path);
  const parts = abs.split(sep);
  return isPathWithin(EXTENSION_ROOT, abs) ||
    parts.includes(".apm") || parts.includes("apm_modules") ||
    parts.some((part, index) => part === ".github" && parts[index + 1] === "extensions");
}

function walkAtlasDirs(root, { strict = false } = {}) {
  const found = [];
  const visited = new Set();
  const skipped = strict ? new Set(["node_modules", "apm_modules"]) : SKIP_WALK;
  function walk(dir, depth) {
    if (isInstalledPath(dir)) return;
    try {
      const canonical = realpathSync(dir);
      if (visited.has(canonical) || isInstalledPath(canonical)) return;
      if (depth > 8 || visited.size >= 4096) {
        if (strict) throw new Error(`Atlas discovery limit exceeded at ${dir} (8 levels / 4096 directories).`);
        return;
      }
      visited.add(canonical);
      if (!statSync(canonical).isDirectory()) {
        if (strict && depth === 0) throw new Error(`Atlas discovery path must be a directory: ${dir}`);
        return;
      }
      const entries = readdirSync(canonical, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
      const names = new Set(entries.map((entry) => entry.name));
      const recognized = names.has("SCHEMA.json") || names.has("SCHEMA.md") ||
        (names.has("index.md") && (strict || ["knowledge", "experiences", "work", "decisions"].some((name) => names.has(name))));
      if (recognized) {
        found.push(canonical);
        if (strict || depth > 0) return;
      }
      for (const entry of entries) {
        if (entry.name.startsWith(".") || skipped.has(entry.name)) continue;
        if (entry.isDirectory() || entry.isSymbolicLink()) walk(join(canonical, entry.name), depth + 1);
      }
    } catch (error) {
      if (strict && error.code !== "ENOENT" && error.code !== "ELOOP") throw error;
    }
  }
  if (root) walk(root, 0);
  return found;
}

export function labelFor(root, cwd) {
  const abs = resolve(root);
  if (cwd) {
    const rel = relative(resolve(cwd), abs).replace(/\\/g, "/");
    if (rel === "atlas") return "Workspace atlas";
    if (rel === ".atlas") return "Workspace .atlas";
    if (rel.startsWith(".atlas/")) return rel.slice(7).split("/").join(" / ");
    if (!rel) return "This workspace";
    if (rel === "fixtures/mini-atlas") return "Mini atlas";
    if (rel && !rel.startsWith("..")) {
      const parts = rel.split("/").filter(Boolean);
      return parts.slice(-2).join(" / ");
    }
  }
  if (abs.endsWith("fixtures/mini-atlas") || abs.endsWith("fixtures\\mini-atlas")) return "Mini atlas";
  return basename(abs);
}

export function discoverAtlasPresets(cwd) {
  if (!cwd) return [];
  return walkAtlasDirs(resolve(cwd, ".atlas"), { strict: true })
    .map((root) => ({ label: labelFor(root, cwd), root, discovered: true }));
}

export function workspacePresets(cwd, { mounts = discoverAtlasPresets(cwd) } = {}) {
  const root = cwd && existsSync(cwd) ? resolve(cwd) : "";
  const found = [...mounts];
  if (root && !isInstalledPath(root)) {
    for (const dir of walkAtlasDirs(root)) {
      found.push({ label: labelFor(dir, root), root: resolve(dir) });
    }
  }
  if (!found.length) {
    const workspaceMini = root ? resolve(root, "fixtures/mini-atlas") : "";
    const mini = workspaceMini && existsSync(workspaceMini) ? workspaceMini : BUNDLED_MINI_ATLAS;
    if (existsSync(mini)) found.push({ label: "Mini atlas", root: mini });
  }
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

export function configuredPresetSpecs(cwd) {
  const specs = envPresets();
  const envRoot = defaultRootHint(cwd);
  if (envRoot) specs.unshift({ label: "ATLAS_ROOT", root: envRoot });
  return specs;
}

export function allPresetSpecs(cwd, { mounts = discoverAtlasPresets(cwd) } = {}) {
  const specs = [...mounts, ...configuredPresetSpecs(cwd), ...workspacePresets(cwd, { mounts })];
  const seen = new Set();
  return specs.filter((preset) => {
    let root = resolve(cwd || process.cwd(), preset.root);
    try {
      root = realpathSync(root);
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
    }
    if (seen.has(root)) return false;
    seen.add(root);
    return true;
  });
}
