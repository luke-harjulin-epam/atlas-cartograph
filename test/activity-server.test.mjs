import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { freshState, openAtlas, startServer } from "../src/server.mjs";

const root = fileURLToPath(new URL("../src/fixtures/mini-atlas", import.meta.url));
const canvasHeaders = { "X-Cartograph-Client": "canvas" };

async function fixture(t, activityOptions = {}) {
  const state = freshState(root, { skipIntro: true });
  openAtlas(state, root);
  let clock = 10000;
  const entry = await startServer("test", state, { activity: { platform: "darwin", now: () => clock, ...activityOptions } });
  t.after(() => entry.close());
  const request = (path, options) => fetch(new URL(path, entry.url), options);
  const response = await request("/api/activity/connection", { headers: canvasHeaders });
  const connection = await response.json();
  const headers = { Authorization: `Bearer ${connection.token}`, "Content-Type": "application/json" };
  const post = (body) => request("/api/activity/events", { method: "POST", headers, body: JSON.stringify(body) });
  return { state, entry, request, connection, headers, post, advance: (ms) => { clock += ms; } };
}

test("connection tokens require a same-origin canvas request and never enter snapshots", async (t) => {
  const { request, connection } = await fixture(t);
  assert.equal((await request("/api/activity/connection")).status, 403);
  assert.equal((await request("/api/activity/connection", { headers: { ...canvasHeaders, Origin: "https://example.com" } })).status, 403);
  assert.equal((await request("/api/activity/connection", { headers: { ...canvasHeaders, "Sec-Fetch-Site": "cross-site" } })).status, 403);
  assert.equal((await request("/api/activity/targets")).status, 401);
  assert.equal((await request("/api/activity/targets", { headers: { Authorization: "Bearer wrong" } })).status, 401);
  assert.match(connection.command, /^sudo \/usr\/bin\/eslogger open close \| CARTOGRAPH_ACTIVITY_TOKEN=/);
  assert.match(connection.command, / \/usr\/bin\/env node '[^']+\/src\/activity\/collector\.mjs' --url /);
  assert.ok(!connection.command.includes(process.execPath));
  const boot = await (await request("/api/bootstrap")).text();
  assert.ok(!boot.includes(connection.token));
});

test("collector events are scoped, refresh highlights, and do not change selection", async (t) => {
  const { state, entry, post, request, headers, advance } = await fixture(t);
  const targets = await (await request("/api/activity/targets", { headers })).json();
  assert.ok(targets.paths.includes(join(root, "index.md")));
  assert.ok(targets.ignorePids.includes(process.pid));
  state.selectedId = "index";
  state.query = "canvas";
  const file = state.graph.nodes.find((n) => n.id !== "index");
  const response = await post({
    status: "live",
    events: [
      { path: join(root, file.path), pid: 123, kind: "read" },
      { path: "/unrelated/index.md", pid: 123, kind: "read" },
      { path: join(root, "index.md"), pid: process.pid, kind: "write" },
    ],
  });
  assert.deepEqual(await response.json(), { ok: true, accepted: 1 });
  assert.equal(state.activity.nodes[0].id, file.id);
  assert.equal(state.activity.nodes[0].pid, 123);
  assert.equal(state.activity.nodes[0].kind, "read");
  assert.equal(state.activity.nodes[0].sequence, 1);
  assert.equal(state.activity.nodes[0].count, 1);
  assert.equal(state.activity.nodes[0].firstSequence, 1);
  assert.equal(state.activity.collector.status, "live");
  assert.equal(state.selectedId, "index");
  assert.equal(state.query, "canvas");
  advance(5000);
  await delay(140);
  assert.deepEqual(state.activity.nodes, []);
  assert.equal(state.selectedId, "index");
  advance(1600);
  await delay(140);
  assert.equal(state.activity.collector.status, "disconnected");
  entry.activity.sync();
});

