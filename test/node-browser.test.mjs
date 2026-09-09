import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { mountNodeBrowser, NODE_PAGE_SIZE } from "../.apm/extensions/cartograph/public/node-browser.js";
import { FrontendEvent, frontendDocument } from "./helpers/frontend-dom.mjs";

const html = readFileSync(new URL("../.apm/extensions/cartograph/public/index.html", import.meta.url), "utf8");
const settle = () => new Promise((resolve) => setImmediate(resolve));
function fixture(count = 70) {
  const doc = frontendDocument(html);
  const get = (id) => doc.getElementById(id);
  const actions = [];
  const browser = mountNodeBrowser(get("node-browser"), get("search"), {
    select: (id) => actions.push(["select", id]),
    preview: () => actions.push(["preview"]),
    clear: () => actions.push(["clear"]),
  });
  let state = {
    layers: { experiences: false },
    graph: {
      nodes: Array.from({ length: count }, (_, index) => ({
        id: `atlas-${index % 2}::node-${index}`, title: "Same title", kind: "experience",
        path: `experiences/node-${index}.md`, atlasLabel: "Memory", atlasKey: `atlas-${index % 2}`,
        storeRoot: `/workspace/memory-${index % 2}`,
      })),
    },
  };
  function update(next = {}) {
    state = { ...state, ...next };
    browser.setState(state, () => "experiences");
  }
  update();
  browser.show();
  return { doc, get, actions, update, nodes: state.graph.nodes, browser };
}

test("all 3001 graph nodes are reachable through bounded native button pages", () => {
  const { get, nodes, actions } = fixture(3001);
  const seen = new Set();
  let pages = 0;
  do {
    const rows = get("node-list").children;
    assert.ok(rows.length <= NODE_PAGE_SIZE);
    for (const row of rows) {
      assert.equal(row.tagName, "LI");
      const button = row.firstElementChild;
      assert.equal(button.tagName, "BUTTON");
      assert.equal(button.type, "button");
      assert.match(button.textContent, /Atlas: Memory \[atlas-[01]\] \(\/workspace\/memory-[01]\).*experiences\/node-/);
      seen.add(button.getAttribute("data-browse-node"));
    }
    pages++;
    if (get("node-next").disabled) break;
    get("node-next").click();
  } while (pages <= 121);
  assert.equal(pages, 121);
  assert.deepEqual([...seen], nodes.map((node) => node.id));
  get("node-list").firstElementChild.firstElementChild.click();
  assert.deepEqual(actions, [["select", nodes.at(-1).id]]);
  assert.match(get("node-count").textContent, /3001 of 3001.*3001–3001.*121 of 121/);
});

test("filter reaches distant nodes by full path or Atlas and clearly reports zero matches", () => {
  const { doc, get, nodes, actions } = fixture(101);
  const input = get("search");
  assert.equal(input.tagName, "INPUT");
  assert.equal(input.type, "search");
  assert.equal(input.getAttribute("aria-label"), "Search nodes");
  input.value = "experiences/node-100.md";
  input.dispatchEvent(new FrontendEvent("input"));
  assert.equal(get("node-list").children.length, 1);
  get("node-list").firstElementChild.firstElementChild.click();
  assert.deepEqual(actions, [["select", nodes[100].id]]);
  input.focus();
  input.value = "ATLAS-1";
  input.dispatchEvent(new FrontendEvent("input"));
  assert.match(get("node-count").textContent, /^50 of 101 nodes/);
  input.value = "not-found";
  input.dispatchEvent(new FrontendEvent("input"));
  assert.equal(get("node-count").textContent, "No results. 0 of 101 nodes.");
  assert.equal(get("node-list").children.length, 0);
  assert.equal(get("node-previous").disabled, true);
  assert.equal(get("node-next").disabled, true);
  assert.equal(doc.activeElement, input);
});

