import { randomUUID } from "node:crypto";

export const CHAT_TIMEOUT_MS = 10 * 60 * 1000;
export const MAX_CHAT_REPLY_BYTES = 128 * 1024;

function invalid(code, message) {
  return Object.assign(new Error(message), { code });
}

export function createChatRequests(state, {
  onChange = () => {},
  timeoutMs = CHAT_TIMEOUT_MS,
  schedule = setTimeout,
  unschedule = clearTimeout,
} = {}) {
  const timers = new Map();
  let closed = false;

  function release(id) {
    if (!timers.has(id)) return;
    unschedule(timers.get(id));
    timers.delete(id);
  }

  function find(id) {
    if (closed) throw invalid("chat_closed", "This chat is closed.");
    const message = state.chat?.find((item) => item.role === "graph" && item.id === id);
    if (!message) throw invalid("chat_request_missing", "This chat request is no longer available.");
    return message;
  }

  function finish(message, status, text, hits = []) {
    release(message.id);
    Object.assign(message, { status, text, hits, pending: false });
    onChange();
  }

  return {
    begin(text, sessionChat = true) {
      if (closed) throw invalid("chat_closed", "This chat is closed.");
      const id = randomUUID();
      const message = {
        id, role: "graph", pending: true, hits: [],
        status: sessionChat ? "queued" : "working",
        text: sessionChat ? "Waiting for Copilot…" : "Searching the Atlas…",
      };
      state.chat = [...(state.chat ?? []), { role: "user", text }, message].slice(-50);
      const retained = new Set(state.chat.map((item) => item.id));
      for (const requestId of timers.keys()) {
        if (!retained.has(requestId)) release(requestId);
      }
      const timer = schedule(() => {
        if (!closed && state.chat.includes(message) && message.pending) {
          finish(message, "expired", "No reply arrived in time. Please send your question again.");
        }
      }, timeoutMs);
      timer?.unref?.();
      timers.set(id, timer);
      return id;
    },

    update(id, { status, text } = {}) {
      const message = find(id);
      if (!["working", "answered", "failed"].includes(status)) {
        throw invalid("invalid_chat_reply", "Chat status must be working, answered or failed.");
      }
      if (status !== "working" && (typeof text !== "string" || !text.trim() ||
          Buffer.byteLength(text, "utf8") > MAX_CHAT_REPLY_BYTES)) {
        throw invalid("invalid_chat_reply", "A nonempty reply of at most 128 KiB is required.");
      }
      const content = status === "working" ? "Working…" : text.trim();
      if (!message.pending) {
        if (message.status === status && message.text === content) {
          return { ok: true, requestId: id, status, duplicate: true };
        }
        throw invalid("chat_request_finished", "This chat request has already finished.");
      }
      if (status === "working") {
        if (message.status !== "working") {
          Object.assign(message, { status, text: content });
          onChange();
        }
      } else {
        finish(message, status, content);
      }
      return { ok: true, requestId: id, status };
    },

    completeLocal(id, reply) {
      if (closed) return;
      const message = state.chat?.find((item) => item.id === id);
      if (message?.pending) finish(message, "answered", reply.text || "No reply.", reply.hits || []);
    },

    fail(id, error) {
      if (closed) return;
      const message = state.chat?.find((item) => item.id === id);
      if (message?.pending) finish(message, "failed", `Session query failed: ${error?.message ?? error}`);
    },

    close() {
      closed = true;
      for (const id of timers.keys()) release(id);
      for (const message of state.chat ?? []) {
        if (message.pending) Object.assign(message, {
          pending: false, status: "cancelled", text: "Chat closed before a reply arrived.",
        });
      }
    },
  };
}
