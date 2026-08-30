// Extension: cartograph
// Cartograph Atlas knowledge-graph viewer as a Copilot App Canvas.

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { joinSession, createCanvas, CanvasError } from "@github/copilot-sdk/extension";
import {
  defaultRoot,
  freshState,
  hydrateStores,
  openAtlas,
  selectNode,
  startServer,
} from "./server.mjs";
import { EXTENSION_ROOT } from "./atlas/catalog.mjs";
import { answerQuery } from "./atlas/chat.mjs";

const instances = new Map();
let sessionCwd = "";

function isInstallDir(p) {
  if (!p) return false;
  const abs = resolve(p);
  return abs === EXTENSION_ROOT || abs.startsWith(`${EXTENSION_ROOT}/`);
}

function firstRealCwd(...candidates) {
  for (const c of candidates) {
    if (!c || !existsSync(c) || isInstallDir(c)) continue;
    return resolve(c);
  }
  return "";
}

async function resolveCwd(ctx) {
  let snapCwd = "";
  try {
    snapCwd = (await session.rpc.metadata.snapshot())?.workingDirectory || "";
  } catch {
    /* rpc not ready */
  }
  return (
    firstRealCwd(ctx?.session?.workingDirectory, snapCwd, sessionCwd) ||
    sessionCwd ||
    (isInstallDir(process.cwd()) ? "" : process.cwd())
  );
}

function requireEntry(instanceId) {
  const entry = instances.get(instanceId);
  if (!entry) throw new CanvasError("not_open", "Cartograph canvas instance is not open.");
  return entry;
}

const session = await joinSession({
  hooks: {
    onSessionStart: async ({ workingDirectory }) => {
      if (workingDirectory && !isInstallDir(workingDirectory)) sessionCwd = workingDirectory;
    },
    onUserPromptSubmitted: async ({ workingDirectory }) => {
      if (workingDirectory && !isInstallDir(workingDirectory)) sessionCwd = workingDirectory;
    },
  },
  canvases: [
    createCanvas({
      id: "cartograph",
      displayName: "Cartograph",
      description:
        "Atlas knowledge-graph viewer: crawl, welcome gate, hyperspace jump, and star-map of a mounted atlas/ or fixtures/mini-atlas.",
      inputSchema: {
        type: "object",
        properties: {
          root: {
            type: "string",
            description: "Atlas store root (absolute or repo-relative). Defaults to atlas/ or fixtures/mini-atlas.",
          },
          skipIntro: {
            type: "boolean",
            description: "Skip crawl and hyperspace jump and open the map immediately.",
          },
        },
        additionalProperties: false,
      },
      actions: [
        {
          name: "open_atlas",
          description: "Open an Atlas store root and show it on the star map.",
          inputSchema: {
            type: "object",
            properties: { root: { type: "string", minLength: 1 } },
            required: ["root"],
            additionalProperties: false,
          },
          handler: async (ctx) => {
            const entry = requireEntry(ctx.instanceId);
            entry.state.phase = "jump";
            openAtlas(entry.state, ctx.input.root);
            entry.broadcast();
            return {
              ok: true,
              root: entry.state.root,
              available: Boolean(entry.state.graph?.store?.available),
              nodes: entry.state.graph?.nodes?.length ?? 0,
              error: entry.state.error,
            };
          },
        },
        {
          name: "select_node",
          description: "Select a graph node by id and open its page preview.",
          inputSchema: {
            type: "object",
            properties: { nodeId: { type: "string", minLength: 1 } },
            required: ["nodeId"],
            additionalProperties: false,
          },
          handler: async (ctx) => {
            const entry = requireEntry(ctx.instanceId);
            selectNode(entry.state, ctx.input.nodeId);
            entry.broadcast();
            return {
              ok: true,
              selectedId: entry.state.selectedId,
              title: entry.state.page?.title ?? null,
            };
          },
        },
        {
          name: "set_query",
          description: "Filter the star map by title or id substring.",
          inputSchema: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
            additionalProperties: false,
          },
          handler: async (ctx) => {
            const entry = requireEntry(ctx.instanceId);
            entry.state.query = String(ctx.input.query ?? "");
            entry.broadcast();
            return { ok: true, query: entry.state.query };
          },
        },
        {
          name: "get_state",
          description: "Return the current Cartograph canvas state (root, graph summary, selection).",
          handler: async (ctx) => {
            const entry = requireEntry(ctx.instanceId);
            const g = entry.state.graph;
            return {
              phase: entry.state.phase,
              root: entry.state.root,
              query: entry.state.query,
              selectedId: entry.state.selectedId,
              error: entry.state.error,
              store: g?.store ?? null,
              nodeCount: g?.nodes?.length ?? 0,
              edgeCount: g?.edges?.length ?? 0,
              page: entry.state.page
                ? {
                    id: entry.state.page.id,
                    title: entry.state.page.title,
                    relatesTo: entry.state.page.relatesTo,
                    sources: entry.state.page.sources,
                  }
                : null,
              nodes: (g?.nodes ?? []).map((n) => ({ id: n.id, title: n.title, kind: n.kind })),
            };
          },
        },
        {
          name: "reload",
          description: "Rescan the current Atlas root and refresh the graph.",
          handler: async (ctx) => {
            const entry = requireEntry(ctx.instanceId);
            hydrateStores(entry.state);
            if (entry.state.root) openAtlas(entry.state, entry.state.root);
            entry.broadcast();
            return {
              ok: true,
              root: entry.state.root,
              nodeCount: entry.state.graph?.nodes?.length ?? 0,
            };
          },
        },
      ],
      open: async (ctx) => {
        let entry = instances.get(ctx.instanceId);
        if (!entry) {
          const input = ctx.input && typeof ctx.input === "object" ? ctx.input : {};
          const cwd = await resolveCwd(ctx);
          const state = freshState(cwd, input);
          hydrateStores(state);
          const root = input.root || defaultRoot(state.cwd);
          if (root) openAtlas(state, root);
          if (state.graph?.store?.available) {
            state.phase = input.skipIntro === false ? "jump" : "map";
          } else {
            state.phase = "welcome";
          }
          try {
            await session.log(
              `Cartograph cwd ${cwd || "(none)"} · ${state.stores.filter((s) => s.available).length} stores`,
              { ephemeral: true },
            );
          } catch {
            /* ignore */
          }
          entry = await startServer(ctx.instanceId, state, {
            onChat: async (text, st) => answerQuery(st, text),
          });
          instances.set(ctx.instanceId, entry);
        }
        return {
          title: "Cartograph",
          url: entry.url,
          status: entry.state.graph?.store?.available
            ? `${entry.state.graph.nodes.length} nodes`
            : "ready",
        };
      },
      onClose: async (ctx) => {
        const entry = instances.get(ctx.instanceId);
        if (!entry) return;
        instances.delete(ctx.instanceId);
        for (const res of entry.clients) res.end();
        await new Promise((resolve) => entry.server.close(() => resolve()));
      },
    }),
  ],
});
