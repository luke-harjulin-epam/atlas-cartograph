import { loadPageFromRoots } from "./scan.mjs";
import { fileURLToPath } from "node:url";

export const CHAT_ACTIVATION_PATH = fileURLToPath(new URL("./cartograph-chat.md", import.meta.url));

function queryPage(state, id) {
  const roots = state.roots?.length ? state.roots : state.root ? [state.root] : [];
  return loadPageFromRoots(roots, id, state.cwd);
}

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
    const page = queryPage(state, hit.node.id);
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

function chatStores(state) {
  const stores = state.graph?.stores || [];
  if (stores.length) {
    return stores.map((store) => ({
      id: store.atlasId || store.label || null,
      root: store.root || null,
    }));
  }
  const roots = state.roots?.length ? state.roots : state.root ? [state.root] : [];
  return roots.map((root) => ({ id: null, root }));
}

function chatSelection(state) {
  const id = state.selectedId;
  if (!id) return null;
  const node = state.graph?.nodes?.find((item) => item.id === id);
  return { id, path: node?.path || null };
}

export function graphChatPrompt(text, state = {}, context = {}) {
  const card = {
    activation: "cartograph-chat",
    activation_path: CHAT_ACTIVATION_PATH,
    routing: { instanceId: context.instanceId, requestId: context.requestId },
    question: String(text || "").trim(),
    atlases: chatStores(state),
    selection: chatSelection(state),
    query: String(state.query || "").trim(),
  };
  return ["```text", ...Object.entries(card).map(([key, value]) => `${key}: ${JSON.stringify(value)}`), "```"].join("\n");
}

export async function askHostSession(host, text, state, context) {
  if (typeof host?.send !== "function") {
    throw new Error("Host session cannot accept chat.");
  }
  if (!context?.requestId || !context?.instanceId) throw new Error("Chat reply routing is required.");
  // send resolves with a message ID, not assistant content. Only the correlated
  // update_chat action can complete this request, independently of other turns.
  await host.send({ prompt: graphChatPrompt(text, state, context) });
  return { accepted: true };
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
  const page = queryPage(state, lead.id);
  const leadText = firstSentence(page?.body || lead.snippet) || lead.path;
  const text = [
    `**${lead.title}** — ${leadText}`,
    "",
    ...hits.map((h) => `- [${h.title}](${h.id.includes("::") ? h.id : h.path || h.id}) (${h.kind})`),
  ].join("\n");
  return { text, hits };
}
