import { mountGraphCanvas } from "./graph-canvas.js";
import { escapeHtml, renderMarkdown } from "./markdown.js";

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

let state = { phase: "crawl", stores: [], graph: null, root: "", query: "", selectedId: null, previewOpen: false, layers: {}, grouping: "layers", error: null, linkError: null, page: null, chat: [] };
let chatOpen = false;
let map = null;

function showPhase(name) {
  for (const [key, el] of Object.entries(phases)) {
    el.classList.toggle("hidden", key !== name);
  }
}

function post(action, payload = {}) {
  return fetch("/api/ui", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  }).then((r) => r.json());
}

const NODE_LAYER_KEYS = ["experiences", "decisions", "work", "indexes", "other"];
const NODE_LAYER_BUTTONS = ["experiences", "decisions", "work", "indexes"];

function allNodeLayersOn(layers) {
  return NODE_LAYER_BUTTONS.every((k) => layers?.[k] !== false);
}

function applyLayerClick(layers, key) {
  const next = { ...layers };
  if (key === "all") {
    for (const k of NODE_LAYER_KEYS) next[k] = true;
    return next;
  }
  if (key === "relations" || key === "sources") {
    next[key] = layers?.[key] === false;
    return next;
  }
  if (allNodeLayersOn(layers)) {
    for (const k of NODE_LAYER_BUTTONS) next[k] = k === key;
    next.other = false;
    return next;
  }
  next[key] = layers?.[key] === false;
  if (NODE_LAYER_BUTTONS.every((k) => next[k] === false)) next[key] = true;
  return next;
}

function layerFor(kind) {
  if (kind === "experience" || kind === "raw") return "experiences";
  if (kind === "decision") return "decisions";
  if (kind === "work" || kind === "module") return "work";
  if (kind === "index") return "indexes";
  return "other";
}

function visibleGraph() {
  const g = state.graph;
  if (!g) return { nodes: [], edges: [] };
  const layers = state.layers || {};
  const nodes = g.nodes.filter((n) => layers[layerFor(n.kind)] !== false);
  const ids = new Set(nodes.map((n) => n.id));
  const edges = g.edges.filter((e) => {
    if (!ids.has(e.source) || !ids.has(e.target)) return false;
    if (e.kind === "source" && layers.sources === false) return false;
    if ((e.kind === "relates" || e.kind === "mesh") && layers.relations === false) return false;
    return true;
  });
  return { nodes, edges };
}

function onPreviewClick(e) {
  const a = e.target.closest("a");
  if (a) {
    e.preventDefault();
    const href = a.getAttribute("href") || "";
    if (/^https?:\/\//i.test(href) || href.startsWith("mailto:")) {
      window.open(href, "_blank", "noopener,noreferrer");
      return;
    }
    if (href && href !== "#") navigateWiki(href);
    return;
  }
  const wiki = e.target.closest(".wikilink, [data-target]");
  if (wiki && wiki.closest("#preview")) {
    e.preventDefault();
    navigateWiki(wiki.getAttribute("data-target"));
  }
}

function renderStores() {
  const grid = $("store-grid");
  const atlas = (state.stores || []).filter((s) => s.available);
  if (!atlas.length) {
    grid.innerHTML = `<p class="muted">No Atlas stores found. Use the path field or add fixtures/mini-atlas.</p>`;
    return;
  }
  grid.innerHTML = atlas
    .map(
      (s) => `<button class="store-card" data-root="${escapeHtml(s.root)}">
        <h3>${escapeHtml(s.label)}</h3>
        <div class="subtle">${escapeHtml(s.format || "atlas")}${s.atlasId ? ` · ${escapeHtml(s.atlasId)}` : ""}</div>
        <div class="muted" style="margin-top:0.75rem">${s.pages ?? 0} pages</div>
      </button>`,
    )
    .join("");
}

