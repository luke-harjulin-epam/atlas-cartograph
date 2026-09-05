export const GRAPH_LIFECYCLE_DURATION_MS = 2000;

const smooth = (x) => x * x * (3 - 2 * x);
const fileIdentity = (node) => node.storeRoot && node.path
  ? JSON.stringify(["file", node.storeRoot, node.path])
  : JSON.stringify(["id", node.id]);
const relationshipIdentity = (edge, source, target) =>
  JSON.stringify([fileIdentity(source), fileIdentity(target), edge.kind, edge.relKind ?? ""]);

export function lifecycleStyle(entry, now, reducedMotion = false) {
  if (!Number.isFinite(entry.startedAt) || now < entry.startedAt || now >= entry.expiresAt) return null;
  const progress = (now - entry.startedAt) / (entry.expiresAt - entry.startedAt);
  const eased = smooth(progress);
  const deleted = entry.kind === "deleted";
  const opacity = (entry.initialOpacity ?? 1) * (1 - eased);
  return {
    rgb: deleted ? [1, 0.24, 0.3] : [0.25, 1, 0.42],
    nodeOpacity: reducedMotion ? 1 : deleted ? opacity : eased,
    alpha: reducedMotion ? 0.85 : deleted ? opacity : 4 * eased * (1 - eased),
    scale: 1,
    spread: 0,
    particles: false,
  };
}

export const lifecycleNodeOpacity = (frame, id) => frame?.births.get(id)?.nodeOpacity ?? 1;
export const lifecycleEdgeOpacity = (frame, source, target, id) =>
  Math.min(lifecycleNodeOpacity(frame, source), lifecycleNodeOpacity(frame, target),
    frame?.edges?.get(id)?.style.nodeOpacity ?? 1);

// Only explicit filesystem deltas create effects. A visible graph diff is not a file deletion.
export class GraphLifecycle {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.revision = -1;
    this.initialized = false;
    this.births = new Map();
    this.ghosts = new Map();
    this.edges = new Map();
    this.edgeGhosts = new Map();
  }

  setGraph(nodes, changes, previousNodes = [], isVisible = () => true, edges = [],
    previousEdges = [], isEdgeVisible = () => true) {
    const visible = new Map(nodes.map((node) => [fileIdentity(node), node]));
    const identities = new Map(nodes.filter((node) => isVisible(node)).map((node) => [node.id, node]));
    const edgeKey = (edge) => relationshipIdentity(edge, identities.get(edge.source), identities.get(edge.target));
    const visibleEdges = new Map(edges
      .filter((edge) => identities.has(edge.source) && identities.has(edge.target) && isEdgeVisible(edge))
      .map((edge) => [edgeKey(edge), edge]));
    const removedEdgeBirths = new Map();
    for (const [key, entry] of this.edges) {
      if (!visibleEdges.has(key)) { removedEdgeBirths.set(key, entry); this.edges.delete(key); }
      else entry.edge = visibleEdges.get(key);
    }
    for (const [key, ghost] of this.edgeGhosts) {
      if (visibleEdges.has(key) || !isEdgeVisible(ghost.edge) ||
          !isVisible(visible.get(fileIdentity(ghost.source)) ?? ghost.source) ||
          !isVisible(visible.get(fileIdentity(ghost.target)) ?? ghost.target)) this.edgeGhosts.delete(key);
    }
    const removedBirths = new Map();
    for (const [key, birth] of this.births) {
      if (!visible.has(key)) { removedBirths.set(key, birth); this.births.delete(key); }
      else birth.node = visible.get(key);
    }
    for (const [key, ghost] of this.ghosts) {
      if (visible.has(key) || !isVisible(ghost.node)) this.ghosts.delete(key);
    }
    const fresh = Number.isSafeInteger(changes?.revision) && changes.revision >= 0 && changes.revision > this.revision;
    if (!this.initialized) {
      this.initialized = true;
      if (fresh) this.revision = changes.revision;
      return;
    }
    if (!changes && !nodes.length) this.cancel();
    if (!fresh) return;
    this.revision = changes.revision;
    if (changes.origin === "mount") {
      this.cancel();
      return;
    }
    if (changes.origin !== "filesystem") return;
    const startedAt = changes.occurredAt;
    const expiresAt = startedAt + GRAPH_LIFECYCLE_DURATION_MS;
    const now = this.now();
    if (!Number.isFinite(startedAt) || startedAt > now || expiresAt <= now) return;
    const previous = new Map(previousNodes.map((node) => [fileIdentity(node), node]));
    for (const node of changes.created || []) {
      const key = fileIdentity(node);
      if (!visible.has(key) || previous.has(key) || !isVisible(node)) continue;
      this.births.set(key, { kind: "created", startedAt, expiresAt, node: visible.get(key) });
    }
    for (const node of changes.deleted || []) {
      const key = fileIdentity(node);
      const old = previous.get(key);
      if (!old || visible.has(key) || !isVisible(node)) continue;
      const birth = removedBirths.get(key);
      const initialOpacity = birth ? lifecycleStyle(birth, startedAt)?.nodeOpacity ?? 1 : 1;
      this.births.delete(key);
      this.ghosts.set(key, { kind: "deleted", startedAt, expiresAt, initialOpacity, node: { ...old } });
    }
    const byId = new Map([...visibleEdges.values()].map((edge) => [edge.id, edge]));
    for (const added of changes.createdEdges || []) {
      const edge = byId.get(added.id);
      if (edge) this.edges.set(edgeKey(edge), { kind: "created", edge, startedAt, expiresAt });
    }
    const oldNodes = new Map(previousNodes.map((node) => [node.id, node]));
    const oldEdges = new Map(previousEdges.map((edge) => [edge.id, edge]));
    for (const deleted of changes.deletedEdges || []) {
      const edge = oldEdges.get(deleted.id);
      if (!edge || !isEdgeVisible(edge)) continue;
      const source = oldNodes.get(edge.source), target = oldNodes.get(edge.target);
      if (!source || !target || !isVisible(source) || !isVisible(target)) continue;
      const key = relationshipIdentity(edge, source, target);
      if (visibleEdges.has(key)) continue;
      const birthOpacity = (entry) => entry ? lifecycleStyle(entry, startedAt)?.nodeOpacity ?? 1 : 1;
      const initialOpacity = Math.min(birthOpacity(removedEdgeBirths.get(key)),
        ...[source, target].map((node) => birthOpacity(
          removedBirths.get(fileIdentity(node)) ?? this.births.get(fileIdentity(node)))));
      this.edgeGhosts.set(key, {
        kind: "deleted", edge: { ...edge }, source: { ...source }, target: { ...target },
        startedAt, expiresAt, initialOpacity,
      });
    }
  }

  frame(now = this.now(), reducedMotion = false) {
    const frame = { births: new Map(), ghosts: [], edges: new Map(), edgeGhosts: [] };
    for (const [key, entry] of this.births) {
      if (now >= entry.expiresAt) this.births.delete(key);
      const style = lifecycleStyle(entry, now, reducedMotion);
      if (style) frame.births.set(entry.node.id, style);
    }
    for (const [id, entry] of this.ghosts) {
      if (now >= entry.expiresAt) this.ghosts.delete(id);
      const style = lifecycleStyle(entry, now, reducedMotion);
      if (style) frame.ghosts.push({ node: entry.node, style });
    }
    for (const [key, entry] of this.edges) {
      if (now >= entry.expiresAt) this.edges.delete(key);
      const style = lifecycleStyle(entry, now, reducedMotion);
      if (style) frame.edges.set(entry.edge.id, { edge: entry.edge, style });
    }
    for (const [key, entry] of this.edgeGhosts) {
      if (now >= entry.expiresAt) this.edgeGhosts.delete(key);
      const style = lifecycleStyle(entry, now, reducedMotion);
      if (style) frame.edgeGhosts.push({ edge: entry.edge, source: entry.source, target: entry.target, style });
    }
    return frame;
  }

  cancel() {
    this.births.clear();
    this.ghosts.clear();
    this.edges.clear();
    this.edgeGhosts.clear();
  }
}

