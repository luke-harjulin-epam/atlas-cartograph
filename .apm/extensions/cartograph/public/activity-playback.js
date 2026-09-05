import { activityFrame, DEFAULT_ACTIVITY_DURATION_MS, indexActivityGraph } from "./activity-rendering.js";

export const ACTIVITY_SPACING_MS = 400;
export const MIN_ACTIVITY_SPACING_MS = 50;
export const PLAYBACK_STATUS_INTERVAL_MS = 200;
const SPEED_UP_MS = 250;
const SLOW_DOWN_MS = 2000;
const pairKey = (a, b) => JSON.stringify(a < b ? [a, b] : [b, a]);
const sequenced = (node) => Number.isSafeInteger(node.sequence) && node.sequence > 0 &&
  Number.isSafeInteger(node.count) && node.count > 0 &&
  Number.isSafeInteger(node.firstSequence) && node.firstSequence > 0 &&
  node.firstSequence <= node.sequence && node.count <= node.sequence - node.firstSequence + 1;

export function activitySpacing(pendingCount, oldestPendingMs = 0) {
  if (!pendingCount) return ACTIVITY_SPACING_MS;
  const depth = pendingCount > 40 ? 50 : pendingCount > 15 ? 100 : pendingCount > 5 ? 200 : 400;
  const age = oldestPendingMs >= 5000 ? 50 : oldestPendingMs >= 2000 ? 100 : 400;
  return Math.min(depth, age);
}

// This clock belongs to the presentation, not the filesystem or collector.
export class ActivityPlayback {
  constructor() {
    this.graph = indexActivityGraph([], []);
    this.identities = new Map();
    this.relationships = new Map();
    this.pairs = new Map();
    this.labels = new Map();
    this.enabled = false;
    this.durationMs = DEFAULT_ACTIVITY_DURATION_MS;
    this.reset();
  }

  reset() {
    this.pending = new Map();
    this.active = new Map();
    this.seen = new Map();
    this.sourceIds = new Set();
    this.transitions = new Map();
    this.edges = [];
    this.lastPlayedAt = -Infinity;
    this.lastActivatedId = null;
    this.spacingMs = ACTIVITY_SPACING_MS;
    this.lastPaceAt = null;
    this.aggregatedCount = 0;
    this.cancelledCount = 0;
    this.edgesDirty = true;
  }

  setGraph(nodes, edges) {
    const identities = new Map(nodes.map((node) => [node.id, JSON.stringify([node.storeRoot, node.path])]));
    this.graph = indexActivityGraph(nodes, edges);
    this.relationships = new Map(edges.map((edge) => [JSON.stringify([edge.id, edge.source, edge.target]), edge]));
    this.labels = new Map(nodes.map((node) => [node.id, node.title || node.id]));
    this.pairs.clear();
    for (const [key, edge] of this.relationships) {
      const pair = pairKey(edge.source, edge.target);
      if (!this.pairs.has(pair)) this.pairs.set(pair, []);
      this.pairs.get(pair).push([key, edge]);
    }
    for (const records of [this.pending, this.active, this.seen]) {
      for (const id of records.keys()) {
        if (!identities.has(id) || identities.get(id) !== this.identities.get(id)) {
          if (records === this.pending) {
            this.cancelledCount += records.get(id).observations;
            this.lastActivatedId = null;
          }
          records.delete(id);
        }
      }
    }
    this.identities = identities;
    this.pruneTransitions();
    this.edgesDirty = true;
  }

  update(activity, now = Date.now()) {
    this.enabled = activity?.enabled === true;
    if (!this.enabled) {
      this.reset();
      return;
    }
    this.expire(now);
    const duration = activity.durationMs ?? DEFAULT_ACTIVITY_DURATION_MS;
    if (duration !== this.durationMs) {
      this.durationMs = duration;
      for (const node of this.active.values()) node.expiresAt = node.accessedAt + duration;
      this.edgesDirty = true;
    }
    this.sourceIds = new Set((activity.nodes ?? []).map((node) => node.id));
    const nodes = [...(activity.nodes ?? [])].sort((a, b) =>
      sequenced(a) && sequenced(b) ? a.sequence - b.sequence : a.accessedAt - b.accessedAt);
    for (const node of nodes) {
      if (!this.graph.nodes.has(node.id) || !Number.isFinite(node.accessedAt) ||
          !Number.isFinite(node.expiresAt) || node.accessedAt > now || node.expiresAt <= now) continue;
      const hasSequence = sequenced(node);
      if (node.sequence !== undefined && !hasSequence) continue;
      const seen = this.seen.get(node.id);
      if (seen && (hasSequence && sequenced(seen) ? seen.sequence >= node.sequence : seen.accessedAt >= node.accessedAt)) continue;
      const sameInterval = hasSequence && seen?.firstSequence === node.firstSequence;
      const observations = hasSequence ? node.count - (sameInterval ? seen.count : 0) : 1;
      if (observations < 1) continue;
      const sequenceStart = hasSequence
        ? observations === 1 ? node.sequence : sameInterval ? seen.sequence + 1 : node.firstSequence
        : undefined;
      const continuous = !hasSequence || node.sequence - sequenceStart + 1 === observations;
      const pending = this.pending.get(node.id);
      this.seen.set(node.id, { ...node });
      this.aggregatedCount += observations - (pending ? 0 : 1);
      // One FIFO slot per file bounds repeated traffic without starving older files.
      // Interleaved coalesced observations cannot prove a path into or out of this slot.
      this.pending.set(node.id, {
        ...node, queuedAt: pending?.queuedAt ?? now,
        observations: (pending?.observations ?? 0) + observations,
        sequenceStart: pending?.sequenceStart ?? sequenceStart,
        continuous: continuous && (!pending || (hasSequence && pending.continuous &&
          pending.sequence + 1 === sequenceStart)),
      });
    }
  }

