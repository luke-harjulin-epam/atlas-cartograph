import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import test from "node:test";
import { askHostSession, graphChatPrompt, CHAT_ACTIVATION_PATH } from "../.apm/extensions/cartograph/atlas/chat.mjs";
import { createChatRequests, CHAT_TIMEOUT_MS, MAX_CHAT_REPLY_BYTES, MAX_CHAT_PROGRESS_BYTES } from "../.apm/extensions/cartograph/atlas/chat-requests.mjs";
import { freshState, openAtlas, startServer } from "../.apm/extensions/cartograph/server.mjs";

test("graph chat prompt names stores and selection without page bodies", () => {
  const body = "SECRET PAGE BODY that must not leak into the session prompt.";
  const prompt = graphChatPrompt("What does the selected page claim?", {
    query: "pulse",
    selectedId: "one::work/shared",
    roots: ["/tmp/one"],
    graph: {
      stores: [{ atlasId: "one", root: "/tmp/one", label: "One" }],
      nodes: [{ id: "one::work/shared", path: "work/shared.md", title: "Shared" }],
    },
    page: { id: "one::work/shared", body },
  });
  assert.match(prompt, /Cartograph chat: What does the selected page claim\?/);
  assert.match(prompt, /Open Atlas stores:\n- one \(\/tmp\/one\)/);
  assert.match(prompt, /Selected node: one::work\/shared \(work\/shared\.md\)/);
  assert.match(prompt, /Search query: pulse/);
  assert.match(prompt, /session file tools/);
  assert.equal(prompt.includes(body), false);
});

test("host send returns only an acceptance, never a UUID answer", async () => {
  const calls = [];
  const routing = { instanceId: "map", requestId: "request-1" };
  const host = {
    send: async (payload) => {
      calls.push(payload);
      return "11111111-2222-4333-8444-555555555555";
    },
    createSession: async () => {
      throw new Error("createSession must not run");
    },
  };
  const reply = await askHostSession(host, "Summarise the selected page", {
    selectedId: "one::index",
    graph: { stores: [{ atlasId: "one", root: "/atlas" }] },
  }, routing);
  assert.deepEqual(calls, [{ prompt: graphChatPrompt("Summarise the selected page", {
    selectedId: "one::index",
    graph: { stores: [{ atlasId: "one", root: "/atlas" }] },
  }, routing) }]);
  assert.deepEqual(reply, { accepted: true });
  assert.match(calls[0].prompt, /"instanceId":"map","requestId":"request-1"/);
  assert.ok(calls[0].prompt.includes(JSON.stringify(CHAT_ACTIVATION_PATH)));
  assert.match(calls[0].prompt, /actionName "update_chat"/);
  assert.match(calls[0].prompt, /meaningful stage changes/);
  assert.match(readFileSync(CHAT_ACTIVATION_PATH, "utf8"), /does NOT fill/);
  assert.match(readFileSync(CHAT_ACTIVATION_PATH, "utf8"), /Searching the Atlas.*Reading pages/);
  await assert.rejects(askHostSession({}, "x", {}), /Host session cannot accept chat/);
  await assert.rejects(askHostSession(host, "x", {}), /routing is required/);
});

test("native chat does not fall back to local search after a session failure", async (t) => {
  const cwd = realpathSync(mkdtempSync(resolve("test/.cartograph-chat-")));
  let entry;
  t.after(async () => { await entry?.close(); rmSync(cwd, { recursive: true, force: true }); });
  const root = join(cwd, "one");
  mkdirSync(root);
  writeFileSync(join(root, "SCHEMA.json"), JSON.stringify({ atlas_id: "one" }));
  writeFileSync(join(root, "index.md"), "# Pulse\n\nA decision about cadence.");
  const state = freshState(cwd, { skipIntro: true });
  openAtlas(state, root);
  state.phase = "map";
  state.selectedId = state.graph.nodes[0].id;
  let sent = 0;
  entry = await startServer("session-chat", state, {
    activity: { platform: "unsupported" },
    graphWatch: { watcherFactory: () => ({ setRoots() {}, close() {} }) },
    onChat: async (text, st, routing) => askHostSession({
      send: async ({ prompt }) => {
        sent += 1;
        assert.match(prompt, /Cartograph chat: What does Pulse say\?/);
        assert.match(prompt, new RegExp(st.selectedId));
        throw new Error("session unavailable");
      },
    }, text, st, routing),
  });
  assert.equal(entry.state.chatMode, "session");
  const headers = { "X-Cartograph-Client": "canvas", "Content-Type": "application/json" };
  const response = await fetch(new URL("/api/ui", entry.url), {
    method: "POST", headers, body: JSON.stringify({ action: "chat", text: "What does Pulse say?" }),
  });
  const snapshot = await response.json();
  assert.equal(snapshot.chatMode, "session");
  assert.equal(snapshot.chat[1].pending, true);
  assert.equal(snapshot.chat[1].text, "Waiting for Copilot…");
  for (let i = 0; i < 20 && entry.state.chat[1]?.pending; i++) await nextTurn();
  assert.equal(sent, 1);
  assert.match(entry.state.chat[1].text, /Session query failed: session unavailable/);
  assert.equal(entry.state.chat[1].text.includes("A decision about cadence"), false);
});

