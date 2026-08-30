import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultRoot, inspectRoot, listPresets, loadFullGraph, loadPage } from "./atlas/scan.mjs";
import { normalizeLink } from "./atlas/parse.mjs";
import { answerQuery } from "./atlas/chat.mjs";
export { defaultRoot };

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

export function freshState(cwd, input = {}) {
  const root = typeof input.root === "string" && input.root.trim() ? input.root.trim() : "";
  return {
    cwd,
    phase: input.skipIntro ? (root ? "map" : "welcome") : root ? "jump" : "crawl",
    root,
    query: "",
    selectedId: null,
    previewOpen: false,
    layers: {
      experiences: true,
      decisions: true,
      work: true,
      indexes: true,
      other: true,
      relations: true,
      sources: true,
    },
    graph: null,
    page: null,
    error: null,
    linkError: null,
    grouping: input.grouping === "proximity" ? "proximity" : "layers",
    chat: [],
    stores: [],
    openedAt: new Date().toISOString(),
  };
}

function snapshot(state) {
  return {
    phase: state.phase,
    root: state.root,
    query: state.query,
    selectedId: state.selectedId,
    previewOpen: state.previewOpen,
    layers: state.layers,
    graph: state.graph,
    page: state.page,
    error: state.error,
    linkError: state.linkError,
    stores: state.stores,
    grouping: state.grouping || "layers",
    chat: state.chat || [],
    openedAt: state.openedAt,
  };
}

