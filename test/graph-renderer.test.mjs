import test from "node:test";
import assert from "node:assert/strict";
import { mountGraphCanvas } from "../.apm/extensions/cartograph/public/graph-canvas.js";
import { createGraphGL, GraphGL } from "../.apm/extensions/cartograph/public/graph-gl.js";
import { ActivityPlayback, ACTIVITY_SPACING_MS } from "../.apm/extensions/cartograph/public/activity-playback.js";
import { ActivityCamera } from "../.apm/extensions/cartograph/public/activity-camera.js";
import { GraphLifecycle } from "../.apm/extensions/cartograph/public/graph-lifecycle.js";

const start = 1800000000000;
const nodes = ["a", "b", "c"].map((id) => ({ id, title: id, kind: "work", degree: 2, sourceCount: 0 }));
const edges = [{ id: "ab", source: "a", target: "b", kind: "relates" }, { id: "bc", source: "b", target: "c", kind: "mesh" }];
const emptyLifecycle = () => ({ births: new Map(), ghosts: [], edges: new Map(), edgeGhosts: [] });
const emptyActivity = () => ({ nodes: new Map(), edges: [], amount: 0 });
const changes = (revision, created = [], deleted = [], occurredAt = start) =>
  ({ revision, created, deleted, occurredAt, origin: revision ? "filesystem" : "mount" });

function element(tag = "div") {
  return {
    tagName: tag.toUpperCase(), style: {}, dataset: {}, children: [], listeners: new Map(), attributes: new Map(),
    setAttribute(name, value) { this.attributes.set(name, value); },
    addEventListener(type, handler) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      this.listeners.get(type)?.delete(handler);
      if (!this.listeners.get(type)?.size) this.listeners.delete(type);
    },
    fire(type, event = {}) { for (const handler of this.listeners.get(type) ?? []) handler(event); },
    get firstChild() { return this.children[0] ?? null; },
    get nextSibling() { return this.parent?.children[this.parent.children.indexOf(this) + 1] ?? null; },
    insertBefore(child, next) {
      child.remove();
      const index = next ? this.children.indexOf(next) : this.children.length;
      assert.ok(index >= 0);
      this.children.splice(index, 0, child);
      child.parent = this;
    },
    remove() {
      if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
      this.parent = null;
    },
    getBoundingClientRect: () => ({ width: 800, height: 600, left: 0, top: 0 }),
  };
}

function context2d() {
  const operations = [];
  const stack = [];
  return new Proxy({ operations, globalAlpha: 1 }, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === "save") return () => stack.push({ ...target });
      if (key === "restore") return () => {
        for (const name of Object.keys(target)) delete target[name];
        Object.assign(target, stack.pop());
      };
      if (key === "createRadialGradient") return () => ({ addColorStop() {} });
      return (...args) => operations.push({ type: key, args, alpha: target.globalAlpha, fill: target.fillStyle, stroke: target.strokeStyle });
    },
  });
}

function fakeGL(canvas, failure) {
  const live = { shaders: new Set(), programs: new Set(), buffers: new Set() };
  const allocations = { shaders: 0, programs: 0, buffers: 0 };
  const allocate = (kind) => {
    const id = ++allocations[kind];
    if (failure === `${kind}-${id}`) return null;
    const resource = { kind, id };
    live[kind].add(resource);
    return resource;
  };
  let uploaded = [];
  const gl = {
    canvas, live, allocations, draws: [], uniforms: new Map(), lost: false, releases: 0,
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4, ARRAY_BUFFER: 5,
    STATIC_DRAW: 6, DYNAMIC_DRAW: 7, DEPTH_TEST: 8, BLEND: 9, SRC_ALPHA: 10, ONE: 11,
    ONE_MINUS_SRC_ALPHA: 12, COLOR_BUFFER_BIT: 13, FLOAT: 14, POINTS: 15, LINES: 16,
    TRIANGLE_STRIP: 17, TRIANGLES: 18,
    get drawingBufferWidth() { return canvas.width; },
    get drawingBufferHeight() { return canvas.height; },
    createShader: () => allocate("shaders"), createProgram: () => allocate("programs"), createBuffer: () => allocate("buffers"),
    deleteShader: (shader) => live.shaders.delete(shader),
    deleteProgram: (program) => live.programs.delete(program),
    deleteBuffer: (buffer) => live.buffers.delete(buffer),
    shaderSource() {}, compileShader() {}, attachShader() {}, bindAttribLocation() {}, linkProgram() {},
    getShaderParameter: (shader) => failure !== `compile-${shader.id}`,
    getProgramParameter: (program) => failure !== `link-${program.id}`,
    getShaderInfoLog: () => "Shader rejected", getProgramInfoLog: () => "Link rejected",
    getUniformLocation: (_program, name) => name,
    getAttribLocation: (_program, name) => ({ a_pos: 0, a_size: 1, a_col: 2 })[name],
    uniform1f(name, value) { this.uniforms.set(name, value); },
    uniform1i(name, value) { this.uniforms.set(name, value); },
    uniform2f(name, x, y) { this.uniforms.set(name, [x, y]); },
    bindBuffer() {}, disable() {}, enable() {}, blendFunc() {}, blendFuncSeparate() {},
    viewport() {}, clearColor() {}, clear() {}, useProgram() {},
    enableVertexAttribArray() {}, disableVertexAttribArray() {}, vertexAttribPointer() {},
    bufferData(_target, data) { uploaded = [...data]; },
    drawArrays(mode, _first, count) {
      if (this.failDraw) throw new Error("Draw failed");
      this.draws.push({ mode, count, data: uploaded });
    },
    isContextLost() { return this.lost; },
    getExtension: () => ({ loseContext() { gl.lost = true; gl.releases++; } }),
  };
  return gl;
}

