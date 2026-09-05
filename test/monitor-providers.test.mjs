import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";
import { runCollector, parseCollectorArgs } from "../src/activity/collector.mjs";
import { CollectorError } from "../src/activity/protocol.mjs";
import { esloggerProvider, parseEsloggerLine } from "../src/activity/providers/eslogger.mjs";
import {
  createMonitorRegistry, DEFAULT_MONITOR_PROVIDER, monitorMetadata, monitorProviders,
  validateMonitorProvider,
} from "../src/activity/providers/index.mjs";
import { freshState, openAtlas, startServer } from "../src/server.mjs";

const root = fileURLToPath(new URL("../src/fixtures/mini-atlas", import.meta.url));
const tokenEnv = { CARTOGRAPH_ACTIVITY_TOKEN: "synthetic-token" };
const event = { path: join(root, "index.md"), pid: 123, kind: "read" };
const testProvider = {
  metadata: {
    id: "test-component",
    label: "Test component",
    description: "Synthetic cooperating-tool events.",
    permissions: [],
    operations: ["read", "write"],
    setup: {
      title: "Connect a test component",
      description: "Send normalized events to the canvas.",
      steps: ["Authorize this local connection in the component."],
      notice: "No administrator approval required.",
    },
  },
  availability: () => ({ supported: true, message: "" }),
  waitingMessage: "Waiting for the test component.",
  createConnection: () => ({ command: null }),
  stream: {
    parseLine(line) {
      try {
        return { type: "event", valid: true, event: JSON.parse(line) };
      } catch {
        throw new CollectorError("Malformed test component input.");
      }
    },
    messages: {
      limitations: "Only cooperating-tool events are observed.",
      waiting: "Waiting for component events.",
      ended: "Component disconnected.",
      emptyEnd: "Component ended without events.",
      inputError: "Component input failed.",
      closed: "Component input closed.",
      oversizedLine: "Component input exceeds the size limit.",
    },
  },
};

async function service(t, { provider = testProvider, providerId, platform = "linux", both = false } = {}) {
  const registry = createMonitorRegistry(both ? [esloggerProvider, provider] : [provider], provider.metadata.id);
  const state = freshState(root, { skipIntro: true });
  openAtlas(state, root);
  const entry = await startServer("provider-test", state, { activity: { registry, providerId, platform } });
  t.after(() => entry.close());
  const request = (path, options) => fetch(new URL(path, entry.url), options);
  const response = await request("/api/activity/connection", { headers: { "X-Cartograph-Client": "canvas" } });
  const connection = await response.json();
  return { entry, request, response, connection, registry };
}

async function waitFor(condition) {
  const deadline = Date.now() + 2500;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("Provider integration timed out.");
    await delay(5);
  }
}

test("eslogger remains the only shipped provider and unchanged default", () => {
  assert.equal(DEFAULT_MONITOR_PROVIDER, "macos-eslogger");
  assert.deepEqual(monitorProviders.ids(), ["macos-eslogger"]);
  assert.equal(monitorProviders.get(), esloggerProvider);
  assert.equal(esloggerProvider.stream.parseLine, parseEsloggerLine);
  assert.deepEqual(esloggerProvider.metadata.permissions, ["administrator", "full-disk-access"]);
  assert.equal(esloggerProvider.availability("darwin").supported, true);
  assert.equal(esloggerProvider.availability("linux").supported, false);
  const oldArgs = parseCollectorArgs(["--url", "http://127.0.0.1:9999/"], tokenEnv);
  assert.equal(oldArgs.providerId, DEFAULT_MONITOR_PROVIDER);
  const explicit = parseCollectorArgs(["--url", "http://127.0.0.1:9999/", "--provider", "macos-eslogger"], tokenEnv);
  assert.equal(explicit.providerId, oldArgs.providerId);
});

test("registry supports multiple implementations without silently switching defaults", () => {
  const registry = createMonitorRegistry([esloggerProvider, testProvider], DEFAULT_MONITOR_PROVIDER);
  assert.equal(registry.get(), esloggerProvider);
  assert.equal(registry.get("test-component"), testProvider);
  assert.throws(() => registry.get("missing"), /Unknown monitor provider/);
  assert.throws(() => createMonitorRegistry([testProvider, testProvider], "test-component"), /Duplicate/);
  assert.throws(() => createMonitorRegistry([testProvider], "missing"), /Unknown default/);
  assert.throws(() => validateMonitorProvider({ ...testProvider, metadata: { ...testProvider.metadata, id: undefined } }), /Invalid/);
  assert.throws(() => validateMonitorProvider({ ...testProvider, createConnection: null }), /Invalid/);
  assert.throws(() => validateMonitorProvider({ ...testProvider, stream: {} }), /Invalid stream/);
  assert.throws(() => validateMonitorProvider({
    ...testProvider, metadata: { ...testProvider.metadata, processScopes: ["unknown"] },
  }), /Invalid/);
  assert.throws(() => parseCollectorArgs(["--url", "http://127.0.0.1/", "--provider", "missing"], tokenEnv, registry), /Unknown monitor/);
  assert.throws(() => parseCollectorArgs(["--url", "http://127.0.0.1/", "--url", "http://127.0.0.1/"], tokenEnv), /Usage/);
});

