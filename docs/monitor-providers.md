# Replaceable monitor providers

`macos-eslogger` is the only shipped implementation and remains the default.
Providers do not grant permissions or automatically fall back to weaker
coverage. Copilot canvases use current-session process scope; standalone
development servers retain all-application scope. The highlight default
remains five seconds.

## Boundaries

Provider-specific responsibilities live in `.apm/extensions/cartograph/activity/providers/`:

- Public identity, supported operations, permission requirements, and setup text.
- Platform availability and explicit connection instructions.
- Optional decoding of producer-specific line-stream records.
- Accurate observation limitations and producer-specific diagnostics.

The shared receiver and transport retain authentication, exact-path scoping,
PID exclusions, queue limits, batching, heartbeats, error handling, and shutdown.
Process-scope filtering is shared; the provider supplies the process ancestry
needed to support a session-scoped receiver.
`model.mjs` owns raw observation timing and co-active graph relationships.
Browser playback consumes normalized activity and records the displayed
activation path independently. Neither needs changes when adding a monitor.

External components can report directly to the receiver without using the
line-stream collector or producing any `eslogger`-shaped data.

## Provider interface

`MonitorProvider` is documented in `.apm/extensions/cartograph/activity/providers/index.mjs`. A provider
exports an object with:

| Member | Contract |
| --- | --- |
| `metadata` | Secret-free `id`, `label`, `description`, `permissions`, `operations`, and `setup` |
| `metadata.setup` | Plain-text `title`, `description`, `steps` array, and `notice`; rendered without HTML execution |
| `metadata.processScopes` | Supported `all` and/or `session` modes; omitted means all-only |
| `availability(platform)` | Synchronous `{ supported, message }`; platform support is not proof that monitoring is live |
| `waitingMessage` | Initial non-live guidance, at most 500 characters |
| `createConnection({ endpoint, token, collectorPath, scope })` | Returns or resolves to `{ command }`; use `null` for a directly reporting component |
| `stream` | Optional `{ parseLine, messages }` for producers using the shared line-stream collector |
| `stream.createParser({ scope, signal })` | Optional async factory returning a per-run line parser, e.g. a process ancestry tracker; honor cancellation during initialization |

Operations are a non-empty subset of `open`, `read`, `write`, and `read-write`.
Permissions may be an empty array. The receiver rejects undeclared operations.
Describe observation semantics accurately: an open is not proof that bytes were
read, and a filesystem change notification is not a read event.

`stream.parseLine(line)` is synchronous and returns either:

```js
{ type: "event", valid: true, event: { path, pid, kind } }
{ type: "ignored", valid: false, reason: "unrelated" }
```

A structurally valid producer event that should not activate a node can use
`{ type: "ignored", valid: true, reason: "unmodified" }`. Only valid observations
allow the shared collector to advertise `live`; starting a process or sending
a heartbeat is insufficient.

Throw `CollectorError` from `activity/protocol.mjs` with a redacted diagnostic
when parsing fails. Do not embed raw records, unrelated paths, or credentials.
`stream.messages` provides `limitations`, `waiting`, `ended`, `emptyEnd`,
`inputError`, `closed`, and `oversizedLine` text, each at most 500 characters.

The shared transport independently validates decoded events, removes extra
producer fields, checks operation capabilities, and filters target paths/PIDs
and process scope before sending data. A direct-reporting component must
implement the equivalent filtering and lifecycle requirements itself.
Declare session support only when the component can attribute accesses to the
selected root reliably. Unsupported scopes fail explicitly; they are never
downgraded to all-application monitoring.

## Register and select

Add an implementation module beside `eslogger.mjs`, then include it in the
registry's provider array. Keep `DEFAULT_MONITOR_PROVIDER` unchanged unless a
deliberate default migration is approved.

```js
const registry = createMonitorRegistry(
  [esloggerProvider, anotherProvider],
  DEFAULT_MONITOR_PROVIDER,
);
```

For application embedding or isolated tests, inject the registry into the
existing server:

```js
const entry = await startServer("example", state, {
  activity: {
    registry,
    providerId: "another-provider",
    scope: { mode: "session", rootPid: sessionPid, excludePids: [] },
  },
});
```