test("SSE preserves focused node identity, edited filters, caret, scroll and updated selection", () => {
  const { doc, get, nodes, update } = fixture();
  const button = get("node-list").children[6].firstElementChild;
  button.focus();
  get("node-list").scrollTop = 173;
  const changed = nodes.map((node, index) => index === 6 ? { ...node, title: "Updated title" } : { ...node });
  update({ graph: { nodes: changed }, selectedId: nodes[6].id });
  assert.equal(get("node-list").children[6].firstElementChild, button);
  assert.equal(doc.activeElement, button);
  assert.equal(get("node-list").scrollTop, 173);
  assert.match(button.textContent, /Updated title/);
  assert.equal(button.getAttribute("aria-pressed"), "true");
  assert.match(get("node-selected").textContent, /Selected: Updated title/);
  assert.equal(get("node-preview").disabled, false);
  assert.equal(get("node-clear").disabled, false);
  const filter = get("search");
  filter.focus();
  filter.value = "Same";
  filter.selectionStart = 2;
  filter.dispatchEvent(new FrontendEvent("input"));
  update({ graph: { nodes: changed.map((node) => ({ ...node })) }, selectedId: nodes[60].id });
  assert.equal(doc.activeElement, filter);
  assert.equal(filter.value, "Same");
  assert.equal(filter.selectionStart, 2);
  assert.match(get("node-selected").textContent, /experiences\/node-60.md/, "off-page graph selection stays operable");
});

test("moving a focused node across a page boundary retains it; removal moves focus to the filter", () => {
  const { doc, get, nodes, update } = fixture();
  const button = get("node-list").children[24].firstElementChild;
  button.focus();
  const inserted = { ...nodes[0], id: "new", path: "new.md" };
  update({ graph: { nodes: [inserted, ...nodes] } });
  assert.equal(doc.activeElement, button);
  assert.equal(get("node-list").firstElementChild.firstElementChild, button);
  assert.match(get("node-count").textContent, /Page 2 of 3/);
  update({ graph: { nodes: nodes.filter((node) => node.id !== nodes[24].id) } });
  assert.equal(doc.activeElement, get("search"));
  assert.ok(get("node-list").children.length <= NODE_PAGE_SIZE);
});

test("selection controls follow state, cannot act on deleted nodes, and report action errors", async () => {
  const { doc, get, nodes, update, actions } = fixture();
  assert.equal(get("node-preview").disabled, true);
  update({ selectedId: nodes[69].id });
  get("node-preview").click();
  get("node-clear").click();
  await settle();
  assert.deepEqual(actions, [["preview"], ["clear"]]);
  get("node-preview").focus();
  update({ graph: { nodes: [] }, selectedId: null });
  assert.equal(get("node-selected").textContent, "No node selected.");
  assert.equal(get("node-preview").disabled, true);
  assert.equal(get("node-clear").disabled, true);
  assert.equal(doc.activeElement, get("search"));
  assert.equal(get("node-count").textContent, "No results. 0 of 0 nodes.");

  const errorDoc = frontendDocument(html);
  const panel = errorDoc.getElementById("node-browser");
  const browser = mountNodeBrowser(panel, errorDoc.getElementById("search"), {
    select: async () => { throw new Error("offline"); }, preview() {}, clear() {},
  });
  browser.setState({ graph: { nodes } }, () => "");
  browser.show();
  errorDoc.getElementById("node-list").firstElementChild.firstElementChild.click();
  await settle();
  assert.match(errorDoc.getElementById("node-error").textContent, /offline/);
  assert.equal(errorDoc.getElementById("node-error").classList.contains("hidden"), false);
});

test("native controls never trap Tab; close and Escape return focus to Search", () => {
  const { doc, get, update } = fixture(26);
  assert.equal(get("search").getAttribute("data-results-open"), "true");
  assert.equal(get("search").getAttribute("aria-controls"), "node-browser");
  assert.equal(doc.activeElement, get("search"));
  const tab = new FrontendEvent("keydown", { key: "Tab" });
  get("search").dispatchEvent(tab);
  assert.equal(tab.defaultPrevented, false);
  get("node-next").click();
  assert.equal(doc.activeElement, get("node-previous"), "disabled last-page Next does not lose focus");
  const escape = new FrontendEvent("keydown", { key: "Escape" });
  get("node-previous").dispatchEvent(escape);
  assert.equal(get("search").getAttribute("data-results-open"), "false");
  assert.equal(get("node-browser").classList.contains("hidden"), true);
  assert.equal(doc.activeElement, get("search"));
  update({ selectedId: "atlas-1::node-25" });
  assert.equal(doc.activeElement, get("search"));
  get("search").dispatchEvent(new FrontendEvent("keydown", { key: "ArrowDown" }));
  assert.match(get("node-selected").textContent, /node-25.md/);
  get("node-browser-close").click();
  assert.equal(doc.activeElement, get("search"));
});
