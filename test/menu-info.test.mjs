import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mountMenuInfo } from "../.apm/extensions/cartograph/public/menu-info.js";
import { FrontendEvent, frontendDocument } from "./helpers/frontend-dom.mjs";

function fixture(t) {
  const document = frontendDocument(`
    <details id="menu" open>
      <button id="info" data-info="help" data-info-title="Help" aria-expanded="false">i</button>
      <div id="help" hidden><p id="message">Explanation</p><ol><li>First step</li><li>Second step</li></ol></div>
    </details>
    <div id="menu-info"><h2 id="menu-info-title"></h2><button id="menu-info-close">Close</button><div id="menu-info-body"></div></div>`);
  const get = id => document.getElementById(id);
  let visible = false;
  let observer;
  const previous = Object.getOwnPropertyDescriptor(globalThis, "MutationObserver");
  Object.defineProperty(globalThis, "MutationObserver", { configurable: true, value: class {
    constructor(callback) { this.callback = callback; this.targets = []; observer = this; }
    observe(target) { this.targets.push(target); }
    disconnect() { this.targets = []; }
  } });
  t.after(() => previous ? Object.defineProperty(globalThis, "MutationObserver", previous) : delete globalThis.MutationObserver);
  const popup = get("menu-info");
  popup.showPopover = () => {
    visible = true;
    popup.dispatchEvent(new FrontendEvent("toggle", { newState: "open" }));
  };
  popup.hidePopover = () => {
    visible = false;
    popup.dispatchEvent(new FrontendEvent("toggle", { newState: "closed" }));
  };
  get("menu").open = true;
  const controller = mountMenuInfo(document);
  return { document, get, observer, controller, visible: () => visible };
}

test("information popup opens with numbered plain text and restores focus on Escape", t => {
  const { document, get, visible, observer } = fixture(t);
  get("info").click();
  assert.equal(visible(), true);
  assert.equal(get("menu-info-title").textContent, "Help");
  assert.equal(get("menu-info-body").textContent, "Explanation\n\n1. First step\n\n2. Second step");
  assert.equal(get("info").getAttribute("aria-expanded"), "true");
  assert.equal(document.activeElement, get("menu-info-close"));
  get("menu-info-close").dispatchEvent(new FrontendEvent("keydown", { key: "Escape" }));
  assert.equal(visible(), false);
  assert.equal(document.activeElement, get("info"));
  assert.equal(get("menu-info-body").textContent, "");
  assert.equal(observer.targets.length, 0);
});

test("information stays live as literal text and releases observers on native light dismissal", t => {
  const { get, observer, visible } = fixture(t);
  get("info").click();
  get("message").textContent = '<img src=x onerror="alert(1)">';
  observer.callback();
  assert.match(get("menu-info-body").textContent, /<img src=x/);
  assert.equal(get("menu-info-body").querySelector("img"), null);
  get("menu-info").hidePopover();
  assert.equal(visible(), false);
  assert.equal(get("info").getAttribute("aria-expanded"), "false");
  assert.equal(observer.targets.length, 0);
});

test("closing or hiding an owning menu dismisses its information", t => {
  const { get, controller, observer, visible } = fixture(t);
  get("info").click();
  get("menu").open = false;
  get("menu").dispatchEvent(new FrontendEvent("toggle"));
  assert.equal(visible(), false);
  get("menu").open = true;
  get("info").click();
  controller.closeWithin(get("menu"));
  assert.equal(visible(), false);
  get("info").click();
  get("menu").classList.add("hidden");
  observer.callback();
  assert.equal(visible(), false);
});

test("every menu information button has one hidden source and accessible popup wiring", () => {
  const html = readFileSync(new URL("../.apm/extensions/cartograph/public/index.html", import.meta.url), "utf8");
  const document = frontendDocument(html);
  const buttons = document.querySelectorAll("[data-info]");
  assert.ok(buttons.length >= 8);
  for (const button of buttons) {
    const id = button.getAttribute("data-info");
    assert.equal(document.querySelectorAll(`#${id}`).length, 1);
    assert.equal(document.getElementById(id).getAttribute("hidden"), "");
    assert.equal(button.getAttribute("aria-controls"), "menu-info");
    assert.equal(button.getAttribute("aria-haspopup"), "dialog");
    assert.ok(button.getAttribute("aria-label"));
  }
  assert.equal(document.getElementById("preview").contains(document.getElementById("menu-info")), false);
  assert.equal(document.getElementById("activity-command").closest("[hidden]"), null);
  assert.equal(document.getElementById("activity-setup-notice").closest("[hidden]"), null);
  const css = readFileSync(new URL("../.apm/extensions/cartograph/public/styles.css", import.meta.url), "utf8");
  const buttonStyle = css.match(/\.info-button \{([^}]+)\}/)[1];
  assert.match(buttonStyle, /width: 24px; height: 24px/);
  assert.match(buttonStyle, /font: bold 12px/);
});
