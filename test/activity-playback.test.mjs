import test from "node:test";
import assert from "node:assert/strict";
import { ActivityPlayback, ACTIVITY_SPACING_MS, MIN_ACTIVITY_SPACING_MS, activitySpacing } from "../.apm/extensions/cartograph/public/activity-playback.js";
import { AccessActivity } from "../.apm/extensions/cartograph/activity/model.mjs";

const nodes = ["a", "b", "c"].map((id) => ({ id, storeRoot: "/atlas", path: `${id}.md` }));
const edges = [
  { id: "ba", source: "b", target: "a" },
  { id: "bc", source: "b", target: "c" },
  { id: "ac", source: "a", target: "c" },
];
const access = (id, accessedAt = 0, durationMs = 5000) => ({
  id, accessedAt, expiresAt: accessedAt + durationMs, pid: 42, kind: "read",
});
const activity = (records, durationMs = 5000) => ({ enabled: true, durationMs, nodes: records, edges: [] });
function playback() {
  const player = new ActivityPlayback();
  player.setGraph(nodes, edges);
  return player;
}
const ids = (snapshot) => snapshot.nodes.map((node) => node.id);
const spacing = ACTIVITY_SPACING_MS;

test("a burst starts immediately and activates subsequent files 400 ms apart", () => {
  const player = playback();
  const incoming = activity(nodes.map(({ id }) => access(id)));
  const before = structuredClone(incoming);
  player.update(incoming, 0);
  assert.equal(ACTIVITY_SPACING_MS, 400);
  assert.deepEqual(ids(player.advance(0)), ["a"]);
  assert.deepEqual(ids(player.advance(399)), ["a"]);
  assert.deepEqual(ids(player.advance(400)), ["a", "b"]);
  assert.deepEqual(ids(player.advance(799)), ["a", "b"]);
  const last = player.advance(800);
  assert.deepEqual(last.nodes.map(({ accessedAt, expiresAt }) => [accessedAt, expiresAt]),
    [[0, 5000], [400, 5400], [800, 5800]]);
  assert.equal(last.pendingCount, 0);
  assert.deepEqual(last.edges.map(({ source, target }) => [source, target]), [["a", "b"], ["b", "c"]]);
  assert.deepEqual(incoming, before);
});

test("source expiry does not cancel queued accesses or shorten displayed lifetimes", () => {
  const player = playback();
  player.update(activity(nodes.map(({ id }) => access(id, 0, 100)), 100), 0);
  player.advance(0);
  player.update(activity([], 100), 100);
  assert.deepEqual(ids(player.advance(100)), []);
  assert.deepEqual(ids(player.advance(spacing)), ["b"]);
  assert.deepEqual(player.advance(spacing).edges, []);
  assert.equal(player.advance(spacing).nodes[0].expiresAt, spacing + 100);
  assert.deepEqual(ids(player.advance(2 * spacing)), ["c"]);
  assert.deepEqual(player.advance(2 * spacing).edges, []);
  assert.deepEqual(ids(player.advance(2 * spacing + 100)), []);
  assert.equal(player.frame(2 * spacing + 100).amount, 0);
  assert.equal(player.seen.size, 0);
});

test("heartbeats and repeated pending reads do not grow or replay the queue", () => {
  const player = playback();
  player.update(activity(nodes.map(({ id }) => access(id))), 0);
  player.advance(0);
  for (let now = 1; now <= 100; now++) {
    const incoming = activity([access("a"), { ...access("b", now), kind: "write" }, access("c")]);
    player.update(incoming, now);
    player.update(structuredClone(incoming), now);
    assert.equal(player.pending.size, 2);
  }
  player.update(activity([access("a"), access("b", 50), access("c")]), 150);
  const second = player.advance(spacing).nodes.find((node) => node.id === "b");
  assert.equal(second.observedAt, 100);
  assert.equal(second.kind, "write");
  assert.equal(second.pid, 42);
  player.advance(2 * spacing);
  player.update(activity([access("a"), access("b", 100), access("c")]), 2 * spacing + 50);
  assert.equal(player.advance(3 * spacing).pendingCount, 0);
  assert.equal(player.advance(3 * spacing).nodes[0].expiresAt, 5000);
});

test("refreshes keep the visible node lit while waiting and retain its entrance envelope", () => {
  const player = playback();
  player.update(activity([access("a"), access("b")]), 0);
  player.advance(0);
  player.update(activity([access("a", 100), access("b")]), 100);
  assert.equal(player.frame(120).nodes.get("a"), 1);
  player.advance(spacing);
  assert.equal(player.frame(2 * spacing - 1).nodes.get("a"), 1);
  const refreshed = player.advance(2 * spacing).nodes.find((node) => node.id === "a");
  assert.equal(refreshed.highlightedAt, 0);
  assert.equal(refreshed.accessedAt, 2 * spacing);
  assert.equal(refreshed.expiresAt, 5000 + 2 * spacing);
  assert.equal(player.frame(2 * spacing).nodes.get("a"), 1);
  assert.deepEqual(player.advance(2 * spacing).edges.map(({ source, target, startedAt }) => [source, target, startedAt]),
    [["b", "a", 2 * spacing]]);
});

test("pulses follow displayed order and end at either displayed endpoint's expiry", () => {
  const player = playback();
  player.update(activity(nodes.map(({ id }) => access(id))), 0);
  assert.deepEqual(player.advance(0).edges, []);
  assert.deepEqual(player.advance(spacing - 1).edges, []);
  const second = player.advance(spacing);
  assert.deepEqual(second.edges, [{ id: "ba", source: "a", target: "b", startedAt: spacing, expiresAt: 5000, count: 1 }]);
  assert.equal(player.frame(spacing + 1).edges[0].progress, 1 / 1100);
  player.advance(2 * spacing);
  assert.equal(player.frame(4999).edges.length, 2);
  assert.deepEqual(player.advance(5000).edges.map((edge) => edge.id), ["bc"]);
  assert.deepEqual(player.advance(5000 + spacing).edges, []);
  assert.deepEqual(ids(player.advance(5000 + spacing)), ["c"]);
  assert.deepEqual(ids(player.advance(5000 + 2 * spacing)), []);
});

