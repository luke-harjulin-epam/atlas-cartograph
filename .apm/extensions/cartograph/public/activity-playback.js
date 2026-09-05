import { activityFrame, DEFAULT_ACTIVITY_DURATION_MS, indexActivityGraph } from "./activity-rendering.js";

export const ACTIVITY_SPACING_MS = 400;
export const MIN_ACTIVITY_SPACING_MS = 50;
export const PLAYBACK_STATUS_INTERVAL_MS = 200;
const SPEED_UP_MS = 250;
const SLOW_DOWN_MS = 2000;
const pairKey = (a, b) => JSON.stringify(a < b ? [a, b] : [b, a]);
const fileIdentity = (node) => node.path
  ? JSON.stringify(["file", node.storeRoot ?? "", node.path])
  : JSON.stringify(["id", node.storeRoot ?? "", node.id]);
const relationshipIdentity = (edge, identities) =>
  JSON.stringify([identities.get(edge.source)?.key, identities.get(edge.target)?.key, edge.kind, edge.relKind ?? ""]);
const sequenced = (node) => Number.isSafeInteger(node.sequence) && node.sequence > 0 &&
  Number.isSafeInteger(node.count) && node.count > 0 &&
  Number.isSafeInteger(node.firstSequence) && node.firstSequence > 0 &&
  node.firstSequence <= node.sequence && node.count <= node.sequence - node.firstSequence + 1;
