import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CollectorError, validPath, validPid } from "../protocol.mjs";
import { eventInProcessScope, ProcessAncestryTracker, validateProcessScope } from "../process-scope.mjs";

export const LIMITATIONS = "Best-effort macOS eslogger observations: successful opens classified by access flags and modified closes, not individual read syscalls on already-open descriptors or cache hits. Write-open does not prove a write; modified-close does not cover all memory-mapped writes. eslogger has no stable schema, may suppress its process group, and can lose events. No history is recorded. Session mode uses verified ancestry, excludes viewer descendants, and drops unknown ancestry.";
const MAX_LINE_BYTES = 1024 * 1024;
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const schemaError = () => new CollectorError("Unsupported or malformed eslogger event schema; no raw event data was logged.");
const shellQuote = (s) => `'${s.replaceAll("'", "'\\''")}'`;

// Apple eslogger(1), EndpointSecurity/ESMessage.h and ESTypes.h, sys/fcntl.h.
// NOTIFY_OPEN=10, NOTIFY_CLOSE=12; kernel FREAD=1/FWRITE=2, not open(2) O_*.
export function parseEsloggerLine(line) {
  const message = decodeLine(line);
  return message === undefined ? { type: "ignored", valid: false, reason: "empty" } : parseMessage(message);
}

function decodeLine(line) {
  if (typeof line !== "string") throw schemaError();
  if (Buffer.byteLength(line) > MAX_LINE_BYTES) throw new CollectorError("eslogger line exceeds the safe size limit.");
  if (!line.trim()) return undefined;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    throw new CollectorError("Malformed eslogger JSON; check the producer's diagnostics. No raw event data was logged.");
  }
  if (!object(message)) throw schemaError();
  eventName(message);
  return message;
}

function eventName(message) {
  const type = typeof message.event_type === "string" ? message.event_type.toLowerCase() : message.event_type;
  if (!(typeof type === "string" && type.length > 0) && !(Number.isInteger(type) && type >= 0)) throw schemaError();
  // Numeric constants verified in Apple's ESTypes.h enum, not inferred from names.
  for (const [name, value] of [["exec", 9], ["open", 10], ["fork", 11], ["close", 12], ["exit", 15]]) {
    if ([value, String(value), name, `notify_${name}`, `es_event_type_notify_${name}`].includes(type)) return name;
  }
  return undefined;
}

function validateSchema(message) {
  const version = message.schema_version;
  if (!(Number.isSafeInteger(version) && version >= 0)
    && !(typeof version === "string" && version.length <= 32 && /^\d+(?:\.\d+){0,2}$/.test(version))) throw schemaError();
}

function parseMessage(message) {
  const name = eventName(message);
  const open = name === "open";
  const close = name === "close";
  // AUTH_OPEN is not evidence that an open succeeded.
  if (!open && !close) return { type: "ignored", valid: false, reason: "unrelated" };
  validateSchema(message);
  const pid = message.process?.audit_token?.pid;
  const payload = message.event?.[open ? "open" : "close"];
  const file = payload?.[open ? "file" : "target"];
  if (!validPid(pid) || !object(payload) || !object(file)
    || !validPath(file.path) || typeof file.path_truncated !== "boolean") throw schemaError();
  if (open && (!Number.isInteger(payload.fflag) || payload.fflag < -2147483648 || payload.fflag > 2147483647)) throw schemaError();
  if (close && typeof payload.modified !== "boolean") throw schemaError();
  if (file.path_truncated) return { type: "ignored", valid: true, reason: "truncated" };
  if (close && !payload.modified) return { type: "ignored", valid: true, reason: "unmodified" };
  const flags = open ? payload.fflag & 3 : 2;
  const kind = ["open", "read", "write", "read-write"][flags];
  return { type: "event", valid: true, event: { path: file.path, pid, kind } };
}

const validVersion = (version) => Number.isInteger(version) && version >= 0 && version <= 4294967295;

