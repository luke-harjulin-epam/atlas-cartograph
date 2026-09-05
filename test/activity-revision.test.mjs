import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createActivityService } from "../.apm/extensions/cartograph/activity/service.mjs";
import { freshState, openAtlas, startServer } from "../.apm/extensions/cartograph/server.mjs";

const root = fileURLToPath(new URL("../.apm/extensions/cartograph/fixtures/mini-atlas", import.meta.url));
const canvasHeaders = { "X-Cartograph-Client": "canvas" };

test("activity revision survives producer replacement while fresh sessions have independent clocks", (t) => {
  const entry = { state: freshState(root), clients: new Set() };
  const service = createActivityService(entry, () => {}, { platform: "darwin" });
  t.after(() => service.close());
  const previous = service.sync();
  service.close();
  const replacement = createActivityService(entry, () => {}, { platform: "darwin" });
  t.after(() => replacement.close());
  assert.ok(entry.state.activity.revision > previous.revision);
  const other = { state: freshState(root), clients: new Set() };
  const independent = createActivityService(other, () => {}, { platform: "darwin" });
  t.after(() => independent.close());
  assert.equal(other.state.activity.revision, 1);
  assert.ok(other.state.activity.revision < entry.state.activity.revision);
});

test("activity snapshots advance independently across collector, config, expiry and mount resets", async (t) => {
  const state = freshState(root, { skipIntro: true });
  openAtlas(state, root);
  let clock = 10000;
  const entry = await startServer("activity-revision", state, {
    activity: { platform: "darwin", now: () => clock },
  });
  t.after(() => entry.close());
  const request = (path, options) => fetch(new URL(path, entry.url), options);
  const bootstrap = async () => (await (await request("/api/bootstrap", { headers: canvasHeaders })).json()).state;
  const initial = await bootstrap();
  assert.ok(Number.isSafeInteger(initial.activity.revision));
  assert.ok(initial.activity.revision > 0);
  const { token } = await (await request("/api/activity/connection", { headers: canvasHeaders })).json();
  const controller = new AbortController();
  t.after(() => controller.abort());
  const response = await request("/events", { headers: canvasHeaders, signal: controller.signal });
  const reader = response.body.getReader();
  const snapshot = JSON.parse(new TextDecoder().decode((await reader.read()).value).match(/^data: (.+)$/m)[1]);
  const post = async (events) => {
    const response = await request("/api/activity/events", {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ status: "live", events }),
    });
    assert.equal(response.status, 200);
  };
  const read = { path: join(root, "index.md"), pid: 123, kind: "read" };
  await post([read]);
  const payload = new TextDecoder().decode((await reader.read()).value);
  assert.match(payload, /^event: activity\n/);
  const activity = JSON.parse(payload.match(/^data: (.+)$/m)[1]);
  assert.ok(activity.revision > snapshot.activity.revision);
  assert.equal(state.stateRevision, snapshot.stateRevision, "collector events do not advance the full-state clock");
  assert.equal(activity.nodes[0].sequence, 1);
  const refreshed = await bootstrap();
  assert.ok(refreshed.activity.revision > activity.revision);
  assert.deepEqual(refreshed.activity.nodes, activity.nodes);
  const config = async (enabled) => {
    const response = await request("/api/activity/config", {
      method: "POST", headers: { ...canvasHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  const paused = await config(false);
  assert.ok(paused.revision > refreshed.activity.revision);
  assert.deepEqual(paused.nodes, []);
  const resumed = await config(true);
  assert.ok(resumed.revision > paused.revision);
  await post([read]);
  const observed = state.activity;
  clock += 5000;
  const expired = entry.activity.sync();
  assert.ok(expired.revision > observed.revision);
  assert.deepEqual(expired.nodes, []);
  assert.equal(observed.nodes.length, 1, "old payloads remain immutable");
  openAtlas(state, "");
  entry.broadcast();
  assert.ok(state.activity.revision > expired.revision);
  const closedRevision = state.activity.revision;
  openAtlas(state, root);
  entry.broadcast();
  assert.ok(state.activity.revision > closedRevision);
  await post([read]);
  assert.equal(state.activity.nodes[0].sequence, 3, "emission revisions do not replace observation sequence");
  controller.abort();
});
