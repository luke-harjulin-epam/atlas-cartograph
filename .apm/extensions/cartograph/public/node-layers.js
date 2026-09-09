export const LEGACY_NODE_LAYERS = ["experiences", "decisions", "work", "indexes", "other"];
export const RELATION_LAYERS = ["relations", "sources"];

export function nodeLayer(node) {
  if (node.typeKey) return node.typeKey;
  const kind = node.kind;
  if (kind === "experience" || kind === "raw") return "experiences";
  if (kind === "decision") return "decisions";
  if (kind === "work" || kind === "module") return "work";
  if (kind === "index") return "indexes";
  return "other";
}

export function nodeLayerKeys(graph) {
  return [...LEGACY_NODE_LAYERS, ...(graph?.schemas ?? []).flatMap((schema) => schema.types.map((type) => type.key))];
}

export function normalizeLayers(layers, keys = LEGACY_NODE_LAYERS) {
  return Object.fromEntries([...keys, ...RELATION_LAYERS].map((key) => [key, layers?.[key] !== false]));
}

export function layerCounts(graph) {
  const counts = new Map();
  for (const node of graph?.nodes ?? []) {
    const key = nodeLayer(node);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