function globals(t, values) {
  for (const [key, value] of Object.entries(values)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
  }
}

function fixture(t, { supported = true, failure, reduce = true } = {}) {
  let map;
  t.after(() => map?.destroy());
  const canvases = [];
  const contexts = [];
  const pending = new Map();
  const frames = [];
  const statuses = [];
  const selected = [];
  const warnings = [];
  const preference = { ...element(), matches: reduce };
  const buttons = new Map(["in", "out", "reset"].map((key) => [`[data-zoom-${key}]`, element("button")]));
  const zoom = element("output");
  const wrap = element();
  wrap.querySelector = (key) => key === "[data-zoom]" ? zoom : buttons.get(key) ?? null;
  for (const button of buttons.values()) wrap.insertBefore(button, null);
  let now = start;
  let sequence = 0;
  let disconnected = false;
  globals(t, {
    document: { createElement(tag) {
      const item = element(tag);
      if (tag === "canvas") {
        canvases.push(item);
        item.context = context2d();
        item.getContext = (type) => {
          if (item.contextType && item.contextType !== type) return null;
          if (type === "2d") {
            if (failure === "labels" && canvases.length === 3) return null;
            if (failure === "labels-throw" && canvases.length === 3) throw new Error("Label context rejected");
            item.contextType = type;
            return item.context;
          }
          if (failure === "context") throw new Error("Context rejected");
          if (!supported) return null;
          item.contextType = type;
          item.gl = fakeGL(item, failure);
          contexts.push(item.gl);
          return item.gl;
        };
      }
      return item;
    } },
    window: { matchMedia: () => preference, devicePixelRatio: 2 },
    ResizeObserver: class { observe() {} disconnect() { disconnected = true; } },
    requestAnimationFrame: (callback) => { const id = ++sequence; pending.set(id, callback); return id; },
    cancelAnimationFrame: (id) => pending.delete(id),
  });
  t.mock.method(Date, "now", () => now);
  t.mock.method(console, "warn", (...args) => warnings.push(args));
  const draw = GraphGL.prototype.draw;
  t.mock.method(GraphGL.prototype, "draw", function(frame) {
    frames.push({ frame, renderer: this, positions: frame.nodes.map((node) => [node.id, node.sx, node.sy]) });
    return draw.call(this, frame);
  });
  map = mountGraphCanvas(wrap, { onPlayback: (value) => statuses.push(value), onSelect: (id) => selected.push(id) });
  const step = (elapsed = 0) => {
    now = start + elapsed;
    for (const canvas of canvases) canvas.context.operations.length = 0;
    for (const gl of contexts) gl.draws.length = 0;
    assert.equal(pending.size, 1, "Only the shared mount schedules animation");
    const [id, callback] = pending.entries().next().value;
    pending.delete(id);
    callback(performance.now() + elapsed);
  };
  const pointer = (type, node) => wrap.fire(type, {
    target: { closest: () => null }, button: 0, pointerId: 1, pointerType: "mouse",
    clientX: node.sx, clientY: node.sy, preventDefault() {},
  });
  return { map, wrap, canvases, contexts, frames, statuses, selected, warnings, preference, buttons, pending,
    step, pointer, clock: (elapsed) => { now = start + elapsed; }, disconnected: () => disconnected };
}

