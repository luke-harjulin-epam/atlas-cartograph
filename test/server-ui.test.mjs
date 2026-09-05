import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { request } from "node:http";
import { join } from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import test from "node:test";
import { addAtlas, dropAtlas, freshState, openAtlas, selectNode, startServer } from "../.apm/extensions/cartograph/server.mjs";

function fixture(t) {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "cartograph-ui-")));
  let entry;
  t.after(async () => { await entry?.close(); rmSync(cwd, { recursive: true, force: true }); });
  const roots = ["one", "two"].map((id) => {
    const root = join(cwd, id);
    mkdirSync(join(root, "work"), { recursive: true });
    writeFileSync(join(root, "SCHEMA.json"), JSON.stringify({ atlas_id: id }));
    writeFileSync(join(root, "index.md"), `# ${id}\n\n[[work/shared]]`);
    writeFileSync(join(root, "work", "shared.md"), `---\ntitle: Shared title\n---\n\nBody from ${id}.`);
    return root;
  });
  writeFileSync(join(roots[0], "work", "unique.md"), "# Unique to first");
  const state = freshState(cwd, { skipIntro: true });
  openAtlas(state, roots[0]);
  addAtlas(state, roots[1]);
  state.phase = "map";
  return {
    state, roots,
    start: async (options = {}) => {
      entry = await startServer("ui-review", state, {
        activity: { platform: "unsupported" },
        graphWatch: { watcherFactory: () => ({ setRoots() {}, close() {} }) },
        ...options,
      });
      return entry;
    },
  };
}

test("unqualified links prefer the currently selected Atlas; explicit IDs override it", (t) => {
  const { state } = fixture(t);
  for (const link of ["work/shared", "./work/shared.md", "shared", "Shared title"]) {
    selectNode(state, "two::index");
    selectNode(state, link);
    assert.equal(state.selectedId, "two::work/shared", link);
    assert.equal(state.page.body, "Body from two.");
  }
  selectNode(state, "one::work/shared");
  assert.equal(state.selectedId, "one::work/shared");
  assert.equal(state.page.body, "Body from one.");
  selectNode(state, "atlas://two/work/shared");
  assert.equal(state.selectedId, "two::work/shared");
  assert.equal(state.page.body, "Body from two.");
  selectNode(state, "unique");
  assert.equal(state.selectedId, "one::work/unique", "fall back only when the selected Atlas has no match");
  selectNode(state, "");
  selectNode(state, "shared");
  assert.equal(state.selectedId, "one::work/shared", "no current selection preserves first-match behavior");
});

test("explicit Atlas page selection works with a single mounted store", (t) => {
  const { state, roots } = fixture(t);
  openAtlas(state, roots[0]);
  for (const id of ["atlas://one/work/shared", "atlas://one/work/shared.md", "one::work/shared"]) {
    selectNode(state, id);
    assert.equal(state.linkError, null, id);
    assert.equal(state.selectedId, "work/shared", "selection must use the graph's actual local ID");
    assert.equal(state.page.body, "Body from one.");
  }
  selectNode(state, "atlas://two/work/shared");
  assert.match(state.linkError, /No page/);
  assert.equal(state.selectedId, "work/shared");
});

test("duplicate Atlas mounts fail visibly without altering the mounted graph or selection", async (t) => {
  const { state, roots, start } = fixture(t);
  openAtlas(state, roots[0]);
  state.phase = "map";
  selectNode(state, "work/shared");
  const graph = state.graph;
  const page = state.page;
  const changes = state.graphChanges;
  writeFileSync(join(roots[1], "SCHEMA.json"), '{"atlas_id":"one"}');
  const entry = await start();
  const response = await fetch(new URL("/api/ui", entry.url), {
    method: "POST",
    headers: { "X-Cartograph-Client": "canvas", "Content-Type": "application/json" },
    body: JSON.stringify({ action: "add", root: roots[1] }),
  });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /Duplicate Atlas key "one"/);
  assert.match(state.error, /Duplicate Atlas key "one"/, "the SSE snapshot must surface the failure");
  assert.equal(state.graph, graph);
  assert.equal(state.page, page);
  assert.equal(state.graphChanges, changes);
  assert.equal(state.selectedId, "work/shared");
  assert.equal(state.phase, "map");
  assert.deepEqual(state.roots, [roots[0]]);
});

