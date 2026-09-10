import { mountGraphCanvas } from "./graph-canvas.js";
import { escapeHtml, renderMarkdown } from "./markdown.js";
import { mountActivityControls } from "./activity-controls.js";
import { mountGraphWatchControls } from "./graph-watch-controls.js";
import { allNodeLayersOn, createLayerControls } from "./layer-controls.js";
import { createStateControls } from "./state-controls.js";
import { handleContentClick } from "./content-navigation.js";
import { renderExternalSources, sourceKind } from "./source-links.js";
import { mountNodeBrowser } from "./node-browser.js";
import { fallbackLayerLabel, nodeCategory, nodeLayer, layerCounts } from "./node-layers.js";
import { mountSchemaLayers } from "./schema-layers.js";
import { nodeSearchText } from "./node-search.js";

const CRAWL_BODY = `Compiled memory, mapped as sky.

Atlas stores are not wikis of folders.
They are claim-bearing pages — experience,
decision, work — joined by relates_to
and atlas:// across a mesh of skills.

Open any Atlas-compatible skill.
Lock a star. Read what the work
already knows.

The map remembers so you don't
have to grep the dark.`;

const $ = (id) => document.getElementById(id);
const phases = {
  crawl: $("phase-crawl"),
  welcome: $("phase-welcome"),
  jump: $("phase-jump"),
  map: $("phase-map"),
};
const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");

let state = { phase: "crawl", stores: [], graph: null, root: "", query: "", selectedId: null, previewOpen: false, layers: {}, grouping: "layers", error: null, linkError: null, page: null, chat: [] };
let latestStateRevision = null;
let latestActivityRevision = null;
let chatOpen = false;
let chatFullscreen = false;
const chatBackgroundInert = new Map();
let chatRenderSignature = null;
let map = null;
const activityControls = mountActivityControls($("activity-controls"), applyActivity,
  (enabled) => map?.setAutoFocus(enabled));
const graphWatchControls = mountGraphWatchControls($("activity-controls"));
const schemaLayers = mountSchemaLayers($("schema-layers"), $("schema-diagnostics"));
const queryControls = createStateControls({
  field: "query", initial: "", normalize: (value) => value,
  isValid: (value) => typeof value === "string",
}, (query) => post("query", { query }), (query, { pending, error }) => {
  state.query = query;
  state.queryRevision = queryControls.revision;
  $("search").setAttribute("aria-busy", String(pending));
  $("search-error").textContent = error || "";
  $("search-error").classList.toggle("hidden", !error);
  map?.setQuery(query);
  renderMapChrome();
  if (error) nodeBrowser.show();
});
const layerControls = createLayerControls(
  (layers) => post("layers", { layers }),
  (layers, { pending, error }) => {
    state.layers = layers;
    state.layersRevision = layerControls.layersRevision;
    $("layer-status").textContent = pending ? "Saving layers…" : "";
    $("layer-error").textContent = error || "";
    $("layer-error").classList.toggle("hidden", !error);
    if (map && state.graph) {
      const vis = visibleGraph();
      map.setGraph(vis.nodes, vis.edges, state.grouping, state.graphChanges, lifecycleVisibility(), lifecycleEdgeVisibility());
    }
    renderMapChrome();
  },
);
let previewFromBrowser = false;
const nodeBrowser = mountNodeBrowser($("node-browser"), $("search"), {
  query: (value) => queryControls.update(() => value),
  select: async (id) => {
    const node = state.graph?.nodes.find((n) => n.id === id);
    if (node) layerControls.reveal(nodeLayer(node));
    applyState(await post("activate", { nodeId: id }));
    if (state.previewOpen) {
      previewFromBrowser = true;
      $("preview-close").focus();
    }
  },
  preview: async () => {
    applyState(await post("preview", { open: true }));
    previewFromBrowser = true;
    $("preview-close").focus();
  },
  clear: async () => applyState(await post("select", { nodeId: "" })),
});

function acceptActivity(activity) {
  const revision = activity?.revision;
  if (Number.isSafeInteger(revision) && revision >= 0) {
    if (latestActivityRevision !== null && revision <= latestActivityRevision) return false;
    latestActivityRevision = revision;
  } else if (latestActivityRevision !== null) {
    return false;
  }
  return true;
}

