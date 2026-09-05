import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, normalize, relative, resolve, win32 } from "node:path";
import { isPathWithin } from "../paths.mjs";
import { allPresetSpecs, configuredPresetSpecs, labelFor } from "./catalog.mjs";
import {
  aliasesFor,
  displayTitle,
  extractAtlasUris,
  extractMarkdownLinks,
  extractWikilinks,
  kindFor,
  normalizeLink,
  pageSlug,
  parseFrontmatter,
  relatesToOf,
  sourcesOf,
} from "./parse.mjs";
import { countKinds, linkGraph, withDegrees } from "./link.mjs";
import { combineAtlases, mergeGraphs } from "./merge.mjs";

const SKIP_DIRS = new Set([
  "log",
  "evals",
  "node_modules",
  ".git",
  "staging",
  "templates",
  "mesh",
  ".atlas-index",
]);

export const STREAM_BATCH = 40;

const listings = new Map();

export function isIgnoredAtlasPath(path) {
  const parts = String(path).replace(/\\/g, "/").split("/");
  return parts.some((part) => part.startsWith(".") || SKIP_DIRS.has(part)) || parts.length > 14;
}

function confinedPath(root, path) {
  const canonical = realpathSync(path);
  return isPathWithin(root, canonical) ? canonical : null;
}

function walkMd(dir, acc = [], depth = 0, strict = false, canonicalRoot, ancestors = new Set()) {
  if (depth > 12) return acc;
  let entries = [];
  let canonical;
  try {
    canonical = realpathSync(dir);
    canonicalRoot ??= canonical;
    if (!isPathWithin(canonicalRoot, canonical) || ancestors.has(canonical)) return acc;
    entries = readdirSync(canonical);
  } catch (error) {
    if (strict && !["ENOENT", "ENOTDIR", "ELOOP"].includes(error.code)) throw error;
    return acc;
  }
  const visited = new Set(ancestors).add(canonical);
  for (const name of entries) {
    if (name.startsWith(".")) continue;
    const full = join(dir, name);
    let st;
    try {
      const target = confinedPath(canonicalRoot, join(canonical, name));
      if (!target) continue;
      st = statSync(target);
    } catch (error) {
      if (strict && !["ENOENT", "ENOTDIR", "ELOOP"].includes(error.code)) throw error;
      continue;
    }
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      walkMd(full, acc, depth + 1, strict, canonicalRoot, visited);
    } else if (st.isFile() && name.endsWith(".md")) {
      acc.push(full);
    }
  }
  return acc;
}

function ensureListed(storeRoot, strict = false) {
  let L = listings.get(storeRoot);
  if (!L || !L.done) {
    const files = walkMd(storeRoot, [], 0, strict).sort();
    L = { files, done: true };
    listings.set(storeRoot, L);
  }
  return { files: L.files, complete: L.done };
}

export function clearListing(root) {
  if (root) listings.delete(root);
  else listings.clear();
}

function readText(path) {
  return readFileSync(path, "utf8");
}

