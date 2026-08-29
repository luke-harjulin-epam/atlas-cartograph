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

/** Visual islands around the orbital core — one sector per page kind. */
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

export function assignGalaxies(nodes) {
  const galaxy = new Map();
  for (const n of nodes) {
    const home = islandOf(n);
    galaxy.set(n.id, home.label);
  }
  return galaxy;
}

export function layoutUniverse(nodes, edges) {
  const maxDegree = nodes.reduce((m, n) => Math.max(m, n.degree), 1);
  const maxSources = nodes.reduce((m, n) => Math.max(m, n.sourceCount), 1);
  const byKind = new Map();
  for (const n of nodes) {
    const k = n.kind || "page";
    if (!byKind.has(k)) byKind.set(k, []);
    byKind.get(k).push(n);
  }
  for (const list of byKind.values()) {
    list.sort((a, b) => a.id.localeCompare(b.id));
  }

  return nodes.map((n) => {
    const mass = massOf(n, maxDegree, maxSources);
    const home = islandOf(n);
    const siblings = byKind.get(n.kind) ?? [n];
    const i = Math.max(0, siblings.findIndex((s) => s.id === n.id));
    const count = Math.max(1, siblings.length);
    const ring = Math.floor(i / 8);
    const slot = i % Math.max(1, Math.min(8, count));
    const onRing = Math.min(8, count - ring * 8);
    const theta = (slot / Math.max(1, onRing)) * Math.PI * 2 + hash01(n.id, 3) * 0.2;
    const radius = 0.04 + ring * 0.055 + hash01(n.id, 11) * 0.03;
    const lon = home.lon + Math.cos(theta) * radius;
    const lat = home.lat + Math.sin(theta) * radius * 0.65;
    const shell = home.shell + (1 - mass) * 0.06 + ring * 0.03;

    return {
      ...n,
      mass,
      galaxy: home.label,
      galaxyLabel: home.label,
      clusterKind: n.kind,
      lon: (lon + Math.PI * 2) % (Math.PI * 2),
      lat: Math.max(0.15, Math.min(Math.PI - 0.15, lat)),
      targetShell: Math.min(1.05, shell),
    };
  });
}
