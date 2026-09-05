# Contributing

Use Node.js 22 or later. There are no npm dependencies to install.

Keep code in `src/` and documentation in `docs/`. Tests use Node's built-in
runner under `test/`; run `npm test` or a targeted `node --test` invocation.
Start a development server with `npm start -- ./src/fixtures/mini-atlas`.

To exercise the Copilot canvas, reload project extensions. Select the
`project:cartograph` provider if a user-installed copy also exists. Do not copy
changes into another user's or another session's installed extension.

For renderer changes, inspect both WebGL and Canvas 2D paths, reduced-motion
behavior, selection, and the return to baseline after activity expires.
Use fake clocks to cover normal 400 ms spacing and adaptive 200/100/50 ms targets,
queue-age pressure, smooth acceleration/recovery, full displayed lifetimes,
repeat coalescing, endpoint pulse expiry, and pending-event cancellation.
Use a triangular graph to prove that A -> B -> C never pulses A -> C. Cover
revisits, unrelated consecutive nodes, and removal of intermediate nodes;
recorded segments must not be reconstructed from the current active-node order.
Browser-asset changes need only a page refresh, not an extension reload or
collector restart.
Cover automatic camera framing with fake clocks: default-on/off controls,
single and widely spread activations, changed relationship endpoints (including
deletion ghosts), query/layer filtering, five-second manual override, selection,
reduced-motion suppression, throttled fitting and restoration after idle.
The camera follows displayed effects, independently of collector settings.
Also cover simultaneous manual orbit and automatic pan/zoom, pointer capture,
front-facing surface normals, dispersed/opposing targets, angular wraparound,
bounded critically damped motion, zoom-in hysteresis and manual-angle restoration.
Backend watcher changes require a server/extension restart, unlike browser-only
changes. A reopened canvas has a new read-collector command; ordinary graph
watching starts automatically without that collector.
Collector tests should use synthetic OS records and temporary Atlas fixtures,
not privileged monitoring of other users' files.

Live macOS collector testing is an explicit manual step requiring administrator
authorization and Full Disk Access. Keep only the system logger privileged.
Report collector limitations accurately; see [monitoring](docs/file-access.md).
Never commit tokens, full system event streams, or private Atlas contents.

New monitor implementations follow the
[provider contract](docs/monitor-providers.md). Keep their parser, permissions,
capabilities and setup text separate from shared transport and graph behavior.
Prove substitution with a synthetic provider before testing privileged OS
integration. Do not change the existing default or silently fall back to
write-only coverage as part of adding a provider.

Directory watching is a separate replaceable component, not a fallback read
provider. Use `startServer(..., { graphWatch: { watcherFactory } })` to inject
a source implementing `setRoots(absolutePaths)` and `close()` and invoking
`onChange(root)` / `onStatus({status, message})`. Native `fs.watch` is the default.
Test it with temporary folders, including nested creation, atomic saves, root
replacement, multi-root ID collisions, debounce/close cancellation and failures.
Lifecycle rendering tests must cover first mount vs filesystem creation, deleted
ghost expiry, non-interactivity, reduced motion, and independent read activity.
Check node and edge opacity at 0, 1000 and 2000 ms; overlay-only fades are not
enough. Freeze simulation time to confirm that completed wall-clock fades do
not restart the legacy node entrance animation.
Exercise unique-file bursts and sustained repeated traffic with deterministic
clocks. Verify one activation per frame, per-node bounded queues, exact sequence
counter deltas (including same-millisecond batches), no invented paths after
aggregation, and throttled load/status UI. Unknown capture loss must not be
reported as zero; cancelled graph observations are not collector drops.
Cover relationship additions between existing nodes as well as new nodes:
the edge fades in with a brief green glow, does not enter read playback, and
returns to normal after 2000 ms. Mounts, filters and unchanged links must not glow.
Deleted relationships must fade red for 2000 ms without staying in the live
graph or read path. Cover surviving/missing endpoints, camera projection,
recreation, relationship-layer filters and deletion during an unfinished birth.

For process-scoped monitoring, cover current-session tools, short-lived child
processes, viewer descendants, unrelated sessions, and PID reuse. A manual
session-scoped demonstration must read the file through that session's tool
runner, not an unrelated terminal. Keep the privileged logger in the authorized
external terminal; do not move or broaden the session root to include it.

Update the relevant documentation and `CHANGELOG.md` for user-visible changes.
