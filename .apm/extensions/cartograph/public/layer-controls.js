import { createStateControls } from "./state-controls.js";

const NODE_LAYER_KEYS = ["experiences", "decisions", "work", "indexes", "other"];
const NODE_LAYER_BUTTONS = ["experiences", "decisions", "work", "indexes"];
const LAYER_KEYS = [...NODE_LAYER_KEYS, "relations", "sources"];

export function allNodeLayersOn(layers) {
  return NODE_LAYER_KEYS.every((key) => layers?.[key] !== false);
}

export function applyLayerClick(layers, key) {
  const next = { ...layers };
  if (key === "all") {
    for (const k of NODE_LAYER_KEYS) next[k] = true;
    return next;
  }
  if (key === "relations" || key === "sources") {
    next[key] = layers?.[key] === false;
    return next;
  }
  if (allNodeLayersOn(layers)) {
    for (const k of NODE_LAYER_BUTTONS) next[k] = k === key;
    next.other = false;
    return next;
  }
  next[key] = layers?.[key] === false;
  if (NODE_LAYER_BUTTONS.every((k) => next[k] === false)) next[key] = true;
  return next;
}

function normalize(layers) {
  return Object.fromEntries(LAYER_KEYS.map((key) => [key, layers?.[key] !== false]));
}

export function createLayerControls(send, onChange) {
  const control = createStateControls({
    field: "layers", initial: {}, normalize,
    isValid: (value) => value !== null && typeof value === "object" && !Array.isArray(value),
  }, send, onChange);

  return {
    get layersRevision() { return control.revision; },
    snapshot: control.snapshot,
    click(key) { control.update((layers) => applyLayerClick(layers, key)); },
    reveal(key) {
      if (control.value[key] === false) control.update((layers) => ({ ...layers, [key]: true }));
    },
  };
}