test("providers without ancestry support cannot silently enable session scope", async () => {
  const registry = createMonitorRegistry([testProvider], testProvider.metadata.id);
  const state = freshState(root);
  await assert.rejects(startServer("unsupported-scope", state, {
    activity: { registry, scope: { mode: "session", rootPid: 400, excludePids: [] } },
  }), /does not support session process scope/);
});

test("metadata copies only public fields and never implementation objects", () => {
  const provider = { ...testProvider, metadata: { ...testProvider.metadata, token: "not-public" } };
  const metadata = monitorMetadata(provider);
  assert.ok(!JSON.stringify(metadata).includes("not-public"));
  assert.equal(metadata.createConnection, undefined);
  metadata.setup.steps.push("local mutation");
  metadata.permissions.push("root");
  assert.equal(testProvider.metadata.setup.steps.length, 1);
  assert.deepEqual(testProvider.metadata.permissions, []);
});

test("service setup and availability come from the selected provider, not macOS assumptions", async (t) => {
  const { entry, request, response, connection } = await service(t);
  assert.equal(response.status, 200);
  assert.equal(connection.command, null);
  assert.equal(connection.providerId, "test-component");
  const activity = entry.state.activity;
  assert.equal(activity.provider.label, "Test component");
  assert.deepEqual(activity.provider.permissions, []);
  assert.equal(activity.collector.status, "waiting");
  assert.equal(activity.collector.message, testProvider.waitingMessage);
  assert.ok(!JSON.stringify(activity).includes("macOS"));
  const targets = await (await request("/api/activity/targets", { headers: { Authorization: `Bearer ${connection.token}` } })).json();
  assert.equal(targets.providerId, "test-component");
  assert.ok(targets.paths.includes(event.path));
});

test("a selected unavailable provider does not fall back to another registered monitor", async (t) => {
  const { entry, response } = await service(t, { both: true, providerId: DEFAULT_MONITOR_PROVIDER });
  assert.equal(response.status, 409);
  assert.equal(entry.state.activity.provider.id, DEFAULT_MONITOR_PROVIDER);
  assert.equal(entry.state.activity.collector.status, "unsupported");
});

test("a direct-reporting component needs no stream parser or privileged collector", async (t) => {
  const { stream, ...provider } = testProvider;
  const { entry, connection, request } = await service(t, { provider });
  const response = await request("/api/activity/events", {
    method: "POST",
    headers: { Authorization: `Bearer ${connection.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ status: "live", events: [event] }),
  });
  assert.deepEqual(await response.json(), { ok: true, accepted: 1 });
  assert.equal(entry.state.activity.nodes[0].id, "index");
  assert.equal(entry.state.activity.collector.status, "live");
  await assert.rejects(runCollector({ provider, url: entry.url, token: connection.token }), /reports directly/);
});

test("an alternate parser uses the same scoped transport, highlighting, and shutdown", async (t) => {
  const { entry, connection } = await service(t);
  const input = new PassThrough();
  const abort = new AbortController();
  let diagnostics = "";
  const running = runCollector({
    provider: testProvider, url: entry.url, token: connection.token,
    input, signal: abort.signal, refreshMs: 20, heartbeatMs: 25, flushMs: 5,
    stderr: { write: (text) => { diagnostics += text; } },
  });
  t.after(async () => { abort.abort(); await running; });
  input.write(`${JSON.stringify(event)}\n`);
  input.write(`${JSON.stringify({ ...event, path: "/foreign/private.md" })}\n`);
  await waitFor(() => entry.state.activity.nodes.length === 1);
  assert.equal(entry.state.activity.collector.status, "live");
  assert.equal(entry.state.activity.nodes[0].id, "index");
  assert.equal(entry.state.activity.collector.message, testProvider.stream.messages.limitations);
  input.end();
  assert.equal((await running).status, "disconnected");
  assert.equal(entry.state.activity.collector.message, testProvider.stream.messages.ended);
  assert.ok(!diagnostics.includes("eslogger"));
  assert.ok(!diagnostics.includes("private.md"));
});

test("invalid alternate adapter output is rejected before reporting live", async (t) => {
  const { entry, connection } = await service(t);
  const provider = { ...testProvider, stream: { ...testProvider.stream, parseLine: () => ({ type: "event", valid: true, event: { ...event, kind: "open" } }) } };
  const input = new PassThrough();
  const running = runCollector({ provider, url: entry.url, token: connection.token, input, stderr: { write() {} } });
  input.end("trigger\n");
  assert.equal((await running).status, "error");
  assert.deepEqual(entry.state.activity.nodes, []);
  assert.match(entry.state.activity.collector.message, /invalid normalized event/);
});

test("collector rejects a provider mismatch rather than misinterpreting another monitor's stream", async (t) => {
  const { entry, connection } = await service(t);
  const result = await runCollector({
    provider: esloggerProvider, url: entry.url, token: connection.token,
    input: new PassThrough(), stderr: { write() {} },
  });
  assert.equal(result.status, "error");
  assert.deepEqual(entry.state.activity.nodes, []);
  assert.match(entry.state.activity.collector.message, /different monitor provider/);
});