test("dropping a store leaves state intact if the remaining stores have conflicting keys", (t) => {
  const { state, roots } = fixture(t);
  const third = join(state.cwd, "three");
  mkdirSync(third);
  writeFileSync(join(third, "SCHEMA.json"), '{"atlas_id":"three"}');
  writeFileSync(join(third, "index.md"), "# Three");
  addAtlas(state, third);
  selectNode(state, "three::index");
  const baseline = JSON.stringify(state);
  writeFileSync(join(roots[1], "SCHEMA.json"), '{"atlas_id":"one"}');
  assert.throws(() => dropAtlas(state, third), /Duplicate Atlas key "one"/);
  assert.equal(JSON.stringify(state), baseline);
  dropAtlas(state, roots[1]);
  assert.deepEqual(state.roots, [roots[0], third], "removing the conflicting store remains possible");
});

for (const order of [[0, 1], [1, 0]]) {
  for (const failFirst of [false, true]) {
    test(`concurrent chat replies stay paired with their prompts (${order}, failure=${failFirst})`, async (t) => {
      const { state, start } = fixture(t);
      const requests = new Map();
      const entry = await start({ onChat: (text) => {
        const deferred = Promise.withResolvers();
        requests.set(text, deferred);
        return deferred.promise;
      } });
      for (const text of ["first", "second"]) {
        const response = await fetch(new URL("/api/ui", entry.url), {
          method: "POST",
          headers: { "X-Cartograph-Client": "canvas", "Content-Type": "application/json" },
          body: JSON.stringify({ action: "chat", text }),
        });
        assert.equal(response.status, 200);
        await response.json();
      }
      assert.equal(requests.size, 2);
      const placeholders = [state.chat[1], state.chat[3]];
      for (const [step, index] of order.entries()) {
        const text = ["first", "second"][index];
        if (failFirst && index === 0) requests.get(text).reject(new Error("first failure"));
        else requests.get(text).resolve({ text: `Answer to ${text}`, hits: [{ id: text }] });
        await nextTurn();
        assert.equal(placeholders[index].pending, false);
        assert.equal(placeholders[index].text, failFirst && index === 0
          ? "Session query failed: first failure" : `Answer to ${text}`);
        assert.deepEqual(placeholders[index].hits, failFirst && index === 0 ? [] : [{ id: text }]);
        if (step === 0) assert.equal(placeholders[1 - index].pending, true);
      }
      assert.equal(state.chat.length, 4);
      assert.equal(state.chat[1], placeholders[0]);
      assert.equal(state.chat[3], placeholders[1]);
    });
  }
}

test("trimmed chat requests cannot overwrite newer placeholders or reappear in history", async (t) => {
  const { state, start } = fixture(t);
  const requests = [];
  const entry = await start({ onChat: () => {
    const deferred = Promise.withResolvers();
    requests.push(deferred);
    return deferred.promise;
  } });
  for (let i = 0; i < 27; i++) {
    const response = await fetch(new URL("/api/ui", entry.url), {
      method: "POST",
      headers: { "X-Cartograph-Client": "canvas", "Content-Type": "application/json" },
      body: JSON.stringify({ action: "chat", text: `Prompt ${i}` }),
    });
    assert.equal(response.status, 200);
    await response.json();
  }
  assert.equal(state.chat.length, 50);
  assert.equal(state.chat[0].text, "Prompt 2");
  const baseline = JSON.stringify(state.chat);
  requests[0].resolve({ text: "Trimmed answer" });
  requests[1].reject(new Error("Trimmed failure"));
  await nextTurn();
  assert.equal(JSON.stringify(state.chat), baseline);
  for (const deferred of requests.slice(2)) deferred.resolve({ text: "Retained answer" });
  await nextTurn();
  assert.ok(state.chat.filter((item) => item.role === "graph").every((item) => !item.pending));
});

