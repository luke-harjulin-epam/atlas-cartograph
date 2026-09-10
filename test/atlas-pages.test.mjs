import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { answerQuery, searchAtlas } from "../.apm/extensions/cartograph/atlas/chat.mjs";
import { linkGraph } from "../.apm/extensions/cartograph/atlas/link.mjs";
import { referenceKey } from "../.apm/extensions/cartograph/atlas/resolve.mjs";
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

test("scanning and page loading preserve external destinations and additive source metadata", (t) => {
  const cwd = workspace(t);
  const root = store(cwd, "sources");
  page(root, "guide.md", "Guide");
  const urls = ["https://example.com/spec.md", "https://example.com/spec.md?raw=1&view=all#part.md"];
  writeFileSync(join(root, "index.md"), `---
sources:
  - path: guide.md
    title: Internal guide
  - url: ${urls[0]}
    title: Specification
  - uri: ${urls[1]}
    title: Query and fragment
---\nOriginal preview text.`);
  const graph = loadFullGraph(root, cwd, { strict: true });
  const node = graph.nodes.find((n) => n.id === "index");
  assert.equal(node.sourceCount, 3);
  assert.deepEqual(node.refs.filter((r) => r.kind === "source").map((r) => r.raw), ["guide", ...urls]);
  assert.deepEqual(graph.edges.map(({ source, target, kind }) => ({ source, target, kind })),
    [{ source: "index", target: "guide", kind: "source" }]);
  const loaded = loadPage(root, "index", cwd);
  assert.deepEqual(loaded.sources, ["guide", ...urls]);
  assert.deepEqual(loaded.sourceDetails, [
    { path: "guide", title: "Internal guide" },
    { path: urls[0], title: "Specification" },
    { path: urls[1], title: "Query and fragment" },
  ]);
  assert.equal(loaded.body, "Original preview text.");
});

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
    assert.equal(loadPage(root, `atlas://one/${id}`, cwd), null, `atlas://one/${id}`);
  }
  for (const id of ["", ".", "::secret", "missing/secret", "atlas:///secret", "atlas://one", "atlas://one/"]) {
    assert.equal(loadPage(root, id, cwd), null, id);
  }
  assert.equal(loadPage(root, "secret", cwd)?.path, "work/secret.md");
});

test("ordinary page IDs, Markdown links and basename aliases still load", (t) => {
  const cwd = workspace(t);
  const root = store(cwd, "one");
  page(root, "index.md", "Index", "[Task](./work/task.md)\n[[task]]");
  page(root, "work/task.md", "Task", "The task content is available.");
  for (const id of ["work/task", "work/task.md", "./work/task.md", "work\\task.md", "task", "one::work/task", "atlas://one/work/task.md"]) {
    const result = loadPage(root, id, cwd);
    assert.equal(result?.path, "work/task.md", id);
    assert.equal(result.body, "The task content is available.");
  }
  const graph = loadFullGraph(root, cwd, { strict: true });
  assert.equal(graph.complete, true);
  assert.equal(graph.nodes.length, 2);
  assert.ok(graph.edges.some((edge) => edge.source === "index" && edge.target === "work/task"));
});

test("body links prefer source-directory pages over ambiguous basename aliases", (t) => {
  const cwd = workspace(t);
  const root = store(cwd, "local");
  page(root, "one/task.md", "First task");
  page(root, "two/task.md", "Sibling task");
  page(root, "two/source.md", "Source", "[Task](./task.md)\n[[task]]");
  const graph = loadFullGraph(root, cwd);
  assert.deepEqual(graph.edges.map(({ source, target }) => ({ source, target })), [
    { source: "two/source", target: "two/task" },
  ]);
  assert.ok(graph.nodes.find((node) => node.id === "two/source").refs.some((ref) => ref.raw === "./task.md"));
});

test("explicit relative links are confined exact paths, never missing-target aliases", (t) => {
  const cwd = workspace(t);
  const first = store(cwd, "one");
  const second = store(cwd, "two");
  page(first, "work/task.md", "Decoy");
  page(first, "work/missing.md", "Missing decoy");
  page(first, "nested/task.md", "Sibling");
  page(first, "nested/deep/source.md", "Source", [
    "[Parent](../task.md)",
    "[Internal dots](../deep/../task.md)",
    "[Missing sibling](./task.md)",
    "[Missing folder](./missing/task.md)",
    "[Missing parent](../../missing.md)",
    "[Escape](../../../task.md)",
    "[Absolute](/work/task.md)",
    "[Drive](C:/work/task.md)",
    "[Missing remote sibling](./remote.md)",
  ].join("\n"));
  page(second, "nested/deep/remote.md", "Remote decoy");
  const graph = loadCombinedGraphs([first, second], cwd);
  assert.deepEqual(graph.edges.filter((edge) => edge.source === "one::nested/deep/source")
    .map((edge) => edge.target), ["one::nested/task"]);
});

