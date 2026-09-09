import { nodeCategory, nodeLayer } from "./node-layers.js";

const KIND_MASS = {
  index: 1,
  work: 0.92,
  module: 0.88,
  decision: 0.78,
  recipe: 0.7,
  lesson: 0.65,
  knowledge: 0.62,
  experience: 0.55,
  page: 0.4,
  raw: 0.18,
};

const KIND_HOME = {
  index: { lon: 0.15, lat: 0.55, shell: 0.32, label: "Index" },
  work: { lon: 0.2, lat: 1.12, shell: 0.7, label: "Work" },
  module: { lon: 0.35, lat: 1.18, shell: 0.68, label: "Work" },
  decision: { lon: 1.35, lat: 1.12, shell: 0.7, label: "Decisions" },
  experience: { lon: 2.55, lat: 1.18, shell: 0.76, label: "Experiences" },
  raw: { lon: 2.7, lat: 1.28, shell: 0.82, label: "Experiences" },
  knowledge: { lon: 3.9, lat: 1.14, shell: 0.72, label: "Knowledge" },
  lesson: { lon: 5.05, lat: 1.16, shell: 0.7, label: "Lessons" },
  recipe: { lon: 5.2, lat: 1.22, shell: 0.7, label: "Recipes" },
  page: { lon: 5.7, lat: 1.35, shell: 0.88, label: "Pages" },
};

const KIND_ROOTS = new Set([
  "experiences",
  "decisions",
  "work",
  "lessons",
  "recipes",
  "knowledge",
  "raw",
  "modules",
]);

function hash01(s, salt = 0) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

function kindBoost(n) {
  return KIND_MASS[n.kind] ?? 0.4;
}

export function massOf(n, maxDegree, maxSources) {
  const d = Math.log1p(n.degree) / Math.log1p(Math.max(maxDegree, 1));
  const s = Math.log1p(n.sourceCount) / Math.log1p(Math.max(maxSources, 1));
  return Math.min(1, kindBoost(n) * 0.38 + d * 0.47 + s * 0.15);
}

function islandOf(n) {
  return KIND_HOME[n.kind] ?? KIND_HOME.page;
}

