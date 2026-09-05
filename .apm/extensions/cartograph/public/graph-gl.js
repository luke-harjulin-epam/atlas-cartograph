import { activityNodeStyle, activityEdgeOpacity, activityPulse } from "./activity-rendering.js";
import { ActivityPlayback, PLAYBACK_STATUS_INTERVAL_MS } from "./activity-playback.js";
import { GraphLifecycle, lifecyclePoints, lifecycleNodeOpacity, lifecycleEdgeOpacity, lifecycleEdgeGlows } from "./graph-lifecycle.js";

const CORE = {
  experience: [212 / 255, 228 / 255, 1],
  decision: [142 / 255, 200 / 255, 192 / 255],
  work: [232 / 255, 242 / 255, 1],
  lesson: [184 / 255, 212 / 255, 200 / 255],
  recipe: [196 / 255, 212 / 255, 232 / 255],
  index: [240 / 255, 244 / 255, 250 / 255],
  page: [125 / 255, 142 / 255, 170 / 255],
  knowledge: [212 / 255, 228 / 255, 1],
  raw: [125 / 255, 142 / 255, 170 / 255],
  module: [142 / 255, 200 / 255, 192 / 255]
};
const GLOW = {
  experience: [130, 180, 255, 0.5], knowledge: [130, 180, 255, 0.5],
  decision: [80, 200, 190, 0.45], module: [80, 200, 190, 0.42],
  work: [170, 210, 255, 0.55], index: [170, 210, 255, 0.55],
  lesson: [120, 190, 160, 0.4], recipe: [140, 170, 210, 0.42],
  page: [110, 140, 190, 0.28], raw: [110, 140, 190, 0.28],
};
const VS_POINT = `
attribute vec2 a_pos;
attribute float a_size;
attribute vec4 a_col;
uniform vec2 u_res;
uniform float u_dpr;
varying vec4 v_col;
void main() {
  vec2 clip = (a_pos / u_res) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  gl_PointSize = max(a_size * u_dpr, 1.0);
  v_col = a_col;
}`;
const FS_POINT = `
precision mediump float;
varying vec4 v_col;
uniform bool u_solid;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float d = dot(p, p);
  if (d > 1.0) discard;
  float a = u_solid ? 1.0 : exp(-d * 2.6);
  gl_FragColor = vec4(v_col.rgb, v_col.a * a);
}`;
const VS_LINE = `
attribute vec2 a_pos;
attribute vec4 a_col;
uniform vec2 u_res;
varying vec4 v_col;
void main() {
  vec2 clip = (a_pos / u_res) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_col = a_col;
}`;
const FS_LINE = `
precision mediump float;
varying vec4 v_col;
void main() {
  gl_FragColor = v_col;
}`;
const VS_QUAD = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;
const FS_QUAD = `
precision mediump float;
varying vec2 v_uv;
void main() {
  vec2 d = v_uv - vec2(0.5, 0.48);
  float r = length(d);
  vec3 c = mix(vec3(0.07, 0.13, 0.20), vec3(0.02, 0.03, 0.05), smoothstep(0.0, 0.72, r));
  c = mix(vec3(0.07, 0.13, 0.20), c, 0.35);
  gl_FragColor = vec4(c, 1.0);
}`;
function compile(gl, vs, fs) {
  const shaders = [];
  let program;
  try {
    for (const [type, source] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
      const shader = gl.createShader(type);
      if (!shader) throw new Error("Unable to allocate a graph shader.");
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader) || "Unable to compile a graph shader.");
      }
    }
    program = gl.createProgram();
    if (!program) throw new Error("Unable to allocate a graph program.");
    for (const shader of shaders) gl.attachShader(program, shader);
    gl.bindAttribLocation(program, 0, "a_pos");
    gl.bindAttribLocation(program, 1, "a_size");
    gl.bindAttribLocation(program, 2, "a_col");
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || "Unable to link a graph program.");
    }
    return program;
  } catch (error) {
    if (program) gl.deleteProgram(program);
    throw error;
  } finally {
    for (const shader of shaders) gl.deleteShader(shader);
  }
}
class GraphGL {
  gl;
  point;
  line;
  quad;
  buf;
  quadBuf;
  cssW = 1;
  cssH = 1;
  dpr = 1;
  scratch = new Float32Array(7 * 8192);
  loc = {
    pointRes: null,
    pointDpr: null,
    pointSolid: null,
    pointPos: 0,
    pointSize: 0,
    pointCol: 0,
    lineRes: null,
    linePos: 0,
    lineCol: 0,
    quadPos: 0
  };
  constructor(gl, point, line, quad) {
    this.gl = gl;
    this.point = point;
    this.line = line;
    this.quad = quad;
    try {
      this.buf = gl.createBuffer();
      this.quadBuf = gl.createBuffer();
      if (!this.buf || !this.quadBuf) throw new Error("Unable to allocate graph buffers.");
      this.initialize();
    } catch (error) {
      if (this.buf) gl.deleteBuffer(this.buf);
      if (this.quadBuf) gl.deleteBuffer(this.quadBuf);
      throw error;
    }
  }
  initialize() {
    const { gl, point, line, quad } = this;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    this.loc.pointRes = gl.getUniformLocation(point, "u_res");
    this.loc.pointDpr = gl.getUniformLocation(point, "u_dpr");
    this.loc.pointSolid = gl.getUniformLocation(point, "u_solid");
    this.loc.pointPos = gl.getAttribLocation(point, "a_pos");
    this.loc.pointSize = gl.getAttribLocation(point, "a_size");
    this.loc.pointCol = gl.getAttribLocation(point, "a_col");
    this.loc.lineRes = gl.getUniformLocation(line, "u_res");
    this.loc.linePos = gl.getAttribLocation(line, "a_pos");
    this.loc.lineCol = gl.getAttribLocation(line, "a_col");
    this.loc.quadPos = gl.getAttribLocation(quad, "a_pos");
  }
  resize(cssW, cssH, dpr) {
    const gl = this.gl;
    const canvas = gl.canvas;
    const bw = Math.max(1, Math.floor(cssW * dpr));
    const bh = Math.max(1, Math.floor(cssH * dpr));
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    gl.viewport(0, 0, bw, bh);
    this.cssW = cssW;
    this.cssH = cssH;
    this.dpr = dpr;
  }
  draw(f) {
    if (this.destroyed) return;
    if (this.gl.isContextLost?.()) throw new Error("The graph WebGL context was lost.");
    if (!f.lifecycleFrame) {
      this.lifecycle ??= new GraphLifecycle();
      this.lifecycle.setGraph(f.nodes, f.graphChanges, this.lifecycleNodes || [], f.isLifecycleVisible,
        f.edges, this.lifecycleEdges || [], f.isLifecycleEdgeVisible);
      this.lifecycleNodes = f.nodes.map((node) => ({ ...node }));
      this.lifecycleEdges = f.edges.map((edge) => ({ ...edge }));
      f = { ...f, lifecycleFrame: this.lifecycle.frame(Date.now(), f.reduce) };
    }
    if (!f.activityFrame) {
      this.playback ??= new ActivityPlayback();
      if (this.activityNodes !== f.nodes || this.activityEdges !== f.edges) {
        this.playback.setGraph(f.nodes, f.edges);
        this.activityNodes = f.nodes;
        this.activityEdges = f.edges;
      }
      if (this.activityInput !== f.activity) {
        this.playback.update(f.activity);
        this.activityInput = f.activity;
      }
      f = { ...f, activityFrame: this.playback.frame(Date.now()) };
    }
    const now = Date.now();
    if (f.onPlayback && (this.lastPlaybackStatusAt === undefined || now - this.lastPlaybackStatusAt >= PLAYBACK_STATUS_INTERVAL_MS)) {
      this.lastPlaybackStatusAt = now;
      f.onPlayback?.(f.activityFrame?.playback);
    }
    const gl = this.gl;
    const { w, h } = f;
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(f.transparent ? 0 : 0.02, f.transparent ? 0 : 0.03, f.transparent ? 0 : 0.05, f.transparent ? 0 : 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (f.transparent) {
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    } else {
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      this.drawQuad();
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      if (f.bg?.length) this.drawPoints(f.bg, 7, f.bg.length / 7);
      this.drawCore(f.cx, f.cy, Math.min(w, h) * 0.12 * f.k);
    }
    const lookup = new Map(f.nodes.map((n) => [n.id, n]));
    const q = f.query.trim().toLowerCase();
    const match = (n) => !q || n.title.toLowerCase().includes(q) || n.id.toLowerCase().includes(q);
    const related = /* @__PURE__ */ new Set();
    if (f.selectedId) {
      related.add(f.selectedId);
      for (const e of f.edges) {
        if (e.source === f.selectedId) related.add(e.target);
        else if (e.target === f.selectedId) related.add(e.source);
      }
    }
    const lineCount = this.packEdges(f, lookup, q, match, related);
    if (lineCount) this.drawLines(this.scratch, lineCount, gl.TRIANGLES);
    this.drawLifecycleEdges(f.lifecycleFrame, lookup);
    this.drawActivity(f, lookup);
    const pointCount = this.packNodes(f, q, match, related);
    if (pointCount) this.drawPoints(this.scratch, 7, pointCount);
    this.drawNodeCores(f, q, match, related);
    this.drawLifecycle(f.lifecycleFrame, lookup);
  }
  drawNodeCores(f, q, match, related) {
    const out = this.ensure(f.nodes.length * 2 * 7);
    let i = 0;
    for (const n of [...f.nodes].sort((a, b) => b.wz - a.wz)) {
      const selected = n.id === f.selectedId;
      const near = related.has(n.id) && !selected;
      const faded = Boolean(q && !match(n)) || related.size > 0 && !related.has(n.id);
      const age = Math.max(0, f.t - n.born);
      const pop = f.reduce || n.lifecycleBorn || this.lifecycleBorn?.has(n.id) ? 1 : 1 - Math.exp(-age * 2.4);
      const pulse = f.reduce ? 1 : 1 + Math.sin(f.t * 2.2 + n.lon) * (selected ? 0.08 : near ? 0.05 : 0.03);
      const style = activityNodeStyle(f.activityFrame, n.id,
        faded ? 0.12 : (0.2 + n.depth * 0.75) * Math.min(1, 0.25 + pop),
        Math.max(0.55, n.r * n.depth * pulse * (0.2 + 0.8 * pop)));
      const opacity = lifecycleNodeOpacity(f.lifecycleFrame, n.id);
      const rgb = faded ? [90 / 255, 110 / 255, 140 / 255] : selected ? [244 / 255, 251 / 255, 1] : CORE[n.kind] ?? CORE.page;
      out[i++] = n.sx; out[i++] = n.sy; out[i++] = style.size * 2 * (selected ? 1.25 : near ? 1.12 : 1);
      out[i++] = rgb[0]; out[i++] = rgb[1]; out[i++] = rgb[2];
      out[i++] = Math.min(1, style.alpha) * opacity * (faded ? 0.18 : 1);
      if (style.strength) {
        out[i++] = n.sx; out[i++] = n.sy; out[i++] = style.size * 2.4;
        out[i++] = 239 / 255; out[i++] = 1; out[i++] = 1; out[i++] = style.strength * opacity;
      }
    }
    if (i) this.drawPoints(out, 7, i / 7, true);
  }
  drawLifecycle(frame, lookup) {
    const points = lifecyclePoints(frame, lookup);
    if (!points.length) return;
    const out = this.ensure(points.length * 7);
    let i = 0;
    for (const point of points) {
      out[i++] = point.x; out[i++] = point.y; out[i++] = point.size;
      out[i++] = point.rgb[0]; out[i++] = point.rgb[1]; out[i++] = point.rgb[2]; out[i++] = point.alpha;
    }
    if (i) this.drawPoints(out, 7, i / 7);
  }
  drawLifecycleEdges(frame, lookup) {
    const glows = lifecycleEdgeGlows(frame, lookup);
    if (!glows.length) return;
    const out = this.ensure(glows.length * 6 * 6);
    let i = 0;
    for (const { source: a, target: b, width, rgb, alpha } of glows) {
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (!length) continue;
      const nx = -(b.y - a.y) / length * width / 2;
      const ny = (b.x - a.x) / length * width / 2;
      for (const [point, sign] of [[a, 1], [a, -1], [b, 1], [b, 1], [a, -1], [b, -1]]) {
        out[i++] = point.x + sign * nx; out[i++] = point.y + sign * ny;
        out[i++] = rgb[0]; out[i++] = rgb[1]; out[i++] = rgb[2]; out[i++] = alpha;
      }
    }
    // Triangle geometry preserves glow width where WebGL lines are limited to one pixel.
    if (i) this.drawLines(out, i / 6, this.gl.TRIANGLES);
  }
  drawQuad() {
    const gl = this.gl;
    gl.useProgram(this.quad);
    gl.disableVertexAttribArray(1);
    gl.disableVertexAttribArray(2);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.enableVertexAttribArray(this.loc.quadPos);
    gl.vertexAttribPointer(this.loc.quadPos, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  drawCore(cx, cy, r) {
    const out = this.scratch;
    out[0] = cx;
    out[1] = cy;
    out[2] = r * 2;
    out[3] = 0.7;
    out[4] = 0.86;
    out[5] = 1;
    out[6] = 0.22;
    this.drawPoints(out, 7, 1);
  }
  drawActivity(f, lookup) {
    const pulses = f.activityFrame.edges.map((edge) => ({ edge, pulse: activityPulse(edge, lookup, f.reduce) })).filter(({ pulse }) => pulse);
    let out = this.ensure(pulses.length * 18 * 6);
    let i = 0;
    for (const { edge, pulse } of pulses) {
      const opacity = lifecycleEdgeOpacity(f.lifecycleFrame, edge.source, edge.target, edge.id);
      for (const [a, b, alpha, width] of [
        [pulse.source, pulse.target, edge.strength * 0.75, 1.5],
        [pulse.wings[0], pulse.head, edge.strength, 2],
        [pulse.wings[1], pulse.head, edge.strength, 2],
      ]) {
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        if (!length) continue;
        const nx = -(b.y - a.y) / length * width / 2;
        const ny = (b.x - a.x) / length * width / 2;
        for (const [point, sign] of [[a, 1], [a, -1], [b, 1], [b, 1], [a, -1], [b, -1]]) {
          out[i++] = point.x + sign * nx; out[i++] = point.y + sign * ny;
          out[i++] = 0.65; out[i++] = 1; out[i++] = 0.92; out[i++] = alpha * opacity;
        }
      }
    }
    if (i) this.drawLines(out, i / 6, this.gl.TRIANGLES);
    out = this.ensure(pulses.length * 9 * 7);
    i = 0;
    for (const { edge, pulse } of pulses) {
      const opacity = lifecycleEdgeOpacity(f.lifecycleFrame, edge.source, edge.target, edge.id);
      for (const point of pulse.trail) {
        out[i++] = point.x; out[i++] = point.y; out[i++] = point.size;
        out[i++] = 0.75; out[i++] = 1; out[i++] = 0.94; out[i++] = point.alpha * opacity;
      }
    }
    if (i) this.drawPoints(out, 7, i / 7);
  }
  packEdges(f, lookup, q, match, related) {
    let i = 0;
    const out = this.ensure(f.edges.length * 6 * 6);
    const locked = related.size > 0;
    for (const edge of f.edges) {
      const a = lookup.get(edge.source);
      const b = lookup.get(edge.target);
      if (!a || !b) continue;
      const depth = (a.depth + b.depth) / 2;
      const hi = Boolean(f.selectedId && (edge.source === f.selectedId || edge.target === f.selectedId));
      if (depth < 0.48 && !hi) continue;
      const faded = Boolean(q && (!match(a) || !match(b))) || locked && !hi;
      const alpha = (hi ? 0.95 : faded ? 0.03 : edge.kind === "source" ? 0.1 * depth : edge.kind === "mesh" ? 0.38 * depth : edge.kind === "relates" ? 0.22 * depth : 0.16 * depth) * activityEdgeOpacity(f.activityFrame) *
        lifecycleEdgeOpacity(f.lifecycleFrame, edge.source, edge.target, edge.id);
      const rgb = hi ? [210 / 255, 235 / 255, 1] : edge.kind === "mesh" ? [120 / 255, 230 / 255, 210 / 255] : [150 / 255, 200 / 255, 1];
      const width = (hi ? 2.4 : edge.kind === "mesh" ? 1.6 : 1) / Math.max(f.k ?? 1, 0.6);
      const length = Math.hypot(b.sx - a.sx, b.sy - a.sy);
      if (!length) continue;
      const nx = -(b.sy - a.sy) / length * width / 2;
      const ny = (b.sx - a.sx) / length * width / 2;
      for (const [point, sign] of [[a, 1], [a, -1], [b, 1], [b, 1], [a, -1], [b, -1]]) {
        out[i++] = point.sx + sign * nx; out[i++] = point.sy + sign * ny;
        out[i++] = rgb[0]; out[i++] = rgb[1]; out[i++] = rgb[2]; out[i++] = alpha;
      }
    }
    return i / 6;
  }
  packNodes(f, q, match, related) {
    const ordered = f.nodes;
    this.lifecycleBorn ??= new Set();
    const visible = new Set(ordered.map((node) => node.id));
    for (const id of this.lifecycleBorn) if (!visible.has(id)) this.lifecycleBorn.delete(id);
    for (const id of f.lifecycleFrame?.births.keys() ?? []) this.lifecycleBorn.add(id);
    const out = this.ensure(ordered.length * 7 * 2);
    const locked = related.size > 0;
    let i = 0;
    for (const n of ordered) {
      const sel = n.id === f.selectedId;
      const hov = n.id === f.hover;
      const near = related.has(n.id) && !sel;
      const faded = Boolean(q && !match(n)) || locked && !related.has(n.id);
      const age = Math.max(0, f.t - n.born);
      const birth = n.lifecycleBorn || this.lifecycleBorn.has(n.id);
      const pop = f.reduce || birth ? 1 : 1 - Math.exp(-age * 2.4);
      const flash = f.reduce || birth ? 0 : Math.exp(-age * 2.1);
      const opacity = lifecycleNodeOpacity(f.lifecycleFrame, n.id);
      const pulse = f.reduce ? 1 : 1 + Math.sin(f.t * 2.2 + n.lon) * (sel ? 0.08 : near ? 0.05 : 0.03);
      const normalAlpha = faded ? 0.12 : (0.2 + n.depth * 0.75) * Math.min(1, 0.25 + pop);
      const style = activityNodeStyle(f.activityFrame, n.id, normalAlpha,
        Math.max(0.55, n.r * n.depth * pulse * (0.2 + 0.8 * pop)));
      const glow = sel || near ? [210, 235, 255, 0.7] : GLOW[n.kind] ?? GLOW.page;
      if (style.strength) {
        out[i++] = n.sx; out[i++] = n.sy; out[i++] = Math.max(10, style.size * 4) * 2;
        out[i++] = 210 / 255; out[i++] = 1; out[i++] = 245 / 255; out[i++] = style.strength * 0.95 * opacity;
      }
      out[i++] = n.sx;
      out[i++] = n.sy;
      out[i++] = (style.size * (sel ? 3.6 : near || hov ? 2.6 : 2) + flash * 16) * 2;
      out[i++] = glow[0] / 255; out[i++] = glow[1] / 255; out[i++] = glow[2] / 255;
      out[i++] = faded || n.depth <= 0.45 ? 0 : Math.min(1, style.alpha) * glow[3] * opacity;
    }
    return i / 7;
  }
  ensure(n) {
    if (this.scratch.length < n) {
      this.scratch = new Float32Array(Math.max(n, this.scratch.length * 2));
    }
    return this.scratch;
  }
  drawPoints(data, stride, count, solid = false) {
    const gl = this.gl;
    gl.useProgram(this.point);
    gl.uniform2f(this.loc.pointRes, this.cssW, this.cssH);
    gl.uniform1f(this.loc.pointDpr, this.dpr);
    gl.uniform1i(this.loc.pointSolid, solid ? 1 : 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, count * stride), gl.DYNAMIC_DRAW);
    const b = stride * 4;
    gl.enableVertexAttribArray(this.loc.pointPos);
    gl.vertexAttribPointer(this.loc.pointPos, 2, gl.FLOAT, false, b, 0);
    gl.enableVertexAttribArray(this.loc.pointSize);
    gl.vertexAttribPointer(this.loc.pointSize, 1, gl.FLOAT, false, b, 8);
    gl.enableVertexAttribArray(this.loc.pointCol);
    gl.vertexAttribPointer(this.loc.pointCol, 4, gl.FLOAT, false, b, 12);
    gl.drawArrays(gl.POINTS, 0, count);
  }
  drawLines(data, count, mode = this.gl.LINES) {
    const gl = this.gl;
    gl.useProgram(this.line);
    gl.disableVertexAttribArray(1);
    gl.uniform2f(this.loc.lineRes, this.cssW, this.cssH);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, count * 6), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.loc.linePos);
    gl.vertexAttribPointer(this.loc.linePos, 2, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(this.loc.lineCol);
    gl.vertexAttribPointer(this.loc.lineCol, 4, gl.FLOAT, false, 24, 8);
    gl.drawArrays(mode, 0, count);
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    const gl = this.gl;
    gl.useProgram(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    for (const buffer of [this.buf, this.quadBuf]) if (buffer) gl.deleteBuffer(buffer);
    for (const program of [this.point, this.line, this.quad]) if (program) gl.deleteProgram(program);
    this.playback?.reset();
    this.lifecycle?.cancel();
    this.lifecycleBorn?.clear();
    this.scratch = new Float32Array(0);
    if (!gl.isContextLost?.()) gl.getExtension?.("WEBGL_lose_context")?.loseContext();
  }
}
function createGraphGL(canvas, { transparent = false } = {}) {
  let gl;
  const programs = [];
  try {
    const attributes = { alpha: transparent, antialias: true, powerPreference: "high-performance", premultipliedAlpha: transparent };
    gl = canvas.getContext("webgl", attributes) || canvas.getContext("experimental-webgl", attributes);
    if (!gl) return null;
    for (const [vertex, fragment] of [[VS_POINT, FS_POINT], [VS_LINE, FS_LINE], [VS_QUAD, FS_QUAD]]) {
      programs.push(compile(gl, vertex, fragment));
    }
    return new GraphGL(gl, ...programs);
  } catch (error) {
    for (const program of programs) gl.deleteProgram(program);
    if (gl && !gl.isContextLost?.()) gl.getExtension?.("WEBGL_lose_context")?.loseContext();
    console.warn("WebGL initialization failed; using Canvas 2D.", error);
    return null;
  }
}
function packBgStars(stars, w, h, yaw, pitch, t, camx, camy, into) {
  const cx = w / 2 + camx * 0.08;
  const cy = h / 2 + camy * 0.08;
  const far = Math.max(w, h) * 0.72;
  const cyaw = Math.cos(yaw * 0.35);
  const syaw = Math.sin(yaw * 0.35);
  const cp = Math.cos(pitch * 0.35);
  const sp = Math.sin(pitch * 0.35);
  let i = 0;
  for (const star of stars) {
    const r = far;
    const x0 = r * Math.sin(star.lat) * Math.cos(star.lon);
    const y0 = r * Math.cos(star.lat);
    const z0 = r * Math.sin(star.lat) * Math.sin(star.lon);
    const x1 = x0 * cyaw - z0 * syaw;
    const z1 = x0 * syaw + z0 * cyaw;
    const y2 = y0 * cp - z1 * sp;
    const z2 = y0 * sp + z1 * cp;
    if (z2 > far * 0.15) continue;
    const twinkle = 0.55 + 0.45 * Math.sin(t * 1.4 + star.tw);
    into[i++] = cx + x1 * 0.55;
    into[i++] = cy + y2 * 0.55;
    into[i++] = 1.2 + star.mag * 2.2;
    into[i++] = 0.75;
    into[i++] = 0.86;
    into[i++] = 1;
    into[i++] = (0.18 + star.mag * 0.55) * twinkle;
  }
  return i;
}
export {
  GraphGL,
  createGraphGL,
  packBgStars
};
