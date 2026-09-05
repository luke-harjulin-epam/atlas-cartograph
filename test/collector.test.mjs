import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { PassThrough } from "node:stream";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { createActivityService } from "../.apm/extensions/cartograph/activity/service.mjs";
import { esloggerProvider } from "../.apm/extensions/cartograph/activity/providers/eslogger.mjs";
import {
  CollectorError, LIMITATIONS, filterTargetEvents, parseCollectorArgs,
  parseEsloggerLine, parseTargets, runCollector, validateCollectorUrl,
} from "../.apm/extensions/cartograph/activity/collector.mjs";

const TARGET = "/atlas/notes/example.md";
const PRIVATE = "/unrelated/private/secret.txt";
const PID = 123;
const fixture = ({ eventType = "ES_EVENT_TYPE_NOTIFY_OPEN", path = TARGET, pid = PID, flags = 1, modified = true, truncated = false } = {}) => {
  const close = eventType === 12 || String(eventType).toLowerCase().includes("close");
  return {
    schema_version: 1,
    event_type: eventType,
    process: { audit_token: { pid } },
    event: close
      ? { close: { target: { path, path_truncated: truncated }, modified } }
      : { open: { file: { path, path_truncated: truncated }, fflag: flags } },
  };
};
const line = (options) => `${JSON.stringify(fixture(options))}\n`;
const parse = (options) => parseEsloggerLine(line(options));

test("native kernel open flags, numeric event types, and modified close are classified", () => {
  for (const [flags, kind] of [[1, "read"], [2, "write"], [3, "read-write"], [0, "open"], [1025, "read"]]) {
    for (const eventType of [10, "10", "open", "NOTIFY_OPEN", "ES_EVENT_TYPE_NOTIFY_OPEN"]) {
      assert.deepEqual(parse({ flags, eventType }), { type: "event", valid: true, event: { path: TARGET, pid: PID, kind } });
    }
  }
  assert.deepEqual(parse({ eventType: 12 }).event, { path: TARGET, pid: PID, kind: "write" });
  assert.equal(parse({ eventType: "ES_EVENT_TYPE_NOTIFY_CLOSE" }).event.kind, "write");
});

test("unmodified closes, truncated paths, and unrelated/auth events cannot become file activity", () => {
  assert.deepEqual(parse({ eventType: 12, modified: false }), { type: "ignored", valid: true, reason: "unmodified" });
  for (const eventType of [10, 12]) {
    assert.deepEqual(parse({ eventType, truncated: true }), { type: "ignored", valid: true, reason: "truncated" });
  }
  for (const eventType of ["ES_EVENT_TYPE_AUTH_OPEN", 1, "ES_EVENT_TYPE_NOTIFY_EXEC", 9, "future_event"]) {
    assert.deepEqual(parse({ eventType }), { type: "ignored", valid: false, reason: "unrelated" });
  }
  assert.deepEqual(parseEsloggerLine(" \r\n"), { type: "ignored", valid: false, reason: "empty" });
});

test("malformed JSON and path/PID/flag/schema shapes fail without disclosing event contents", () => {
  const bad = [null, [], 12, {}, { event_type: null }];
  const mutations = [
    (f) => { f.schema_version = undefined; },
    (f) => { f.schema_version = {}; },
    (f) => { f.event.open.file.path = "relative/path"; },
    (f) => { f.event.open.file.path = null; },
    (f) => { f.event.open.file.path = { path: PRIVATE }; },
    (f) => { f.event.open.file.path = "/invalid\0name"; },
    (f) => { f.event.open.file.path = `/${"x".repeat(4096)}`; },
    (f) => { f.event.open.file.path_truncated = undefined; },
    (f) => { f.event.open.file.path_truncated = "false"; },
    (f) => { f.event.open.fflag = "1"; },
    (f) => { f.event.open.fflag = 0.5; },
    (f) => { f.event.open.fflag = 2147483648; },
    (f) => { f.process.audit_token.pid = "123"; },
    (f) => { f.process.audit_token.pid = 0; },
    (f) => { f.process.audit_token.pid = -1; },
    (f) => { f.process.audit_token.pid = 1.5; },
    (f) => { f.process.audit_token.pid = 2147483648; },
    (f) => { f.process.audit_token = undefined; },
    (f) => { f.event = []; },
  ];
  for (const mutate of mutations) {
    const f = fixture({ path: PRIVATE });
    mutate(f);
    bad.push(f);
  }
  const close = fixture({ eventType: 12 });
  close.event.close.modified = "true";
  bad.push(close);
  for (const value of [...bad.map(JSON.stringify), `{"private":"${PRIVATE}"`, PRIVATE]) {
    assert.throws(() => parseEsloggerLine(value), (error) => {
      assert.ok(error instanceof CollectorError);
      assert.ok(!error.message.includes(PRIVATE));
      return true;
    });
  }
  assert.throws(() => parseEsloggerLine("x".repeat(1024 * 1024 + 1)), /size limit/);
});