function applyActivity(activity) {
  if (!acceptActivity(activity)) {
    // Config controls may have staged a delayed HTTP result before this callback.
    activityControls.setActivity(state.activity);
    return false;
  }
  state.activity = activity;
  map?.setActivity(activity);
  activityControls.setActivity(activity);
  return true;
}

function showPhase(name) {
  if (name !== "map") $("frame-rate").textContent = " | -- FPS";
  for (const [key, el] of Object.entries(phases)) {
    el.classList.toggle("hidden", key !== name);
    starfields[key]?.setActive(key === name);
  }
}

function post(action, payload = {}) {
  return fetch("/api/ui", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Cartograph-Client": "canvas" },
    body: JSON.stringify({ action, ...payload }),
  }).then(async (response) => {
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
    return result;
  });
}

function visibleGraph() {
  const g = state.graph;
  if (!g) return { nodes: [], edges: [] };
  const layers = state.layers || {};
  const nodes = g.nodes.filter((n) => layers[nodeLayer(n)] !== false)
    .map((node) => ({ ...node, searchText: nodeSearchText(node, state) }));
  const ids = new Set(nodes.map((n) => n.id));
  const edges = g.edges.filter((e) => {
    if (!ids.has(e.source) || !ids.has(e.target)) return false;
    return relationshipVisible(e, layers);
  });
  return { nodes, edges };
}

function lifecycleVisibility() {
  const roots = new Set(openRoots());
  const layers = { ...state.layers };
  return (node) => roots.has(node.storeRoot) && layers[nodeLayer(node)] !== false;
}

function relationshipVisible(edge, layers) {
  return (edge.kind !== "source" || layers.sources !== false) &&
    (!["relates", "mesh"].includes(edge.kind) || layers.relations !== false);
}

function lifecycleEdgeVisibility() {
  const layers = { ...state.layers };
  return (edge) => relationshipVisible(edge, layers);
}

function storeCard(s) {
  return `<button class="store-card" data-root="${escapeHtml(s.root)}">
        <h3>${escapeHtml(s.label)}</h3>
        <div class="subtle">${escapeHtml(s.format || "atlas")}${s.atlasId ? ` · ${escapeHtml(s.atlasId)}` : ""}</div>
        <div class="muted" style="margin-top:0.75rem">${s.pages ?? 0} pages · ${escapeHtml(s.root)}</div>
      </button>`;
}

function openRoots() {
  return state.roots?.length ? state.roots : state.root ? [state.root] : [];
}

function renderStores() {
  const grid = $("store-grid");
  const atlas = (state.stores || []).filter((s) => s.available);
  if (!atlas.length) {
    grid.innerHTML = `<p class="muted">No Atlas found in this session worktree. Paste a path below.</p>`;
    return;
  }
  grid.innerHTML = atlas.map(storeCard).join("");
}

function renderOpenAtlases() {
  const box = $("open-atlases");
  if (!box) return;
  const roots = openRoots();
  const byRoot = new Map((state.stores || []).map((s) => [s.root, s]));
  box.innerHTML = roots
    .map((root) => {
      const s = byRoot.get(root);
      const label = s?.label || root.split("/").pop();
      return `<div class="open-atlas"><span>${escapeHtml(label)}</span><button type="button" data-drop="${escapeHtml(root)}" ${roots.length < 2 ? "disabled" : ""}>Remove</button></div>`;
    })
    .join("");
  box.querySelectorAll("[data-drop]").forEach((btn) => {
    btn.addEventListener("click", () => post("drop", { root: btn.getAttribute("data-drop") }));
  });
}

function remainingStores() {
  const open = new Set(openRoots());
  return (state.stores || []).filter((s) => s.available && !open.has(s.root));
}

function renderAtlasAdd() {
  const overlay = $("atlas-add");
  const grid = $("atlas-add-grid");
  if (!overlay || !grid) return;
  const extra = remainingStores();
  grid.innerHTML = extra.length
    ? extra.map(storeCard).join("")
    : `<p class="muted">No other Atlases in this session. Paste a path on the welcome screen.</p>`;
}

