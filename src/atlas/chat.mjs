import { loadPage, loadPageFromRoots } from "./scan.mjs";

function tokens(q) {
  return String(q || "")
    .toLowerCase()
    .split(/[^a-z0-9/_-]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length > 1);
}

function excerpt(body, terms) {
  const text = String(body || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const lower = text.toLowerCase();
  let idx = -1;
  for (const t of terms) {
    const i = lower.indexOf(t);
    if (i >= 0 && (idx < 0 || i < idx)) idx = i;
  }
  if (idx < 0) return text.slice(0, 180);
  const start = Math.max(0, idx - 50);
  return `${start ? "…" : ""}${text.slice(start, start + 200)}${text.length > start + 200 ? "…" : ""}`;
}

export function searchAtlas(state, query) {
  const terms = tokens(query);
  if (!terms.length || !state.graph?.nodes?.length) return [];
  const scored = [];
  for (const n of state.graph.nodes) {
    const hay = `${n.title} ${n.id} ${n.kind} ${n.workId || ""} ${(n.aliases || []).join(" ")}`.toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (hay.includes(t)) score += 4;
      if ((n.title || "").toLowerCase().includes(t)) score += 3;
    }
    if (score) scored.push({ node: n, score, snippet: "" });
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 8);
  for (const hit of top) {
    const roots = state.roots?.length ? state.roots : state.root ? [state.root] : [];
    const page = roots.length ? loadPageFromRoots(roots, hit.node.id, state.cwd) : loadPage(state.root, hit.node.id, state.cwd);
    const body = page?.body || "";
    for (const t of terms) {
      if (body.toLowerCase().includes(t)) hit.score += 2;
    }
    hit.snippet = excerpt(body, terms);
  }
  top.sort((a, b) => b.score - a.score);
  return top.slice(0, 6).map((h) => ({
    id: h.node.id,
    title: h.node.title,
    kind: h.node.kind,
    path: h.node.path,
    snippet: h.snippet,
  }));
}

export function asText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join("\n\n").trim();
  if (typeof value === "object") {
    if (typeof value.content === "string") return value.content.trim();
    if (typeof value.summary === "string") return value.summary.trim();
    if (typeof value.text === "string") return value.text.trim();
    if (value.data != null) return asText(value.data);
  }
  return "";
}

export function pickGraphReply({ messages = [], response, summary } = {}) {
  const lastMessage = [...messages].reverse().map(asText).find(Boolean);
  return lastMessage || asText(response) || asText(summary) || "";
}

function firstSentence(text) {
  const clean = String(text || "")
    .replace(/\s+/g, " ")
    .replace(/^#+\s*/, "")
    .trim();
  if (!clean) return "";
  const m = clean.match(/^(.{20,280}?[.!?])(?:\s|$)/);
  return (m ? m[1] : clean.slice(0, 240)).trim();
}

export function answerQuery(state, query) {
  const q = String(query || "").trim();
  if (!q) return { text: "Ask something about this Atlas.", hits: [] };
  if (!state.graph?.store?.available) {
    return { text: "No Atlas is open. Open a store first.", hits: [] };
  }
  const hits = searchAtlas(state, q).slice(0, 3);
  if (!hits.length) {
    return {
      text: `No pages in **${state.graph.store.atlasId || state.graph.store.label}** matched “${q}”. Try a work_id, title, or kind.`,
      hits: [],
    };
  }
  const lead = hits[0];
  const page = state.root ? loadPage(state.root, lead.id, state.cwd) : null;
  const leadText = firstSentence(page?.body || lead.snippet) || lead.path;
  const text = [
    `**${lead.title}** — ${leadText}`,
    "",
    ...hits.map((h) => `- [${h.title}](${h.path || h.id}) (${h.kind})`),
  ].join("\n");
  return { text, hits };
}
