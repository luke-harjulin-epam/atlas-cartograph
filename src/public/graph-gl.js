import { activityNodeStyle, activityEdgeOpacity, activityPulse } from "./activity-rendering.js";
import { ActivityPlayback, PLAYBACK_STATUS_INTERVAL_MS } from "./activity-playback.js";
import { GraphLifecycle, lifecyclePoints, lifecycleNodeOpacity, lifecycleEdgeOpacity, lifecycleEdgeGlows } from "./graph-lifecycle.js";

const CORE = {
  experience: [0.83, 0.89, 1],
  decision: [0.56, 0.78, 0.75],
  work: [0.91, 0.95, 1],
  lesson: [0.72, 0.83, 0.78],
  recipe: [0.77, 0.83, 0.91],
  index: [0.94, 0.96, 0.98],
  page: [0.49, 0.56, 0.67],
  knowledge: [0.83, 0.89, 1],
  raw: [0.49, 0.56, 0.67],
  module: [0.56, 0.78, 0.75]
};
const VS_POINT = `
attribute vec2 a_pos;
attribute float a_size;
attribute vec4 a_col;
uniform vec2 u_res;
varying vec4 v_col;
void main() {
  vec2 clip = (a_pos / u_res) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  gl_PointSize = max(a_size, 1.0);
  v_col = a_col;
}`;
const FS_POINT = `
precision mediump float;
varying vec4 v_col;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float d = dot(p, p);
  if (d > 1.0) discard;
  float a = exp(-d * 2.6);
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
  const sh = (type, src) => {
    const s = gl.createShader(type);
    if (!s) return null;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn(gl.getShaderInfoLog(s));
      gl.deleteShader(s);
      return null;
    }
    return s;
  };
  const v = sh(gl.VERTEX_SHADER, vs);
  const f = sh(gl.FRAGMENT_SHADER, fs);
  if (!v || !f) return null;
  const p = gl.createProgram();
  if (!p) return null;
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.bindAttribLocation(p, 0, "a_pos");
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.warn(gl.getProgramInfoLog(p));
    return null;
  }
  return p;
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
  scratch = new Float32Array(7 * 8192);
  loc = {
    pointRes: null,
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
    this.buf = gl.createBuffer();
    this.quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    this.loc.pointRes = gl.getUniformLocation(point, "u_res");
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
  }
  draw(f) {
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
    if (this.lastPlaybackStatusAt === undefined || now - this.lastPlaybackStatusAt >= PLAYBACK_STATUS_INTERVAL_MS) {
      this.lastPlaybackStatusAt = now;
      f.onPlayback?.(f.activityFrame?.playback);
    }
    const gl = this.gl;
    const { w, h } = f;
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(0.02, 0.03, 0.05, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this.drawQuad();
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    if (f.bg.length) this.drawPoints(f.bg, 7, f.bg.length / 7);
    this.drawCore(f.cx, f.cy, Math.min(w, h) * 0.12 * f.k);
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
    if (lineCount) this.drawLines(this.scratch, lineCount);
    this.drawLifecycleEdges(f.lifecycleFrame, lookup);
    this.drawActivity(f, lookup);
    const pointCount = this.packNodes(f, q, match, related);
    if (pointCount) this.drawPoints(this.scratch, 7, pointCount);
    this.drawLifecycle(f.lifecycleFrame, lookup);
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
    let out = this.ensure(pulses.length * 6 * 6);
    let i = 0;
    for (const { edge, pulse } of pulses) {
      const opacity = lifecycleEdgeOpacity(f.lifecycleFrame, edge.source, edge.target, edge.id);
      for (const [a, b, alpha] of [
        [pulse.source, pulse.target, edge.strength * 0.75],
        [pulse.wings[0], pulse.head, edge.strength],
        [pulse.wings[1], pulse.head, edge.strength],
      ]) {
        for (const point of [a, b]) {
          out[i++] = point.x; out[i++] = point.y;
          out[i++] = 0.65; out[i++] = 1; out[i++] = 0.92; out[i++] = alpha * opacity;
        }
      }
    }
    if (i) this.drawLines(out, i / 6);
    out = this.ensure(pulses.length * 9 * 7);
    i = 0;
    for (const { edge, pulse } of pulses) {
      const opacity = lifecycleEdgeOpacity(f.lifecycleFrame, edge.source, edge.target, edge.id);
      for (const point of pulse.trail) {
        out[i++] = point.x; out[i++] = point.y; out[i++] = point.size * 2;
        out[i++] = 0.75; out[i++] = 1; out[i++] = 0.94; out[i++] = point.alpha * opacity;
      }
    }
    if (i) this.drawPoints(out, 7, i / 7);
  }
  packEdges(f, lookup, q, match, related) {
    let i = 0;
    const out = this.ensure(f.edges.length * 2 * 6);
    const max = Math.min(f.edges.length, 5e3);
    const locked = related.size > 0;
    for (let e = 0; e < max; e++) {
      const edge = f.edges[e];
      const a = lookup.get(edge.source);
      const b = lookup.get(edge.target);
      if (!a || !b) continue;
      const depth = (a.depth + b.depth) / 2;
      const hi = Boolean(f.selectedId && (edge.source === f.selectedId || edge.target === f.selectedId));
      if (depth < 0.48 && !hi) continue;
      const faded = Boolean(q && (!match(a) || !match(b))) || locked && !hi;
      const alpha = (faded ? 0.04 : hi ? 0.85 : edge.kind === "source" ? 0.1 * depth : edge.kind === "relates" || edge.kind === "mesh" ? 0.24 * depth : 0.16 * depth) * activityEdgeOpacity(f.activityFrame) *
        lifecycleEdgeOpacity(f.lifecycleFrame, edge.source, edge.target, edge.id);
      const r = hi ? 0.82 : 0.59;
      const g = hi ? 0.92 : 0.78;
      const bcol = 1;
      out[i++] = a.sx;
      out[i++] = a.sy;
      out[i++] = r;
      out[i++] = g;
      out[i++] = bcol;
      out[i++] = alpha;
      out[i++] = b.sx;
      out[i++] = b.sy;
      out[i++] = r;
      out[i++] = g;
      out[i++] = bcol;
      out[i++] = alpha;
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
      const near = related.has(n.id);
      const faded = Boolean(q && !match(n)) || locked && !near;
      const age = Math.max(0, f.t - n.born);
      const pop = f.reduce || n.lifecycleBorn || this.lifecycleBorn.has(n.id) ? 1 : 1 - Math.exp(-age * 2.4);
      const opacity = lifecycleNodeOpacity(f.lifecycleFrame, n.id);
      const pulse = f.reduce ? 1 : 1 + Math.sin(f.t * 2.2 + n.lon) * (sel ? 0.08 : near ? 0.05 : 0.03);
      const pr = Math.max(1.2, n.r * n.depth * pulse * (0.2 + 0.8 * pop) * 2.2);
      const rgb = CORE[n.kind] ?? CORE.page;
      const a = faded ? 0.1 : (0.25 + n.depth * 0.75) * Math.min(1, 0.3 + pop);
      const normalAlpha = faded ? 0.1 : near || sel ? Math.min(1, a + 0.25) : a;
      const style = activityNodeStyle(f.activityFrame, n.id, normalAlpha, sel ? pr * 2.8 : near || hov ? pr * 2.2 : pr * 1.6);
      if (style.strength) {
        out[i++] = n.sx; out[i++] = n.sy; out[i++] = Math.max(20, style.size * 2);
        out[i++] = 0.55; out[i++] = 1; out[i++] = 0.9; out[i++] = style.strength * 0.55 * opacity;
      }
      out[i++] = n.sx;
      out[i++] = n.sy;
      out[i++] = style.size;
      out[i++] = (sel ? 0.96 : rgb[0]) * (1 - style.strength) + 0.94 * style.strength;
      out[i++] = (sel ? 0.98 : rgb[1]) * (1 - style.strength) + style.strength;
      out[i++] = (sel ? 1 : rgb[2]) * (1 - style.strength) + style.strength;
      out[i++] = style.alpha * opacity;
    }
    return i / 7;
  }
  ensure(n) {
    if (this.scratch.length < n) {
      this.scratch = new Float32Array(Math.max(n, this.scratch.length * 2));
    }
    return this.scratch;
  }
  drawPoints(data, stride, count) {
    const gl = this.gl;
    gl.useProgram(this.point);
    gl.uniform2f(this.loc.pointRes, this.cssW, this.cssH);
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
    gl.uniform2f(this.loc.lineRes, this.cssW, this.cssH);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, count * 6), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.loc.linePos);
    gl.vertexAttribPointer(this.loc.linePos, 2, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(this.loc.lineCol);
    gl.vertexAttribPointer(this.loc.lineCol, 4, gl.FLOAT, false, 24, 8);
    gl.drawArrays(mode, 0, count);
  }
}
function createGraphGL(canvas) {
  const gl = canvas.getContext("webgl", {
    alpha: false,
    antialias: true,
    powerPreference: "high-performance",
    premultipliedAlpha: false
  }) || canvas.getContext("experimental-webgl", {
    alpha: false,
    antialias: true
  });
  if (!gl || !(gl instanceof WebGLRenderingContext)) return null;
  const point = compile(gl, VS_POINT, FS_POINT);
  const line = compile(gl, VS_LINE, FS_LINE);
  const quad = compile(gl, VS_QUAD, FS_QUAD);
  if (!point || !line || !quad) return null;
  return new GraphGL(gl, point, line, quad);
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
