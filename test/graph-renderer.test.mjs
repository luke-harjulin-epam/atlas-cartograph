import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { mountGraphCanvas } from "../.apm/extensions/cartograph/public/graph-canvas.js";
import { createGraphGL, GraphGL } from "../.apm/extensions/cartograph/public/graph-gl.js";
import { ActivityPlayback, ACTIVITY_SPACING_MS } from "../.apm/extensions/cartograph/public/activity-playback.js";
import { ActivityCamera } from "../.apm/extensions/cartograph/public/activity-camera.js";
import { GraphLifecycle } from "../.apm/extensions/cartograph/public/graph-lifecycle.js";
import { loadFullGraph } from "../.apm/extensions/cartograph/atlas/scan.mjs";

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
      if (key === "createRadialGradient") return (...args) => {
        const stops = [];
        operations.push({ type: "radialGradient", args, stops });
        return { addColorStop: (offset, color) => stops.push([offset, color]) };
      };
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
  const frameRates = [];
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
  map = mountGraphCanvas(wrap, {
    onPlayback: (value) => statuses.push(value), onSelect: (id) => selected.push(id),
    onFrameRate: (value) => frameRates.push(value),
  });
  const frameOrigin = Math.ceil(performance.now());
  const step = (elapsed = 0) => {
    now = start + elapsed;
    for (const canvas of canvases) canvas.context.operations.length = 0;
    for (const gl of contexts) gl.draws.length = 0;
    assert.equal(pending.size, 1, "Only the shared mount schedules animation");
    const [id, callback] = pending.entries().next().value;
    pending.delete(id);
    callback(frameOrigin + elapsed);
  };
  const pointer = (type, node) => wrap.fire(type, {
    target: { closest: () => null }, button: 0, pointerId: 1, pointerType: "mouse",
    clientX: node.sx, clientY: node.sy, preventDefault() {},
  });
  return { map, wrap, canvases, contexts, frames, statuses, frameRates, selected, warnings, preference, buttons, pending,
    step, pointer, clock: (elapsed) => { now = start + elapsed; }, disconnected: () => disconnected };
}

const labels = (canvas) => canvas.context.operations.filter((op) => op.type === "fillText");
const pulseRings = (canvas) => canvas.context.operations.flatMap((op, index, operations) =>
  op.type === "stroke" && String(op.stroke).startsWith("rgba(140, 190, 255,") && operations[index - 1]?.type === "arc"
    ? [operations[index - 1].args] : []);

