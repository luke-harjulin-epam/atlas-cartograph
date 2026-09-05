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

test("list-like text inside fences and paragraphs remains literal and escaped", () => {
  assert.equal(renderMarkdown("Intro\ncontinued"), "<p>Intro\ncontinued</p>");
  assert.equal(renderMarkdown("```md\n- <item>\n1. Second\n```"),
    '<pre class="md-pre"><code>- &lt;item&gt;\n1. Second</code></pre>');
  assert.equal(renderMarkdown("Intro\n- **Bold**\n- <script>"),
    "<p>Intro</p><ul><li><strong>Bold</strong></li><li>&lt;script&gt;</li></ul>");
});
