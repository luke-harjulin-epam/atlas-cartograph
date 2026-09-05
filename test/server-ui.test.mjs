import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { request } from "node:http";
import { join } from "node:path";
import test from "node:test";
import { addAtlas, freshState, openAtlas, selectNode, startServer } from "../.apm/extensions/cartograph/server.mjs";

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
    start: async () => {
      entry = await startServer("ui-review", state, {
        activity: { platform: "unsupported" },
        graphWatch: { watcherFactory: () => ({ setRoots() {}, close() {} }) },
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
