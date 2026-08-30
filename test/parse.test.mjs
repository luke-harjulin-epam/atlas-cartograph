import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractWikilinks,
  kindFor,
  parseFrontmatter,
  relatesToOf,
} from "../.github/extensions/cartograph/atlas/parse.mjs";
import { loadFullGraph, inspectRoot, loadPage, defaultRoot } from "../.github/extensions/cartograph/atlas/scan.mjs";
import { layoutUniverse } from "../.github/extensions/cartograph/atlas/universe.mjs";
import { answerQuery } from "../.github/extensions/cartograph/atlas/chat.mjs";
import { freshState, openAtlas, selectNode } from "../.github/extensions/cartograph/server.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = resolve(repo, "fixtures/mini-atlas");

test("parseFrontmatter reads relates_to objects", () => {
  const src = `---
type: experience
title: Hello
relates_to:
  - path: work/migrate-cartograph
    kind: implements
---

Body [[work/migrate-cartograph]]
`;
  const { meta, body } = parseFrontmatter(src);
  assert.equal(meta.type, "experience");
  assert.equal(meta.title, "Hello");
  const rel = relatesToOf(meta);
  assert.equal(rel[0].path, "work/migrate-cartograph");
  assert.equal(rel[0].kind, "implements");
  assert.deepEqual(extractWikilinks(body), ["work/migrate-cartograph"]);
});

test("kindFor uses path prefixes", () => {
  assert.equal(kindFor("experiences/a.md", "", "atlas"), "experience");
  assert.equal(kindFor("decisions/a.md", "", "atlas"), "decision");
  assert.equal(kindFor("index.md", "", "atlas"), "index");
});

test("inspectRoot and loadFullGraph read the mini atlas fixture", () => {
  const info = inspectRoot(fixture, repo);
  assert.equal(info.available, true);
  assert.equal(info.format, "atlas");
  assert.equal(info.atlasId, "cartograph-mini");
  const graph = loadFullGraph(fixture, repo);
  assert.ok(graph.nodes.length >= 5, `expected >=5 nodes, got ${graph.nodes.length}`);
  assert.ok(graph.edges.length >= 3, `expected >=3 edges, got ${graph.edges.length}`);
  assert.ok(graph.nodes.some((n) => n.id === "index"));
  assert.ok(graph.nodes.some((n) => n.kind === "experience"));
  assert.ok(graph.complete);
});

test("loadPage and selectNode expose relates_to navigation", () => {
  const page = loadPage(fixture, "experiences/canvas-port", repo);
  assert.ok(page);
  assert.ok(page.relatesTo.some((r) => r.path.includes("migrate-cartograph")));
  assert.ok(page.relatesTo.some((r) => r.path.includes("copilot-canvas")));
  assert.ok(page.sources.some((s) => s.includes("atlas-pages")));

  const state = freshState(repo, { skipIntro: true });
  openAtlas(state, fixture);
  selectNode(state, "experiences/canvas-port");
  assert.equal(state.selectedId, "experiences/canvas-port");
  assert.ok(state.page.relatesTo.length >= 2);
  const paths = state.page.relatesTo.map((r) => r.path);
  assert.ok(paths.some((p) => p.includes("migrate-cartograph")));
  assert.ok(paths.some((p) => p.includes("copilot-canvas")));
});

test("selectNode ignores broken links and keeps the current page", () => {
  const state = freshState(repo, { skipIntro: true });
  openAtlas(state, fixture);
  selectNode(state, "experiences/canvas-port");
  selectNode(state, "does-not-exist");
  assert.equal(state.selectedId, "experiences/canvas-port");
  assert.match(state.linkError || "", /does-not-exist/);
});

test("proximity grouping clusters by work_id and folder neighborhood", () => {
  const nodes = [
    { id: "work/a", kind: "work", title: "Mesh MVP", workId: "mesh-mvp", path: "work/a.md", degree: 2, sourceCount: 0 },
    { id: "experiences/e", kind: "experience", title: "Write", workId: "mesh-mvp", path: "experiences/e.md", degree: 1, sourceCount: 0 },
    { id: "atlas-project/vision", kind: "page", title: "Vision", path: "atlas-project/vision.md", degree: 0, sourceCount: 0 },
  ];
  const laid = layoutUniverse(nodes, [], "proximity");
  const mesh = laid.filter((n) => n.galaxyLabel === "Mesh MVP");
  const vision = laid.filter((n) => n.galaxyLabel === "Atlas Project");
  assert.equal(mesh.length, 2);
  assert.equal(vision.length, 1);
  const dlon = Math.abs(mesh[0].lon - vision[0].lon);
  assert.ok(Math.min(dlon, Math.PI * 2 - dlon) > 0.4);
});

test("layoutUniverse parks each kind in its own island", () => {
  const graph = loadFullGraph(fixture, repo);
  const laid = layoutUniverse(graph.nodes, graph.edges);
  const labels = new Set(laid.map((n) => n.galaxyLabel));
  assert.ok(labels.has("Work"));
  assert.ok(labels.has("Decisions"));
  assert.ok(labels.has("Experiences"));
  const work = laid.find((n) => n.kind === "work");
  const decision = laid.find((n) => n.kind === "decision");
  const dlon = Math.abs(work.lon - decision.lon);
  const sep = Math.min(dlon, Math.PI * 2 - dlon);
  assert.ok(sep > 0.7, `kind islands should be separated, got ${sep}`);
});

test("chat answers from the open atlas graph", () => {
  const state = freshState(repo, { skipIntro: true });
  openAtlas(state, fixture);
  const reply = answerQuery(state, "copilot canvas");
  assert.ok(reply.hits.length >= 1);
  assert.ok(reply.hits.some((h) => /canvas|copilot/i.test(h.title)));
  assert.match(reply.text, /page/i);
});

test("defaultRoot prefers an atlas in the session workspace", () => {
  const root = defaultRoot(repo);
  assert.ok(root);
  assert.ok(root.includes("mini-atlas") || root.endsWith("atlas"));
});
