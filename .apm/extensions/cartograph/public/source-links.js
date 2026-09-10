import { escapeHtml } from "./markdown.js";

export function sourceKind(path) {
  if (typeof path !== "string" || !path || /[\u0000-\u001f\u007f]/.test(path)) return "unsupported";
  if (/^https?:\/\//i.test(path)) {
    try {
      const url = new URL(path);
      if (url.hostname) return "external";
    } catch {}
    return "unsupported";
  }
  if (path.startsWith("atlas://") || /^[^/:]+::/.test(path)) return "internal";
  return /^[a-z][a-z0-9+.-]*:/i.test(path) || /^[\\/]{2}/.test(path) ? "unsupported" : "internal";
}

function readable(segment) {
  try { return decodeURIComponent(segment); } catch { return segment; }
}

export function externalSourceLabel(path, title) {
  if (sourceKind(path) !== "external") return null;
  const url = new URL(path);
  const parts = url.pathname.split("/").filter(Boolean).map(readable);
  let context = url.host;
  let label = parts.length ? parts.join(" / ").replace(/[-_]/g, " ") : url.hostname;
  if (url.hostname.toLowerCase() === "github.com" && parts.length >= 2) {
    context = `${parts[0]}/${parts[1]} · ${url.host}`;
    const [,, kind, value, ...rest] = parts;
    if (kind === "pull" && /^\d+$/.test(value)) label = `Pull request #${value}`;
    else if (kind === "issues" && /^\d+$/.test(value)) label = `Issue #${value}`;
    else if (kind === "releases" && value === "tag" && rest.length) label = `Release ${rest.join("/")}`;
    else if (kind === "commit" && value) label = `Commit ${value.slice(0, 12)}`;
    else if (kind === "blob" && value && rest.length) label = `File ${rest.join("/")} (${value})`;
    else if (kind === "releases") label = value === "latest" ? "Latest release" : "Releases";
    else if (!kind) label = "Repository";
  }
  return { label: typeof title === "string" && title.trim() ? title.trim() : label, context };
}

const externalIcon = '<svg class="external-source-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 4h6v6M20 4 10 14M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"></path></svg>';

export function renderExternalSources(details) {
  return details.map(({ path, title }, index) => {
    const info = externalSourceLabel(path, title);
    if (!info) return "";
    return `<li><a class="external-source" href="${escapeHtml(path)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(path)}" aria-describedby="external-source-url-${index}">
      <span class="external-source-copy"><span class="external-source-label">${escapeHtml(info.label)}</span><span class="external-source-context">${escapeHtml(info.context)}</span><span class="external-source-url" id="external-source-url-${index}">${escapeHtml(path)}</span></span>${externalIcon}</a></li>`;
  }).join("");
}