function ensureMap() {
  if (map) return map;
  map = mountGraphCanvas($("graph-wrap"), {
    autoFocus: activityControls.autoFocusEnabled(),
    onPlayback: (playback) => activityControls.setPlayback(playback),
    onFrameRate: (fps) => {
      $("frame-rate").textContent = ` | ${state.phase === "map" && fps !== null ? fps : "--"} FPS`;
    },
    onSelect: (id) => post("activate", { nodeId: id || "" }).then(applyState).catch((error) => {
      $("map-error").textContent = `Could not select node: ${error.message ?? error}`;
      $("map-error").classList.remove("hidden");
    }),
    onCluster: () => renderIslands(),
  });
  return map;
}

function chipLabel(path) {
  return String(path)
    .replace(/\\/g, "/")
    .replace(/\.md$/i, "")
    .split("/")
    .pop();
}

function navigateWiki(target) {
  return post("select", { nodeId: target });
}

let previewSourcesMarkup = "";
function renderPreview() {
  const box = $("preview");
  const back = $("preview-backdrop");
  const open = Boolean(state.previewOpen && state.selectedId);
  box.classList.toggle("hidden", !open);
  back.classList.toggle("hidden", !open);
  if (!open) return;
  const node = state.graph?.nodes?.find((n) => n.id === state.selectedId);
  const page = state.page;
  $("preview-title").textContent = page?.title || node?.title || state.selectedId;
  $("preview-meta").textContent = `${page?.type || node?.type || node?.kind || ""} · ${nodeCategory(node || page || {}).label} · ${page?.path || node?.path || ""}`;
  const err = $("preview-link-error");
  if (err) {
    err.textContent = state.linkError || "";
    err.classList.toggle("hidden", !state.linkError);
  }
  const sources = page?.sourceDetails ?? (page?.sources ?? []).map((path) => ({ path }));
  const chips = [
    ...(page?.relatesTo ?? []).map((r) => ({ kind: r.kind || "relates", path: r.path })),
    ...sources.filter((s) => sourceKind(s.path) === "internal").map((s) => ({ kind: "source", path: s.path })),
  ];
  const rel = $("preview-relates");
  rel.classList.toggle("hidden", chips.length === 0);
  rel.innerHTML = chips
    .map(
      (c) =>
        `<li><button type="button" class="kind-${escapeHtml(c.kind)}" data-target="${escapeHtml(c.path)}">${escapeHtml(c.kind)} · ${escapeHtml(chipLabel(c.path))}</button></li>`,
    )
    .join("");
  const external = sources.filter((s) => sourceKind(s.path) === "external");
  $("preview-sources").classList.toggle("hidden", external.length === 0);
  const sourceMarkup = renderExternalSources(external);
  if (sourceMarkup !== previewSourcesMarkup) {
    $("preview-source-list").innerHTML = sourceMarkup;
    previewSourcesMarkup = sourceMarkup;
  }
  $("preview-body").innerHTML = renderMarkdown(page?.body || "_No page body._");
}

function renderMapChrome() {
  const vis = visibleGraph();
  $("stat-nodes").textContent = String(vis.nodes.length);
  $("stat-edges").textContent = String(vis.edges.length);
  $("stat-format").textContent = state.graph?.store?.format ?? "—";
  $("stat-root").textContent = state.graph?.store?.label || state.graph?.store?.atlasId || state.root || "No atlas";
  renderOpenAtlases();
  if ($("search").value !== (state.query || "")) $("search").value = state.query || "";
  document.querySelectorAll("[data-grouping]").forEach((btn) => {
    const on = (state.grouping || "layers") === btn.getAttribute("data-grouping");
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-pressed", String(on));
  });
  const counts = layerCounts(state.graph);
  document.querySelectorAll("[data-legacy-layer]").forEach((btn) => {
    const key = btn.getAttribute("data-layer");
    btn.textContent = `${fallbackLayerLabel(key)} · ${counts.get(key) ?? 0}`;
    btn.classList.toggle("hidden", key === "undeclared" && !counts.has(key));
  });
  document.querySelectorAll("[data-layer]").forEach((btn) => {
    const key = btn.getAttribute("data-layer");
    const on = key === "all" ? allNodeLayersOn(state.layers) : state.layers?.[key] !== false;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-pressed", String(on));
  });
  schemaLayers.render(state.graph, state.layers);
  nodeBrowser.setState(state);
  renderIslands();
}

