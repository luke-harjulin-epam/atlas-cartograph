import { layoutUniverse } from "./universe.js";

const KIND_CORE = {
  experience: "#d4e4ff",
  decision: "#8ec8c0",
  work: "#e8f2ff",
  lesson: "#b8d4c8",
  recipe: "#c4d4e8",
  index: "#f0f4fa",
  page: "#7d8eaa",
  knowledge: "#d4e4ff",
  raw: "#7d8eaa",
  module: "#8ec8c0",
};
const KIND_GLOW = {
  experience: "rgba(130, 180, 255, 0.5)",
  decision: "rgba(80, 200, 190, 0.45)",
  work: "rgba(170, 210, 255, 0.55)",
  lesson: "rgba(120, 190, 160, 0.4)",
  recipe: "rgba(140, 170, 210, 0.42)",
  index: "rgba(170, 210, 255, 0.55)",
  page: "rgba(110, 140, 190, 0.28)",
  knowledge: "rgba(130, 180, 255, 0.5)",
  raw: "rgba(110, 140, 190, 0.28)",
  module: "rgba(80, 200, 190, 0.42)",
};

const MIN_K = 0.22;
const MAX_K = 20;

function hashedRand(seed) {
  let h = 2166136261 ^ seed;
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
}

const BG_STARS = Array.from({ length: 820 }, (_, i) => {
  const rand = hashedRand(i * 2654435761);
  return { lon: rand() * Math.PI * 2, lat: Math.acos(2 * rand() - 1), mag: 0.18 + rand() * 0.95, tw: rand() * Math.PI * 2 };
});

const DUST = Array.from({ length: 640 }, (_, i) => {
  const rand = hashedRand((i + 17) * 2246822507);
  return { x: rand(), y: rand(), z: rand(), tw: rand() * Math.PI * 2 };
});

