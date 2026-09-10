import assert from "node:assert/strict";
import test from "node:test";
import { externalSourceLabel, renderExternalSources, sourceKind } from "../.apm/extensions/cartograph/public/source-links.js";
import { frontendDocument } from "./helpers/frontend-dom.mjs";

test("source labels are derived locally for GitHub resources and generic domains/paths", () => {
  for (const [path, label] of [
    ["pull/8", "Pull request #8"], ["issues/10", "Issue #10"],
    ["releases/tag/v0.3.0", "Release v0.3.0"], ["releases/tag/release%2Fone", "Release release/one"],
    ["commit/1234567890abcdef", "Commit 1234567890ab"],
    ["blob/main/docs/usage.md", "File docs/usage.md (main)"],
    ["releases/latest", "Latest release"], ["releases", "Releases"], ["", "Repository"],
  ]) assert.deepEqual(externalSourceLabel(`https://github.com/team/project/${path}`),
    { label, context: "team/project · github.com" });
  assert.deepEqual(externalSourceLabel("https://docs.example.com/guide/getting-started.md?raw=1#intro"),
    { label: "guide / getting started.md", context: "docs.example.com" });
  assert.deepEqual(externalSourceLabel("https://example.com/"),
    { label: "example.com", context: "example.com" });
  assert.equal(externalSourceLabel("https://example.com/%E0%A4%A").label, "%E0%A4%A");
  assert.equal(externalSourceLabel("https://example.com/file", "  A better title  ").label, "A better title");
  assert.equal(externalSourceLabel("https://example.com/file", "  ").label, "file");
});

test("external source metadata is escaped inert text, never markup or arbitrary-scheme links", () => {
  const path = 'https://example.com/file.md?q="><img src=x onerror=alert(1)>&a=1#last.md';
  const title = '<script>alert("title")</script>';
  const markup = renderExternalSources([{ path, title }]);
  assert.ok(!markup.includes("<script>"));
  assert.ok(!markup.includes("<img"));
  const document = frontendDocument(markup);
  assert.equal(document.querySelector("a").getAttribute("href"), path);
  assert.equal(document.querySelector(".external-source-label").textContent, title);
  assert.equal(document.querySelector(".external-source-url").textContent, path);
  for (const value of [
    "javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "file:///etc/passwd",
    "mailto:user@example.com", "//example.com/file", "\\\\example.com\\file", "https://",
    "https://example.com/\njavascript:alert(1)",
  ]) {
    assert.equal(sourceKind(value), "unsupported", value);
    assert.equal(externalSourceLabel(value), null);
    assert.equal(renderExternalSources([{ path: value, title: "Untrusted" }]), "");
  }
  for (const path of ["guide", "./guide.md", "atlas://one/guide", "one::guide"]) {
    assert.equal(sourceKind(path), "internal", path);
  }
});
