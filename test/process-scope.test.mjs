import test from "node:test";
import assert from "node:assert/strict";
import { eventInProcessScope, ProcessAncestryTracker, validateProcessScope } from "../.apm/extensions/cartograph/activity/process-scope.mjs";
import { validAccessEvent } from "../.apm/extensions/cartograph/activity/protocol.mjs";
import { createEsloggerParser, esloggerProvider, parseEsloggerLine, parseProcessSnapshot } from "../.apm/extensions/cartograph/activity/providers/eslogger.mjs";

const ROOT = 41529;
const HOST = 745;
const VIEWER = 61723;
const SHELL = 65522;
const TOOL = 65523;
const PATH = "/atlas/notes/example.md";
const scope = { mode: "session", rootPid: ROOT, excludePids: [VIEWER] };
const birth = (pid) => 1700000000 + pid;
const proc = (pid, ppid, pidversion = 1, extra = {}) => ({
  audit_token: { pid, pidversion }, ppid,
  parent_audit_token: { pid: ppid, pidversion: 1 },
  responsible_audit_token: { pid: HOST, pidversion: 1 },
  start_time: new Date(birth(pid) * 1000).toISOString(),
  ...extra,
});
const seed = (pid, ppid) => ({ pid, ppid, startTime: birth(pid) });
const baseSnapshot = [seed(ROOT, HOST), seed(HOST, 1), seed(VIEWER, ROOT)];
const message = (event_type, process, event) => ({ schema_version: 1, event_type, process, event });
const access = (process, eventType = "ES_EVENT_TYPE_NOTIFY_OPEN") => message(eventType, process,
  eventType === 12
    ? { close: { modified: true, target: { path: PATH, path_truncated: false } } }
    : { open: { fflag: 1, file: { path: PATH, path_truncated: false } } });
const fork = (parent, child, type = 11) => message(type, parent, { fork: { child } });
const exec = (before, after, type = 9) => message(type, before, { exec: { target: after } });
const exit = (process, type = 15) => message(type, process, { exit: { stat: 0 } });
const create = async (snapshot = baseSnapshot, options = {}) => {
  const parser = await createEsloggerParser({ scope, snapshot, ...options });
  return (event) => parser(JSON.stringify(event));
};

test("eslogger RFC 3339 birth timestamps retain microseconds and accept timezone offsets", async () => {
  const parse = await create();
  const timestamp = new Date(birth(ROOT) * 1000).toISOString().replace(".000Z", ".123456789Z");
  assert.equal(parse(access(proc(ROOT, HOST, 1, { start_time: timestamp }))).type, "event");
  const offsetTimestamp = new Date((birth(ROOT) + 3600) * 1000).toISOString().replace(".000Z", ".123456+01:00");
  assert.equal(parse(access(proc(ROOT, HOST, 1, { start_time: offsetTimestamp }))).type, "event");
  assert.equal(parse(access(proc(ROOT, HOST, 1, {
    start_time: { tv_sec: birth(ROOT), tv_usec: 123456 },
  }))).type, "event");
  assert.throws(() => parse(access(proc(ROOT, HOST, 1, {
    start_time: timestamp.replace("123456789", "123457789"),
  }))), /identity changed/);
});

test("unsupported timestamp formats fail with field-specific redacted diagnostics", async () => {
  for (const start_time of ["private/path", "2025-02-30T12:00:00Z", "2025-01-01T25:00:00Z", 100, null]) {
    const parse = await create();
    assert.throws(() => parse(access(proc(ROOT, HOST, 1, { start_time }))), (error) => {
      assert.match(error.message, /process.start_time/);
      assert.ok(!error.message.includes("private/path"));
      return true;
    });
  }
});