test("structural schema validation supports numeric and dotted versions without claiming stability", () => {
  for (const schemaVersion of [1, 2, "1", "1.0.0"]) {
    const message = fixture();
    message.schema_version = schemaVersion;
    assert.equal(parseEsloggerLine(JSON.stringify(message)).type, "event");
  }
  assert.match(LIMITATIONS, /not individual read syscalls/);
  assert.match(LIMITATIONS, /cache hits/);
  assert.match(LIMITATIONS, /no stable schema/);
  assert.ok(LIMITATIONS.length <= 500, "status message fits the backend contract");
});

test("exact target aliases isolate paths and ignore server/collector PIDs", () => {
  const alias = "/canonical/notes/example.md";
  const targets = parseTargets({ paths: [TARGET, alias], ignorePids: [321] });
  const events = [
    { path: TARGET, pid: PID, kind: "read" },
    { path: alias, pid: PID, kind: "read" },
    { path: PRIVATE, pid: PID, kind: "read" },
    { path: `${TARGET}.extra`, pid: PID, kind: "read" },
    { path: "/atlas/notes/../secret.txt", pid: PID, kind: "read" },
    { path: TARGET, pid: 321, kind: "read" },
    { path: TARGET, pid: process.pid, kind: "read" },
  ];
  assert.deepEqual(filterTargetEvents(events, targets), events.slice(0, 2));
  assert.throws(() => parseTargets({ paths: ["relative"], ignorePids: [] }), /target schema/);
  assert.throws(() => parseTargets({ paths: [], ignorePids: ["123"] }), /target schema/);
});

test("credentials are environment-only and URLs cannot leave loopback or redirect through URL components", () => {
  for (const url of ["http://127.0.0.1:1234/", "http://127.0.0.2:1234/", "http://[::1]:1234/", "https://127.0.0.1:1234/"]) {
    assert.equal(validateCollectorUrl(url).href, url);
  }
  assert.equal(validateCollectorUrl("http://localhost:1234/").hostname, "127.0.0.1");
  for (const url of [
    "http://example.com/", "http://127.0.0.1.example.com/", "http://0.0.0.0/",
    "http://192.168.1.2/", "file:///etc/passwd", "http://[::]/",
    "http://token@127.0.0.1/", "http://127.0.0.1/path", "http://127.0.0.1/?token=x",
    "http://127.0.0.1/#anything",
  ]) assert.throws(() => validateCollectorUrl(url), CollectorError);
  assert.throws(() => parseCollectorArgs(["--token", "hidden"], {}), /Usage/);
  assert.throws(() => parseCollectorArgs(["--url", "http://localhost/"], {}), /CARTOGRAPH_ACTIVITY_TOKEN/);
  assert.throws(() => parseCollectorArgs(["--url", "http://localhost/"], { CARTOGRAPH_ACTIVITY_TOKEN: "bad\nheader" }), CollectorError);
});

async function waitFor(predicate, message = "condition") {
  const deadline = Date.now() + 2500;
  while (!predicate()) {
    if (Date.now() > deadline) assert.fail(`Timed out waiting for ${message}`);
    await delay(5);
  }
}

