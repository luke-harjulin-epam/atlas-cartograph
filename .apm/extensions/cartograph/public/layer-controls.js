const NODE_LAYER_KEYS = ["experiences", "decisions", "work", "indexes", "other"];
const NODE_LAYER_BUTTONS = ["experiences", "decisions", "work", "indexes"];
const LAYER_KEYS = [...NODE_LAYER_KEYS, "relations", "sources"];

export function allNodeLayersOn(layers) {
  return NODE_LAYER_BUTTONS.every((key) => layers?.[key] !== false);
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
  let confirmed = normalize({});
  let desired = confirmed;
  let layersRevision = null;
  let sending = false;
  let intentRevision = 0;

  function accept(layers, revision, acknowledgement = false) {
    if (!layers || typeof layers !== "object") return;
    if (Number.isSafeInteger(revision) && revision >= 0) {
      if (layersRevision !== null && revision <= layersRevision) return;
      layersRevision = revision;
    } else {
      // Legacy servers cannot order snapshots. Protect in-flight intent, but
      // resume idle synchronization. Never downgrade a versioned connection.
      if (layersRevision !== null || (sending && !acknowledgement)) return;
    }
    confirmed = normalize(layers);
  }

  async function flush() {
    if (sending) return;
    sending = true;
    for (;;) {
      const sent = { ...desired };
      const sentRevision = intentRevision;
      let error = null;
      try {
        const next = await send(sent);
        if (!next?.layers || typeof next.layers !== "object") throw new Error("Missing layer confirmation");
        accept(next.layers, next.layersRevision, true);
      } catch (cause) {
        error = `Could not save layers: ${cause.message || cause}.`;
      }
      if (intentRevision === sentRevision) {
        desired = confirmed;
        sending = false;
        onChange({ ...desired }, {
          pending: false,
          error: error ? `${error} Last confirmed view restored; try again.` : null,
        });
        return;
      }
      onChange({ ...desired }, { pending: true, error });
    }
  }

  function update(transform) {
    desired = normalize(transform(desired));
    intentRevision++;
    onChange({ ...desired }, { pending: true, error: null });
    void flush();
  }

  return {
    get layersRevision() { return layersRevision; },
    snapshot(layers, revision) {
      accept(layers, revision);
      if (!sending) desired = confirmed;
      return { ...desired };
    },
    click(key) { update((layers) => applyLayerClick(layers, key)); },
    reveal(key) {
      if (desired[key] === false) update((layers) => ({ ...layers, [key]: true }));
    },
  };
}
