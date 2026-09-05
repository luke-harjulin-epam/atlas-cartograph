import assert from "node:assert/strict";
import test from "node:test";
import { renderMarkdown } from "../.apm/extensions/cartograph/public/markdown.js";

test("lists immediately after paragraphs and headings start their own blocks", () => {
  for (const marker of ["-", "*", "+", "1."]) {
    const tag = marker === "1." ? "ol" : "ul";
    assert.equal(renderMarkdown(`Introduction\n${marker} First\n${marker} Second\nAfter`),
      `<p>Introduction</p><${tag}><li>First</li><li>Second</li></${tag}><p>After</p>`);
    assert.equal(renderMarkdown(`# Heading\n${marker} Item`),
      `<h1>Heading</h1><${tag}><li>Item</li></${tag}>`);
  }
});

test("adjacent ordered and unordered lists preserve every item", () => {
  assert.equal(renderMarkdown("- First\n1. Second\n2. Third\n+ Fourth\n* Fifth"),
    "<ul><li>First</li></ul><ol><li>Second</li><li>Third</li></ol><ul><li>Fourth</li><li>Fifth</li></ul>");
});

test("standalone headings and thematic breaks end before adjacent ordinary text", () => {
  for (let level = 1; level <= 6; level++) {
    const tag = `h${Math.min(level, 4)}`;
    assert.equal(renderMarkdown(`Before\n${"#".repeat(level)} Heading\nBody`),
      `<p>Before</p><${tag}>Heading</${tag}><p>Body</p>`);
  }
  for (const rule of ["---", "-----", "___", "_____", "***", "*****"]) {
    assert.equal(renderMarkdown(`Before\n${rule}\nAfter`), "<p>Before</p><hr /><p>After</p>");
  }
  assert.equal(renderMarkdown("# First\n## Second\nBody"), "<h1>First</h1><h2>Second</h2><p>Body</p>");
});

test("quote transitions isolate surrounding text while keeping consecutive quoted lines together", () => {
  assert.equal(renderMarkdown("Before\n> First\n>Second\n>\n> Last\nAfter"),
    "<p>Before</p><blockquote>First\nSecond\n\nLast</blockquote><p>After</p>");
  assert.equal(renderMarkdown("# Heading\n> Quote\n---\nAfter"),
    "<h1>Heading</h1><blockquote>Quote</blockquote><hr /><p>After</p>");
  assert.equal(renderMarkdown("> Quote\n- Item\n> Next quote"),
    "<blockquote>Quote</blockquote><ul><li>Item</li></ul><blockquote>Next quote</blockquote>");
  assert.equal(renderMarkdown("```\n# Heading\nBody\n---\n> Quote\n```"),
    '<pre class="md-pre"><code># Heading\nBody\n---\n&gt; Quote</code></pre>');
});

test("list-like text inside fences and paragraphs remains literal and escaped", () => {
  assert.equal(renderMarkdown("Intro\ncontinued"), "<p>Intro\ncontinued</p>");
  assert.equal(renderMarkdown("```md\n- <item>\n1. Second\n```"),
    '<pre class="md-pre"><code>- &lt;item&gt;\n1. Second</code></pre>');
  assert.equal(renderMarkdown("Intro\n- **Bold**\n- <script>"),
    "<p>Intro</p><ul><li><strong>Bold</strong></li><li>&lt;script&gt;</li></ul>");
});
