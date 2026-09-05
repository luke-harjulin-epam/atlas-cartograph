import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultRoot, inspectRoot, listPresets, loadCombinedGraphs, loadFullGraph, loadPage, loadPageFromRoots, sanitizeRoot } from "./atlas/scan.mjs";
import { normalizeLink } from "./atlas/parse.mjs";
import { answerQuery } from "./atlas/chat.mjs";
import { DEFAULT_DURATION_MS, validateDuration } from "./activity/model.mjs";
import { createActivityService } from "./activity/service.mjs";
import { createLiveAtlas, graphFileKey, mountGraphChanges } from "./atlas/live.mjs";
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
  const root = typeof input.root === "string" ? sanitizeRoot(input.root, cwd) : "";
  return {
    cwd,
    phase: input.skipIntro ? (root ? "map" : "welcome") : root ? "jump" : "crawl",
    root,
    roots: root ? [root] : [],
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
    graphWatch: { status: "idle", message: "Open an Atlas to watch file changes." },
    graphChanges: { ...mountGraphChanges(), revision: 0 },
    activity: {
      providerId: input.monitorProvider,
      enabled: true,
      durationMs: validateDuration(input.activityDurationMs ?? DEFAULT_DURATION_MS),
      nodes: [],
      edges: [],
      collector: { status: "waiting", message: "Start the OS collector to observe file accesses." },
    },
  };
}

function snapshot(state) {
  return {
    phase: state.phase,
    root: state.root,
    roots: state.roots || (state.root ? [state.root] : []),
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
    activity: state.activity,
    graphWatch: state.graphWatch,
    graphChanges: state.graphChanges,
  };
}