test("scope validation defaults to all, normalizes exclusions and rejects invalid descriptors", () => {
  assert.deepEqual(validateProcessScope(), { mode: "all", excludePids: [] });
  assert.deepEqual(validateProcessScope({ mode: "all" }), { mode: "all", excludePids: [] });
  assert.deepEqual(validateProcessScope({ mode: "session", rootPid: ROOT, excludePids: [9, 2, 9] }),
    { mode: "session", rootPid: ROOT, excludePids: [2, 9] });
  for (const invalid of [
    null, [], {}, { mode: "unknown" }, { mode: "all", rootPid: ROOT },
    { mode: "session" }, { mode: "session", rootPid: "123" }, { mode: "session", rootPid: Infinity },
    { mode: "session", rootPid: 0 }, { mode: "session", rootPid: 1.5 },
    { mode: "session", rootPid: ROOT, excludePids: [ROOT] },
    { mode: "all", excludePids: ["123"] }, { mode: "all", excludePids: [NaN] },
    { mode: "all", excludePids: null }, { mode: "all", excludePids: [0] },
    { mode: "all", responsiblePid: HOST },
  ]) assert.throws(() => validateProcessScope(invalid), TypeError);
});

test("normalized ancestry is bounded, unique, nonself and positive; scope does not guess missing ancestry", () => {
  const event = { path: PATH, pid: TOOL, kind: "read" };
  for (const ancestors of [null, {}, ["123"], [0], [NaN], [Infinity], [TOOL], [ROOT, ROOT], Array.from({ length: 65 }, (_, i) => i + 1)]) {
    assert.equal(validAccessEvent({ ...event, ancestors }), false);
    assert.equal(eventInProcessScope({ ...event, ancestors }, scope), false);
  }
  assert.ok(validAccessEvent({ ...event, ancestors: Array.from({ length: 64 }, (_, i) => i + 1) }));
  assert.equal(eventInProcessScope(event, scope), false);
  assert.equal(eventInProcessScope({ ...event, ancestors: [SHELL, ROOT] }, scope), true);
  assert.equal(eventInProcessScope({ ...event, ancestors: [VIEWER, ROOT] }, scope), false);
  assert.equal(eventInProcessScope({ ...event, pid: VIEWER, ancestors: [ROOT] }, scope), false);
  assert.equal(eventInProcessScope({ ...event, pid: ROOT, ancestors: [] }, scope), true);
  assert.equal(eventInProcessScope(event), true);
  assert.equal(eventInProcessScope({ ...event, ancestors: [VIEWER] }, { mode: "all", excludePids: [VIEWER] }), false);
});

test("existing children are seeded without process-name or responsible-app attribution", async () => {
  const parse = await create([...baseSnapshot, seed(SHELL, ROOT), seed(TOOL, SHELL)]);
  assert.deepEqual(parse(access(proc(TOOL, SHELL))).event, {
    path: PATH, pid: TOOL, kind: "read", ancestors: [SHELL, ROOT],
  });
  assert.deepEqual(parse(access(proc(ROOT, HOST))).event.ancestors, []);
  for (const [pid, parent] of [[HOST, 1], [700, HOST], [701, 700], [800, 1]]) {
    assert.equal(parse(access(proc(pid, parent))).type, "ignored");
  }
});

test("native fork/exec/exit captures nested short-lived tools before any polling could see them", async () => {
  const parse = await create();
  const root = proc(ROOT, HOST);
  const shell = proc(SHELL, ROOT);
  const tool = proc(TOOL, SHELL);
  assert.equal(parse(fork(root, shell)).reason, "process-lifecycle");
  parse(exec(shell, proc(SHELL, ROOT, 2)));
  const child = { ...tool, parent_audit_token: { pid: SHELL, pidversion: 2 } };
  parse(fork(proc(SHELL, ROOT, 2), child, "ES_EVENT_TYPE_NOTIFY_FORK"));
  const executed = { ...child, audit_token: { pid: TOOL, pidversion: 2 } };
  parse(exec(child, executed, "ES_EVENT_TYPE_NOTIFY_EXEC"));
  assert.deepEqual(parse(access(executed)).event.ancestors, [SHELL, ROOT]);
  assert.equal(parse(access(executed, 12)).event.kind, "write");
  assert.equal(parse(exit(executed, "ES_EVENT_TYPE_NOTIFY_EXIT")).reason, "process-lifecycle");
  assert.equal(parse(access(executed)).type, "ignored", "an exited execution is not revived");
});

