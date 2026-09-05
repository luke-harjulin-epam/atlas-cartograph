import { realpathSync } from "node:fs";
import { isAbsolute, normalize, resolve } from "node:path";

export const DEFAULT_DURATION_MS = 5000;
export const MIN_DURATION_MS = 100;
export const MAX_DURATION_MS = 300000;

export function validateDuration(value) {
  if (!Number.isInteger(value) || value < MIN_DURATION_MS || value > MAX_DURATION_MS) {
    throw new RangeError(`Activity duration must be an integer from ${MIN_DURATION_MS} to ${MAX_DURATION_MS} milliseconds.`);
  }
  return value;
}

function canonical(path) {
  try {
    return realpathSync.native(path);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return path;
    throw error;
  }
}

export class AccessActivity {
  constructor({ durationMs = DEFAULT_DURATION_MS, enabled = true, now = Date.now, ignorePids = [] } = {}) {
    this.durationMs = validateDuration(durationMs);
    this.enabled = enabled;
    this.now = now;
    this.ignorePids = new Set(ignorePids);
    this.graph = null;
    this.paths = new Map();
    this.files = new Map();
    this.active = new Map();
    this.sequence = 0;
  }

  setGraph(graph) {
    if (this.graph === graph) return false;
    const previous = new Map();
    for (const [id, access] of this.active) previous.set(this.files.get(id), access);
    this.graph = graph;
    this.paths.clear();
    this.files.clear();
    this.active.clear();
    for (const node of graph?.nodes ?? []) {
      if (!node.storeRoot || !node.path) continue;
      const path = resolve(node.storeRoot, node.path);
      const physical = canonical(path);
      this.files.set(node.id, physical);
      for (const alias of new Set([path, physical])) {
        if (!this.paths.has(alias)) this.paths.set(alias, new Set());
        this.paths.get(alias).add(node.id);
      }
      const old = previous.get(physical);
      if (old) this.active.set(node.id, { ...old, id: node.id });
    }
    this.expire();
    return true;
  }

  configure({ enabled = this.enabled, durationMs = this.durationMs }) {
    if (typeof enabled !== "boolean") throw new TypeError("Activity enabled must be a boolean.");
    validateDuration(durationMs);
    this.enabled = enabled;
    this.durationMs = durationMs;
    if (!enabled) this.active.clear();
    for (const node of this.active.values()) node.expiresAt = node.accessedAt + durationMs;
    this.expire();
  }

  record({ path, pid, kind }) {
    if (!this.enabled || this.ignorePids.has(pid) || !isAbsolute(path)) return false;
    const ids = this.paths.get(normalize(path));
    if (!ids) return false;
    const now = this.now();
    this.expire(now);
    const order = ++this.sequence;
    for (const id of ids) {
      const previous = this.active.get(id);
      this.active.set(id, {
        id, pid, kind, accessedAt: now, expiresAt: now + this.durationMs, order,
        count: (previous?.count ?? 0) + 1,
        firstSequence: previous?.firstSequence ?? order,
      });
    }
    return true;
  }

  expire(now = this.now()) {
    let changed = false;
    for (const [id, access] of this.active) {
      if (access.expiresAt <= now) {
        this.active.delete(id);
        changed = true;
      }
    }
    return changed;
  }

  snapshot() {
    this.expire();
    const nodes = [...this.active.values()].map(({ order, ...node }) => ({ ...node, sequence: order }));
    const edges = [];
    for (const edge of this.active.size > 1 ? this.graph?.edges ?? [] : []) {
      const a = this.active.get(edge.source);
      const b = this.active.get(edge.target);
      if (!a || !b || a.order === b.order) continue;
      const [source, target] = a.order < b.order ? [a, b] : [b, a];
      edges.push({
        id: edge.id,
        source: source.id,
        target: target.id,
        startedAt: target.accessedAt,
        expiresAt: Math.min(a.expiresAt, b.expiresAt),
      });
    }
    return { enabled: this.enabled, durationMs: this.durationMs, nodes, edges };
  }
}
