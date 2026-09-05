export const NODE_PAGE_SIZE = 25;

function describeNode(node, state) {
  const store = state.stores?.find((item) => item.root === node.storeRoot) || state.graph?.store;
  const atlas = node.atlasLabel || store?.label || node.atlasKey || store?.atlasId || "Atlas";
  const key = node.atlasKey || store?.atlasId;
  const root = node.storeRoot || store?.root || state.root;
  return `${node.title || node.id} · ${node.kind || "page"} · Atlas: ${atlas}${key && key !== atlas ? ` [${key}]` : ""}${root ? ` (${root})` : ""} · ${node.path || node.localId || node.id}`;
}

export function mountNodeBrowser(panel, toggle, actions) {
  const doc = panel.ownerDocument;
  const get = (id) => panel.querySelector(`#${id}`);
  const filter = get("node-filter");
  const list = get("node-list");
  const count = get("node-count");
  const selected = get("node-selected");
  const preview = get("node-preview");
  const clear = get("node-clear");
  const previous = get("node-previous");
  const next = get("node-next");
  const error = get("node-error");
  let state = {};
  let layerFor = () => "";
  let page = 0;
  let open = false;
  const rows = new Map();

  function text(element, value) {
    if (element.textContent !== value) element.textContent = value;
  }

  function render() {
    const nodes = state.graph?.nodes || [];
    const query = filter.value.trim().toLowerCase();
    const matches = nodes.filter((node) =>
      !query || `${describeNode(node, state)} ${node.id}`.toLowerCase().includes(query));
    const active = doc.activeElement;
    const focusedId = active?.getAttribute("data-browse-node");
    const focusedIndex = matches.findIndex((node) => node.id === focusedId);
    if (focusedIndex >= 0) page = Math.floor(focusedIndex / NODE_PAGE_SIZE);
    const pages = Math.max(1, Math.ceil(matches.length / NODE_PAGE_SIZE));
    page = Math.max(0, Math.min(page, pages - 1));
    const start = page * NODE_PAGE_SIZE;
    const shown = matches.slice(start, start + NODE_PAGE_SIZE);
    text(count, matches.length
      ? `${matches.length} of ${nodes.length} nodes. Showing ${start + 1}–${start + shown.length}. Page ${page + 1} of ${pages}.`
      : `No results. 0 of ${nodes.length} nodes.`);
    const selectedNode = nodes.find((node) => node.id === state.selectedId);
    text(selected, selectedNode ? `Selected: ${describeNode(selectedNode, state)}` : "No node selected.");
    preview.disabled = clear.disabled = !selectedNode;
    previous.disabled = page === 0;
    next.disabled = page === pages - 1;

    const visible = new Set(shown.map((node) => node.id));
    const scroll = list.scrollTop;
    for (const [id, row] of rows) {
      if (!visible.has(id)) {
        row.remove();
        rows.delete(id);
      }
    }
    shown.forEach((node, index) => {
      let row = rows.get(node.id);
      if (!row) {
        row = doc.createElement("li");
        const button = doc.createElement("button");
        button.type = "button";
        button.setAttribute("data-browse-node", node.id);
        row.append(button);
        rows.set(node.id, row);
      }
      const button = row.firstElementChild;
      const hidden = state.layers?.[layerFor(node.kind)] === false;
      text(button, `${describeNode(node, state)}${hidden ? " · Hidden layer (select to show)" : ""}`);
      button.setAttribute("aria-pressed", String(node.id === state.selectedId));
      if (list.children[index] !== row) list.insertBefore(row, list.children[index] || null);
    });
    list.scrollTop = scroll;
    if (focusedId) {
      const button = rows.get(focusedId)?.firstElementChild;
      if (button && doc.activeElement !== button) button.focus({ preventScroll: true });
      if (!button) filter.focus({ preventScroll: true });
    } else if (active?.disabled && panel.contains(active)) {
      if (active === next && !previous.disabled) previous.focus();
      else if (active === previous && !next.disabled) next.focus();
      else filter.focus();
    }
  }

  function setOpen(value) {
    open = value;
    panel.classList.toggle("hidden", !open);
    toggle.setAttribute("aria-expanded", String(open));
    if (open) {
      render();
      filter.focus();
      if (actions.open) void run(actions.open);
    } else {
      toggle.focus();
    }
  }

  async function run(action) {
    error.classList.add("hidden");
    try {
      await action();
    } catch (cause) {
      text(error, `Node action failed: ${cause.message || cause}`);
      error.classList.remove("hidden");
    }
  }

  toggle.addEventListener("click", () => setOpen(!open));
  get("node-browser-close").addEventListener("click", () => setOpen(false));
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
  });
  filter.addEventListener("input", () => { page = 0; render(); });
  previous.addEventListener("click", () => { page--; render(); });
  next.addEventListener("click", () => { page++; render(); });
  list.addEventListener("click", (event) => {
    const button = event.target.closest("[data-browse-node]");
    if (button && list.contains(button)) void run(() => actions.select(button.getAttribute("data-browse-node")));
  });
  preview.addEventListener("click", () => { void run(actions.preview); });
  clear.addEventListener("click", () => { void run(actions.clear); });

  return {
    setState(nextState, nextLayerFor) {
      state = nextState;
      layerFor = nextLayerFor;
      if (open) render();
    },
    focusSelection() {
      if (open) (rows.get(state.selectedId)?.firstElementChild || filter).focus();
      else toggle.focus();
    },
  };
}
