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
import { loadFullGraph, inspectRoot } from "../.github/extensions/cartograph/atlas/scan.mjs";

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
