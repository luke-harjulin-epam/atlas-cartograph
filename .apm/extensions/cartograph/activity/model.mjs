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
    this.identities = new Map();
    this.active = new Map();
    this.sequence = 0;
  }

  setGraph(graph) {
    if (this.graph === graph) return false;
    const previous = new Map();
    // Include inactive instances so removing an active alias cannot transfer its record to another.
    for (const [id, identity] of this.identities) {
      if (!previous.has(identity)) previous.set(identity, []);
      previous.get(identity).push(id);
    }
    const identities = new Map(), counts = new Map(), paths = new Map(), files = new Map();
    for (const node of graph?.nodes ?? []) {
      if (!node.storeRoot || !node.path) continue;
      const path = resolve(node.storeRoot, node.path);
      const physical = canonical(path);
      const identity = JSON.stringify([path, physical, node.atlasKey ?? null]);
      identities.set(node.id, identity);
      counts.set(identity, (counts.get(identity) ?? 0) + 1);
      files.set(node.id, physical);
      for (const alias of new Set([path, physical])) {
        if (!paths.has(alias)) paths.set(alias, new Set());
        paths.get(alias).add(node.id);
      }
    }
    const active = new Map();
    for (const [id, identity] of identities) {
      const candidates = previous.get(identity) ?? [];
      // Keep exact instances first; only unique lexical/mount identities can survive ID qualification.
      const oldId = this.identities.get(id) === identity ? id
        : candidates.length === 1 && counts.get(identity) === 1 ? candidates[0] : undefined;
      const old = this.active.get(oldId);
      if (old) active.set(id, { ...old, id });
    }
    this.graph = graph;
    this.identities = identities;
    this.paths = paths;
    this.files = files;
    this.active = active;
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
