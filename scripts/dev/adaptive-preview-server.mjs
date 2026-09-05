import { freshState, openAtlas, startServer } from "../../.apm/extensions/cartograph/server.mjs";
import { createMonitorRegistry } from "../../.apm/extensions/cartograph/activity/providers/index.mjs";
import {
  argumentsFor, cancellation, fixtureFor, help, isMain, preflight, reportError, syntheticProviderId,
} from "./scenario.mjs";

const message = "Synthetic development observations only. No OS collector or real read coverage.";
const provider = {
  metadata: {
    id: syntheticProviderId, label: "Synthetic development demo", description: message,
    permissions: [], operations: ["read"], processScopes: ["all"],
    setup: {
      title: "Development exercise", description: message,
      steps: ["Run scripts/dev/adaptive-preview-exercise.mjs --run --url <this viewer URL>."],
      notice: "Only tracked .atlas/local fixtures are supported; never use a real collector with this demo.",
    },
  },
  availability: () => ({ supported: true, message }),
  waitingMessage: message,
  createConnection: () => ({ command: null }),
};

export async function startPreview(fixture) {
  const state = freshState(fixture.project, { skipIntro: true });
  openAtlas(state, fixture.root);
  state.phase = "map";
  const registry = createMonitorRegistry([provider], syntheticProviderId);
  return startServer("development-synthetic-preview", state, { activity: { registry, scope: { mode: "all" } } });
}

export async function main(argv) {
  const config = { fixture: "stress-test-atlas", server: true };
  const args = argumentsFor(argv, config);
  if (args.help) return help("adaptive-preview-server", config);
  const fixture = await fixtureFor(args.fixture);
  if (args.action === "dry-run") {
    console.log(JSON.stringify({
      fixture: `.atlas/local/${args.fixture}`, serverStarted: false,
      binding: "127.0.0.1", port: "ephemeral", provider: syntheticProviderId,
      generatedOrDeletedFixtures: false,
    }, null, 2));
    return;
  }
  const scope = cancellation();
  let entry;
  try {
    entry = await startPreview(fixture);
    await preflight(entry.url, fixture, { synthetic: true, signal: scope.signal });
    console.log(`Synthetic-only Cartograph preview: ${entry.url}`);
    console.log(`Fixture: .atlas/local/${args.fixture}. No OS collector is started or needed.`);
    if (!scope.signal.aborted) {
      await new Promise((resolve) => scope.signal.addEventListener("abort", resolve, { once: true }));
    }
  } finally {
    try { if (entry) await entry.close(); } finally { scope.dispose(); }
  }
}

if (isMain(import.meta.url)) main(process.argv.slice(2)).catch(reportError);