test("duration changes apply to presentation timestamps and to pending files", () => {
  const player = playback();
  player.update(activity(nodes.map(({ id }) => access(id))), 0);
  player.advance(0);
  player.advance(spacing);
  const shortened = spacing + 100;
  player.update(activity(nodes.map(({ id }) => access(id, 0, shortened)), shortened), spacing + 50);
  assert.deepEqual(player.advance(spacing + 50).nodes.map((node) => node.expiresAt), [shortened, spacing + shortened]);
  assert.deepEqual(ids(player.advance(shortened)), ["b"]);
  assert.equal(player.advance(2 * spacing).nodes.find((node) => node.id === "c").expiresAt, 2 * spacing + shortened);
  player.update(activity([], 3 * spacing), 2 * spacing + 50);
  assert.deepEqual(player.advance(2 * spacing + 50).nodes.map((node) => node.expiresAt), [4 * spacing, 5 * spacing]);
  assert.deepEqual(ids(player.advance(5 * spacing)), []);
});

test("pausing immediately clears active and pending files without later resurrection", () => {
  const player = playback();
  player.update(activity(nodes.map(({ id }) => access(id))), 0);
  player.advance(0);
  player.update({ enabled: false, nodes: [] }, 100);
  assert.deepEqual(ids(player.advance(100)), []);
  assert.equal(player.advance(spacing).pendingCount, 0);
  player.update(activity([]), spacing + 100);
  assert.deepEqual(ids(player.advance(spacing + 200)), []);
  player.update(activity([access("c", spacing + 300)]), spacing + 300);
  assert.deepEqual(ids(player.advance(spacing + 300)), ["c"]);
});

test("a longer duration does not resurrect highlights that expired while frames were paused", () => {
  const player = playback();
  player.update(activity([access("a"), access("b")]), 0);
  player.advance(0);
  player.update(activity([], 10000), 6000);
  const resumed = player.advance(6000);
  assert.deepEqual(ids(resumed), ["b"]);
  assert.equal(resumed.nodes[0].expiresAt, 16000);
});

test("graph filtering cancels removed nodes and relationships without touching retained nodes", () => {
  const player = playback();
  player.update(activity(nodes.map(({ id }) => access(id))), 0);
  player.advance(0);
  player.setGraph([nodes[0], nodes[2]], []);
  assert.deepEqual(ids(player.advance(spacing)), ["a", "c"]);
  assert.deepEqual(player.advance(spacing).edges, []);
  player.setGraph([], []);
  assert.deepEqual(ids(player.advance(1000)), []);
  assert.equal(player.advance(1000).pendingCount, 0);
  assert.equal(player.seen.size, 3);
  player.update(activity([]), 1000);
  player.advance(1000);
  assert.equal(player.seen.size, 0);
});

test("replacing an Atlas cannot replay old activity on reused local node IDs", () => {
  const player = playback();
  player.update(activity(nodes.map(({ id }) => access(id))), 0);
  player.advance(0);
  player.setGraph(nodes.map((node) => ({ ...node, storeRoot: "/other-atlas" })), edges);
  assert.deepEqual(ids(player.advance(spacing)), []);
  assert.equal(player.advance(spacing).pendingCount, 0);
  player.update(activity([access("b", spacing + 100)]), spacing + 100);
  assert.deepEqual(ids(player.advance(spacing + 100)), ["b"]);
});

test("a background-tab pause cannot drain multiple activations in one frame", () => {
  const player = playback();
  player.update(activity(nodes.map(({ id }) => access(id))), 0);
  player.advance(0);
  assert.deepEqual(ids(player.advance(10000)), ["b"]);
  assert.deepEqual(ids(player.advance(10000)), ["b"]);
  assert.deepEqual(ids(player.advance(10000 + MIN_ACTIVITY_SPACING_MS - 1)), ["b"]);
  assert.deepEqual(ids(player.advance(10000 + MIN_ACTIVITY_SPACING_MS)), ["b", "c"]);
  assert.equal(player.advance(10000 + MIN_ACTIVITY_SPACING_MS).nodes[1].expiresAt, 15000 + MIN_ACTIVITY_SPACING_MS);
});

test("accesses already separated by the playback interval need no extra delay", () => {
  const player = playback();
  player.update(activity([access("a")]), 0);
  player.advance(0);
  player.update(activity([access("a"), access("b", spacing)]), spacing);
  assert.equal(player.advance(spacing).nodes[1].accessedAt, spacing);
});

test("unknown, stale, invalid and future records do not enter playback", () => {
  const player = playback();
  player.update(activity([
    access("outside"), access("a", -5000), access("b", NaN), access("c", 100),
  ]), 0);
  assert.deepEqual(ids(player.advance(0)), []);
  assert.equal(player.advance(1000).pendingCount, 0);
});

test("an unrelated intermediate activation never falls back to an older related node", () => {
  const player = playback();
  player.setGraph(nodes, [edges[2]]);
  player.update(activity(nodes.map(({ id }) => access(id))), 0);
  player.advance(0);
  player.advance(spacing);
  assert.deepEqual(player.advance(2 * spacing).edges, []);
});

test("revisiting a node adds the actual return step without reversing earlier path segments", () => {
  const player = playback();
  player.update(activity(nodes.map(({ id }) => access(id))), 0);
  player.advance(0);
  player.advance(spacing);
  player.advance(2 * spacing);
  player.update(activity([access("a", 3 * spacing)]), 3 * spacing);
  const steps = [
    ["a", "b", spacing], ["b", "c", 2 * spacing], ["c", "a", 3 * spacing],
  ];
  assert.deepEqual(player.advance(3 * spacing).edges.map(({ source, target, startedAt }) => [source, target, startedAt]), steps);
  player.update(activity([access("a", 4 * spacing)]), 4 * spacing);
  assert.deepEqual(player.advance(4 * spacing).edges.map(({ source, target, startedAt }) => [source, target, startedAt]), steps);
});

test("removing a middle node does not reconnect the remaining path into a shortcut", () => {
  const player = playback();
  player.update(activity(nodes.map(({ id }) => access(id))), 0);
  player.advance(0);
  player.advance(spacing);
  player.advance(2 * spacing);
  player.setGraph([nodes[0], nodes[2]], [edges[2]]);
  assert.deepEqual(player.advance(2 * spacing + 1).edges, []);
  player.setGraph(nodes, edges);
  assert.deepEqual(player.advance(2 * spacing + 2).edges, []);
});