function broadcast(entry) {
  entry.liveAtlas?.syncRoots();
  entry.activity.sync();
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

function normalizeRoots(state) {
  const roots = Array.isArray(state.roots) ? state.roots.filter(Boolean) : [];
  if (!roots.length && state.root) roots.push(state.root);
  return [...new Set(roots)];
}

function applyGraph(state, graph, { jump = true } = {}) {
  state.graph = graph;
  if (!graph?.store?.available) {
    state.error = graph?.store?.reason ?? "Store is not available.";
    state.phase = "welcome";
    return state;
  }
  state.error = null;
  if (jump && (state.phase === "crawl" || state.phase === "welcome")) state.phase = "jump";
  else if (state.phase !== "map" && state.phase !== "jump") state.phase = "jump";
  if ((state.roots || []).length > 1 && state.grouping === "layers") state.grouping = "atlases";
  return state;
}

export function openAtlas(state, root, { add = false } = {}) {
  state.graphChanges = mountGraphChanges(state.graphChanges);
  const trimmed = sanitizeRoot(root, state.cwd);
  state.selectedId = null;
  state.previewOpen = false;
  state.page = null;
  state.error = null;
  state.linkError = null;
  const current = normalizeRoots(state);
  let roots;
  if (!trimmed) {
    roots = [];
  } else if (add) {
    roots = current.includes(trimmed) ? current : [...current, trimmed];
  } else {
    roots = [trimmed];
  }
  state.roots = roots;
  state.root = roots[0] || "";
  if (!roots.length) {
    state.graph = null;
    state.phase = "welcome";
    return state;
  }
  const graph = loadCombinedGraphs(roots, state.cwd);
  return applyGraph(state, graph, { jump: !add });
}

export function addAtlas(state, root) {
  return openAtlas(state, root, { add: true });
}

export function dropAtlas(state, root) {
  state.graphChanges = mountGraphChanges(state.graphChanges);
  const trimmed = sanitizeRoot(root, state.cwd);
  state.roots = normalizeRoots(state).filter((r) => r !== trimmed);
  state.root = state.roots[0] || "";
  state.selectedId = null;
  state.previewOpen = false;
  state.page = null;
  if (!state.roots.length) {
    state.graph = null;
    state.phase = "welcome";
    return state;
  }
  if (state.roots.length === 1 && state.grouping === "atlases") state.grouping = "layers";
  return applyGraph(state, loadCombinedGraphs(state.roots, state.cwd), { jump: false });
}

export function refreshAtlases(state) {
  const roots = normalizeRoots(state);
  if (!roots.length) return false;
  const graph = loadCombinedGraphs(roots, state.cwd, {
    strict: true, previousStores: state.graph?.stores,
  });
  const previousSelection = state.graph?.nodes.find((node) => node.id === state.selectedId);
  const selected = previousSelection
    ? graph.nodes.find((node) => graphFileKey(node) === graphFileKey(previousSelection))
    : null;
  const page = selected
    ? enrichPage({ ...state, graph }, loadPage(selected.storeRoot, selected.path, state.cwd), selected.id)
    : null;
  const changed = JSON.stringify(graph) !== JSON.stringify(state.graph) ||
    JSON.stringify(page) !== JSON.stringify(state.page);
  if (!changed) return false;
  state.graph = graph;
  state.stores = state.stores.map((store) => graph.stores.find((next) => next.root === store.root) ?? store);
  state.page = page;
  state.selectedId = selected?.id ?? null;
  if (!selected) { state.previewOpen = false; state.linkError = null; }
  state.error = graph.store.available ? null : graph.store.reason ?? "Store is not available.";
  // Keep the map mounted so deleted nodes can dissolve even if the last root disappears.
  if (state.phase === "welcome" && graph.store.available) state.phase = "map";
  return true;
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
  const roots = normalizeRoots(state);
  const loaded = roots.length ? loadPageFromRoots(roots, id, state.cwd) : null;
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
  entry.activity = createActivityService(entry, sendJson, options.activity);
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    try {
      if (await entry.activity.handle(req, res, url.pathname)) return;
      if (url.pathname === "/events") {
        entry.liveAtlas.syncRoots();
        entry.activity.sync();
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
        entry.liveAtlas.syncRoots();
        hydrateStores(entry.state);
        entry.activity.sync();
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
        } else if (body.action === "add") {
          addAtlas(entry.state, body.root);
          if (entry.state.phase === "jump") entry.state.phase = "map";
        } else if (body.action === "drop") {
          dropAtlas(entry.state, body.root);
        } else if (body.action === "phase") {
          entry.state.phase = body.phase;
        } else if (body.action === "select") {
          selectNode(entry.state, body.nodeId);
        } else if (body.action === "query") {
          entry.state.query = String(body.query ?? "");
        } else if (body.action === "layers") {
          entry.state.layers = { ...entry.state.layers, ...body.layers };
        } else if (body.action === "grouping") {
          entry.state.grouping =
            body.grouping === "proximity" ? "proximity" : body.grouping === "atlases" ? "atlases" : "layers";
        } else if (body.action === "preview") {
          entry.state.previewOpen = Boolean(body.open);
        } else if (body.action === "chat") {
          const text = String(body.text ?? "").trim();
          if (text) {
            const chat = Array.isArray(entry.state.chat) ? entry.state.chat : [];
            chat.push({ role: "user", text });
            chat.push({ role: "graph", text: "Searching the Atlas…", pending: true, hits: [] });
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
      sendJson(res, err.statusCode ?? 500, { error: String(err?.message ?? err) });
    }
  });

  entry.liveAtlas = createLiveAtlas(entry, refreshAtlases, () => broadcast(entry), options.graphWatch);
  server.once("close", () => { entry.activity.close(); entry.liveAtlas.close(); });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
  } catch (error) {
    entry.activity.close();
    entry.liveAtlas.close();
    throw error;
  }
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  entry.server = server;
  entry.url = `http://127.0.0.1:${port}/`;
  entry.broadcast = () => broadcast(entry);
  entry.close = async () => {
    entry.liveAtlas.close();
    entry.activity.close();
    for (const res of entry.clients) res.end();
    entry.clients.clear();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  };
  entry.liveAtlas.syncRoots();
  return entry;
}