The canvas open input `monitorProvider` lists registered IDs. It defaults to the
registry default. The CLI accepts `--provider ID` alongside `--url URL`; omitting
the provider retains backwards-compatible default behavior. Commands generated
by a provider should explicitly identify its stream adapter when applicable.

Selection is per canvas and fixed for its lifetime. Unknown IDs and invalid
provider definitions fail explicitly. Unsupported providers show `unsupported`;
they do not silently switch to another registered implementation. Opening a new
canvas is required to switch an existing canvas's provider.

The Copilot extension supplies its parent CLI PID as the session root and
excludes its own process subtree. A standalone embedder can supply an explicit
scope as above; omitting scope keeps the standalone all-application behavior.
The session root cannot be the receiver itself, because the receiver's entire
subtree is excluded. Copilot uses the receiver's parent CLI process.
`activity/process-scope.mjs` defines scope validation and matching. All modes
exclude the receiver itself; session mode also excludes events whose ancestor
chain passes through an excluded PID.

`test/monitor-providers.test.mjs` contains a synthetic second implementation
exercising both a different stream parser and direct reporting. It is not
registered or available to production users.

## Normalized receiver protocol

All requests are loopback-only. A component obtains per-canvas connection
details through `GET /api/activity/connection` using the
`X-Cartograph-Client: canvas` header and a same-origin request. Its response
contains `endpoint`, `token`, `pid`, `providerId`, `scope`, and `command`. Do not persist
or publish the token. In a browser, this endpoint must be called from the
canvas origin; it is not a cross-origin discovery API.

Collector requests authenticate with `Authorization: Bearer <token>`:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/activity/targets` | `{ providerId, scope, paths, ignorePids }`; empty paths while paused |
| `POST /api/activity/events` | JSON `{ events, status, message? }`; returns `{ ok: true, accepted }` |

Refresh targets approximately every two seconds. Match exact absolute paths,
including the canonical/lexical aliases supplied by the receiver; never use
basename or loose directory-prefix matching. Ignore listed PIDs and the
component's own reads. A provider ID mismatch must fail rather than interpret
another implementation's stream.

Scope is `{ mode: "all", excludePids: [...] }` or
`{ mode: "session", rootPid, excludePids: [...] }`. It is immutable during a
collector run; a changed scope requires a restart. The eslogger provider uses
fork/exec/exit records to track short-lived children and does not use the
whole host application's responsible-process identity as a session identity.

Each event contains only:

```js
{ path: "/absolute/atlas/page.md", pid: 123, kind: "read", ancestors: [120, 100] }
```

`pid` is a positive 32-bit process ID. Paths are at most 4096 characters and
contain no NUL. Batches have at most 128 events and the entire JSON body must
fit within 1 MiB. `status` is `waiting`, `live`, `error`, or `disconnected`;
optional messages are at most 500 characters. Send an empty heartbeat batch
approximately every two seconds; the receiver marks a missing heartbeat as
disconnected after 6.5 seconds. The receiver additionally validates every
event against the selected provider and currently open graphs.

`ancestors` is optional in all-application mode. In session mode it is required
for non-root processes and must contain the session root for an event to be
included. Lists run from immediate parent toward the root, contain at most 64
unique valid PIDs, and cannot contain the event's own PID. Excluded ancestors
reject the whole subtree. Do not fabricate ancestry when attribution fails.
The scope checks trust the authenticated provider's OS metadata; they are not
a security boundary against a component that already possesses the token.

Do not retry after authorization failures, follow redirects carrying tokens,
retain a system-wide access history, or claim success after malformed input.
Report errors visibly. On stop, drain bounded pending work if appropriate,
report a terminal status, and stop timers and network requests. A canvas closes
its receiver on shutdown; externally managed producers must stop when that
receiver disappears. No provider is automatically granted elevated privileges.

## Future non-privileged providers

Possible implementations include ordinary filesystem-change watchers,
cooperating Copilot tools, editor integrations, or opt-in wrappers. These can
use the same protocol with `permissions: []`, but their coverage differs from
system-wide monitoring. See [coverage and tradeoffs](file-access.md#options-without-administrator-privileges).
No such access provider is enabled. The ordinary directory watcher now runs
separately for live graph synchronization and creation/deletion effects; it
does not emit this access protocol or inherit the selected provider's process
scope. Its replacement interface is documented in [architecture](architecture.md).
