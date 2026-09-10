import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import test from "node:test";
import { askHostSession, graphChatPrompt } from "../.apm/extensions/cartograph/atlas/chat.mjs";
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
  assert.match(prompt, /^Cartograph chat: What does the selected page claim\?/);
  assert.match(prompt, /Open Atlas stores:\n- one \(\/tmp\/one\)/);
  assert.match(prompt, /Selected node: one::work\/shared \(work\/shared\.md\)/);
  assert.match(prompt, /Search query: pulse/);
  assert.match(prompt, /session file tools/);
  assert.equal(prompt.includes(body), false);
});

test("host session chat uses send on the joined session and never loads pages", async () => {
  const calls = [];
  const host = {
    send: async (payload) => {
      calls.push(payload);
      return "The selected page records the pulse decision.";
    },
    createSession: async () => {
      throw new Error("createSession must not run");
    },
  };
  const reply = await askHostSession(host, "Summarise the selected page", {
    selectedId: "one::index",
    graph: { stores: [{ atlasId: "one", root: "/atlas" }] },
  });
  assert.deepEqual(calls, [{ prompt: graphChatPrompt("Summarise the selected page", {
    selectedId: "one::index",
    graph: { stores: [{ atlasId: "one", root: "/atlas" }] },
  }) }]);
  assert.deepEqual(reply, { text: "The selected page records the pulse decision.", hits: [] });
  await assert.rejects(askHostSession({}, "x", {}), /Host session cannot accept chat/);
  await assert.rejects(askHostSession({ send: async () => "" }, "x", {}), /empty reply/);
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
    onChat: async (text, st) => askHostSession({
      send: async ({ prompt }) => {
        sent += 1;
        assert.match(prompt, /^Cartograph chat: What does Pulse say\?/);
        assert.match(prompt, new RegExp(st.selectedId));
        throw new Error("session unavailable");
      },
    }, text, st),
  });
  assert.equal(entry.state.chatMode, "session");
  const headers = { "X-Cartograph-Client": "canvas", "Content-Type": "application/json" };
  const response = await fetch(new URL("/api/ui", entry.url), {
    method: "POST", headers, body: JSON.stringify({ action: "chat", text: "What does Pulse say?" }),
  });
  const snapshot = await response.json();
  assert.equal(snapshot.chatMode, "session");
  assert.equal(snapshot.chat[1].pending, true);
  assert.equal(snapshot.chat[1].text, "Asking the session…");
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
