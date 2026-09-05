import assert from "node:assert/strict";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  argumentsFor, cancellation, endpoint, fixtureFor, graphIdentity, help, isMain,
  OwnedFiles, page, preflight, readIds, reportError, request, syntheticProviderId, until,
} from "./scenario.mjs";

export async function main(argv) {
  const config = { fixture: "stress-test-atlas" };
  const args = argumentsFor(argv, config);
  if (args.help) return help("adaptive-preview-exercise", config);
  const fixture = await fixtureFor(args.fixture);
  if (args.action === "dry-run") {
    console.log(JSON.stringify({
      fixture: `.atlas/local/${args.fixture}`, workloadStarted: false,
      syntheticObservations: 300, maxBatch: 100, ownedTemporaryPages: 1,
      requiredServer: "scripts/dev/adaptive-preview-server.mjs --run", baselinePagesDeleted: 0,
    }, null, 2));
    return;
  }
  const scope = cancellation();
  const { signal } = scope;
  const owned = new OwnedFiles(fixture);
  try {
    const { initial, snapshot } = await preflight(args.url, fixture, { synthetic: true, signal });
    assert.equal(initial.activity.nodes.length, 0, "Wait for previous activity to expire before exercising.");
    if (args.action === "check") {
      console.log("Synthetic-only fixture scope verified; no events or file changes sent.");
      return;
    }
    const connection = await request(args.url, "/api/activity/connection", { signal });
    assert.equal(endpoint(connection.endpoint).href, args.url.href);
    assert.equal(connection.providerId, syntheticProviderId);
    assert.equal(connection.command, null, "Refusing an OS collector connection.");
    assert.deepEqual(connection.scope, initial.activity.scope);
    assert.ok(typeof connection.token === "string" && connection.token.length > 0);
    assert.ok(!connection.scope.excludePids.includes(process.pid), "Exercise must run in a separate process from the viewer.");
    async function send(ids) {
      await snapshot();
      const result = await request(args.url, "/api/activity/events", {
        token: connection.token, signal,
        body: {
          events: ids.map((id) => ({ path: join(fixture.root, `${id}.md`), pid: process.pid, kind: "read" })),
          status: "live", message: "Synthetic development observations; no real OS reads are being claimed.",
        },
      });
      assert.equal(result.accepted, ids.length);
    }
    const extra = `work/cartograph-adaptive-${process.pid}`;
    await send(readIds.slice(0, 100));
    await delay(400, undefined, { signal });
    await snapshot();
    await owned.create(extra, page("Created during synthetic backlog", ["index"]));
    await until(snapshot, (state) => state.graph.nodes.some((node) => node.id === extra),
      "Watcher did not publish the owned demo page.", signal);
    await send(Array(100).fill(readIds[99]));
    await delay(150, undefined, { signal });
    await send(Array(100).fill(readIds[99]));
    await delay(2000, undefined, { signal });
    await snapshot();
    await owned.remove(extra);
    await until(snapshot, (state) => !state.graph.nodes.some((node) => node.id === extra),
      "Watcher did not remove the owned demo page.", signal);
    await delay(Math.max(11500, initial.activity.durationMs + 250), undefined, { signal });
    const final = await snapshot();
    assert.deepEqual(graphIdentity(final.graph), graphIdentity(initial.graph));
    assert.equal(final.activity.nodes.length, 0);
    console.log("Complete: 300 synthetic observations; owned page created/deleted; tracked baseline unchanged.");
  } finally {
    try { await owned.close(); } finally { scope.dispose(); }
  }
}

if (isMain(import.meta.url)) main(process.argv.slice(2)).catch(reportError);
