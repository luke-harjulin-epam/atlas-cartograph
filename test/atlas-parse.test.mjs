import assert from "node:assert/strict";
import test from "node:test";
import {
  extractAtlasUris, extractMarkdownLinks, extractWikilinks, stripMarkdownCode,
  parseFrontmatter, relatesToOf, sourceDetailsOf, sourcesOf,
} from "../.apm/extensions/cartograph/atlas/parse.mjs";

test("sources accept scalar destinations and block/flow records without changing string consumers", () => {
  const url = "https://example.com/notes.md?raw=1&view=full#details.md";
  for (const syntax of [
    `sources: ${url}`,
    `sources: '${url}'`,
    `sources:\n  - "${url}"`,
    `sources: ["${url}"]`,
    `sources: {url: "${url}", title: "Notes: design, rollout"}`,
    `sources:\n  path: "${url}"\n  title: "Notes: design, rollout"`,
    `sources:\n  - title: "Notes: design, rollout"\n    uri: "${url}"`,
  ]) {
    const { meta, body } = parseFrontmatter(`---\n${syntax}\n---\n# Body`);
    assert.deepEqual(sourcesOf(meta), [url], syntax);
    assert.equal(sourceDetailsOf(meta)[0].path, url);
    assert.equal(body, "\n# Body");
    if (syntax.includes("title:")) assert.equal(sourceDetailsOf(meta)[0].title, "Notes: design, rollout");
  }
});

test("mixed source lists retain order and titles, including path/url/uri objects and quoted flow punctuation", () => {
  const { meta } = parseFrontmatter(`---
sources:
  - ./knowledge/internal.md
  - title: 'Owner''s notes'
    url: https://example.com/guide.md
  - https://github.com/owner/repo/pull/8
  - uri: https://example.com/query.md?q=a,b#part.md
    title: "Query: a, b"
  - {path: "atlas://one/guide.md", title: "Atlas guide"}
  - last.md
relates_to:
  - path: work/task.md
    kind: implements
title: Page
---`);
  assert.deepEqual(sourceDetailsOf(meta), [
    { path: "knowledge/internal" },
    { path: "https://example.com/guide.md", title: "Owner's notes" },
    { path: "https://github.com/owner/repo/pull/8" },
    { path: "https://example.com/query.md?q=a,b#part.md", title: "Query: a, b" },
    { path: "atlas://one/guide", title: "Atlas guide" },
    { path: "last" },
  ]);
  assert.deepEqual(sourcesOf(meta), sourceDetailsOf(meta).map((s) => s.path));
  assert.deepEqual(relatesToOf(meta), [{ path: "work/task.md", kind: "implements" }]);
  assert.equal(meta.title, "Page");
  const flow = parseFrontmatter(`---
sources: [first.md, {url: "https://example.com/a.md?q=a,b#c", title: 'A, B'}, "last.md"]
---`).meta;
  assert.deepEqual(sourceDetailsOf(flow), [
    { path: "first" }, { path: "https://example.com/a.md?q=a,b#c", title: "A, B" }, { path: "last" },
  ]);
});

test("source normalization preserves web URLs exactly while retaining internal source contracts", () => {
  assert.deepEqual(sourcesOf({ sources: [
    "https://example.com/file.md", "HTTP://Example.com/a\\b.md?x=1#last.md",
    "./guide.md", "atlas://one/guide.md", "one::guide.md", "//example.com/file.md",
    { path: "chosen.md", url: "https://ignored.example", title: "Chosen" },
    { path: "", uri: "https://example.com/fallback.md" }, { title: "No destination" },
    { url: 5 }, null, 5, { path: { toString: "not code" } },
  ] }), [
    "https://example.com/file.md", "HTTP://Example.com/a\\b.md?x=1#last.md",
    "guide", "atlas://one/guide", "one::guide", "//example.com/file.md", "chosen",
    "https://example.com/fallback.md",
  ]);
  assert.deepEqual(sourceDetailsOf({ sources: { uri: "https://example.com", title: "<img src=x>" } }),
    [{ path: "https://example.com", title: "<img src=x>" }]);
  assert.deepEqual(sourcesOf({}), []);
  assert.deepEqual(sourcesOf(parseFrontmatter("---\nsources: []\n---").meta), []);
});

const links = "[[wiki]] [Markdown](markdown.md) atlas://remote/page";
const expected = [["wiki"], ["markdown.md"], [{ atlasId: "remote", path: "page" }]];
const extract = (body) => {
  const prose = stripMarkdownCode(body);
  return [extractWikilinks(prose), extractMarkdownLinks(prose), extractAtlasUris(prose)];
};

test("all link extractors ignore fenced code and resume after valid closing fences", () => {
  for (const [open, close] of [
    ["```md", "```"], ["~~~md", "~~~"], ["   ```md", "  ````"],
    ["````md", "`````"], ["~~~~md", "~~~~"],
  ]) {
    const body = `${open}\n${links}\n${close}\n${links}`;
    assert.deepEqual(extract(body), expected, body);
    assert.deepEqual(extract(body.replace(/\n/g, "\r\n")), expected, body);
  }
});

test("shorter, mismatched and non-standalone fences do not end code blocks", () => {
  for (const falseClose of ["```", "~~~~", "```` trailing", "    ````"]) {
    assert.deepEqual(extract(`\`\`\`\`md\n${falseClose}\n${links}`), [[], [], []], falseClose);
  }
  assert.deepEqual(extract(`~~~md\n${links}`), [[], [], []]);
});

test("inline code uses matching complete backtick runs and may span lines", () => {
  for (const body of [
    `\`${links}\``,
    `\`\`${links} with a \` inside\`\``,
    `\`\`\`one \`\` ${links} \` two\`\`\``,
    `\`first line\n${links}\nlast line\``,
    `\`${links}\\\``,
  ]) assert.deepEqual(extract(`Example: ${body}\n\n${links}`), expected, body);
});

test("escaped or unmatched openers and paragraph boundaries preserve prose links", () => {
  for (const body of [
    `\\\`${links}`,
    `\\\`${links} \\\``,
    `\`${links}`,
    `\`unmatched\n\n${links}\n\n\``,
    `\`\`unmatched ${links} \``,
  ]) assert.deepEqual(extract(body), expected, body);
  assert.deepEqual(extract(`\\\\\`${links}\``), [[], [], []]);
  assert.deepEqual(extract("\\``" + links + "`"), [[], [], []]);
});

test("removed code cannot join link fragments or swallow subsequent real links", () => {
  assert.deepEqual(extract("[[wi`code`ki]] [Label](mark`code`down.md)"), [[], [], []]);
  assert.deepEqual(extract("[[unfinished\n```md\nexample\n```\n[[wiki]]"), [["wiki"], [], []]);
  assert.deepEqual(extract("[`Label`](markdown.md) [[wiki|`Label`]]"), [["wiki"], ["markdown.md"], []]);
  assert.deepEqual(extract(`\`unmatched\n~~~\nexample\n~~~\n${links}\n\``), expected);
});

test("inline code cannot consume prose across preview block boundaries", () => {
  for (const block of [`# ${links}`, `> ${links}`, `- ${links}`, `1. ${links}`, `| ${links} |`]) {
    assert.deepEqual(extract(`Unmatched \`\n${block}\nA later \` delimiter`), expected, block);
  }
  for (const body of [
    `- Unmatched \`\n- ${links}\n- A later \` delimiter`,
    `1. Unmatched \`\n2. ${links}\n3. A later \` delimiter`,
    `| Unmatched \` | ${links} | A later \` delimiter |`,
  ]) assert.deepEqual(extract(body), expected, body);
});
