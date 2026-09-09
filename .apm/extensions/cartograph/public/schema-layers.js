import { escapeHtml } from "./markdown.js";
import { layerCounts } from "./node-layers.js";

export function mountSchemaLayers(container, diagnostics) {
  let structure = "";
  return {
    render(graph, layers) {
      const schemas = graph?.schemas ?? [];
      const nextStructure = JSON.stringify(schemas);
      if (nextStructure !== structure) {
        structure = nextStructure;
        const focused = container.ownerDocument.activeElement?.getAttribute("data-layer");
        container.innerHTML = schemas.map((schema) => `
          <section class="schema-layer-group">
            <p class="subtle">${escapeHtml(schema.atlasLabel || schema.atlasKey)} [${escapeHtml(schema.atlasKey)}]</p>
            <button class="layer" type="button" data-layer="${escapeHtml(schema.key)}"></button>
            <p class="subtle">${schema.origin === "core" ? "Base schema" : "Installed contribution"} · ${escapeHtml(schema.source)}</p>
            <div class="layers">${schema.types.map((type) =>
              `<button class="layer" type="button" data-layer="${escapeHtml(type.key)}"></button>`).join("")}</div>
          </section>`).join("");
        if (focused) {
          const replacement = [...container.querySelectorAll("[data-layer]")]
            .find((button) => button.getAttribute("data-layer") === focused);
          (replacement || container.ownerDocument.querySelector('[data-layer="all"]'))?.focus();
        }
      }
      const counts = layerCounts(graph);
      const buttons = new Map([...container.querySelectorAll("[data-layer]")]
        .map((button) => [button.getAttribute("data-layer"), button]));
      for (const schema of schemas) {
        const enabled = schema.types.filter((type) => layers?.[type.key] !== false).length;
        const button = buttons.get(schema.key);
        const total = schema.types.reduce((sum, type) => sum + (counts.get(type.key) ?? 0), 0);
        button.textContent = `${schema.label} · ${total}`;
        button.disabled = schema.types.length === 0;
        button.setAttribute("aria-pressed", enabled === 0 ? "false" : enabled === schema.types.length ? "true" : "mixed");
        button.classList.toggle("active", enabled > 0);
        for (const type of schema.types) {
          const item = buttons.get(type.key);
          item.textContent = `${type.id} · ${counts.get(type.key) ?? 0}`;
          item.setAttribute("aria-pressed", String(layers?.[type.key] !== false));
          item.classList.toggle("active", layers?.[type.key] !== false);
        }
      }
      const messages = graph?.schemaDiagnostics ?? [];
      diagnostics.classList.toggle("hidden", !messages.length);
      diagnostics.textContent = messages.map((item) =>
        `${item.atlasLabel || item.atlasKey} [${item.atlasKey}] · ${item.source}: ${item.message}`).join("\n");
    },
  };
}