let islandStart = 0;
const ISLAND_PAGE = 6;

function renderIslands() {
  const nav = $("islands");
  if (!nav || !map) return;
  const items = [...(map.clusters?.() ?? [])].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const focus = map.focusCluster?.();
  if (focus) {
    const idx = items.findIndex((c) => (c.key || c.label) === focus);
    if (idx >= 0 && (idx < islandStart || idx >= islandStart + ISLAND_PAGE)) {
      islandStart = Math.max(0, Math.min(idx, Math.max(0, items.length - ISLAND_PAGE)));
    }
  }
  const maxStart = Math.max(0, items.length - ISLAND_PAGE);
  islandStart = Math.max(0, Math.min(islandStart, maxStart));
  const slice = items.slice(islandStart, islandStart + ISLAND_PAGE);
  const canPrev = islandStart > 0;
  const canNext = islandStart + ISLAND_PAGE < items.length;
  const range =
    items.length <= ISLAND_PAGE
      ? ""
      : `<span class="island-range">${islandStart + 1}–${islandStart + slice.length} / ${items.length}</span>`;
  nav.innerHTML =
    `<button type="button" data-island="" class="${focus ? "" : "active"}">All</button>` +
    `<button type="button" data-island-shift="-1" ${canPrev ? "" : "disabled"}>‹</button>` +
    slice
      .map(
        (c) =>
          `<button type="button" data-island="${escapeHtml(c.key || c.label)}" class="${focus === (c.key || c.label) ? "active" : ""}">${escapeHtml(c.label)} · ${c.count}</button>`,
      )
      .join("") +
    `<button type="button" data-island-shift="1" ${canNext ? "" : "disabled"}>›</button>` +
    range;
  map.setFeatured?.(slice.map((c) => c.key || c.label));
  nav.querySelectorAll("[data-island-shift]").forEach((btn) => {
    btn.addEventListener("click", () => {
      islandStart += Number(btn.getAttribute("data-island-shift")) * ISLAND_PAGE;
      renderIslands();
    });
  });
  nav.querySelectorAll("[data-island]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const label = btn.getAttribute("data-island") || null;
      map.flyTo(label || null);
      renderIslands();
    });
  });
}

function renderStateError() {
  const error = state.error || (state.phase === "map" && !state.previewOpen ? state.linkError : null);
  if (error) {
    $("welcome-error").textContent = error;
    $("welcome-error").classList.toggle("hidden", state.phase !== "welcome");
    $("map-error").textContent = error;
    $("map-error").classList.toggle("hidden", state.phase !== "map");
  } else {
    $("welcome-error").classList.add("hidden");
    $("map-error").classList.add("hidden");
  }
}

function applyState(next) {
  if (Number.isSafeInteger(next.stateRevision) && next.stateRevision >= 0) {
    if (latestStateRevision !== null && next.stateRevision <= latestStateRevision) return false;
    latestStateRevision = next.stateRevision;
  } else if (latestStateRevision !== null) {
    return false;
  }
  const grouping = next.grouping || state.grouping || "layers";
  layerControls.configure(Object.hasOwn(next, "graph") ? next.graph : state.graph);
  const layers = layerControls.snapshot(next.layers, next.layersRevision);
  const query = queryControls.snapshot(next.query, next.queryRevision);
  const activity = Object.hasOwn(next, "activity") && acceptActivity(next.activity) ? next.activity : state.activity;
  state = { ...state, ...next, grouping, layers, layersRevision: layerControls.layersRevision,
    query, queryRevision: queryControls.revision, activity };
  if (state.build) {
    const { version, commit, dirty } = state.build;
    $("build-info").textContent = `v${version} / ${commit ? commit.slice(0, 8) : "SHA unavailable"}${dirty ? " + local" : ""}`;
    $("build-info").title = `Cartograph ${version}\n${commit || "Source commit unavailable"}${dirty ? "\nUncommitted runtime changes" : ""}`;
    $("build-info").classList.remove("hidden");
  }
  activityControls.setActivity(state.activity);
  graphWatchControls.setWatch(state.graphWatch);
  if (!state.graph) map?.setGraph([], [], grouping, state.graphChanges, () => false);
  showPhase(state.phase || "welcome");
  renderStateError();
  if (state.phase === "welcome") renderStores();
  if (state.phase === "map") {
    const m = ensureMap();
    const vis = visibleGraph();
    m.setGraph(vis.nodes, vis.edges, state.grouping || "layers", state.graphChanges, lifecycleVisibility(), lifecycleEdgeVisibility());
    m.setSelected(state.selectedId);
    m.setQuery(state.query || "");
    m.setActivity(state.activity);
    renderMapChrome();
    renderPreview();
    renderChat();
  }
  return true;
}

