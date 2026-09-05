import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createFilesystemWatcher } from "../src/atlas/watch.mjs";
import { createLiveAtlas } from "../src/atlas/live.mjs";

function fixture() {
  const opened = [];
  const events = [];
  const statuses = [];
  let missing = false;
  let inode = 1;
  const watcher = createFilesystemWatcher({
    onChange: (root) => events.push(root),
    onStatus: (status) => statuses.push(status),
    stat: () => {
      if (missing) throw Object.assign(new Error("No such directory"), { code: "ENOENT" });
      return { dev: 1, ino: inode, isDirectory: () => true };
    },
    watchDirectory(path, options, notify) {
      const handle = new EventEmitter();
      handle.closeCount = 0;
      handle.close = () => { handle.closeCount++; };
      opened.push({ path, options, notify, handle });
      return handle;
    },
  });
  return { watcher, opened, events, statuses, missing: (value) => { missing = value; }, replace: () => { inode++; } };
}

test("watcher replacement interface scopes roots, ignores excluded paths, and closes resources", () => {
  const f = fixture();
  f.watcher.setRoots(["/one/atlas", "/two/atlas", "/one/atlas"]);
  assert.equal(f.opened.length, 4);
  assert.equal(f.statuses.at(-1).status, "live");
  assert.ok(f.opened.every((item) => item.options.persistent === false));
  const root = f.opened.find((item) => item.path === "/one/atlas");
  root.notify("change", ".git/file.md");
  root.notify("change", "node_modules/file.md");
  root.notify("rename", "work/.tmp.md");
  assert.deepEqual(f.events, []);
  root.notify("rename", "work/new.md");
  root.notify("change", null);
  assert.deepEqual(f.events, ["/one/atlas", "/one/atlas"]);
  f.watcher.setRoots(["/two/atlas"]);
  assert.equal(root.handle.closeCount, 1);
  root.notify("rename", "late.md");
  assert.equal(f.events.length, 2);
  f.watcher.setRoots([]);
  assert.equal(f.statuses.at(-1).status, "idle");
  assert.ok(f.opened.every((item) => item.handle.closeCount === 1));
  f.watcher.close();
  f.watcher.setRoots(["/ignored"]);
  assert.equal(f.opened.length, 4);
});

test("parent watcher reattaches a replaced root and ignores unrelated sibling changes", () => {
  const f = fixture();
  f.watcher.setRoots(["/parent/atlas"]);
  const parent = f.opened[0];
  const root = f.opened[1];
  parent.notify("rename", "unrelated");
  assert.deepEqual(f.events, []);
  f.missing(true);
  parent.notify("rename", "atlas");
  assert.equal(root.handle.closeCount, 1);
  assert.equal(f.statuses.at(-1).status, "error");
  f.missing(false);
  f.replace();
  parent.notify("rename", "atlas");
  assert.equal(f.opened.length, 3);
  assert.equal(f.statuses.at(-1).status, "live");
  assert.deepEqual(f.events, ["/parent/atlas", "/parent/atlas"]);
  f.watcher.close();
});

test("native watch failures are explicit, not a silently successful polling fallback", () => {
  const statuses = [];
  const watcher = createFilesystemWatcher({
    onChange() {},
    onStatus: (status) => statuses.push(status),
    stat: () => ({ dev: 1, ino: 1, isDirectory: () => true }),
    watchDirectory() { throw new Error("Access denied"); },
  });
  watcher.setRoots(["/atlas"]);
  assert.equal(statuses.at(-1).status, "error");
  assert.match(statuses.at(-1).message, /Access denied/);
  watcher.close();
});

test("runtime errors close failed watcher handles and stop claiming Live", () => {
  const f = fixture();
  f.watcher.setRoots(["/parent/atlas"]);
  f.opened[1].handle.emit("error", new Error("Watcher resource limit"));
  assert.equal(f.opened[1].handle.closeCount, 1);
  assert.equal(f.statuses.at(-1).status, "error");
  assert.match(f.statuses.at(-1).message, /resource limit/);
  f.watcher.close();
});

test("debounce has a maximum wait, suppresses late callbacks and releases the replacement source", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const entry = { state: { cwd: "/", roots: ["/atlas"], graph: { nodes: [] } } };
  let source;
  let scans = 0;
  let closes = 0;
  const watcherFactory = (callbacks) => {
    source = callbacks;
    return { setRoots() {}, close() { closes++; } };
  };
  const live = createLiveAtlas(entry, () => { scans++; return false; }, () => {}, {
    watcherFactory, debounceMs: 100, maxWaitMs: 300,
  });
  live.syncRoots();
  for (let i = 0; i < 6; i++) {
    source.onChange("/atlas");
    t.mock.timers.tick(50);
  }
  assert.equal(scans, 1, "continuous events cannot starve a refresh forever");
  source.onChange("/atlas");
  live.close();
  source.onChange("/atlas");
  t.mock.timers.tick(1000);
  assert.equal(scans, 1);
  assert.equal(closes, 1);
});
