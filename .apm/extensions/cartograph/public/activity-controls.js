import { DEFAULT_ACTIVITY_DURATION_MS } from "./activity-rendering.js";
import { ACTIVITY_SPACING_MS, MIN_ACTIVITY_SPACING_MS } from "./activity-playback.js";

export function playbackStatus(playback) {
  const pending = playback?.pendingCount ?? 0;
  const lag = (playback?.oldestPendingMs ?? 0) / 1000;
  const spacing = Math.round(playback?.spacingMs ?? ACTIVITY_SPACING_MS);
  return {
    status: pending > 40 || lag >= 5 ? "overloaded" : pending > 5 || lag >= 2 ? "catching-up" : "normal",
    summary: pending ? `${pending} queued · ${lag.toFixed(1)}s lag · ${spacing} ms` : `${spacing} ms`,
    detail: `${pending} pending; oldest waiting ${lag.toFixed(1)}s; ${spacing} ms between activations. ` +
      `${playback?.aggregatedCount ?? 0} observations merged; ${playback?.cancelledCount ?? 0} pending observations cancelled by graph changes. ` +
      "Counts cover received observations, not individual read syscalls. Capture loss is unknown; collector errors appear above.",
  };
}

export function activityStatus(activity, connected = true) {
  if (activity?.enabled === false) return { label: "Off", status: "paused", message: "Activity highlighting is off." };
  if (!connected) return { label: "Disconnected", status: "disconnected", message: "Canvas connection lost. Reconnecting…" };
  const status = activity?.collector?.status || "waiting";
  const labels = { live: "Live", waiting: "Waiting", disconnected: "Disconnected", error: "Error", unsupported: "Unsupported", paused: "Off" };
  return {
    status, label: labels[status] || "Waiting",
    message: activity?.collector?.message || "Waiting for activity from the selected provider. Follow its setup instructions below.",
  };
}

export function activityDuration(seconds) {
  const durationMs = Math.round(Number(seconds) * 1000);
  if (!Number.isFinite(durationMs) || durationMs < 100 || durationMs > 300000) {
    throw new Error("Highlight duration must be between 0.1 and 300 seconds.");
  }
  return durationMs;
}

export function activityScopeLabel(scope) {
  if (scope?.mode === "session") {
    return `Scope: this Copilot session (PID ${scope.rootPid}) and its tool processes. Cartograph and its child processes are excluded.`;
  }
  if (scope?.mode === "all") return "Scope: all applications, excluding Cartograph.";
  return "Waiting for process-scope information.";
}

export async function requestActivity(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    cache: "no-store",
    headers: { "X-Cartograph-Client": "canvas", ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error || body?.message || `Activity request failed (${response.status}).`);
  if (!body) throw new Error("Invalid activity response from the server.");
  return body;
}

