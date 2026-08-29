import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { allPresetSpecs } from "./catalog.mjs";
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
import { mergeGraphs } from "./merge.mjs";

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

function walkMd(dir, acc = [], depth = 0) {
  if (!existsSync(dir) || depth > 12) return acc;
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const name of entries) {
    if (name.startsWith(".")) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      walkMd(full, acc, depth + 1);
    } else if (name.endsWith(".md")) {
      acc.push(full);
    }
  }
  return acc;
}

function ensureListed(storeRoot) {
  let L = listings.get(storeRoot);
  if (!L || !L.done) {
    const files = walkMd(storeRoot).sort();
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

function readJson(path) {
  try {
    return JSON.parse(readText(path));
  } catch {
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

function tallyStore(root) {
  const files = ensureListed(root).files;
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

export function inspectRoot(rawRoot, cwd) {
  const root = sanitizeRoot(rawRoot, cwd);
  const label =
    allPresetSpecs(cwd).find((p) => sanitizeRoot(p.root, cwd) === root)?.label ?? root;
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
  if (!existsSync(root)) return empty("Path does not exist.");
  let st;
  try {
    st = statSync(root);
  } catch {
    return empty("Cannot read path.");
  }
  if (!st.isDirectory()) return empty("Root must be a directory.");
  const format = detectFormat(root);
  if (format === "unknown") {
    return empty("Not an Atlas (need SCHEMA.json or index.md) or okf-wiki store.");
  }
  let atlasId;
  if (format === "atlas") {
    const schema = readJson(join(root, "SCHEMA.json"));
    if (schema && typeof schema.atlas_id === "string") atlasId = schema.atlas_id;
  }
  const counts = tallyStore(root);
  return {
    root,
    label,
    available: true,
    format,
    atlasId,
    ...counts,
  };
}

function parseFiles(storeRoot, files, format, atlasId) {
  const nodes = [];
  for (const file of files) {
    const rel = (isAbsolute(file) ? relative(storeRoot, file) : file).replace(/\\/g, "/");
    let text = "";
    try {
      const full = isAbsolute(file) ? file : join(storeRoot, file);
      text = readText(full);
    } catch {
      continue;
    }
    if (!text) continue;
    const { meta, body } = parseFrontmatter(text);
    const type = typeof meta.type === "string" && meta.type ? meta.type : "";
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
      kind,
      title: displayTitle(meta, rel),
      type: type || kind,
      path: rel,
      degree: 0,
      sourceCount: sources.length,
      aliases: aliasesFor(rel),
      refs,
      atlasId,
    });
  }
  return nodes;
}

export function loadGraph(rawRoot, opts, cwd) {
  const store = inspectRoot(rawRoot, cwd);
  if ((opts?.offset ?? 0) === 0) clearListing(store.root);
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
  const { files, complete: listedAll } = ensureListed(store.root);
  const slice = files.slice(offset, offset + limit);
  const nodes = parseFiles(store.root, slice, store.format, store.atlasId);
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

export function loadPage(rawRoot, nodeId, cwd) {
  const store = inspectRoot(rawRoot, cwd);
  if (!store.available) return null;
  const id = normalizeLink(nodeId);
  const stem = basename(id);
  const candidates = [
    join(store.root, id.endsWith(".md") ? id : `${id}.md`),
    join(store.root, "experiences", `${stem}.md`),
    join(store.root, "decisions", `${stem}.md`),
    join(store.root, "work", `${stem}.md`),
    join(store.root, "knowledge", `${stem}.md`),
    join(store.root, "raw", "experiences", `${stem}.md`),
    join(store.root, id),
  ];
  const file = candidates.find((p) => existsSync(p) && statSync(p).isFile());
  if (!file) return null;
  const rel = relative(store.root, file).replace(/\\/g, "/");
  const { meta, body } = parseFrontmatter(readText(file));
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

export function listPresets(cwd) {
  return allPresetSpecs(cwd)
    .map((p) => inspectRoot(p.root, cwd))
    .filter((s) => s.available || s.root.includes("mini-atlas") || s.label === "Mounted atlas");
}

export function defaultRoot(cwd) {
  const presets = listPresets(cwd);
  const envFirst = presets.find((s) => s.label === "ATLAS_ROOT" && s.available);
  if (envFirst) return envFirst.root;
  const mounted = presets.find((s) => s.label === "Mounted atlas" && s.available);
  if (mounted) return mounted.root;
  const mini = presets.find((s) => s.available);
  return mini?.root ?? "";
}

export function loadFullGraph(rawRoot, cwd) {
  let offset = 0;
  let acc = null;
  for (let steps = 0; steps < 40; steps++) {
    const batch = loadGraph(rawRoot, { offset, limit: steps === 0 ? 24 : 80 }, cwd);
    if (!batch.store.available) return batch;
    acc = acc ? mergeGraphs(acc, batch) : batch;
    const next = batch.nextOffset;
    if (next == null || next <= offset) break;
    offset = next;
  }
  return acc ?? loadGraph(rawRoot, { offset: 0, limit: 200 }, cwd);
}