test("raw graph references resolve confined parent paths without relying on scan normalization", () => {
  const paths = ["one/task", "two/task", "two/deep/source", "two/deep/child/task", "work/task"];
  const nodes = paths.map((id) => ({
    id, localId: id, path: `${id}.md`, atlasKey: "local",
    aliases: [id, id.split("/").at(-1)], refs: [],
  }));
  const source = nodes.find((node) => node.id === "two/deep/source");
  source.refs = [
    ...["../task.md", "../deep/../task.md", "./child/task.md", "child/task.md",
      "./task.md", "./missing/task.md", "missing/task.md", "../../../task.md",
      "/work/task.md", "C:/work/task.md", "atlas://local/../work/task"]
      .map((raw) => ({ raw, kind: "link" })),
    { raw: "work/task", kind: "source" },
  ];
  assert.deepEqual(linkGraph(nodes).map(({ target, kind }) => ({ target, kind })), [
    { target: "two/task", kind: "link" },
    { target: "two/deep/child/task", kind: "link" },
    { target: "work/task", kind: "source" },
  ]);
});

test("relative comparison keys distinguish nested body links from root frontmatter references", () => {
  const source = { path: "two/source.md", atlasKey: "local" };
  assert.equal(referenceKey("./work/task.md", source), "two/work/task");
  assert.equal(referenceKey("../work/task.md", source), "work/task");
  assert.equal(referenceKey("work/task.md", source), "work/task");
  assert.equal(referenceKey("atlas://other/work/task", source), "atlas://other/work/task");
});

test("frontmatter root references do not suppress distinct explicit relative body links", (t) => {
  const cwd = workspace(t);
  const root = store(cwd, "local");
  page(root, "work/task.md", "Root task");
  page(root, "two/work/task.md", "Relative task");
  page(root, "two/source.md", "Source");
  writeFileSync(join(root, "two/source.md"), [
    "---", "sources:", "  - work/task", "---",
    "[Sibling directory](./work/task.md)", "[Root duplicate](../work/task.md)",
  ].join("\n"));
  const graph = loadFullGraph(root, cwd);
  assert.deepEqual(graph.edges.map(({ target, kind }) => ({ target, kind })), [
    { target: "work/task", kind: "source" },
    { target: "two/work/task", kind: "link" },
  ]);
});