function readJson(root, path, strict = false) {
  try {
    const target = confinedPath(root, path);
    return target ? JSON.parse(readText(target)) : null;
  } catch (error) {
    if (strict && error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
    return null;
  }
}

export function sanitizeRoot(input, cwd) {
  const trimmed = String(input ?? "").trim();
  if (!trimmed) return "";
  return isAbsolute(trimmed) ? normalize(trimmed) : resolve(cwd || process.cwd(), trimmed);
}

function detectFormat(root) {
  if (existsSync(join(root, "SCHEMA.json"))) return "atlas";
  if (existsSync(join(root, "knowledge")) || existsSync(join(root, "SCHEMA.md"))) {
    return "okf-wiki";
  }
  if (existsSync(join(root, "index.md"))) return "atlas";
  return "unknown";
}

function tallyStore(root, strict = false) {
  const files = ensureListed(root, strict).files;
  let experiences = 0;
  let decisions = 0;
  let work = 0;
  let other = 0;
  for (const f of files) {
    const rel = (isAbsolute(f) ? relative(root, f) : f).replace(/\\/g, "/");
    if (/(^|\/)(experiences|raw)\//.test(rel)) experiences += 1;
    else if (/(^|\/)decisions\//.test(rel)) decisions += 1;
    else if (/(^|\/)(work|modules)\//.test(rel)) work += 1;
    else other += 1;
  }
  return { experiences, decisions, work, other, pages: files.length };
}

export function inspectRoot(rawRoot, cwd, { strict = false, fallbackStore, label: presetLabel } = {}) {
  const root = sanitizeRoot(rawRoot, cwd);
  const label = presetLabel ??
    configuredPresetSpecs(cwd).find((p) => sanitizeRoot(p.root, cwd) === root)?.label ??
    (root ? labelFor(root, cwd) : "");
  const empty = (reason) => ({
    root,
    label: label || "No root",
    available: false,
    reason,
    format: "unknown",
    experiences: 0,
    decisions: 0,
    work: 0,
    other: 0,
    pages: 0,
  });
  if (!root) return empty("Set an Atlas root to open Cartograph.");
  if (!strict && !existsSync(root)) return empty("Path does not exist.");
  let st;
  let canonicalRoot;
  try {
    canonicalRoot = realpathSync(root);
    st = statSync(canonicalRoot);
  } catch (error) {
    if (strict && error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
    return empty("Cannot read path.");
  }
  if (!st.isDirectory()) return empty("Root must be a directory.");
  let format = detectFormat(root);
  if (format === "unknown" && fallbackStore?.available) format = fallbackStore.format;
  if (format === "unknown") {
    return empty("Not an Atlas (need SCHEMA.json or index.md) or okf-wiki store.");
  }
  let atlasId = fallbackStore?.atlasId;
  if (format === "atlas") {
    const schema = readJson(canonicalRoot, join(root, "SCHEMA.json"), strict);
    if (schema && typeof schema.atlas_id === "string") atlasId = schema.atlas_id;
  }
  const counts = tallyStore(root, strict);
  return {
    root,
    label,
    available: true,
    format,
    atlasId,
    ...counts,
  };
}

function parseFiles(storeRoot, files, format, atlasId, atlasLabel, strict = false) {
  const nodes = [];
  const canonicalRoot = realpathSync(storeRoot);
  for (const file of files) {
    const rel = (isAbsolute(file) ? relative(storeRoot, file) : file).replace(/\\/g, "/");
    let text = "";
    try {
      const full = isAbsolute(file) ? file : join(storeRoot, file);
      if (!isPathWithin(storeRoot, full)) continue;
      const target = confinedPath(canonicalRoot, full);
      if (!target) continue;
      text = readText(target);
    } catch (error) {
      if (strict && !["ENOENT", "ENOTDIR", "ELOOP"].includes(error.code)) throw error;
      continue;
    }
    if (!text) continue;
    const { meta, body } = parseFrontmatter(text);
    const type = typeof meta.type === "string" && meta.type ? meta.type : "";
    const workId = typeof meta.work_id === "string" ? meta.work_id : "";
    const kind = kindFor(rel, type, format);
    const sources = sourcesOf(meta);
    const relates = relatesToOf(meta);
    const links = [...extractWikilinks(body), ...extractMarkdownLinks(body)].map(normalizeLink);
    const mesh = extractAtlasUris(`${body}\n${JSON.stringify(meta)}`);
    const refs = [
      ...sources.map((raw) => ({ raw, kind: "source" })),
      ...relates.map((r) => ({
        raw: r.path,
        kind: "relates",
        relKind: r.kind,
      })),
      ...links
        .filter((raw) => !sources.includes(raw) && !relates.some((r) => normalizeLink(r.path) === raw))
        .map((raw) => ({ raw, kind: "link" })),
      ...mesh.map((m) => ({
        raw: m.path,
        kind: "mesh",
        relKind: m.atlasId,
      })),
    ];
    nodes.push({
      id: pageSlug(rel),
      localId: pageSlug(rel),
      kind,
      title: displayTitle(meta, rel),
      type: type || kind,
      path: rel,
      degree: 0,
      sourceCount: sources.length,
      aliases: aliasesFor(rel),
      refs,
      atlasId,
      atlasKey: atlasId || atlasLabel,
      atlasLabel: atlasLabel || atlasId,
      storeRoot,
      workId,
    });
  }
  return nodes;
}

export function loadGraph(rawRoot, opts, cwd) {
  if ((opts?.offset ?? 0) === 0) clearListing(sanitizeRoot(rawRoot, cwd));
  const store = inspectRoot(rawRoot, cwd, { strict: opts?.strict, fallbackStore: opts?.fallbackStore });
  if (!store.available) {
    return {
      store,
      nodes: [],
      edges: [],
      nextOffset: null,
      scanned: 0,
      total: 0,
      complete: true,
    };
  }
  const offset = Math.max(0, opts?.offset ?? 0);
  const limit = Math.max(1, Math.min(200, opts?.limit ?? STREAM_BATCH));
  const { files, complete: listedAll } = ensureListed(store.root, opts?.strict);
  const slice = files.slice(offset, offset + limit);
  const nodes = parseFiles(store.root, slice, store.format, store.atlasId, store.label, opts?.strict);
  const edges = linkGraph(nodes);
  const next = offset + slice.length;
  const hasMore = next < files.length || !listedAll;
  return {
    store: { ...store, ...countKinds(nodes), pages: files.length },
    nodes: withDegrees(nodes, edges),
    edges,
    nextOffset: hasMore ? next : null,
    scanned: slice.length,
    total: listedAll ? files.length : Math.max(files.length, next + 1),
    complete: !hasMore,
  };
}

function pageIdentity(nodeId) {
  const raw = String(nodeId ?? "").trim();
  const separator = raw.indexOf("::");
  const atlas = separator < 0 ? null : raw.slice(0, separator);
  const slug = (separator < 0 ? raw : raw.slice(separator + 2)).trim().replace(/\\/g, "/");
  // Validate before normalizeLink strips leading slashes or any filesystem lookup.
  if (atlas === "" || !slug || slug.includes("\0") || isAbsolute(slug) ||
      win32.isAbsolute(slug) || /^[a-z]:/i.test(slug) || slug.split("/").includes("..")) return null;
  const id = normalizeLink(slug);
  return id && id !== "." && !id.split("/").includes("..") ? { atlas, id } : null;
}

function matchesAtlas(store, atlas) {
  return atlas === null || atlas === (store.atlasId || store.label) || atlas === store.label;
}

function pageFromStore(store, id) {
  const canonicalRoot = realpathSync(store.root);
  const candidates = [
    resolve(store.root, `${id}.md`),
    resolve(store.root, id),
    ...(!id.includes("/") ? ["experiences", "decisions", "work", "knowledge", "raw/experiences"]
      .map((dir) => resolve(store.root, dir, `${id}.md`)) : []),
  ];
  let file;
  let target;
  for (const candidate of candidates) {
    if (!isPathWithin(store.root, candidate)) return null;
    try {
      target = confinedPath(canonicalRoot, candidate);
      if (!target) return null;
      if (statSync(target).isFile()) {
        file = candidate;
        break;
      }
    } catch (error) {
      if (error.code === "ELOOP") return null;
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
    }
  }
  if (!file) return null;
  const rel = relative(store.root, file).replace(/\\/g, "/");
  const { meta, body } = parseFrontmatter(readText(target));
  const type = typeof meta.type === "string" && meta.type ? meta.type : "";
  const kind = kindFor(rel, type, store.format);
  return {
    id: pageSlug(rel),
    path: rel,
    title: displayTitle(meta, rel),
    type: type || kind,
    kind,
    sources: sourcesOf(meta),
    relatesTo: relatesToOf(meta),
    body: body.trim(),
  };
}

export function loadPage(rawRoot, nodeId, cwd) {
  const identity = pageIdentity(nodeId);
  if (!identity) return null;
  const store = inspectRoot(rawRoot, cwd);
  if (!store.available || !matchesAtlas(store, identity.atlas)) return null;
  return pageFromStore(store, identity.id);
}

export function listPresets(cwd, { specs = allPresetSpecs(cwd) } = {}) {
  return specs
    .map((p) => inspectRoot(p.root, cwd, { label: p.label, strict: p.discovered }))
    .filter((s) => s.available);
}

export function defaultRoot(cwd, stores = listPresets(cwd)) {
  const presets = stores.filter((s) => s.available);
  const pick =
    presets.find((s) => s.label === "ATLAS_ROOT") ||
    presets.find((s) => s.label === "Workspace atlas") ||
    presets.find((s) => s.label === "This workspace") ||
    presets.find((s) => s.label === "Mounted atlas") ||
    presets.find((s) => !String(s.root).includes("mini-atlas")) ||
    presets[0];
  return pick?.root ?? "";
}

export function loadPageFromRoots(roots, nodeId, cwd) {
  const list = (roots || []).filter(Boolean);
  const identity = pageIdentity(nodeId);
  if (!identity) return null;
  for (const root of list) {
    const store = inspectRoot(root, cwd);
    if (!store.available || !matchesAtlas(store, identity.atlas)) continue;
    const key = store.atlasId || store.label;
    const page = pageFromStore(store, identity.id);
    if (page) return { ...page, atlasKey: key, storeRoot: store.root };
    if (identity.atlas !== null) return null;
  }
  return null;
}

export function loadCombinedGraphs(roots, cwd, options = {}) {
  const graphs = (roots || []).map((root) => loadFullGraph(root, cwd, {
    ...options,
    fallbackStore: options.previousStores?.find((store) => store.root === sanitizeRoot(root, cwd)),
  }));
  return { ...combineAtlases(graphs), stores: graphs.map((graph) => graph.store) };
}

export function loadFullGraph(rawRoot, cwd, { strict = false, fallbackStore } = {}) {
  let offset = 0;
  let acc = null;
  while (true) {
    const batch = loadGraph(rawRoot, { offset, limit: offset === 0 ? 24 : 80, strict, fallbackStore }, cwd);
    if (!batch.store.available) return batch;
    acc = acc ? mergeGraphs(acc, batch) : batch;
    const next = batch.nextOffset;
    if (next == null) return acc;
    if (!Number.isFinite(next) || next <= offset) {
      throw new Error(`Atlas scan did not advance beyond offset ${offset}.`);
    }
    offset = next;
  }
}
