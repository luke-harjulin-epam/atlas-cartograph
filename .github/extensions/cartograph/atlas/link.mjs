import { normalizeLink } from "./parse.mjs";
function linkGraph(nodes) {
  const aliasToId = /* @__PURE__ */ new Map();
  for (const n of nodes) {
    for (const a of n.aliases) {
      if (!aliasToId.has(a)) aliasToId.set(a, n.id);
    }
  }
  const resolveRef = (ref) => {
    const n = normalizeLink(ref);
    if (!n) return null;
    return aliasToId.get(n) ?? aliasToId.get(n.replace(/^\.\.\//, "")) ?? aliasToId.get(n.split("/").pop() ?? "") ?? null;
  };
  const edges = [];
  const seen = /* @__PURE__ */ new Set();
  for (const n of nodes) {
    for (const ref of n.refs) {
      const tid = resolveRef(ref.raw);
      if (!tid || tid === n.id) continue;
      const key = `${ref.kind}:${n.id}->${tid}:${ref.relKind ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({
        id: key,
        source: n.id,
        target: tid,
        kind: ref.kind,
        relKind: ref.relKind
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
