import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  argumentsFor, cancellation, fixtureFor, graphIdentity, help, isMain, OwnedFiles,
  page, preflight, readIds, reportError, until,
} from "./scenario.mjs";

export const stages = [
  { name: "Simple", rate: 1, seconds: 24, births: 1 },
  { name: "Light", rate: 5, seconds: 12, births: 2 },
  { name: "Busy", rate: 25, seconds: 12, births: 5 },
  { name: "Heavy", rate: 100, seconds: 12, births: 10 },
  { name: "Very heavy", rate: 500, seconds: 12, births: 25 },
  { name: "Extreme", rate: 2000, seconds: 12, births: 50 },
];

export function selectedStages(maxRate) {
  return stages.filter((stage) => stage.rate <= maxRate);
}

export async function main(argv) {
  const config = { fixture: "stress-test-atlas", stress: true };
  const args = argumentsFor(argv, config);
  if (args.help) return help("stress-scenario", config);
  const fixture = await fixtureFor(args.fixture);
  const plan = selectedStages(args.maxRate);
  if (args.action === "dry-run") {
    console.log(JSON.stringify({
      fixture: `.atlas/local/${args.fixture}`, stages: plan, workloadStarted: false,
      maxReads: 1 + plan.reduce((total, stage) => total + stage.rate * stage.seconds, 0),
      pauseSeconds: 6, recoverySeconds: 45, maxConcurrentReads: 100,
    }, null, 2));
    return;
  }
  const cancellationScope = cancellation();
  const { signal } = cancellationScope;
  const owned = new OwnedFiles(fixture);
  let totalReads = 0;
  let cursor = 0;
  try {
    const { initial, snapshot } = await preflight(args.url, fixture, { collector: true, signal });
    if (args.action === "check") {
      console.log("Preflight passed; no probe, load or temporary files started.");
      return;
    }
    const probeAt = Date.now();
    await readFile(join(fixture.root, "index.md"));
    totalReads++;
    await until(snapshot, (state) => state.activity.collector.status === "live" &&
      state.activity.nodes.some((node) => node.id === "index" && node.accessedAt >= probeAt - 10),
    "No real session-scoped probe read observed; no stress load started.", signal);
    for (const [number, stage] of plan.entries()) {
      const ids = Array.from({ length: stage.births }, (_, i) => `work/cartograph-stress-${process.pid}-${number}-${i}`);
      const began = performance.now();
      const before = totalReads;
      let mutation = 0;
      let nextHealth = began;
      console.log(`${number + 1}/${plan.length}: ${stage.name}, target ${stage.rate} real reads/s.`);
      for (let tick = 0; tick < stage.seconds * 10; tick++) {
        await delay(Math.max(0, began + tick * 100 - performance.now()), undefined, { signal });
        const elapsed = performance.now() - began;
        if (elapsed >= stage.seconds * 1000) break;
        tick = Math.max(tick, Math.floor(elapsed / 100));
        while (mutation < 4 && elapsed >= mutation * stage.seconds * 250) {
          await snapshot();
          for (const id of ids) {
            signal.throwIfAborted();
            const content = page("Stress scenario", ["index", readIds[0], ...(mutation === 1 ? [readIds[125]] : [])]);
            if (mutation === 0) await owned.create(id, content);
            else if (mutation === 3) await owned.remove(id);
            else await owned.update(id, content);
          }
          await until(snapshot, (state) => ids.every((id) =>
            state.graph.nodes.some((node) => node.id === id) === (mutation !== 3) &&
            state.graph.edges.filter((edge) => edge.source === id).length === (mutation === 3 ? 0 : mutation === 1 ? 3 : 2)),
          "Filesystem watcher missed a stress lifecycle step.", signal);
          mutation++;
        }
        if (performance.now() >= nextHealth) {
          const state = await snapshot();
          assert.equal(state.activity.collector.status, "live", "Collector stopped; aborting load.");
          nextHealth = performance.now() + 2000;
        }
        // Bound each tick instead of accumulating catch-up work on a slow host.
        const budget = Math.floor((tick + 1) * stage.rate / 10) - Math.floor(tick * stage.rate / 10);
        for (let offset = 0; offset < budget; offset += 100) {
          signal.throwIfAborted();
          const targets = Array.from({ length: Math.min(100, budget - offset) }, () => {
            const pool = stage.rate === 2000 && tick < 80 ? 20 : readIds.length;
            return readIds[cursor++ % pool];
          });
          await Promise.all(targets.map((id) => readFile(join(fixture.root, `${id}.md`))));
          totalReads += targets.length;
        }
        tick = Math.max(tick, Math.floor((performance.now() - began) / 100));
      }
      assert.equal(mutation, 4, "Host fell behind lifecycle schedule; stopping instead of silently skipping steps.");
      console.log(`${stage.name}: ${totalReads - before} real reads; offered load is not guaranteed collector throughput.`);
      if (number < plan.length - 1) await delay(6000, undefined, { signal });
    }
    console.log("Recovery: 45 seconds with no new workload.");
    for (let i = 0; i < 9; i++) {
      await delay(5000, undefined, { signal });
      const state = await snapshot();
      assert.equal(state.activity.collector.status, "live", "Collector stopped during recovery.");
    }
    const final = await snapshot();
    assert.deepEqual(graphIdentity(final.graph), graphIdentity(initial.graph));
    assert.equal(final.activity.nodes.length, 0);
    console.log(`Complete: ${totalReads} real reads; baseline restored. Capture loss remains unknown.`);
  } finally {
    try { await owned.close(); } finally { cancellationScope.dispose(); }
  }
}

if (isMain(import.meta.url)) main(process.argv.slice(2)).catch(reportError);