function processStartTime(start) {
  if (start === undefined) return {};
  if (object(start) && Number.isSafeInteger(start.tv_sec) && start.tv_sec >= 0 &&
      Number.isInteger(start.tv_usec) && start.tv_usec >= 0 && start.tv_usec <= 999999) {
    return { startTime: start.tv_sec, startUsec: start.tv_usec };
  }
  // eslogger serializes timeval as RFC 3339 text, unlike the native C structure.
  // Preserve microseconds: Date.parse alone truncates them to milliseconds.
  const parts = typeof start === "string"
    ? /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(start)
    : null;
  if (parts) {
    const instant = Date.parse(`${parts[1]}${parts[3]}`);
    const calendar = Date.parse(`${parts[1]}Z`);
    if (Number.isSafeInteger(instant) && instant >= 0 && Number.isFinite(calendar) &&
        new Date(calendar).toISOString().startsWith(parts[1])) {
      return {
        startTime: instant / 1000,
        startUsec: Number((parts[2] ?? "").padEnd(6, "0").slice(0, 6)),
      };
    }
  }
  throw new CollectorError(`Session attribution requires a valid process.start_time (RFC 3339 timestamp or timeval); received ${typeof start}. No raw value was logged.`);
}

// ESMessageCore.h: parent_audit_token is preferred over ppid; pidversion
// identifies an execution, while start_time identifies its original fork.
function processIdentity(process) {
  const pid = process?.audit_token?.pid;
  const pidversion = process?.audit_token?.pidversion;
  const ppid = process?.ppid;
  const parent = process?.parent_audit_token;
  if (!validPid(pid) || !validVersion(pidversion) || !(ppid === 0 || validPid(ppid)) ||
    (parent !== undefined && (!object(parent) || !(parent.pid === 0 || validPid(parent.pid)) || !validVersion(parent.pidversion)))) {
    throw new CollectorError("Session attribution requires valid eslogger process PID, ppid, pidversion and parent audit-token metadata.");
  }
  return {
    pid, ppid, pidversion,
    ...(parent ? { parentPid: parent.pid, parentVersion: parent.pidversion } : {}),
    ...processStartTime(process?.start_time),
  };
}

export function parseProcessSnapshot(output) {
  if (typeof output !== "string" || Buffer.byteLength(output) > 8 * 1024 * 1024) {
    throw new CollectorError("Invalid process snapshot.");
  }
  return output.split("\n").filter((line) => line.trim()).map((line) => {
    const fields = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    const startTime = fields ? Date.parse(fields[3]) / 1000 : NaN;
    if (!fields || !Number.isSafeInteger(startTime)) throw new CollectorError("Invalid PID/parent/birth-time process snapshot.");
    return { pid: Number(fields[1]), ppid: Number(fields[2]), startTime };
  });
}

async function readProcessSnapshot(signal) {
  try {
    const { stdout } = await promisify(execFile)("/bin/ps", ["-axo", "pid=,ppid=,lstart="], {
      env: { PATH: "/usr/bin:/bin", LC_ALL: "C", ...(process.env.TZ ? { TZ: process.env.TZ } : {}) },
      timeout: 2000, maxBuffer: 8 * 1024 * 1024, signal,
    });
    return parseProcessSnapshot(stdout);
  } catch {
    throw new CollectorError("Could not seed session ancestry from the read-only process snapshot. Collection did not fall back to all processes.");
  }
}

