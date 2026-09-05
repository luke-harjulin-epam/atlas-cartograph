import { isAbsolute, win32 } from "node:path";
import { normalizeLink } from "./parse.mjs";

export function pageIdentity(nodeId) {
  const raw = String(nodeId ?? "").trim();
  const uri = raw.match(/^atlas:\/\/([A-Za-z0-9._-]+)\/(.*)$/);
  if (raw.startsWith("atlas://") && !uri) return null;
  const separator = raw.indexOf("::");
  const atlas = uri ? uri[1] : separator < 0 ? null : raw.slice(0, separator);
  const slug = (uri ? uri[2] : separator < 0 ? raw : raw.slice(separator + 2)).trim().replace(/\\/g, "/");
  // Validate before normalizeLink strips leading slashes or any filesystem lookup.
  if (atlas === "" || !slug || slug.includes("\0") || isAbsolute(slug) ||
      win32.isAbsolute(slug) || /^[a-z]:/i.test(slug) || slug.split("/").includes("..")) return null;
  const id = normalizeLink(slug);
  return id && id !== "." && !id.split("/").includes("..") ? { atlas, id } : null;
}