test("graph changes cannot create or resurrect an untraversed relationship", () => {
  const player = playback();
  player.setGraph(nodes, []);
  player.update(activity([access("a"), access("b")]), 0);
  player.advance(0);
  player.advance(spacing);
  player.setGraph(nodes, edges);
  assert.deepEqual(player.advance(spacing + 1).edges, []);
  player.update(activity([access("a", 2 * spacing)]), 2 * spacing);
  assert.equal(player.advance(2 * spacing).edges.length, 1);
  player.setGraph(nodes, []);
  player.setGraph(nodes, edges);
  assert.deepEqual(player.advance(2 * spacing + 1).edges, []);
});

test("removing the latest activation breaks the path instead of choosing another active node", () => {
  const player = playback();
  player.update(activity([access("a"), access("b")]), 0);
  player.advance(0);
  player.advance(spacing);
  player.setGraph([nodes[0], nodes[2]], [edges[2]]);
  player.update(activity([access("c", 2 * spacing)]), 2 * spacing);
  assert.deepEqual(player.advance(2 * spacing).edges, []);
});

test("pausing discards recorded transitions as well as the predecessor and pending activations", () => {
  const player = playback();
  player.update(activity(nodes.map(({ id }) => access(id))), 0);
  player.advance(0);
  assert.equal(player.advance(spacing).edges.length, 1);
  player.update({ enabled: false }, spacing + 1);
  assert.deepEqual(player.advance(2 * spacing).edges, []);
  assert.equal(player.transitions.size, 0);
  player.update(activity([access("c", 3 * spacing)]), 3 * spacing);
  assert.deepEqual(player.advance(3 * spacing).edges, []);
});

test("old path segments expire even when their nodes stay active through other transitions", () => {
  const player = playback();
  for (const [i, id] of ["a", "b", "c", "a", "c", "b", "c", "a"].entries()) {
    player.update(activity([access(id, i * spacing)]), i * spacing);
    player.advance(i * spacing);
  }
  assert.ok(player.advance(spacing + 4999).edges.some((edge) => edge.id === "ba"));
  const expired = player.advance(spacing + 5000);
  assert.ok(expired.nodes.some((node) => node.id === "a"));
  assert.ok(expired.nodes.some((node) => node.id === "b"));
  assert.ok(!expired.edges.some((edge) => edge.id === "ba"));
});

test("repeated traversal retains only the latest direction per graph relationship", () => {
  const player = playback();
  for (let i = 0; i < 20; i++) {
    const id = i % 2 === 0 ? "a" : "b";
    player.update(activity([access(id, i * spacing)]), i * spacing);
    const snapshot = player.advance(i * spacing);
    assert.ok(player.transitions.size <= 1);
    if (i > 0) {
      assert.deepEqual(snapshot.edges.map(({ source, target }) => [source, target]),
        [[id === "a" ? "b" : "a", id]]);
    }
  }
});

const countedAccess = (id, sequence, { count = 1, firstSequence = sequence, now = 0 } = {}) => ({
  ...access(id, now), sequence, count, firstSequence,
});

test("queue depth and oldest waiting time select the approved adaptive pacing tiers", () => {
  for (const [pending, expected] of [[0, 400], [1, 400], [5, 400], [6, 200], [15, 200], [16, 100], [40, 100], [41, 50]]) {
    assert.equal(activitySpacing(pending), expected);
  }
  assert.equal(activitySpacing(1, 1999), 400);
  assert.equal(activitySpacing(1, 2000), 100);
  assert.equal(activitySpacing(1, 5000), 50);
  assert.equal(activitySpacing(0, 10000), 400);
});

test("a 100-file burst accelerates smoothly, plays every file and preserves full lifetimes", () => {
  const player = new ActivityPlayback();
  const graphNodes = Array.from({ length: 100 }, (_, i) => ({ id: `n${i}`, path: `n${i}.md`, storeRoot: "/atlas" }));
  player.setGraph(graphNodes, []);
  player.update(activity(graphNodes.map(({ id }, i) => countedAccess(id, i + 1))), 0);
  assert.equal(player.advance(0).playback.spacingMs, 400);
  assert.ok(player.advance(100).playback.spacingMs > 50);
  const played = new Set(["n0"]);
  let previous = 0, last = 0, frame;
  for (let now = 116; now < 10000; now += 16) {
    frame = player.advance(now);
    for (const node of frame.nodes) {
      if (!played.has(node.id)) {
        assert.ok(node.accessedAt - previous >= 50);
        assert.equal(node.expiresAt - node.accessedAt, 5000);
        played.add(node.id);
        previous = last = node.accessedAt;
      }
    }
    if (!frame.pendingCount) break;
  }
  assert.equal(played.size, 100);
  assert.ok(last < 10000, `Burst took ${last} ms instead of under 10 seconds`);
  assert.equal(frame.playback.cancelledCount, 0);
  const fast = frame.playback.spacingMs;
  const recovering = player.advance(last + 500).playback.spacingMs;
  assert.ok(recovering > fast && recovering < 400);
  assert.equal(player.advance(last + 2000).playback.spacingMs, 400);
});

test("oldest pending age survives hot-file aggregation and drives catch-up", () => {
  const player = playback();
  player.update(activity([countedAccess("a", 1), countedAccess("b", 2)]), 0);
  player.advance(0);
  player.update(activity([countedAccess("b", 3, { count: 2, firstSequence: 2, now: 2000 })]), 2000);
  assert.equal(player.pending.get("b").queuedAt, 0);
  const frame = player.advance(2000);
  assert.equal(frame.playback.targetSpacingMs, 100);
  assert.equal(frame.playback.aggregatedCount, 1);
  assert.equal(frame.nodes.find((node) => node.id === "b").count, 2);
});

test("same-timestamp observations count exactly once and cannot manufacture a path across aggregation gaps", () => {
  const player = playback();
  const incoming = activity([
    countedAccess("a", 3, { count: 2, firstSequence: 1 }),
    countedAccess("b", 2),
    countedAccess("c", 4),
  ]);
  player.update(incoming, 0);
  player.update(structuredClone(incoming), 0);
  assert.equal(player.pending.size, 3);
  assert.equal(player.advance(0).nodes[0].id, "b");
  const middle = player.advance(400);
  assert.equal(middle.nodes.find((node) => node.id === "a").count, 2);
  assert.equal(middle.playback.aggregatedCount, 1);
  assert.deepEqual(player.advance(800).edges, []);
});

