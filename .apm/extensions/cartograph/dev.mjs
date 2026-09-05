import { freshState, openDefaultAtlases, startServer } from "./server.mjs";

const state = freshState(process.cwd(), { skipIntro: true });
openDefaultAtlases(state, { root: process.argv[2], skipIntro: true });
const entry = await startServer("development", state);
console.log(`Cartograph: ${entry.url}`);
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    await entry.close();
    process.exit(0);
  });
}
