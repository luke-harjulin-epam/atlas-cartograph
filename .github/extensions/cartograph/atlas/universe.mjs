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

const KIND_SLOT = {
  index: 0,
  work: 1,
  module: 1,
  decision: 2,
  experience: 3,
  raw: 3,
  lesson: 4,
  recipe: 4,
  knowledge: 5,
  page: 6,
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

function folderCluster(n) {
  const p = String(n.path || n.id || "").replace(/\\/g, "/");
  if (p === "index.md" || p === "index" || n.kind === "index") return "index";
  const folder = p.split("/")[0] || n.kind;
  return folder || n.kind || "page";
}

function unionFind(ids) {
  const parent = new Map();
  for (const id of ids) parent.set(id, id);
  const find = (x) => {
    let p = parent.get(x) ?? x;
    while (p !== (parent.get(p) ?? p)) {
      parent.set(p, parent.get(parent.get(p)) ?? p);
      p = parent.get(p) ?? p;
    }
    return p;
  };
  const unite = (a, b) => {
    const pa = find(a);
    const pb = find(b);
    if (pa !== pb) parent.set(pa, pb);
  };
  return { find, unite };
}

export function assignGalaxies(nodes, edges) {
  const ids = nodes.map((n) => n.id);
  const { find, unite } = unionFind(ids);
  for (const e of edges) {
    if (ids.includes(e.source) && ids.includes(e.target)) unite(e.source, e.target);
  }
  const byRoot = new Map();
  for (const n of nodes) {
    const root = find(n.id);
    if (!byRoot.has(root)) byRoot.set(root, []);
    byRoot.get(root).push(n);
  }
  const galaxy = new Map();
  for (const members of byRoot.values()) {
    if (members.length === 1) {
      galaxy.set(members[0].id, `kind:${folderCluster(members[0])}`);
      continue;
    }
    const seed =
      members.find((n) => n.kind === "work" || n.kind === "module") ||
      members.find((n) => n.kind === "index") ||
      members.find((n) => n.kind === "decision") ||
      members.reduce((a, b) => ((a.degree ?? 0) >= (b.degree ?? 0) ? a : b));
    const gid = seed.id;
    for (const n of members) galaxy.set(n.id, gid);
  }
  return galaxy;
}

function fibonacciDir(i, n) {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const y = n <= 1 ? 0.2 : 1 - (2 * i + 1) / n;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = golden * i;
  return { x: Math.cos(theta) * r, y, z: Math.sin(theta) * r };
}

function dirFromHash(key, salt) {
  const u = hash01(key, salt);
  const v = hash01(key, salt + 1);
  const lat = Math.acos(Math.max(-1, Math.min(1, 2 * u - 1)));
  const lon = v * Math.PI * 2;
  return {
    x: Math.sin(lat) * Math.cos(lon),
    y: Math.cos(lat),
    z: Math.sin(lat) * Math.sin(lon),
  };
}

function norm(x, y, z) {
  const l = Math.hypot(x, y, z) || 1;
  return { x: x / l, y: y / l, z: z / l };
}

function galaxyLabel(gid, nodes) {
  if (gid.startsWith("kind:")) {
    const k = gid.slice(5);
    return k.charAt(0).toUpperCase() + k.slice(1);
  }
  const seed = nodes.find((n) => n.id === gid);
  return seed?.title || gid.split("/").pop() || gid;
}

export function layoutUniverse(nodes, edges) {
  const maxDegree = nodes.reduce((m, n) => Math.max(m, n.degree), 1);
  const maxSources = nodes.reduce((m, n) => Math.max(m, n.sourceCount), 1);
  const galaxies = assignGalaxies(nodes, edges);
  const gids = [...new Set([...galaxies.values()])].sort();
  const home = new Map();
  gids.forEach((gid, i) => home.set(gid, fibonacciDir(i, Math.max(gids.length, 1))));

  return nodes.map((n) => {
    const mass = massOf(n, maxDegree, maxSources);
    const gid = galaxies.get(n.id) ?? n.id;
    const cloud = home.get(gid) ?? dirFromHash(gid, 3);
    const slot = KIND_SLOT[n.kind] ?? 5;
    const local = dirFromHash(`${gid}:${n.id}`, 21);
    const kindTilt = dirFromHash(`kind:${n.kind}`, 9);
    const pull = 0.86;
    const mixed = norm(
      cloud.x * pull + local.x * 0.08 + kindTilt.x * 0.06,
      cloud.y * pull + local.y * 0.08 + kindTilt.y * 0.06,
      cloud.z * pull + local.z * 0.08 + kindTilt.z * 0.06,
    );
    const lon = Math.atan2(mixed.z, mixed.x);
    const lat = Math.acos(Math.max(-1, Math.min(1, mixed.y)));
    const clusterShell = 0.52 + (gids.indexOf(gid) % 3) * 0.08;
    const kindShell = slot * 0.018;
    const shell = clusterShell + kindShell + (1 - mass) * 0.08 + hash01(n.id, 5) * 0.03;

    return {
      ...n,
      mass,
      galaxy: gid,
      galaxyLabel: galaxyLabel(gid, nodes),
      lon: (lon + Math.PI * 2) % (Math.PI * 2),
      lat,
      targetShell: Math.min(1.08, shell),
    };
  });
}
