import assert from "node:assert/strict";
import test from "node:test";
import {
  extractAtlasUris, extractMarkdownLinks, extractWikilinks, stripMarkdownCode,
} from "../.apm/extensions/cartograph/atlas/parse.mjs";

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