function broadcast(entry) {
  const payload = `data: ${JSON.stringify(snapshot(entry.state))}\n\n`;
  for (const res of entry.clients) {
    res.write(payload);
  }
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

function sendJson(res, code, body) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

export function hydrateStores(state) {
  state.stores = listPresets(state.cwd).filter((s) => s.format === "atlas" || s.available);
}

export function openAtlas(state, root) {
  const trimmed = String(root ?? "").trim();
  state.root = trimmed;
  state.selectedId = null;
  state.previewOpen = false;
  state.page = null;
  state.error = null;
  if (!trimmed) {
    state.graph = null;
    state.phase = "welcome";
    return state;
  }
  const graph = loadFullGraph(trimmed, state.cwd);
  state.graph = graph;
  if (!graph.store.available) {
    state.error = graph.store.reason ?? "Store is not available.";
    state.phase = "welcome";
  } else {
    state.phase = state.phase === "crawl" || state.phase === "welcome" ? "jump" : state.phase;
    if (state.phase === "map" || state.phase === "jump") {
      /* keep */
    } else {
      state.phase = "jump";
    }
  }
  return state;
}

function resolveNodeId(state, raw) {
  const key = normalizeLink(String(raw ?? ""));
  if (!key) return null;
  const nodes = state.graph?.nodes ?? [];
  const hit = nodes.find(
    (n) =>
      n.id === raw ||
      n.id === key ||
      n.path === raw ||
      n.path === `${key}.md` ||
      (n.aliases ?? []).some((a) => normalizeLink(a) === key) ||
      n.title.toLowerCase() === String(raw).trim().toLowerCase() ||
      n.id.endsWith(`/${key}`) ||
      n.id.endsWith(`/${key.split("/").pop()}`),
  );
  return hit?.id ?? key;
}

function enrichPage(state, page, nodeId) {
  const node = state.graph?.nodes?.find((n) => n.id === nodeId);
  const relatesTo = [...(page?.relatesTo ?? [])];
  const seen = new Set(relatesTo.map((r) => normalizeLink(r.path)));
  if (!relatesTo.length && node) {
    for (const r of node.refs ?? []) {
      if (r.kind !== "relates" && r.kind !== "mesh") continue;
      const path = r.raw;
      if (!path || seen.has(normalizeLink(path))) continue;
      seen.add(normalizeLink(path));
      relatesTo.push({ path, kind: r.relKind || r.kind });
    }
  }
  for (const e of state.graph?.edges ?? []) {
    if (e.kind === "source") continue;
    let other = null;
    if (e.source === nodeId) other = e.target;
    else if (e.target === nodeId) other = e.source;
    if (!other || seen.has(normalizeLink(other))) continue;
    seen.add(normalizeLink(other));
    relatesTo.push({ path: other, kind: e.relKind || e.kind });
  }
  const sources =
    page?.sources?.length
      ? page.sources
      : (node?.refs ?? []).filter((r) => r.kind === "source").map((r) => r.raw);
  if (!page) {
    return {
      id: nodeId,
      path: node?.path ?? nodeId,
      title: node?.title ?? nodeId,
      type: node?.type ?? node?.kind ?? "",
      kind: node?.kind ?? "page",
      sources,
      relatesTo,
      body: "",
    };
  }
  return { ...page, relatesTo, sources };
}

export function selectNode(state, nodeId) {
  if (!nodeId) {
    state.selectedId = null;
    state.previewOpen = false;
    state.page = null;
    state.linkError = null;
    return state;
  }
  const id = resolveNodeId(state, nodeId);
  const inGraph = Boolean(state.graph?.nodes?.some((n) => n.id === id));
  const loaded = state.root ? loadPage(state.root, id, state.cwd) : null;
  if (!inGraph && !loaded) {
    state.linkError = `No page for “${nodeId}”.`;
    return state;
  }
  state.linkError = null;
  state.selectedId = id;
  state.previewOpen = true;
  state.page = enrichPage(state, loaded, id);
  return state;
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent((req.url ?? "/").split("?")[0] || "/");
  if (urlPath === "/") urlPath = "/index.html";
  const file = join(PUBLIC_DIR, urlPath.replace(/^\/+/, ""));
  if (!file.startsWith(PUBLIC_DIR) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(`<!doctype html><title>Cartograph</title><script>location.replace("/")</script>`);
    return;
  }
  const type = MIME[extname(file)] ?? "application/octet-stream";
  res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" });
  res.end(readFileSync(file));
}

export async function startServer(instanceId, state, options = {}) {
  const entry = { state, clients: new Set(), instanceId, onChat: options.onChat };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    try {
      if (url.pathname === "/events") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        res.write(`data: ${JSON.stringify(snapshot(entry.state))}\n\n`);
        entry.clients.add(res);
        req.on("close", () => entry.clients.delete(res));
        return;
      }

      if (url.pathname === "/api/bootstrap" && req.method === "GET") {
        hydrateStores(entry.state);
        sendJson(res, 200, {
          defaultRoot: defaultRoot(entry.state.cwd),
          presets: entry.state.stores,
          state: snapshot(entry.state),
        });
        return;
      }

      if (url.pathname === "/api/probe" && req.method === "POST") {
        const body = await readJsonBody(req);
        sendJson(res, 200, inspectRoot(body.root ?? "", entry.state.cwd));
        return;
      }

      if (url.pathname === "/api/graph" && req.method === "GET") {
        const root = url.searchParams.get("root") || entry.state.root;
        const graph = loadFullGraph(root, entry.state.cwd);
        sendJson(res, 200, graph);
        return;
      }

      if (url.pathname === "/api/page" && req.method === "POST") {
        const body = await readJsonBody(req);
        sendJson(res, 200, loadPage(body.root ?? entry.state.root, body.nodeId ?? "", entry.state.cwd));
        return;
      }

      if (url.pathname === "/api/ui" && req.method === "POST") {
        const body = await readJsonBody(req);
        if (body.action === "open") {
          entry.state.phase = "jump";
          openAtlas(entry.state, body.root);
        } else if (body.action === "phase") {
          entry.state.phase = body.phase;
        } else if (body.action === "select") {
          selectNode(entry.state, body.nodeId);
        } else if (body.action === "query") {
          entry.state.query = String(body.query ?? "");
        } else if (body.action === "layers") {
          entry.state.layers = { ...entry.state.layers, ...body.layers };
        } else if (body.action === "grouping") {
          entry.state.grouping = body.grouping === "proximity" ? "proximity" : "layers";
        } else if (body.action === "preview") {
          entry.state.previewOpen = Boolean(body.open);
        } else if (body.action === "chat") {
          const text = String(body.text ?? "").trim();
          if (text) {
            const chat = Array.isArray(entry.state.chat) ? entry.state.chat : [];
            chat.push({ role: "user", text });
            chat.push({ role: "graph", text: "Asking this session…", pending: true, hits: [] });
            entry.state.chat = chat.slice(-50);
            broadcast(entry);
            sendJson(res, 200, snapshot(entry.state));
            const ask = entry.onChat;
            Promise.resolve()
              .then(() => (ask ? ask(text, entry.state) : answerQuery(entry.state, text)))
              .then((reply) => {
                const cur = Array.isArray(entry.state.chat) ? entry.state.chat : [];
                const pending = [...cur].reverse().find((m) => m.role === "graph" && m.pending);
                if (pending) {
                  pending.text = reply.text || "No reply.";
                  pending.hits = reply.hits || [];
                  pending.pending = false;
                } else {
                  cur.push({ role: "graph", text: reply.text || "No reply.", hits: reply.hits || [] });
                }
                entry.state.chat = cur;
                broadcast(entry);
              })
              .catch((err) => {
                const cur = Array.isArray(entry.state.chat) ? entry.state.chat : [];
                const pending = [...cur].reverse().find((m) => m.role === "graph" && m.pending);
                const msg = err instanceof Error ? err.message : String(err);
                if (pending) {
                  pending.text = `Session query failed: ${msg}`;
                  pending.pending = false;
                }
                broadcast(entry);
              });
            return;
          }
        }
        broadcast(entry);
        sendJson(res, 200, snapshot(entry.state));
        return;
      }

      serveStatic(req, res);
    } catch (err) {
      sendJson(res, 500, { error: String(err?.message ?? err) });
    }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  entry.server = server;
  entry.url = `http://127.0.0.1:${port}/`;
  entry.broadcast = () => broadcast(entry);
  return entry;
}
