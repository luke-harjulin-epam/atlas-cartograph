import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { answerQuery, searchAtlas } from "../.apm/extensions/cartograph/atlas/chat.mjs";
import {
  clearListing,
  loadCombinedGraphs,
  loadFullGraph,
  loadGraph,
  loadPage,
  loadPageFromRoots,
} from "../.apm/extensions/cartograph/atlas/scan.mjs";

function workspace(t) {
  const cwd = realpathSync(mkdtempSync(resolve("test/.atlas-pages-")));
  t.after(() => {
    clearListing();
    rmSync(cwd, { recursive: true, force: true });
  });
  return cwd;
}

function store(cwd, name) {
  const root = join(cwd, name);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "SCHEMA.json"), JSON.stringify({ atlas_id: name }));
  return root;
}

function page(root, path, title, body = "") {
  const file = join(root, path);
  mkdirSync(resolve(file, ".."), { recursive: true });
  writeFileSync(file, `---\ntitle: ${title}\n---\n${body}\n`);
}

test("page identifiers reject traversal and absolute paths without basename fallback", (t) => {
  const cwd = workspace(t);
  const root = store(cwd, "one");
  page(cwd, "secret.md", "Outside", "Never expose this outside text.");
  page(root, "work/secret.md", "Decoy", "Never use a basename fallback for an invalid ID.");
  const invalid = [
    "../secret", "../secret.md", "./../secret", "work/../../secret", "work/../secret",
    "..\\secret", "work\\..\\..\\secret.md", "/secret", "\\secret",
    join(cwd, "secret.md"), "C:\\secret.md", "C:/secret.md", "C:secret.md",
    "\\\\host\\share\\secret.md", "//host/share/secret.md", "secret\0.md", "work/...md",
  ];
  for (const id of invalid) {
    assert.equal(loadPage(root, id, cwd), null, id);
    assert.equal(loadPage(root, `one::${id}`, cwd), null, `one::${id}`);
    assert.equal(loadPageFromRoots([root], id, cwd), null, id);
  }
  for (const id of ["", ".", "::secret", "missing/secret"]) {
    assert.equal(loadPage(root, id, cwd), null, id);
  }
  assert.equal(loadPage(root, "secret", cwd)?.path, "work/secret.md");
});

test("ordinary page IDs, Markdown links and basename aliases still load", (t) => {
  const cwd = workspace(t);
  const root = store(cwd, "one");
  page(root, "index.md", "Index", "[Task](./work/task.md)\n[[task]]");
  page(root, "work/task.md", "Task", "The task content is available.");
  for (const id of ["work/task", "work/task.md", "./work/task.md", "work\\task.md", "task", "one::work/task"]) {
    const result = loadPage(root, id, cwd);
    assert.equal(result?.path, "work/task.md", id);
    assert.equal(result.body, "The task content is available.");
  }
  const graph = loadFullGraph(root, cwd, { strict: true });
  assert.equal(graph.complete, true);
  assert.equal(graph.nodes.length, 2);
  assert.ok(graph.edges.some((edge) => edge.source === "index" && edge.target === "work/task"));
});

test("page reads and scans reject outside symlinks but allow internal aliases and symlink mounts", (t) => {
  const cwd = workspace(t);
  const root = store(cwd, "one");
  const outside = store(cwd, "one-sibling");
  page(outside, "secret.md", "Outside secret", "Outside content must never be read.");
  page(root, "index.md", "Index");
  page(root, "work/task.md", "Task", "Internal task content.");
  page(root, "work/leak.md", "Decoy", "Do not turn an outside symlink into an alias.");
  symlinkSync(join(outside, "secret.md"), join(root, "leak.md"), "file");
  symlinkSync(outside, join(root, "external"), "dir");
  symlinkSync(join(root, "work/task.md"), join(root, "alias.md"), "file");
  symlinkSync(join(root, "work"), join(root, "linked-work"), "dir");
  symlinkSync(root, join(root, "work", "cycle"), "dir");
  symlinkSync("loop-b.md", join(root, "loop-a.md"), "file");
  symlinkSync("loop-a.md", join(root, "loop-b.md"), "file");
  const mount = join(cwd, "mounted");
  symlinkSync(root, mount, "dir");

  for (const mountedRoot of [root, mount]) {
    for (const id of ["leak", "leak.md", "external/secret", "loop-a", "loop-b"]) {
      assert.equal(loadPage(mountedRoot, id, cwd), null, id);
    }
    for (const id of ["work/task", "alias", "linked-work/task"]) {
      assert.equal(loadPage(mountedRoot, id, cwd)?.body, "Internal task content.", id);
    }
    const graph = loadFullGraph(mountedRoot, cwd, { strict: true });
    assert.equal(graph.complete, true);
    assert.deepEqual(graph.nodes.map((node) => node.path).sort(), [
      "alias.md", "index.md", "linked-work/leak.md", "linked-work/task.md", "work/leak.md", "work/task.md",
    ]);
    assert.ok(graph.nodes.every((node) => node.storeRoot === mountedRoot));
  }
});

test("cached graph listings recheck symlink confinement before later batches read files", (t) => {
  const cwd = workspace(t);
  const root = store(cwd, "one");
  page(root, "a.md", "First");
  page(root, "z.md", "Last");
  page(cwd, "outside.md", "Outside", "Never parse this replacement target.");
  const first = loadGraph(root, { offset: 0, limit: 1, strict: true }, cwd);
  assert.equal(first.nextOffset, 1);
  rmSync(join(root, "z.md"));
  symlinkSync(join(cwd, "outside.md"), join(root, "z.md"), "file");
  const last = loadGraph(root, { offset: first.nextOffset, limit: 1, strict: true }, cwd);
  assert.deepEqual(last.nodes, []);
  assert.equal(last.complete, true);
});

