import { freshState, hydrateStores, openAtlas, startServer } from "./server.mjs";

const state = freshState(process.cwd(), { skipIntro: true });
hydrateStores(state);
if (process.argv[2]) {
  openAtlas(state, process.argv[2]);
  state.phase = state.graph?.store?.available ? "map" : "welcome";
}
const entry = await startServer("development", state);
console.log(`Cartograph: ${entry.url}`);
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    await entry.close();
    process.exit(0);
  });
}