test("viewer descendants, host scans, sibling sessions and external terminals are excluded", async () => {
  const parse = await create();
  const viewer = proc(VIEWER, ROOT);
  assert.equal(parse(access(viewer)).type, "ignored");
  const child = proc(900, VIEWER);
  parse(fork(viewer, child));
  assert.equal(parse(access(child)).type, "ignored");
  parse(fork(proc(700, HOST), proc(701, 700)));
  assert.equal(parse(access(proc(701, 700))).type, "ignored");
  parse(fork(proc(800, 1), proc(801, 800)));
  assert.equal(parse(access(proc(801, 800))).type, "ignored");
  assert.equal(parse(access(proc(HOST, 1))).type, "ignored");
});

test("only a verified current parent token can attribute an otherwise unknown process", async () => {
  const parse = await create();
  assert.equal(parse(access(proc(TOOL, ROOT))).type, "ignored", "unbound snapshot parent is insufficient");
  parse(access(proc(ROOT, HOST)));
  assert.deepEqual(parse(access(proc(TOOL, ROOT))).event.ancestors, [ROOT]);
  assert.equal(parse(access(proc(900, ROOT, 1, { parent_audit_token: undefined }))).type, "ignored");
  assert.equal(parse(access(proc(901, ROOT, 1, { parent_audit_token: { pid: ROOT, pidversion: 99 } }))).type, "ignored");
});

test("PID reuse never inherits an old tool's cached lineage", async () => {
  const parse = await create();
  const root = proc(ROOT, HOST);
  const old = proc(TOOL, ROOT);
  parse(fork(root, old));
  assert.equal(parse(access(old)).type, "event");
  parse(exit(old));
  const reused = proc(TOOL, 800, 2, { start_time: { tv_sec: birth(TOOL) + 100, tv_usec: 0 } });
  assert.equal(parse(access(reused)).type, "ignored");
  assert.equal(parse(access(old)).type, "ignored");
  const newTool = proc(TOOL, ROOT, 3, { start_time: { tv_sec: birth(TOOL) + 200, tv_usec: 0 } });
  parse(fork(root, newTool));
  assert.deepEqual(parse(access(newTool)).event.ancestors, [ROOT]);
});

test("reuse or unobserved execution changes invalidate cached identity, even without an exit event", async () => {
  const parse = await create([...baseSnapshot, seed(TOOL, ROOT)]);
  parse(access(proc(TOOL, ROOT)));
  assert.equal(parse(access(proc(TOOL, 800, 2))).type, "ignored");
  const parseSeed = await create([...baseSnapshot, seed(TOOL, ROOT)]);
  assert.equal(parseSeed(access(proc(TOOL, ROOT, 2, { start_time: { tv_sec: birth(TOOL) + 1, tv_usec: 0 } }))).type, "ignored");
});

test("verified children retain original provenance after a parent exits or reparenting", async () => {
  const parse = await create();
  const root = proc(ROOT, HOST);
  const shell = proc(SHELL, ROOT);
  const tool = proc(TOOL, SHELL);
  parse(fork(root, shell));
  parse(fork(shell, tool));
  parse(exit(shell));
  const orphan = proc(TOOL, 1);
  assert.deepEqual(parse(access(orphan)).event.ancestors, [SHELL, ROOT]);
  const viewerChild = proc(900, VIEWER);
  parse(fork(proc(VIEWER, ROOT), viewerChild));
  parse(exit(proc(VIEWER, ROOT)));
  assert.equal(parse(access(proc(900, 1))).type, "ignored", "reparenting never clears viewer exclusion");
});

test("the root may exec with native before/after evidence, but exit or reuse ends attribution", async () => {
  const parse = await create();
  parse(exec(proc(ROOT, HOST), proc(ROOT, HOST, 2)));
  assert.deepEqual(parse(access(proc(ROOT, HOST, 2))).event.ancestors, []);
  assert.throws(() => parse(access(proc(ROOT, HOST, 3))), /identity changed/);
  const second = await create();
  assert.throws(() => second(exit(proc(ROOT, HOST))), /session ended/);
  await assert.rejects(create([]), /no longer running/);
});