async function harness(t, options = {}) {
  const posts = [];
  const requests = [];
  const state = { targets: { paths: [TARGET], ignorePids: [] }, gets: 0, ...options.state };
  const server = createServer(async (req, res) => {
    requests.push({ url: req.url, auth: req.headers.authorization });
    if (options.handle && await options.handle(req, res, state)) return;
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/activity/targets") {
      state.gets++;
      res.end(JSON.stringify(state.targets));
      return;
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    const value = JSON.parse(body);
    posts.push(value);
    res.end(JSON.stringify({ ok: true, accepted: value.events.length }));
  });
  await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
  const input = new PassThrough();
  const abort = new AbortController();
  let diagnostics = "";
  const url = `http://127.0.0.1:${server.address().port}/`;
  const running = runCollector({
    url, token: "test-token", input, signal: abort.signal,
    stderr: { write: (text) => { diagnostics += text; } },
    refreshMs: 30, heartbeatMs: 25, flushMs: 5, requestTimeoutMs: 150,
    ...options.collector,
  });
  t.after(async () => {
    abort.abort();
    await running;
    server.closeAllConnections();
    await new Promise((closed) => server.close(closed));
  });
  return { posts, requests, state, input, abort, running, url, diagnostics: () => diagnostics };
}

test("idle stream remains waiting; out-of-atlas valid evidence enables live without sending unrelated paths", async (t) => {
  const h = await harness(t);
  await waitFor(() => h.posts.length >= 2);
  assert.ok(h.posts.every((post) => post.status === "waiting" && post.events.length === 0));
  h.input.write(line({ path: PRIVATE }));
  await waitFor(() => h.posts.some((post) => post.status === "live"));
  assert.ok(!JSON.stringify(h.posts).includes(PRIVATE));
  assert.ok(!h.diagnostics().includes(PRIVATE));
  h.input.write(line());
  await waitFor(() => h.posts.some((post) => post.events.length));
  h.input.end();
  assert.equal((await h.running).status, "disconnected");
  assert.equal(h.posts.at(-1).status, "disconnected");
  assert.ok(h.requests.every((request) => request.auth === "Bearer test-token"));
  const count = h.requests.length;
  await delay(70);
  assert.equal(h.requests.length, count, "all timers stop at EOF");
});

test("empty EOF and permission-failure input never report live", async (t) => {
  for (const contents of ["", `eslogger: Full Disk Access denied ${PRIVATE}\n`]) {
    await t.test(contents ? "producer diagnostics" : "empty stream", async (subtest) => {
      const h = await harness(subtest);
      await waitFor(() => h.posts.length);
      h.input.end(contents);
      assert.equal((await h.running).status, "error");
      assert.ok(h.posts.every((post) => post.status !== "live"));
      assert.equal(h.posts.at(-1).status, "error");
      assert.ok(!JSON.stringify(h.posts).includes(PRIVATE));
      assert.ok(!h.diagnostics().includes(PRIVATE));
    });
  }
});

test("target refresh handles root changes, lexical aliases, and ignored PIDs", async (t) => {
  const alias = "/canonical/example.md";
  const h = await harness(t);
  await waitFor(() => h.posts.length);
  h.input.write(line());
  await waitFor(() => h.posts.some((post) => post.events.length));
  const before = h.state.gets;
  h.state.targets = { paths: [alias], ignorePids: [456] };
  await waitFor(() => h.state.gets > before);
  await delay(10);
  h.input.write(line() + line({ path: alias, pid: 456 }) + line({ path: alias, pid: process.pid }) + line({ path: alias }));
  await waitFor(() => h.posts.some((post) => post.events.some((event) => event.path === alias)));
  const events = h.posts.flatMap((post) => post.events);
  assert.deepEqual(events, [
    { path: TARGET, pid: PID, kind: "read" },
    { path: alias, pid: PID, kind: "read" },
  ]);
});

test("batches stay at most 128 and queue overflow fails explicitly", async (t) => {
  await t.test("bounded batches", async (subtest) => {
    const h = await harness(subtest);
    await waitFor(() => h.posts.length);
    h.input.write(line().repeat(500));
    await waitFor(() => h.posts.flatMap((post) => post.events).length === 500);
    assert.ok(h.posts.every((post) => post.events.length <= 128));
  });
  await t.test("JSON-escaped paths still fit the one-MiB body limit", async (subtest) => {
    const path = `/${"\u0001".repeat(4095)}`;
    const h = await harness(subtest, { state: { targets: { paths: [path], ignorePids: [] } } });
    await waitFor(() => h.posts.length);
    h.input.end(line({ path }).repeat(128));
    assert.equal((await h.running).status, "disconnected");
    assert.equal(h.posts.flatMap((post) => post.events).length, 128);
    assert.ok(h.posts.every((post) => Buffer.byteLength(JSON.stringify(post)) <= 1024 * 1024));
  });
  await t.test("bounded queue", async (subtest) => {
    const h = await harness(subtest, { collector: { maxQueue: 2 } });
    await waitFor(() => h.posts.length);
    h.input.write(line().repeat(10));
    assert.equal((await h.running).status, "error");
    assert.match(h.diagnostics(), /queue exceeded/);
    assert.equal(h.posts.at(-1).status, "error");
  });
});

