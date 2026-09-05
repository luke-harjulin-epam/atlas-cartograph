import { posix } from "node:path";
import { pageIdentity } from "./identity.mjs";
import { normalizeLink } from "./parse.mjs";

function localPath(node) {
  return pageIdentity(node?.path || node?.localId || node?.id)?.id;
}

export function pageReference(raw, source, { relative = true } = {}) {
  const path = String(raw ?? "").trim().replace(/\\/g, "/");
  if (path.startsWith("atlas://") || path.includes("::")) {
    const identity = pageIdentity(path);
    return identity && { ...identity, relative: false };
  }
  if (relative && path.split("/").some((part) => part === "." || part === "..")) {
    // Validate before joining: absolute paths, drives and NUL must never become local IDs.
    if (!pageIdentity(path.replace(/(^|\/)\.\.(?=\/|$)/g, "$1_"))) return null;
    const base = localPath(source);
    const identity = pageIdentity(posix.join(base ? posix.dirname(base) : ".", path));
    return identity && { ...identity, atlas: source?.atlasKey ?? null, relative: true };
  }
  const identity = pageIdentity(path);
  return identity && { ...identity, relative: false };
}

export function referenceKey(raw, source) {
  const reference = pageReference(raw, source);
  return reference?.relative ? reference.id : normalizeLink(String(raw ?? ""));
}

export function createPageResolver(nodes) {
  const paths = new Map();
  const aliases = new Map();
  const titles = new Map();
  const add = (map, key, node) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(node);
  };
  for (const node of nodes) {
    add(paths, localPath(node), node);
    for (const alias of new Set([node.id, node.localId, ...(node.aliases ?? [])])) {
      if (alias) add(aliases, normalizeLink(alias), node);
    }
    add(titles, node.title?.toLowerCase(), node);
  }
  const inAtlas = (hits, atlas) => atlas == null ? hits?.[0] : hits?.find((node) => node.atlasKey === atlas);
  return (raw, source, options = {}) => {
    const reference = pageReference(raw, source, options);
    if (!reference) return null;
    const { atlas, id, relative } = reference;
    if (relative) return inAtlas(paths.get(id), atlas) ?? null;
    if (atlas !== null) {
      return inAtlas(paths.get(id), atlas) ?? inAtlas(aliases.get(id), atlas) ?? null;
    }
    const sourceAtlas = source?.atlasKey;
    // Keep root paths as identities; source-directory candidates outrank generic aliases.
    const exact = inAtlas(paths.get(id), sourceAtlas);
    if (exact) return exact;
    if (options.relative !== false && source) {
      const sibling = pageReference(`./${String(raw).trim()}`, source);
      const local = sibling && inAtlas(paths.get(sibling.id), sourceAtlas);
      if (local) return local;
    }
    const hits = aliases.get(id);
    return inAtlas(hits, sourceAtlas) ?? hits?.[0] ??
      (options.titles ? inAtlas(titles.get(String(raw).trim().toLowerCase()), sourceAtlas) ??
        titles.get(String(raw).trim().toLowerCase())?.[0] : null) ?? null;
  };
}