export async function createEsloggerParser({ scope, snapshot, signal, maxProcesses } = {}) {
  scope = validateProcessScope(scope);
  if (scope.mode === "all") return parseEsloggerLine;
  const tracker = new ProcessAncestryTracker(scope, snapshot ?? await readProcessSnapshot(signal), { maxProcesses });
  let sequence;
  return (line) => {
    const message = decodeLine(line);
    if (!message) return { type: "ignored", valid: false, reason: "empty" };
    if (message.global_seq_num !== undefined) {
      const value = message.global_seq_num;
      if (!(Number.isSafeInteger(value) && value >= 0) && !(typeof value === "string" && /^\d{1,20}$/.test(value))) {
        throw new CollectorError("Invalid eslogger event sequence metadata.");
      }
      const current = BigInt(value);
      if (sequence !== undefined && current !== sequence + 1n) {
        throw new CollectorError("eslogger events were lost or reordered; session ancestry is no longer reliable. Restart the collector.");
      }
      sequence = current;
    } else if (sequence !== undefined) {
      throw new CollectorError("eslogger event sequence metadata disappeared; restart the collector.");
    }
    const name = eventName(message);
    if (!name) return { type: "ignored", valid: false, reason: "unrelated" };
    validateSchema(message);
    const actor = processIdentity(message.process);
    if (name === "fork") {
      tracker.fork(actor, processIdentity(message.event?.fork?.child));
    } else if (name === "exec") {
      tracker.exec(actor, processIdentity(message.event?.exec?.target));
    } else if (name === "exit") {
      if (!Number.isInteger(message.event?.exit?.stat)) throw schemaError();
      tracker.exit(actor);
    } else {
      const parsed = parseMessage(message);
      const record = tracker.observe(actor);
      if (parsed.type !== "event") return parsed;
      const event = { ...parsed.event, ...(record?.ancestors ? { ancestors: [...record.ancestors] } : {}) };
      if (!record || !eventInProcessScope(event, scope)) return { type: "ignored", valid: true, reason: "out-of-scope" };
      return { type: "event", valid: true, event };
    }
    return { type: "ignored", valid: false, reason: "process-lifecycle" };
  };
}

export const esloggerProvider = {
  metadata: {
    id: "macos-eslogger",
    label: "macOS eslogger",
    description: LIMITATIONS,
    permissions: ["administrator", "full-disk-access"],
    operations: ["open", "read", "write", "read-write"],
    processScopes: ["all", "session"],
    setup: {
      title: "Start the macOS collector",
      description: "macOS authorization is required. eslogger sees system-wide metadata; the unprivileged collector forwards only graph-file accesses allowed by this canvas's process scope. Session scope follows the selected session's tool tree, excluding the viewer subtree.",
      steps: [
        "Open Terminal on the Mac running this canvas with Node.js 22 or later on its PATH. Grant Terminal Full Disk Access in System Settings > Privacy & Security if required.",
        "Run the command below manually. It subscribes to open/close events; session scope also subscribes to fork/exec/exit events and seeds existing processes using read-only ps PID/parent/birth-time metadata. Only eslogger runs as root; Node runs as your normal user. Do not sudo the whole pipeline.",
        "Leave that terminal open. Status becomes Live only after the collector observes a valid file-access event, not a process lifecycle event. Use Control-C to stop it.",
      ],
      notice: "The command contains a private connection token. Do not share it.",
    },
  },
  availability: (platform) => ({
    supported: platform === "darwin",
    message: "The bundled OS collector requires macOS 13 or later.",
  }),
  waitingMessage: "Start the macOS collector to observe external file accesses.",
  createConnection({ endpoint, token, collectorPath, scope }) {
    const events = validateProcessScope(scope).mode === "session" ? "open close fork exec exit" : "open close";
    // Copilot's bundled executable is not necessarily a standalone Node runtime.
    return {
      command: `sudo /usr/bin/eslogger ${events} | CARTOGRAPH_ACTIVITY_TOKEN=${shellQuote(token)} /usr/bin/env node ${shellQuote(collectorPath)} --url ${shellQuote(endpoint)} --provider macos-eslogger`,
    };
  },
  stream: {
    parseLine: parseEsloggerLine,
    createParser: createEsloggerParser,
    messages: {
      limitations: LIMITATIONS,
      waiting: "Waiting for a valid eslogger file-access event. Check the producing terminal's Full Disk Access and eslogger diagnostics.",
      ended: "eslogger stream ended; collection is disconnected.",
      emptyEnd: "eslogger ended without a valid file-access event. Check sudo/eslogger diagnostics and the terminal's Full Disk Access; collection never became live.",
      inputError: "eslogger input stream failed. Check the producing terminal and its Full Disk Access.",
      closed: "eslogger input closed unexpectedly.",
      oversizedLine: "eslogger line exceeds the safe size limit.",
    },
  },
};