for (const supported of [true, false]) {
  test(`${supported ? "WebGL" : "2D"} map labels match the shared Atlas/path/type search`, (t) => {
    const { map, canvases, step } = fixture(t, { supported });
    const indexed = nodes.map((node, i) => ({
      ...node, path: `docs/${node.id}.md`, atlasLabel: i === 0 ? "Northern" : "Southern",
      type: i === 1 ? "instrument" : "work",
    }));
    map.setGraph(indexed, edges);
    for (const [query, expected] of [["Northern", ["a"]], ["docs/b.md", ["b"]], ["instrument", ["b"]]]) {
      map.setQuery(query);
      step(0);
      const drawn = labels(canvases[supported ? 2 : 0]).map((op) => op.args[0]).filter((text) => ["a", "b", "c"].includes(text));
      assert.deepEqual(drawn.sort(), expected);
    }
  });

  test(`${supported ? "WebGL" : "2D"} pulse anchors to the galaxy core or selected node and respects reduced motion`, (t) => {
    const { map, canvases, frames, pointer, step } = fixture(t, { supported });
    map.setGraph(nodes, edges, "layers", changes(0));
    step(0);
    const rings = pulseRings(canvases[0]);
    assert.equal(rings.length, 3);
    const core = canvases[0].context.operations.find((op) =>
      op.type === "radialGradient" && op.stops.some(([, color]) => color.startsWith("rgba(255, 238, 199,")));
    assert.ok(core);
    assert.ok(rings.every(([x, y]) => x === core.args[0] && y === core.args[1]));
    map.setSelected("b");
    step(20);
    const selectedPosition = () => {
      if (supported) return frames.at(-1).positions.find(([id]) => id === "b").slice(1);
      const ops = canvases[0].context.operations;
      const index = ops.findIndex((op) => op.type === "fill" && op.fill === "#f4fbff");
      assert.equal(ops[index - 1].type, "arc");
      return ops[index - 1].args.slice(0, 2);
    };
    assert.ok(pulseRings(canvases[0]).every((ring) => {
      const [x, y] = selectedPosition();
      return ring[0] === x && ring[1] === y;
    }));
    pointer("pointerdown", { sx: 0, sy: 0 });
    pointer("pointermove", { sx: 80, sy: 40 });
    pointer("pointerup", { sx: 80, sy: 40 });
    step(40);
    const [x, y] = selectedPosition();
    const rotated = pulseRings(canvases[0]);
    assert.ok(rotated.every((ring) => ring[0] === x && ring[1] === y));
    step(1040);
    assert.deepEqual(pulseRings(canvases[0]), rotated, "Reduced motion freezes pulse expansion");
    map.setSelected(null);
    map.setGraph(nodes.map((node, i) => ({ ...node, atlasKey: i < 2 ? "one" : "two" })), edges, "atlases", changes(0));
    step(1060);
    assert.equal(pulseRings(canvases[0]).length, 6, "Each galaxy uses its own core, not an aggregate centroid");
  });

  test(`${supported ? "WebGL" : "2D"} reports actual render FPS once per second and resets after suspension`, (t) => {
    const { map, step, frameRates } = fixture(t, { supported });
    map.setGraph(nodes, edges);
    step(0);
    assert.deepEqual(frameRates, [null]);
    for (let frame = 1; frame <= 60; frame++) step(frame * 1000 / 60);
    assert.deepEqual(frameRates, [null, 60]);
    for (let frame = 1; frame <= 5; frame++) step(1000 + frame * 200);
    assert.deepEqual(frameRates, [null, 60, 5]);
    step(6000);
    assert.deepEqual(frameRates, [null, 60, 5, null]);
    for (let frame = 1; frame <= 30; frame++) step(6000 + frame * 1000 / 30);
    assert.equal(frameRates.at(-1), 30);
    map.destroy();
    assert.equal(frameRates.at(-1), null);
  });
}

test("first-stage selection highlights only the selected node and its first-degree neighbors", (t) => {
  const packed = [];
  const original = GraphGL.prototype.packNodes;
  t.mock.method(GraphGL.prototype, "packNodes", function(frame, query, match, related) {
    packed.push({ selected: frame.selectedId, related: [...related], matched: frame.nodes.filter(match).map((node) => node.id) });
    return original.call(this, frame, query, match, related);
  });
  const { map, step } = fixture(t);
  map.setGraph(nodes.map((node) => ({ ...node, path: `${node.id}.md` })), edges);
  map.setQuery("a.md");
  map.setSelected("a");
  step(0);
  assert.equal(packed.at(-1).selected, "a");
  assert.deepEqual(new Set(packed.at(-1).related), new Set(["a", "b"]));
  assert.deepEqual(new Set(packed.at(-1).matched), new Set(["a", "b"]), "Search must not dim the selected node's direct neighbors");
});