  expire(now) {
    for (const [id, node] of this.active) {
      if (node.expiresAt <= now) {
        this.active.delete(id);
        this.edgesDirty = true;
      }
    }
    this.pruneTransitions(now);
  }

  pruneTransitions(now) {
    if (!this.active.has(this.lastActivatedId)) this.lastActivatedId = null;
    for (const [key, edge] of this.transitions) {
      if (!this.relationships.has(key) || !this.active.has(edge.source) || !this.active.has(edge.target) ||
          (now !== undefined && edge.startedAt + this.durationMs <= now)) {
        this.transitions.delete(key);
        this.edgesDirty = true;
      }
    }
  }

  advance(now = Date.now()) {
    this.expire(now);
    const oldestPendingMs = this.pending.size ? Math.max(0, now - this.pending.values().next().value.queuedAt) : 0;
    const targetSpacingMs = activitySpacing(this.pending.size, oldestPendingMs);
    const elapsed = this.lastPaceAt === null ? 0 : Math.max(0, now - this.lastPaceAt);
    const rate = (ACTIVITY_SPACING_MS - MIN_ACTIVITY_SPACING_MS) /
      (targetSpacingMs < this.spacingMs ? SPEED_UP_MS : SLOW_DOWN_MS);
    this.spacingMs += Math.sign(targetSpacingMs - this.spacingMs) *
      Math.min(Math.abs(targetSpacingMs - this.spacingMs), elapsed * rate);
    this.lastPaceAt = now;
    // At most one activation per frame: no catch-up loop after a blocked/hidden tab.
    if (this.enabled && this.pending.size && now - this.lastPlayedAt >= this.spacingMs) {
      const [id, observed] = this.pending.entries().next().value;
      this.pending.delete(id);
      const before = this.active.get(id);
      const previous = this.active.get(this.lastActivatedId);
      this.active.set(id, {
        ...observed,
        observedAt: observed.accessedAt,
        accessedAt: now,
        highlightedAt: before?.highlightedAt ?? now,
        expiresAt: now + this.durationMs,
        count: (before?.count ?? 0) + observed.observations,
      });
      // Record the step when it happens; never reconstruct a path from active-node order.
      const consecutive = previous && observed.continuous && previous.continuous &&
        (Number.isSafeInteger(previous.sequence) && Number.isSafeInteger(observed.sequence) ? previous.sequence + 1 === observed.sequenceStart :
          previous.sequence === undefined && observed.sequence === undefined);
      if (consecutive && previous.id !== id) {
        for (const [key, edge] of this.pairs.get(pairKey(previous.id, id)) ?? []) {
          const count = (this.transitions.get(key)?.count ?? 0) + 1;
          this.transitions.set(key, { id: edge.id, source: previous.id, target: id, startedAt: now, count });
        }
      }
      this.lastActivatedId = id;
      // Do not drain a backlog in one frame after a throttled/hidden tab resumes.
      this.lastPlayedAt = now;
      this.edgesDirty = true;
    }
    if (this.edgesDirty) {
      this.edges = [];
      for (const edge of this.transitions.values()) {
        const a = this.active.get(edge.source);
        const b = this.active.get(edge.target);
        this.edges.push({
          ...edge,
          expiresAt: Math.min(a.expiresAt, b.expiresAt, edge.startedAt + this.durationMs),
        });
      }
      this.edgesDirty = false;
    }
    for (const id of this.seen.keys()) {
      if (!this.sourceIds.has(id) && !this.active.has(id) && !this.pending.has(id)) this.seen.delete(id);
    }
    return {
      enabled: this.enabled,
      durationMs: this.durationMs,
      nodes: [...this.active.values()],
      edges: this.edges,
      pendingCount: this.pending.size,
      playback: {
        pendingCount: this.pending.size,
        oldestPendingMs: this.pending.size ? Math.max(0, now - this.pending.values().next().value.queuedAt) : 0,
        spacingMs: this.spacingMs, targetSpacingMs,
        aggregatedCount: this.aggregatedCount, cancelledCount: this.cancelledCount,
        activeCount: this.active.size,
        repeatedNodes: [...this.active.values()].filter((node) => node.count > 1)
          .map((node) => ({ id: node.id, label: this.labels.get(node.id), count: node.count })),
        repeatedEdges: [...this.transitions.values()].filter((edge) => edge.count > 1)
          .map((edge) => ({ id: edge.id, label: `${this.labels.get(edge.source)} -> ${this.labels.get(edge.target)}`, count: edge.count })),
      },
    };
  }

  frame(now = Date.now()) {
    return activityFrame(this.advance(now), now, this.graph);
  }
}