async function openRoot(root) {
  await post("open", { root });
}

function seedStars(canvas, warpFn) {
  const ctx = canvas.getContext("2d");
  const stars = Array.from({ length: 420 }, () => {
    const a = Math.random() * Math.PI * 2;
    const r = 0.06 + Math.random() * 0.98;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r * 0.62, z: Math.random(), s: 0.4 + Math.random() * 1.4, hue: Math.random() };
  });
  let last = performance.now();
  let active = false;
  let frame = null;
  const tick = (now) => {
    frame = null;
    if (!active) return;
    const reduced = motionPreference.matches;
    const dt = reduced ? 0 : Math.min(0.05, (now - last) / 1000);
    last = now;
    const { warp, flash } = reduced ? { warp: 0, flash: 0 } : warpFn(now);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#020308";
    ctx.fillRect(0, 0, w, h);
    const vg = ctx.createRadialGradient(w * 0.5, h * 0.48, 6, w * 0.5, h * 0.5, Math.max(w, h) * 0.72);
    vg.addColorStop(0, `rgba(36, 72, 128, ${0.14 + warp * 0.2})`);
    vg.addColorStop(0.5, "rgba(8, 14, 28, 0.35)");
    vg.addColorStop(1, "#020308");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);
    const cx = w / 2; const cy = h / 2; const focal = Math.min(w, h) * 0.55;
    const vz = (0.018 + warp * 3.35) * dt;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const star of stars) {
      star.z -= vz * star.s;
      if (star.z <= 0.04) {
        star.z += 0.96;
        const a = Math.random() * Math.PI * 2;
        const r = 0.06 + Math.random() * 0.98;
        star.x = Math.cos(a) * r; star.y = Math.sin(a) * r * 0.62;
      }
      const z = Math.max(0.04, star.z);
      const sx = cx + (star.x / z) * focal;
      const sy = cy + (star.y / z) * focal;
      const trail = 0.01 + warp * (0.08 + star.s * 0.16);
      const z2 = Math.min(1.2, z + trail);
      const px = cx + (star.x / z2) * focal;
      const py = cy + (star.y / z2) * focal;
      const near = 1 - z;
      const a = (0.22 + near * 0.78) * (0.4 + warp * 0.6);
      const col = star.hue > 0.72 ? "180, 230, 255" : "232, 240, 255";
      if (warp > 0.04) {
        const g = ctx.createLinearGradient(px, py, sx, sy);
        g.addColorStop(0, `rgba(${col}, 0)`);
        g.addColorStop(1, `rgba(${col}, ${a})`);
        ctx.strokeStyle = g;
        ctx.lineWidth = 0.55 + star.s * (0.45 + warp * 1.85) * (0.35 + near);
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(sx, sy); ctx.stroke();
      } else {
        ctx.fillStyle = `rgba(${col}, ${0.28 + near * 0.7})`;
        ctx.beginPath(); ctx.arc(sx, sy, 0.45 + star.s * 1.05 * (0.35 + near), 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
    if (flash > 0.02) {
      ctx.fillStyle = `rgba(236, 246, 255, ${0.55 * flash})`;
      ctx.fillRect(0, 0, w, h);
    }
    if (!reduced) frame = requestAnimationFrame(tick);
  };
  const stop = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  };
  const restart = () => {
    stop();
    if (!active) return;
    last = performance.now();
    if (motionPreference.matches) tick(last);
    else frame = requestAnimationFrame(tick);
  };
  return {
    setActive(next) {
      if (active === next) return;
      active = next;
      if (active) {
        motionPreference.addEventListener("change", restart);
        restart();
      } else {
        motionPreference.removeEventListener("change", restart);
        stop();
      }
    },
  };
}