test("provably consecutive observations retain paths and count only actual displayed traversals", () => {
  const player = playback();
  for (const [i, id] of ["a", "b", "a", "b"].entries()) {
    player.update(activity([countedAccess(id, i + 1, { now: i * 400 })]), i * 400);
    player.advance(i * 400);
  }
  const snapshot = player.advance(1200);
  assert.equal(snapshot.edges.length, 1);
  assert.equal(snapshot.edges[0].count, 3);
  assert.equal(snapshot.nodes.find((node) => node.id === "a").count, 2);
  assert.equal(snapshot.playback.repeatedEdges[0].count, 3);
  player.update(activity([countedAccess("c", 6, { now: 1600 })]), 1600);
  assert.ok(!player.advance(1600).edges.some((edge) => edge.target === "c"));
});

test("sustained 1000 observations/second stays bounded by visible files and reports aggregation", () => {
  const player = playback();
  let seq = 0;
  const counts = new Map(), first = new Map();
  for (let now = 0; now <= 10000; now += 50) {
    for (let i = 0; i < 50; i++) {
      const id = nodes[seq % nodes.length].id;
      seq++;
      counts.set(id, (counts.get(id) ?? 0) + 1);
      if (!first.has(id)) first.set(id, seq);
      player.update(activity([countedAccess(id, seq, { now, count: counts.get(id), firstSequence: first.get(id) })]), now);
    }
    player.advance(now);
    assert.ok(player.pending.size <= nodes.length);
    assert.ok(player.active.size <= nodes.length);
    assert.ok(player.seen.size <= nodes.length);
  }
  let snapshot;
  for (let now = 10050; now <= 11200; now += 50) snapshot = player.advance(now);
  assert.equal(snapshot.pendingCount, 0);
  assert.equal(snapshot.nodes.reduce((sum, node) => sum + node.count, 0), seq);
  assert.ok(snapshot.playback.aggregatedCount > 9900);
  assert.equal(snapshot.playback.cancelledCount, 0);
  assert.deepEqual(snapshot.edges, []);
});

test("graph removal cancels queued observations visibly and never connects across the removed slot", () => {
  const player = playback();
  player.update(activity(nodes.map(({ id }, i) => countedAccess(id, i + 1))), 0);
  player.advance(0);
  player.setGraph([nodes[0], nodes[2]], [edges[2]]);
  const frame = player.advance(400);
  assert.equal(frame.playback.cancelledCount, 1);
  assert.deepEqual(frame.edges, []);
  player.update({ enabled: false }, 401);
  assert.equal(player.advance(401).playback.aggregatedCount, 0);
  assert.equal(player.advance(401).playback.spacingMs, 400);
});

test("repeated pending observations without sequence metadata are conservatively disconnected", () => {
  const player = playback();
  player.update(activity(nodes.map(({ id }) => access(id))), 0);
  player.advance(0);
  player.update(activity([access("b", 100)]), 100);
  player.advance(400);
  assert.deepEqual(player.advance(800).edges, []);
});

test("real backend interval counts preserve revisits without losing or duplicating observations", () => {
  let now = 0;
  const model = new AccessActivity({ now: () => now });
  model.setGraph({ nodes, edges });
  const player = playback();
  for (const [i, id] of ["a", "b", "a", "b", "c"].entries()) {
    now = i * 400;
    model.record({ path: `/atlas/${id}.md`, pid: 42, kind: "read" });
    player.update(model.snapshot(), now);
    const frame = player.advance(now);
    assert.equal(frame.nodes.reduce((sum, node) => sum + node.count, 0), i + 1);
    if (i === 3) {
      assert.equal(frame.edges[0].count, 3);
      assert.equal(frame.nodes.find((node) => node.id === "a").count, 2);
    }
  }
  const frame = player.advance(now);
  assert.deepEqual(frame.edges.map(({ source, target }) => [source, target]), [["a", "b"], ["b", "c"]]);
  assert.equal(frame.playback.aggregatedCount, 0);
});

const qualifiedGraph = () => ({
  nodes: nodes.map((node) => ({ ...node, id: `atlas::${node.id}` })),
  edges: edges.map((edge) => ({
    ...edge, id: `atlas::${edge.id}`, source: `atlas::${edge.source}`, target: `atlas::${edge.target}`,
  })),
});

const aliasNodes = ["first", "second"].map((atlasKey) => ({
  ...nodes[0], id: `${atlasKey}::a`, localId: "a", atlasKey,
}));
const aliasEdge = { id: "aliases", source: aliasNodes[0].id, target: aliasNodes[1].id, kind: "mesh" };

test("physical aliases consume each observation once in separate bounded FIFO slots", () => {
  let now = 0;
  const model = new AccessActivity({ now: () => now });
  model.setGraph({ nodes: aliasNodes, edges: [aliasEdge] });
  const player = new ActivityPlayback();
  player.setGraph(aliasNodes, [aliasEdge]);
  model.record({ path: "/atlas/a.md", pid: 42, kind: "read" });
  const incoming = model.snapshot();
  assert.deepEqual(incoming.nodes.map(({ sequence }) => sequence), [1, 1]);
  player.update(incoming, now);
  player.update(structuredClone(incoming), now);
  assert.deepEqual([...player.pending.keys()], aliasNodes.map(({ id }) => id));
  assert.equal(player.seen.size, 2);
  assert.deepEqual(ids(player.advance(now)), [aliasNodes[0].id]);
  for (now = 10; now <= 20; now += 10) {
    model.record({ path: "/atlas/a.md", pid: 42, kind: "read" });
    player.update(model.snapshot(), now);
    player.update(model.snapshot(), now);
    assert.deepEqual([...player.pending.keys()], [aliasNodes[1].id, aliasNodes[0].id]);
  }
  assert.equal(player.pending.get(aliasNodes[1].id).queuedAt, 0);
  assert.equal(player.pending.get(aliasNodes[0].id).queuedAt, 10);
  const second = player.advance(400);
  assert.equal(second.nodes.find(({ id }) => id === aliasNodes[1].id).count, 3);
  assert.deepEqual(second.edges, []);
  const last = player.advance(800);
  assert.deepEqual(last.nodes.map(({ count }) => count), [3, 3]);
  assert.deepEqual(last.nodes.map(({ expiresAt }) => expiresAt), [5800, 5400]);
  assert.equal(last.playback.aggregatedCount, 3);
  assert.equal(last.playback.cancelledCount, 0);
  assert.deepEqual(last.edges, []);
  player.update(model.snapshot(), 801);
  assert.equal(player.advance(1200).pendingCount, 0);
});

