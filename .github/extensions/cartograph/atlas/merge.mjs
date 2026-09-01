import { basename } from "node:path";
import { countKinds, linkGraph, withDegrees } from "./link.mjs";
import { normalizeLink } from "./parse.mjs";

export function atlasKeyOf(store, node) {
  return (
    node?.atlasKey ||
    store?.atlasId ||
    store?.label ||
    (store?.root ? basename(store.root) : "atlas")
  );
}

export function qualifyGraph(graph) {
  const key = atlasKeyOf(graph.store);
  const label = graph.store.label || key;
  const idMap = new Map();
  const nodes = graph.nodes.map((n) => {
    const local = String(
      n.localId || (String(n.id).includes("::") ? String(n.id).split("::").slice(1).join("::") : n.id),
    );
    const id = `${key}::${local}`;
    idMap.set(n.id, id);
    return {
      ...n,
      id,
      localId: local,
      atlasKey: key,
      atlasLabel: label,
      storeRoot: n.storeRoot || graph.store.root,
      aliases: [...new Set([...(n.aliases || []), local, n.id, id, `atlas://${key}/${local}`])],
    };
  });
  const edges = (graph.edges || []).map((e) => {
    const source = idMap.get(e.source) || e.source;
    const target = idMap.get(e.target) || e.target;
    return { ...e, source, target, id: `${e.kind}:${source}->${target}` };
  });
  return { ...graph, nodes, edges };
}

export function crossAtlasEdges(nodes) {
  const edges = [];
  const seen = new Set();
  const add = (a, b, kind, relKind) => {
    if (!a || !b || a.id === b.id) return;
    const key = `${kind}:${a.id}->${b.id}:${relKind || ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ id: key, source: a.id, target: b.id, kind, relKind: relKind || "mesh" });
  };

  for (const n of nodes) {
    for (const ref of n.refs || []) {
      if (ref.kind !== "mesh" || !ref.relKind) continue;
      const path = normalizeLink(ref.raw);
      const hit = nodes.find(
        (o) =>
          o.atlasKey === ref.relKind &&
          (o.localId === path ||
            normalizeLink(o.path || "") === path ||
            (o.aliases || []).includes(path)),
      );
      add(n, hit, "mesh", ref.relKind);
    }
  }

  const byLocal = new Map();
  for (const n of nodes) {
    const local = normalizeLink(n.localId || n.path || "");
    if (!local || local === "index") continue;
    if (!byLocal.has(local)) byLocal.set(local, []);
    byLocal.get(local).push(n);
  }
  for (const group of byLocal.values()) {
    const keys = new Set(group.map((n) => n.atlasKey));
    if (keys.size < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        if (group[i].atlasKey !== group[j].atlasKey) add(group[i], group[j], "mesh", "same-path");
      }
    }
  }
  return edges;
}

export function mergeGraphs(base, extra) {
  const byId = new Map(base.nodes.map((n) => [n.id, n]));
  for (const n of extra.nodes) byId.set(n.id, n);
  const nodes = [...byId.values()];
  const edges = linkGraph(nodes);
  return {
    store: { ...base.store, ...extra.store, ...countKinds(nodes) },
    nodes: withDegrees(nodes, edges),
    edges,
    nextOffset: extra.nextOffset,
    scanned: (base.scanned || 0) + (extra.scanned || 0),
    total: Math.max(base.total || 0, extra.total || 0),
    complete: extra.complete,
  };
}

export function combineAtlases(graphs) {
  const available = graphs.filter((g) => g.store?.available);
  if (!available.length) {
    return graphs[0] || { store: { available: false }, nodes: [], edges: [] };
  }
  if (available.length === 1) return available[0];
  const qualified = available.map(qualifyGraph);
  const nodes = qualified.flatMap((g) => g.nodes);
  const edges = [...linkGraph(nodes), ...crossAtlasEdges(nodes)];
  const pages = available.reduce((n, g) => n + (g.store.pages || g.nodes.length), 0);
  return {
    store: {
      ...available[0].store,
      label: available.map((g) => g.store.label).join(" + "),
      atlasId: available.map((g) => atlasKeyOf(g.store)).join("+"),
      roots: available.map((g) => g.store.root),
      pages,
      available: true,
      format: "atlas",
      ...countKinds(nodes),
    },
    nodes: withDegrees(nodes, edges),
    edges,
    complete: true,
    scanned: nodes.length,
    total: nodes.length,
    nextOffset: null,
  };
}
