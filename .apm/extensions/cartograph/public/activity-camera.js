const FRAME_INTERVAL_MS = 200;
const MANUAL_PAUSE_MS = 5000;
const IDLE_HOLD_MS = 1000;
const MIN_ZOOM = 0.22;
const MAX_AUTO_ZOOM = 20;
const ZOOM_IN_HOLD_MS = 600;
const identity = (node) => JSON.stringify([node.storeRoot ?? "", node.path ?? node.id]);
export const angleDelta = (to, from) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

export function activationSurfaceAngle(nodes, current) {
  let x = 0, y = 0, z = 0, count = 0;
  for (const node of nodes) {
    if (![node.lat, node.lon].every(Number.isFinite)) continue;
    x += Math.sin(node.lat) * Math.cos(node.lon);
    y += Math.cos(node.lat);
    z += Math.sin(node.lat) * Math.sin(node.lon);
    count++;
  }
  // A dispersed or opposing set has no useful front face. Do not chase its noise.
  if (!count || Math.hypot(x, y, z) / count < 0.3) return null;
  const horizontal = Math.hypot(x, z);
  return {
    yaw: horizontal / count < 0.05 ? current.yaw : current.yaw + angleDelta(Math.atan2(-x, -z), current.yaw),
    pitch: Math.max(-1.2, Math.min(1.2, -Math.atan2(y, horizontal))),
  };
}

// Exact critically damped step: preserve velocity across target changes, without overshoot.
export function dampCameraValue(value, target, velocity, smoothTime, dt, maxSpeed = Infinity) {
  if (dt <= 0) return { value, velocity };
  const omega = 2 / smoothTime;
  const offset = Math.max(-maxSpeed * smoothTime, Math.min(maxSpeed * smoothTime, value - target));
  const goal = value - offset;
  const decay = Math.exp(-omega * dt);
  const impulse = (velocity + omega * offset) * dt;
  const next = goal + (offset + impulse) * decay;
  if ((target - value) * (next - target) > 0) return { value: target, velocity: 0 };
  return { value: next, velocity: (velocity - omega * impulse) * decay };
}

export function activationFocusNodes(nodes, activity, lifecycle, query = "") {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const byFile = new Map(nodes.map((node) => [identity(node), node]));
  const selected = new Map();
  const q = query.trim().toLowerCase();
  const add = (node) => {
    if (!node || (q && !node.id.toLowerCase().includes(q) && !node.title.toLowerCase().includes(q))) return;
    selected.set(identity(node), node);
  };
  for (const id of activity?.nodes.keys() ?? []) add(byId.get(id));
  for (const id of lifecycle?.births.keys() ?? []) add(byId.get(id));
  for (const { node } of lifecycle?.ghosts ?? []) add(node);
  for (const { edge } of lifecycle?.edges?.values() ?? []) {
    add(byId.get(edge.source));
    add(byId.get(edge.target));
  }
  for (const { source, target } of lifecycle?.edgeGhosts ?? []) {
    add(byFile.get(identity(source)) ?? source);
    add(byFile.get(identity(target)) ?? target);
  }
  return [...selected.values()];
}

export function activationCameraTarget(nodes, cam, width, height) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const node of nodes) {
    if (![node.sx, node.sy].every(Number.isFinite)) continue;
    const x = (node.sx - width / 2 - cam.x) / cam.k;
    const y = (node.sy - height / 2 - cam.y) / cam.k;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX) || width <= 0 || height <= 0) return null;
  // Leave room for glow, labels and the map's top/bottom controls.
  const k = Math.max(MIN_ZOOM, Math.min(MAX_AUTO_ZOOM,
    width * 0.8 / Math.max(1, maxX - minX),
    height * 0.7 / Math.max(1, maxY - minY)));
  return { x: -(minX + maxX) / 2 * k, y: -(minY + maxY) / 2 * k, k };
}

export class ActivityCamera {
  constructor() {
    this.enabled = true;
    this.pausedUntil = 0;
    this.orbitPausedUntil = 0;
    this.clear();
  }

