#!/usr/bin/env node
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { monitorProviders, validateMonitorProvider } from "./providers/index.mjs";
import { CollectorError, MAX_BATCH, MAX_POST_BYTES, validAccessEvent, validPath, validPid } from "./protocol.mjs";
import { eventInProcessScope, validateProcessScope } from "./process-scope.mjs";
export { CollectorError } from "./protocol.mjs";
export { LIMITATIONS, parseEsloggerLine } from "./providers/eslogger.mjs";

const MAX_LINE_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export function validateCollectorUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new CollectorError("Supply --url http://127.0.0.1:PORT/; only loopback URLs are allowed.");
  }
  const host = url.hostname;
  const loopback = host === "localhost" || host === "[::1]" || (isIP(host) === 4 && host.startsWith("127."));
  if (!loopback || !["http:", "https:"].includes(url.protocol) || url.username || url.password
    || url.pathname !== "/" || url.search || url.hash) {
    throw new CollectorError("Only a loopback HTTP(S) origin without credentials, path, query, or fragment is allowed.");
  }
  // Never resolve a hostname through DNS when sending the bearer token.
  if (host === "localhost") url.hostname = "127.0.0.1";
  return url;
}

function validateToken(token) {
  if (typeof token !== "string" || !token || !/^[\x21-\x7e]+$/.test(token)) {
    throw new CollectorError("Set CARTOGRAPH_ACTIVITY_TOKEN in the collector's environment. Tokens must not be passed as arguments.");
  }
}

export function parseCollectorArgs(args, env = process.env, registry = monitorProviders) {
  const options = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    if (!["--url", "--provider"].includes(flag) || !args[index + 1] || options.has(flag)) {
      throw new CollectorError("Usage: collector.mjs --url http://127.0.0.1:PORT/ [--provider ID] (token only via CARTOGRAPH_ACTIVITY_TOKEN).");
    }
    options.set(flag, args[index + 1]);
  }
  if (!options.has("--url")) throw new CollectorError("Usage: collector.mjs --url http://127.0.0.1:PORT/ [--provider ID].");
  validateToken(env.CARTOGRAPH_ACTIVITY_TOKEN);
  const providerId = options.get("--provider") ?? registry.defaultId;
  if (!registry.ids().includes(providerId)) throw new CollectorError("Unknown monitor provider. Use a registered provider ID.");
  return { url: validateCollectorUrl(options.get("--url")), token: env.CARTOGRAPH_ACTIVITY_TOKEN, providerId };
}

export function parseTargets(value) {
  if (!object(value) || !Array.isArray(value.paths) || !Array.isArray(value.ignorePids)
    || value.paths.length > 100000 || value.ignorePids.length > 100000
    || !value.paths.every(validPath) || !value.ignorePids.every(validPid)) {
    throw new CollectorError("Cartograph returned an invalid activity target schema.");
  }
  let scope;
  try {
    scope = validateProcessScope(value.scope);
  } catch {
    throw new CollectorError("Cartograph returned an invalid activity process scope.");
  }
  return { paths: new Set(value.paths), ignorePids: new Set([...value.ignorePids, process.pid]), scope };
}

export function filterTargetEvents(events, targets) {
  return events.filter((event) => targets.paths.has(event.path) && !targets.ignorePids.has(event.pid) &&
    eventInProcessScope(event, targets.scope) && !(event.ancestors ?? []).some((pid) => targets.ignorePids.has(pid)));
}

function takeBatch(queue) {
  let count = 0;
  let bytes = 0;
  while (count < Math.min(queue.length, MAX_BATCH)) {
    const next = Buffer.byteLength(JSON.stringify(queue[count])) + 1;
    // Reserve space for the status/message envelope, including JSON escaping.
    if (bytes + next > MAX_POST_BYTES - 1024) break;
    bytes += next;
    count++;
  }
  return queue.splice(0, count);
}

async function createStreamParser(stream, context) {
  let timer;
  let onAbort;
  const cancelled = new Promise((_, reject) => {
    onAbort = () => reject(new CollectorError("Monitor parser initialization was interrupted."));
    context.signal.addEventListener("abort", onAbort, { once: true });
    if (context.signal.aborted) onAbort();
    timer = setTimeout(() => reject(new CollectorError("Monitor parser initialization timed out.")), 5000);
  });
  try {
    return await Promise.race([Promise.resolve().then(() => stream.createParser(context)), cancelled]);
  } finally {
    clearTimeout(timer);
    context.signal.removeEventListener("abort", onAbort);
  }
}