test("HTTP servers without onChat keep local Atlas search", async (t) => {
  const cwd = realpathSync(mkdtempSync(resolve("test/.cartograph-chat-local-")));
  let entry;
  t.after(async () => { await entry?.close(); rmSync(cwd, { recursive: true, force: true }); });
  const root = join(cwd, "one");
  mkdirSync(root);
  writeFileSync(join(root, "SCHEMA.json"), JSON.stringify({ atlas_id: "one" }));
  writeFileSync(join(root, "index.md"), "# Pulse\n\nA decision about cadence.");
  const state = freshState(cwd, { skipIntro: true });
  openAtlas(state, root);
  state.phase = "map";
  entry = await startServer("local-chat", state, {
    activity: { platform: "unsupported" },
    graphWatch: { watcherFactory: () => ({ setRoots() {}, close() {} }) },
  });
  assert.equal(entry.state.chatMode, "local");
  const headers = { "X-Cartograph-Client": "canvas", "Content-Type": "application/json" };
  await fetch(new URL("/api/ui", entry.url), {
    method: "POST", headers, body: JSON.stringify({ action: "chat", text: "cadence" }),
  });
  for (let i = 0; i < 20 && entry.state.chat[1]?.pending; i++) await nextTurn();
  assert.match(entry.state.chat[1].text, /cadence|Pulse/);
  assert.equal(entry.state.chat[1].pending, false);
});