function homeCam() {
  return { x: 0, y: 0, k: 1, targetK: null, yaw: 0.55, pitch: 0.72, vYaw: 0, vPitch: 0, pivot: { x: 0, y: 0, z: 0 } };
}
function globeR(s) { return Math.min(s.w, s.h) * 0.54; }
function starRadius(degree, kind) {
  const byLinks = 0.7 + Math.log1p(Math.max(0, degree)) * 1.45;
  const kindPad = kind === "raw" || kind === "page" ? 0 : kind === "index" || kind === "work" ? 0.6 : 0.25;
  return Math.min(8.5, byLinks + kindPad);
}
function nodeWorld(n, R) {
  const r = R * n.shell;
  return { x: r * Math.sin(n.lat) * Math.cos(n.lon), y: r * Math.cos(n.lat), z: r * Math.sin(n.lat) * Math.sin(n.lon) };
}
function applyZoom(s, nextK, sx, sy) {
  s.cam.targetK = null;
  const prev = s.cam.k || 1;
  const k = Math.min(MAX_K, Math.max(MIN_K, nextK));
  const worldX = (sx - s.w / 2 - s.cam.x) / prev;
  const worldY = (sy - s.h / 2 - s.cam.y) / prev;
  s.cam.k = k;
  s.cam.x = sx - s.w / 2 - worldX * k;
  s.cam.y = sy - s.h / 2 - worldY * k;
}
function projectGlobe(s) {
  const R = globeR(s);
  const focal = R * 2.15;
  const cyaw = Math.cos(s.cam.yaw);
  const syaw = Math.sin(s.cam.yaw);
  const cp = Math.cos(s.cam.pitch);
  const sp = Math.sin(s.cam.pitch);
  const { pivot, x: panX, y: panY, k } = s.cam;
  for (const n of s.sim) {
    const w = nodeWorld(n, R);
    const x0 = w.x - pivot.x;
    const y0 = w.y - pivot.y;
    const z0 = w.z - pivot.z;
    const x1 = x0 * cyaw - z0 * syaw;
    const z1 = x0 * syaw + z0 * cyaw;
    const y2 = y0 * cp - z1 * sp;
    const z2 = y0 * sp + z1 * cp;
    const scale = focal / (focal + z2);
    n.wx = x1; n.wy = y2; n.wz = z2;
    n.sx = s.w / 2 + panX + x1 * scale * k;
    n.sy = s.h / 2 + panY + y2 * scale * k;
    n.depth = focal + z2 > 0 ? scale : 0.15;
  }
}
function neighborhood(id, edges) {
  const set = new Set();
  if (!id) return set;
  set.add(id);
  for (const e of edges) {
    if (e.source === id) set.add(e.target);
    else if (e.target === id) set.add(e.source);
  }
  return set;
}
function rotatePoint(x0, y0, z0, yaw, pitch) {
  const cyaw = Math.cos(yaw); const syaw = Math.sin(yaw);
  const cp = Math.cos(pitch); const sp = Math.sin(pitch);
  const x1 = x0 * cyaw - z0 * syaw;
  const z1 = x0 * syaw + z0 * cyaw;
  return { x: x1, y: y0 * cp - z1 * sp, z: y0 * sp + z1 * cp };
}
function drawStarfield(ctx, s) {
  const { w, h, cam, t } = s;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const d of DUST) {
    const twinkle = 0.4 + 0.6 * Math.sin(t * (0.45 + d.z) + d.tw);
    const a = (0.1 + d.z * 0.65) * twinkle;
    const r = d.z < 0.5 ? 0.7 : d.z < 0.82 ? 1.15 : 1.7;
    ctx.fillStyle = `rgba(214, 232, 255, ${a})`;
    ctx.fillRect(d.x * w, d.y * h, r, r);
  }
  const cx = w / 2 + cam.x * 0.08;
  const cy = h / 2 + cam.y * 0.08;
  const far = Math.max(w, h) * 0.95;
  const cyaw = Math.cos(cam.yaw * 0.35); const syaw = Math.sin(cam.yaw * 0.35);
  const cp = Math.cos(cam.pitch * 0.35); const sp = Math.sin(cam.pitch * 0.35);
  for (const star of BG_STARS) {
    const r = far;
    const x0 = r * Math.sin(star.lat) * Math.cos(star.lon);
    const y0 = r * Math.cos(star.lat);
    const z0 = r * Math.sin(star.lat) * Math.sin(star.lon);
    const x1 = x0 * cyaw - z0 * syaw;
    const z1 = x0 * syaw + z0 * cyaw;
    const y2 = y0 * cp - z1 * sp;
    const z2 = y0 * sp + z1 * cp;
    if (z2 > far * 0.42) continue;
    const twinkle = 0.5 + 0.5 * Math.sin(t * 1.4 + star.tw);
    const size = 0.55 + star.mag * 1.55;
    ctx.fillStyle = `rgba(200, 228, 255, ${(0.22 + star.mag * 0.62) * twinkle})`;
    ctx.beginPath();
    ctx.arc(cx + x1 * 0.7, cy + y2 * 0.7, size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
function drawClusters(ctx, s) {
  const groups = new Map();
  for (const n of s.sim) {
    if (n.depth < 0.45) continue;
    const gid = n.galaxy || "cloud";
    if (!groups.has(gid)) groups.set(gid, []);
    groups.get(gid).push(n);
  }
  ctx.save();
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    let sx = 0;
    let sy = 0;
    let depth = 0;
    for (const n of members) {
      sx += n.sx;
      sy += n.sy;
      depth += n.depth;
    }
    sx /= members.length;
    sy /= members.length;
    depth /= members.length;
    let spread = 0;
    for (const n of members) spread = Math.max(spread, Math.hypot(n.sx - sx, n.sy - sy));
    const r = Math.max(28, spread + 18);
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(150, 200, 255, ${0.12 * depth})`;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 6]);
    ctx.stroke();
    ctx.setLineDash([]);
    const label = members[0].galaxyLabel || members[0].galaxy;
    if (!label || depth < 0.55) continue;
    ctx.font = '500 11px "IBM Plex Sans", "Segoe UI", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillStyle = `rgba(200, 220, 245, ${0.55 + depth * 0.3})`;
    ctx.fillText(label.length > 28 ? `${label.slice(0, 26)}…` : label, sx, sy - r - 4);
  }
  ctx.restore();
}

function drawUniverse(ctx, s, cx, cy, R) {
  const { cam, t } = s;
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.22);
  core.addColorStop(0, "rgba(180, 220, 255, 0.22)");
  core.addColorStop(0.4, "rgba(80, 140, 220, 0.07)");
  core.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = core;
  ctx.beginPath(); ctx.arc(cx, cy, R * 0.22, 0, Math.PI * 2); ctx.fill();
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 3; i++) {
    const phase = (t * 0.12 + i / 3) % 1;
    ctx.beginPath();
    ctx.arc(cx, cy, R * (0.12 + phase * 0.95), 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(140, 190, 255, ${0.16 * (1 - phase)})`;
    ctx.lineWidth = (1.2 - phase) / Math.max(cam.k, 0.5);
    ctx.stroke();
  }
  ctx.beginPath();
  for (let i = 0; i <= 72; i++) {
    const lon = (i / 72) * Math.PI * 2;
    const r = R * 0.5;
    const p = rotatePoint(r * Math.cos(lon), 0, r * Math.sin(lon), cam.yaw, cam.pitch);
    if (i === 0) ctx.moveTo(cx + p.x, cy + p.y);
    else ctx.lineTo(cx + p.x, cy + p.y);
  }
  ctx.strokeStyle = "rgba(140, 190, 255, 0.12)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}
function drawRay(ctx, a, b, kind, hi, faded, k) {
  const depth = (a.depth + b.depth) / 2;
  if (depth < 0.48 && !hi) return;
  ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy);
  const alpha = faded ? 0.03 : hi ? 0.72 * Math.max(0.45, depth) : kind === "source" ? 0.1 * depth : kind === "relates" || kind === "mesh" ? 0.22 * depth : 0.16 * depth;
  ctx.strokeStyle = hi ? "rgba(210, 235, 255, 0.95)" : `rgba(150, 200, 255, ${alpha})`;
  ctx.lineWidth = (hi ? 2.4 : 1) / Math.max(k, 0.6);
  ctx.stroke();
}
function drawStar(ctx, n, sel, hov, faded, related, k, t) {
  const age = Math.max(0, t - n.born);
  const pop = 1 - Math.exp(-age * 2.4);
  const flash = Math.exp(-age * 2.1);
  const pulse = 1 + Math.sin(t * 2.2 + n.lon) * (sel ? 0.08 : related ? 0.05 : 0.03);
  const pr = Math.max(0.55, n.r * n.depth * pulse * (0.2 + 0.8 * pop));
  const glowR = pr * (sel ? 3.6 : related || hov ? 2.6 : 2.0) + flash * 16;
  ctx.save();
  ctx.globalAlpha = faded ? 0.12 : (0.2 + n.depth * 0.75) * Math.min(1, 0.25 + pop);
  ctx.globalCompositeOperation = "lighter";
  if (!faded && n.depth > 0.45) {
    const halo = ctx.createRadialGradient(n.sx, n.sy, 0, n.sx, n.sy, glowR);
    halo.addColorStop(0, sel || related ? "rgba(210, 235, 255, 0.7)" : KIND_GLOW[n.kind] ?? KIND_GLOW.page);
    halo.addColorStop(0.45, `rgba(120, 180, 255, ${0.08 + flash * 0.25})`);
    halo.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(n.sx, n.sy, glowR, 0, Math.PI * 2); ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(n.sx, n.sy, pr * (sel ? 1.25 : related ? 1.12 : 1), 0, Math.PI * 2);
  ctx.fillStyle = faded ? "rgba(90,110,140,0.18)" : sel ? "#f4fbff" : KIND_CORE[n.kind] ?? KIND_CORE.page;
  ctx.fill();
  ctx.restore();
}
function draw2d(ctx, s) {
  const { w, h, t, cam } = s;
  ctx.clearRect(0, 0, w, h);
  const bg = ctx.createRadialGradient(w * 0.5, h * 0.48, 8, w * 0.5, h * 0.5, Math.max(w, h) * 0.75);
  bg.addColorStop(0, "#122033"); bg.addColorStop(0.22, "#0a121c"); bg.addColorStop(0.6, "#05080e"); bg.addColorStop(1, "#020308");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  drawStarfield(ctx, s);
  const R = Math.min(w, h) * 0.54;
  const focus = (s.selectedId ? s.sim.find((n) => n.id === s.selectedId) : undefined) ?? s.sim.reduce((b, n) => (!b || n.mass > b.mass ? n : b), null);
  drawUniverse(ctx, s, focus?.sx ?? w / 2 + cam.x, focus?.sy ?? h / 2 + cam.y, R * cam.k);
  drawClusters(ctx, s);
  const q = s.query.trim().toLowerCase();
  const match = (n) => !q || n.title.toLowerCase().includes(q) || n.id.toLowerCase().includes(q);
  const lookup = new Map(s.sim.map((n) => [n.id, n]));
  const focusSet = neighborhood(s.selectedId, s.edges);
  const locked = Boolean(s.selectedId);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const e of s.edges) {
    const a = lookup.get(e.source); const b = lookup.get(e.target);
    if (!a || !b) continue;
    const hi = locked && (e.source === s.selectedId || e.target === s.selectedId);
    drawRay(ctx, a, b, e.kind, hi, Boolean(q && (!match(a) || !match(b))) || (locked && !hi), cam.k);
  }
  ctx.restore();
  const ordered = [...s.sim].sort((a, b) => b.wz - a.wz);
  for (const n of ordered) {
    const related = focusSet.has(n.id);
    drawStar(ctx, n, n.id === s.selectedId, n.id === s.hover, Boolean(q && !match(n)) || (locked && !related), related && n.id !== s.selectedId, cam.k, t);
  }
  for (const n of ordered) {
    if (n.depth < 0.62) continue;
    const faded = Boolean(q && !match(n));
    const sel = n.id === s.selectedId;
    const hov = n.id === s.hover;
    const related = focusSet.has(n.id);
    if (locked && !related && !hov) continue;
    const show = n.kind !== "raw" && n.kind !== "page" ? true : sel || hov || related;
    if (!show || (faded && !sel && !hov && !related)) continue;
    ctx.font = `${sel ? 600 : 450} 12px "Cormorant Garamond", "Newsreader", serif`;
    ctx.fillStyle = faded ? "rgba(140,170,200,0.28)" : sel ? "rgba(230, 245, 255, 0.95)" : related ? "rgba(200, 230, 255, 0.85)" : `rgba(190,220,255,${0.4 + n.depth * 0.5})`;
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    const label = n.title.length > 26 ? `${n.title.slice(0, 24)}…` : n.title;
    ctx.fillText(label, n.sx, n.sy + Math.max(2, n.r * n.depth) + 6);
  }
}

export function mountGraphCanvas(wrap, options) {
  const canvas = document.createElement("canvas");
  canvas.style.position = "absolute";
  canvas.style.inset = "0";
  wrap.insertBefore(canvas, wrap.firstChild);
  const ctx = canvas.getContext("2d");

  const s = {
    sim: [], edges: [], selectedId: null, query: "",
    cam: homeCam(), spin: null, hover: null, w: 800, h: 600, t: 0,
    reduce: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    pointers: new Map(), pinch: null,
  };

  const zoomEl = wrap.querySelector("[data-zoom]");
  const syncZoom = () => { if (zoomEl) zoomEl.textContent = `${Math.round(s.cam.k * 100)}%`; };

  function setGraph(nodes, edges) {
    const byId = new Map(s.sim.map((n) => [n.id, n]));
    const laid = layoutUniverse(nodes, edges);
    s.sim = laid.map((n) => {
      const prev = byId.get(n.id);
      return {
        ...n, shell: prev?.shell ?? n.targetShell ?? 0.55, born: prev?.born ?? s.t,
        wx: prev?.wx ?? 0, wy: prev?.wy ?? 0, wz: prev?.wz ?? 0,
        sx: prev?.sx ?? s.w / 2, sy: prev?.sy ?? s.h / 2, depth: prev?.depth ?? 1,
        r: starRadius(n.degree, n.kind),
      };
    });
    s.edges = edges;
    if (!s.selectedId && s.sim.length) {
      const R = globeR(s);
      let x = 0;
      let y = 0;
      let z = 0;
      for (const n of s.sim) {
        const w = nodeWorld({ ...n, shell: n.targetShell || n.shell }, R);
        x += w.x;
        y += w.y;
        z += w.z;
      }
      const n = s.sim.length;
      s.cam.pivot = { x: x / n, y: y / n, z: z / n };
      s.cam.yaw = Math.atan2(z / n, x / n);
      s.cam.pitch = Math.atan2(y / n, Math.hypot(x / n, z / n));
    }
  }

  function resize() {
    const rect = wrap.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    s.w = Math.max(2, rect.width || wrap.clientWidth || 640);
    s.h = Math.max(2, rect.height || wrap.clientHeight || 720);
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    canvas.style.width = `${rect.width}px`; canvas.style.height = `${rect.height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  let raf = 0;
  let last = performance.now();
  const tick = (now) => {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    s.t += s.reduce ? 0 : dt;
    for (const n of s.sim) {
      const age = Math.max(0, s.t - n.born);
      const speed = s.reduce ? 20 : 0.42 + n.mass * 0.35;
      n.shell += (n.targetShell * (1 - Math.exp(-age * speed)) - n.shell) * Math.min(1, dt * 3.2);
    }
    const R = globeR(s);
    const focus = s.selectedId ? s.sim.find((n) => n.id === s.selectedId) : undefined;
    const ease = s.reduce ? 1 : 1 - Math.exp(-dt * 2.6);
    const dest = focus
      ? nodeWorld(focus, R)
      : s.sim.reduce(
          (acc, n) => {
            const w = nodeWorld(n, R);
            acc.x += w.x;
            acc.y += w.y;
            acc.z += w.z;
            acc.n += 1;
            return acc;
          },
          { x: 0, y: 0, z: 0, n: 0 },
        );
    if (dest.n) {
      dest.x /= dest.n;
      dest.y /= dest.n;
      dest.z /= dest.n;
    }
    s.cam.pivot.x += (dest.x - s.cam.pivot.x) * ease;
    s.cam.pivot.y += (dest.y - s.cam.pivot.y) * ease;
    s.cam.pivot.z += (dest.z - s.cam.pivot.z) * ease;
    s.cam.x += (0 - s.cam.x) * ease;
    s.cam.y += (0 - s.cam.y) * ease;
    if (s.cam.targetK != null) {
      s.cam.k += (s.cam.targetK - s.cam.k) * ease;
      if (Math.abs(s.cam.k - s.cam.targetK) < 0.012) { s.cam.k = s.cam.targetK; s.cam.targetK = null; }
      syncZoom();
    }
    if (!s.spin) {
      if (!s.reduce && !s.selectedId) s.cam.yaw += 0.16 * dt;
      s.cam.yaw += s.cam.vYaw; s.cam.pitch += s.cam.vPitch;
      s.cam.vYaw *= 0.92; s.cam.vPitch *= 0.92;
    }
    s.cam.pitch = Math.max(-1.2, Math.min(1.2, s.cam.pitch));
    projectGlobe(s);
    draw2d(ctx, s);
    raf = requestAnimationFrame(tick);
  };

  const hit = (lx, ly) => {
    let best = null; let bestD = Infinity;
    for (const n of s.sim) {
      if (n.depth < 0.62) continue;
      const d2 = (lx - n.sx) ** 2 + (ly - n.sy) ** 2;
      const rad = Math.max(8, n.r * n.depth + 5);
      if (d2 <= rad * rad && d2 < bestD) { best = n; bestD = d2; }
    }
    return best;
  };
  const toLocal = (cx, cy) => {
    const rect = wrap.getBoundingClientRect();
    return { x: cx - rect.left, y: cy - rect.top };
  };

  const onDown = (ev) => {
    if (ev.target.closest("button")) return;
    if (ev.button > 2) return;
    ev.preventDefault();
    const p = toLocal(ev.clientX, ev.clientY);
    s.pointers.set(ev.pointerId, p);
    const n = hit(p.x, p.y);
    s.cam.vYaw = 0; s.cam.vPitch = 0;
    s.spin = { pointerId: ev.pointerId, x: ev.clientX, y: ev.clientY, yaw: s.cam.yaw, pitch: s.cam.pitch, moved: false, hitId: n?.id ?? null };
  };
  const onMove = (ev) => {
    const p = toLocal(ev.clientX, ev.clientY);
    if (s.pointers.has(ev.pointerId)) s.pointers.set(ev.pointerId, p);
    const g = s.spin;
    if (g && g.pointerId === ev.pointerId) {
      const dx = ev.clientX - g.x; const dy = ev.clientY - g.y;
      if (!g.moved && Math.hypot(dx, dy) > 6) g.moved = true;
      if (g.moved) {
        s.cam.yaw = g.yaw + dx * 0.014;
        s.cam.pitch = Math.max(-1.2, Math.min(1.2, g.pitch + dy * 0.01));
        s.cam.vYaw = (ev.movementX || 0) * 0.008;
        s.cam.vPitch = (ev.movementY || 0) * 0.006;
        wrap.style.cursor = "grabbing";
      }
      return;
    }
    const n = hit(p.x, p.y);
    s.hover = n?.id ?? null;
    wrap.style.cursor = n ? "pointer" : "grab";
  };
  const onUp = (ev) => {
    s.pointers.delete(ev.pointerId);
    const g = s.spin;
    if (g && g.pointerId === ev.pointerId) {
      if (!g.moved) options.onSelect?.(g.hitId, { pointerType: ev.pointerType });
      s.spin = null;
    }
    wrap.style.cursor = "grab";
  };
  const onWheel = (ev) => {
    ev.preventDefault();
    const p = toLocal(ev.clientX, ev.clientY);
    applyZoom(s, s.cam.k * (ev.deltaY < 0 ? 1.1 : 0.9), p.x, p.y);
    syncZoom();
  };

  wrap.addEventListener("pointerdown", onDown);
  wrap.addEventListener("pointermove", onMove);
  wrap.addEventListener("pointerup", onUp);
  wrap.addEventListener("pointercancel", onUp);
  wrap.addEventListener("wheel", onWheel, { passive: false });
  wrap.addEventListener("contextmenu", (e) => e.preventDefault());
  const ro = new ResizeObserver(resize);
  ro.observe(wrap);
  resize();
  raf = requestAnimationFrame(tick);

  wrap.querySelector("[data-zoom-in]")?.addEventListener("click", () => { applyZoom(s, s.cam.k * 1.25, s.w / 2, s.h / 2); syncZoom(); });
  wrap.querySelector("[data-zoom-out]")?.addEventListener("click", () => { applyZoom(s, s.cam.k / 1.25, s.w / 2, s.h / 2); syncZoom(); });
  wrap.querySelector("[data-zoom-reset]")?.addEventListener("click", () => { s.cam = homeCam(); syncZoom(); });

  return {
    setGraph,
    setSelected(id) {
      s.selectedId = id;
      if (id && s.cam.k < 2) s.cam.targetK = Math.min(2.4, Math.max(s.cam.k * 1.15, 1.55));
    },
    setQuery(q) { s.query = q ?? ""; },
    destroy() {
      cancelAnimationFrame(raf);
      ro.disconnect();
    },
  };
}