const labels = (canvas) => canvas.context.operations.filter((op) => op.type === "fillText");

test("production mount selects WebGL, preserves every 2D decoration/label and shares projection and picking", (t) => {
  const { map, wrap, canvases, contexts, frames, step, pointer, selected } = fixture(t);
  map.setGraph(nodes, edges);
  step();
  assert.equal(wrap.dataset.renderer, "webgl");
  const visible = wrap.children.filter((child) => child.tagName === "CANVAS");
  assert.deepEqual(visible, canvases);
  const [backdrop, gpu, overlay] = visible;
  for (const canvas of visible) {
    assert.equal(canvas.width, 1600);
    assert.equal(canvas.height, 1200);
    assert.equal(canvas.style.pointerEvents, "none");
    assert.equal(canvas.attributes.get("aria-hidden"), "true");
  }
  assert.equal(gpu.contextType, "webgl");
  assert.equal(contexts[0].uniforms.get("u_dpr"), 2);
  assert.deepEqual(contexts[0].uniforms.get("u_res"), [800, 600]);
  assert.equal(backdrop.context.operations.filter((op) => op.type === "fillRect").length, 641, "Background and dust are drawn once");
  assert.deepEqual(labels(backdrop).map((op) => op.args[0]), map.clusters().map(({ label }) => label));
  assert.deepEqual(labels(overlay).map((op) => op.args[0]).sort(), ["a", "b", "c"]);
  assert.ok(!overlay.context.operations.some((op) => ["fill", "stroke", "fillRect"].includes(op.type)));
  assert.ok(!backdrop.context.operations.some((op) => op.fill === "#e8f2ff" || String(op.stroke).startsWith("rgba(150, 200")));
  assert.ok(!contexts[0].draws.some((draw) => draw.mode === contexts[0].TRIANGLE_STRIP), "GPU must not duplicate the backdrop");
  assert.equal(contexts[0].draws.find((draw) => draw.mode === contexts[0].TRIANGLES).count, edges.length * 6);
  const picked = frames.at(-1).frame.nodes.find((node) => node.depth >= 0.62);
  pointer("pointerdown", picked);
  pointer("pointerup", picked);
  assert.deepEqual(selected, [picked.id]);
  map.setSelected(picked.id);
  map.setQuery(picked.id);
  step(100);
  assert.equal(frames.at(-1).frame.selectedId, picked.id);
  assert.equal(frames.at(-1).frame.query, picked.id);
  assert.ok(labels(overlay).some((op) => op.args[0] === picked.title));
});

test("mounted WebGL uses one paced playback/lifecycle frame, retains counts and throttles status once", (t) => {
  const playbackFrame = t.mock.method(ActivityPlayback.prototype, "frame");
  const lifecycleFrame = t.mock.method(GraphLifecycle.prototype, "frame");
  const { map, canvases, frames, statuses, step } = fixture(t);
  map.setGraph(nodes, edges, "layers", changes(0));
  map.setActivity({ enabled: true, durationMs: 5000, nodes: [
    { id: "a", accessedAt: start, expiresAt: start + 5000, sequence: 3, firstSequence: 1, count: 3 },
    { id: "b", accessedAt: start, expiresAt: start + 5000, sequence: 4, firstSequence: 4, count: 1 },
  ] });
  step();
  step(120);
  assert.deepEqual([...frames.at(-1).frame.activityFrame.nodes.keys()], ["a"]);
  assert.equal(statuses.length, 1);
  assert.ok(labels(canvases[2]).some((op) => op.args[0] === "a x3"));
  step(ACTIVITY_SPACING_MS);
  step(ACTIVITY_SPACING_MS + 120);
  const latest = frames.at(-1);
  assert.deepEqual([...latest.frame.activityFrame.nodes.keys()], ["a", "b"]);
  assert.equal(latest.frame.activityFrame.edges.length, 1);
  assert.equal(playbackFrame.mock.callCount(), 4);
  assert.equal(lifecycleFrame.mock.callCount(), 4);
  assert.equal(latest.frame.activityFrame, playbackFrame.mock.calls.at(-1).result);
  assert.equal(latest.frame.lifecycleFrame, lifecycleFrame.mock.calls.at(-1).result);
  assert.equal(latest.renderer.playback, undefined);
  assert.equal(latest.renderer.lifecycle, undefined);
  assert.equal(statuses.length, 2);
});