test("native entrypoint binds chat to the joined session", () => {
  const source = readFileSync(new URL("../.apm/extensions/cartograph/extension.mjs", import.meta.url), "utf8");
  assert.match(source, /askHostSession\(session,/);
  assert.equal(source.includes("createSession"), false);
  assert.equal(source.includes("answerQuery"), false);
});

function requestsFixture(t) {
  const state = { chat: [] };
  const timers = new Map();
  let broadcasts = 0;
  let timerId = 0;
  const requests = createChatRequests(state, {
    onChange: () => broadcasts++,
    schedule: (fn, ms) => {
      assert.equal(ms, CHAT_TIMEOUT_MS);
      const id = ++timerId;
      timers.set(id, fn);
      return id;
    },
    unschedule: (id) => timers.delete(id),
  });
  t.after(() => requests.close());
  return { state, requests, timers, broadcasts: () => broadcasts };
}

test("requests stay pending after dispatch and accept only correlated, idempotent replies", (t) => {
  const { requests, state, timers, broadcasts } = requestsFixture(t);
  const first = requests.begin("first");
  const second = requests.begin("second");
  assert.notEqual(first, second);
  assert.equal(timers.size, 2);
  assert.equal(state.chat[1].status, "queued");
  assert.equal(state.chat[1].pending, true);
  assert.equal(requests.update(second, { status: "working" }).ok, true);
  const changed = broadcasts();
  requests.update(second, { status: "working" });
  assert.equal(broadcasts(), changed, "Repeated progress does not reset animation or timers");
  const reply = { status: "answered", text: "Second answer" };
  requests.update(second, reply);
  assert.equal(state.chat[1].pending, true);
  assert.equal(state.chat[3].text, "Second answer");
  assert.equal(state.chat[3].pending, false);
  assert.equal(timers.size, 1);
  requests.fail(second, new Error("late send failure"));
  assert.equal(state.chat[3].text, "Second answer", "Late send failure cannot overwrite delivered answer");
  assert.equal(requests.update(second, reply).duplicate, true);
  assert.throws(() => requests.update(second, { status: "answered", text: "Different answer" }), { code: "chat_request_finished" });
  assert.throws(() => requests.update(second, { status: "working" }), { code: "chat_request_finished" });
  requests.update(first, { status: "failed", text: "Unable to read page" });
  assert.equal(state.chat[1].status, "failed");
  assert.equal(timers.size, 0);
});

test("chat updates reject invalid, foreign, expired, trimmed and closed requests", (t) => {
  const { requests, state, timers } = requestsFixture(t);
  const first = requests.begin("first");
  for (const input of [
    { status: "unknown" }, { status: "answered", text: "" }, { status: "answered", text: "  " },
    { status: "failed" }, { status: "answered", text: "é".repeat(MAX_CHAT_REPLY_BYTES) },
  ]) assert.throws(() => requests.update(first, input), { code: "invalid_chat_reply" });
  assert.throws(() => requests.update("foreign-id", { status: "working" }), { code: "chat_request_missing" });
  timers.values().next().value();
  assert.equal(state.chat[1].status, "expired");
  assert.equal(timers.size, 0);
  assert.throws(() => requests.update(first, { status: "answered", text: "Late" }), { code: "chat_request_finished" });
  for (let i = 0; i < 26; i++) requests.begin(`question ${i}`);
  assert.equal(state.chat.length, 50);
  assert.equal(timers.size, 25);
  assert.throws(() => requests.update(first, { status: "working" }), { code: "chat_request_missing" });
  requests.close();
  assert.equal(timers.size, 0);
  assert.ok(state.chat.filter((m) => m.role === "graph").every((m) => !m.pending && m.status === "cancelled"));
  assert.throws(() => requests.update(state.chat[1].id, { status: "working" }), { code: "chat_closed" });
  assert.throws(() => requests.begin("after close"), { code: "chat_closed" });
});

test("working labels advance only their request, deduplicate and retain the original deadline", (t) => {
  const { requests, state, timers, broadcasts } = requestsFixture(t);
  const first = requests.begin("first");
  const second = requests.begin("second");
  const deadlines = [...timers.values()];
  for (const [index, text] of ["Searching the Atlas", "Reading pages", "Preparing answer"].entries()) {
    assert.equal(requests.update(first, { status: "working", text }).ok, true);
    assert.equal(state.chat[1].progress, text);
    assert.equal(state.chat[1].text, text);
    assert.equal(state.chat[1].pending, true);
    assert.equal(state.chat[3].status, "queued");
    assert.equal(state.chat[3].progress, undefined);
    assert.equal(state.chat.length, 4);
    assert.equal(broadcasts(), index + 1);
    requests.update(first, { status: "working", text: ` ${text} ` });
    requests.update(first, { status: "working" });
    assert.equal(broadcasts(), index + 1, "duplicate or omitted labels preserve the current stage");
    assert.deepEqual([...timers.values()], deadlines);
  }
  requests.update(first, { status: "answered", text: "Final answer" });
  assert.equal(state.chat[1].progress, undefined);
  assert.equal(state.chat[1].text, "Final answer");
  assert.throws(() => requests.update(first, { status: "working", text: "Late stage" }), { code: "chat_request_finished" });
  requests.update(second, { status: "working", text: "Reading pages" });
  deadlines[1]();
  assert.equal(state.chat[3].status, "expired");
  assert.equal(state.chat[3].progress, undefined);
  assert.equal(timers.size, 0);
});

test("progress validates single-line UTF-8 bounds and is cleared on failure or close", (t) => {
  const { requests, state, broadcasts } = requestsFixture(t);
  const first = requests.begin("first");
  for (const text of ["", "  ", null, 3, {}, "Reading\npages", "Reading\rpages",
    "x".repeat(MAX_CHAT_PROGRESS_BYTES + 1), "é".repeat(MAX_CHAT_PROGRESS_BYTES / 2 + 1)]) {
    assert.throws(() => requests.update(first, { status: "working", text }), { code: "invalid_chat_reply" });
  }
  assert.equal(state.chat[1].status, "queued");
  assert.equal(broadcasts(), 0);
  requests.update(first, { status: "working", text: "é".repeat(MAX_CHAT_PROGRESS_BYTES / 2) });
  requests.update(first, { status: "failed", text: "Read failed" });
  assert.equal(state.chat[1].progress, undefined);
  const second = requests.begin("second");
  requests.update(second, { status: "working", text: "Reading pages" });
  requests.close();
  assert.equal(state.chat[3].progress, undefined);
  assert.equal(state.chat[3].status, "cancelled");
});
