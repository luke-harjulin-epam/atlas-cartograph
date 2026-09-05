export const GRAPH_WATCH_HELP = "Open Atlas directories sync creations, edits, and deletions from any app without extra permissions. This watcher is independent of the read collector and its adaptive visual path. New nodes and relationships glow green and fade to their default colour over 2000 ms; deleted nodes and relationships glow red and fade out over 2000 ms.";

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