for (const supported of [true, false]) {
  test(`${supported ? "WebGL" : "2D"} activity framing reaches a close view during the highlight lifetime`, (t) => {
    const move = t.mock.method(ActivityCamera.prototype, "move");
    const { map, wrap, frames, step, clock } = fixture(t, { supported, reduce: false });
    map.setGraph(nodes, edges, "atlases", changes(0));
    for (let time = 0; time < 2000; time += 1000 / 60) step(time);
    clock(2000);
    map.setActivity({ enabled: true, durationMs: 5000, nodes: [
      { id: "a", accessedAt: start + 2000, expiresAt: start + 7000, sequence: 1, firstSequence: 1, count: 1 },
    ] });
    for (let time = 2000; time <= 6000; time += 1000 / 60) step(time);
    const camera = move.mock.calls.at(-1).arguments[0];
    assert.ok(camera.k > 19 && camera.k <= 20, `Expected a close bounded view, got ${camera.k}`);
    assert.equal(wrap.dataset.renderer, supported ? "webgl" : "2d");
    if (supported) {
      const frame = frames.at(-1);
      const [, x, y] = frame.positions.find(([id]) => id === "a");
      assert.ok(x > 80 && x < 720 && y > 90 && y < 510, `Active node left the padded view: ${x}, ${y}`);
      assert.ok(frame.frame.activityFrame.nodes.has("a"));
    }
  });
}

test("WebGL labels retain birth/deletion effects, reduced motion and lifecycle expiry", (t) => {
  const { map, canvases, frames, step, clock, preference } = fixture(t, { reduce: false });
  map.setGraph(nodes.slice(0, 2), [], "layers", changes(0));
  step();
  map.setGraph(nodes.slice(1), [], "layers", changes(1, [nodes[2]], [nodes[0]]));
  step(1000);
  let label = labels(canvases[2]).find((op) => op.args[0] === "a");
  assert.equal(label?.alpha, 0.5);
  assert.equal(frames.at(-1).frame.lifecycleFrame.births.get("c").nodeOpacity, 0.5);
  preference.fire("change", { matches: true });
  step(1200);
  assert.equal(frames.at(-1).frame.reduce, true);
  label = labels(canvases[2]).find((op) => op.args[0] === "a");
  assert.equal(label?.alpha, 1);
  clock(2000);
  step(2000);
  assert.equal(labels(canvases[2]).some((op) => op.args[0] === "a"), false);
  assert.equal(frames.at(-1).frame.lifecycleFrame.births.size, 0);
});

for (const failure of [null, "context", "shaders-2", "compile-2", "link-2", "buffers-2", "labels", "labels-throw"]) {
  test(`mount falls back to usable 2D and releases partial GPU resources: ${failure ?? "unsupported"}`, (t) => {
    const { map, wrap, canvases, contexts, step, warnings } = fixture(t, { supported: Boolean(failure), failure });
    map.setGraph(nodes, edges);
    step();
    assert.equal(wrap.dataset.renderer, "2d");
    assert.equal(wrap.children.filter((child) => child.tagName === "CANVAS").length, 1);
    assert.ok(labels(canvases[0]).some((op) => op.args[0] === "a"));
    assert.ok(canvases[0].context.operations.some((op) => op.type === "fill" && op.fill === "#e8f2ff"));
    for (const gl of contexts) {
      for (const resources of Object.values(gl.live)) assert.equal(resources.size, 0);
      assert.equal(gl.releases, 1);
    }
    if (failure && !failure.startsWith("labels")) assert.equal(warnings.length, 1);
  });
}

