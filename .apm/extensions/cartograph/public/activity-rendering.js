export const DEFAULT_ACTIVITY_DURATION_MS = 5000;

const clamp = (value) => Math.max(0, Math.min(1, value));
const smooth = (value) => { const x = clamp(value); return x * x * (3 - 2 * x); };

function envelope(start, end, now) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || now < start || now >= end || end <= start) return 0;
  const lifetime = end - start;
  return smooth((now - start) / Math.min(120, lifetime / 4)) *
    smooth((end - now) / Math.min(350, lifetime / 3));
}

const pairKey = (a, b) => JSON.stringify(a < b ? [a, b] : [b, a]);

// Index only the visible graph, so activity cannot reveal a filtered layer or invent a relationship.
export function indexActivityGraph(nodes, edges) {
  return {
    nodes: new Set(nodes.map((node) => node.id)),
    edges: new Set(edges.map((edge) => pairKey(edge.source, edge.target))),
  };
}

export function retainActivity(previous, incoming, now = Date.now()) {
  if (!incoming?.enabled) return incoming;
  const prior = new Map(previous?.enabled ? (previous.nodes || []).map((node) => [node.id, node]) : []);
  return {
    ...incoming,
    nodes: (incoming.nodes || []).map((node) => {
      const before = prior.get(node.id);
      return {
        ...node,
        highlightedAt: before?.expiresAt > now ? before.highlightedAt ?? before.accessedAt : node.accessedAt,
      };
    }),
  };
}

export function activityFrame(activity, now = Date.now(), graph) {
  const frame = { nodes: new Map(), edges: [], amount: 0 };
  if (activity?.playback) {
    frame.playback = activity.playback;
    frame.nodeCounts = new Map();
  }
  if (!activity?.enabled) return frame;
  const live = new Map();
  for (const node of activity.nodes || []) {
    if (graph && !graph.nodes.has(node.id)) continue;
    if (node.accessedAt > now || node.expiresAt <= now) continue;
    const strength = envelope(node.highlightedAt ?? node.accessedAt, node.expiresAt, now);
    if (!strength) continue;
    live.set(node.id, node);
    frame.nodes.set(node.id, strength);
    frame.nodeCounts?.set(node.id, node.count ?? 1);
    frame.amount = Math.max(frame.amount, strength);
  }
  for (const edge of activity.edges || []) {
    const source = live.get(edge.source);
    const target = live.get(edge.target);
    if (!source || !target || edge.source === edge.target) continue;
    if (graph && !graph.edges.has(pairKey(edge.source, edge.target))) continue;
    // The activity direction is temporal, not the stored graph edge direction.
    const end = Math.min(edge.expiresAt, source.expiresAt, target.expiresAt);
    const strength = envelope(edge.startedAt, end, now);
    if (!strength) continue;
    frame.edges.push({
      ...edge, expiresAt: end,
      strength: Math.min(strength, frame.nodes.get(edge.source), frame.nodes.get(edge.target)),
      progress: ((now - edge.startedAt) % 1100) / 1100,
    });
  }
  return frame;
}

export function activityNodeStyle(frame, id, alpha = 1, size = 1) {
  const strength = frame?.nodes.get(id) || 0;
  const dim = 1 - (frame?.amount || 0) * 0.9;
  return {
    strength,
    alpha: alpha * dim + (Math.max(1, alpha + 0.35) - alpha * dim) * strength,
    size: size * (1 + strength * 0.55),
    dim: dim + (1 - dim) * strength,
  };
}

export function activityEdgeOpacity(frame) {
  return 1 - (frame?.amount || 0) * 0.96;
}

// Both renderers use exactly the same trail and arrow geometry.
export function activityPulse(edge, lookup, reducedMotion = false) {
  const source = lookup.get(edge.source);
  const target = lookup.get(edge.target);
  if (!source || !target) return null;
  const dx = target.sx - source.sx;
  const dy = target.sy - source.sy;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length < 1) return null;
  const progress = reducedMotion ? 0.72 : edge.progress;
  const point = (p) => ({ x: source.sx + dx * p, y: source.sy + dy * p });
  const head = point(progress);
  const ux = dx / length;
  const uy = dy / length;
  const arrowSize = Math.min(7, length * 0.12);
  return {
    source: point(0), target: point(1), head,
    trail: reducedMotion ? [] : Array.from({ length: 9 }, (_, i) => ({
      ...point(Math.max(0, progress - i * 0.018)),
      alpha: edge.strength * (1 - i / 9) * 0.9,
      size: 5 - i * 0.35,
    })),
    wings: [-1, 1].map((sign) => ({
      x: head.x - ux * arrowSize + sign * uy * arrowSize * 0.55,
      y: head.y - uy * arrowSize - sign * ux * arrowSize * 0.55,
    })),
  };
}
