import { GRAPH_LIFECYCLE_DURATION_MS, GRAPH_BIRTH_GLOW_DURATION_MS } from "./graph-lifecycle.js";

export const GRAPH_WATCH_HELP = `Open Atlas directories sync creations, edits, and deletions from any app without extra permissions. This watcher is independent of the read collector and its adaptive visual path. New nodes fade in over ${GRAPH_LIFECYCLE_DURATION_MS} ms; their green glow fades over ${GRAPH_BIRTH_GLOW_DURATION_MS / 1000} seconds total from creation. New relationships glow green for ${GRAPH_LIFECYCLE_DURATION_MS} ms; deleted nodes and relationships glow red and fade out over ${GRAPH_LIFECYCLE_DURATION_MS} ms.`;

export function graphWatchStatus(watch, connected = true) {
  if (!connected) return { status: "disconnected", label: "Changes disconnected", message: "Canvas connection lost. Reconnecting…" };
  const status = ["live", "idle", "error"].includes(watch?.status) ? watch.status : "idle";
  const defaults = {
    live: "Watching open Atlas directories.",
    idle: "Open an Atlas to watch filesystem changes.",
    error: "Filesystem watching is unavailable. Reopen the Atlas to retry.",
  };
  return {
    status, label: `Changes ${status}`,
    message: typeof watch?.message === "string" && watch.message ? watch.message : defaults[status],
  };
}

export function mountGraphWatchControls(root) {
  const statusElement = root.querySelector("#graph-watch-status");
  const message = root.querySelector("#graph-watch-message");
  root.querySelector("#graph-watch-help").textContent = GRAPH_WATCH_HELP;
  let watch;
  let connected = true;
  const render = () => {
    const current = graphWatchStatus(watch, connected);
    statusElement.dataset.status = current.status;
    statusElement.textContent = current.label;
    message.textContent = current.message;
  };
  render();
  return {
    setWatch(next) { watch = next; render(); },
    setConnected(next) { connected = next; render(); },
  };
}