test("partial UTF-8 input and a final non-newline event are supported", async (t) => {
  const path = "/atlas/évidence.md";
  const h = await harness(t, { state: { targets: { paths: [path], ignorePids: [] } } });
  await waitFor(() => h.posts.length);
  const encoded = Buffer.from(line({ path }));
  const split = encoded.indexOf(Buffer.from("é")) + 1;
  h.input.write(encoded.subarray(0, split));
  h.input.write(encoded.subarray(split));
  await waitFor(() => h.posts.some((post) => post.events.length));
  h.input.end(JSON.stringify(fixture({ path, flags: 2 })));
  assert.equal((await h.running).status, "disconnected");
  assert.ok(h.posts.flatMap((post) => post.events).some((event) => event.kind === "write"));
});

test("EOF drains queued events and an in-flight batch without losing or duplicating them", async (t) => {
  for (const count of [1, 500]) {
    await t.test(`${count} events`, async (subtest) => {
      const h = await harness(subtest);
      await waitFor(() => h.posts.length);
      h.input.end(line().repeat(count));
      assert.equal((await h.running).status, "disconnected");
      assert.equal(h.posts.flatMap((post) => post.events).length, count);
      assert.ok(h.posts.every((post) => post.events.length <= 128));
      assert.equal(h.posts.at(-1).status, "disconnected");
    });
  }
});

test("input stream errors and termination report terminal status and stop requests", async (t) => {
  for (const failure of ["error", "close", "abort"]) {
    await t.test(failure, async (subtest) => {
      const h = await harness(subtest);
      await waitFor(() => h.posts.length);
      if (failure === "error") h.input.destroy(new Error(PRIVATE));
      else if (failure === "close") h.input.destroy();
      else h.abort.abort();
      const result = await h.running;
      assert.equal(result.status, failure === "abort" ? "disconnected" : "error");
      assert.equal(h.posts.at(-1).status, result.status);
      assert.ok(!h.diagnostics().includes(PRIVATE));
      const count = h.requests.length;
      await delay(70);
      assert.equal(h.requests.length, count);
    });
  }
});

test("an oversized unterminated input line fails with redacted diagnostics", async (t) => {
  const h = await harness(t);
  await waitFor(() => h.posts.length);
  h.input.write(PRIVATE + "x".repeat(1024 * 1024));
  assert.equal((await h.running).status, "error");
  assert.match(h.diagnostics(), /size limit/);
  assert.ok(!h.diagnostics().includes(PRIVATE));
});

test("invalid refreshed targets stop an already-live collector", async (t) => {
  const h = await harness(t);
  await waitFor(() => h.posts.length);
  h.input.write(line());
  await waitFor(() => h.posts.some((post) => post.status === "live"));
  h.state.targets = { paths: [PRIVATE], ignorePids: null };
  assert.equal((await h.running).status, "error");
  assert.equal(h.posts.at(-1).status, "error");
  assert.ok(!JSON.stringify(h.posts).includes(PRIVATE));
  const count = h.requests.length;
  await delay(70);
  assert.equal(h.requests.length, count);
});

test("redirects are refused without forwarding credentials", async (t) => {
  const h = await harness(t, {
    handle(req, res) {
      if (req.url !== "/api/activity/targets") return false;
      res.writeHead(302, { Location: "http://example.com/private" });
      res.end();
      return true;
    },
  });
  assert.equal((await h.running).status, "error");
  assert.match(h.diagnostics(), /Redirects are forbidden/);
  assert.ok(h.requests.every((request) => ["/api/activity/targets", "/api/activity/events"].includes(request.url)));
  assert.ok(h.posts.every((post) => post.status === "error"));
});

