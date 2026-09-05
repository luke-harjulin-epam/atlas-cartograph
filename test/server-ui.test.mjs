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

test("mesh sidebar chips retain their Atlas qualifier and do not duplicate the resolved edge", (t) => {
  const { state, roots } = fixture(t);
  writeFileSync(join(roots[0], "index.md"), "# One\n[Remote](atlas://two/work/shared)");
  openAtlas(state, roots[0]);
  addAtlas(state, roots[1]);
  selectNode(state, "one::index");
  assert.deepEqual(state.page.relatesTo, [{ path: "atlas://two/work/shared", kind: "two" }]);
  selectNode(state, state.page.relatesTo[0].path);
  assert.equal(state.selectedId, "two::work/shared");
  assert.equal(state.page.body, "Body from two.");
});

test("frontmatter sidebar references deduplicate qualified edges and keep unresolved targets explicit", (t) => {
  const { state, roots } = fixture(t);
  writeFileSync(join(roots[0], "index.md"), [
    "---", "relates_to:", "  - path: atlas://two/work/shared", "    kind: depends-on",
    "  - path: atlas://missing/work/shared", "    kind: related", "---", "# One",
  ].join("\n"));
  openAtlas(state, roots[0]);
  addAtlas(state, roots[1]);
  selectNode(state, "one::index");
  assert.deepEqual(state.page.relatesTo, [
    { path: "atlas://two/work/shared", kind: "depends-on" },
    { path: "atlas://missing/work/shared", kind: "related" },
  ]);
  selectNode(state, state.page.relatesTo[1].path);
  assert.match(state.linkError, /No page/);
  assert.equal(state.selectedId, "one::index");
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
  const routes = ["/api/ui", "/api/probe", "/api/page", "/api/graph", "/api/bootstrap", "/events"];
  selectNode(state, "two::work/shared");
  const baseline = JSON.stringify(state);
  for (const route of routes) {
    const method = ["/api/graph", "/api/bootstrap", "/events"].includes(route) ? "GET" : "POST";
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
  assert.equal(JSON.stringify(state), baseline, "unauthorised requests must not trigger discovery or sync");
  assert.equal(entry.clients.size, 0, "unauthorised requests must not open streams");
});

test("native EventSource requires same-origin browser metadata and the canonical Host", async (t) => {
  const { state, start } = fixture(t);
  const entry = await start();
  const headers = { Accept: "text/event-stream", "Sec-Fetch-Site": "same-origin" };
  for (const invalid of [
    { Accept: "text/event-stream" },
    { ...headers, "Sec-Fetch-Site": "none" },
    { ...headers, "Sec-Fetch-Site": "same-site" },
    { ...headers, "Sec-Fetch-Site": "cross-site" },
    { ...headers, Origin: "https://untrusted.example" },
    { ...headers, Origin: "null" },
    { "Sec-Fetch-Site": "same-origin" },
  ]) {
    const abort = new AbortController();
    t.after(() => abort.abort());
    const response = await fetch(new URL("/events", entry.url), { headers: invalid, signal: abort.signal });
    assert.equal(response.status, 403, JSON.stringify(invalid));
    await response.json();
  }
  const status = await new Promise((resolve, reject) => {
    const req = request(new URL("/events", entry.url), {
      headers: { ...headers, Host: "untrusted.example" },
    }, (res) => {
      res.resume();
      res.on("error", reject);
      res.on("end", () => resolve(res.statusCode));
    });
    req.on("error", reject);
    req.end();
  });
  assert.equal(status, 403, "same-origin metadata cannot bypass the Host check");
  assert.equal(entry.clients.size, 0);
  for (const path of ["/api/bootstrap", "/api/activity/connection"]) {
    const response = await fetch(new URL(path, entry.url), { headers });
    assert.equal(response.status, 403, "the headerless exception is only for EventSource");
    await response.json();
  }
  selectNode(state, "two::work/shared");
  for (const valid of [headers, { ...headers, Origin: new URL(entry.url).origin }]) {
    const abort = new AbortController();
    t.after(() => abort.abort());
    const response = await fetch(new URL("/events", entry.url), { headers: valid, signal: abort.signal });
    assert.equal(response.status, 200);
    const reader = response.body.getReader();
    const initial = new TextDecoder().decode((await reader.read()).value);
    assert.match(initial, /Body from two/);
    await reader.cancel();
    abort.abort();
  }
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
  const bootstrap = await fetch(new URL("/api/bootstrap", entry.url), { headers });
  assert.equal(bootstrap.status, 200);
  assert.equal((await bootstrap.json()).state.page.body, "Body from two.");
});

test("canvas POST routes reject malformed and non-object JSON without changing state", async (t) => {
  const { state, start } = fixture(t);
  const entry = await start();
  const baseline = JSON.stringify(state);
  const headers = { "X-Cartograph-Client": "canvas", "Content-Type": "application/json" };
  for (const path of ["/api/ui", "/api/probe", "/api/page"]) {
    for (const body of ["", " ", '{"private":"do-not-echo"', "null", "[]", "true", "42", '"text"']) {
      const response = await fetch(new URL(path, entry.url), { method: "POST", headers, body });
      assert.equal(response.status, 400, `${path}: ${body}`);
      const error = (await response.json()).error;
      assert.match(error, /JSON/);
      assert.ok(!error.includes("do-not-echo"));
      assert.equal(JSON.stringify(state), baseline);
    }
  }
});

test("layer mutations have monotonic revisions shared by HTTP replies and snapshots", async (t) => {
  const { start } = fixture(t);
  const entry = await start();
  const headers = { "X-Cartograph-Client": "canvas", "Content-Type": "application/json" };
  const bootstrap = async () => (await (await fetch(new URL("/api/bootstrap", entry.url), { headers })).json()).state;
  assert.equal((await bootstrap()).layersRevision, 0);
  for (const [index, layers] of [{ relations: false }, { sources: false }, { relations: false }].entries()) {
    const response = await fetch(new URL("/api/ui", entry.url), {
      method: "POST", headers, body: JSON.stringify({ action: "layers", layers }),
    });
    assert.equal(response.status, 200);
    const state = await response.json();
    assert.equal(state.layersRevision, index + 1);
    assert.equal(state.layers.relations, false);
    if (index > 0) assert.equal(state.layers.sources, false);
    assert.equal((await bootstrap()).layersRevision, state.layersRevision);
  }
});

test("canvas POST routes accept exactly one MiB and reject larger byte payloads", async (t) => {
  const { state, roots, start } = fixture(t);
  const entry = await start();
  const headers = { "X-Cartograph-Client": "canvas", "Content-Type": "application/json" };
  const limit = 1024 * 1024;
  for (const path of ["/api/ui", "/api/probe", "/api/page"]) {
    const object = { action: "query", query: "safe", root: roots[0], nodeId: "index" };
    const json = JSON.stringify(object);
    const body = json + " ".repeat(limit - Buffer.byteLength(json));
    const accepted = await fetch(new URL(path, entry.url), { method: "POST", headers, body });
    assert.equal(accepted.status, 200, path);
    await accepted.json();
    const baseline = JSON.stringify(state);
    for (const oversized of [body + " ", JSON.stringify({ padding: "\u00e9".repeat(limit / 2) })]) {
      const response = await fetch(new URL(path, entry.url), { method: "POST", headers, body: oversized });
      assert.equal(response.status, 413, path);
      assert.match((await response.json()).error, /1 MiB/);
      assert.equal(JSON.stringify(state), baseline);
    }
  }
});

test("chunked requests receive 413 as soon as the byte limit is crossed, without waiting for EOF", async (t) => {
  const { state, start } = fixture(t);
  const entry = await start();
  const baseline = JSON.stringify(state);
  for (const path of ["/api/ui", "/api/probe", "/api/page"]) {
    const response = await new Promise((resolve, reject) => {
      const req = request(new URL(path, entry.url), {
        method: "POST",
        headers: {
          "X-Cartograph-Client": "canvas", "Content-Type": "application/json",
          "Transfer-Encoding": "chunked",
        },
      }, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { body += chunk; });
        res.on("error", reject);
        res.on("end", () => resolve({ status: res.statusCode, body, ended: req.writableEnded }));
      });
      t.after(() => req.destroy());
      req.setTimeout(2000, () => req.destroy(new Error("No response before request EOF")));
      req.on("error", reject);
      req.write('{"padding":"');
      for (let i = 0; i < 17; i++) req.write(Buffer.alloc(64 * 1024, 97));
    });
    assert.equal(response.status, 413, path);
    assert.equal(response.ended, false);
    assert.match(JSON.parse(response.body).error, /1 MiB/);
    assert.equal(JSON.stringify(state), baseline);
  }
});

test("browser forwards link targets to the server and marks canvas requests", () => {
  const app = readFileSync(new URL("../.apm/extensions/cartograph/public/app.js", import.meta.url), "utf8");
  assert.match(app, /"X-Cartograph-Client": "canvas"/);
  assert.match(app, /function navigateWiki\(target\) \{\s*return post\("select", \{ nodeId: target \}\);/);
  assert.match(app, /fetch\("\/api\/bootstrap", \{ headers: \{ "X-Cartograph-Client": "canvas" \} \}\)/);
});