test("unchanged and reordered graphs preserve every physical alias's active, pending and seen state", () => {
  for (const metadata of [true, false]) {
    const graphNodes = aliasNodes.map(({ atlasKey, ...node }) => metadata ? { ...node, atlasKey } : node);
    const player = new ActivityPlayback();
    player.setGraph(graphNodes, [aliasEdge]);
    const incoming = activity(graphNodes.map(({ id }) => countedAccess(id, 1)));
    player.update(incoming, 0);
    player.advance(0);
    for (const now of [10, 410]) {
      const before = ["active", "pending", "seen"].map((name) => [...player[name]]);
      const predecessor = player.lastActivatedId;
      player.setGraph([...graphNodes].reverse(), [aliasEdge]);
      player.update(incoming, now);
      assert.deepEqual(["active", "pending", "seen"].map((name) => [...player[name]]), before);
      assert.equal(player.lastActivatedId, predecessor);
      assert.equal(player.cancelledCount, 0);
      player.advance(now + 390);
    }
    assert.deepEqual(ids(player.advance(800)), graphNodes.map(({ id }) => id));
  }
});

test("filtering an alias cancels only its own slot and remounting never replays retained source observations", () => {
  for (const removed of [0, 1]) {
    const player = new ActivityPlayback();
    player.setGraph(aliasNodes, [aliasEdge]);
    const incoming = activity(aliasNodes.map(({ id }) => countedAccess(id, 1)));
    player.update(incoming, 0);
    player.advance(0);
    const retained = aliasNodes[1 - removed];
    player.setGraph([retained], []);
    assert.equal(player.cancelledCount, removed === 1 ? 1 : 0);
    assert.equal(player.lastActivatedId, null);
    assert.deepEqual(ids(player.advance(400)), [retained.id]);
    player.update(incoming, 401);
    player.setGraph(aliasNodes, [aliasEdge]);
    player.update(incoming, 402);
    assert.deepEqual(ids(player.advance(800)), [retained.id]);
    assert.equal(player.pending.size, 0);
    player.setGraph([], []);
    player.update(incoming, 801);
    player.advance(801);
    player.setGraph([...aliasNodes].reverse(), [aliasEdge]);
    player.update(incoming, 802);
    assert.deepEqual(ids(player.advance(1200)), []);
    assert.equal(player.seen.size, 2);
    player.update(activity([]), 1201);
    player.advance(1201);
    assert.equal(player.seen.size, 0);
  }
});

test("reads on hidden aliases are consumed independently without stealing the visible alias's update", () => {
  const player = new ActivityPlayback();
  player.setGraph(aliasNodes, [aliasEdge]);
  const incoming = (sequence, now) => activity(aliasNodes.map(({ id }) => countedAccess(id, sequence, {
    count: sequence, firstSequence: 1, now,
  })));
  player.update(incoming(1, 0), 0);
  player.advance(0);
  player.advance(400);
  player.setGraph([aliasNodes[1]], []);
  player.update(incoming(2, 410), 410);
  assert.deepEqual([...player.pending.keys()], [aliasNodes[1].id]);
  player.setGraph(aliasNodes, [aliasEdge]);
  player.update(incoming(2, 410), 420);
  assert.deepEqual([...player.pending.keys()], [aliasNodes[1].id]);
  player.advance(800);
  player.update(incoming(3, 810), 810);
  player.advance(1200);
  const last = player.advance(1600);
  assert.deepEqual(last.nodes.map(({ id, count }) => [id, count]), [
    [aliasNodes[1].id, 3], [aliasNodes[0].id, 1],
  ]);
  assert.deepEqual(last.edges, []);
});

test("legacy duplicate observations highlight both aliases without a physical self traversal", () => {
  const player = new ActivityPlayback();
  player.setGraph(aliasNodes, [aliasEdge]);
  const incoming = activity(aliasNodes.map(({ id }) => access(id)));
  player.update(incoming, 0);
  player.advance(0);
  const last = player.advance(400);
  assert.deepEqual(ids(last), aliasNodes.map(({ id }) => id));
  assert.deepEqual(last.edges, []);
  player.update(incoming, 410);
  assert.equal(player.pending.size, 0);
});

test("remounted aliases do not replay observations consumed by the remaining mount between frames", () => {
  for (const advanceWhileUnmounted of [false, true]) {
    const player = new ActivityPlayback();
    player.setGraph(aliasNodes, [aliasEdge]);
    player.update(activity(aliasNodes.map(({ id }) => countedAccess(id, 1))), 0);
    player.advance(0);
    player.advance(400);
    player.setGraph([aliasNodes[1]], []);
    const observed = (id) => countedAccess(id, 2, { count: 2, firstSequence: 1, now: 410 });
    player.update(activity([observed(aliasNodes[1].id)]), 410);
    if (advanceWhileUnmounted) player.advance(420);
    player.setGraph(aliasNodes, [aliasEdge]);
    player.update(activity(aliasNodes.map(({ id }) => observed(id))), 430);
    assert.deepEqual([...player.pending.keys()], [aliasNodes[1].id]);
    const last = player.advance(800);
    assert.deepEqual(last.nodes.map(({ id, count }) => [id, count]), [[aliasNodes[1].id, 2]]);
    assert.deepEqual(last.edges, []);
  }
});

test("initially hidden aliases keep independent consumption when their physical metadata arrives", () => {
  const player = new ActivityPlayback();
  const incoming = activity(aliasNodes.map(({ id }) => countedAccess(id, 1)));
  player.update(incoming, 0);
  player.advance(0);
  player.setGraph(aliasNodes, [aliasEdge]);
  player.update(incoming, 10);
  assert.deepEqual(ids(player.advance(10)), []);
  assert.equal(player.seen.size, 2);
  player.update(activity(aliasNodes.map(({ id }) => countedAccess(id, 2, {
    count: 2, firstSequence: 1, now: 20,
  }))), 20);
  player.advance(20);
  const next = player.advance(420);
  assert.deepEqual(next.nodes.map(({ id, count }) => [id, count]), aliasNodes.map(({ id }) => [id, 1]));
  assert.deepEqual(next.edges, []);
});

