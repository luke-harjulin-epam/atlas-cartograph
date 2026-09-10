import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultRoot, inspectRoot, listPresets, loadCombinedGraphs, loadFullGraph, loadPage, loadPageFromRoots, sanitizeRoot } from "./atlas/scan.mjs";
import { DuplicateAtlasKeyError } from "./atlas/merge.mjs";
import { allPresetSpecs, discoverAtlasPresets } from "./atlas/catalog.mjs";
import { normalizeLink } from "./atlas/parse.mjs";
import { createPageResolver, pageReference } from "./atlas/resolve.mjs";
import { answerQuery } from "./atlas/chat.mjs";
import { createChatRequests } from "./atlas/chat-requests.mjs";
import { DEFAULT_DURATION_MS, validateDuration } from "./activity/model.mjs";
import { createActivityService } from "./activity/service.mjs";
import { createLiveAtlas, graphFileKey, mountGraphChanges } from "./atlas/live.mjs";
import { readJsonBody, requireCanvas } from "./http.mjs";
import { nodeLayer, nodeLayerKeys, normalizeLayers } from "./public/node-layers.js";
import { readBuildInfo } from "./build-info.mjs";
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
    build: readBuildInfo(),
    stateRevision: 0,
    phase: input.skipIntro ? (root ? "map" : "welcome") : root ? "jump" : "crawl",
    root,
    roots: root ? [root] : [],
    query: "",
    queryRevision: 0,
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
    layersRevision: 0,
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
  state.stateRevision = (state.stateRevision ?? 0) + 1;
  return {
    stateRevision: state.stateRevision,
    build: state.build,
    phase: state.phase,
    root: state.root,
    roots: state.roots || (state.root ? [state.root] : []),
    query: state.query,
    queryRevision: state.queryRevision ?? 0,
    selectedId: state.selectedId,
    previewOpen: state.previewOpen,
    layers: state.layers,
    layersRevision: state.layersRevision ?? 0,
    graph: state.graph,
    page: state.page,
    error: state.error,
    linkError: state.linkError,
    stores: state.stores,
    grouping: state.grouping || "layers",
    chat: state.chat || [],
    chatMode: state.chatMode || "local",
    openedAt: state.openedAt,
    activity: state.activity,
    graphWatch: state.graphWatch,
    graphChanges: state.graphChanges,
  };
}

function broadcast(entry) {
  entry.liveAtlas?.syncRoots({ retry: false });
  entry.activity.sync();
  const payload = `data: ${JSON.stringify(snapshot(entry.state))}\n\n`;
  for (const res of entry.clients) {
    res.write(payload);
  }
}

function sendJson(res, code, body) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

export function setQuery(state, query) {
  state.query = String(query ?? "");
  state.queryRevision = (state.queryRevision ?? 0) + 1;
}

export function setLayers(state, layers) {
  if (!layers || typeof layers !== "object" || Array.isArray(layers) ||
      Object.values(layers).some((value) => typeof value !== "boolean")) {
    const error = new Error("Layers must be an object of boolean values.");
    error.statusCode = 400;
    throw error;
  }
  state.layers = normalizeLayers({ ...state.layers, ...layers }, nodeLayerKeys(state.graph));
  state.layersRevision = (state.layersRevision ?? 0) + 1;
}

function reconcileLayers(state, previousGraph) {
  const next = normalizeLayers(state.layers, nodeLayerKeys(state.graph));
  const previousTypes = new Map((previousGraph?.nodes ?? []).map((node) => [graphFileKey(node), node.typeKey]));
  for (const node of state.graph?.nodes ?? []) {
    if (!node.typeKey && previousTypes.get(graphFileKey(node))) next[nodeLayer(node)] = true;
  }
  if (JSON.stringify(next) !== JSON.stringify(state.layers)) setLayers(state, next);
}