function galaxyNoise(id, salt) {
  let value = Math.floor(hash01(id, salt) * 4294967296);
  value = Math.imul(value ^ (value >>> 16), 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

export function galaxyDetailOpacity(nodes, zoom = 1, query = "", selectedId = null) {
  if (!nodes?.[0]?.galaxyCore || nodes.length <= 80 || query || selectedId) return 1;
  return 0.28 + 0.72 * Math.max(0, Math.min(1, (zoom - 1) / 2));
}

function galaxyOrbit(home, node, index, count, mass) {
  const extent = Math.min(home.orbitRadius, 0.045 + Math.sqrt(count) * 0.02);
  const coreCount = Math.max(1, Math.ceil(count * 0.24));
  let u, v, height;
  if (index < coreCount) {
    const radius = extent * 0.28 * Math.cbrt((index + 0.5) / coreCount) * (1 - mass * 0.2);
    const z = 1 - 2 * (index + 0.5) / coreCount;
    const theta = index * Math.PI * (3 - Math.sqrt(5));
    const ring = radius * Math.sqrt(1 - z * z);
    u = Math.cos(theta) * ring;
    v = Math.sin(theta) * ring;
    height = radius * z;
  } else {
    const armIndex = index - coreCount;
    const progress = (Math.floor(armIndex / 3) + 0.5) / Math.ceil((count - coreCount) / 3);
    const radius = extent * (0.18 + 0.78 * Math.sqrt(progress) + (galaxyNoise(node.id, 11) - 0.5) * 0.035);
    const halo = armIndex % 11 === 10;
    const theta = halo ? galaxyNoise(node.id, 7) * Math.PI * 2
      : armIndex % 3 * Math.PI * 2 / 3 + Math.sqrt(progress) * Math.PI * 1.65
        + (galaxyNoise(node.id, 3) - 0.5) * 0.3;
    u = Math.cos(theta) * radius;
    v = Math.sin(theta) * radius;
    const maxHeight = Math.sqrt(Math.max(0, (extent * 0.98) ** 2 - radius ** 2));
    height = maxHeight * ((galaxyNoise(node.id, 19) * 2 - 1) * (halo ? 0.98 : 0.9)
      + Math.sin(theta * 2) * 0.02);
  }
  const bound = Math.min(1, extent * 0.98 / Math.hypot(u, v, height));
  u *= bound;
  v *= bound;
  height *= bound;
  const radial = home.shell + height;
  const sinLat = Math.sin(home.lat), cosLat = Math.cos(home.lat);
  const sinLon = Math.sin(home.lon), cosLon = Math.cos(home.lon);
  // A thick spiral disk and spherical bulge share a bounded, pole-safe local frame.
  const x = radial * sinLat * cosLon - u * sinLon + v * cosLat * cosLon;
  const y = radial * cosLat - v * sinLat;
  const z = radial * sinLat * sinLon + u * cosLon + v * cosLat * sinLon;
  const shell = Math.hypot(x, y, z);
  return {
    lon: Math.atan2(z, x), lat: Math.acos(Math.max(-1, Math.min(1, y / shell))), shell,
    galaxyCore: { lon: home.lon, lat: home.lat, shell: home.shell }, galaxyRadius: extent,
  };
}

function packInHome(nodes, homeFor) {
  const maxDegree = nodes.reduce((m, n) => Math.max(m, n.degree || 0), 1);
  const maxSources = nodes.reduce((m, n) => Math.max(m, n.sourceCount || 0), 1);
  const masses = new Map(nodes.map((node) => [node.id, massOf(node, maxDegree, maxSources)]));
  const byKey = new Map();
  for (const n of nodes) {
    const home = homeFor(n);
    const key = home.key || home.label;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(n);
  }
  const indicesByKey = new Map();
  for (const [key, list] of byKey) {
    const galactic = homeFor(list[0]).orbitRadius !== undefined;
    list.sort((a, b) => (galactic ? masses.get(b.id) - masses.get(a.id) : 0)
      || String(a.id).localeCompare(String(b.id)));
    const indices = new Map();
    list.forEach((node, i) => {
      if (!indices.has(node.id)) indices.set(node.id, i);
    });
    indicesByKey.set(key, indices);
  }

  return nodes.map((n) => {
    const mass = masses.get(n.id);
    const home = homeFor(n);
    const key = home.key || home.label;
    const siblings = byKey.get(key) ?? [n];
    const i = indicesByKey.get(key)?.get(n.id) ?? 0;
    const count = Math.max(1, siblings.length);
    let lon, lat, shell;
    let galaxy = {};
    if (home.orbitRadius !== undefined) {
      ({ lon, lat, shell, ...galaxy } = galaxyOrbit(home, n, i, count, mass));
    } else {
      const ring = Math.floor(i / 8);
      const onRing = Math.min(8, count - ring * 8);
      const slot = i % Math.max(1, onRing);
      const theta = (slot / Math.max(1, onRing)) * Math.PI * 2 + hash01(n.id, 3) * 0.2;
      const radius = 0.04 + ring * 0.055 + hash01(n.id, 11) * 0.03;
      lon = home.lon + Math.cos(theta) * radius;
      lat = Math.max(0.15, Math.min(Math.PI - 0.15, home.lat + Math.sin(theta) * radius * 0.65));
      shell = home.shell + (1 - mass) * 0.06 + ring * 0.03;
    }
    return {
      ...n,
      mass,
      galaxy: home.label,
      galaxyLabel: home.label,
      galaxyKey: home.key || home.label,
      ...galaxy,
      clusterKind: n.kind,
      lon: (lon + Math.PI * 2) % (Math.PI * 2),
      lat,
      targetShell: Math.min(1.05, shell),
    };
  });
}

function fibonacciHome(i, n) {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const y = n <= 1 ? 0.15 : 1 - (2 * i + 1) / n;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = golden * i;
  const x = Math.cos(theta) * r;
  const z = Math.sin(theta) * r;
  return {
    lon: Math.atan2(z, x),
    lat: Math.acos(Math.max(-1, Math.min(1, y))),
    shell: 0.62 + (i % 3) * 0.08,
  };
}

function neighborhood(n) {
  const p = String(n.path || n.id || "")
    .replace(/\\/g, "/")
    .replace(/\.md$/i, "");
  const parts = p.split("/").filter(Boolean);
  if (parts[0] === "work" && parts.length >= 2 && !parts[1].includes(".")) {
    return { key: `work/${parts[1]}`, label: parts[1].replace(/[-_]/g, " ") };
  }
  if (parts[0] && !KIND_ROOTS.has(parts[0])) {
    return { key: parts[0], label: parts[0].replace(/[-_]/g, " ") };
  }
  return null;
}

function titleCase(s) {
  const t = String(s || "")
    .replace(/^\d{4}-\d{2}-\d{2}-/, "")
    .replace(/[-_]/g, " ")
    .trim();
  if (!t) return "Cluster";
  return t.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function assignProximity(nodes, edges) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const cluster = new Map();
  const workTitle = new Map();
  for (const n of nodes) {
    const wid = n.workId || n.work_id;
    if (wid && (n.kind === "work" || n.kind === "module")) workTitle.set(wid, n.title || titleCase(wid));
  }
  for (const n of nodes) {
    const wid = n.workId || n.work_id;
    if (wid) {
      cluster.set(n.id, { key: `work:${wid}`, label: workTitle.get(wid) || titleCase(wid) });
      continue;
    }
    const folder = neighborhood(n);
    if (folder) cluster.set(n.id, { key: `folder:${folder.key}`, label: titleCase(folder.label) });
  }

  const parent = new Map();
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x);
    let root = x;
    while (root !== parent.get(root)) root = parent.get(root);
    while (x !== root) {
      const next = parent.get(x);
      parent.set(x, root);
      x = next;
    }
    return root;
  };
  const unite = (a, b) => {
    const pa = find(a);
    const pb = find(b);
    if (pa !== pb) parent.set(pa, pb);
  };
  for (const n of nodes) if (!cluster.has(n.id)) parent.set(n.id, n.id);
  for (const e of edges || []) {
    if (cluster.has(e.source) || cluster.has(e.target)) continue;
    if (byId.has(e.source) && byId.has(e.target)) unite(e.source, e.target);
  }
  const groups = new Map();
  for (const n of nodes) {
    if (cluster.has(n.id)) continue;
    const root = find(n.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(n);
  }
  for (const members of groups.values()) {
    const seed =
      members.find((n) => n.kind === "work" || n.kind === "module") ||
      members.find((n) => n.kind === "index") ||
      members.find((n) => n.kind === "decision") ||
      members[0];
    const label = seed?.title || titleCase(seed?.id);
    const key = `comp:${seed?.id}`;
    for (const n of members) cluster.set(n.id, { key, label });
  }
  return cluster;
}

function layoutLayers(nodes) {
  if (!nodes.some((node) => node.typeKey || node.declaredType)) {
    return packInHome(nodes, (node) => ({
      ...islandOf(node), key: islandOf(node).label, orbitRadius: 0.28,
      label: node.kind === "index" || node.kind === "page" ? nodeCategory(node).label : islandOf(node).label,
    }));
  }
  const labels = new Map();
  for (const node of nodes) {
    const key = nodeLayer(node);
    if (!labels.has(key)) labels.set(key, node.typeKey
      ? `${node.atlasKey || node.atlasLabel} / ${node.schemaLabel} / ${node.type}`
      : nodeCategory(node).label);
  }
  const keys = [...labels.keys()].sort();
  const homes = new Map(keys.map((key, i) => [key, {
    ...fibonacciHome(i, keys.length), key, label: labels.get(key),
    orbitRadius: keys.length === 1 ? 0.56 : Math.min(0.38, 0.7 / Math.sqrt(keys.length)),
  }]));
  return packInHome(nodes, (node) => homes.get(nodeLayer(node)));
}

function layoutAtlases(nodes) {
  const labels = new Map();
  for (const n of nodes) {
    const key = n.atlasKey || n.atlasLabel || n.atlasId || "Atlas";
    if (!labels.has(key)) labels.set(key, n.atlasLabel || key);
  }
  const keys = [...labels.keys()].sort();
  const homes = new Map();
  // Fibonacci home spacing scales with 1/sqrt(count); reserve a gap without pairwise scans.
  const orbitRadius = keys.length > 1 ? Math.min(0.38, 0.7 / Math.sqrt(keys.length)) : 0.56;
  keys.forEach((key, i) => {
    const fib = fibonacciHome(i, Math.max(keys.length, 1));
    homes.set(key, { ...fib, label: labels.get(key), key, orbitRadius });
  });
  return packInHome(nodes, (n) => {
    const key = n.atlasKey || n.atlasLabel || n.atlasId || "Atlas";
    return homes.get(key) || { lon: 0, lat: 1.2, shell: 0.7, label: n.atlasLabel || "Atlas", key };
  });
}

function layoutProximity(nodes, edges) {
  const assigned = assignProximity(nodes, edges);
  const labels = new Map();
  for (const c of assigned.values()) {
    if (!labels.has(c.key)) labels.set(c.key, c.label || c.key);
  }
  const keys = [...labels.keys()].sort();
  const homes = new Map();
  keys.forEach((key, i) => {
    const fib = fibonacciHome(i, Math.max(keys.length, 1));
    homes.set(key, { ...fib, label: labels.get(key), key });
  });
  return packInHome(nodes, (n) => {
    const c = assigned.get(n.id);
    return homes.get(c?.key) || { lon: 0, lat: 1.2, shell: 0.7, label: c?.label || "Cluster" };
  });
}

export function layoutUniverse(nodes, edges, grouping = "layers") {
  if (grouping === "proximity") return layoutProximity(nodes, edges);
  if (grouping === "atlases") return layoutAtlases(nodes);
  return layoutLayers(nodes);
}