function requestJson(base, route, token, body, signal, timeoutMs) {
  return new Promise((resolveRequest, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const url = new URL(route, base);
    const request = url.protocol === "https:" ? httpsRequest : httpRequest;
    let settled = false;
    let timer;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolveRequest(value);
    };
    const req = request(url, {
      method: data === undefined ? "GET" : "POST",
      agent: false,
      signal,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(data === undefined ? {} : {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        }),
      },
    }, (res) => {
      const status = res.statusCode;
      if (status < 200 || status >= 300) {
        const reason = status >= 300 && status < 400 ? "Redirects are forbidden."
          : status === 401 || status === 403 ? "Check CARTOGRAPH_ACTIVITY_TOKEN and server activity configuration."
            : "Check the local Cartograph server.";
        finish(new CollectorError(`Cartograph HTTP ${status}. ${reason}`));
        res.destroy();
        return;
      }
      const chunks = [];
      let bytes = 0;
      res.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > MAX_RESPONSE_BYTES) {
          finish(new CollectorError("Cartograph response exceeds the safe size limit."));
          res.destroy();
        } else chunks.push(chunk);
      });
      res.on("error", () => finish(new CollectorError("Cartograph response stream failed.")));
      res.on("end", () => {
        try {
          finish(null, JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch {
          finish(new CollectorError("Cartograph returned malformed JSON."));
        }
      });
      res.on("close", () => {
        if (!res.complete) finish(new CollectorError("Cartograph response ended prematurely."));
      });
    });
    req.on("error", () => finish(new CollectorError("Cartograph request failed or was interrupted; check the local server and collector URL.")));
    timer = setTimeout(() => {
      finish(new CollectorError("Cartograph request timed out; check the local server."));
      req.destroy();
    }, timeoutMs);
    req.end(data);
  });
}