export function hydrateStores(state, options) {
  try {
    state.stores = listPresets(state.cwd, options).filter((s) => s.format === "atlas" || s.available);
    if (state.error?.startsWith("Cannot list Atlas stores:")) state.error = null;
  } catch (error) {
    state.error = `Cannot list Atlas stores: ${error.message ?? error}`;
  }
}

export function openDefaultAtlases(state, input = {}) {
  try {
    const explicit = sanitizeRoot(input.root, state.cwd);
    const mounts = explicit ? null : discoverAtlasPresets(state.cwd);
    openAtlases(state, explicit ? [explicit] : mounts.map((store) => store.root), { strict: true });
    state.phase = state.graph?.store?.available ? (input.skipIntro === false ? "jump" : "map") : "welcome";
    hydrateStores(state, mounts ? { specs: allPresetSpecs(state.cwd, { mounts }) } : undefined);
  } catch (error) {
    state.error = `Cannot open Atlas stores: ${error.message ?? error}`;
    if (!state.graph?.store?.available) state.phase = "welcome";
  }
  return state;
}

function normalizeRoots(state) {
  const roots = Array.isArray(state.roots) ? state.roots.filter(Boolean) : [];
  if (!roots.length && state.root) roots.push(state.root);
  return [...new Set(roots)];
}

