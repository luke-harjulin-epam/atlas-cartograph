import { randomBytes, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { AccessActivity } from "./model.mjs";
import { monitorMetadata, monitorProviders } from "./providers/index.mjs";
import { COLLECTOR_STATUSES, MAX_BATCH, MAX_MESSAGE_LENGTH, MAX_POST_BYTES, validAccessEvent } from "./protocol.mjs";
import { eventInProcessScope, validateProcessScope } from "./process-scope.mjs";
import { requireCanvas } from "../http.mjs";

const COLLECTOR = fileURLToPath(new URL("./collector.mjs", import.meta.url));

function failure(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_POST_BYTES) throw failure(413, "Activity request exceeds 1 MiB.");
    chunks.push(chunk);
  }
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw failure(400, "Activity request must be valid JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw failure(400, "Activity request must be an object.");
  }
  return body;
}

export function createActivityService(entry, sendJson, {
  now = Date.now,
  platform = process.platform,
  registry = monitorProviders,
  providerId = entry.state.activity?.providerId ?? registry.defaultId,
  scope: requestedScope,
} = {}) {
  const provider = registry.get(providerId);
  const normalizedScope = validateProcessScope(requestedScope);
  const scope = validateProcessScope({
    ...normalizedScope,
    ...(normalizedScope.mode === "session" ? { viewerPid: process.pid } : {}),
    excludePids: [...new Set([...normalizedScope.excludePids, process.pid])],
  });
  if (!(provider.metadata.processScopes ?? ["all"]).includes(scope.mode)) {
    throw new Error(`Monitor ${providerId} does not support ${scope.mode} process scope.`);
  }
  const availability = provider.availability(platform);
  if (typeof availability?.supported !== "boolean" || typeof availability.message !== "string") {
    throw new TypeError("Monitor provider returned invalid availability.");
  }
  const token = randomBytes(32).toString("hex");
  const model = new AccessActivity({
    durationMs: entry.state.activity?.durationMs,
    enabled: entry.state.activity?.enabled ?? true,
    ignorePids: scope.excludePids,
    now,
  });
  let collector = { status: "waiting", message: provider.waitingMessage };
  let lastHeartbeat = null;

  function sync() {
    model.setGraph(entry.state.graph);
    const status = !model.enabled
      ? { status: "paused", message: "Activity highlighting is paused." }
      : !availability.supported && collector.status === "waiting"
        ? { status: "unsupported", message: availability.message }
        : collector;
    entry.state.activity = {
      ...model.snapshot(), provider: monitorMetadata(provider),
      scope: { ...scope, excludePids: [...scope.excludePids] }, collector: status,
    };
    return entry.state.activity;
  }

  function publish() {
    const payload = `event: activity\ndata: ${JSON.stringify(sync())}\n\n`;
    for (const res of entry.clients) res.write(payload);
  }

  function authenticate(req) {
    const supplied = Buffer.from(String(req.headers.authorization ?? ""));
    const expected = Buffer.from(`Bearer ${token}`);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw failure(401, "Collector authorization required.");
    }
  }

  function configure(input) {
    try {
      model.configure(input);
    } catch (error) {
      if (error instanceof TypeError || error instanceof RangeError) throw failure(400, error.message);
      throw error;
    }
    publish();
    return entry.state.activity;
  }

  async function handle(req, res, path) {
    if (!path.startsWith("/api/activity/")) return false;
    const routes = {
      "/api/activity/connection": "GET",
      "/api/activity/config": "POST",
      "/api/activity/targets": "GET",
      "/api/activity/events": "POST",
    };
    if (!routes[path]) throw failure(404, "Unknown activity endpoint.");
    if (req.method !== routes[path]) throw failure(405, "Method not allowed.");
    if (path === "/api/activity/connection" || path === "/api/activity/config") requireCanvas(req, entry.url);
    else authenticate(req);
    if (req.method === "POST" && req.headers["content-type"]?.split(";")[0] !== "application/json") {
      throw failure(415, "Activity requests require application/json.");
    }
    res.setHeader("Cache-Control", "no-store");
    if (path === "/api/activity/connection") {
      if (!availability.supported) throw failure(409, availability.message);
      const connection = await provider.createConnection({ endpoint: entry.url, token, collectorPath: COLLECTOR, scope });
      if (connection?.command !== null && (typeof connection?.command !== "string" || !connection.command.trim())) {
        throw new TypeError("Monitor provider returned an invalid connection command.");
      }
      sendJson(res, 200, { endpoint: entry.url, token, pid: process.pid, providerId, scope, command: connection.command });
    } else if (path === "/api/activity/config") {
      sendJson(res, 200, configure(await readBody(req)));
    } else if (path === "/api/activity/targets") {
      sync();
      sendJson(res, 200, { providerId, scope, paths: model.enabled ? [...model.paths.keys()] : [], ignorePids: [...model.ignorePids] });
    } else {
      const body = await readBody(req);
      if (!Array.isArray(body.events) || body.events.length > MAX_BATCH ||
          !COLLECTOR_STATUSES.has(body.status) ||
          (body.message !== undefined && (typeof body.message !== "string" || body.message.length > MAX_MESSAGE_LENGTH))) {
        throw failure(400, "Expected up to 128 events and a valid collector status.");
      }
      for (const event of body.events) {
        if (!validAccessEvent(event) || !provider.metadata.operations.includes(event.kind)) {
          throw failure(400, "Invalid file access event.");
        }
        if (scope.mode === "session" && event.pid !== scope.rootPid && !Array.isArray(event.ancestors)) {
          throw failure(400, "Session-scoped activity requires process ancestry. Restart the collector with the current canvas command.");
        }
      }
      sync();
      let accepted = 0;
      for (const event of body.events) {
        if (eventInProcessScope(event, scope) && model.record(event)) accepted++;
      }
      lastHeartbeat = now();
      collector = {
        status: body.status,
        message: body.message ?? (body.status === "live" ? "Receiving external file accesses." : "Collector is not streaming."),
      };
      publish();
      sendJson(res, 200, { ok: true, accepted });
    }
    return true;
  }

  const timer = setInterval(() => {
    let changed = model.expire();
    if (lastHeartbeat !== null && now() - lastHeartbeat > 6500 &&
        (collector.status === "live" || collector.status === "waiting")) {
      collector = { status: "disconnected", message: "Collector heartbeat lost. Restart the collector to reconnect." };
      changed = true;
    }
    if (changed) publish();
  }, 100);
  timer.unref();
  sync();
  return { handle, sync, configure, close: () => clearInterval(timer) };
}