function smooth(t) { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); }

$("crawl-body").textContent = CRAWL_BODY;
let jumpT0 = 0;
const starfields = {
  crawl: seedStars($("crawl-sky"), () => ({ warp: 0, flash: 0 })),
  welcome: seedStars($("welcome-sky"), () => ({ warp: 0, flash: 0 })),
  jump: seedStars($("jump-sky"), (now) => {
    if (!jumpT0) jumpT0 = now;
    const u = Math.min(1, (now - jumpT0) / 3400);
    const warp = u < 0.16 ? smooth(u / 0.16) : u < 0.55 ? 1 : u < 0.88 ? 1 - smooth((u - 0.55) / 0.33) : 0;
    const d = Math.abs(u - 0.8) / 0.07;
    return { warp, flash: Math.max(0, 1 - d * d) };
  }),
};
showPhase(state.phase);

$("skip-crawl").addEventListener("click", () => post("phase", { phase: "welcome" }));
$("skip-jump").addEventListener("click", () => post("phase", { phase: "map" }));
$("store-grid").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-root]");
  if (btn) openRoot(btn.getAttribute("data-root"));
});
$("open-path").addEventListener("submit", (e) => {
  e.preventDefault();
  const root = $("path-input").value.trim();
  if (root) openRoot(root);
});
$("chat-toggle").addEventListener("click", () => {
  if (chatOpen) {
    closeChat();
    return;
  }
  chatOpen = !chatOpen;
  renderChat();
  if (chatOpen) $("chat-input")?.focus({ preventScroll: true });
});
function closeChat() {
  chatOpen = false;
  chatFullscreen = false;
  renderChat();
  $("chat-toggle")?.focus();
}
$("chat-fullscreen").addEventListener("click", () => {
  chatFullscreen = !chatFullscreen;
  renderChat();
});
$("graph-chat").addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    if (chatFullscreen) {
      chatFullscreen = false;
      renderChat();
      $("chat-fullscreen").focus();
    } else closeChat();
  }
});
function resizeChatInput() {
  const input = $("chat-input");
  $("chat-send").disabled = !input.value.trim();
  if (!chatOpen) return;
  const scrollTop = input.scrollTop;
  input.style.height = "auto";
  input.style.height = `${input.scrollHeight}px`;
  const caretAtEnd = document.activeElement === input
    && input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
  input.scrollTop = caretAtEnd ? input.scrollHeight : scrollTop;
}
$("chat-input").addEventListener("input", resizeChatInput);
let chatInputWidth = null;
const chatInputResize = new ResizeObserver(([entry]) => {
  // Height changes are our own; only remeasure when wrapping width changes.
  if (entry.contentRect.width === chatInputWidth) return;
  chatInputWidth = entry.contentRect.width;
  resizeChatInput();
});
chatInputResize.observe($("chat-input"));
window.addEventListener("pagehide", () => chatInputResize.disconnect());
window.addEventListener("pageshow", () => chatInputResize.observe($("chat-input")));
function sendChat() {
  const input = $("chat-input");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  chatOpen = true;
  resizeChatInput();
  input.focus();
  post("chat", { text }).then((next) => {
    if (next) applyState(next);
  });
}
$("chat-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
    e.preventDefault();
    sendChat();
  }
});
$("chat-form").addEventListener("submit", (e) => {
  e.preventDefault();
  sendChat();
});
$("toggle-panel").addEventListener("click", () => $("panel").classList.toggle("hidden"));
$("add-atlas")?.addEventListener("click", () => {
  renderAtlasAdd();
  $("atlas-add")?.classList.remove("hidden");
  $("panel")?.classList.add("hidden");
});
$("atlas-add-close")?.addEventListener("click", () => $("atlas-add")?.classList.add("hidden"));
$("atlas-add-grid")?.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-root]");
  if (!btn) return;
  post("add", { root: btn.getAttribute("data-root") });
  $("atlas-add")?.classList.add("hidden");
});
document.addEventListener("click", (e) => handleContentClick(e, navigateWiki,
  (href, target, features) => window.open(href, target, features)));
