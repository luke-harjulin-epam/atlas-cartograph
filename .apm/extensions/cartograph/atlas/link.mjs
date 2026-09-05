import { normalizeLink } from "./parse.mjs";
import { pageIdentity } from "./identity.mjs";

function addAlias(map, alias, node) {
  if (!alias) return;
  if (!map.has(alias)) map.set(alias, []);
  map.get(alias).push(node);
}

function pickAlias(hits, source) {
  if (!hits?.length) return null;
  const same = hits.find((h) => (h.atlasKey || "") === (source.atlasKey || ""));
  return (same || hits[0]).id;
}

function linkGraph(nodes) {
  const aliasToIds = new Map();
  for (const n of nodes) {
    addAlias(aliasToIds, n.id, n);
    addAlias(aliasToIds, n.localId, n);
    for (const a of n.aliases || []) addAlias(aliasToIds, a, n);
  }
  const resolveRef = (raw, source) => {
    const n = normalizeLink(raw);
    if (!n) return null;
    if (n.startsWith("atlas://") || n.includes("::")) {
      const identity = pageIdentity(raw);
      return identity?.atlas
        ? aliasToIds.get(identity.id)?.find((node) => node.atlasKey === identity.atlas)?.id ?? null
        : null;
    }
    return (
      pickAlias(aliasToIds.get(n), source) ||
      pickAlias(aliasToIds.get(n.replace(/^\.\.\//, "")), source) ||
      pickAlias(aliasToIds.get(n.split("/").pop() ?? ""), source)
    );
  };
  const edges = [];
  const seen = new Set();
  for (const n of nodes) {
    for (const ref of n.refs || []) {
      let tid = null;
      if (ref.kind === "mesh") {
        if (!ref.relKind) continue;
        tid = resolveRef(`atlas://${ref.relKind}/${ref.raw}`, n);
      } else {
        tid = resolveRef(ref.raw, n);
      }
      if (!tid || tid === n.id) continue;
      const key = `${ref.kind}:${n.id}->${tid}:${ref.relKind ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({
        id: key,
        source: n.id,
        target: tid,
        kind: ref.kind,
        relKind: ref.relKind,
      });
    }
  }
  return edges;
}
function withDegrees(nodes, edges) {
  const degree = /* @__PURE__ */ new Map();
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  return nodes.map((n) => ({ ...n, degree: degree.get(n.id) ?? 0 }));
}
function countKinds(nodes) {
  const kinds = { experiences: 0, decisions: 0, work: 0, other: 0 };
  for (const n of nodes) {
    if (n.kind === "experience" || n.kind === "raw") kinds.experiences += 1;
    else if (n.kind === "decision") kinds.decisions += 1;
    else if (n.kind === "work" || n.kind === "module") kinds.work += 1;
    else kinds.other += 1;
  }
  return kinds;
}
export {
  countKinds,
  linkGraph,
  withDegrees
};