test("HTTP failures, malformed targets, and timeouts fail closed", async (t) => {
  for (const failure of ["unauthorized", "malformed", "timeout"]) {
    await t.test(failure, async (subtest) => {
      const h = await harness(subtest, {
        handle(req, res) {
          if (req.url !== "/api/activity/targets") return false;
          if (failure === "timeout") return true;
          if (failure === "unauthorized") res.writeHead(401);
          res.end(failure === "malformed" ? `{"paths":["${PRIVATE}"]}` : "unauthorized");
          return true;
        },
      });
      assert.equal((await h.running).status, "error");
      assert.equal(h.posts.at(-1).status, "error");
      assert.ok(!h.diagnostics().includes(PRIVATE));
      assert.match(h.diagnostics(), failure === "timeout" ? /timed out/ : failure === "unauthorized" ? /TOKEN/ : /schema/);
    });
  }
});

test("a hanging event endpoint times out, including the bounded terminal-status attempt", async (t) => {
  const h = await harness(t, {
    handle(req) {
      return req.url === "/api/activity/events";
    },
  });
  assert.equal((await h.running).status, "error");
  assert.match(h.diagnostics(), /timed out/);
  assert.equal(h.requests.filter((req) => req.url === "/api/activity/events").length, 2);
  const count = h.requests.length;
  await delay(70);
  assert.equal(h.requests.length, count);
});

test("termination aborts a pending target request and reports disconnected without live", async (t) => {
  const h = await harness(t, {
    handle(req) {
      return req.url === "/api/activity/targets";
    },
  });
  await waitFor(() => h.requests.length);
  h.abort.abort();
  assert.equal((await h.running).status, "disconnected");
  assert.deepEqual(h.posts.map((post) => post.status), ["disconnected"]);
});

test("CLI SIGINT and SIGTERM shut down cleanly with terminal status", async (t) => {
  for (const [signal, exitCode] of [["SIGINT", 130], ["SIGTERM", 143]]) {
    await t.test(signal, async (subtest) => {
      const h = await harness(subtest);
      await waitFor(() => h.posts.length);
      h.abort.abort();
      await h.running;
      const count = h.posts.length;
      const child = spawn(process.execPath, [".apm/extensions/cartograph/activity/collector.mjs", "--url", h.url], {
        cwd: new URL("..", import.meta.url),
        env: { PATH: process.env.PATH, CARTOGRAPH_ACTIVITY_TOKEN: "test-token" },
        stdio: ["pipe", "pipe", "pipe"],
      });
      const exited = new Promise((done) => child.on("exit", (code, reason) => done({ code, reason })));
      subtest.after(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
      });
      await waitFor(() => h.posts.length > count);
      child.kill(signal);
      assert.deepEqual(await exited, { code: exitCode, reason: null });
      assert.equal(h.posts.at(-1).status, "disconnected");
      assert.ok(h.posts.slice(count).every((post) => post.status !== "live"));
    });
  }
});

