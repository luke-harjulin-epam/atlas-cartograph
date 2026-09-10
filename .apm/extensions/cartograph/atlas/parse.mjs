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
  const lines = block.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const sourceField = line.match(/^sources:\s*(.*)$/);
    if (sourceField) {
      flushObj();
      listKey = objectList = null;
      const sourceLines = [sourceField[1]];
      while (index + 1 < lines.length && !/^[A-Za-z0-9_-]+:/.test(lines[index + 1])) {
        sourceLines.push(lines[++index]);
      }
      meta.sources = parseSources(sourceLines);
      continue;
    }
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

// Only sources get this small scalar/list/record grammar, not general YAML.
function sourceScalar(value) {
  const text = value.trim();
  if (text.startsWith('"') && text.endsWith('"')) {
    try { return JSON.parse(text); } catch { return text.slice(1, -1); }
  }
  if (text.startsWith("'") && text.endsWith("'")) return text.slice(1, -1).replace(/''/g, "'");
  return text.replace(/\s+#.*$/, "").trim();
}
function splitSourceFlow(text) {
  const parts = [];
  let start = 0, depth = 0, quote = "";
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quote) {
      if (quote === '"' && char === "\\") { i += 1; continue; }
      if (char === quote) {
        if (quote === "'" && text[i + 1] === "'") i += 1;
        else quote = "";
      }
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "{" || char === "[") depth += 1;
    else if (char === "}" || char === "]") depth -= 1;
    else if (char === "," && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
  }
  parts.push(text.slice(start));
  return parts;
}
function sourceRecordField(text, record) {
  const field = text.match(/^(?:"(path|url|uri|title)"|'(path|url|uri|title)'|(path|url|uri|title)):\s*(.*)$/);
  if (!field) return false;
  const key = field[1] || field[2] || field[3];
  record[key] = sourceScalar(field[4]);
  return true;
}
function sourceValue(text) {
  const value = text.trim();
  if (value.startsWith("{") && value.endsWith("}")) {
    const record = {};
    for (const field of splitSourceFlow(value.slice(1, -1))) sourceRecordField(field.trim(), record);
    return record;
  }
  return sourceScalar(value);
}
function parseSources(lines) {
  const first = lines[0].trim();
  if (first.startsWith("[") && first.endsWith("]")) {
    return splitSourceFlow(first.slice(1, -1)).filter((s) => s.trim()).map(sourceValue);
  }
  if (first && !first.startsWith("#")) return sourceValue(first);
  const result = [];
  let record = null;
  for (const line of lines.slice(1)) {
    const text = line.trim();
    if (!text || text.startsWith("#")) continue;
    const item = text.match(/^-\s+(.+)$/);
    if (item) {
      record = {};
      if (sourceRecordField(item[1], record)) result.push(record);
      else { result.push(sourceValue(item[1])); record = null; }
    } else if (record) sourceRecordField(text, record);
    else if (!result.length) {
      record = {};
      if (sourceRecordField(text, record)) result.push(record);
      else record = null;
    }
  }
  return result;
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
  return sourceDetailsOf(meta).map((source) => source.path);
}
function sourceDetailsOf(meta) {
  const raw = Array.isArray(meta.sources) ? meta.sources : [meta.sources];
  const out = [];
  for (const source of raw) {
    const record = source && typeof source === "object" && !Array.isArray(source) ? source : null;
    const path = typeof source === "string" ? source :
      ["path", "url", "uri"].map((key) => record?.[key]).find((value) => typeof value === "string" && value.trim());
    if (!path?.trim()) continue;
    const destination = path.trim();
    const remote = /^[a-z][a-z0-9+.-]*:(?!:)/i.test(destination) && !destination.startsWith("atlas://");
    const normalized = remote || destination.startsWith("//")
      ? destination : normalizeLink(destination);
    const title = typeof record?.title === "string" ? record.title.trim() : "";
    out.push({ path: normalized, ...(title ? { title } : {}) });
  }
  return out;
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
  sourceDetailsOf,
  sourcesOf,
  stripMarkdownCode
};
import { listKind, splitBlocks } from "../public/markdown.js";
