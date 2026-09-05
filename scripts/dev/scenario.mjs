import assert from "node:assert/strict";
import { constants } from "node:fs";
import { lstat, open, readFile, readdir, realpath, unlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";
import { eventInProcessScope } from "../../.apm/extensions/cartograph/activity/process-scope.mjs";

export const workspace = fileURLToPath(new URL("../../", import.meta.url));
export const groups = ["work", "experiences", "decisions", "knowledge"];
export const readIds = Array.from({ length: 500 }, (_, i) =>
  `${groups[Math.floor(i / 125)]}/read-${String(i).padStart(3, "0")}`);
export const fixtures = {
  "mini-atlas": { atlasId: "cartograph-mini", nodes: 5, edges: 11 },
  "stress-test-atlas": { atlasId: "cartograph-stress-test", nodes: 505, edges: 1508 },
};
export const syntheticProviderId = "development-synthetic";

export function endpoint(value) {
  const url = new URL(value);
  assert.ok(url.protocol === "http:" && url.hostname === "127.0.0.1" && url.port &&
    !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash,
  "Use the exact http://127.0.0.1:<port>/ canvas URL, without credentials, query or path.");
  return url;
}

export function argumentsFor(argv, { fixture, server = false, stress = false } = {}) {
  const { values } = parseArgs({
    args: argv, strict: true, allowPositionals: false,
    options: {
      help: { type: "boolean" }, "dry-run": { type: "boolean" },
      run: { type: "boolean" }, check: { type: "boolean" },
      ...(server ? { fixture: { type: "string", default: fixture } } : { url: { type: "string" } }),
      ...(stress ? { "max-rate": { type: "string", default: "25" } } : {}),
    },
  });
  if (values.help) return { help: true };
  assert.ok(["dry-run", "run", "check"].filter((key) => values[key]).length <= 1,
    "Choose only one of --dry-run, --check or --run.");
  const action = values.run ? "run" : values.check ? "check" : "dry-run";
  assert.ok(!server || action !== "check", "The server supports --dry-run or --run.");
  const name = server ? values.fixture : fixture;
  assert.ok(Object.hasOwn(fixtures, name), "Unknown tracked fixture.");
  const url = values.url ? endpoint(values.url) : undefined;
  assert.ok(server || action === "dry-run" || url, "--check and --run require --url.");
  const maxRate = stress ? Number(values["max-rate"]) : undefined;
  assert.ok(!stress || (Number.isInteger(maxRate) && maxRate >= 1 && maxRate <= 2000),
    "--max-rate must be an integer from 1 to 2000.");
  return { action, fixture: name, url, maxRate };
}

export function help(name, { fixture, server = false, stress = false } = {}) {
  console.log(`Usage: node scripts/dev/${name}.mjs [--dry-run | ${server ? "" : "--check | "}--run] ${
    server ? "[--fixture mini-atlas|stress-test-atlas]" : "[--url http://127.0.0.1:<port>/]"
  }${stress ? " [--max-rate 1..2000]" : ""}
Default: offline --dry-run. Fixture: .atlas/local/${fixture}.
${server ? "Explicit --run starts a synthetic-only localhost viewer on an ephemeral port; no collector."
    : "Only --run produces activity or temporary files; --check validates the matching mounted fixture."}
No baseline pages are overwritten. Ctrl-C/SIGTERM cleans up owned temporary files.
${stress ? "Default ceiling: 25 reads/s; --max-rate 2000 opts into all six bounded stages." : ""}`);
}

async function plainTree(path, files = []) {
  const stat = await lstat(path);
  assert.ok(!stat.isSymbolicLink(), "Fixture symlinks are not allowed.");
  if (stat.isDirectory()) {
    for (const child of await readdir(path)) await plainTree(join(path, child), files);
  } else {
    assert.ok(stat.isFile() && stat.nlink === 1, "Fixture must contain ordinary, non-hardlinked files.");
    files.push(path);
  }
  return files;
}

export async function fixtureFor(name, cwd = workspace) {
  assert.ok(Object.hasOwn(fixtures, name), "Unknown tracked fixture.");
  const project = await realpath(cwd);
  const root = join(project, ".atlas", "local", name);
  for (const path of [join(project, ".atlas"), join(project, ".atlas", "local"), root]) {
    assert.ok((await lstat(path)).isDirectory(), "Expected a tracked .atlas/local fixture directory, not a symlink.");
  }
  const files = await plainTree(root);
  const schema = JSON.parse(await readFile(join(root, "SCHEMA.json"), "utf8"));
  assert.equal(schema.atlas_id, fixtures[name].atlasId, "Unexpected fixture schema.");
  const ids = name === "mini-atlas"
    ? ["index", "experiences/canvas-port", "decisions/copilot-canvas", "knowledge/atlas-pages", "work/migrate-cartograph"]
    : ["index", ...groups.map((group) => `${group}/index`), ...readIds];
  assert.deepEqual(files.filter((path) => path.endsWith(".md")).map((path) => relative(root, path).replaceAll("\\", "/")).sort(),
    ids.map((id) => `${id}.md`).sort(), "Unexpected fixture pages; restore the tracked baseline first.");
  return { name, root, project, ids, expected: fixtures[name] };
}

export function graphIdentity(graph) {
  return {
    nodes: graph.nodes.map((node) => [node.id, node.path]).sort(),
    edges: graph.edges.map((edge) => [edge.id, edge.source, edge.target]).sort(),
  };
}

export function checkState(state, fixture, { collector = false, synthetic = false } = {}) {
  assert.deepEqual(state.roots, [fixture.root], "Mount ONLY this project's matching .atlas/local fixture.");
  assert.equal(state.phase, "map", "Wait for the map to open.");
  assert.equal(state.graphWatch?.status, "live", "The filesystem watcher must be live.");
  assert.equal(state.query, "", "Clear graph search.");
  assert.ok(Object.values(state.layers).every(Boolean), "Enable every graph layer.");
  if (collector || synthetic) {
    assert.equal(state.activity?.enabled, true, "Enable activity monitoring before running.");
    if (synthetic) {
      assert.equal(state.activity.provider?.id, syntheticProviderId,
        "Synthetic events are allowed ONLY on scripts/dev/adaptive-preview-server.mjs.");
      assert.equal(state.activity.scope?.mode, "all");
    } else {
      assert.equal(state.activity.scope?.mode, "session", "Use the current Copilot session's collector; never host-wide scope.");
      assert.ok(["waiting", "live"].includes(state.activity.collector?.status),
        "Start the current canvas collector manually; this runner never starts or elevates it.");
    }
  }
}

export async function request(url, path, { body, token, signal } = {}) {
  const response = await fetch(new URL(path, url), {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "X-Cartograph-Client": "canvas",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000),
    redirect: "error",
  });
  assert.ok(response.ok, `${path}: HTTP ${response.status}`);
  return response.json();
}