test("revealing physical metadata and mounting an alias together cannot replay a hidden read", () => {
  const player = new ActivityPlayback();
  player.update(activity([countedAccess(aliasNodes[0].id, 1)]), 0);
  player.advance(0);
  player.setGraph(aliasNodes, [aliasEdge]);
  player.update(activity(aliasNodes.map(({ id }) => countedAccess(id, 1))), 10);
  assert.deepEqual(ids(player.advance(10)), []);
  assert.equal(player.seen.size, 2);
  player.update(activity(aliasNodes.map(({ id }) => countedAccess(id, 2, {
    count: 2, firstSequence: 1, now: 20,
  }))), 20);
  player.advance(20);
  assert.deepEqual(player.advance(420).nodes.map(({ count }) => count), [1, 1]);
});

test("alias qualification preserves the surviving mount without transferring or replaying removed slots", () => {
  let now = 0;
  const model = new AccessActivity({ now: () => now });
  const player = new ActivityPlayback();
  const mount = (graphNodes) => {
    model.setGraph({ nodes: graphNodes, edges: [] });
    player.setGraph(graphNodes, []);
    player.update(model.snapshot(), now);
  };
  const read = (time) => {
    now = time;
    model.record({ path: "/atlas/a.md", pid: 42, kind: "read" });
    player.update(model.snapshot(), now);
  };
  mount([{ ...aliasNodes[0], id: "a" }]);
  read(0);
  player.advance(0);
  read(10);
  const original = { ...player.pending.get("a") };
  mount(aliasNodes);
  assert.deepEqual([...player.active.keys()], [aliasNodes[0].id]);
  assert.deepEqual([...player.pending.values()], [{ ...original, id: aliasNodes[0].id }]);
  assert.equal(player.advance(400).nodes[0].count, 2);
  read(410);
  assert.deepEqual([...player.pending.keys()], aliasNodes.map(({ id }) => id));
  player.advance(800);
  const survivor = { ...player.pending.get(aliasNodes[1].id) };
  read(810);
  mount([{ ...aliasNodes[1], id: "a" }]);
  assert.equal(player.active.size, 0);
  assert.equal(player.cancelledCount, 1);
  assert.equal(player.pending.size, 1);
  assert.equal(player.pending.get("a").queuedAt, survivor.queuedAt);
  assert.equal(player.pending.get("a").observations, 2);
  const displayed = player.advance(1200);
  assert.deepEqual(displayed.nodes.map(({ id, count }) => [id, count]), [["a", 2]]);
  assert.deepEqual(displayed.edges, []);
  mount(aliasNodes);
  assert.deepEqual([...player.active.keys()], [aliasNodes[1].id]);
  assert.equal(player.pending.size, 0);
  assert.equal(player.cancelledCount, 1);
  read(1210);
  player.advance(1600);
  const last = player.advance(2000);
  assert.deepEqual(last.nodes.map(({ id, count }) => [id, count]), [
    [aliasNodes[1].id, 3], [aliasNodes[0].id, 1],
  ]);
  assert.equal(last.pendingCount, 0);
  assert.deepEqual(last.edges, []);
});

test("relationships incident to physical aliases remain separate and equal sequences never traverse them", () => {
  const player = new ActivityPlayback();
  const graphNodes = [...aliasNodes, nodes[1]];
  const graphEdges = [
    ...aliasNodes.map(({ id }) => ({ id: `${id}-b`, source: id, target: "b", kind: "link" })),
    aliasEdge,
  ];
  player.setGraph(graphNodes, graphEdges);
  player.update(activity([
    ...aliasNodes.map(({ id }) => countedAccess(id, 1)), countedAccess("b", 2),
  ]), 0);
  player.advance(0);
  assert.deepEqual(player.advance(400).edges, []);
  assert.deepEqual(player.advance(800).edges.map(({ source, target }) => [source, target]), [[aliasNodes[1].id, "b"]]);
  player.update(activity(aliasNodes.map(({ id }) => countedAccess(id, 3, {
    count: 2, firstSequence: 1, now: 810,
  }))), 810);
  const traversals = [["b", aliasNodes[0].id], [aliasNodes[1].id, "b"]];
  const steps = (snapshot) => snapshot.edges.map(({ source, target }) => [source, target]).sort();
  assert.deepEqual(steps(player.advance(1200)), traversals.sort());
  assert.deepEqual(steps(player.advance(1600)), traversals.sort());
  player.setGraph([...graphNodes].reverse(), graphEdges);
  assert.deepEqual(steps(player.advance(1601)), traversals.sort());
  player.setGraph([aliasNodes[0], nodes[1]], [graphEdges[0]]);
  assert.deepEqual(steps(player.advance(1602)), [["b", aliasNodes[0].id]]);
});

test("multi-Atlas qualification and its reverse preserve active, pending, and consumed physical files", () => {
  let now = 0;
  const model = new AccessActivity({ now: () => now });
  const player = playback();
  const local = { nodes, edges }, qualified = qualifiedGraph();
  model.setGraph(local);
  const read = (id, time) => {
    now = time;
    model.record({ path: `/atlas/${id}.md`, pid: 42, kind: "read" });
    player.update(model.snapshot(), now);
  };
  read("a", 0);
  player.advance(0);
  read("b", 10);
  read("b", 20);
  player.advance(400);
  read("a", 410);
  read("c", 420);
  const beforeActive = [...player.active.values()];
  const beforePending = [...player.pending.values()];
  const beforeEdges = player.advance(420).edges;
  const beforeSeen = [...player.seen.values()];
  const aggregatedCount = player.aggregatedCount;
  for (const [graph, prefix] of [[qualified, "atlas::"], [local, ""]]) {
    model.setGraph(graph);
    player.setGraph(graph.nodes, graph.edges);
    player.update(model.snapshot(), now);
    const remapped = (records) => records.map((node) => ({ ...node, id: prefix + node.id }));
    assert.deepEqual([...player.active.values()], remapped(beforeActive));
    assert.deepEqual([...player.pending.values()], remapped(beforePending));
    assert.deepEqual([...player.seen.values()].map(({ id, ...node }) => node),
      beforeSeen.map(({ id, ...node }) => node));
    assert.equal(player.lastActivatedId, `${prefix}b`);
    assert.equal(player.cancelledCount, 0);
    assert.equal(player.aggregatedCount, aggregatedCount);
    assert.deepEqual(player.advance(now).edges, beforeEdges.map((edge) => ({
      ...edge, id: prefix + edge.id, source: prefix + edge.source, target: prefix + edge.target,
    })));
  }
  const revisit = player.advance(800);
  assert.equal(revisit.nodes.find((node) => node.id === "a").count, 2);
  assert.equal(revisit.nodes.find((node) => node.id === "a").highlightedAt, 0);
  assert.equal(revisit.nodes.find((node) => node.id === "a").expiresAt, 5800);
  assert.deepEqual(revisit.edges.map(({ source, target, count }) => [source, target, count]), [["b", "a", 2]]);
  const last = player.advance(1200);
  assert.deepEqual(last.edges.map(({ source, target }) => [source, target]), [["b", "a"], ["a", "c"]]);
  assert.equal(last.nodes.reduce((sum, node) => sum + node.count, 0), 5);
  assert.equal(last.nodes.find((node) => node.id === "c").expiresAt, 6200);
  read("a", 1600);
  const fresh = player.advance(now);
  assert.equal(fresh.nodes.find((node) => node.id === "a").count, 3);
  assert.equal(fresh.nodes.find((node) => node.id === "a").firstSequence, 1);
  assert.deepEqual(fresh.edges.map(({ source, target }) => [source, target]), [["b", "a"], ["c", "a"]]);
});

