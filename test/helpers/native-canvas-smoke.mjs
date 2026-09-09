import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { registration, setMetadata } from "./native-canvas-sdk.mjs";

// Only the SDK transport is substituted. Load the unmodified package entrypoint,
// real discovery, actions, watchers and server; never start an OS collector.
const runtime = resolve(process.argv[2]);
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "cartograph-native-")));
const previousCwd = process.cwd();
const opened = new Map();
let canvas;

function workspace(name) {
  const cwd = join(scratch, name);
  mkdirSync(cwd);
  return cwd;
}

function store(cwd, name, id) {
  const root = join(cwd, name);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "SCHEMA.json"), JSON.stringify({
    atlas_id: id, templates: { by_type: { observation: {}, instrument: {} } },
  }));
  writeFileSync(join(root, "index.md"), "# Observatory\n");
  writeFileSync(join(root, "signal.md"), "---\ntitle: Signal\ntype: observation\n---\n\n[[index]]\n");
  return root;
}

function context(instanceId, cwd, input = {}, sessionId = "observatory-session") {
  return {
    sessionId, extensionId: "project:cartograph", canvasId: "cartograph",
    instanceId, input, ...(cwd === undefined ? {} : { session: { workingDirectory: cwd } }),
  };
}

async function open(ctx) {
  const result = await canvas.open(ctx);
  opened.set(ctx.instanceId, ctx);
  assert.equal(result.title, "Cartograph");
  return result;
}

async function action(ctx, name, input) {
  const handler = canvas.actions.find((item) => item.name === name)?.handler;
  assert.equal(typeof handler, "function", `Native action ${name} is registered`);
  return handler({ ...ctx, actionName: name, input });
}

async function rejected(ctx, expected) {
  await assert.rejects(canvas.open(ctx), expected);
  await assert.rejects(action(ctx, "get_state"), { code: "not_open" });
}

