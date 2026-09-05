import { isAbsolute } from "node:path";

/**
 * @typedef {{path: string, pid: number, kind: "read"|"write"|"read-write"|"open", ancestors?: number[]}} AccessEvent
 * Paths identify graph files on the receiver's host. No file contents or raw OS records cross this boundary.
 */
export const MAX_BATCH = 128;
export { MAX_JSON_BODY_BYTES as MAX_POST_BYTES } from "../http.mjs";
export const MAX_MESSAGE_LENGTH = 500;
export const ACCESS_KINDS = new Set(["read", "write", "read-write", "open"]);
export const COLLECTOR_STATUSES = new Set(["waiting", "live", "error", "disconnected"]);

export const validPath = (path) =>
  typeof path === "string" && path.length <= 4096 && isAbsolute(path) && !path.includes("\0");
export const validPid = (pid) => Number.isSafeInteger(pid) && pid > 0 && pid <= 2147483647;
export const validAncestors = (ancestors, pid) => ancestors === undefined ||
  (Array.isArray(ancestors) && ancestors.length <= 64 && ancestors.every(validPid) &&
    !ancestors.includes(pid) && new Set(ancestors).size === ancestors.length);
export const validAccessEvent = (event) =>
  Boolean(event && validPath(event.path) && validPid(event.pid) && ACCESS_KINDS.has(event.kind) &&
    validAncestors(event.ancestors, event.pid));

export class CollectorError extends Error {
  constructor(message) {
    super(message);
    this.name = "CollectorError";
  }
}