test("physical files do not inherit playback when a local ID is reused in another path or Atlas", () => {
  for (const replacement of [{ ...nodes[0], path: "replacement.md" }, { ...nodes[0], storeRoot: "/other" }]) {
    const player = playback();
    player.update(activity([countedAccess("a", 1)]), 0);
    player.advance(0);
    player.update(activity([countedAccess("a", 2, { count: 2, firstSequence: 1, now: 10 })]), 10);
    player.setGraph([replacement], []);
    assert.equal(player.advance(100).nodes.length, 0);
    assert.equal(player.pending.size, 0);
    assert.equal(player.cancelledCount, 1);
    player.update(activity([countedAccess("a", 3, { now: 100 })]), 100);
    const next = player.advance(400);
    assert.equal(next.nodes[0].count, 1);
    assert.equal(next.nodes[0].highlightedAt, 400);
    assert.deepEqual(next.edges, []);
  }
});

test("qualification does not conflate equal local IDs belonging to two physical files", () => {
  const player = playback();
  player.update(activity([countedAccess("a", 1)]), 0);
  player.advance(0);
  const qualified = qualifiedGraph();
  player.setGraph([...qualified.nodes, { ...nodes[0], id: "other::a", storeRoot: "/other" }], qualified.edges);
  player.update(activity([countedAccess("atlas::a", 1), countedAccess("other::a", 2, { now: 10 })]), 10);
  assert.deepEqual([...player.pending.keys()], ["other::a"]);
  const next = player.advance(400);
  assert.deepEqual(next.nodes.map(({ id, count }) => [id, count]), [["atlas::a", 1], ["other::a", 1]]);
  assert.deepEqual(next.edges, []);
});

test("hiding and revealing a layer cannot replay cancelled raw observations", () => {
  for (const counted of [false, true]) {
    const player = playback();
    const incoming = activity(nodes.map(({ id }, i) => counted ? countedAccess(id, i + 1) : access(id)));
    player.update(incoming, 0);
    player.advance(0);
    player.setGraph([nodes[2]], []);
    assert.deepEqual(ids(player.advance(100)), []);
    assert.equal(player.cancelledCount, 1);
    player.update(incoming, 100);
    player.advance(100);
    player.setGraph(nodes, edges);
    player.update(incoming, 200);
    const visible = player.advance(400);
    assert.deepEqual(ids(visible), ["c"]);
    assert.deepEqual(visible.edges, []);
    assert.equal(visible.pendingCount, 0);
    assert.equal(visible.playback.cancelledCount, 1);
    player.setGraph([], []);
    player.update(incoming, 401);
    player.advance(401);
    player.setGraph(nodes, edges);
    player.update(incoming, 450);
    assert.deepEqual(ids(player.advance(800)), []);
  }
});

test("reads while hidden are consumed, and only fresh visible reads enter playback", () => {
  let now = 0;
  const model = new AccessActivity({ now: () => now });
  model.setGraph({ nodes, edges });
  const player = playback();
  model.record({ path: "/atlas/a.md", pid: 42, kind: "read" });
  player.update(model.snapshot(), now);
  player.advance(now);
  player.setGraph([nodes[0], nodes[2]], [edges[2]]);
  now = 10;
  model.record({ path: "/atlas/b.md", pid: 42, kind: "read" });
  player.update(model.snapshot(), now);
  now = 20;
  model.record({ path: "/atlas/b.md", pid: 42, kind: "read" });
  player.update(model.snapshot(), now);
  assert.equal(player.pending.size, 0);
  player.setGraph(nodes, edges);
  player.update(model.snapshot(), now);
  assert.equal(player.advance(400).nodes.length, 1);
  now = 410;
  model.record({ path: "/atlas/b.md", pid: 42, kind: "read" });
  player.update(model.snapshot(), now);
  const fresh = player.advance(now);
  assert.equal(fresh.nodes.find((node) => node.id === "b").count, 1);
  assert.deepEqual(fresh.edges, []);
  now = 810;
  model.record({ path: "/atlas/c.md", pid: 42, kind: "read" });
  player.update(model.snapshot(), now);
  assert.deepEqual(player.advance(now).edges.map(({ source, target }) => [source, target]), [["b", "c"]]);
});

test("initially invisible activity uses an ID fallback until physical graph metadata is available", () => {
  const player = new ActivityPlayback();
  player.setGraph([], []);
  const incoming = activity([countedAccess("a", 1)]);
  player.update(incoming, 0);
  player.advance(0);
  player.setGraph(nodes, edges);
  player.update(incoming, 10);
  assert.deepEqual(ids(player.advance(10)), []);
  player.update(activity([countedAccess("a", 2, { count: 2, firstSequence: 1, now: 20 })]), 20);
  assert.equal(player.advance(20).nodes[0].count, 1);
});