test("grouping changes cancel stale activation framing and bound turns after a long manual orbit", (t) => {
  const samples = [];
  const original = ActivityCamera.prototype.update;
  t.mock.method(ActivityCamera.prototype, "update", function(nodes, camera, width, height, now, options) {
    const target = original.call(this, nodes, camera, width, height, now, options);
    samples.push({ now, yaw: camera.yaw, automatic: Boolean(target) });
    return target;
  });
  const { map, pointer, step, clock } = fixture(t, { reduce: false });
  map.setGraph(nodes, edges, "layers", changes(0));
  map.setActivity({ enabled: true, durationMs: 20000, nodes: [
    { id: "a", accessedAt: start, expiresAt: start + 20000, sequence: 1, firstSequence: 1, count: 1 },
  ] });
  for (let time = 0; time <= 2000; time += 20) step(time);
  assert.ok(samples.some((sample) => sample.automatic));
  pointer("pointerdown", { sx: 0, sy: 0 });
  pointer("pointermove", { sx: 5000, sy: 0 });
  pointer("pointerup", { sx: 5000, sy: 0 });
  for (const [time, grouping] of [[2020, "atlases"], [2040, "proximity"], [2060, "layers"]]) {
    clock(time);
    map.setGraph(nodes, edges, grouping, changes(0));
    step(time);
  }
  samples.length = 0;
  for (let time = 2080; time < 7060; time += 20) step(time);
  assert.ok(samples.every((sample) => !sample.automatic), "Following yields for five seconds after regrouping");
  for (let i = 1; i < samples.length; i++) {
    assert.ok(Math.abs(samples[i].yaw - samples[i - 1].yaw) / 0.02 <= 1.5 + 1e-9, "No multi-revolution spin");
  }
  step(7080);
  assert.equal(samples.at(-1).automatic, true, "Displayed activation following can resume after the pause");
});

for (const supported of [true, false]) {
  test(`${supported ? "WebGL" : "2D"} schema islands use stable type keys and clear removed focus`, (t) => {
    const { map, wrap, step } = fixture(t, { supported });
    const typed = ["north", "south"].map((atlas, i) => ({
      id: `instrument-${i}`, title: "Synthetic instrument", kind: "page", type: "instrument",
      typeKey: `${atlas}:instrument`, schemaKey: `${atlas}:observations`, schemaLabel: "observations",
      atlasKey: atlas, degree: 0, sourceCount: 0,
    }));
    map.setGraph(typed, [], "layers");
    step();
    assert.equal(wrap.dataset.renderer, supported ? "webgl" : "2d");
    const clusters = map.clusters();
    assert.deepEqual(clusters.map((cluster) => cluster.key), typed.map((node) => node.typeKey));
    assert.ok(clusters.every((cluster) => cluster.count === 1));
    map.setFeatured([clusters[1].key]);
    map.flyTo(clusters[1].key);
    step(100);
    assert.equal(map.focusCluster(), clusters[1].key);
    map.setGraph(typed.slice(0, 1), [], "layers");
    step(200);
    assert.equal(map.focusCluster(), null);
    assert.deepEqual(map.clusters().map((cluster) => cluster.key), [typed[0].typeKey]);
  });
}

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

