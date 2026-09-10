import { createStateControls } from "./state-controls.js";
import { LEGACY_NODE_LAYERS, RELATION_LAYERS, nodeLayer, nodeLayerKeys, normalizeLayers } from "./node-layers.js";

function keysOf(layers) {
  return [...new Set([...LEGACY_NODE_LAYERS, ...Object.keys(layers ?? {}).filter((key) => !RELATION_LAYERS.includes(key))])];
}

export function allNodeLayersOn(layers, keys = keysOf(layers)) {
  return keys.every((key) => layers?.[key] !== false);
}

export function applyLayerClick(layers, key, keys = keysOf(layers), members = [key]) {
  const next = { ...layers };
  if (key === "all") {
    for (const k of keys) next[k] = true;
    return next;
  }
  if (key === "relations" || key === "sources") {
    next[key] = layers?.[key] === false;
    return next;
  }
  if (!members.length || !members.every((member) => keys.includes(member))) return next;
  if (allNodeLayersOn(layers, keys)) {
    for (const k of keys) next[k] = members.includes(k);
    return next;
  }
  const enabled = !members.every((member) => layers?.[member] !== false);
  for (const member of members) next[member] = enabled;
  if (keys.every((k) => next[k] === false)) {
    for (const k of keys) next[k] = true;
  }
  return next;
}

export function createLayerControls(send, onChange) {
  let keys = LEGACY_NODE_LAYERS;
  let schemas = new Map();
  let declaredFiles = new Set();
  const fileKey = (node) => JSON.stringify([node.storeRoot ?? node.atlasKey, node.path ?? node.id]);
  const normalize = (layers) => normalizeLayers(layers, keys);
  const control = createStateControls({
    field: "layers", initial: {}, normalize,
    isValid: (value) => value !== null && typeof value === "object" && !Array.isArray(value),
  }, send, onChange);

  return {
    get layersRevision() { return control.revision; },
    snapshot: control.snapshot,
    configure(graph) {
      keys = nodeLayerKeys(graph);
      schemas = new Map((graph?.schemas ?? []).map((schema) => [schema.key, schema.types.map((type) => type.key)]));
      const reveal = new Set((graph?.nodes ?? [])
        .filter((node) => !node.typeKey && declaredFiles.has(fileKey(node))).map(nodeLayer));
      declaredFiles = new Set((graph?.nodes ?? []).filter((node) => node.typeKey).map(fileKey));
      control.reconcile((layers) => ({
        ...layers, ...Object.fromEntries([...reveal].map((key) => [key, true])),
      }));
    },
    click(key) {
      control.update((layers) => applyLayerClick(normalize(layers), key, keys, schemas.get(key) ?? [key]));
    },
    reveal(key) {
      if (control.value[key] === false) control.update((layers) => ({ ...layers, [key]: true }));
    },
  };
}