test("legacy nodes without paths remain separate and do not remap merely because metadata is absent", () => {
  const player = new ActivityPlayback();
  player.setGraph([{ id: "a" }, { id: "b" }], []);
  player.update(activity([access("a"), access("b")]), 0);
  player.advance(0);
  player.setGraph([{ id: "b" }, { id: "c" }], []);
  const remaining = player.advance(400);
  assert.deepEqual(ids(remaining), ["b"]);
  assert.equal(remaining.nodes[0].observedAt, 0);
  player.update(activity([access("c", 410)]), 410);
  assert.deepEqual(ids(player.advance(800)), ["b", "c"]);
});

test("legacy paths still distinguish physical files when storeRoot is unavailable", () => {
  const player = new ActivityPlayback();
  player.setGraph([{ id: "a", path: "/one/a.md" }], []);
  player.update(activity([access("a")]), 0);
  player.advance(0);
  player.setGraph([{ id: "qualified::a", path: "/one/a.md" }], []);
  player.update(activity([access("qualified::a")]), 10);
  assert.deepEqual(ids(player.advance(10)), ["qualified::a"]);
  player.setGraph([{ id: "qualified::a", path: "/two/a.md" }], []);
  assert.deepEqual(ids(player.advance(20)), []);
});

test("legacy activity cannot invent a shortcut across a hidden observation or cancelled pending slot", () => {
  for (const hideAfterQueue of [false, true]) {
    const player = playback();
    if (!hideAfterQueue) player.setGraph([nodes[0], nodes[2]], [edges[2]]);
    player.update(activity(nodes.map(({ id }) => access(id))), 0);
    if (hideAfterQueue) player.setGraph([nodes[0], nodes[2]], [edges[2]]);
    player.advance(0);
    const next = player.advance(400);
    assert.deepEqual(ids(next), ["a", "c"]);
    assert.deepEqual(next.edges, []);
  }
});

test("qualification retains only actually traversed relationships with unchanged kind and direction", () => {
  const original = { ...edges[0], kind: "link", relKind: "parent" };
  const qualified = qualifiedGraph();
  for (const changed of [{ kind: "mesh" }, { relKind: "child" }, { source: "atlas::a", target: "atlas::b" }]) {
    const player = playback();
    player.setGraph(nodes, [original]);
    player.update(activity([countedAccess("a", 1), countedAccess("b", 2)]), 0);
    player.advance(0);
    assert.equal(player.advance(400).edges.length, 1);
    player.setGraph(qualified.nodes, [
      { ...qualified.edges[0], kind: original.kind, relKind: original.relKind, ...changed }, qualified.edges[2],
    ]);
    assert.deepEqual(player.advance(401).edges, []);
    player.setGraph(nodes, [original]);
    assert.deepEqual(player.advance(402).edges, []);
  }
});

test("physical identity retains consumption across hidden qualification without playing hidden reads later", () => {
  const player = playback();
  player.update(activity([countedAccess("a", 1)]), 0);
  player.advance(0);
  player.setGraph([], []);
  player.update(activity([countedAccess("atlas::a", 2, { count: 2, firstSequence: 1, now: 100 })]), 100);
  player.advance(100);
  const qualified = qualifiedGraph();
  player.setGraph(qualified.nodes, qualified.edges);
  player.update(activity([countedAccess("atlas::a", 2, { count: 2, firstSequence: 1, now: 100 })]), 200);
  assert.deepEqual(ids(player.advance(400)), []);
  player.update(activity([countedAccess("atlas::a", 3, { count: 3, firstSequence: 1, now: 410 })]), 410);
  assert.equal(player.advance(410).nodes[0].count, 1);
});

test("deletion cancels playback but recreating the same physical path accepts a new backend interval", () => {
  let now = 0;
  const model = new AccessActivity({ now: () => now });
  model.setGraph({ nodes, edges });
  const player = playback();
  model.record({ path: "/atlas/a.md", pid: 42, kind: "read" });
  player.update(model.snapshot(), now);
  player.advance(now);
  now = 10;
  model.record({ path: "/atlas/a.md", pid: 42, kind: "read" });
  player.update(model.snapshot(), now);
  model.setGraph({ nodes: [], edges: [] });
  player.setGraph([], []);
  assert.equal(player.advance(10).nodes.length, 0);
  assert.equal(player.cancelledCount, 1);
  model.setGraph({ nodes, edges });
  player.setGraph(nodes, edges);
  now = 20;
  model.record({ path: "/atlas/a.md", pid: 42, kind: "read" });
  player.update(model.snapshot(), now);
  const recreated = player.advance(400);
  assert.equal(recreated.nodes[0].count, 1);
  assert.equal(recreated.nodes[0].firstSequence, 3);
  assert.equal(recreated.nodes[0].highlightedAt, 400);
  assert.deepEqual(recreated.edges, []);
});

test("a genuinely newer sequence reset starts a new interval rather than being suppressed or double counted", () => {
  const player = playback();
  player.update(activity([countedAccess("a", 5, { count: 5, firstSequence: 1 })]), 0);
  player.advance(0);
  player.update(activity([countedAccess("a", 6, { count: 6, firstSequence: 1, now: 10 })]), 10);
  player.setGraph([], []);
  player.setGraph(nodes, edges);
  const restarted = activity([countedAccess("a", 1, { now: 20 })]);
  player.update(restarted, 20);
  player.update(restarted, 21);
  assert.equal(player.pending.size, 1);
  player.update(activity([countedAccess("a", 6, { count: 6, firstSequence: 1, now: 10 })]), 22);
  const next = player.advance(400);
  assert.equal(next.nodes[0].count, 1);
  assert.equal(next.nodes[0].sequence, 1);
  assert.equal(next.playback.cancelledCount, 1);
  assert.deepEqual(next.edges, []);
});

test("a source sequence restart cannot connect across queued observations from the earlier sequence", () => {
  const player = playback();
  player.update(activity([countedAccess("a", 1)]), 0);
  player.advance(0);
  player.update(activity([
    countedAccess("c", 2, { now: 10 }),
    countedAccess("a", 5, { count: 2, firstSequence: 1, now: 20 }),
  ]), 20);
  player.update(activity([countedAccess("a", 3, { now: 30 })]), 30);
  const middle = player.advance(400);
  assert.deepEqual(ids(middle), ["c"]);
  const next = player.advance(800);
  assert.deepEqual(ids(next), ["c", "a"]);
  assert.equal(next.nodes.find((node) => node.id === "a").count, 1);
  assert.deepEqual(next.edges, []);
});
