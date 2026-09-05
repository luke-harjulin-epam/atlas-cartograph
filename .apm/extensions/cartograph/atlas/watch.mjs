import { statSync, watch } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { isIgnoredAtlasPath } from "./scan.mjs";

// Replaceable change source: setRoots(absolutePaths), close(), onChange(root), onStatus(status).
// This observes directory changes, not file reads or the process responsible for a change.
export function createFilesystemWatcher({ onChange, onStatus, watchDirectory = watch, stat = statSync }) {
  const roots = new Map();
  let closed = false;
  let lastStatus = "";

  function status() {
    if (closed) return;
    const failures = [...roots.values()].flatMap((entry) => [entry.error, entry.parentError].filter(Boolean));
    const next = {
      status: failures.length ? "error" : roots.size ? "live" : "idle",
      message: failures.length
        ? failures.join(" ")
        : roots.size
          ? "Watching open Atlas folders for changes from any application. No elevated permissions required."
          : "Open an Atlas to watch file changes.",
    };
    const key = JSON.stringify(next);
    if (key !== lastStatus) { lastStatus = key; onStatus(next); }
  }

  const current = (entry) => !closed && roots.get(entry.root) === entry;
  function attach(entry) {
    if (!current(entry)) return;
    try {
      const info = stat(entry.root);
      if (!info.isDirectory()) throw new Error("Atlas root is not a directory.");
      const identity = `${info.dev}:${info.ino}`;
      if (entry.watcher && entry.identity === identity) return;
      entry.watcher?.close();
      entry.watcher = null;
      const watcher = watchDirectory(entry.root, { recursive: true, persistent: false }, (_event, filename) => {
        if (!current(entry)) return;
        if (filename && isIgnoredAtlasPath(String(filename))) return;
        attach(entry);
        onChange(entry.root);
      });
      entry.watcher = watcher;
      entry.identity = identity;
      entry.error = "";
      watcher.on("error", (error) => {
        if (!current(entry) || entry.watcher !== watcher) return;
        watcher.close();
        entry.watcher = null;
        entry.error = `Cannot watch ${entry.root}: ${error.message}`;
        status();
        onChange(entry.root);
      });
    } catch (error) {
      entry.watcher?.close();
      entry.watcher = null;
      entry.error = `Cannot watch ${entry.root}: ${error.message}`;
    }
    status();
  }

  function add(root) {
    const entry = { root, watcher: null, parent: null, identity: "", error: "", parentError: "" };
    roots.set(root, entry);
    const parent = dirname(root);
    if (parent !== root) {
      try {
        // A root's inode can disappear on rename/delete. Its parent lets us reattach on recreation.
        entry.parent = watchDirectory(parent, { persistent: false }, (_event, filename) => {
          if (!current(entry) || (filename && String(filename) !== basename(root))) return;
          attach(entry);
          onChange(root);
        });
        entry.parent.on("error", (error) => {
          if (!current(entry)) return;
          entry.parent.close();
          entry.parent = null;
          entry.parentError = `Cannot monitor recreation of ${root}: ${error.message}`;
          status();
        });
      } catch (error) {
        entry.parentError = `Cannot monitor recreation of ${root}: ${error.message}`;
      }
    }
    attach(entry);
  }

  return {
    setRoots(paths) {
      if (closed) return;
      const wanted = new Set(paths.map((path) => resolve(path)));
      for (const [root, entry] of roots) {
        if (wanted.has(root)) continue;
        roots.delete(root);
        entry.watcher?.close();
        entry.parent?.close();
      }
      for (const root of wanted) if (!roots.has(root)) add(root);
      status();
    },
    close() {
      closed = true;
      for (const entry of roots.values()) { entry.watcher?.close(); entry.parent?.close(); }
      roots.clear();
    },
  };
}