export function mountActivityControls(root, onActivity, onAutoFocus = () => {}) {
  const get = (id) => root.querySelector(`#${id}`);
  const enabled = get("activity-enabled");
  const autoFocus = get("activity-auto-focus");
  autoFocus.checked = true;
  autoFocus.addEventListener("change", () => onAutoFocus(autoFocus.checked));
  const duration = get("activity-duration");
  const save = get("activity-save");
  const configError = get("activity-config-error");
  const connectionError = get("activity-connection-error");
  const connectionStatus = get("activity-connection-status");
  const command = get("activity-command");
  const retry = get("activity-retry");
  get("activity-spacing").textContent = `Adaptive playback: 1–5 queued = 400 ms, 6–15 = 200 ms, 16–40 = 100 ms, 41+ = ${MIN_ACTIVITY_SPACING_MS} ms. Older queues also accelerate. Speed changes smoothly; highlights keep their full lifetime. Repeated observations merge; uncertain path segments are not drawn. File reads and graph changes are not delayed.`;
  let activity;
  let connected = true;
  let saving = false;
  let connectionRequest;
  let providerKey;
  let playback;
  let playbackKey;

  function renderPlayback() {
    const status = playbackStatus(playback);
    get("activity-playback-status").textContent = status.summary;
    get("activity-playback-status").dataset.status = status.status;
    get("activity-playback-detail").textContent = status.detail;
    const repeats = [
      ...(playback?.repeatedNodes ?? []).map((entry) => ({ ...entry, kind: "node" })),
      ...(playback?.repeatedEdges ?? []).map((entry) => ({ ...entry, kind: "edge" })),
    ];
    const key = JSON.stringify(repeats);
    if (key === playbackKey) return;
    playbackKey = key;
    get("activity-repeat-counts").replaceChildren(...repeats.slice(0, 8).map((entry) => {
      const item = document.createElement("li");
      item.textContent = entry.kind === "edge"
        ? `${entry.count} traversals; latest direction: ${entry.label || entry.id}`
        : `${entry.label || entry.id}: ${entry.count} observations`;
      return item;
    }));
    get("activity-repeat-more").textContent = repeats.length > 8 ? `${repeats.length - 8} more repeated items highlighted.` : "";
  }

  function renderProvider() {
    const provider = activity?.provider;
    const nextKey = JSON.stringify(provider ?? null);
    if (providerKey === nextKey) return;
    providerKey = nextKey;
    const text = (value, fallback = "") => typeof value === "string" ? value : fallback;
    const setup = provider?.setup;
    get("activity-provider-label").textContent = text(provider?.label);
    get("activity-provider-label").classList.toggle("hidden", !provider?.label);
    get("activity-setup-title").textContent = text(setup?.title, "Activity provider setup");
    get("activity-setup-description").textContent = text(setup?.description, text(provider?.description, "Waiting for provider setup information."));
    const steps = Array.isArray(setup?.steps) ? setup.steps.filter((step) => typeof step === "string") : [];
    get("activity-setup-steps").replaceChildren(...steps.map((step) => {
      const item = document.createElement("li");
      item.textContent = step;
      return item;
    }));
    const notice = text(setup?.notice, "Connection details are private. Do not share them.");
    get("activity-setup-notice").textContent = notice;
    get("activity-setup-notice").classList.toggle("hidden", !notice);
  }

  function render() {
    renderProvider();
    renderPlayback();
    const status = activityStatus(activity, connected);
    root.dataset.status = status.status;
    get("activity-status").textContent = status.label;
    get("activity-message").textContent = status.message;
    get("activity-scope").textContent = activityScopeLabel(activity?.scope);
    enabled.checked = activity?.enabled !== false;
    enabled.disabled = saving;
    duration.disabled = saving;
    save.disabled = saving;
    save.textContent = saving ? "Saving…" : "Save";
    if (document.activeElement !== duration) duration.value = String((activity?.durationMs ?? DEFAULT_ACTIVITY_DURATION_MS) / 1000);
  }

  function error(el, message = "") {
    el.textContent = message;
    el.classList.toggle("hidden", !message);
  }

  async function configure(next) {
    if (saving) return;
    saving = true;
    error(configError);
    render();
    try {
      const result = await requestActivity("/api/activity/config", { method: "POST", body: JSON.stringify(next) });
      activity = result;
      duration.value = String(result.durationMs / 1000);
      onActivity(result);
    } catch (err) {
      error(configError, `Settings were not saved. ${err.message}`);
    } finally {
      saving = false;
      render();
    }
  }

  async function loadConnection() {
    if (!root.open) return;
    connectionRequest?.abort();
    const request = new AbortController();
    connectionRequest = request;
    command.textContent = "";
    get("activity-command-wrap").classList.add("hidden");
    connectionStatus.textContent = "";
    connectionStatus.classList.add("hidden");
    retry.disabled = true;
    retry.textContent = "Loading connection…";
    error(connectionError);
    try {
      const result = await requestActivity("/api/activity/connection", { signal: request.signal });
      if (request.signal.aborted || !root.open) return;
      if (result.command === null) {
        connectionStatus.textContent = "Connection ready. This provider reports activity directly; follow its setup instructions. No terminal command is required.";
        connectionStatus.classList.remove("hidden");
      } else {
        if (typeof result.command !== "string" || !result.command.trim()) throw new Error("The server did not return a valid activity command.");
        command.textContent = result.command;
        get("activity-command-wrap").classList.remove("hidden");
      }
    } catch (err) {
      if (!request.signal.aborted) error(connectionError, `Could not load the activity connection. ${err.message}`);
    } finally {
      if (connectionRequest === request) {
        retry.disabled = false;
        retry.textContent = "Refresh connection";
      }
    }
  }

  enabled.addEventListener("change", () => configure({
    enabled: enabled.checked, durationMs: activity?.durationMs ?? DEFAULT_ACTIVITY_DURATION_MS,
  }));
  get("activity-form").addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      configure({ enabled: activity?.enabled !== false, durationMs: activityDuration(duration.value) });
    } catch (err) {
      error(configError, err.message);
    }
  });
  root.addEventListener("toggle", () => {
    if (root.open) loadConnection();
    else {
      connectionRequest?.abort();
      command.textContent = "";
      get("activity-command-wrap").classList.add("hidden");
      connectionStatus.textContent = "";
      connectionStatus.classList.add("hidden");
    }
  });
  retry.addEventListener("click", loadConnection);
  render();
  return {
    autoFocusEnabled: () => autoFocus.checked,
    setActivity(next) { activity = next; if (next?.enabled === false) playback = null; render(); },
    setPlayback(next) { playback = next; renderPlayback(); },
    setConnected(next) { connected = next; render(); },
  };
}
