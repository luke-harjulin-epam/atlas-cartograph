# Contributing

Use Node.js 22 or later. There are no npm dependencies to install.

Keep runtime code in `.apm/extensions/cartograph/` and documentation in `docs/`.
There is no generated duplicate of this source. Tests use Node's built-in runner
under `test/`; run `npm test` or a targeted `node --test` invocation.
Start a development server with `npm start` for workspace `.atlas/` mounts, or
`npm start -- ./.apm/extensions/cartograph/fixtures/mini-atlas` for the sample.

To exercise the Copilot canvas, reload project extensions. Select the
`project:cartograph` provider if a user-installed copy also exists. Do not copy
changes into another user's or another session's installed extension.

`apm.yml` declares only the self-contained canvas directory. Keep its version,
the runtime `package.json` and root `package.json` aligned. Application imports,
browser assets, collectors and fixtures must resolve within the bundle.
The repository discovery shim is not distribution source; do not run a
first-party APM deployment over that locally authored shim.

After dependency changes, run `apm lock --target copilot`. Use
`npm run pack:apm -- --dry-run` to inspect the bundle or `npm run pack:apm` to
create it under ignored `build/`. APM's plugin format preserves canvas assets;
the legacy `--format apm` path is not suitable for this canvas-only package
with APM 0.29.0. Packing may generate `.github/plugin/plugin.json` metadata.
For installation testing, use a disposable consumer and an isolated APM home
(set both `HOME` and `APM_HOME`; `APM_HOME` alone does not isolate config in 0.29.0),
enable the experimental `canvas` flag there, and approve only this package.
Never change user-wide executable trust or install globally as part of tests.
With APM 0.29.0, source dependency approval must use its exact dependency key
under `executables.allow`: the repository reference for remote installs, or the
literal dependency path for local installs. The offline plugin-bundle installer
instead reads `allowExecutables` keyed by bundle name; keep that legacy
compatibility setting confined to disposable bundle consumers. Do not grant
other executable types to silence unrelated APM warnings.
Keep lockfiles and canonical `.apm/` source; do not commit `apm_modules/`, built
archives or local browser artifacts. A license has not been declared for this
package; do not add an SPDX license without an explicit licensing decision.

For renderer changes, inspect both WebGL and Canvas 2D paths, reduced-motion
behavior, selection, and the return to baseline after activity expires.
Preserve visible keyboard focus and local-only assets. HTTP route changes must
retain same-origin/custom-header checks and JSON-only mutation requests;
page-loading changes must preserve mounted-root containment and Atlas identity.
Cover duplicate mount rejection and recovery, missing explicit Atlas targets,
single-store URI navigation, and unique edge IDs/degrees. Chat regressions must
exercise overlapping success/failure replies and pending entries trimmed from
history. Markdown blocks must work without blank lines around headings or quotes.
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