  clear() {
    this.saved = null;
    this.target = null;
    this.lastFitAt = -Infinity;
    this.lastActiveAt = -Infinity;
    this.look = null;
    this.zoom = null;
    this.zoomInSince = null;
    this.velocity = { x: 0, y: 0, k: 0, yaw: 0, pitch: 0 };
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    this.pausedUntil = 0;
    this.orbitPausedUntil = 0;
    this.clear();
  }

  manual(now) {
    this.clear();
    this.pausedUntil = now + MANUAL_PAUSE_MS;
  }

  orbit(now, cam) {
    this.orbitPausedUntil = now + MANUAL_PAUSE_MS;
    this.retainOrbit(cam);
  }

  retainOrbit(cam) {
    this.look = { yaw: cam.yaw, pitch: cam.pitch };
    this.velocity.yaw = 0;
    this.velocity.pitch = 0;
    if (this.saved) Object.assign(this.saved, this.look);
  }

  update(nodes, cam, width, height, now, { blocked = false, reducedMotion = false, orbiting = false } = {}) {
    if (!this.enabled || blocked || reducedMotion || now < this.pausedUntil) {
      this.clear();
      return null;
    }
    const manualOrbit = orbiting || now < this.orbitPausedUntil;
    if (manualOrbit) this.retainOrbit(cam);
    if (nodes.length) {
      this.lastActiveAt = now;
      if (now - this.lastFitAt >= FRAME_INTERVAL_MS) {
        this.lastFitAt = now;
        const target = activationCameraTarget(nodes, cam, width, height);
        if (target) {
          if (!this.saved) {
            this.saved = { x: cam.x, y: cam.y, k: cam.k };
            if ([cam.yaw, cam.pitch].every(Number.isFinite)) {
              Object.assign(this.saved, { yaw: cam.yaw, pitch: cam.pitch });
            }
          }
          if (!manualOrbit && Number.isFinite(cam.yaw)) {
            const look = activationSurfaceAngle(nodes, this.look ?? cam);
            if (look && (!this.look || Math.hypot(angleDelta(look.yaw, this.look.yaw),
              look.pitch - this.look.pitch) > 0.08)) this.look = look;
          }
          if (this.zoom === null || target.k < this.zoom) {
            this.zoom = target.k;
            this.zoomInSince = null;
          } else if (target.k > this.zoom * 1.08) {
            this.zoomInSince ??= now;
            if (now - this.zoomInSince >= ZOOM_IN_HOLD_MS) {
              this.zoom = target.k;
              this.zoomInSince = null;
            }
          } else {
            this.zoomInSince = null;
          }
          const scale = this.zoom / target.k;
          this.target = { x: target.x * scale, y: target.y * scale, k: this.zoom, ...this.look };
        }
      }
    } else if (this.saved && now - this.lastActiveAt >= IDLE_HOLD_MS) {
      this.target = this.saved;
      if (Math.abs(cam.x - this.saved.x) < 1 && Math.abs(cam.y - this.saved.y) < 1 &&
          Math.abs(cam.k - this.saved.k) < 0.01 &&
          (!Number.isFinite(this.saved.yaw) || (Math.abs(angleDelta(this.saved.yaw, cam.yaw)) < 0.005 &&
            Math.abs(this.saved.pitch - cam.pitch) < 0.005))) {
        Object.assign(cam, this.saved);
        this.clear();
      }
    }
    if (this.target && manualOrbit) Object.assign(this.target, this.look);
    return this.target;
  }

  move(cam, target, dt, { orbiting = false, now = Date.now() } = {}) {
    const step = (key, goal, smoothTime, speed, logarithmic = false) => {
      const value = logarithmic ? Math.log(cam[key]) : cam[key];
      const result = dampCameraValue(value, logarithmic ? Math.log(goal) : goal,
        this.velocity[key], smoothTime, dt, speed);
      cam[key] = logarithmic ? Math.exp(result.value) : result.value;
      this.velocity[key] = result.velocity;
    };
    step("x", target.x, 0.55, 1200);
    step("y", target.y, 0.55, 1200);
    step("k", target.k, 0.65, 1.5, true);
    if (!orbiting && now >= this.orbitPausedUntil && Number.isFinite(target.yaw)) {
      step("yaw", cam.yaw + angleDelta(target.yaw, cam.yaw), 0.8, 1.5);
      step("pitch", target.pitch, 0.8, 1.5);
    }
  }
}