test("same-millisecond batches expose coalesced observation metadata in bootstrap payloads", async (t) => {
  const { state, post, request } = await fixture(t);
  const other = state.graph.nodes.find((node) => node.id !== "index");
  const indexEvent = { path: join(root, "index.md"), pid: 123, kind: "read" };
  const otherEvent = { ...indexEvent, path: join(root, other.path) };
  const response = await post({
    status: "live",
    events: [
      indexEvent, otherEvent, indexEvent, indexEvent,
      { ...indexEvent, path: "/unrelated/index.md" },
      { ...indexEvent, pid: process.pid },
    ],
  });
  assert.deepEqual(await response.json(), { ok: true, accepted: 4 });
  const common = { pid: 123, kind: "read", accessedAt: 10000, expiresAt: 15000 };
  assert.deepEqual(state.activity.nodes, [
    { ...common, id: "index", sequence: 4, count: 3, firstSequence: 1 },
    { ...common, id: other.id, sequence: 2, count: 1, firstSequence: 2 },
  ]);
  assert.deepEqual(await (await post({
    status: "live", events: [otherEvent, indexEvent],
  })).json(), { ok: true, accepted: 2 });
  const { state: bootstrap } = await (await request("/api/bootstrap")).json();
  assert.deepEqual(bootstrap.activity.nodes, [
    { ...common, id: "index", sequence: 6, count: 4, firstSequence: 1 },
    { ...common, id: other.id, sequence: 5, count: 2, firstSequence: 2 },
  ]);
  assert.ok(bootstrap.activity.nodes.every((node) => !Object.hasOwn(node, "order")));
  assert.deepEqual(bootstrap.activity.nodes, state.activity.nodes);
});

