import { layoutUniverse, galaxyDetailOpacity } from "./universe.js";
import { activityNodeStyle, activityEdgeOpacity, activityPulse } from "./activity-rendering.js";
import { ActivityPlayback, PLAYBACK_STATUS_INTERVAL_MS } from "./activity-playback.js";
import { GraphLifecycle, lifecyclePoints, lifecycleNodeOpacity, lifecycleEdgeOpacity, lifecycleEdgeGlows } from "./graph-lifecycle.js";
import { ActivityCamera, activationFocusNodes, activationSurfaceAngle, angleDelta, moveCameraLook } from "./activity-camera.js";
import { createGraphGL } from "./graph-gl.js";
import { matchesNodeQuery } from "./node-search.js";

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
function projectGlobe(s, nodes = s.sim) {
  const R = globeR(s);
  const focal = R * 2.15;
  const cyaw = Math.cos(s.cam.yaw);
  const syaw = Math.sin(s.cam.yaw);
  const cp = Math.cos(s.cam.pitch);
  const sp = Math.sin(s.cam.pitch);
  const { pivot, x: panX, y: panY, k } = s.cam;
  for (const n of nodes) {
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
const clusterKey = (node) => node?.galaxyKey || node?.galaxyLabel || node?.galaxy || node?.kind;

function drawClusters(ctx, s) {
  const groups = new Map();
  for (const n of s.sim) {
    if (n.depth < 0.38) continue;
    const gid = clusterKey(n);
    if (!groups.has(gid)) groups.set(gid, []);
    groups.get(gid).push(n);
  }
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const members of groups.values()) {
    const label = members[0].galaxyLabel || members[0].galaxy;
    const key = clusterKey(members[0]);
    const featured = !s.featured || s.featured.has(key) || key === s.focusCluster;
    if (!featured) continue;
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
    const galactic = Boolean(members[0].galaxyCore);
    if (galactic) {
      const core = { ...members[0].galaxyCore };
      projectGlobe(s, [core]);
      sx = core.sx;
      sy = core.sy;
      depth = core.depth;
    }
    let spread = 0;
    for (const n of members) spread = Math.max(spread, Math.hypot(n.sx - sx, n.sy - sy));
    const r = Math.max(36, spread + 28);
    const glow = KIND_GLOW[members[0].kind] ?? KIND_GLOW.knowledge;
    const neb = ctx.createRadialGradient(sx, sy, r * 0.12, sx, sy, r);
    neb.addColorStop(0, glow.replace(/[\d.]+\)$/, `${0.28 * depth})`));
    neb.addColorStop(0.45, glow.replace(/[\d.]+\)$/, `${0.12 * depth})`));
    neb.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = neb;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
    if (galactic) {
      const coreRadius = Math.max(10, r * 0.3);
      const core = ctx.createRadialGradient(sx, sy, 0, sx, sy, coreRadius);
      core.addColorStop(0, `rgba(255, 238, 199, ${Math.min(0.55, 0.42 * depth)})`);
      core.addColorStop(0.2, `rgba(248, 198, 124, ${0.22 * depth})`);
      core.addColorStop(0.55, `rgba(156, 151, 224, ${0.09 * depth})`);
      core.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(sx, sy, coreRadius, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.strokeStyle = glow.replace(/[\d.]+\)$/, `${0.35 * depth})`);
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
    if (!label || depth < 0.42) continue;
    ctx.font = '600 12px "IBM Plex Sans", "Segoe UI", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillStyle = `rgba(230, 240, 255, ${0.7 + depth * 0.25})`;
    ctx.fillText(label, sx, sy - r - 6);
  }
  ctx.restore();
}

function beaconCenter(s) {
  let members = s.sim;
  if (s.selectedId) {
    const n = s.sim.find((x) => x.id === s.selectedId);
    if (n) return { sx: n.sx, sy: n.sy, r: Math.max(48, Math.min(180, globeR(s) * (n.galaxyRadius ?? 0.2) * n.depth * s.cam.k)) };
  } else if (s.focusCluster) {
    members = s.sim.filter((x) => clusterKey(x) === s.focusCluster);
  }
  const vis = members.filter((n) => n.depth > 0.32);
  if (vis.length) members = vis;
  if (!members.length) return { sx: s.w / 2, sy: s.h / 2, r: Math.min(s.w, s.h) * 0.2 };
  let sx = 0;
  let sy = 0;
  for (const n of members) {
    sx += n.sx;
    sy += n.sy;
  }
  sx /= members.length;
  sy /= members.length;
  let spread = 0;
  for (const n of members) spread = Math.max(spread, Math.hypot(n.sx - sx, n.sy - sy));
  return { sx, sy, r: Math.max(48, spread + 24) };
}