try {
  for (const name of ["ATLAS_ROOT", "ATLAS_VIEWER_ROOT", "OKF_WIKI_ROOT", "ATLAS_PRESETS"]) delete process.env[name];
  process.chdir(runtime);
  await import(pathToFileURL(join(runtime, "extension.mjs")));
  canvas = registration.canvas;
  assert.equal(registration.calls, 1);
  assert.equal(registration.metadataCalls, 0, "Registration does not need metadata or hook events");
  assert.equal(canvas.id, "cartograph");
  assert.equal(canvas.displayName, "Cartograph");
  assert.equal(typeof canvas.onClose, "function");

  const east = workspace("east");
  const west = workspace("west");
  const empty = workspace("empty");
  const first = store(east, ".atlas/observatory/optical", "optical");
  const second = store(east, ".atlas/observatory/radio", "radio");
  const western = store(west, ".atlas/observatory/infrared", "infrared");
  const chosen = store(east, "chosen store", "chosen");
  const ctx = context("east-map", east);
  setMetadata(new Error("Metadata must not be called when callback cwd is supplied"));
  const initial = await open(ctx);
  assert.equal(registration.metadataCalls, 0);
  let state = await action(ctx, "get_state");
  assert.equal(state.error, null);
  assert.equal(state.nodeCount, 4);
  assert.equal(new Set(state.nodes.map((node) => node.id)).size, 4);
  assert.equal(state.schemas.length, 2);
  assert.equal(state.activity.scope.mode, "session");
  assert.equal(state.activity.scope.rootPid, process.ppid);
  assert.ok(state.activity.scope.excludePids.includes(process.pid));
  assert.equal(state.activity.provider.id, "macos-eslogger");
  assert.notEqual(state.activity.collector.status, "live");
  const response = await fetch(new URL("/api/bootstrap", initial.url), {
    headers: { "X-Cartograph-Client": "canvas" },
  });
  assert.equal(response.status, 200);
  const bootstrap = await response.json();
  assert.deepEqual(bootstrap.state.roots, [first, second]);
  assert.ok(!bootstrap.state.roots.some((root) => root.startsWith(runtime)));

  const signal = state.nodes.find((node) => node.title === "Signal");
  await action(ctx, "set_query", { query: "Signal" });
  await action(ctx, "select_node", { nodeId: signal.id });
  const layerResult = await action(ctx, "set_layers", { layers: { [signal.typeKey]: false } });
  await action(ctx, "reload");
  state = await action(ctx, "get_state");
  assert.equal(state.query, "Signal");
  assert.equal(state.selectedId, signal.id);
  assert.equal(state.layers[signal.typeKey], false);
  assert.equal(state.page.title, "Signal");
  assert.equal(state.layersRevision, layerResult.layersRevision);

  // A different caller context cannot inherit a previous open's workspace.
  const westCtx = context("west-map", west, {}, "infrared-session");
  await open(westCtx);
  assert.equal((await action(westCtx, "get_state")).root, western);
  assert.equal(registration.metadataCalls, 0);
  assert.equal((await open(context("east-map", west))).url, initial.url, "Focus preserves the existing instance");
  assert.equal((await action(ctx, "get_state")).nodeCount, 4);
  assert.equal((await action(ctx, "get_state")).selectedId, signal.id);

  setMetadata({ sessionId: ctx.sessionId, workingDirectory: west });
  const metadataCtx = context("metadata-map");
  await open(metadataCtx);
  assert.equal((await action(metadataCtx, "get_state")).root, western);
  setMetadata({ sessionId: ctx.sessionId, workingDirectory: east });
  const refreshedCtx = context("fresh-metadata-map");
  await open(refreshedCtx);
  assert.equal((await action(refreshedCtx, "get_state")).nodeCount, 4, "No cross-open metadata cache");

  for (const root of ["./chosen store", chosen]) {
    const explicitCtx = context(`explicit-${opened.size}`, east, { root, skipIntro: true });
    await open(explicitCtx);
    assert.equal((await action(explicitCtx, "get_state")).root, chosen);
    await action(explicitCtx, "open_atlas", { root: ".atlas/observatory/optical" });
    assert.equal((await action(explicitCtx, "get_state")).root, first);
  }
  const missingRootCtx = context("missing-root", east, { root: "missing" });
  await open(missingRootCtx);
  assert.equal((await action(missingRootCtx, "get_state")).root, join(east, "missing"));
  assert.ok((await action(missingRootCtx, "get_state")).error);
  const pickerCtx = context("picker", empty);
  await open(pickerCtx);
  assert.equal((await action(pickerCtx, "get_state")).phase, "welcome");
  assert.equal((await action(pickerCtx, "get_state")).nodeCount, 0);

  const beforeOtherCaller = registration.metadataCalls;
  await rejected(context("other-caller", undefined, {}, "other-session"), { code: "workspace_unavailable" });
  assert.equal(registration.metadataCalls, beforeOtherCaller, "Never query joined metadata for a different caller");
  setMetadata({ sessionId: "other-session", workingDirectory: west });
  await rejected(context("mismatch"), { code: "workspace_unavailable" });
  for (const metadata of [undefined, {}, { sessionId: ctx.sessionId }]) {
    setMetadata(metadata);
    await rejected(context("missing-metadata"), { code: "workspace_unavailable" });
    await rejected(context("explicit-without-workspace", undefined, { root: chosen }), { code: "workspace_unavailable" });
  }
  const rpcFailure = new Error("Synthetic metadata RPC failure");
  setMetadata(rpcFailure);
  await rejected(context("rpc-failure"), (error) => error === rpcFailure);
  const beforeInvalid = registration.metadataCalls;
  for (const cwd of ["", null, 42, ".", "relative/workspace"]) {
    await rejected(context("invalid-context", cwd), { code: "workspace_unavailable" });
  }
  assert.equal(registration.metadataCalls, beforeInvalid, "Invalid context cannot fall through to metadata");
  await rejected(context("missing-directory", join(scratch, "missing")), { code: "ENOENT" });
  await rejected(context("file-directory", join(first, "index.md")), { code: "invalid_workspace" });
  await rejected(context("installed-directory", runtime), { code: "invalid_workspace" });
  const cache = join(scratch, "apm_modules", "observatory");
  mkdirSync(cache, { recursive: true });
  symlinkSync(runtime, join(scratch, "runtime-alias"), "dir");
  symlinkSync(cache, join(scratch, "cache-alias"), "dir");
  for (const cwd of [cache, join(scratch, "runtime-alias"), join(scratch, "cache-alias")]) {
    await rejected(context("installed-alias", cwd), { code: "invalid_workspace" });
  }
  setMetadata({ sessionId: ctx.sessionId, workingDirectory: runtime });
  await rejected(context("installed-metadata"), { code: "invalid_workspace" });
  process.chdir(east);
  setMetadata(undefined);
  await rejected(context("no-process-fallback"), { code: "workspace_unavailable" });

  if (process.platform !== "win32" && process.getuid?.() !== 0) {
    const denied = workspace("denied");
    mkdirSync(join(denied, "nested"));
    chmodSync(denied, 0);
    try {
      await rejected(context("denied-workspace", join(denied, "nested")), { code: "EACCES" });
    } finally {
      chmodSync(denied, 0o700);
    }
  }

  for (const [id, activeCtx] of opened) {
    await canvas.onClose(activeCtx);
    opened.delete(id);
    await assert.rejects(action(activeCtx, "get_state"), { code: "not_open" });
  }
  console.log("Native entrypoint contract passed (synthetic SDK transport; real-host acceptance remains separate).");
} finally {
  for (const ctx of opened.values()) await canvas.onClose(ctx);
  process.chdir(previousCwd);
  rmSync(scratch, { recursive: true, force: true });
}
