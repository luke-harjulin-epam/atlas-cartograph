import { nodeCategory } from "./node-layers.js";

export function describeNode(node, state = {}) {
  const store = state.stores?.find((item) => item.root === node.storeRoot) || state.graph?.store;
  const atlas = node.atlasLabel || store?.label || node.atlasKey || store?.atlasId || "Atlas";
  const key = node.atlasKey || store?.atlasId;
  const root = node.storeRoot || store?.root || state.root;
  return `${node.title || node.id} · ${node.type || node.kind || "page"} · ${nodeCategory(node).label} · Atlas: ${atlas}${key && key !== atlas ? ` [${key}]` : ""}${root ? ` (${root})` : ""} · ${node.path || node.localId || node.id}`;
}

export const nodeSearchText = (node, state) => `${describeNode(node, state)} ${node.id} ${node.kind || ""}`.toLowerCase();

export function matchesNodeQuery(node, query = "", state) {
  const normalized = query.trim().toLowerCase();
  return !normalized || (node.searchText ?? nodeSearchText(node, state)).includes(normalized);
}
