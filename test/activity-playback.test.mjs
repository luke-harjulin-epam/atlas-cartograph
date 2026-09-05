import test from "node:test";
import assert from "node:assert/strict";
import { ActivityPlayback, ACTIVITY_SPACING_MS, MIN_ACTIVITY_SPACING_MS, activitySpacing } from "../src/public/activity-playback.js";
import { AccessActivity } from "../src/activity/model.mjs";

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