const newerObservation = (node, seen) => !seen || (sequenced(node) && sequenced(seen)
  ? node.accessedAt >= seen.accessedAt && (node.sequence > seen.sequence || node.accessedAt > seen.accessedAt)
  : node.accessedAt > seen.accessedAt);

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
    this.nextIdentity = 0;
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
    this.sourceIdentities = new Set();
    for (const id of this.identities.keys()) {
      if (!this.graph.nodes.has(id)) this.identities.delete(id);
    }
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
    const visible = new Set([...this.graph.nodes].map((id) => this.identities.get(id)));
    const groups = new Map();
    const group = (file) => {
      if (!groups.has(file)) groups.set(file, { previous: new Set(), next: [] });
      return groups.get(file);
    };
    for (const identity of [...this.identities.values(), ...this.seen.keys()]) {
      group(identity.file).previous.add(identity);
    }
    for (const node of nodes) group(fileIdentity(node)).next.push(node);
    const identities = new Map(), claimed = new Set();
    const retain = (node, identity) => {
      identity.atlasKey ??= node.atlasKey;
      identities.set(node.id, identity);
      claimed.add(identity);
    };
    // Keep exact visible instances first; a physical file can have multiple mounted aliases.
    for (const node of nodes) {
      const identity = this.identities.get(node.id);
      if (identity?.file === fileIdentity(node) &&
          (identity.atlasKey === undefined || node.atlasKey === undefined || identity.atlasKey === node.atlasKey)) {
        retain(node, identity);
      }
    }
    for (const { previous, next } of groups.values()) {
      for (const node of next) {
        if (identities.has(node.id)) continue;
        const candidates = [...previous].filter((identity) => !claimed.has(identity));
        const mounts = candidates.filter((identity) => identity.atlasKey === node.atlasKey);
        const sameMount = node.atlasKey !== undefined &&
          next.filter((other) => other.atlasKey === node.atlasKey).length === 1;
        if (sameMount && mounts.length === 1) retain(node, mounts[0]);
        else if (previous.size === 1 && next.length === 1 && candidates.length === 1 &&
            (candidates[0].atlasKey === undefined || node.atlasKey === undefined)) {
          retain(node, candidates[0]);
        }
      }
      for (const node of next) {
        if (identities.has(node.id)) continue;
        const identity = this.createIdentity(node);
        retain(node, identity);
      }
    }
    const byIdentity = new Map([...identities].map(([id, identity]) => [identity, id]));
    const remap = new Map([...this.identities].map(([id, identity]) => [id, byIdentity.get(identity)]));
    this.graph = indexActivityGraph(nodes, edges);
    this.relationships = new Map(edges.filter((edge) => identities.has(edge.source) && identities.has(edge.target))
      .map((edge) => [relationshipIdentity(edge, identities), edge]));
    this.labels = new Map(nodes.map((node) => [node.id, node.title || node.id]));
    this.pairs.clear();
    for (const [key, edge] of this.relationships) {
      const pair = pairKey(edge.source, edge.target);
      if (!this.pairs.has(pair)) this.pairs.set(pair, []);
      this.pairs.get(pair).push([key, edge]);
    }
    this.lastActivatedId = remap.get(this.lastActivatedId) ?? null;
    let cancelled = false;
    for (const name of ["pending", "active"]) {
      const retained = new Map();
      for (const [id, record] of this[name]) {
        const nextId = remap.get(id);
        if (nextId !== undefined) retained.set(nextId, { ...record, id: nextId });
        else if (name === "pending") {
          this.cancelledCount += record.observations;
          cancelled = true;
        }
      }
      this[name] = retained;
    }
    if (cancelled) this.breakPath();
    for (const [key, transition] of this.transitions) {
      const relationship = this.relationships.get(key);
      const source = remap.get(transition.source), target = remap.get(transition.target);
      if (!relationship || source === undefined || target === undefined) this.transitions.delete(key);
      else this.transitions.set(key, { ...transition, id: relationship.id, source, target });
    }
    for (const [id, nextId] of remap) {
      if (nextId !== undefined && nextId !== id) this.identities.delete(id);
    }
    for (const [id, identity] of identities) {
      // Raw activity has no path. Consume initially hidden files by ID until their graph metadata arrives.
      const fallback = this.identities.get(id);
      if (fallback && fallback !== identity && fallback.file === fileIdentity({ id })) {
        this.mergeConsumption(fallback, identity);
        this.seen.delete(fallback);
        this.sourceIdentities.delete(fallback);
      }
      this.identities.set(id, identity);
    }
    // Mounting another alias is not a new read, including when hidden metadata just arrived.
    // Seed new/returning instances from known consumption, never copy displayed state.
    for (const { previous, next } of groups.values()) {
      const known = [...previous, ...next.map((node) => identities.get(node.id))];
      for (const node of next) {
        const identity = identities.get(node.id);
        if (!visible.has(identity)) {
          for (const old of known) this.mergeConsumption(old, identity);
        }
      }
    }
    this.pruneTransitions();
    this.edgesDirty = true;
  }

  createIdentity(node) {
    // A stable instance token keeps aliases distinct even when their graph IDs are qualified.
    return { key: ++this.nextIdentity, file: fileIdentity(node), atlasKey: node.atlasKey };
  }

  identityFor(node) {
    if (!this.identities.has(node.id)) this.identities.set(node.id, this.createIdentity(node));
    return this.identities.get(node.id);
  }

  mergeConsumption(from, to) {
    const seen = this.seen.get(from);
    if (seen && newerObservation(seen, this.seen.get(to))) this.seen.set(to, seen);
    if (this.sourceIdentities.has(from)) this.sourceIdentities.add(to);
  }

  breakPath(restarted = false) {
    this.lastActivatedId = null;
    // Legacy snapshots cannot prove adjacency across a cancelled or invisible observation.
    for (const node of this.pending.values()) {
      if (restarted || !sequenced(node)) node.continuous = false;
    }
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
    this.sourceIdentities = new Set((activity.nodes ?? []).map((node) => this.identityFor(node)));
    const nodes = [...(activity.nodes ?? [])].sort((a, b) =>
      sequenced(a) && sequenced(b) ? a.sequence - b.sequence : a.accessedAt - b.accessedAt);
    for (const node of nodes) {
      if (!Number.isFinite(node.accessedAt) ||
          !Number.isFinite(node.expiresAt) || node.accessedAt > now || node.expiresAt <= now) continue;
      const hasSequence = sequenced(node);
      if (node.sequence !== undefined && !hasSequence) continue;
      const identity = this.identityFor(node);
      const seen = this.seen.get(identity);
      if (!newerObservation(node, seen)) continue;
      const restarted = hasSequence && seen && sequenced(seen) && node.sequence <= seen.sequence;
      if (restarted) {
        this.cancelledCount += this.pending.get(node.id)?.observations ?? 0;
        this.pending.delete(node.id);
        this.active.delete(node.id);
        this.breakPath(true);
        this.pruneTransitions();
        this.edgesDirty = true;
      }
      const sameInterval = !restarted && hasSequence && seen?.firstSequence === node.firstSequence;
      const observations = hasSequence ? node.count - (sameInterval ? seen.count : 0) : 1;
      if (observations < 1) continue;
      const sequenceStart = hasSequence
        ? observations === 1 ? node.sequence : sameInterval ? seen.sequence + 1 : node.firstSequence
        : undefined;
      const continuous = !hasSequence || node.sequence - sequenceStart + 1 === observations;
      const pending = this.pending.get(node.id);
      this.identities.set(node.id, identity);
      this.seen.set(identity, { ...node });
      if (!this.graph.nodes.has(node.id)) {
        this.breakPath();
        continue;
      }
      this.aggregatedCount += observations - (pending ? 0 : 1);
      // One FIFO slot per visible node bounds repeated traffic without starving older nodes.
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
      if (consecutive && previous.id !== id &&
          this.identities.get(previous.id).file !== this.identities.get(id).file) {
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
    const displayed = new Set([...this.active.keys(), ...this.pending.keys()].map((id) => this.identities.get(id)));
    for (const identity of this.seen.keys()) {
      if (!this.sourceIdentities.has(identity) && !displayed.has(identity)) this.seen.delete(identity);
    }
    for (const [id, identity] of this.identities) {
      if (!this.graph.nodes.has(id) && !this.seen.has(identity)) this.identities.delete(id);
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