for (const supported of [true, false]) {
  test(`${supported ? "WebGL" : "2D"} galaxy overview preserves labels for interaction and reveals detail on zoom`, (t) => {
    const graph = loadFullGraph(fileURLToPath(new URL("../.atlas/local/stress-test-atlas", import.meta.url)));
    const { map, canvases, frames, buttons, step } = fixture(t, { supported });
    map.setGraph(graph.nodes, graph.edges, "layers", changes(0));
    step(0);
    const textCanvas = canvases[supported ? 2 : 0];
    const overviewLabels = labels(textCanvas).map((op) => op.args[0]);
    assert.ok(labels(canvases[0]).some((op) => op.args[0] === "Undeclared types"), "Keep the group label on the shared backdrop");
    assert.ok(overviewLabels.length < 30, "Avoid hundreds of overlapping overview labels");
    if (supported) {
      const positions = frames.at(-1).positions;
      const width = Math.max(...positions.map(([, x]) => x)) - Math.min(...positions.map(([, x]) => x));
      const height = Math.max(...positions.map(([, , y]) => y)) - Math.min(...positions.map(([, , y]) => y));
      assert.ok(width / height > 0.6 && width / height < 1.8, "The default view must not face the galaxy edge-on");
      assert.equal(frames.at(-1).frame.edges.length, 1508);
    }
    map.setSelected("work/read-000");
    step(20);
    assert.ok(labels(textCanvas).some((op) => op.args[0] === "Read 000"));
    map.setSelected(null);
    map.setQuery("Read 001");
    step(40);
    assert.ok(labels(textCanvas).some((op) => op.args[0] === "Read 001"));
    map.setQuery("");
    for (let i = 0; i < 7; i++) buttons.get("[data-zoom-in]").fire("click");
    step(60);
    assert.ok(labels(textCanvas).length > 400, "Detailed zoom restores ordinary node labels");
  });

  test(`${supported ? "WebGL" : "2D"} stress Atlas single activation closes in within two seconds`, (t) => {
    const graph = loadFullGraph(fileURLToPath(new URL("../.atlas/local/stress-test-atlas", import.meta.url)));
    assert.equal(graph.nodes.length, 505);
    assert.equal(graph.edges.length, 1508);
    const move = t.mock.method(ActivityCamera.prototype, "move");
    const { map, frames, step, clock } = fixture(t, { supported, reduce: false });
    map.setGraph(graph.nodes, graph.edges, "layers", changes(0));
    for (let time = 0; time < 5000; time += 1000 / 60) step(time);
    clock(5000);
    map.setActivity({ enabled: true, durationMs: 5000, nodes: [
      { id: "work/read-000", accessedAt: start + 5000, expiresAt: start + 10000,
        sequence: 1, firstSequence: 1, count: 1 },
    ] });
    for (let time = 5000; time <= 7000; time += 1000 / 60) step(time);
    const camera = move.mock.calls.at(-1).arguments[0];
    assert.ok(camera.k > 19 && camera.k <= 20, `Close-in zoom: ${camera.k}`);
    if (supported) {
      const [, x, y] = frames.at(-1).positions.find(([id]) => id === "work/read-000");
      assert.ok(x > 80 && x < 720 && y > 90 && y < 510, `Active node left the padded view: ${x}, ${y}`);
    }
  });
}

test("galaxies restore the original idle rotation while selection and reduced motion still suppress it", (t) => {
  const angles = [];
  const update = ActivityCamera.prototype.update;
  t.mock.method(ActivityCamera.prototype, "update", function(nodes, camera, ...rest) {
    angles.push(camera.yaw);
    return update.call(this, nodes, camera, ...rest);
  });
  const { map, step, preference } = fixture(t, { reduce: false });
  map.setGraph(nodes, edges, "layers", changes(0));
  for (let time = 0; time <= 30000; time += 20) step(time);
  const before = angles.at(-1);
  for (let time = 30020; time <= 31000; time += 20) step(time);
  assert.ok(Math.abs(angles.at(-1) - before - 0.16) < 1e-8);
  map.setSelected("a");
  step(31020);
  const selected = angles.at(-1);
  step(31040);
  assert.equal(angles.at(-1), selected);
  map.setSelected(null);
  preference.fire("change", { matches: true });
  step(31060);
  const reduced = angles.at(-1);
  step(32060);
  assert.equal(angles.at(-1), reduced);
});

test("WebGL labels retain birth/deletion effects, reduced motion and lifecycle expiry", (t) => {
  const { map, canvases, frames, step, clock, preference } = fixture(t, { reduce: false });
  map.setGraph(nodes.slice(0, 2), [], "layers", changes(0));
  step();
  map.setGraph(nodes.slice(1), [], "layers", changes(1, [nodes[2]], [nodes[0]]));
  step(1750);
  let label = labels(canvases[2]).find((op) => op.args[0] === "a");
  assert.equal(label?.alpha, 0.5);
  assert.equal(frames.at(-1).frame.lifecycleFrame.births.get("c").nodeOpacity, 0.5);
  preference.fire("change", { matches: true });
  step(1950);
  assert.equal(frames.at(-1).frame.reduce, true);
  label = labels(canvases[2]).find((op) => op.args[0] === "a");
  assert.equal(label?.alpha, 1);
  clock(3500);
  step(3500);
  assert.equal(labels(canvases[2]).some((op) => op.args[0] === "a"), false);
  assert.equal(frames.at(-1).frame.lifecycleFrame.births.size, 1);
  step(10000);
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