function beaconCenters(s) {
  if (s.selectedId || !s.sim[0]?.galaxyCore) return [beaconCenter(s)];
  const groups = new Map();
  for (const node of s.sim) {
    const key = clusterKey(node);
    if (s.focusCluster && key !== s.focusCluster) continue;
    if (s.featured && !s.featured.has(key) && key !== s.focusCluster) continue;
    if (!groups.has(key)) groups.set(key, node);
  }
  return [...groups.values()].map((node) => {
    const core = { ...node.galaxyCore };
    projectGlobe(s, [core]);
    return { sx: core.sx, sy: core.sy, r: Math.max(48, globeR(s) * node.galaxyRadius * core.depth * s.cam.k) };
  });
}

function drawUniverse(ctx, s, cx, cy, radius) {
  const { cam, t } = s;
  const coreR = radius * 0.32;
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
  core.addColorStop(0, "rgba(180, 220, 255, 0.32)");
  core.addColorStop(0.4, "rgba(80, 140, 220, 0.1)");
  core.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = core;
  ctx.beginPath(); ctx.arc(cx, cy, coreR, 0, Math.PI * 2); ctx.fill();
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 3; i++) {
    const phase = (t * 0.12 + i / 3) % 1;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * (0.18 + phase * 0.92), 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(140, 190, 255, ${0.22 * (1 - phase)})`;
    ctx.lineWidth = (1.4 - phase) / Math.max(cam.k, 0.5);
    ctx.stroke();
  }
  ctx.beginPath();
  for (let i = 0; i <= 72; i++) {
    const lon = (i / 72) * Math.PI * 2;
    const r = radius * 0.55;
    const p = rotatePoint(r * Math.cos(lon), 0, r * Math.sin(lon), cam.yaw, cam.pitch);
    if (i === 0) ctx.moveTo(cx + p.x, cy + p.y);
    else ctx.lineTo(cx + p.x, cy + p.y);
  }
  ctx.strokeStyle = "rgba(140, 190, 255, 0.16)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}
function drawRay(ctx, a, b, kind, hi, faded, k) {
  const depth = (a.depth + b.depth) / 2;
  if (depth < 0.48 && !hi) return;
  ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy);
  const alpha = faded ? 0.03 : hi ? 0.72 * Math.max(0.45, depth) : kind === "source" ? 0.1 * depth : kind === "mesh" ? 0.38 * depth : kind === "relates" ? 0.22 * depth : 0.16 * depth;
  ctx.strokeStyle = hi
    ? "rgba(210, 235, 255, 0.95)"
    : kind === "mesh"
      ? `rgba(120, 230, 210, ${alpha})`
      : `rgba(150, 200, 255, ${alpha})`;
  ctx.lineWidth = (hi ? 2.4 : kind === "mesh" ? 1.6 : 1) / Math.max(k, 0.6);
  ctx.stroke();
}
function drawStar(ctx, n, sel, hov, faded, related, k, t, activity, reduce, lifecycle) {
  const age = Math.max(0, t - n.born);
  // A completed wall-clock fade must not restart the simulation-clock entrance.
  const birth = n.lifecycleBorn || lifecycle?.births.has(n.id);
  const opacity = lifecycleNodeOpacity(lifecycle, n.id);
  const pop = reduce || birth ? 1 : 1 - Math.exp(-age * 2.4);
  const flash = reduce || birth ? 0 : Math.exp(-age * 2.1);
  const pulse = reduce ? 1 : 1 + Math.sin(t * 2.2 + n.lon) * (sel ? 0.08 : related ? 0.05 : 0.03);
  const normalAlpha = faded ? 0.12 : (0.2 + n.depth * 0.75) * Math.min(1, 0.25 + pop);
  const style = activityNodeStyle(activity, n.id, normalAlpha, Math.max(0.55, n.r * n.depth * pulse * (0.2 + 0.8 * pop)));
  const pr = style.size;
  const glowR = pr * (sel ? 3.6 : related || hov ? 2.6 : 2.0) + flash * 16;
  ctx.save();
  ctx.globalAlpha = Math.min(1, style.alpha) * opacity;
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
  if (style.strength) {
    ctx.globalAlpha = style.strength * opacity;
    const radius = Math.max(10, pr * 4);
    const halo = ctx.createRadialGradient(n.sx, n.sy, 0, n.sx, n.sy, radius);
    halo.addColorStop(0, "rgba(210,255,245,0.95)");
    halo.addColorStop(0.25, "rgba(140,235,225,0.6)");
    halo.addColorStop(1, "rgba(100,210,240,0)");
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(n.sx, n.sy, radius, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#efffff";
    ctx.beginPath(); ctx.arc(n.sx, n.sy, pr * 1.2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}
function drawActivityEdges(ctx, activity, lookup, reduce, lifecycle) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const edge of activity.edges) {
    const pulse = activityPulse(edge, lookup, reduce);
    if (!pulse) continue;
    const opacity = lifecycleEdgeOpacity(lifecycle, edge.source, edge.target, edge.id);
    ctx.globalAlpha = edge.strength * opacity;
    ctx.strokeStyle = "rgba(140,235,225,0.75)";
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(pulse.source.x, pulse.source.y); ctx.lineTo(pulse.target.x, pulse.target.y); ctx.stroke();
    ctx.strokeStyle = "#e0fff6";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const wing of pulse.wings) { ctx.moveTo(wing.x, wing.y); ctx.lineTo(pulse.head.x, pulse.head.y); }
    ctx.stroke();
    for (const point of pulse.trail) {
      ctx.globalAlpha = point.alpha * opacity;
      ctx.fillStyle = "#c0fff0";
      ctx.beginPath(); ctx.arc(point.x, point.y, point.size / 2, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}
function drawBackdrop(ctx, s) {
  const { w, h } = s;
  ctx.clearRect(0, 0, w, h);
  const bg = ctx.createRadialGradient(w * 0.5, h * 0.48, 8, w * 0.5, h * 0.5, Math.max(w, h) * 0.75);
  bg.addColorStop(0, "#122033"); bg.addColorStop(0.22, "#0a121c"); bg.addColorStop(0.6, "#05080e"); bg.addColorStop(1, "#020308");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  drawStarfield(ctx, s);
  for (const beacon of beaconCenters(s)) {
    drawUniverse(ctx, s, beacon.sx, beacon.sy, beacon.r);
  }
  drawClusters(ctx, s);
}
function draw2d(ctx, s) {
  const { t, cam } = s;
  drawBackdrop(ctx, s);
  const q = s.query.trim().toLowerCase();
  const lookup = new Map(s.sim.map((n) => [n.id, n]));
  const focusSet = neighborhood(s.selectedId, s.edges);
  const match = (n) => focusSet.has(n.id) || matchesNodeQuery(n, q);
  const locked = Boolean(s.selectedId);
  const detail = galaxyDetailOpacity(s.sim, cam.k, q, s.selectedId);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const e of s.edges) {
    const a = lookup.get(e.source); const b = lookup.get(e.target);
    if (!a || !b) continue;
    ctx.globalAlpha = detail * activityEdgeOpacity(s.activityFrame) * lifecycleEdgeOpacity(s.lifecycleFrame, e.source, e.target, e.id);
    const hi = locked && (e.source === s.selectedId || e.target === s.selectedId);
    drawRay(ctx, a, b, e.kind, hi, Boolean(q && (!match(a) || !match(b))) || (locked && !hi), cam.k);
  }
  for (const glow of lifecycleEdgeGlows(s.lifecycleFrame, lookup)) {
    ctx.globalAlpha = glow.alpha;
    ctx.strokeStyle = `rgb(${glow.rgb.map((value) => Math.round(value * 255)).join(",")})`;
    ctx.lineWidth = glow.width;
    ctx.beginPath();
    ctx.moveTo(glow.source.x, glow.source.y); ctx.lineTo(glow.target.x, glow.target.y);
    ctx.stroke();
  }
  ctx.restore();
  drawActivityEdges(ctx, s.activityFrame, lookup, s.reduce, s.lifecycleFrame);
  const ordered = [...s.sim].sort((a, b) => b.wz - a.wz);
  for (const n of ordered) {
    const related = focusSet.has(n.id);
    drawStar(ctx, n, n.id === s.selectedId, n.id === s.hover, Boolean(q && !match(n)) || (locked && !related), related && n.id !== s.selectedId, cam.k, t, s.activityFrame, s.reduce, s.lifecycleFrame);
  }
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const point of lifecyclePoints(s.lifecycleFrame, lookup)) {
    const rgb = point.rgb.map((value) => Math.round(value * 255)).join(",");
    ctx.globalAlpha = point.alpha;
    ctx.fillStyle = `rgb(${rgb})`;
    if (point.halo) {
      const halo = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, point.size / 2);
      halo.addColorStop(0, `rgba(${rgb},0.9)`);
      halo.addColorStop(0.4, `rgba(${rgb},0.35)`);
      halo.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = halo;
    }
    ctx.beginPath(); ctx.arc(point.x, point.y, point.size / 2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  drawLabels(ctx, s, ordered, focusSet);
}
function drawLabels(ctx, s, ordered = [...s.sim].sort((a, b) => b.wz - a.wz), focusSet = neighborhood(s.selectedId, s.edges)) {
  const q = s.query.trim().toLowerCase();
  const match = (n) => focusSet.has(n.id) || matchesNodeQuery(n, q);
  const locked = Boolean(s.selectedId);
  const overview = galaxyDetailOpacity(s.sim, s.cam.k, q, s.selectedId) < 1;
  for (const n of ordered) {
    if (n.depth < 0.62) continue;
    const faded = Boolean(q && !match(n));
    const sel = n.id === s.selectedId;
    const hov = n.id === s.hover;
    const related = focusSet.has(n.id);
    if (locked && !related && !hov) continue;
    const show = n.kind !== "raw" && n.kind !== "page" ? true : sel || hov || related;
    if (!show || (faded && !sel && !hov && !related)) continue;
    if (overview &&
        !sel && !hov && !related && !s.activityFrame.nodes.has(n.id) && n.mass < 0.8) continue;
    ctx.font = `${sel ? 600 : 450} 12px "Cormorant Garamond", "Newsreader", serif`;
    ctx.fillStyle = faded ? "rgba(140,170,200,0.28)" : sel ? "rgba(230, 245, 255, 0.95)" : related ? "rgba(200, 230, 255, 0.85)" : `rgba(190,220,255,${0.4 + n.depth * 0.5})`;
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    const count = s.activityFrame.nodeCounts?.get(n.id) ?? 1;
    const label = (n.title.length > 26 ? `${n.title.slice(0, 24)}…` : n.title) + (count > 1 ? ` x${count}` : "");
    ctx.globalAlpha = activityNodeStyle(s.activityFrame, n.id).dim * lifecycleNodeOpacity(s.lifecycleFrame, n.id);
    ctx.fillText(label, n.sx, n.sy + Math.max(2, n.r * n.depth) + 6);
  }
  for (const { node, style } of s.lifecycleFrame.ghosts) {
    if (node.depth < 0.62 || (q && !match(node))) continue;
    ctx.font = '450 12px "Cormorant Garamond", "Newsreader", serif';
    ctx.fillStyle = "rgba(255,160,170,0.85)";
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.globalAlpha = style.nodeOpacity;
    const label = node.title.length > 26 ? `${node.title.slice(0, 24)}…` : node.title;
    ctx.fillText(label, node.sx, node.sy + Math.max(2, node.r * node.depth) + 6);
  }
  ctx.globalAlpha = 1;
}

export function mountGraphCanvas(wrap, options) {
  const makeCanvas = () => {
    const layer = document.createElement("canvas");
    layer.style.position = "absolute";
    layer.style.inset = "0";
    layer.style.pointerEvents = "none";
    layer.setAttribute("aria-hidden", "true");
    return layer;
  };
  const canvas = makeCanvas();
  wrap.insertBefore(canvas, wrap.firstChild);
  const ctx = canvas.getContext("2d");
  const gpuCanvas = makeCanvas();
  let gpu = ctx ? createGraphGL(gpuCanvas, { transparent: true }) : null;
  let labels = null;
  let labelCtx = null;
  if (gpu) {
    labels = makeCanvas();
    try { labelCtx = labels.getContext("2d"); }
    catch { labelCtx = null; }
    if (labelCtx) {
      wrap.insertBefore(gpuCanvas, canvas.nextSibling);
      wrap.insertBefore(labels, gpuCanvas.nextSibling);
    } else {
      gpu.destroy();
      gpu = null;
      labels = null;
    }
  }
  if (!ctx) {
    canvas.remove();
    throw new Error("Cartograph requires Canvas 2D support for graph labels.");
  }
  wrap.dataset.renderer = gpu ? "webgl" : "2d";
  let rendererNotice = null;
  let destroyed = false;

  const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
  const s = {
    sim: [], edges: [], selectedId: null, query: "",
    cam: homeCam(), panTarget: { x: 0, y: 0 }, spin: null, hover: null, w: 800, h: 600, t: 0,
    reduce: motionPreference.matches,
    playback: new ActivityPlayback(), activityFrame: { nodes: new Map(), edges: [], amount: 0 },
    lifecycle: new GraphLifecycle(), lifecycleFrame: { births: new Map(), ghosts: [] },
    activityCamera: new ActivityCamera(),
    pointers: new Map(), pinch: null,
    focusCluster: null, targetPivot: null, targetLook: null, lookVelocity: { yaw: 0, pitch: 0 },
    aimed: false, grouping: "layers", featured: null,
  };
  s.activityCamera.setEnabled(options.autoFocus !== false);
  const onMotionChange = (event) => {
    if (event.matches) pauseAutoFocus();
    s.reduce = event.matches;
  };
  motionPreference.addEventListener("change", onMotionChange);

  const zoomEl = wrap.querySelector("[data-zoom]");
  const syncZoom = () => {
    const text = `${Math.round(s.cam.k * 100)}%`;
    if (zoomEl && zoomEl.textContent !== text) zoomEl.textContent = text;
  };

  let graphKey;
  let mountRevision;
  function setGraph(nodes, edges, grouping = "layers", changes, isLifecycleVisible, isLifecycleEdgeVisible) {
    if (changes?.origin === "mount" && changes.revision !== mountRevision) {
      mountRevision = changes.revision;
      s.activityCamera.clear();
    }
    s.lifecycle.setGraph(nodes, changes, s.sim, isLifecycleVisible, edges, s.edges, isLifecycleEdgeVisible);
    const nextKey = JSON.stringify([nodes, edges, grouping]);
    if (graphKey === nextKey) return;
    graphKey = nextKey;
    const groupingChanged = grouping !== s.grouping;
    if (groupingChanged && s.aimed) pauseAutoFocus();
    s.grouping = grouping;
    const byId = new Map(s.sim.map((n) => [n.id, n]));
    const lifecycleBorn = new Set([...s.lifecycle.births.values()].map((entry) => entry.node.id));
    const laid = layoutUniverse(nodes, edges, grouping);
    s.sim = laid.map((n) => {
      const prev = byId.get(n.id);
      return {
        ...n, shell: groupingChanged ? n.targetShell : (prev?.shell ?? n.targetShell ?? 0.55), born: groupingChanged ? s.t : (prev?.born ?? s.t),
        lifecycleBorn: prev?.lifecycleBorn || lifecycleBorn.has(n.id),
        wx: prev?.wx ?? 0, wy: prev?.wy ?? 0, wz: prev?.wz ?? 0,
        sx: prev?.sx ?? s.w / 2, sy: prev?.sy ?? s.h / 2, depth: prev?.depth ?? 1,
        r: starRadius(n.degree, n.kind),
      };
    });
    s.edges = edges;
    if (s.focusCluster && !s.sim.some((node) => clusterKey(node) === s.focusCluster)) flyTo(null, false);
    s.playback.setGraph(nodes, edges);
    if (!s.sim.some((node) => node.id === s.hover)) s.hover = null;
    if (s.spin?.hitId && !s.sim.some((node) => node.id === s.spin.hitId)) s.spin.hitId = null;
    if (groupingChanged) s.aimed = false;
    if (!s.aimed && s.sim.length) {
      flyTo(null, false);
      s.aimed = true;
    }
  }

  function clusterMembers(label) {
    if (!label) return s.sim;
    return s.sim.filter((n) => clusterKey(n) === label);
  }

  function clusterWorld(label) {
    const members = clusterMembers(label);
    const R = globeR(s);
    if (!members.length) return { x: 0, y: 0, z: 0 };
    let x = 0, y = 0, z = 0;
    for (const n of members) {
      const w = nodeWorld({ ...n, shell: n.targetShell || n.shell }, R);
      x += w.x; y += w.y; z += w.z;
    }
    const c = members.length;
    return { x: x / c, y: y / c, z: z / c };
  }

  function flyTo(label, manual = true) {
    if (manual) pauseAutoFocus();
    s.panTarget = { x: 0, y: 0 };
    s.focusCluster = label;
    const w = clusterWorld(label);
    s.targetPivot = w;
    const members = clusterMembers(label);
    const galactic = Boolean(members[0]?.galaxyCore);
    const look = galactic ? activationSurfaceAngle(members, homeCam()) : null;
    s.targetLook = galactic ? {
      yaw: look ? look.yaw + 0.35 : homeCam().yaw,
      pitch: look ? Math.max(-1.2, Math.min(1.2, look.pitch + 0.3)) : homeCam().pitch,
    } : {
      yaw: Math.atan2(w.z, w.x),
      pitch: Math.max(-1.2, Math.min(1.2, Math.atan2(w.y, Math.hypot(w.x, w.z)))),
    };
    s.cam.targetK = label ? 1.45 : 1;
    s.cam.vYaw = 0;
    s.cam.vPitch = 0;
    s.lookVelocity = { yaw: 0, pitch: 0 };
    options.onCluster?.(label);
  }

  function clusters() {
    const by = new Map();
    for (const n of s.sim) {
      const label = n.galaxyLabel || n.galaxy || n.kind;
      const key = clusterKey(n);
      if (!by.has(key)) by.set(key, { key, label, kind: n.kind, count: 0 });
      by.get(key).count += 1;
    }
    return [...by.values()];
  }

  function clusterHits() {
    const out = [];
    const groups = new Map();
    for (const n of s.sim) {
      if (n.depth < 0.38) continue;
      const label = clusterKey(n);
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(n);
    }
    for (const [label, members] of groups) {
      if (s.featured && !s.featured.has(label) && label !== s.focusCluster) continue;
      let sx = 0, sy = 0;
      for (const n of members) { sx += n.sx; sy += n.sy; }
      sx /= members.length; sy /= members.length;
      let spread = 0;
      for (const n of members) spread = Math.max(spread, Math.hypot(n.sx - sx, n.sy - sy));
      out.push({ label, sx, sy, r: Math.max(36, spread + 28) });
    }
    return out;
  }

  function resize() {
    if (destroyed) return;
    const rect = wrap.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    s.w = Math.max(2, rect.width || wrap.clientWidth || 640);
    s.h = Math.max(2, rect.height || wrap.clientHeight || 720);
    for (const [layer, context] of [[canvas, ctx], [labels, labelCtx]]) {
      if (!layer || !context) continue;
      layer.width = Math.max(1, Math.floor(s.w * dpr));
      layer.height = Math.max(1, Math.floor(s.h * dpr));
      layer.style.width = `${s.w}px`; layer.style.height = `${s.h}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    if (gpu) {
      try { gpu.resize(s.w, s.h, dpr); }
      catch { fallback2d(); }
    }
    s.activityCamera.lastFitAt = -Infinity;
  }

  function fallback2d() {
    if (!gpu || destroyed) return;
    gpuCanvas.removeEventListener("webglcontextlost", onContextLost);
    gpu.destroy();
    gpu = null;
    gpuCanvas.remove();
    labels?.remove();
    labels = labelCtx = null;
    wrap.dataset.renderer = "2d";
    rendererNotice = document.createElement("span");
    rendererNotice.setAttribute("role", "status");
    rendererNotice.textContent = "WebGL interrupted — using 2D rendering.";
    Object.assign(rendererNotice.style, {
      position: "absolute", left: "12px", bottom: "calc(12px + var(--footer-inset))", pointerEvents: "none",
      color: "#c8dcf0", background: "#0a121c", padding: "4px 8px", fontSize: "12px",
    });
    wrap.insertBefore(rendererNotice, canvas.nextSibling);
    draw2d(ctx, s);
  }
  const onContextLost = (event) => {
    event.preventDefault();
    fallback2d();
  };
  if (gpu) gpuCanvas.addEventListener("webglcontextlost", onContextLost);

  let raf = 0;
  let last = performance.now();
  let fpsStartedAt = null;
  let fpsLastFrameAt = null;
  let fpsFrames = 0;
  options.onFrameRate?.(null);
  const tick = (now) => {
    if (destroyed) return;
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    s.t += s.reduce ? 0 : dt;
    for (const n of s.sim) {
      const age = Math.max(0, s.t - n.born);
      const speed = s.reduce ? 20 : 0.42 + n.mass * 0.35;
      const destination = n.targetShell * (1 - Math.exp(-age * speed));
      n.shell = s.reduce ? n.targetShell : n.shell + (destination - n.shell) * Math.min(1, dt * 3.2);
    }
    const R = globeR(s);
    const focus = s.selectedId ? s.sim.find((n) => n.id === s.selectedId) : undefined;
    const ease = s.reduce ? 1 : 1 - Math.exp(-dt * 2.8);
    const wallTime = Date.now();
    s.lifecycleFrame = s.lifecycle.frame(wallTime, s.reduce);
    s.activityFrame = s.playback.frame(wallTime);
    if (!s.spin && wallTime < s.activityCamera.orbitPausedUntil && s.activityCamera.target) {
      s.cam.yaw += s.cam.vYaw;
      s.cam.pitch = Math.max(-1.2, Math.min(1.2, s.cam.pitch + s.cam.vPitch));
      s.cam.vYaw *= 0.92;
      s.cam.vPitch *= 0.92;
    }
    projectGlobe(s);
    projectGlobe(s, s.lifecycleFrame.ghosts.map(({ node }) => node));
    projectGlobe(s, s.lifecycleFrame.edgeGhosts.flatMap(({ source, target }) => [source, target]));
    const autoTarget = s.activityCamera.update(
      activationFocusNodes(s.sim, s.activityFrame, s.lifecycleFrame, s.query),
      s.cam, s.w, s.h, wallTime, { blocked: Boolean(focus), reducedMotion: s.reduce, orbiting: Boolean(s.spin) });
    if (autoTarget) {
      s.targetPivot = null;
      s.targetLook = null;
      s.cam.targetK = null;
      if (!s.spin && wallTime >= s.activityCamera.orbitPausedUntil) {
        s.cam.vYaw = 0;
        s.cam.vPitch = 0;
      }
      s.activityCamera.move(s.cam, autoTarget, dt, { now: wallTime, orbiting: Boolean(s.spin) });
    } else {
      if (focus) s.targetPivot = nodeWorld(focus, R);
      if (s.targetPivot) {
        s.cam.pivot.x += (s.targetPivot.x - s.cam.pivot.x) * ease;
        s.cam.pivot.y += (s.targetPivot.y - s.cam.pivot.y) * ease;
        s.cam.pivot.z += (s.targetPivot.z - s.cam.pivot.z) * ease;
        if (Math.hypot(s.cam.pivot.x - s.targetPivot.x, s.cam.pivot.y - s.targetPivot.y, s.cam.pivot.z - s.targetPivot.z) < 2) {
          s.targetPivot = null;
        }
      }
      if (s.targetLook && !s.spin) {
        moveCameraLook(s.cam, s.targetLook, s.lookVelocity, dt, s.reduce);
        if (Math.abs(angleDelta(s.targetLook.yaw, s.cam.yaw)) < 0.01 && Math.abs(s.cam.pitch - s.targetLook.pitch) < 0.01) {
          s.targetLook = null;
          s.lookVelocity = { yaw: 0, pitch: 0 };
        }
      }
      s.cam.x += (s.panTarget.x - s.cam.x) * ease;
      s.cam.y += (s.panTarget.y - s.cam.y) * ease;
      if (s.cam.targetK != null) {
        s.cam.k += (s.cam.targetK - s.cam.k) * ease;
        if (Math.abs(s.cam.k - s.cam.targetK) < 0.012) { s.cam.k = s.cam.targetK; s.cam.targetK = null; }
      }
      if (!s.spin) {
        if (!s.reduce && !s.selectedId && !s.targetLook) s.cam.yaw += 0.16 * dt;
        s.cam.yaw += s.cam.vYaw; s.cam.pitch += s.cam.vPitch;
        s.cam.vYaw *= 0.92; s.cam.vPitch *= 0.92;
      }
      s.cam.pitch = Math.max(-1.2, Math.min(1.2, s.cam.pitch));
    }
    syncZoom();
    projectGlobe(s);
    projectGlobe(s, s.lifecycleFrame.ghosts.map(({ node }) => node));
    projectGlobe(s, s.lifecycleFrame.edgeGhosts.flatMap(({ source, target }) => [source, target]));
    if (s.lastPlaybackStatusAt === undefined || wallTime - s.lastPlaybackStatusAt >= PLAYBACK_STATUS_INTERVAL_MS) {
      s.lastPlaybackStatusAt = wallTime;
      options.onPlayback?.(s.activityFrame.playback);
    }
    if (destroyed) return;
    if (gpu) {
      try {
        drawBackdrop(ctx, s);
        gpu.draw({
          nodes: s.sim, edges: s.edges, w: s.w, h: s.h, k: s.cam.k, t: s.t,
          query: s.query, selectedId: s.selectedId, hover: s.hover, reduce: s.reduce,
          activityFrame: s.activityFrame, lifecycleFrame: s.lifecycleFrame,
          transparent: true,
        });
        labelCtx.clearRect(0, 0, s.w, s.h);
        drawLabels(labelCtx, s);
      } catch {
        fallback2d();
      }
    } else {
      draw2d(ctx, s);
    }
    if (fpsLastFrameAt !== null && (now <= fpsLastFrameAt || now - fpsLastFrameAt > 1500)) {
      fpsStartedAt = null;
      fpsFrames = 0;
      options.onFrameRate?.(null);
    }
    fpsLastFrameAt = now;
    if (fpsStartedAt === null) fpsStartedAt = now;
    else fpsFrames++;
    if (now - fpsStartedAt >= 1000) {
      options.onFrameRate?.(Math.round(fpsFrames * 1000 / (now - fpsStartedAt)));
      fpsStartedAt = now;
      fpsFrames = 0;
    }
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
  function pauseAutoFocus() {
    if (s.activityCamera.target) s.panTarget = { x: s.cam.x, y: s.cam.y };
    s.activityCamera.manual(Date.now());
  }

  const onDown = (ev) => {
    if (ev.target.closest("button")) return;
    if (ev.button > 2) return;
    s.activityCamera.orbit(Date.now(), s.cam);
    s.targetLook = null;
    ev.preventDefault();
    const p = toLocal(ev.clientX, ev.clientY);
    s.pointers.set(ev.pointerId, p);
    const n = hit(p.x, p.y);
    s.cam.vYaw = 0; s.cam.vPitch = 0;
    s.spin = { pointerId: ev.pointerId, x: ev.clientX, y: ev.clientY, yaw: s.cam.yaw, pitch: s.cam.pitch, moved: false, hitId: n?.id ?? null };
    wrap.setPointerCapture?.(ev.pointerId);
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
        s.activityCamera.orbit(Date.now(), s.cam);
        wrap.style.cursor = "grabbing";
      }
      return;
    }
    const n = hit(p.x, p.y);
    const island = !n && clusterHits().find((c) => Math.hypot(p.x - c.sx, p.y - c.sy) <= c.r);
    s.hover = n?.id ?? null;
    wrap.style.cursor = n || island ? "pointer" : "grab";
  };
  const onUp = (ev) => {
    if (s.pointers.has(ev.pointerId)) s.activityCamera.orbit(Date.now(), s.cam);
    s.pointers.delete(ev.pointerId);
    if (wrap.hasPointerCapture?.(ev.pointerId)) wrap.releasePointerCapture(ev.pointerId);
    const g = s.spin;
    if (g && g.pointerId === ev.pointerId) {
      if (!g.moved && ev.type !== "pointercancel") {
        if (g.hitId) options.onSelect?.(g.hitId, { pointerType: ev.pointerType });
        else {
          const p = toLocal(ev.clientX, ev.clientY);
          const island = clusterHits().find((c) => Math.hypot(p.x - c.sx, p.y - c.sy) <= c.r);
          if (island) flyTo(island.label);
          options.onSelect?.(null, { pointerType: ev.pointerType });
        }
      }
      s.spin = null;
    }
    wrap.style.cursor = "grab";
  };
  const onWheel = (ev) => {
    ev.preventDefault();
    pauseAutoFocus();
    const p = toLocal(ev.clientX, ev.clientY);
    applyZoom(s, s.cam.k * (ev.deltaY < 0 ? 1.1 : 0.9), p.x, p.y);
    syncZoom();
  };

  wrap.addEventListener("pointerdown", onDown);
  wrap.addEventListener("pointermove", onMove);
  wrap.addEventListener("pointerup", onUp);
  wrap.addEventListener("pointercancel", onUp);
  wrap.addEventListener("wheel", onWheel, { passive: false });
  const onContextMenu = (event) => event.preventDefault();
  wrap.addEventListener("contextmenu", onContextMenu);
  const ro = new ResizeObserver(resize);
  ro.observe(wrap);
  resize();
  raf = requestAnimationFrame(tick);

  const zoomHandlers = [
    ["[data-zoom-in]", () => { pauseAutoFocus(); applyZoom(s, s.cam.k * 1.25, s.w / 2, s.h / 2); syncZoom(); }],
    ["[data-zoom-out]", () => { pauseAutoFocus(); applyZoom(s, s.cam.k / 1.25, s.w / 2, s.h / 2); syncZoom(); }],
    ["[data-zoom-reset]", () => { flyTo(null); syncZoom(); }],
  ].map(([selector, handler]) => [wrap.querySelector(selector), handler]);
  for (const [button, handler] of zoomHandlers) button?.addEventListener("click", handler);

  return {
    setGraph,
    setSelected(id) {
      if (s.selectedId === id) return;
      pauseAutoFocus();
      s.selectedId = id;
      if (id) s.panTarget = { x: 0, y: 0 };
      if (id && s.cam.k < 2) s.cam.targetK = Math.min(2.4, Math.max(s.cam.k * 1.15, 1.55));
    },
    setQuery(q) { s.query = q ?? ""; },
    setActivity(activity) { s.playback.update(activity); },
    setAutoFocus(enabled) {
      pauseAutoFocus();
      s.activityCamera.setEnabled(enabled);
    },
    flyTo,
    clusters,
    focusCluster: () => s.focusCluster,
    setFeatured(labels) {
      s.featured = labels && labels.length ? new Set(labels) : null;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelAnimationFrame(raf);
      options.onFrameRate?.(null);
      ro.disconnect();
      motionPreference.removeEventListener("change", onMotionChange);
      for (const [type, handler] of [
        ["pointerdown", onDown], ["pointermove", onMove], ["pointerup", onUp],
        ["pointercancel", onUp], ["wheel", onWheel], ["contextmenu", onContextMenu],
      ]) wrap.removeEventListener(type, handler);
      for (const [button, handler] of zoomHandlers) button?.removeEventListener("click", handler);
      for (const id of s.pointers.keys()) if (wrap.hasPointerCapture?.(id)) wrap.releasePointerCapture(id);
      s.pointers.clear();
      gpuCanvas.removeEventListener("webglcontextlost", onContextLost);
      gpu?.destroy();
      gpu = null;
      gpuCanvas.remove();
      labels?.remove();
      canvas.remove();
      rendererNotice?.remove();
      delete wrap.dataset.renderer;
      s.playback.reset();
      s.lifecycle.cancel();
      s.activityCamera.clear();
    },
  };
}
