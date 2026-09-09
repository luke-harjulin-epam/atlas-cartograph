// Extension: cartograph
// Cartograph Atlas knowledge-graph viewer as a Copilot App Canvas.

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { joinSession, createCanvas, CanvasError } from "@github/copilot-sdk/extension";
import {
  freshState,
  hydrateStores,
  openAtlas,
  openAtlases,
  openDefaultAtlases,
  selectNode,
  setQuery,
  setLayers,
  startServer,
} from "./server.mjs";
import { EXTENSION_ROOT } from "./atlas/catalog.mjs";
import { answerQuery } from "./atlas/chat.mjs";
import { MIN_DURATION_MS, MAX_DURATION_MS } from "./activity/model.mjs";
import { monitorProviders } from "./activity/providers/index.mjs";
import { isPathWithin } from "./paths.mjs";

const instances = new Map();
let sessionCwd = "";

function isInstallDir(p) {
  if (!p) return false;
  return isPathWithin(EXTENSION_ROOT, p);
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
        "Atlas knowledge-graph viewer. Opens all recognized stores beneath the current project's .atlas/ together, or shows the store picker when none are found.",
      inputSchema: {
        type: "object",
        properties: {
          root: {
            type: "string",
            description: "Explicit Atlas store root (absolute or project-relative), overriding automatic discovery under the current project's .atlas/. The sample is only opened when selected explicitly.",
          },
          skipIntro: {
            type: "boolean",
            description: "Skip crawl and hyperspace jump and open the map immediately.",
          },
          activityDurationMs: {
            type: "integer",
            minimum: MIN_DURATION_MS,
            maximum: MAX_DURATION_MS,
            description: "File-access highlight lifetime in milliseconds (default 5000).",
          },
          monitorProvider: {
            type: "string",
            enum: monitorProviders.ids(),
            description: "Registered filesystem monitor implementation (default macos-eslogger).",
          },
        },
        additionalProperties: false,
      },
      actions: [
        {
          name: "set_layers",
          description: "Set node type or relationship layers using keys from get_state. Omitted keys retain their values.",
          inputSchema: {
            type: "object",
            properties: { layers: { type: "object", additionalProperties: { type: "boolean" } } },
            required: ["layers"],
            additionalProperties: false,
          },
          handler: async (ctx) => {
            const entry = requireEntry(ctx.instanceId);
            setLayers(entry.state, ctx.input.layers);
            entry.broadcast();
            return { layers: entry.state.layers, layersRevision: entry.state.layersRevision };
          },
        },
        {
          name: "configure_activity",
          description: "Enable or pause file-access highlighting and set its lifetime (default 5000 ms).",
          inputSchema: {
            type: "object",
            properties: {
              enabled: { type: "boolean" },
              durationMs: { type: "integer", minimum: MIN_DURATION_MS, maximum: MAX_DURATION_MS },
            },
            additionalProperties: false,
          },
          handler: async (ctx) => requireEntry(ctx.instanceId).activity.configure(ctx.input ?? {}),
        },
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
              activity: entry.activity.sync(),
              graphWatch: entry.state.graphWatch,
              graphChanges: entry.state.graphChanges,
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
            setQuery(entry.state, ctx.input.query);
            entry.broadcast();
            return { ok: true, query: entry.state.query, queryRevision: entry.state.queryRevision };
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
              queryRevision: entry.state.queryRevision,
              selectedId: entry.state.selectedId,
              error: entry.state.error,
              layers: entry.state.layers,
              layersRevision: entry.state.layersRevision,
              schemas: g?.schemas ?? [],
              schemaDiagnostics: g?.schemaDiagnostics ?? [],
              activity: entry.activity.sync(),
              graphWatch: entry.state.graphWatch,
              graphChanges: entry.state.graphChanges,
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
              nodes: (g?.nodes ?? []).map((n) => ({
                id: n.id, title: n.title, kind: n.kind, type: n.type, declaredType: n.declaredType,
                typeKey: n.typeKey, schemaKey: n.schemaKey, schemaLabel: n.schemaLabel, atlasKey: n.atlasKey,
              })),
            };
          },
        },
        {
          name: "reload",
          description: "Rescan the mounted Atlas stores and refresh the combined graph.",
          handler: async (ctx) => {
            const entry = requireEntry(ctx.instanceId);
            openAtlases(entry.state, entry.state.roots, { strict: true });
            hydrateStores(entry.state);
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
          openDefaultAtlases(state, input);
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
            activity: {
              scope: { mode: "session", rootPid: process.ppid, excludePids: [process.pid] },
            },
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
        await entry.close();
      },
    }),
  ],
});