test("schema symlinks cannot read metadata outside the mounted root", (t) => {
  const cwd = workspace(t);
  const root = store(cwd, "one");
  const outside = store(cwd, "private-id");
  page(root, "index.md", "Index");
  rmSync(join(root, "SCHEMA.json"));
  symlinkSync(join(outside, "SCHEMA.json"), join(root, "SCHEMA.json"), "file");
  const graph = loadFullGraph(root, cwd, { strict: true });
  assert.notEqual(graph.store.atlasId, "private-id");
  assert.equal(graph.nodes.length, 1);
});

test("qualified queries use their own Atlas for snippets, lead excerpts and Markdown navigation", (t) => {
  const cwd = workspace(t);
  const first = store(cwd, "one");
  const second = store(cwd, "two");
  page(first, "work/shared.md", "Shared", "First Atlas evidence is distinct and private to one.");
  page(second, "work/shared.md", "Shared Second", "Second Atlas evidence is the correct opening sentence.");
  const roots = [first, second];
  const graph = loadCombinedGraphs(roots, cwd, { strict: true });
  const state = { root: first, roots, cwd, graph };
  const hits = searchAtlas(state, "shared");
  assert.match(hits.find((hit) => hit.id === "one::work/shared").snippet, /^First Atlas/);
  assert.match(hits.find((hit) => hit.id === "two::work/shared").snippet, /^Second Atlas/);
  const reply = answerQuery(state, "second");
  assert.equal(reply.hits[0].id, "two::work/shared");
  assert.match(reply.text, /^\*\*Shared Second\*\* — Second Atlas evidence is the correct opening sentence\./);
  assert.match(reply.text, /\[Shared Second\]\(two::work\/shared\)/);
  assert.doesNotMatch(reply.text, /First Atlas|\]\(work\/shared\.md\)/);
  assert.equal(loadPage(first, "two::work/shared", cwd), null);
  assert.equal(loadPageFromRoots(roots, "two::work/shared", cwd)?.storeRoot, second);
  const withoutLegacyRoot = answerQuery({ roots, cwd, graph }, "second");
  assert.equal(withoutLegacyRoot.text, reply.text);
});

test("missing qualified pages never fall back to other mounts, including stale query results", (t) => {
  const cwd = workspace(t);
  const first = store(cwd, "one");
  const second = store(cwd, "two");
  page(first, "work/shared.md", "Shared", "First Atlas content must not appear for the second.");
  page(second, "work/shared.md", "Shared Second", "Second Atlas content.");
  const roots = [first, second];
  const graph = loadCombinedGraphs(roots, cwd, { strict: true });
  rmSync(join(second, "work/shared.md"));
  for (const id of ["two::work/shared", "unknown::work/shared", "::work/shared"]) {
    assert.equal(loadPageFromRoots(roots, id, cwd), null, id);
  }
  const secondLabel = graph.stores.find((item) => item.root === second).label;
  assert.equal(loadPageFromRoots(roots, `${secondLabel}::work/shared`, cwd), null);
  const state = { root: first, roots, cwd, graph };
  const hits = searchAtlas(state, "second");
  assert.equal(hits[0].snippet, "");
  const reply = answerQuery(state, "second");
  assert.doesNotMatch(reply.text, /First Atlas content/);
  assert.match(reply.text, /\]\(two::work\/shared\)/);
  assert.equal(loadPageFromRoots([second, first], "work/shared", cwd)?.storeRoot, first);
});

test("single-Atlas query links retain ordinary Markdown page paths", (t) => {
  const cwd = workspace(t);
  const root = store(cwd, "one");
  page(root, "work/task.md", "Task", "A useful task opening sentence.");
  const graph = loadFullGraph(root, cwd);
  const reply = answerQuery({ root, cwd, graph }, "task");
  assert.match(reply.text, /\[Task\]\(work\/task\.md\)/);
});

test("full graph scans retain all 3200 pages and relationships beyond forty batches", (t) => {
  const cwd = workspace(t);
  const root = store(cwd, "large");
  const count = 3200;
  const id = (i) => `page-${String(i).padStart(4, "0")}`;
  for (let i = 0; i < count; i++) {
    const links = i === count - 1 ? `[[${id(0)}]] [[${id(3144)}]]` : `[[${id(i + 1)}]]`;
    page(root, `${id(i)}.md`, `Page ${i}`, links);
  }
  const graph = loadFullGraph(root, cwd, { strict: true });
  assert.equal(graph.complete, true);
  assert.equal(graph.nextOffset, null);
  assert.equal(graph.scanned, count);
  assert.equal(graph.total, count);
  assert.equal(graph.store.pages, count);
  assert.deepEqual(graph.nodes.map((node) => node.id), Array.from({ length: count }, (_, i) => id(i)));
  assert.equal(graph.edges.length, count + 1);
  const edges = new Set(graph.edges.map((edge) => `${edge.source}->${edge.target}`));
  for (let i = 0; i < count - 1; i++) assert.ok(edges.has(`${id(i)}->${id(i + 1)}`));
  assert.ok(edges.has(`${id(count - 1)}->${id(0)}`));
  assert.ok(edges.has(`${id(count - 1)}->${id(3144)}`));
});