for (const failure of ["context loss", "draw error"]) {
  test(`${failure} switches to 2D without restarting playback, camera, labels or animation`, (t) => {
    const playbackFrame = t.mock.method(ActivityPlayback.prototype, "frame");
    const { map, wrap, canvases, contexts, frames, step, pending } = fixture(t);
    map.setGraph(nodes, edges);
    map.setSelected("a");
    map.setQuery("a");
    map.setActivity({ enabled: true, durationMs: 5000, nodes: [
      { id: "a", accessedAt: start, expiresAt: start + 5000, sequence: 3, firstSequence: 1, count: 3 },
      { id: "b", accessedAt: start, expiresAt: start + 5000, sequence: 4, firstSequence: 4, count: 1 },
    ] });
    step();
    step(120);
    const before = labels(canvases[2]);
    const calls = playbackFrame.mock.callCount();
    if (failure === "context loss") {
      let prevented = false;
      contexts[0].lost = true;
      canvases[1].fire("webglcontextlost", { preventDefault() { prevented = true; } });
      assert.equal(prevented, true);
      assert.equal(playbackFrame.mock.callCount(), calls);
    } else {
      contexts[0].failDraw = true;
      step(120);
      assert.equal(playbackFrame.mock.callCount(), calls + 1);
    }
    assert.equal(wrap.dataset.renderer, "2d");
    assert.ok(wrap.children.some((child) => child.attributes.get("role") === "status" && /using 2D/.test(child.textContent)));
    assert.equal(wrap.children.filter((child) => child.tagName === "CANVAS").length, 1);
    for (const previous of before) {
      const current = labels(canvases[0]).find((op) => op.args[0] === previous.args[0]);
      assert.deepEqual(current?.args, previous.args);
    }
    assert.equal(frames.at(-1).renderer.destroyed, true);
    for (const resources of Object.values(contexts[0].live)) assert.equal(resources.size, 0);
    assert.equal(canvases[1].listeners.size, 0);
    assert.equal(pending.size, 1);
    step(ACTIVITY_SPACING_MS);
    step(ACTIVITY_SPACING_MS + 120);
    assert.deepEqual([...playbackFrame.mock.calls.at(-1).result.nodes.keys()], ["a", "b"]);
  });
}

test("destroy releases GPU, all mounted layers/listeners/RAF and is safe to repeat or remount", (t) => {
  const { map, wrap, canvases, contexts, step, pending, preference, buttons, disconnected } = fixture(t);
  map.setGraph(nodes, edges);
  step();
  map.destroy();
  map.destroy();
  assert.equal(pending.size, 0);
  assert.equal(disconnected(), true);
  assert.equal(preference.listeners.size, 0);
  assert.equal(wrap.listeners.size, 0);
  assert.equal(wrap.dataset.renderer, undefined);
  assert.deepEqual(wrap.children, [...buttons.values()]);
  for (const canvas of canvases) assert.equal(canvas.listeners.size, 0);
  for (const button of buttons.values()) assert.equal(button.listeners.size, 0);
  for (const resources of Object.values(contexts[0].live)) assert.equal(resources.size, 0);
  assert.equal(contexts[0].releases, 1);
  const remounted = mountGraphCanvas(wrap, {});
  assert.equal(pending.size, 1);
  assert.equal(wrap.dataset.renderer, "webgl");
  remounted.destroy();
  assert.equal(pending.size, 0);
  assert.deepEqual(wrap.children, [...buttons.values()]);
});

test("GPU render buffers include every relationship beyond 5000, including selected/query/lifecycle tail edges", () => {
  const canvas = element("canvas");
  const gl = fakeGL(canvas);
  canvas.getContext = () => gl;
  const renderer = createGraphGL(canvas, { transparent: true });
  const projected = ["a", "b", "c", "d"].map((id, i) => ({
    id, title: id, kind: "work", sx: i * 100 + 50, sy: 200, depth: 1, born: 0, lon: 0, r: 3, wz: 0,
  }));
  const relationships = Array.from({ length: 6001 }, (_, i) => ({
    id: `edge-${i}`, source: i === 6000 ? "c" : "a", target: i === 6000 ? "d" : "b", kind: "mesh",
  }));
  const lifecycle = emptyLifecycle();
  lifecycle.births.set("c", { nodeOpacity: 0.5, alpha: 0, rgb: [0.25, 1, 0.42], scale: 1 });
  try {
    renderer.resize(800, 600, 2);
    renderer.draw({ nodes: projected, edges: relationships, query: "c", selectedId: "c", t: 10, k: 1,
      w: 800, h: 600, reduce: true, transparent: true, activityFrame: emptyActivity(), lifecycleFrame: lifecycle });
    const allEdges = gl.draws.find((draw) => draw.mode === gl.TRIANGLES);
    assert.equal(allEdges.count, relationships.length * 6);
    assert.equal(allEdges.data.length, relationships.length * 36);
    const tail = allEdges.data.slice(-36);
    assert.deepEqual([...new Set(tail.filter((_value, i) => i % 6 === 0))], [250, 350]);
    assert.ok(Math.abs(tail[5] - 0.95 * 0.5) < 1e-6);
    assert.ok(allEdges.data[5] < tail[5], "Earlier unrelated edges are dimmed, not the relevant tail edge");
    assert.equal(renderer.playback, undefined);
    assert.equal(renderer.lifecycle, undefined);
  } finally {
    renderer.destroy();
  }
});