test("cross-origin UI requests cannot mutate state, including text/plain JSON", async (t) => {
  const { state, roots, start } = fixture(t);
  const entry = await start();
  const baseline = JSON.stringify(state);
  const actions = [
    { action: "open", root: roots[1] }, { action: "add", root: "/arbitrary" },
    { action: "drop", root: roots[0] }, { action: "chat", text: "hello" },
    { action: "phase", phase: "welcome" }, { action: "query", query: "injected" },
    { action: "layers", layers: { work: false } }, { action: "select", nodeId: "shared" },
    { action: "grouping", grouping: "proximity" }, { action: "preview", open: true },
  ];
  for (const action of actions) {
    const response = await fetch(new URL("/api/ui", entry.url), {
      method: "POST", headers: { "Content-Type": "text/plain", Origin: "https://untrusted.example" },
      body: JSON.stringify(action),
    });
    assert.equal(response.status, 403, action.action);
    assert.match((await response.json()).error, /same-origin/);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    assert.equal(JSON.stringify(state), baseline, action.action);
  }
});

test("canvas routes share origin, fetch-site, host and custom-header protection", async (t) => {
  const { state, roots, start } = fixture(t);
  const entry = await start();
  const headers = { "X-Cartograph-Client": "canvas", "Content-Type": "application/json" };
  const routes = ["/api/ui", "/api/probe", "/api/page", "/api/graph"];
  for (const route of routes) {
    const method = route === "/api/graph" ? "GET" : "POST";
    const body = method === "POST" ? JSON.stringify({ action: "query", query: "untrusted", root: roots[0], nodeId: "index" }) : undefined;
    for (const invalid of [
      { "Content-Type": "application/json" },
      { ...headers, Origin: "https://untrusted.example" },
      { ...headers, Origin: "null" },
      { ...headers, "Sec-Fetch-Site": "cross-site" },
      { ...headers, "Sec-Fetch-Site": "same-site" },
    ]) {
      const response = await fetch(new URL(route, entry.url), { method, headers: invalid, body });
      assert.equal(response.status, 403, `${route}: ${JSON.stringify(invalid)}`);
      await response.json();
    }
    // Fetch replaces Host; use the HTTP client to exercise rebinding protection.
    const hostStatus = await new Promise((resolve, reject) => {
      const req = request(new URL(route, entry.url), {
        method, headers: { ...headers, Host: "untrusted.example" },
      }, (res) => {
        res.resume();
        res.on("error", reject);
        res.on("end", () => resolve(res.statusCode));
      });
      req.on("error", reject);
      req.end(body);
    });
    assert.equal(hostStatus, 403, `${route}: unexpected Host`);
    if (method === "POST") {
      const response = await fetch(new URL(route, entry.url), {
        method, headers: { ...headers, "Content-Type": "text/plain" }, body,
      });
      assert.equal(response.status, 415);
      await response.json();
    }
  }
  assert.equal(state.query, "");
});

test("same-origin canvas calls still load pages, inspect roots and change selection", async (t) => {
  const { state, roots, start } = fixture(t);
  const entry = await start();
  const headers = {
    "X-Cartograph-Client": "canvas", "Content-Type": "application/json",
    Origin: new URL(entry.url).origin, "Sec-Fetch-Site": "same-origin",
  };
  const post = async (path, body) => {
    const response = await fetch(new URL(path, entry.url), { method: "POST", headers, body: JSON.stringify(body) });
    assert.equal(response.status, 200);
    return response.json();
  };
  await post("/api/ui", { action: "select", nodeId: "two::index" });
  await post("/api/ui", { action: "select", nodeId: "shared" });
  assert.equal(state.page.body, "Body from two.");
  assert.equal((await post("/api/probe", { root: roots[1] })).available, true);
  assert.equal((await post("/api/page", { root: roots[1], nodeId: "work/shared" })).body, "Body from two.");
  const graph = await fetch(new URL(`/api/graph?root=${encodeURIComponent(roots[1])}`, entry.url), { headers });
  assert.equal(graph.status, 200);
  assert.equal((await graph.json()).store.atlasId, "two");
});

test("browser forwards link targets to the server and marks canvas requests", () => {
  const app = readFileSync(new URL("../.apm/extensions/cartograph/public/app.js", import.meta.url), "utf8");
  assert.match(app, /"X-Cartograph-Client": "canvas"/);
  assert.match(app, /function navigateWiki\(target\) \{\s*return post\("select", \{ nodeId: target \}\);/);
});
