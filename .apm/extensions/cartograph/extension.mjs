// Extension: cartograph
// Cartograph Atlas knowledge-graph viewer as a Copilot App Canvas.

import { realpathSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { joinSession, createCanvas, CanvasError } from "@github/copilot-sdk/extension";
import {
  freshState,
  hydrateStores,
  openAtlas,
  openDefaultAtlases,
  selectNode,
  setQuery,
  setLayers,
  startServer,
} from "./server.mjs";
import { isInstalledPath } from "./atlas/catalog.mjs";
import { askHostSession } from "./atlas/chat.mjs";
import { MIN_DURATION_MS, MAX_DURATION_MS } from "./activity/model.mjs";
import { monitorProviders } from "./activity/providers/index.mjs";

const instances = new Map();

async function resolveCwd(ctx) {
  let cwd = ctx.session?.workingDirectory;
  if (cwd === undefined) {
    // The joined session's metadata cannot stand in for another caller.
    if (ctx.sessionId !== session.sessionId) {
      throw new CanvasError("workspace_unavailable", "Cartograph requires the caller's working directory.");
    }
    const metadata = await session.rpc.metadata.snapshot();
    if (metadata?.sessionId !== ctx.sessionId) {
      throw new CanvasError("workspace_unavailable", "Cartograph session metadata does not match the caller.");
    }
    cwd = metadata.workingDirectory;
  }
  if (typeof cwd !== "string" || !isAbsolute(cwd)) {
    throw new CanvasError("workspace_unavailable", "Cartograph requires an absolute session working directory. Reopen from a local workspace.");
  }
  if (isInstalledPath(cwd) || isInstalledPath(realpathSync(cwd))) {
    throw new CanvasError("invalid_workspace", "Cartograph cannot use an extension installation or package cache as its workspace.");
  }
  if (!statSync(cwd).isDirectory()) {
    throw new CanvasError("invalid_workspace", "Cartograph's session working directory must be a directory.");
  }
  return resolve(cwd);
}

function requireEntry(instanceId) {
  const entry = instances.get(instanceId);
  if (!entry) throw new CanvasError("not_open", "Cartograph canvas instance is not open.");
  return entry;
}

const session = await joinSession({
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
          name: "update_chat",
          description: "Report a brief task-stage label while working, or deliver an answer/error to the originating Cartograph chat request. Acknowledges delivery; never use transcript text as the reply.",
          inputSchema: {
            type: "object",
            properties: {
              requestId: { type: "string", minLength: 1 },
              status: { type: "string", enum: ["working", "answered", "failed"] },
              text: { type: "string", description: "For working: optional brief, single-line task stage (at most 160 UTF-8 bytes), e.g. Searching the Atlas or Reading pages. For answered/failed: required complete Markdown answer/error (at most 128 KiB)." },
            },
            required: ["requestId", "status"],
            additionalProperties: false,
          },
          handler: async (ctx) => {
            const entry = requireEntry(ctx.instanceId);
            if (ctx.sessionId !== entry.chatSessionId || ctx.sessionId !== session.sessionId) {
              throw new CanvasError("chat_session_mismatch", "Chat replies must come from the session that opened this canvas.");
            }
            try {
              return entry.chat.update(ctx.input.requestId, ctx.input);
            } catch (error) {
              throw new CanvasError(error.code ?? "invalid_chat_reply", error.message);
            }
          },
        },
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
          description: "Search the star map by title, id, Atlas, path, type or kind.",
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
              chatMode: entry.state.chatMode,
              chat: ctx.sessionId === entry.chatSessionId ? entry.state.chat : [],
              page: entry.state.page
                ? {
                    id: entry.state.page.id,
                    title: entry.state.page.title,
                    relatesTo: entry.state.page.relatesTo,
                    sources: entry.state.page.sources,
                    sourceDetails: entry.state.page.sourceDetails,
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
            entry.liveAtlas.syncRoots();
            entry.liveAtlas.refresh();
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
          entry = await startServer(ctx.instanceId, state, {
            onChat: async (text, st, routing) => {
              if (ctx.sessionId !== session.sessionId) {
                throw new Error("Chat is unavailable: this canvas is not owned by the joined session.");
              }
              return askHostSession(session, text, st, routing);
            },
            activity: {
              scope: { mode: "session", rootPid: process.ppid, excludePids: [process.pid] },
            },
          });
          entry.chatSessionId = ctx.sessionId;
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
