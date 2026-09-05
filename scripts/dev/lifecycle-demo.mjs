import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  argumentsFor, cancellation, fixtureFor, graphIdentity, help, isMain, OwnedFiles,
  page, preflight, reportError, until,
} from "./scenario.mjs";

export async function lifecycle(argv, { mixed = false } = {}) {
  const name = mixed ? "mixed-activity-demo" : "lifecycle-demo";
  const config = { fixture: "mini-atlas" };
  const args = argumentsFor(argv, config);
  if (args.help) return help(name, config);
  const fixture = await fixtureFor(args.fixture);
  if (args.action === "dry-run") {
    console.log(JSON.stringify({
      scenario: name, fixture: `.atlas/local/${args.fixture}`, workloadStarted: false,
      steps: ["create owned page", "add relationship", "remove relationship", "delete owned page"],
      realReads: mixed, stepSpacingMs: 6000, changesMonitoringSettings: false,
    }, null, 2));
    return;
  }
  const cancellationScope = cancellation();
  const { signal } = cancellationScope;
  const owned = new OwnedFiles(fixture);
  try {
    const { initial, snapshot } = await preflight(args.url, fixture, { collector: mixed, signal });
    if (args.action === "check") {
      console.log("Preflight passed; no demo files or workload started.");
      return;
    }
    const id = `work/cartograph-${mixed ? "mixed" : "lifecycle"}-${process.pid}`;
    const experience = "experiences/canvas-port";
    let reads = 0;
    async function readPath(ids) {
      for (const target of ids) {
        await snapshot();
        const readAt = Date.now();
        await readFile(join(fixture.root, `${target}.md`));
        await until(snapshot, (state) => state.activity.collector.status === "live" &&
          state.activity.nodes.some((node) => node.id === target && node.accessedAt >= readAt - 10 &&
            ["read", "read-write", "open"].includes(node.kind)),
        `Collector did not observe the real session-scoped read of ${target}; stopping.`, signal);
        reads++;
        await delay(80, undefined, { signal });
      }
    }
    if (mixed) await readPath([experience, "decisions/copilot-canvas", "work/migrate-cartograph"]);
    for (let step = 1; step <= 4; step++) {
      if (step > 1) await delay(6000, undefined, { signal });
      await snapshot();
      signal.throwIfAborted();
      if (step === 1) await owned.create(id, page("Lifecycle demo", ["index"]));
      else if (step === 4) await owned.remove(id);
      else await owned.update(id, page("Lifecycle demo", ["index", ...(step === 2 ? [experience] : [])]));
      const targets = step === 4 ? [] : step === 2 ? ["index", experience] : ["index"];
      const state = await until(snapshot, (state) =>
        state.graph.nodes.some((node) => node.id === id) === (step !== 4) &&
        state.graph.edges.filter((edge) => edge.source === id).length === targets.length &&
        targets.every((target) => state.graph.edges.some((edge) => edge.source === id && edge.target === target)),
      `Filesystem watcher did not deliver lifecycle step ${step}.`, signal);
      assert.equal(state.graphChanges.origin, "filesystem");
      assert.equal(state.graphChanges.created.some((node) => node.id === id), step === 1);
      assert.equal(state.graphChanges.deleted.some((node) => node.id === id), step === 4);
      assert.deepEqual(state.graphChanges.createdEdges.map((edge) => edge.target).sort(),
        step === 1 ? ["index"] : step === 2 ? [experience] : []);
      assert.deepEqual(state.graphChanges.deletedEdges.map((edge) => edge.target).sort(),
        step === 3 ? [experience] : step === 4 ? ["index"] : []);
      console.log(`${step}/4: ${["Created node", "Added relationship", "Removed relationship", "Deleted node"][step - 1]}`);
      if (mixed && step !== 4) await readPath(step === 2 ? ["index", id, experience] : ["index", id]);
    }
    await delay(mixed ? initial.activity.durationMs + 250 : 2200, undefined, { signal });
    const final = await snapshot();
    assert.deepEqual(graphIdentity(final.graph), graphIdentity(initial.graph));
    if (mixed) assert.equal(final.activity.nodes.length, 0);
    console.log(`Complete; baseline restored; ${reads} real reads observed; monitoring settings unchanged.`);
  } finally {
    try { await owned.close(); } finally { cancellationScope.dispose(); }
  }
}

if (isMain(import.meta.url)) lifecycle(process.argv.slice(2)).catch(reportError);
