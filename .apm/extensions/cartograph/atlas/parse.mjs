const WIKILINK_RE = /\[\[([^\]\0|]+)(?:\|[^\]]*)?\]\]/g;
const MD_LINK_RE = /\[([^\]]+)\]\(([^)\0]+)\)/g;
const ATLAS_URI_RE = /atlas:\/\/([A-Za-z0-9._-]+)\/([^\s)\]"'<>\0]+)/g;

function stripCodeSpans(text) {
  const runs = [...text.matchAll(/`+/g)];
  const next = new Map();
  // Index equal-length closers once, including unmatched and differently sized runs.
  for (let i = runs.length - 1; i >= 0; i -= 1) {
    runs[i].closer = next.get(runs[i][0].length);
    runs[i].escapedCloser = next.get(runs[i][0].length - 1);
    next.set(runs[i][0].length, i);
  }
  const out = [];
  let start = 0;
  for (let i = 0; i < runs.length; i += 1) {
    const run = runs[i];
    let escapes = 0;
    for (let j = run.index - 1; j >= 0 && text[j] === "\\"; j -= 1) escapes += 1;
    const escaped = escapes % 2;
    const closeIndex = escaped ? run.escapedCloser : run.closer;
    if (closeIndex === undefined) continue;
    const closer = runs[closeIndex];
    out.push(text.slice(start, run.index + escaped), "\0");
    start = closer.index + closer[0].length;
    i = closeIndex;
  }
  return out.join("") + text.slice(start);
}

function stripMarkdownCode(text) {
  const out = [];
  let prose = [];
  let fence = "";
  const flush = () => {
    for (const block of splitBlocks(prose.join("\n"))) {
      if (/^\s*\|/.test(block)) {
        out.push(block.split("\n").map((row) => row.split("|").map(stripCodeSpans).join("|")).join("\n"));
      } else if (listKind(block)) {
        out.push(block.split("\n").map(stripCodeSpans).join("\n"));
      } else {
        out.push(stripCodeSpans(block));
      }
    }
    prose = [];
  };
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) {
        fence = "";
      }
      continue;
    }
    if (marker && (marker[1][0] === "~" || !marker[2].includes("`"))) {
      flush();
      // A non-path sentinel prevents new links from forming across removed code.
      out.push("\0");
      fence = marker[1];
    } else if (!line.trim()) {
      flush();
      out.push(line);
    } else {
      prose.push(line);
    }
  }
  flush();
  return out.join("\n");
}