test("root paths and frontmatter relationships keep their identity beside relative body links", (t) => {
  const cwd = workspace(t);
  const first = store(cwd, "one");
  const second = store(cwd, "two");
  for (const path of ["task.md", "work/task.md", "nested/task.md", "nested/work/task.md", "nested/local.md"]) {
    page(first, path, path);
  }
  page(second, "work/remote.md", "Remote");
  page(first, "nested/source.md", "Source");
  writeFileSync(join(first, "nested/source.md"), [
    "---", "sources:", "  - task", "relates_to:", "  - path: work/task",
    "    kind: depends-on", "---",
    "[Root path](work/task.md)", "[Sibling](./local.md)",
    "[Remote](atlas://two/work/remote)", "[Missing remote](atlas://two/missing/remote)",
  ].join("\n"));
  const graph = loadCombinedGraphs([first, second], cwd);
  assert.deepEqual(graph.edges.filter((edge) => edge.source === "one::nested/source")
    .map(({ target, kind, relKind }) => ({ target, kind, relKind })), [
      { target: "one::task", kind: "source", relKind: undefined },
      { target: "one::work/task", kind: "relates", relKind: "depends-on" },
      { target: "one::nested/local", kind: "link", relKind: undefined },
      { target: "two::work/remote", kind: "mesh", relKind: "two" },
    ]);
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
  assert.equal(loadPage(first, "atlas://two/work/shared", cwd), null);
  assert.equal(loadPageFromRoots(roots, "two::work/shared", cwd)?.storeRoot, second);
  assert.equal(loadPageFromRoots(roots, "atlas://two/work/shared", cwd)?.storeRoot, second);
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
  for (const id of ["two::work/shared", "unknown::work/shared", "::work/shared", "atlas://two/work/shared", "atlas://unknown/work/shared"]) {
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

test("duplicate Atlas keys are rejected before pages from different roots can collide", (t) => {
  const cwd = workspace(t);
  const first = store(cwd, "one");
  const second = store(cwd, "two");
  page(first, "work/shared.md", "First");
  page(second, "work/shared.md", "Second");
  writeFileSync(join(second, "SCHEMA.json"), '{"atlas_id":"one"}');
  for (const roots of [[first, second], [second, first]]) {
    assert.throws(() => loadCombinedGraphs(roots, cwd), (error) => {
      assert.match(error.message, /Duplicate Atlas key "one"/);
      assert.ok(error.message.includes(first));
      assert.ok(error.message.includes(second));
      return true;
    });
  }
});

test("explicit Atlas references never fall back to a page in the source or another Atlas", (t) => {
  const cwd = workspace(t);
  const first = store(cwd, "one");
  const second = store(cwd, "two");
  page(first, "index.md", "Index", [
    "[Missing Atlas](atlas://absent/work/task)",
    "[[atlas://two/work/task]]",
    "[Missing path](atlas://two/missing/task)",
  ].join("\n"));
  page(first, "work/task.md", "Local decoy");
  page(second, "other/task.md", "Basename decoy");
  for (const roots of [[first], [first, second]]) {
    const graph = loadCombinedGraphs(roots, cwd);
    assert.deepEqual(graph.edges, [], "explicit identity and full path must match");
  }
});

test("explicit Atlas references produce one edge each with accurate degrees", (t) => {
  const cwd = workspace(t);
  const first = store(cwd, "one");
  const second = store(cwd, "two");
  page(first, "index.md", "Index", [
    "[Local](atlas://one/work/local)",
    "[Remote](atlas://two/work/task)",
    "[[atlas://two/work/task]]",
  ].join("\n"));
  page(first, "work/local.md", "Local");
  page(second, "work/task.md", "Remote");
  const single = loadFullGraph(first, cwd);
  assert.equal(single.edges.length, 1);
  assert.equal(single.edges[0].target, "work/local");
  const graph = loadCombinedGraphs([first, second], cwd);
  assert.equal(graph.edges.length, 2);
  assert.equal(new Set(graph.edges.map((edge) => edge.id)).size, 2);
  assert.deepEqual(graph.edges.map((edge) => edge.target).sort(), ["one::work/local", "two::work/task"]);
  assert.equal(graph.nodes.find((node) => node.id === "one::index").degree, 2);
  assert.ok(graph.nodes.filter((node) => node.localId !== "index").every((node) => node.degree === 1));
});

test("same-path mesh links remain distinct from explicit Atlas references", (t) => {
  const cwd = workspace(t);
  const first = store(cwd, "one");
  const second = store(cwd, "two");
  page(first, "work/task.md", "First", "[Remote](atlas://two/work/task)");
  page(second, "work/task.md", "Second");
  const graph = loadCombinedGraphs([first, second], cwd);
  assert.deepEqual(graph.edges.map((edge) => edge.relKind).sort(), ["same-path", "two"]);
  assert.equal(new Set(graph.edges.map((edge) => edge.id)).size, 2);
});

test("frontmatter Atlas URIs retain relationship kinds without generating duplicate mesh edges", (t) => {
  const cwd = workspace(t);
  const first = store(cwd, "one");
  const second = store(cwd, "two");
  page(first, "work/source.md", "Source");
  page(second, "work/task.md", "Task");
  writeFileSync(join(first, "index.md"), [
    "---", "title: Index", "sources:", "  - atlas://one/work/source", "relates_to:",
    "  - path: atlas://two/work/task", "    kind: depends-on",
    "unrelated_metadata: atlas://two/work/task", "---",
    "# Index", "[Source](atlas://one/work/source)", "[Task](atlas://two/work/task)",
  ].join("\n"));
  const single = loadFullGraph(first, cwd);
  assert.deepEqual(single.edges.map((edge) => edge.kind), ["source"]);
  assert.equal(single.edges[0].target, "work/source");
  const graph = loadCombinedGraphs([first, second], cwd);
  assert.deepEqual(graph.edges.map((edge) => edge.kind).sort(), ["relates", "source"]);
  assert.equal(graph.edges.find((edge) => edge.kind === "relates").relKind, "depends-on");
  assert.equal(graph.nodes.find((node) => node.id === "one::index").degree, 2);
});

test("code examples create no graph links while prose and frontmatter retain theirs", (t) => {
  const cwd = workspace(t);
  const first = store(cwd, "one");
  const second = store(cwd, "two");
  for (const name of ["code-wiki", "code-md", "prose-wiki", "prose-md", "source"]) {
    page(first, `work/${name}.md`, name);
  }
  for (const name of ["code-uri", "prose-uri", "related"]) {
    page(second, `knowledge/${name}.md`, name);
  }
  const example = "[[work/code-wiki]] [Example](work/code-md.md) atlas://two/knowledge/code-uri";
  const body = [
    "[[work/prose-wiki]] [Prose](work/prose-md.md) atlas://two/knowledge/prose-uri",
    "",
    `Example: \`${example}\`.`,
    "",
    "```markdown", example, "```",
    "",
    "~~~markdown", example, "~~~",
    "",
    "````markdown", "```", example, "```", "````",
    "",
    `Double delimiter: \`\`one \` ${example} \` two\`\`.`,
  ].join("\n");
  writeFileSync(join(first, "index.md"), [
    "---", "sources:", "  - work/source",
    "relates_to:", "  - path: atlas://two/knowledge/related", "    kind: depends-on",
    "---", body,
  ].join("\n"));
  const single = loadFullGraph(first, cwd);
  assert.deepEqual(single.edges.map((edge) => edge.target).sort(), [
    "work/prose-md", "work/prose-wiki", "work/source",
  ]);
  const graph = loadCombinedGraphs([first, second], cwd);
  assert.deepEqual(graph.edges.map((edge) => edge.target).sort(), [
    "one::work/prose-md", "one::work/prose-wiki", "one::work/source",
    "two::knowledge/prose-uri", "two::knowledge/related",
  ]);
  assert.equal(graph.edges.find((edge) => edge.kind === "relates").relKind, "depends-on");
  assert.equal(graph.nodes.find((node) => node.id === "one::index").degree, 5);
  assert.ok(graph.nodes.filter((node) => node.localId.includes("code-")).every((node) => node.degree === 0));
  assert.equal(loadPage(first, "index", cwd).body, body);
});

test("URI-valued frontmatter lists are scalars, not YAML mapping entries", (t) => {
  const cwd = workspace(t);
  const root = store(cwd, "one");
  page(root, "work/source.md", "Source");
  page(root, "work/task.md", "Task");
  writeFileSync(join(root, "index.md"), [
    "---", "sources:", "  - atlas://one/work/source",
    "relates_to:", "  - atlas://one/work/task", "---", "# Index",
  ].join("\n"));
  const result = loadPage(root, "index", cwd);
  assert.deepEqual(result.sources, ["atlas://one/work/source"]);
  assert.deepEqual(result.relatesTo, [{ path: "atlas://one/work/task", kind: "related" }]);
  assert.deepEqual(loadFullGraph(root, cwd).edges.map((edge) => edge.kind).sort(), ["relates", "source"]);
});

test("explicit qualifiers use the effective Atlas key, not a label alias for a declared ID", (t) => {
  const cwd = workspace(t);
  const first = store(cwd, "one");
  const second = store(cwd, "two");
  page(first, "work/task.md", "First", "First body");
  page(second, "work/task.md", "Second", "Second body");
  const previous = process.env.ATLAS_PRESETS;
  process.env.ATLAS_PRESETS = `shared-label:${first},shared-label:${second}`;
  t.after(() => {
    if (previous === undefined) delete process.env.ATLAS_PRESETS;
    else process.env.ATLAS_PRESETS = previous;
  });
  const graph = loadCombinedGraphs([first, second], cwd);
  assert.deepEqual(graph.stores.map((item) => item.label), ["shared-label", "shared-label"]);
  for (const id of ["atlas://shared-label/work/task", "shared-label::work/task"]) {
    assert.equal(loadPage(first, id, cwd), null);
    assert.equal(loadPageFromRoots([first, second], id, cwd), null);
  }
  assert.equal(loadPageFromRoots([first, second], "atlas://two/work/task", cwd)?.body, "Second body");
  page(first, "index.md", "Index");
  rmSync(join(first, "SCHEMA.json"));
  assert.equal(loadPage(first, "atlas://shared-label/work/task", cwd)?.body, "First body",
    "a label is still the key when no atlas_id is declared");
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
