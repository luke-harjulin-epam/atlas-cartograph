import { CollectorError, validAncestors, validPid } from "./protocol.mjs";

export function validateProcessScope(scope) {
  if (scope === undefined) return { mode: "all", excludePids: [] };
  if (!scope || typeof scope !== "object" || Array.isArray(scope) ||
    !["all", "session"].includes(scope.mode) ||
    Object.keys(scope).some((key) => !["mode", "rootPid", "excludePids"].includes(key)) ||
    (scope.mode === "session" ? !validPid(scope.rootPid) : Object.hasOwn(scope, "rootPid")) ||
    (scope.excludePids !== undefined && (!Array.isArray(scope.excludePids) ||
      scope.excludePids.length > 4096 || !scope.excludePids.every(validPid)))) {
    throw new TypeError("Invalid activity process scope.");
  }
  const excludePids = [...new Set(scope.excludePids ?? [])].sort((a, b) => a - b);
  if (scope.mode === "session" && excludePids.includes(scope.rootPid)) {
    throw new TypeError("The session root cannot also be excluded.");
  }
  return { mode: scope.mode, ...(scope.mode === "session" ? { rootPid: scope.rootPid } : {}), excludePids };
}

export function eventInProcessScope(event, scope) {
  const normalized = validateProcessScope(scope);
  if (!event || !validPid(event.pid) || !validAncestors(event.ancestors, event.pid)) return false;
  const ancestry = event.ancestors ?? [];
  if (normalized.excludePids.some((pid) => pid === event.pid || ancestry.includes(pid))) return false;
  return normalized.mode === "all" || event.pid === normalized.rootPid || ancestry.includes(normalized.rootPid);
}

const sameBirth = (a, b) => a.startTime !== undefined && a.startTime === b.startTime &&
  (a.startUsec === undefined || b.startUsec === undefined || a.startUsec === b.startUsec);
const sameExecution = (a, b) => a.pidversion === b.pidversion &&
  (a.startTime === undefined || b.startTime === undefined || sameBirth(a, b));
const olderIdentity = (current, incoming) =>
  (current.startTime !== undefined && incoming.startTime !== undefined && incoming.startTime < current.startTime) ||
  (sameBirth(current, incoming) && current.pidversion !== undefined && incoming.pidversion < current.pidversion);

// Only a bounded set of numeric process identities and birth lineages survives
// initialization. No executable paths, arguments, file events or poll history.
export class ProcessAncestryTracker {
  constructor(scope, snapshot, { maxProcesses = 16384 } = {}) {
    this.scope = validateProcessScope(scope);
    this.records = new Map();
    this.maxProcesses = maxProcesses;
    if (this.scope.mode !== "session" || !Array.isArray(snapshot) || snapshot.length > 100000 ||
      !Number.isSafeInteger(maxProcesses) || maxProcesses < 1) {
      throw new CollectorError("Invalid session process snapshot.");
    }
    const processes = new Map();
    for (const record of snapshot) {
      if (!record || !validPid(record.pid) || !(record.ppid === 0 || validPid(record.ppid)) ||
        processes.has(record.pid) ||
        (record.startTime !== undefined && (!Number.isSafeInteger(record.startTime) || record.startTime < 0))) {
        throw new CollectorError("Invalid session process snapshot.");
      }
      processes.set(record.pid, { pid: record.pid, ppid: record.ppid, startTime: record.startTime });
    }
    if (!processes.has(this.scope.rootPid)) {
      throw new CollectorError("The selected session process is no longer running. Reopen the canvas from this session.");
    }
    for (const record of processes.values()) {
      const ancestors = [];
      const seen = new Set([record.pid]);
      let cursor = record;
      while (cursor.pid !== this.scope.rootPid && ancestors.length < 64) {
        if (!validPid(cursor.ppid) || seen.has(cursor.ppid)) break;
        ancestors.push(cursor.ppid);
        seen.add(cursor.ppid);
        cursor = processes.get(cursor.ppid);
        if (!cursor) break;
      }
      if (record.pid === this.scope.rootPid || ancestors.at(-1) === this.scope.rootPid) {
        this.store({ ...record, ancestors, seeded: true, dead: false });
      }
    }
  }