function parseFrontmatter(text) {
  if (!text.startsWith("---")) return { meta: {}, body: text };
  const end = text.indexOf("\n---", 3);
  if (end === -1) return { meta: {}, body: text };
  const block = text.slice(3, end).trim();
  const body = text.slice(end + 4);
  const meta = {};
  let listKey = null;
  let objectList = null;
  let currentObj = null;
  const flushObj = () => {
    if (currentObj && objectList && currentObj.path) objectList.push(currentObj);
    currentObj = null;
  };
  for (const line of block.split("\n")) {
    const objField = line.match(/^\s{2,}([A-Za-z0-9_-]+):\s*(.*)$/);
    const listObj = line.match(/^\s+-\s+([A-Za-z0-9_-]+):(?:\s+(.*))?$/);
    const listScalar = line.match(/^\s+-\s+(.*)$/);
    if (listObj && listKey) {
      flushObj();
      if (!objectList) {
        objectList = [];
        meta[listKey] = objectList;
      }
      currentObj = { path: "", kind: "related" };
      const k = listObj[1] ?? "";
      const v = stripQuotes(listObj[2] ?? "");
      if (k === "path") currentObj.path = v;
      else if (k === "kind") currentObj.kind = v;
      continue;
    }
    if (objField && currentObj && listKey) {
      const k = objField[1] ?? "";
      const v = stripQuotes(objField[2] ?? "");
      if (k === "path") currentObj.path = v;
      else if (k === "kind") currentObj.kind = v;
      continue;
    }
    if (listScalar && listKey && !objectList) {
      const cur = meta[listKey];
      const item = stripQuotes(listScalar[1] ?? "");
      if (Array.isArray(cur) && cur.length && typeof cur[0] === "string") {
        cur.push(item);
      } else {
        meta[listKey] = [item];
      }
      continue;
    }
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    flushObj();
    objectList = null;
    const key = m[1] ?? "";
    const val = (m[2] ?? "").trim();
    if (val === "" || val === "[]") {
      meta[key] = [];
      listKey = key;
    } else {
      meta[key] = stripQuotes(val);
      listKey = null;
    }
  }
  flushObj();
  return { meta, body };
}
function stripQuotes(s) {
  return s.replace(/^["']|["']$/g, "").trim();
}
function extractWikilinks(text) {
  const out = [];
  WIKILINK_RE.lastIndex = 0;
  let m;
  while (m = WIKILINK_RE.exec(text)) {
    const raw = (m[1] ?? "").split("|")[0]?.trim() ?? "";
    if (raw) out.push(raw);
  }
  return out;
}
function extractMarkdownLinks(text) {
  const out = [];
  MD_LINK_RE.lastIndex = 0;
  let m;
  while (m = MD_LINK_RE.exec(text)) {
    const href = (m[2] ?? "").trim();
    if (!href || href.startsWith("http") || href.startsWith("#") || href.startsWith("mailto:")) {
      continue;
    }
    if (href.startsWith("atlas://")) continue;
    out.push(href);
  }
  return out;
}
function extractAtlasUris(text) {
  const out = [];
  ATLAS_URI_RE.lastIndex = 0;
  let m;
  while (m = ATLAS_URI_RE.exec(text)) {
    out.push({ atlasId: m[1] ?? "", path: (m[2] ?? "").replace(/\.md$/i, "") });
  }
  return out;
}
function relatesToOf(meta) {
  const raw = meta.relates_to;
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (item && typeof item === "object" && "path" in item && typeof item.path === "string") {
      out.push({ path: item.path, kind: typeof item.kind === "string" ? item.kind : "related" });
    } else if (typeof item === "string" && item) {
      out.push({ path: item, kind: "related" });
    }
  }
  return out;
}
function sourcesOf(meta) {
  const raw = meta.sources;
  if (!Array.isArray(raw)) return [];
  return raw.map((s) => {
    if (typeof s === "string") return s;
    if (s && typeof s === "object" && "path" in s) return String(s.path);
    return "";
  }).filter(Boolean).map(normalizeLink);
}
function normalizeLink(raw) {
  return raw.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\.md$/i, "").replace(/^\/+/, "").trim();
}
function pageSlug(relPath) {
  return normalizeLink(relPath);
}
function aliasesFor(relPath) {
  const slug = pageSlug(relPath);
  const stem = slug.split("/").pop() ?? slug;
  const set = /* @__PURE__ */ new Set([slug, stem, `${slug}.md`]);
  const prefixes = [
    "knowledge/",
    "raw/experiences/",
    "raw/articles/",
    "raw/",
    "modules/",
    "experiences/",
    "decisions/",
    "work/",
    "lessons/",
    "recipes/"
  ];
  for (const prefix of prefixes) {
    if (slug.startsWith(prefix)) set.add(slug.slice(prefix.length));
  }
  if (slug.endsWith("/index")) set.add(slug.replace(/\/index$/, ""));
  return [...set];
}
const KIND_SET = /* @__PURE__ */ new Set([
  "experience",
  "decision",
  "work",
  "lesson",
  "recipe",
  "index",
  "page",
  "knowledge",
  "raw",
  "module"
]);
function kindFor(relPath, typeField, format) {
  const typed = (typeField ?? "").trim().toLowerCase();
  if (typed && KIND_SET.has(typed)) return typed;
  const p = relPath.replace(/\\/g, "/");
  if (p === "index.md" || p === "index" || p.endsWith("/index.md") || p.endsWith("/index")) {
    return "index";
  }
  if (p.startsWith("experiences/")) return "experience";
  if (p.startsWith("decisions/")) return "decision";
  if (p.startsWith("work/")) return "work";
  if (p.startsWith("lessons/")) return "lesson";
  if (p.startsWith("recipes/")) return "recipe";
  if (p.startsWith("knowledge/")) return "knowledge";
  if (p.startsWith("raw/")) return "raw";
  if (p.startsWith("modules/")) return "module";
  return format === "okf-wiki" ? "knowledge" : "page";
}
function displayTitle(meta, relPath) {
  const t = meta.title;
  if (typeof t === "string" && t.trim()) return t.trim();
  const stem = pageSlug(relPath).split("/").pop() ?? relPath;
  return stem.replace(/-/g, " ");
}
export {
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
  stripMarkdownCode
};
import { listKind, splitBlocks } from "../public/markdown.js";