function applyGraph(state, graph, { jump = true } = {}) {
  const previousGraph = state.graph;
  state.graph = graph;
  reconcileLayers(state, previousGraph);
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

export function openAtlases(state, roots, { jump = true, strict = false } = {}) {
  roots = [...new Set(roots.map((root) => sanitizeRoot(root, state.cwd)).filter(Boolean))];
  const graph = roots.length ? loadCombinedGraphs(roots, state.cwd, { strict }) : null;
  state.graphChanges = mountGraphChanges(state.graphChanges);
  state.selectedId = null;
  state.previewOpen = false;
  state.page = null;
  state.error = null;
  state.linkError = null;
  state.roots = roots;
  state.root = roots[0] || "";
  if (!roots.length) {
    state.graph = null;
    reconcileLayers(state);
    state.phase = "welcome";
    return state;
  }
  return applyGraph(state, graph, { jump });
}

export function openAtlas(state, root, { add = false } = {}) {
  const trimmed = sanitizeRoot(root, state.cwd);
  const roots = trimmed ? (add ? [...normalizeRoots(state), trimmed] : [trimmed]) : [];
  return openAtlases(state, roots, { jump: !add });
}

export function addAtlas(state, root) {
  return openAtlas(state, root, { add: true });
}

export function dropAtlas(state, root) {
  const trimmed = sanitizeRoot(root, state.cwd);
  const roots = normalizeRoots(state).filter((r) => r !== trimmed);
  const graph = roots.length ? loadCombinedGraphs(roots, state.cwd) : null;
  state.graphChanges = mountGraphChanges(state.graphChanges);
  state.roots = roots;
  state.root = state.roots[0] || "";
  state.selectedId = null;
  state.previewOpen = false;
  state.page = null;
  if (!state.roots.length) {
    state.graph = null;
    reconcileLayers(state);
    state.phase = "welcome";
    return state;
  }
  if (state.roots.length === 1 && state.grouping === "atlases") state.grouping = "layers";
  return applyGraph(state, graph, { jump: false });
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
  const previousGraph = state.graph;
  state.graph = graph;
  reconcileLayers(state, previousGraph);
  state.stores = state.stores.map((store) => graph.stores.find((next) => next.root === store.root) ?? store);
  state.page = page;
  state.selectedId = selected?.id ?? null;
  if (!selected) { state.previewOpen = false; state.linkError = null; }
  state.error = graph.store.available ? null : graph.store.reason ?? "Store is not available.";
  // Keep the map mounted so deleted nodes can dissolve even if the last root disappears.
  if (state.phase === "welcome" && graph.store.available) state.phase = "map";
  return true;
}

const pageResolvers = new WeakMap();

function resolveNodeId(state, raw, sourceId = state.selectedId, options = {}) {
  const nodes = state.graph?.nodes ?? [];
  let resolve = pageResolvers.get(nodes);
  if (!resolve) {
    resolve = createPageResolver(nodes);
    pageResolvers.set(nodes, resolve);
  }
  const source = nodes.find((node) => node.id === sourceId) ??
    (sourceId === state.selectedId ? state.page : null);
  const key = normalizeLink(String(raw ?? ""));
  const relative = options.relative ?? (pageReference(raw, source)?.relative ||
    !(source?.refs ?? []).some((ref) =>
      (ref.kind === "source" || ref.kind === "relates") && normalizeLink(ref.raw) === key));
  const hit = resolve(raw, source, { relative, titles: true });
  if (hit) return hit.id;
  const reference = pageReference(raw, source, { relative });
  if (!reference || reference.relative) return null;
  return reference.atlas === null ? reference.id : `${reference.atlas}::${reference.id}`;
}

function enrichPage(state, page, nodeId) {
  const node = state.graph?.nodes?.find((n) => n.id === nodeId);
  const declaredPath = (path) => {
    if (!node?.atlasKey || !pageReference(path, node)?.relative) return path;
    const id = resolveNodeId(state, path, nodeId, { relative: false });
    const target = state.graph.nodes.find((candidate) => candidate.id === id);
    return target
      ? `${target.atlasKey}::${target.localId || normalizeLink(target.path)}`
      : `${node.atlasKey}::${normalizeLink(path)}`;
  };
  const relatesTo = [];
  const seen = new Set();
  const addRelation = (path, kind) => {
    if (!path) return;
    const key = normalizeLink(resolveNodeId(state, path, nodeId) || path);
    if (seen.has(key)) return;
    seen.add(key);
    relatesTo.push({ path, kind });
  };
  for (const relation of page?.relatesTo ?? []) addRelation(declaredPath(relation.path), relation.kind);
  if (!relatesTo.length && node) {
    for (const r of node.refs ?? []) {
      if (r.kind !== "relates" && r.kind !== "mesh") continue;
      const path = r.kind === "mesh" && r.relKind ? `atlas://${r.relKind}/${r.raw}` : r.raw;
      addRelation(r.kind === "relates" ? declaredPath(path) : path, r.relKind || r.kind);
    }
  }
  for (const e of state.graph?.edges ?? []) {
    if (e.kind === "source") continue;
    let other = null;
    if (e.source === nodeId) other = e.target;
    else if (e.target === nodeId) other = e.source;
    addRelation(other, e.relKind || e.kind);
  }
  const sources =
    (page?.sources?.length
      ? page.sources
      : (node?.refs ?? []).filter((r) => r.kind === "source").map((r) => r.raw)).map(declaredPath);
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
  const node = state.graph?.nodes?.find((n) => n.id === id);
  const inGraph = Boolean(node);
  const roots = normalizeRoots(state);
  const loaded = node?.storeRoot
    ? loadPage(node.storeRoot, node.path, state.cwd)
    : roots.length ? loadPageFromRoots(roots, id, state.cwd) : null;
  if (!inGraph && !loaded) {
    state.linkError = `No page for “${nodeId}”.`;
    return state;
  }
  state.linkError = null;
  state.selectedId = id;
  if (node && state.layers[nodeLayer(node)] === false) setLayers(state, { [nodeLayer(node)]: true });
  state.previewOpen = true;
  state.page = enrichPage(state, loaded, id);
  return state;
}

export function activateNode(state, nodeId) {
  const previous = state.selectedId;
  selectNode(state, nodeId);
  if (!state.linkError && state.selectedId) state.previewOpen = state.selectedId === previous;
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
  state.chatMode = options.onChat ? "session" : "local";
  const entry = { state, clients: new Set(), instanceId, onChat: options.onChat };
  entry.chat = createChatRequests(state, { ...options.chat, onChange: () => broadcast(entry) });
  entry.activity = createActivityService(entry, sendJson, options.activity);
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    try {
      if (await entry.activity.handle(req, res, url.pathname)) return;
      const canvasRoutes = {
        "/api/ui": "POST", "/api/probe": "POST", "/api/page": "POST",
        "/api/graph": "GET", "/api/bootstrap": "GET", "/events": "GET",
      };
      if (canvasRoutes[url.pathname]) {
        requireCanvas(req, entry.url, { allowEventSource: url.pathname === "/events" });
        if (req.method !== canvasRoutes[url.pathname]) {
          sendJson(res, 405, { error: "Method not allowed." });
          return;
        }
        if (req.method === "POST" && req.headers["content-type"]?.split(";")[0] !== "application/json") {
          sendJson(res, 415, { error: "Canvas requests require application/json." });
          return;
        }
      }
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
          defaultRoot: defaultRoot(entry.state.cwd, entry.state.stores),
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
          openAtlas(entry.state, body.root);
          entry.liveAtlas.syncRoots();
          if (entry.state.graph?.store?.available) entry.state.phase = "jump";
        } else if (body.action === "add") {
          addAtlas(entry.state, body.root);
          entry.liveAtlas.syncRoots();
          if (entry.state.phase === "jump") entry.state.phase = "map";
        } else if (body.action === "drop") {
          dropAtlas(entry.state, body.root);
        } else if (body.action === "phase") {
          entry.state.phase = body.phase;
        } else if (body.action === "select") {
          selectNode(entry.state, body.nodeId);
        } else if (body.action === "activate") {
          activateNode(entry.state, body.nodeId);
        } else if (body.action === "query") {
          setQuery(entry.state, body.query);
        } else if (body.action === "layers") {
          setLayers(entry.state, body.layers);
        } else if (body.action === "grouping") {
          entry.state.grouping =
            body.grouping === "proximity" ? "proximity" : body.grouping === "atlases" ? "atlases" : "layers";
        } else if (body.action === "preview") {
          entry.state.previewOpen = Boolean(body.open);
        } else if (body.action === "chat") {
          const text = String(body.text ?? "").trim();
          if (text) {
            const ask = entry.onChat;
            const requestId = entry.chat.begin(text, Boolean(ask));
            broadcast(entry);
            sendJson(res, 200, snapshot(entry.state));
            Promise.resolve()
              .then(() => (ask ? ask(text, entry.state, { requestId, instanceId }) : answerQuery(entry.state, text)))
              .then((reply) => {
                if (!reply?.accepted) entry.chat.completeLocal(requestId, reply);
              })
              .catch((err) => entry.chat.fail(requestId, err));
            return;
          }
        }
        broadcast(entry);
        sendJson(res, 200, snapshot(entry.state));
        return;
      }

      serveStatic(req, res);
    } catch (err) {
      if (err.statusCode === 413) res.setHeader("Connection", "close");
      if (err instanceof DuplicateAtlasKeyError) {
        entry.state.error = err.message;
        broadcast(entry);
      }
      sendJson(res, err.statusCode ?? 500, { error: String(err?.message ?? err) });
    }
  });

  entry.liveAtlas = createLiveAtlas(entry, refreshAtlases, () => broadcast(entry), options.graphWatch);
  server.once("close", () => { entry.chat.close(); entry.activity.close(); entry.liveAtlas.close(); });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
  } catch (error) {
    entry.chat.close();
    entry.activity.close();
    entry.liveAtlas.close();
    throw error;
  }
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  entry.server = server;
  entry.url = `http://127.0.0.1:${port}/`;
  entry.broadcast = () => {
    entry.liveAtlas.syncRoots();
    broadcast(entry);
  };
  entry.close = async () => {
    entry.chat.close();
    entry.liveAtlas.close();
    entry.activity.close();
    for (const res of entry.clients) res.end();
    entry.clients.clear();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  };
  entry.liveAtlas.syncRoots();
  return entry;
}