export function lifecycleEdgeGlows(frame, lookup) {
  const glows = [];
  const add = (a, b, rgb, alpha) => {
    if (!a || !b || ![a.sx, a.sy, b.sx, b.sy].every(Number.isFinite)) return;
    if ((a.depth + b.depth) / 2 < 0.48) return;
    for (const [width, strength] of [[10, 0.1], [5, 0.25], [2, 0.9]]) {
      glows.push({
        source: { x: a.sx, y: a.sy }, target: { x: b.sx, y: b.sy },
        width, rgb, alpha: alpha * strength,
      });
    }
  };
  for (const { edge, style } of frame?.edges?.values() ?? []) {
    add(lookup.get(edge.source), lookup.get(edge.target), style.rgb,
      style.alpha * lifecycleEdgeOpacity(frame, edge.source, edge.target));
  }
  if (frame?.edgeGhosts?.length) {
    const live = new Map([...lookup.values()].map((node) => [fileIdentity(node), node]));
    for (const { source, target, style } of frame.edgeGhosts) {
      add(live.get(fileIdentity(source)) ?? source, live.get(fileIdentity(target)) ?? target, style.rgb, style.alpha);
    }
  }
  return glows;
}

// Shared screen-space geometry keeps Canvas and WebGL effects independent of read-path styling.
export function lifecyclePoints(frame, lookup) {
  const points = [];
  const add = (node, style) => {
    if (!node || !Number.isFinite(node.sx) || !Number.isFinite(node.sy)) return;
    const radius = Math.max(2, (node.r || 2) * (node.depth || 1));
    const point = { x: node.sx, y: node.sy, rgb: style.rgb, alpha: style.alpha };
    points.push({ ...point, size: Math.max(22, radius * 9) * style.scale, alpha: style.alpha * 0.65, halo: true });
    points.push({ ...point, size: radius * 2.5 });
    if (style.particles) {
      for (let i = 0; i < 6; i++) {
        const angle = i * Math.PI / 3;
        points.push({
          ...point, x: point.x + Math.cos(angle) * (radius + style.spread),
          y: point.y + Math.sin(angle) * (radius + style.spread),
          size: 2.5, alpha: style.alpha * 0.7,
        });
      }
    }
  };
  for (const [id, style] of frame?.births || []) add(lookup.get(id), style);
  for (const { node, style } of frame?.ghosts || []) add(node, style);
  return points;
}