function ensureMap() {
  if (map) return map;
  map = mountGraphCanvas($("graph-wrap"), {
    onSelect: (id, meta) => {
      post("select", { nodeId: id || "" });
      if (id && meta?.pointerType !== "touch") post("preview", { open: true });
    },
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
  const key = String(target || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\.md$/i, "");
  const hit = state.graph?.nodes?.find(
    (n) =>
      n.id === key ||
      n.id === target ||
      (n.aliases ?? []).includes(key) ||
      n.path === key ||
      n.path === `${key}.md` ||
      n.title.toLowerCase() === key.toLowerCase(),
  );
  return post("select", { nodeId: hit?.id || key });
}

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
  $("preview-meta").textContent = `${page?.kind || node?.kind || ""} · ${page?.path || node?.path || ""}`;
  const err = $("preview-link-error");
  if (err) {
    err.textContent = state.linkError || "";
    err.classList.toggle("hidden", !state.linkError);
  }
  const chips = [
    ...(page?.relatesTo ?? []).map((r) => ({ kind: r.kind || "relates", path: r.path })),
    ...(page?.sources ?? []).map((s) => ({ kind: "source", path: s })),
  ];
  const rel = $("preview-relates");
  rel.classList.toggle("hidden", chips.length === 0);
  rel.innerHTML = chips
    .map(
      (c) =>
        `<li><button type="button" class="kind-${escapeHtml(c.kind)}" data-target="${escapeHtml(c.path)}">${escapeHtml(c.kind)} · ${escapeHtml(chipLabel(c.path))}</button></li>`,
    )
    .join("");
  rel.querySelectorAll("button").forEach((el) => {
    el.addEventListener("click", () => navigateWiki(el.getAttribute("data-target")));
  });
  $("preview-body").innerHTML = renderMarkdown(page?.body || "_No page body._");
  $("preview-body").querySelectorAll(".wikilink").forEach((el) => {
    el.addEventListener("click", () => navigateWiki(el.getAttribute("data-target")));
  });
}

function renderMapChrome() {
  const vis = visibleGraph();
  $("stat-nodes").textContent = String(vis.nodes.length);
  $("stat-edges").textContent = String(vis.edges.length);
  $("stat-format").textContent = state.graph?.store?.format ?? "—";
  $("stat-root").textContent = state.graph?.store?.atlasId || state.root || "No atlas";
  $("search").value = state.query || "";
  const q = (state.query || "").trim().toLowerCase();
  const matches = q
    ? vis.nodes.filter((n) => n.title.toLowerCase().includes(q) || n.id.toLowerCase().includes(q)).slice(0, 8)
    : [];
  const list = $("matches");
  list.classList.toggle("hidden", matches.length === 0);
  list.innerHTML = matches
    .map((n) => `<li><button data-id="${escapeHtml(n.id)}">${escapeHtml(n.title)} <span class="subtle">${escapeHtml(n.kind)}</span></button></li>`)
    .join("");
  list.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => post("select", { nodeId: btn.getAttribute("data-id") }).then(() => post("preview", { open: true })));
  });
  document.querySelectorAll("[data-grouping]").forEach((btn) => {
    btn.classList.toggle("active", (state.grouping || "layers") === btn.getAttribute("data-grouping"));
  });
  document.querySelectorAll("[data-layer]").forEach((btn) => {
    const key = btn.getAttribute("data-layer");
    const on = key === "all" ? allNodeLayersOn(state.layers) : state.layers?.[key] !== false;
    btn.classList.toggle("active", on);
  });
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
    const idx = items.findIndex((c) => c.label === focus);
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
          `<button type="button" data-island="${escapeHtml(c.label)}" class="${focus === c.label ? "active" : ""}">${escapeHtml(c.label)} · ${c.count}</button>`,
      )
      .join("") +
    `<button type="button" data-island-shift="1" ${canNext ? "" : "disabled"}>›</button>` +
    range;
  map.setFeatured?.(slice.map((c) => c.label));
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