test("bad batches are rejected atomically; configuration validates without false success", async (t) => {
  const { state, request, post } = await fixture(t);
  const event = { path: join(root, "index.md"), pid: 123, kind: "read" };
  assert.equal((await post({ status: "live", events: [event, { ...event, pid: "123" }] })).status, 400);
  assert.equal(state.activity.nodes.length, 0);
  assert.equal((await post({ status: "live", events: Array(129).fill(event) })).status, 400);
  assert.equal((await post({ status: "fake", events: [] })).status, 400);
  const config = (body) => request("/api/activity/config", {
    method: "POST",
    headers: { ...canvasHeaders, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  assert.equal((await config({ durationMs: -10 })).status, 400);
  assert.equal((await config({ enabled: "yes" })).status, 400);
  assert.equal((await config({ durationMs: 7500 })).status, 200);
  assert.equal(state.activity.durationMs, 7500);
  await post({ status: "live", events: [event] });
  assert.equal(state.activity.nodes[0].sequence, 1);
  assert.equal(state.activity.nodes[0].count, 1);
  assert.equal(state.activity.nodes[0].firstSequence, 1);
  await config({ enabled: false });
  assert.equal(state.activity.collector.status, "paused");
  assert.equal(state.activity.nodes.length, 0);
  assert.deepEqual(await (await post({ status: "live", events: [event] })).json(), { ok: true, accepted: 0 });
});

test("configuration payloads preserve interval counts and reset them on pause and expiry", async (t) => {
  const { state, entry, request, post, advance } = await fixture(t);
  const event = { path: join(root, "index.md"), pid: 123, kind: "read" };
  const config = async (body) => {
    const response = await request("/api/activity/config", {
      method: "POST",
      headers: { ...canvasHeaders, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  await post({ status: "live", events: [event, event] });
  const updated = await config({ durationMs: 1000 });
  assert.deepEqual(updated.nodes, [{
    id: "index", pid: 123, kind: "read", accessedAt: 10000, expiresAt: 11000,
    sequence: 2, count: 2, firstSequence: 1,
  }]);
  const paused = await config({ enabled: false });
  assert.equal(paused.enabled, false);
  assert.deepEqual(paused.nodes, []);
  assert.deepEqual(await (await post({ status: "live", events: [event] })).json(), { ok: true, accepted: 0 });
  assert.deepEqual((await config({ enabled: true })).nodes, []);
  await post({ status: "live", events: [event, event] });
  assert.equal(state.activity.nodes[0].sequence, 4);
  assert.equal(state.activity.nodes[0].count, 2);
  assert.equal(state.activity.nodes[0].firstSequence, 3);
  advance(1000);
  entry.activity.sync();
  assert.deepEqual(state.activity.nodes, []);
  await post({ status: "live", events: [event] });
  assert.deepEqual(state.activity.nodes, [{
    id: "index", pid: 123, kind: "read", accessedAt: 11000, expiresAt: 12000,
    sequence: 5, count: 1, firstSequence: 5,
  }]);
});

test("activity updates use lightweight SSE without resending the graph", async (t) => {
  const { request, post, entry } = await fixture(t);
  const abort = new AbortController();
  t.after(() => abort.abort());
  const response = await request("/events", { signal: abort.signal });
  const reader = response.body.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  assert.match(first, /"graph":/);
  const event = { path: join(root, "index.md"), pid: 123, kind: "read" };
  await post({ status: "live", events: [event, event, event] });
  const next = new TextDecoder().decode((await reader.read()).value);
  assert.match(next, /^event: activity\n/);
  assert.ok(!next.includes('"graph":'));
  assert.match(next, /"id":"index"/);
  const activity = JSON.parse(next.match(/^data: (.+)$/m)[1]);
  assert.deepEqual(activity.nodes, [{
    id: "index", pid: 123, kind: "read", accessedAt: 10000, expiresAt: 15000,
    sequence: 3, count: 3, firstSequence: 1,
  }]);
  assert.ok(!next.includes('"order":'));
  abort.abort();
  await delay(30);
  assert.equal(entry.clients.size, 0);
});

test("closing the atlas removes collector targets and retained activity", async (t) => {
  const { state, entry, headers, request, post } = await fixture(t);
  const event = { path: join(root, "index.md"), pid: 123, kind: "read" };
  await post({ status: "live", events: [event, event] });
  openAtlas(state, "");
  entry.broadcast();
  const targets = await (await request("/api/activity/targets", { headers })).json();
  assert.deepEqual(targets.paths, []);
  assert.deepEqual(state.activity.nodes, []);
  assert.deepEqual(await (await post({ status: "live", events: [event] })).json(), { ok: true, accepted: 0 });
  openAtlas(state, root);
  entry.broadcast();
  await post({ status: "live", events: [event] });
  assert.equal(state.activity.nodes[0].sequence, 3);
  assert.equal(state.activity.nodes[0].count, 1);
  assert.equal(state.activity.nodes[0].firstSequence, 3);
});

test("server graph remapping preserves metadata while file deletion starts a new interval", async (t) => {
  const { state, entry, post, request } = await fixture(t);
  const original = state.graph;
  const event = { path: join(root, "index.md"), pid: 123, kind: "read" };
  await post({ status: "live", events: [event, event] });
  const [before] = state.activity.nodes;
  state.graph = {
    ...original,
    nodes: original.nodes.map((node) => ({ ...node, id: `atlas::${node.id}` })),
    edges: original.edges.map((edge) => ({
      ...edge, source: `atlas::${edge.source}`, target: `atlas::${edge.target}`,
    })),
  };
  entry.activity.sync();
  assert.deepEqual(state.activity.nodes, [{ ...before, id: "atlas::index" }]);
  await post({ status: "live", events: [event] });
  assert.deepEqual((await (await request("/api/bootstrap")).json()).state.activity.nodes, [{
    ...before, id: "atlas::index", sequence: 3, count: 3,
  }]);
  state.graph = {
    ...original, nodes: original.nodes.filter((node) => node.id !== "index"),
    edges: original.edges.filter((edge) => edge.source !== "index" && edge.target !== "index"),
  };
  entry.activity.sync();
  assert.deepEqual(state.activity.nodes, []);
  assert.deepEqual(await (await post({ status: "live", events: [event] })).json(), { ok: true, accepted: 0 });
  state.graph = original;
  entry.activity.sync();
  assert.deepEqual(state.activity.nodes, []);
  await post({ status: "live", events: [event] });
  assert.deepEqual(state.activity.nodes, [{ ...before, sequence: 4, count: 1, firstSequence: 4 }]);
});

test("collector errors surface and simultaneous canvases have isolated credentials", async (t) => {
  const a = await fixture(t);
  const b = await fixture(t);
  assert.notEqual(a.connection.token, b.connection.token);
  assert.equal((await b.request("/api/activity/targets", { headers: a.headers })).status, 401);
  await a.post({ status: "error", message: "Collector input ended. Check Full Disk Access.", events: [] });
  assert.equal(a.state.activity.collector.status, "error");
  assert.match(a.state.activity.collector.message, /Full Disk Access/);
  assert.equal(b.state.activity.collector.status, "waiting");
});

test("session scope admits its tools and excludes host scans, other sessions, and viewer descendants", async (t) => {
  const scope = { mode: "session", rootPid: 400, excludePids: [500] };
  const { state, post, connection, request, headers } = await fixture(t, { scope });
  const event = { path: join(root, "index.md"), kind: "read" };
  const cases = [
    { pid: 400, ancestors: [], accepted: 1 },
    { pid: 401, ancestors: [400], accepted: 1 },
    { pid: 402, ancestors: [401, 400], accepted: 1 },
    { pid: 100, ancestors: [1], accepted: 0 },
    { pid: 302, ancestors: [301, 300, 100], accepted: 0 },
    { pid: 500, ancestors: [400], accepted: 0 },
    { pid: 501, ancestors: [500, 400], accepted: 0 },
    { pid: process.pid, ancestors: [400], accepted: 0 },
    { pid: 502, ancestors: [process.pid, 400], accepted: 0 },
    { pid: 601, ancestors: [600, 1], accepted: 0 },
  ];
  for (const { accepted, ...origin } of cases) {
    const response = await post({ status: "live", events: [{ ...event, ...origin }] });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, accepted }, `process ${origin.pid}`);
  }
  assert.equal(state.activity.nodes[0].pid, 402);
  assert.equal(state.activity.nodes[0].sequence, 3);
  assert.equal(state.activity.nodes[0].count, 3);
  assert.equal(state.activity.nodes[0].firstSequence, 1);
  assert.equal(state.activity.scope.rootPid, 400);
  assert.equal(connection.scope.mode, "session");
  assert.match(connection.command, /\bfork\b/);
  assert.match(connection.command, /\bexec\b/);
  assert.match(connection.command, /\bexit\b/);
  const targets = await (await request("/api/activity/targets", { headers })).json();
  assert.deepEqual(targets.scope, state.activity.scope);
});

test("session scope rejects legacy missing ancestry and malformed chains atomically", async (t) => {
  const { state, post } = await fixture(t, { scope: { mode: "session", rootPid: 400, excludePids: [] } });
  const event = { path: join(root, "index.md"), pid: 401, kind: "read" };
  for (const ancestors of [undefined, "400", [401, 400], [400, 400], [0, 400], Array.from({ length: 65 }, (_, i) => i + 500)]) {
    const response = await post({
      status: "live",
      events: [{ ...event, ancestors: [400] }, { ...event, ancestors }],
    });

    assert.equal(response.status, 400);
    assert.deepEqual(state.activity.nodes, []);
  }
});

test("a session root cannot be the excluded receiver process itself", async () => {
  await assert.rejects(startServer("invalid-scope", freshState(root), {
    activity: { scope: { mode: "session", rootPid: process.pid, excludePids: [] } },
  }), /root cannot also be excluded/);
});