test("CLI missing-token guidance never prints token arguments or starts collection", async () => {
  const child = spawn(process.execPath, [".apm/extensions/cartograph/activity/collector.mjs", "--token", "sensitive-test-token"], {
    cwd: new URL("..", import.meta.url), env: { PATH: process.env.PATH }, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (data) => { output += data; });
  child.stderr.on("data", (data) => { output += data; });
  const code = await new Promise((done) => child.on("exit", done));
  assert.equal(code, 1);
  assert.match(output, /Usage/);
  assert.ok(!output.includes("sensitive-test-token"));
});

test("collector integrates with the real service contract, including pause/resume and terminal status", async (t) => {
  const input = new PassThrough();
  const abort = new AbortController();
  const entry = {
    state: { graph: { nodes: [{ id: "example", storeRoot: "/atlas/notes", path: "example.md" }], edges: [] } },
    clients: new Set(),
  };
  const sendJson = (res, code, body) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const service = createActivityService(entry, sendJson, { platform: "darwin" });
  const server = createServer(async (req, res) => {
    try {
      if (!await service.handle(req, res, req.url)) sendJson(res, 404, {});
    } catch (error) {
      sendJson(res, error.statusCode ?? 500, { error: "Request failed" });
    }
  });
  await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
  entry.url = `http://127.0.0.1:${server.address().port}/`;
  let running;
  let diagnostics = "";
  t.after(async () => {
    abort.abort();
    await running;
    service.close();
    server.closeAllConnections();
    await new Promise((closed) => server.close(closed));
  });
  const connection = await fetch(`${entry.url}api/activity/connection`, { headers: { "x-cartograph-client": "canvas" } });
  assert.equal(connection.status, 200);
  const { token } = await connection.json();
  running = runCollector({
    url: entry.url, token, input, signal: abort.signal,
    refreshMs: 20, heartbeatMs: 25, flushMs: 5, requestTimeoutMs: 200,
    stderr: { write: (message) => { diagnostics += message; } },
  });
  input.write(line());
  await waitFor(() => entry.state.activity.nodes.length === 1);
  assert.equal(entry.state.activity.collector.status, "live");
  assert.equal(entry.state.activity.nodes[0].id, "example");
  service.configure({ enabled: false });
  await delay(60);
  input.write(line());
  await delay(40);
  assert.deepEqual(entry.state.activity.nodes, []);
  assert.equal(entry.state.activity.collector.status, "paused");
  service.configure({ enabled: true });
  await delay(60);
  input.write(line({ eventType: 12 }));
  await waitFor(() => entry.state.activity.nodes.length === 1);
  input.end();
  assert.equal((await running).status, "disconnected");
  assert.equal(entry.state.activity.collector.status, "disconnected");
  assert.ok(!diagnostics.includes(token));
});

const SESSION_ROOT = 41529;
const VIEWER_PID = 61723;
const sessionScope = { mode: "session", rootPid: SESSION_ROOT, excludePids: [VIEWER_PID] };
const normalizedLine = (event) => `${JSON.stringify({ type: "event", valid: true, event })}\n`;
const scopedProvider = (createParser = async () => JSON.parse) => ({
  ...esloggerProvider,
  stream: { ...esloggerProvider.stream, createParser },
});

test("session scope filters input ancestry and preserves only normalized forwarding fields", async (t) => {
  let initializations = 0;
  let initializedScope;
  const h = await harness(t, {
    state: { targets: { paths: [TARGET], ignorePids: [], scope: sessionScope } },
    collector: {
      provider: scopedProvider(async ({ scope }) => {
        initializations++;
        initializedScope = scope;
        return JSON.parse;
      }),
    },
  });
  await waitFor(() => h.posts.length);
  const event = { path: TARGET, pid: PID, kind: "read" };
  h.input.write([
    { ...event, ancestors: [SESSION_ROOT], command: PRIVATE, unexpected: "not forwarded" },
    event,
    { ...event, pid: VIEWER_PID, ancestors: [SESSION_ROOT] },
    { ...event, ancestors: [VIEWER_PID, SESSION_ROOT] },
    { ...event, pid: 745 },
    { ...event, pid: SESSION_ROOT, ancestors: [] },
  ].map(normalizedLine).join(""));
  await waitFor(() => h.posts.flatMap((post) => post.events).length === 2);
  assert.deepEqual(h.posts.flatMap((post) => post.events), [
    { ...event, ancestors: [SESSION_ROOT] },
    { ...event, pid: SESSION_ROOT, ancestors: [] },
  ]);
  assert.deepEqual(initializedScope, sessionScope);
  await waitFor(() => h.state.gets >= 3);
  assert.equal(initializations, 1, "one per-run parser, not reinitialized on target refresh");
  assert.ok(!JSON.stringify(h.posts).includes(PRIVATE));
});

test("queued scoped events are rechecked when target exclusions refresh", async (t) => {
  const h = await harness(t, {
    state: { targets: { paths: [TARGET], ignorePids: [], scope: sessionScope } },
    collector: { provider: scopedProvider(), flushMs: 1000, heartbeatMs: 1000 },
  });
  await waitFor(() => h.posts.length);
  h.input.write(normalizedLine({ path: PRIVATE, pid: SESSION_ROOT, kind: "read", ancestors: [] }));
  await waitFor(() => h.posts.some((post) => post.status === "live"));
  const queued = { path: TARGET, pid: PID, kind: "read", ancestors: [900, SESSION_ROOT] };
  h.input.write(normalizedLine(queued));
  const gets = h.state.gets;
  h.state.targets = { paths: [TARGET], ignorePids: [900], scope: sessionScope };
  await waitFor(() => h.state.gets > gets);
  await delay(15);
  h.input.end();
  assert.equal((await h.running).status, "disconnected");
  assert.deepEqual(h.posts.flatMap((post) => post.events), []);
  const targets = parseTargets({ paths: [TARGET], ignorePids: [], scope: { ...sessionScope, excludePids: [900] } });
  assert.deepEqual(filterTargetEvents([queued], targets), []);
});

test("scope changes during refresh fail closed rather than switching or silently becoming all-process", async (t) => {
  const h = await harness(t, {
    state: { targets: { paths: [TARGET], ignorePids: [], scope: sessionScope } },
    collector: { provider: scopedProvider() },
  });
  await waitFor(() => h.posts.length);
  h.input.write(normalizedLine({ path: TARGET, pid: SESSION_ROOT, kind: "read", ancestors: [] }));
  await waitFor(() => h.posts.some((post) => post.status === "live"));
  h.state.targets = { paths: [TARGET], ignorePids: [], scope: { mode: "all" } };
  assert.equal((await h.running).status, "error");
  assert.match(h.diagnostics(), /scope changed/);
  assert.equal(h.posts.at(-1).status, "error");
});

test("all-only providers and session providers without a parser factory fail explicitly in session mode", async (t) => {
  for (const failure of ["missing-capability", "missing-factory"]) {
    await t.test(failure, async (subtest) => {
      const provider = scopedProvider();
      if (failure === "missing-capability") {
        provider.metadata = { ...provider.metadata };
        delete provider.metadata.processScopes;
      } else {
        delete provider.stream.createParser;
      }
      const h = await harness(subtest, {
        state: { targets: { paths: [TARGET], ignorePids: [], scope: sessionScope } },
        collector: { provider },
      });
      assert.equal((await h.running).status, "error");
      assert.match(h.diagnostics(), /cannot attribute/);
      assert.ok(h.posts.every((post) => post.status === "error"));
    });
  }
});

test("input waits for the asynchronous per-run parser initialization after initial targets", async (t) => {
  let completeInitialization;
  let parsed = 0;
  let started = false;
  const h = await harness(t, {
    state: { targets: { paths: [TARGET], ignorePids: [], scope: sessionScope } },
    collector: {
      provider: scopedProvider(async () => {
        started = true;
        await new Promise((resolve) => { completeInitialization = resolve; });
        return (line) => {
          parsed++;
          return JSON.parse(line);
        };
      }),
    },
  });
  await waitFor(() => started);
  assert.equal(h.state.gets, 1);
  h.input.write(normalizedLine({ path: TARGET, pid: PID, kind: "read", ancestors: [SESSION_ROOT] }));
  await delay(10);
  assert.equal(parsed, 0);
  completeInitialization();
  await waitFor(() => parsed === 1);
  await waitFor(() => h.posts.some((post) => post.events.length));
});

test("malformed native-adapter ancestry never enters the queue", async (t) => {
  const h = await harness(t, {
    state: { targets: { paths: [TARGET], ignorePids: [], scope: sessionScope } },
    collector: { provider: scopedProvider() },
  });
  await waitFor(() => h.posts.length);
  h.input.write(normalizedLine({ path: TARGET, pid: PID, kind: "read", ancestors: [PID, SESSION_ROOT] }));
  assert.equal((await h.running).status, "error");
  assert.match(h.diagnostics(), /invalid normalized event/);
  assert.deepEqual(h.posts.flatMap((post) => post.events), []);
  assert.throws(() => parseTargets({ paths: [], ignorePids: [], scope: { mode: "session" } }), /process scope/);
});

test("termination cancels an outstanding parser initialization without live or leaked timers", async (t) => {
  let started = false;
  const h = await harness(t, {
    state: { targets: { paths: [TARGET], ignorePids: [], scope: sessionScope } },
    collector: {
      provider: scopedProvider(() => {
        started = true;
        return new Promise(() => {});
      }),
    },
  });
  await waitFor(() => started);
  h.abort.abort();
  assert.equal((await h.running).status, "disconnected");
  assert.deepEqual(h.posts.map((post) => post.status), ["disconnected"]);
});

test("a parser factory cannot mutate the shared transport's selected scope", async (t) => {
  const h = await harness(t, {
    state: { targets: { paths: [TARGET], ignorePids: [], scope: sessionScope } },
    collector: {
      provider: scopedProvider(async ({ scope }) => {
        scope.mode = "all";
        delete scope.rootPid;
        scope.excludePids.length = 0;
        return JSON.parse;
      }),
    },
  });
  await waitFor(() => h.posts.length);
  h.input.end(normalizedLine({ path: TARGET, pid: PID, kind: "read" }));
  assert.equal((await h.running).status, "disconnected");
  assert.deepEqual(h.posts.flatMap((post) => post.events), []);
});