async function closePreview() {
  try {
    if (previewFromBrowser) {
      applyState(await post("preview", { open: false }));
      previewFromBrowser = false;
      nodeBrowser.focusSelection();
    } else {
      await post("select", { nodeId: "" });
    }
  } catch (error) {
    $("preview-link-error").textContent = error.message;
    $("preview-link-error").classList.remove("hidden");
  }
}
$("preview-close").addEventListener("click", closePreview);
$("preview-backdrop").addEventListener("click", closePreview);
$("preview").addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.preventDefault();
    closePreview();
  }
});
$("panel").addEventListener("click", (e) => {
  const groupBtn = e.target.closest("[data-grouping]");
  if (groupBtn) {
    e.preventDefault();
    applyGrouping(groupBtn.getAttribute("data-grouping"));
    return;
  }
  const layerBtn = e.target.closest("[data-layer]");
  if (layerBtn) {
    e.preventDefault();
    layerControls.click(layerBtn.getAttribute("data-layer"));
  }
});

function renderChat() {
  const log = $("chat-log");
  const drawer = $("graph-chat");
  const mapEl = $("phase-map");
  const toggle = $("chat-toggle");
  if (!log || !drawer) return;
  const wasOpen = drawer.classList.contains("chat-open");
  drawer.inert = !chatOpen;
  drawer.setAttribute("aria-hidden", chatOpen ? "false" : "true");
  drawer.classList.toggle("chat-open", chatOpen);
  mapEl?.classList.toggle("chat-open", chatOpen);
  const fullscreen = chatOpen && chatFullscreen;
  drawer.classList.toggle("chat-fullscreen", fullscreen);
  mapEl?.classList.toggle("chat-fullscreen", fullscreen);
  for (const child of mapEl?.children ?? []) {
    if (child === drawer || child === toggle) continue;
    if (fullscreen) {
      if (!chatBackgroundInert.has(child)) chatBackgroundInert.set(child, child.inert);
      child.inert = true;
    } else if (chatBackgroundInert.has(child)) {
      child.inert = chatBackgroundInert.get(child);
      chatBackgroundInert.delete(child);
    }
  }
  const fullscreenButton = $("chat-fullscreen");
  fullscreenButton.setAttribute("aria-pressed", String(fullscreen));
  fullscreenButton.setAttribute("aria-label", fullscreen ? "Restore chat drawer" : "Full screen chat");
  fullscreenButton.setAttribute("title", fullscreen ? "Restore chat drawer" : "Full screen chat");
  if (chatOpen && !wasOpen) resizeChatInput();
  toggle?.setAttribute("aria-pressed", chatOpen ? "true" : "false");
  toggle?.setAttribute("aria-expanded", chatOpen ? "true" : "false");
  const sessionChat = state.chatMode === "session";
  const kicker = $("chat-kicker");
  const label = sessionChat ? "Chat with Copilot" : "Local Atlas search";
  if (kicker) kicker.textContent = label;
  toggle?.setAttribute("aria-label", chatOpen ? "Collapse chat" : label);
  toggle?.setAttribute("title", chatOpen ? "Collapse chat" : label);
  const input = $("chat-input");
  input?.setAttribute("placeholder", sessionChat ? "Ask Copilot…" : "Search this Atlas…");
  input?.setAttribute("aria-label", sessionChat ? "Ask Copilot" : "Search this Atlas");
  const msgs = state.chat || [];
  const signature = JSON.stringify([sessionChat, msgs.map(({ role, pending, status, progress, text, hits }) =>
    ({ role, pending, status, progress, text, hits }))]);
  if (signature === chatRenderSignature) return;
  chatRenderSignature = signature;
  const isPending = (m) => m.role === "graph" && (m.pending === true || m.status === "queued" || m.status === "working");
  const pendingMessages = msgs.filter(isPending);
  const workingMessages = pendingMessages.filter((m) => m.status === "working");
  const progressText = (m) => typeof m.progress === "string" && m.progress.trim() ? m.progress : "Working…";
  log.setAttribute("aria-busy", String(pendingMessages.length > 0));
  const announcement = $("chat-status");
  const pendingText = workingMessages.length ? progressText(workingMessages.at(-1))
    : pendingMessages.length ? sessionChat ? "Waiting for Copilot…" : "Waiting for search…" : "";
  if (announcement && announcement.textContent !== pendingText) announcement.textContent = pendingText;
  log.innerHTML = msgs
    .map((m) => {
      const who = m.role === "user" ? "You" : sessionChat ? "Copilot" : "Search";
      const isGraph = m.role === "graph";
      const pending = isPending(m);
      const working = pending && m.status === "working";
      const statusText = working ? progressText(m) : sessionChat ? "Waiting for Copilot…" : "Waiting for search…";
      const fallback = { failed: "The request failed.", expired: "The request expired.", cancelled: "The request was cancelled." };
      const body = pending
        ? `<span class="chat-pending${working ? " working" : ""}"><span>${escapeHtml(statusText)}</span><span class="chat-dots" aria-hidden="true"><span>•</span><span>•</span><span>•</span></span></span>`
        : isGraph ? renderMarkdown(m.text || fallback[m.status] || "") : escapeHtml(m.text || "");
      const hits = (pending ? [] : m.hits || [])
        .map(
          (h) =>
            `<button type="button" class="hit" data-node="${escapeHtml(h.id)}">${escapeHtml(h.title)} · ${escapeHtml(h.kind)}</button>`,
        )
        .join("");
      const bubbleClass = isGraph && !pending ? "bubble wiki-md" : "bubble";
      return `<div class="chat-msg ${escapeHtml(m.role)}"><span class="who">${who}</span><div class="${bubbleClass}">${body}${hits}</div></div>`;
    })
    .join("");
  log.querySelectorAll("[data-node]").forEach((btn) => {
    btn.addEventListener("click", () => post("select", { nodeId: btn.getAttribute("data-node") }));
  });
  log.scrollTop = log.scrollHeight;
}