  store(record) {
    if (!this.records.has(record.pid) && this.records.size >= this.maxProcesses) {
      // Exited identities can be forgotten: an unknown identity is never given
      // a cached lineage, and must prove its current parent execution again.
      for (const [pid, value] of this.records) {
        if (value.dead) {
          this.records.delete(pid);
          break;
        }
      }
      if (this.records.size >= this.maxProcesses) {
        throw new CollectorError("Session process metadata limit reached; restart the collector.");
      }
    }
    this.records.set(record.pid, record);
    return record;
  }

  lineageFromParent(process) {
    const parent = this.records.get(process.parentPid ?? process.ppid);
    if (!parent || parent.dead || parent.seeded || !parent.ancestors ||
      process.parentVersion === undefined || process.parentVersion !== parent.pidversion) return undefined;
    const ancestors = [parent.pid, ...parent.ancestors];
    return validAncestors(ancestors, process.pid) ? ancestors : undefined;
  }

  observe(process) {
    const previous = this.records.get(process.pid);
    if (previous && olderIdentity(previous, process)) return undefined;
    if (previous?.dead && sameExecution(previous, process)) return undefined;
    if (previous && !previous.dead) {
      const matches = previous.seeded
        ? sameBirth(previous, process) && previous.ppid === process.ppid
        : sameExecution(previous, process);
      if (matches) return this.store({ ...previous, ...process, seeded: false });
      if (process.pid === this.scope.rootPid) {
        throw new CollectorError("The selected session process identity changed or cannot be verified. Reopen the canvas.");
      }
    }
    if (process.pid === this.scope.rootPid) {
      throw new CollectorError("The selected session process identity cannot be verified. Reopen the canvas.");
    }
    const ancestors = this.lineageFromParent(process);
    if (!ancestors) {
      if (previous) this.store({ ...process, dead: true, seeded: false });
      return undefined;
    }
    return this.store({ ...process, ancestors, dead: false, seeded: false });
  }

  fork(parentProcess, childProcess) {
    const parent = this.observe(parentProcess);
    if (childProcess.pid === parentProcess.pid || childProcess.ppid !== parentProcess.pid ||
      (childProcess.parentPid !== undefined && childProcess.parentPid !== parentProcess.pid) ||
      (childProcess.parentVersion !== undefined && childProcess.parentVersion !== parentProcess.pidversion)) {
      throw new CollectorError("Malformed eslogger fork process relationship.");
    }
    if (childProcess.pid === this.scope.rootPid) {
      throw new CollectorError("The selected session PID was reused. Reopen the canvas.");
    }
    const previous = this.records.get(childProcess.pid);
    if (previous && olderIdentity(previous, childProcess)) return;
    const ancestors = parent?.ancestors ? [parent.pid, ...parent.ancestors] : undefined;
    if (!ancestors || !validAncestors(ancestors, childProcess.pid)) {
      if (previous) this.store({ ...childProcess, dead: true, seeded: false });
      return;
    }
    if (previous?.dead && sameExecution(previous, childProcess)) return;
    this.store({ ...childProcess, ancestors, dead: false, seeded: false });
  }

  exec(source, target) {
    if (source.pid !== target.pid ||
      (source.startTime !== undefined && target.startTime !== undefined && !sameBirth(source, target))) {
      throw new CollectorError("Malformed eslogger exec process relationship.");
    }
    const record = this.observe(source);
    // pidversion changes on exec; only the native before/after pair preserves
    // a lineage across that change, not an executable name or responsible PID.
    if (record) this.store({ ...record, ...target, seeded: false });
    else this.observe(target);
  }

  exit(process) {
    if (process.pid === this.scope.rootPid) {
      throw new CollectorError("The selected Copilot session ended. Collection stopped; reopen the canvas from an active session.");
    }
    const record = this.records.get(process.pid);
    if (!record || (!record.seeded && !sameExecution(record, process))) return;
    this.store({ ...record, ...process, dead: true, seeded: false });
  }
}
