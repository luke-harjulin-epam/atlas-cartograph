import { resolve } from "node:path";
import { createFilesystemWatcher } from "./watch.mjs";

export const GRAPH_CHANGE_DURATION_MS = 2000;
export const graphFileKey = (node) => resolve(node.storeRoot, node.path);

function relationships(graph) {
  const nodes = new Map((graph?.nodes ?? []).map((node) => [node.id, graphFileKey(node)]));
  return new Map((graph?.edges ?? [])
    .filter((edge) => nodes.has(edge.source) && nodes.has(edge.target))
    .map((edge) => [
      JSON.stringify([nodes.get(edge.source), nodes.get(edge.target), edge.kind, edge.relKind ?? ""]),
      edge,
    ]));
}

export function graphChanges(previous, next, revision, occurredAt) {
  const before = new Set((previous?.nodes ?? []).map(graphFileKey));
  const after = new Set((next?.nodes ?? []).map(graphFileKey));
  const previousEdges = relationships(previous);
  const nextEdges = relationships(next);
  return {
    revision, origin: "filesystem", occurredAt, durationMs: GRAPH_CHANGE_DURATION_MS,
    created: (next?.nodes ?? []).filter((node) => !before.has(graphFileKey(node))),
    deleted: (previous?.nodes ?? []).filter((node) => !after.has(graphFileKey(node))),
    createdEdges: [...nextEdges].filter(([key]) => !previousEdges.has(key)).map(([, edge]) => edge),
    deletedEdges: [...previousEdges].filter(([key]) => !nextEdges.has(key)).map(([, edge]) => edge),
  };
}

export function mountGraphChanges(previous) {
  return {
    revision: (previous?.revision ?? 0) + 1, origin: "mount", occurredAt: Date.now(),
    durationMs: GRAPH_CHANGE_DURATION_MS, created: [], deleted: [], createdEdges: [], deletedEdges: [],
  };
}

export function createLiveAtlas(entry, refresh, publish, {
  watcherFactory = createFilesystemWatcher,
  debounceMs = 150,
  maxWaitMs = 1000,
  now = Date.now,
} = {}) {
  let closed = false;
  let pending = null;
  let deadline = null;
  let rootKey = "";
  let watchedRoots = new Set();
  let sourceStatus = { status: "idle", message: "Open an Atlas to watch file changes." };
  let refreshError = "";
  let notificationPending = false;

  function updateStatus() {
    const next = refreshError ? { status: "error", message: refreshError } : sourceStatus;
    if (JSON.stringify(entry.state.graphWatch) === JSON.stringify(next)) return;
    entry.state.graphWatch = next;
    if (notificationPending) return;
    notificationPending = true;
    queueMicrotask(() => {
      notificationPending = false;
      if (!closed) publish();
    });
  }

  function cancel() {
    clearTimeout(pending);
    clearTimeout(deadline);
    pending = deadline = null;
  }

  function flush() {
    cancel();
    if (closed) return;
    const before = entry.state.graph;
    let changed;
    try {
      changed = refresh(entry.state);
    } catch (error) {
      // An incomplete scan is not evidence that the missing nodes were deleted.
      refreshError = `Atlas refresh failed; keeping the last graph: ${error.message}`;
      updateStatus();
      return;
    }
    refreshError = "";
    updateStatus();
    if (changed) {
      entry.state.graphChanges = graphChanges(before, entry.state.graph,
        (entry.state.graphChanges?.revision ?? 0) + 1, now());
      publish();
    }
  }

  function schedule() {
    clearTimeout(pending);
    pending = setTimeout(flush, debounceMs);
    pending.unref?.();
    if (!deadline) { deadline = setTimeout(flush, maxWaitMs); deadline.unref?.(); }
  }

  const watcher = watcherFactory({
    onChange(root) {
      if (closed || !watchedRoots.has(resolve(root))) return;
      schedule();
    },
    onStatus(status) {
      if (closed) return;
      sourceStatus = status;
      updateStatus();
    },
  });

  return {
    syncRoots() {
      if (closed) return;
      const roots = [...new Set((entry.state.roots ?? []).map((root) => resolve(entry.state.cwd || ".", root)))];
      const key = JSON.stringify(roots);
      if (key === rootKey) return;
      rootKey = key;
      watchedRoots = new Set(roots);
      cancel();
      refreshError = "";
      watcher.setRoots(roots);
      updateStatus();
      // Reconcile once after subscribing to cover changes between the initial load and attachment.
      if (roots.length) schedule();
    },
    close() {
      if (closed) return;
      closed = true;
      cancel();
      watcher.close();
    },
  };
}