function applyGrouping(mode) {
  const grouping = mode === "proximity" ? "proximity" : mode === "atlases" ? "atlases" : "layers";
  state.grouping = grouping;
  if (map && state.graph) {
    const vis = visibleGraph();
    map.setGraph(vis.nodes, vis.edges, grouping, state.graphChanges, lifecycleVisibility(), lifecycleEdgeVisibility());
  }
  renderMapChrome();
  post("grouping", { grouping });
}

setTimeout(() => {
  if (state.phase === "crawl") post("phase", { phase: "welcome" });
}, motionPreference.matches ? 0 : 22000);

let jumpTimer = null;
function armJump() {
  clearTimeout(jumpTimer);
  jumpT0 = 0;
  jumpTimer = setTimeout(() => {
    if (state.phase === "jump") post("phase", { phase: "map" });
  }, motionPreference.matches ? 0 : 3400);
}

const es = new EventSource("/events");
es.addEventListener("activity", (event) => {
  applyActivity(JSON.parse(event.data));
});
es.onopen = () => { activityControls.setConnected(true); graphWatchControls.setConnected(true); };
es.onerror = () => { activityControls.setConnected(false); graphWatchControls.setConnected(false); };
es.onmessage = (e) => {
  const next = JSON.parse(e.data);
  const was = state.phase;
  if (applyState(next) && next.phase === "jump" && was !== "jump") armJump();
};

fetch("/api/bootstrap", { headers: { "X-Cartograph-Client": "canvas" } })
  .then(async (response) => {
    const boot = await response.json();
    if (!response.ok) throw new Error(boot.error || `Bootstrap failed (${response.status})`);
    return boot;
  })
  .then((boot) => {
    const next = boot.state || boot;
    const was = state.phase;
    if (applyState(next) && next.phase === "jump" && was !== "jump") armJump();
  })
  .catch((err) => {
    state.error = String(err);
    if (latestStateRevision === null) state.phase = "welcome";
    showPhase(state.phase);
    renderStateError();
  });