test("process cycles, malformed relationships and excessive ancestry fail closed", async () => {
  const parse = await create([...baseSnapshot, seed(800, 801), seed(801, 800)]);
  assert.equal(parse(access(proc(800, 801))).type, "ignored");
  assert.throws(() => parse(fork(proc(ROOT, HOST), proc(ROOT, ROOT))), /relationship|reused/);
  assert.throws(() => parse(fork(proc(ROOT, HOST), proc(TOOL, HOST))), /relationship/);
  assert.throws(() => parse(exec(proc(TOOL, ROOT), proc(SHELL, ROOT, 2))), /relationship/);
  const deep = baseSnapshot.slice();
  let parent = ROOT;
  for (let pid = 1000; pid < 1065; pid++) {
    deep.push(seed(pid, parent));
    parent = pid;
  }
  const nested = await create(deep);
  assert.equal(nested(access(proc(1064, 1063))).type, "ignored");
});

test("missing or malformed native identity metadata is an explicit session error", async () => {
  const parse = await create();
  for (const value of [
    { audit_token: { pid: TOOL }, ppid: ROOT },
    proc(TOOL, ROOT, "1"),
    proc(TOOL, ROOT, 1, { ppid: -1 }),
    proc(TOOL, ROOT, 1, { parent_audit_token: { pid: ROOT, pidversion: "1" } }),
    proc(TOOL, ROOT, 1, { start_time: { tv_sec: "secret/path", tv_usec: 0 } }),
  ]) assert.throws(() => parse(access(value)), /Session attribution requires/);
});

test("detected native sequence gaps and reordering stop session attribution", async () => {
  for (const next of [5, 1]) {
    const parse = await create();
    parse({ ...access(proc(ROOT, HOST)), global_seq_num: 2 });
    assert.throws(() => parse({ ...access(proc(ROOT, HOST)), global_seq_num: next }), /lost or reordered/);
  }
  const parse = await create();
  parse({ ...access(proc(ROOT, HOST)), global_seq_num: "9007199254740993" });
  assert.equal(parse({ ...access(proc(ROOT, HOST)), global_seq_num: "9007199254740994" }).type, "event");
  assert.throws(() => parse(access(proc(ROOT, HOST))), /metadata disappeared/);
});

test("process metadata stays bounded and separate between parser instances", async () => {
  const first = await create([seed(ROOT, HOST)], { maxProcesses: 2 });
  const second = await create([seed(ROOT, HOST)], { maxProcesses: 2 });
  first(fork(proc(ROOT, HOST), proc(TOOL, ROOT)));
  assert.equal(second(access(proc(TOOL, ROOT))).type, "ignored");
  assert.throws(() => first(fork(proc(ROOT, HOST), proc(SHELL, ROOT))), /metadata limit/);
  const tracker = new ProcessAncestryTracker(scope, baseSnapshot);
  assert.equal(tracker.records.has(HOST), false, "unrelated snapshot metadata is not retained");
  assert.ok([...tracker.records.values()].every((record) => Object.keys(record).every((key) => !/path|command|args/.test(key))));
});

test("ps snapshot parsing extracts numeric identities and birth times, never command lines", () => {
  const rows = parseProcessSnapshot("  41529 745 Fri Sep  4 11:40:58 2026\n 65522 41529 Fri Sep  4 11:41:21 2026\n");
  assert.deepEqual(rows.map(({ pid, ppid }) => ({ pid, ppid })), [{ pid: ROOT, ppid: HOST }, { pid: SHELL, ppid: ROOT }]);
  assert.ok(rows.every((row) => Number.isSafeInteger(row.startTime)));
  assert.throws(() => parseProcessSnapshot("41529 745 /unrelated/private/path"), /snapshot/);
});

test("all-process mode keeps old parsing and commands; session commands include lifecycle subscriptions", async () => {
  assert.equal(await createEsloggerParser({ scope: { mode: "all" } }), parseEsloggerLine);
  const options = { endpoint: "http://127.0.0.1:1234/", token: "private", collectorPath: "/repo/collector.mjs" };
  const all = esloggerProvider.createConnection(options).command;
  const session = esloggerProvider.createConnection({ ...options, scope }).command;
  assert.match(all, /eslogger open close \|/);
  assert.match(session, /eslogger open close fork exec exit \|/);
  assert.deepEqual(esloggerProvider.metadata.processScopes, ["all", "session"]);
  assert.ok(esloggerProvider.stream.messages.limitations.length <= 500);
  assert.equal(parseEsloggerLine(JSON.stringify(fork(proc(ROOT, HOST), proc(TOOL, ROOT)))).type, "ignored");
});
