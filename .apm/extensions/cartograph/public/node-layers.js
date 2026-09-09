export const LEGACY_NODE_LAYERS = ["experiences", "decisions", "work", "indexes", "other"];
export const RELATION_LAYERS = ["relations", "sources"];

const FALLBACK_LABELS = {
  experiences: "Experiences", decisions: "Decisions", work: "Work",
  indexes: "Navigation indexes", other: "Untyped pages", undeclared: "Undeclared types",
};

export const fallbackLayerLabel = (key) => FALLBACK_LABELS[key];

export function nodeCategory(node) {
  if (node.typeKey) return { key: node.typeKey, label: node.schemaLabel || "Declared type" };
  const kind = node.kind;
  const key = node.declaredType ? "undeclared"
    : kind === "experience" || kind === "raw" ? "experiences"
    : kind === "decision" ? "decisions"
    : kind === "work" || kind === "module" ? "work"
    : kind === "index" ? "indexes" : "other";
  return { key, label: fallbackLayerLabel(key) };
}

export function nodeLayer(node) {
  return nodeCategory(node).key;
}

export function nodeLayerKeys(graph) {
  return [...new Set([...LEGACY_NODE_LAYERS,
    ...(graph?.schemas ?? []).flatMap((schema) => schema.types.map((type) => type.key)),
    ...(graph?.nodes ?? []).map(nodeLayer)])];
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