export async function preflight(url, fixture, options = {}) {
  let expectedScope;
  const snapshot = async () => {
    assert.equal(await realpath(fixture.root), fixture.root, "Fixture root moved.");
    const { state } = await request(url, "/api/bootstrap", { signal: options.signal });
    checkState(state, fixture, options);
    if (expectedScope) assert.deepEqual(state.activity.scope, expectedScope, "Canvas activity scope changed; stopping.");
    return state;
  };
  const initial = await snapshot();
  if (options.collector || options.synthetic) expectedScope = structuredClone(initial.activity.scope);
  assert.equal(initial.graph.store.atlasId, fixture.expected.atlasId, "Unexpected mounted Atlas identity.");
  assert.equal(initial.graph.edges.length, fixture.expected.edges, "Unexpected fixture relationships.");
  assert.deepEqual(initial.graph.nodes.map((node) => [node.id, node.path]).sort(),
    fixture.ids.map((id) => [id, `${id}.md`]).sort(), "Canvas graph must match the fixture baseline.");
  if (options.collector) {
    const ancestors = [];
    let pid = process.pid;
    const exec = promisify(execFile);
    for (let i = 0; i < 64 && pid > 1; i++) {
      const { stdout } = await exec("ps", ["-o", "ppid=", "-p", String(pid)], { timeout: 2000 });
      pid = Number(stdout.trim());
      if (!Number.isSafeInteger(pid) || pid <= 0 || ancestors.includes(pid)) break;
      ancestors.push(pid);
    }
    assert.ok(eventInProcessScope({ pid: process.pid, ancestors }, initial.activity.scope),
      "Run from the SAME Copilot CLI session as the canvas; this process is outside its scope.");
  }
  return { initial, snapshot };
}

