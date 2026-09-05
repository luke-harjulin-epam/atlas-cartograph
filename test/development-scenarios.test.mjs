import assert from "node:assert/strict";
import { createServer } from "node:http";
import { cp, link, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile, spawn } from "node:child_process";
import test from "node:test";
import {
  argumentsFor, checkState, endpoint, fixtureFor, graphIdentity, OwnedFiles, page,
  preflight, request, syntheticProviderId, until, workspace,
} from "../scripts/dev/scenario.mjs";
import { startPreview } from "../scripts/dev/adaptive-preview-server.mjs";
import { selectedStages } from "../scripts/dev/stress-scenario.mjs";

const exec = promisify(execFile);
const scripts = ["lifecycle-demo", "mixed-activity-demo", "stress-scenario", "adaptive-preview-server", "adaptive-preview-exercise"];

async function isolatedFixture(t) {
  const cwd = await mkdtemp(join(workspace, "test", ".development-scenario-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const root = join(cwd, ".atlas", "local", "mini-atlas");
  await mkdir(join(cwd, ".atlas", "local"), { recursive: true });
  await cp(join(workspace, ".apm", "extensions", "cartograph", "fixtures", "mini-atlas"), root, { recursive: true });
  return fixtureFor("mini-atlas", cwd);
}

test("scenario arguments default to offline dry-run and require an explicit URL to run", () => {
  const config = { fixture: "mini-atlas" };
  assert.equal(argumentsFor([], config).action, "dry-run");
  assert.equal(argumentsFor(["--run", "--url", "http://127.0.0.1:12345/"], config).action, "run");
  for (const args of [["--run"], ["--check"], ["--run", "--dry-run"], ["--root", "/elsewhere"], ["prepare"], ["--wat"]]) {
    assert.throws(() => argumentsFor(args, config));
  }
  assert.throws(() => argumentsFor(["--fixture", "../elsewhere"], { ...config, server: true }));
  assert.throws(() => argumentsFor(["--check"], { ...config, server: true }));
});

test("endpoint validation refuses remote, alternate-host, credential and redirected-path URLs", () => {
  assert.equal(endpoint("http://127.0.0.1:12345").href, "http://127.0.0.1:12345/");
  for (const url of [
    "https://127.0.0.1:12345/", "http://localhost:12345/", "http://example.com:12345/",
    "http://127.0.0.1/", "http://user:secret@127.0.0.1:12345/",
    "http://127.0.0.1:12345/api/bootstrap", "http://127.0.0.1:12345/?scope=all", "http://127.0.0.1:12345/#page",
  ]) assert.throws(() => endpoint(url));
});

test("stress ceilings are bounded and high-rate stages require explicit opt-in", () => {
  const config = { fixture: "stress-test-atlas", stress: true };
  assert.equal(argumentsFor([], config).maxRate, 25);
  assert.deepEqual(selectedStages(25).map(({ rate }) => rate), [1, 5, 25]);
  assert.deepEqual(selectedStages(2000).map(({ rate }) => rate), [1, 5, 25, 100, 500, 2000]);
  for (const value of ["0", "-1", "2001", "Infinity", "1.5", "nope"]) {
    assert.throws(() => argumentsFor(["--max-rate", value], config));
  }
  const plan = selectedStages(2000);
  assert.equal(plan.reduce((total, stage) => total + stage.rate * stage.seconds, 1), 31585);
});

test("fixture validation accepts isolated copies but rejects unexpected content and traversal", async (t) => {
  const fixture = await isolatedFixture(t);
  assert.equal(fixture.expected.nodes, 5);
  await assert.rejects(fixtureFor("../mini-atlas", fixture.project));
  await writeFile(join(fixture.root, "extra.md"), "# Not part of the tracked fixture\n");
  await assert.rejects(fixtureFor("mini-atlas", fixture.project), /Unexpected fixture pages/);
});

test("fixture validation rejects file, directory and ancestor symlinks", async (t) => {
  const fixture = await isolatedFixture(t);
  const index = join(fixture.root, "index.md");
  await rename(index, join(fixture.project, "index.md"));
  await symlink(join(fixture.project, "index.md"), index);
  await assert.rejects(fixtureFor("mini-atlas", fixture.project), /symlink/);
  await rm(index);
  await rename(join(fixture.project, "index.md"), index);
  const local = join(fixture.project, ".atlas", "local");
  const moved = join(fixture.project, "moved-local");
  await rename(local, moved);
  await symlink(moved, local);
  await assert.rejects(fixtureFor("mini-atlas", fixture.project), /not a symlink/);
});

test("fixture validation rejects hardlinked files", async (t) => {
  const fixture = await isolatedFixture(t);
  await link(join(fixture.root, "index.md"), join(fixture.project, "shared.md"));
  await assert.rejects(fixtureFor("mini-atlas", fixture.project), /non-hardlinked/);
});

test("owned temporary files are exclusive, bounded and removed without changing the baseline", async (t) => {
  const fixture = await isolatedFixture(t);
  const owned = new OwnedFiles(fixture);
  const id = "work/cartograph-test";
  await assert.rejects(owned.create("../../escape", "bad"));
  const original = await readFile(join(fixture.root, "index.md"), "utf8");
  await owned.create(id, "first");
  await assert.rejects(new OwnedFiles(fixture).create(id, "overwrite"), /EEXIST/);
  await owned.update(id, "second");
  assert.equal(await readFile(join(fixture.root, `${id}.md`), "utf8"), "second");
  await owned.close();
  await assert.rejects(readFile(join(fixture.root, `${id}.md`)), /ENOENT/);
  assert.equal(await readFile(join(fixture.root, "index.md"), "utf8"), original);
  await fixtureFor("mini-atlas", fixture.project);
});

test("cleanup preserves externally edited or replaced demo files", async (t) => {
  const fixture = await isolatedFixture(t);
  const owned = new OwnedFiles(fixture);
  const id = "work/cartograph-external";
  const file = join(fixture.root, `${id}.md`);
  await owned.create(id, "owned");
  await writeFile(file, "external edit");
  await assert.rejects(owned.update(id, "overwrite"), /changed externally/);
  await assert.rejects(owned.close(), /could not be cleaned/);
  assert.equal(await readFile(file, "utf8"), "external edit");
  await rm(file);
  await symlink(join(fixture.root, "index.md"), file);
  await assert.rejects(owned.close());
  assert.match(await readFile(join(fixture.root, "index.md"), "utf8"), /Cartograph/);
});

test("request authentication uses current canvas headers and refuses redirects", async (t) => {
  let received;
  const server = createServer((req, res) => {
    received = req.headers;
    if (req.url === "/redirect") {
      res.writeHead(302, { Location: "http://example.com/" }); res.end(); return;
    }
    res.setHeader("Content-Type", "application/json");
    res.end('{"ok":true}');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = new URL(`http://127.0.0.1:${server.address().port}/`);
  assert.deepEqual(await request(url, "/api/bootstrap"), { ok: true });
  assert.equal(received["x-cartograph-client"], "canvas");
  await request(url, "/api/activity/events", { body: { events: [] }, token: "test-only" });
  assert.equal(received.authorization, "Bearer test-only");
  assert.equal(received["content-type"], "application/json");
  await assert.rejects(request(url, "/redirect"), /fetch failed/);
});

test("production preview API is synthetic-only, scoped to the fixture, and watches owned lifecycle changes", async (t) => {
  const fixture = await isolatedFixture(t);
  const entry = await startPreview(fixture);
  t.after(() => entry.close());
  const { initial, snapshot } = await preflight(entry.url, fixture, { synthetic: true });
  assert.equal(initial.activity.provider.id, syntheticProviderId);
  assert.equal((await fetch(new URL("/api/bootstrap", entry.url))).status, 403);
  const connection = await request(entry.url, "/api/activity/connection");
  assert.equal(connection.command, null);
  assert.ok(connection.token);
  assert.ok(!JSON.stringify(initial).includes(connection.token));
  const event = { path: join(fixture.root, "index.md"), pid: process.pid + 100000, kind: "read" };
  assert.deepEqual(await request(entry.url, "/api/activity/events", {
    token: connection.token, body: {
      status: "live", events: [event, { ...event, path: join(fixture.project, "outside.md") }],
      message: "Synthetic test observations, not OS reads.",
    },
  }), { ok: true, accepted: 1 });
  assert.throws(() => checkState(initial, fixture, { collector: true }), /never host-wide/);
  assert.throws(() => checkState({ ...initial, roots: [fixture.root, fixture.project] }, fixture));
  assert.throws(() => checkState({
    ...initial, activity: { ...initial.activity, provider: { id: "macos-eslogger" } },
  }, fixture, { synthetic: true }), /ONLY/);
  const owned = new OwnedFiles(fixture);
  t.after(() => owned.close());
  const id = "work/cartograph-lifecycle";
  await owned.create(id, page("Lifecycle test", ["index"]));
  const created = await until(snapshot, (state) => state.graph.nodes.some((node) => node.id === id), "Creation not observed");
  assert.equal(created.graphChanges.created[0].id, id);
  await owned.update(id, page("Lifecycle test", ["index", "experiences/canvas-port"]));
  await until(snapshot, (state) => state.graph.edges.filter((edge) => edge.source === id).length === 2, "Update not observed");
  await owned.remove(id);
  const restored = await until(snapshot, (state) => !state.graph.nodes.some((node) => node.id === id), "Deletion not observed");
  assert.deepEqual(graphIdentity(restored.graph), graphIdentity(initial.graph));
  entry.state.roots = [fixture.project];
  await assert.rejects(snapshot(), /matching .atlas\/local/);
});

test("all runner help and dry-run invocations work from another directory without HTTP or file mutations", async (t) => {
  const fixture = await isolatedFixture(t);
  for (const name of scripts) {
    const script = join(workspace, "scripts", "dev", `${name}.mjs`);
    const { stdout: help } = await exec(process.execPath, [script, "--help"], { cwd: fixture.project, timeout: 10000 });
    assert.match(help, /Default: offline --dry-run/);
    const args = [script, "--dry-run"];
    if (name !== "adaptive-preview-server") args.push("--url", "http://127.0.0.1:1/");
    const { stdout } = await exec(process.execPath, args, { cwd: fixture.project, timeout: 10000 });
    const result = JSON.parse(stdout);
    assert.equal(result.workloadStarted ?? result.serverStarted, false);
    assert.match(result.fixture, /^\.atlas\/local\//);
    assert.ok(!stdout.includes(workspace));
  }
});

test("explicit standalone invocation binds an ephemeral port and shuts down without deleting its fixture", async (t) => {
  const fixture = await isolatedFixture(t);
  await cp(join(workspace, "scripts", "dev"), join(fixture.project, "scripts", "dev"), { recursive: true });
  await cp(join(workspace, ".apm", "extensions", "cartograph"),
    join(fixture.project, ".apm", "extensions", "cartograph"), { recursive: true });
  const child = spawn(process.execPath, [
    join(fixture.project, "scripts", "dev", "adaptive-preview-server.mjs"), "--run", "--fixture", "mini-atlas",
  ], { cwd: fixture.project, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  let errors = "";
  child.stderr.on("data", (chunk) => { errors += chunk; });
  const exited = new Promise((resolve) => child.once("close", (code, signal) => resolve({ code, signal })));
  let timeout;
  try {
    const url = await new Promise((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error(`Preview startup timed out: ${errors}`)), 10000);
      child.once("error", reject);
      child.once("exit", () => reject(new Error(`Preview exited before startup: ${errors}`)));
      child.stdout.on("data", (chunk) => {
        output += chunk;
        const match = output.match(/http:\/\/127\.0\.0\.1:\d+\//);
        if (match) resolve(match[0]);
      });
    });
    clearTimeout(timeout);
    const { initial } = await preflight(url, fixture, { synthetic: true });
    assert.equal(initial.graph.nodes.length, 5);
    child.kill("SIGTERM");
    assert.deepEqual(await exited, { code: 0, signal: null });
    await fixtureFor("mini-atlas", fixture.project);
  } finally {
    clearTimeout(timeout);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    const forceStop = setTimeout(() => child.kill("SIGKILL"), 5000);
    try { await exited; } finally { clearTimeout(forceStop); }
  }
});
