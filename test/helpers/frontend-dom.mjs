// Minimal DOM/event harness for the native controls; no layout or canvas emulation.
const decode = (text) => text.replace(/&(amp|lt|gt|quot|#39);/g,
  (_, name) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" }[name]));

export class FrontendEvent {
  constructor(type, options = {}) {
    this.type = type;
    Object.assign(this, options);
    this.defaultPrevented = false;
    this.propagationStopped = false;
  }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { this.propagationStopped = true; }
}

class Element {
  constructor(tag, doc) {
    this.tagName = tag.toUpperCase();
    this.ownerDocument = doc;
    this.parentElement = null;
    this.children = [];
    this.attributes = new Map();
    this.style = {};
    this.listeners = new Map();
    this.value = "";
    this.disabled = false;
    this.scrollTop = 0;
    this._text = "";
    this.classList = {
      contains: (name) => (this.getAttribute("class") || "").split(/\s+/).includes(name),
      toggle: (name, force) => {
        const classes = new Set((this.getAttribute("class") || "").split(/\s+/).filter(Boolean));
        const on = force ?? !classes.has(name);
        if (on) classes.add(name); else classes.delete(name);
        this.setAttribute("class", [...classes].join(" "));
        return on;
      },
      add: (name) => this.classList.toggle(name, true),
      remove: (name) => this.classList.toggle(name, false),
    };
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === "disabled") this.disabled = true;
    if (name === "value") this.value = String(value);
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  get id() { return this.getAttribute("id") || ""; }
  get type() { return this.getAttribute("type") || ""; }
  set type(value) { this.setAttribute("type", value); }
  get firstElementChild() { return this.children[0] || null; }
  get textContent() { return this._text + this.children.map((child) => child.textContent).join(""); }
  set textContent(value) {
    for (const child of [...this.children]) child.remove();
    this._text = String(value);
  }
  set innerHTML(value) {
    this.textContent = "";
    parseHtml(this, value);
  }
  append(...children) { for (const child of children) this.insertBefore(child, null); }
  insertBefore(child, before) {
    child.remove();
    const index = before ? this.children.indexOf(before) : this.children.length;
    this.children.splice(index, 0, child);
    child.parentElement = this;
    return child;
  }
  remove() {
    if (!this.parentElement) return;
    if (this.contains(this.ownerDocument.activeElement)) this.ownerDocument.activeElement = this.ownerDocument.body;
    const siblings = this.parentElement.children;
    siblings.splice(siblings.indexOf(this), 1);
    this.parentElement = null;
  }
  contains(element) {
    for (let current = element; current; current = current.parentElement) if (current === this) return true;
    return false;
  }
  matches(selector) {
    return selector.split(",").some((part) => {
      const simple = part.trim();
      if (simple.startsWith("#")) return this.id === simple.slice(1);
      if (simple.startsWith(".")) return this.classList.contains(simple.slice(1));
      const attr = simple.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
      if (attr) return attr[2] === undefined ? this.attributes.has(attr[1]) : this.getAttribute(attr[1]) === attr[2];
      return this.tagName.toLowerCase() === simple.toLowerCase();
    });
  }
  closest(selector) {
    for (let current = this; current; current = current.parentElement) if (current.matches(selector)) return current;
    return null;
  }
  querySelectorAll(selector) {
    const result = [];
    for (const child of this.children) {
      if (child.matches(selector)) result.push(child);
      result.push(...child.querySelectorAll(selector));
    }
    return result;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(callback);
  }
  dispatchEvent(event) {
    event.target ??= this;
    for (let current = this; current; current = current.parentElement) {
      event.currentTarget = current;
      for (const callback of current.listeners.get(event.type) || []) callback(event);
      if (event.propagationStopped) break;
    }
    return !event.defaultPrevented;
  }
  focus() { if (!this.disabled) this.ownerDocument.activeElement = this; }
  click() {
    if (this.disabled) return;
    this.focus();
    const event = new FrontendEvent("click");
    this.dispatchEvent(event);
    return event;
  }
  getContext() { return {}; }
}

function parseHtml(parent, html) {
  const stack = [parent];
  for (const token of String(html).match(/<!--[\s\S]*?-->|<[^>]+>|[^<]+/g) || []) {
    if (token.startsWith("<!")) continue;
    if (token.startsWith("</")) {
      stack.pop();
    } else if (token.startsWith("<")) {
      const tag = token.match(/^<([\w-]+)/)?.[1];
      if (!tag) continue;
      const element = parent.ownerDocument.createElement(tag);
      for (const attr of token.slice(tag.length + 1, -1).matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) {
        element.setAttribute(attr[1], decode(attr[2] ?? ""));
      }
      stack.at(-1).append(element);
      if (!["meta", "link", "input", "hr", "br", "img"].includes(tag) && !token.endsWith("/>")) stack.push(element);
    } else {
      stack.at(-1)._text += decode(token);
    }
  }
}

export function frontendDocument(html) {
  const doc = new Element("document", null);
  doc.ownerDocument = doc;
  doc.createElement = (tag) => new Element(tag, doc);
  doc.getElementById = (id) => doc.querySelector(`#${id}`);
  parseHtml(doc, html);
  doc.body = doc.querySelector("body") || doc;
  doc.activeElement = doc.body;
  return doc;
}