export async function until(snapshot, predicate, message, signal) {
  const end = performance.now() + 7000;
  while (performance.now() < end) {
    signal?.throwIfAborted();
    const state = await snapshot();
    if (predicate(state)) return state;
    await delay(75, undefined, { signal });
  }
  throw new Error(message);
}

export function cancellation() {
  const controller = new AbortController();
  const stop = () => controller.abort(new Error("Interrupted; cleaning up owned demo files."));
  for (const name of ["SIGINT", "SIGTERM"]) process.once(name, stop);
  return {
    signal: controller.signal,
    dispose() { for (const name of ["SIGINT", "SIGTERM"]) process.removeListener(name, stop); },
  };
}

export class OwnedFiles {
  constructor(fixture) { this.root = fixture.root; this.files = new Map(); }
  async path(id) {
    assert.match(id, /^(work|knowledge)\/cartograph-[a-z0-9-]+$/);
    const path = join(this.root, `${id}.md`);
    assert.equal(await realpath(this.root), this.root, "Fixture root moved.");
    assert.equal(await realpath(dirname(path)), dirname(path), "Demo directory must not be a symlink.");
    return path;
  }
  async create(id, content) {
    const path = await this.path(id);
    const handle = await open(path, "wx+");
    const record = { path, stat: await handle.stat(), content: "" };
    this.files.set(id, record);
    try {
      await handle.writeFile(content);
      record.content = content;
    } finally { await handle.close(); }
  }
  async checked(id) {
    const record = this.files.get(id);
    assert.ok(record, "Only owned temporary files may be changed.");
    const path = await this.path(id);
    const handle = await open(path, constants.O_RDWR | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      assert.ok(stat.ino === record.stat.ino && stat.dev === record.stat.dev && stat.nlink === 1,
        "Owned demo file was replaced; refusing to change it.");
      assert.equal(await handle.readFile("utf8"), record.content, "Demo file changed externally; leaving it untouched.");
      return { handle, record };
    } catch (error) { await handle.close(); throw error; }
  }
  async update(id, content) {
    const { handle, record } = await this.checked(id);
    try {
      await handle.truncate(0);
      await handle.write(content, 0, "utf8");
      record.content = content;
    } finally { await handle.close(); }
  }
  async remove(id) {
    const { handle, record } = await this.checked(id);
    try { await unlink(record.path); this.files.delete(id); } finally { await handle.close(); }
  }
  async close() {
    const results = await Promise.allSettled([...this.files.keys()].map((id) => this.remove(id)));
    const errors = results.filter((result) => result.status === "rejected").map((result) => result.reason);
    if (errors.length) throw new AggregateError(errors, "Some demo files changed externally or could not be cleaned up.");
  }
}

export function page(title, links) {
  return `---\ntype: work\ntitle: ${title}\nrelates_to:\n` +
    links.map((path) => `  - path: ${path}\n    kind: related\n`).join("") +
    "---\n\nTemporary development scenario page; removed by its owning runner.\n";
}

export function isMain(url) {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(url);
}

export function reportError(error) {
  console.error(error.message);
  process.exitCode = 1;
}