function applyState(next) {
  const grouping = next.grouping || state.grouping || "layers";
  state = { ...state, ...next, grouping };
  showPhase(state.phase || "welcome");
  if (state.error) {
    $("welcome-error").textContent = state.error;
    $("welcome-error").classList.toggle("hidden", !state.error || state.phase !== "welcome");
    $("map-error").textContent = state.error;
    $("map-error").classList.toggle("hidden", !state.error || state.phase !== "map");
  } else {
    $("welcome-error").classList.add("hidden");
    $("map-error").classList.add("hidden");
  }
  if (state.phase === "welcome") renderStores();
  if (state.phase === "map") {
    const m = ensureMap();
    const vis = visibleGraph();
    m.setGraph(vis.nodes, vis.edges, state.grouping || "layers");
    m.setSelected(state.selectedId);
    m.setQuery(state.query || "");
    renderMapChrome();
    renderPreview();
    renderChat();
  }
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
  const tick = (now) => {
    if (canvas.closest(".hidden")) {
      requestAnimationFrame(tick);
      return;
    }
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const { warp, flash } = warpFn(now);
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
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function smooth(t) { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); }

$("crawl-body").textContent = CRAWL_BODY;
seedStars($("crawl-sky"), () => ({ warp: 0, flash: 0 }));
seedStars($("welcome-sky"), () => ({ warp: 0, flash: 0 }));
let jumpT0 = 0;
seedStars($("jump-sky"), (now) => {
  if (!jumpT0) jumpT0 = now;
  const u = Math.min(1, (now - jumpT0) / 3400);
  const warp = u < 0.16 ? smooth(u / 0.16) : u < 0.55 ? 1 : u < 0.88 ? 1 - smooth((u - 0.55) / 0.33) : 0;
  const d = Math.abs(u - 0.8) / 0.07;
  return { warp, flash: Math.max(0, 1 - d * d) };
});

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
$("search").addEventListener("input", (e) => post("query", { query: e.target.value }));
$("chat-toggle").addEventListener("click", () => {
  chatOpen = !chatOpen;
  renderChat();
  if (chatOpen) $("chat-input")?.focus();
});
$("chat-close").addEventListener("click", () => {
  chatOpen = false;
  renderChat();
});
$("chat-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $("chat-input");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  chatOpen = true;
  post("chat", { text }).then((next) => {
    if (next) applyState(next);
  });
});
$("toggle-panel").addEventListener("click", () => $("panel").classList.toggle("hidden"));
$("preview").addEventListener("click", onPreviewClick);
document.addEventListener("click", (e) => {
  const a = e.target.closest("a");
  if (!a) return;
  e.preventDefault();
  const href = a.getAttribute("href") || "";
  if (/^https?:\/\//i.test(href) || href.startsWith("mailto:")) {
    window.open(href, "_blank", "noopener,noreferrer");
    return;
  }
  if (href && href !== "#") navigateWiki(href);
});
$("preview-close").addEventListener("click", () => post("select", { nodeId: "" }));
$("preview-backdrop").addEventListener("click", () => post("select", { nodeId: "" }));
$("panel").addEventListener("click", (e) => {
  const groupBtn = e.target.closest("[data-grouping]");
  if (groupBtn) {
    e.preventDefault();
    applyGrouping(groupBtn.getAttribute("data-grouping"));
    return;
  }
  const layerBtn = e.target.closest("[data-layer]");
  if (layerBtn) {
    const next = applyLayerClick(state.layers || {}, layerBtn.getAttribute("data-layer"));
    post("layers", { layers: next });
  }
});

function renderChat() {
  const log = $("chat-log");
  const drawer = $("graph-chat");
  const mapEl = $("phase-map");
  const toggle = $("chat-toggle");
  if (!log || !drawer) return;
  drawer.classList.toggle("hidden", !chatOpen);
  drawer.classList.toggle("chat-open", chatOpen);
  mapEl?.classList.toggle("chat-open", chatOpen);
  toggle?.setAttribute("aria-pressed", chatOpen ? "true" : "false");
  const msgs = state.chat || [];
  log.innerHTML = msgs
    .map((m) => {
      const who = m.role === "user" ? "You" : "Graph";
      const isGraph = m.role === "graph";
      const body = isGraph ? renderMarkdown(m.text || "") : escapeHtml(m.text || "");
      const hits = (m.hits || [])
        .map(
          (h) =>
            `<button type="button" class="hit" data-node="${escapeHtml(h.id)}">${escapeHtml(h.title)} · ${escapeHtml(h.kind)}</button>`,
        )
        .join("");
      const bubbleClass = isGraph ? "bubble wiki-md" : "bubble";
      return `<div class="chat-msg ${escapeHtml(m.role)}"><span class="who">${who}</span><div class="${bubbleClass}">${body}${hits}</div></div>`;
    })
    .join("");
  log.querySelectorAll("[data-node]").forEach((btn) => {
    btn.addEventListener("click", () => post("select", { nodeId: btn.getAttribute("data-node") }));
  });
  log.querySelectorAll(".wikilink").forEach((el) => {
    el.addEventListener("click", () => navigateWiki(el.getAttribute("data-target")));
  });
  log.scrollTop = log.scrollHeight;
}

function applyGrouping(mode) {
  const grouping = mode === "proximity" ? "proximity" : "layers";
  state.grouping = grouping;
  if (map && state.graph) {
    const vis = visibleGraph();
    map.setGraph(vis.nodes, vis.edges, grouping);
  }
  renderMapChrome();
  post("grouping", { grouping });
}

const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
setTimeout(() => {
  if (state.phase === "crawl") post("phase", { phase: "welcome" });
}, reduce ? 0 : 22000);

let jumpTimer = null;
function armJump() {
  clearTimeout(jumpTimer);
  jumpT0 = 0;
  jumpTimer = setTimeout(() => {
    if (state.phase === "jump") post("phase", { phase: "map" });
  }, reduce ? 0 : 3400);
}

const es = new EventSource("/events");
es.onmessage = (e) => {
  const next = JSON.parse(e.data);
  const was = state.phase;
  applyState(next);
  if (next.phase === "jump" && was !== "jump") armJump();
};

fetch("/api/bootstrap")
  .then((r) => r.json())
  .then((boot) => {
    applyState(boot.state || boot);
    if ((boot.state?.phase || boot.phase) === "jump") armJump();
  })
  .catch((err) => {
    applyState({ phase: "welcome", error: String(err) });
  });
