import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown } from "../.github/extensions/cartograph/public/markdown.js";

test("renderMarkdown emits an HTML table", () => {
  const html = renderMarkdown(`# Title

| Kind | Folder |
| --- | --- |
| experience | experiences/ |
| decision | decisions/ |
`);
  assert.match(html, /<table>/);
  assert.match(html, /<th>Kind<\/th>/);
  assert.match(html, /<td>experience<\/td>/);
  assert.match(html, /<td>decision<\/td>/);
});

test("renderMarkdown turns internal links into buttons, not href navigations", () => {
  const html = renderMarkdown("See [[work/migrate-cartograph]] and [missing](missing.md).");
  assert.match(html, /data-target="work\/migrate-cartograph"/);
  assert.match(html, /data-target="missing.md"/);
  assert.doesNotMatch(html, /href="missing\.md"/);
  assert.doesNotMatch(html, /href="work\/migrate-cartograph"/);
});