export async function runCollector({
  url,
  token,
  providerId = monitorProviders.defaultId,
  provider = monitorProviders.get(providerId),
  input = process.stdin,
  stderr = process.stderr,
  signal,
  refreshMs = 2000,
  heartbeatMs = 2000,
  flushMs = 100,
  requestTimeoutMs = 1500,
  maxQueue = 1024,
} = {}) {
  validateMonitorProvider(provider);
  if (!provider.stream) throw new CollectorError("This monitor reports directly to Cartograph and does not use the line-stream collector.");
  const { messages } = provider.stream;
  let parseLine = provider.stream.parseLine;
  const base = validateCollectorUrl(url);
  validateToken(token);
  for (const value of [refreshMs, heartbeatMs, flushMs, requestTimeoutMs, maxQueue]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new CollectorError("Collector limits must be positive integers.");
  }
  let targets = { paths: new Set(), ignorePids: new Set([process.pid]) };
  let scopeKey;
  let pending = [];
  let lineBuffer = "";
  let lineNumber = 0;
  let sawValid = false;
  let stopping = false;
  let posting = false;
  let inFlightPost;
  let refreshing = false;
  const timers = [];
  const requests = new AbortController();
  let complete;
  const done = new Promise((resolveDone) => { complete = resolveDone; });
  const report = (message) => stderr.write(`Cartograph collector: ${message}\n`);
  const post = async (events, status, message, requestSignal = requests.signal) => {
    const result = await requestJson(base, "/api/activity/events", token, { events, status, message }, requestSignal, requestTimeoutMs);
    if (!object(result) || result.ok !== true || !Number.isInteger(result.accepted) || result.accepted < 0 || result.accepted > events.length) {
      throw new CollectorError("Cartograph returned an invalid activity acknowledgement.");
    }
  };
  const finish = async (status, message) => {
    if (stopping) return done;
    stopping = true;
    timers.forEach(clearInterval);
    signal?.removeEventListener("abort", onAbort);
    input.pause();
    input.off("data", onData);
    input.off("end", onEnd);
    input.off("error", onInputError);
    input.off("close", onClose);
    input.destroy();
    lineBuffer = "";
    const remaining = status === "error" ? [] : filterTargetEvents(pending, targets);
    pending = [];
    // A graceful EOF must not discard a final batch already being transmitted.
    // Its existing deadline also bounds shutdown; errors cancel immediately.
    if (status !== "error" && inFlightPost) {
      try {
        await inFlightPost;
      } catch (error) {
        status = "error";
        message = error instanceof CollectorError ? error.message : "The final activity batch could not be delivered.";
        remaining.length = 0;
      }
    }
    requests.abort();
    report(message);
    try {
      // Finish without a live heartbeat, even when EOF arrives during an HTTP request.
      do {
        await post(takeBatch(remaining), status, message, new AbortController().signal);
      } while (remaining.length);
    } catch (error) {
      report(error instanceof CollectorError ? error.message : "Could not report final collector status.");
      status = "error";
    }
    complete({ status, sawValid });
    return done;
  };
  const fail = (error) => finish("error", error instanceof CollectorError ? error.message : "Collector failed; no raw event data was logged.");
  const flush = async (heartbeat = false) => {
    if (stopping || posting || (!heartbeat && !pending.length)) return;
    posting = true;
    try {
      do {
        const batch = filterTargetEvents(takeBatch(pending), targets);
        inFlightPost = post(batch, sawValid ? "live" : "waiting", sawValid ? messages.limitations : messages.waiting);
        await inFlightPost;
        inFlightPost = undefined;
      } while (!stopping && pending.length);
    } catch (error) {
      if (!stopping) void fail(error);
    } finally {
      inFlightPost = undefined;
      posting = false;
    }
  };
  const refresh = async () => {
    if (stopping || refreshing) return;
    refreshing = true;
    try {
      const response = await requestJson(base, "/api/activity/targets", token, undefined, requests.signal, requestTimeoutMs);
      if (!stopping) {
        if (response?.providerId !== undefined && response.providerId !== provider.metadata.id) {
          throw new CollectorError("The canvas is using a different monitor provider. Get its current connection instructions.");
        }
        const next = parseTargets(response);
        const nextScopeKey = JSON.stringify(next.scope);
        if (scopeKey !== undefined && scopeKey !== nextScopeKey) {
          throw new CollectorError("The canvas process scope changed. Restart the collector with its current connection instructions.");
        }
        scopeKey = nextScopeKey;
        targets = next;
        pending = filterTargetEvents(pending, targets);
      }
    } finally {
      refreshing = false;
    }
  };
  const consume = (line) => {
    lineNumber++;
    try {
      if (Buffer.byteLength(line) > MAX_LINE_BYTES) throw new CollectorError(messages.oversizedLine);
      const parsed = parseLine(line);
      if (!parsed || !["event", "ignored"].includes(parsed.type) || typeof parsed.valid !== "boolean" ||
          (parsed.type === "event" && (!parsed.valid || !validAccessEvent(parsed.event) ||
            !provider.metadata.operations.includes(parsed.event.kind)))) {
        throw new CollectorError("Monitor adapter returned an invalid normalized event.");
      }
      const firstValid = parsed.valid && !sawValid;
      if (parsed.valid) sawValid = true;
      if (parsed.type === "event" && filterTargetEvents([parsed.event], targets).length) {
        if (pending.length >= maxQueue) throw new CollectorError("Activity queue exceeded its safe limit; events were dropped. Restart the collector.");
        const { path, pid, kind, ancestors } = parsed.event;
        pending.push({ path, pid, kind, ...(ancestors === undefined ? {} : { ancestors: [...ancestors] }) });
      }
      if (firstValid || pending.length >= MAX_BATCH) void flush(firstValid);
    } catch (error) {
      void fail(new CollectorError(`Input line ${lineNumber}: ${error instanceof CollectorError ? error.message : "Invalid event."}`));
    }
  };
  function onData(chunk) {
    lineBuffer += chunk;
    let newline;
    while (!stopping && (newline = lineBuffer.indexOf("\n")) !== -1) {
      const line = lineBuffer.slice(0, newline);
      lineBuffer = lineBuffer.slice(newline + 1);
      consume(line);
    }
    if (!stopping && Buffer.byteLength(lineBuffer) > MAX_LINE_BYTES) {
      void fail(new CollectorError(messages.oversizedLine));
    }
  }
  function onEnd() {
    if (lineBuffer && !stopping) consume(lineBuffer);
    if (!stopping) void finish(sawValid ? "disconnected" : "error", sawValid ? messages.ended : messages.emptyEnd);
  }
  function onInputError() {
    void fail(new CollectorError(messages.inputError));
  }
  function onClose() {
    if (!stopping) void fail(new CollectorError(messages.closed));
  }
  function onAbort() {
    void finish("disconnected", "Collector stopped; collection is disconnected.");
  }

  input.setEncoding("utf8");
  input.pause();
  input.on("data", onData);
  input.on("end", onEnd);
  input.on("error", onInputError);
  input.on("close", onClose);
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();
  if (!stopping) {
    try {
      await refresh();
      if (!stopping) {
        const supported = provider.metadata.processScopes ?? ["all"];
        if (!supported.includes(targets.scope.mode) ||
          (targets.scope.mode === "session" && typeof provider.stream.createParser !== "function")) {
          throw new CollectorError("This monitor cannot attribute the selected session's process tree. Collection did not fall back to all processes.");
        }
        if (provider.stream.createParser) {
          parseLine = await createStreamParser(provider.stream, {
            scope: validateProcessScope(targets.scope), signal: requests.signal,
          });
          if (typeof parseLine !== "function") throw new CollectorError("Monitor adapter did not create a valid per-run parser.");
        }
      }
      if (!stopping) await flush(true);
      if (!stopping) {
        timers.push(setInterval(() => { void refresh().catch(fail); }, refreshMs));
        timers.push(setInterval(() => { void flush(true); }, heartbeatMs));
        timers.push(setInterval(() => { void flush(); }, flushMs));
        input.resume();
        if (input.readableEnded) onEnd();
        else if (input.destroyed) onClose();
      }
    } catch (error) {
      if (!stopping) void fail(error);
    }
  }
  return done;
}

async function main() {
  const abort = new AbortController();
  let termination;
  const onSignal = (name) => {
    termination = name;
    abort.abort();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  try {
    const options = parseCollectorArgs(process.argv.slice(2));
    const provider = monitorProviders.get(options.providerId);
    if (provider.stream) process.stderr.write(`Cartograph collector: ${provider.stream.messages.limitations}\n`);
    const result = await runCollector({ ...options, signal: abort.signal });
    process.exitCode = termination === "SIGINT" ? 130 : termination === "SIGTERM" ? 143 : result.status === "error" ? 1 : 0;
  } catch (error) {
    process.stderr.write(`Cartograph collector: ${error instanceof CollectorError ? error.message : "Could not start collector."}\n`);
    process.exitCode = 1;
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
