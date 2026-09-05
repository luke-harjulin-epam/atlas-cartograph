# Contributing

Use Node.js 22 or later. There are no npm dependencies to install.

Keep runtime code in `.apm/extensions/cartograph/` and documentation in `docs/`.
There is no generated duplicate of this source. Tests use Node's built-in runner
under `test/`; run `npm test` or a targeted `node --test` invocation.
Start a development server with `npm start` for both tracked `.atlas/local/`
development stores, or `npm start -- .atlas/local/mini-atlas` for only the sample.
The stress store has 505 baseline nodes and 1508 relationships; opening it does
not start load or monitoring. Keep synthetic data tracked in the repository,
not in session directories. See [.atlas/README.md](.atlas/README.md).
Keep the local mini Atlas and the self-contained packaged sample byte-identical.
Changes to these fixtures require `node --test test/development-atlases.test.mjs`.
Do not copy private Atlas content, collector logs or connection tokens into them.
Keep reusable scenarios in `scripts/dev/`, with offline dry-run defaults,
matching-fixture preflight and cleanup restricted to exclusively owned temporary
files. Use `node --test test/development-atlases.test.mjs test/development-scenarios.test.mjs`
for fixture/runner changes; integration coverage uses isolated copies, not load
against an active user's canvas. Run privileged/real-read scenarios only as an
explicit manual exercise. The synthetic preview must remain labelled and isolated
from real collector endpoints.

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
Cover bootstrap and SSE snapshot authorisation before filesystem work or stream
registration. Native EventSource needs `Accept: text/event-stream` and the
browser-controlled `Sec-Fetch-Site: same-origin`; other clients must send the
canvas header. Neither route may bypass canonical Host or Origin validation.
Exercise malformed/non-object JSON and the one-MiB byte boundary on canvas and
activity POST routes. Chunked oversized input must receive 413 before EOF.
Check that a preview relation, wiki link or external anchor acts exactly once,
including after a snapshot rerender. Exercise rapid layer edits, delayed
acknowledgements, stale snapshot revisions, errors and later external changes.
Search regressions must retain the newest typed text and caret through delayed
requests, accept empty queries and later external changes, and cover both HTTP
and canvas query revisions. All-layer state must include unnamed categories.
Exercise full-state transport reordering across bootstrap, SSE and action
replies, including deleted nodes, previews, phase timers and late failures.
Order activity-only events against activity embedded in full-state responses,
without discarding unrelated newer graph state. Cover reduced-motion changes
and animation/listener cleanup on both intro and welcome screens.
Discovery tests must distinguish symlink loops from permission/I/O failures.
Use operation-count bounds for long-chain, many-Atlas and disconnected layouts,
and preserve grouping labels and positions.
Receiver graph refreshes must preserve divergent lexical-alias observations
one-to-one, retain inactive aliases, and discard ambiguous or retargeted identities.
Keyboard browsing must reach every node through bounded pages, distinguish
same-title Atlas nodes, preserve focus on live updates and return from previews.
Renderer coverage must exercise the production mount, more than 5,000 edges,
shared playback/camera behaviour and WebGL initialisation/context-loss fallback.
Cover duplicate mount rejection and recovery, missing explicit Atlas targets,
single-store URI navigation, and unique edge IDs/degrees. Chat regressions must
exercise overlapping success/failure replies and pending entries trimmed from
history. Markdown blocks must work without blank lines around headings or quotes.
Relative-link cases must use duplicate basenames and confirm that graph edges
and preview navigation resolve the same source-directory target.
Use fake clocks to cover normal 400 ms spacing and adaptive 200/100/50 ms targets,
queue-age pressure, smooth acceleration/recovery, full displayed lifetimes,
repeat coalescing, endpoint pulse expiry, and pending-event cancellation.
Cover simultaneous visible aliases of a physical file, per-node observation
consumption, unchanged graphs and ID remapping without alias collapse or replay.
Keep layout output stable across input order and bound sibling lookup work with
an operation-count regression rather than a machine-dependent timing threshold.
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
Cover explicit same-root recovery after root or parent watcher failure, late
callbacks from replaced handles, and the absence of automatic retry loops.
Zero-byte page creation, selection and truncation must retain graph nodes.
Collector tests should use synthetic OS records and temporary Atlas fixtures,
not privileged monitoring of other users' files.
Provider recreation must retain the selected implementation and fail if it is
missing. Empty, excluded and paused batches must not establish Live status;
empty heartbeats after an accepted access must still work.

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
processes, viewer descendants, unrelated sessions, and PID reuse before and after
collector startup. A missing or reparented viewer must fail initial attribution.
Lifecycle-only streams must remain waiting and fail at EOF without going Live;
a later valid file-access record may enable Live. A manual
session-scoped demonstration must read the file through that session's tool
runner, not an unrelated terminal. Keep the privileged logger in the authorized
external terminal; do not move or broaden the session root to include it.

Update the relevant documentation and `CHANGELOG.md` for user-visible changes.

## CI contract

`.github/workflows/ci.yml` covers pull requests to `main`, pushes to `main`,
and `merge_group` events. Keep its aggregate **CI** job name stable and require
that status in the default-branch ruleset with up-to-date branches. It must fail
if either reusable workflow fails, is cancelled, or is skipped. Do not add path
filters that would leave the required check absent.

`validate.yml` checks all three package versions, parses every JavaScript file
with Node, and runs the full suite on Node.js 22 and 24 on Linux and macOS.
There are no npm dependencies, TypeScript compiler, or separate application build.
`package.yml` downloads checksum-pinned APM 0.29.0, verifies frozen resolution,
audits the producer lockfile, and builds the plugin archive. It installs that
exact archive in a fresh CommonJS consumer, audits its deployed-file integrity,
compares every deployed runtime file, and exercises default Atlas discovery,
every public HTML/JavaScript/CSS asset, and the authenticated bootstrap API.
Neither job starts a privileged collector.

For a local reproduction, run `npm run check:version`,
`npm run check:syntax`, `npm test`, and `npm run pack:release` with APM 0.29.0
on `PATH` (or set `APM_BIN` to its absolute path). The last command requires
an empty `build/release/`; move or remove only your previous generated output
before repeating it. Producer, consumer, `HOME`, and `APM_HOME` are temporary
and removed automatically. Packaging never deploys over the development shim.

APM 0.29.0 needs two packaging compatibility choices: avoid `pack --json`,
which can generate metadata without the bundle, and explicitly set
`pack --target copilot` so an isolated producer does not record an invalid
`minimal` target, even when `apm config set target copilot` has been used.
The latter flag is deprecated upstream but necessary for this pinned version.
The offline consumer's legacy canvas approval is confined to
the disposable test project. Do not broaden user-wide trust or bypass integrity
checks. When upgrading APM, update the binary checksum and script version
together and re-exercise the complete install path.

These isolated audits enforce lockfile and deployed-file consistency, not
organisation policy: the disposable projects have no Git remote for policy
discovery. Organisations needing additional policy gates must supply their
approved policy explicitly rather than infer compliance from these audits.

## Release procedure

1. Update `package.json`, `.apm/extensions/cartograph/package.json`, and the
   double-quoted top-level version in `apm.yml` together. Move the corresponding
   `Unreleased` changelog entries into a dated version section.
2. Merge that version change through a reviewed PR with **CI** passing.
3. From the reviewed commit in `main`, create and push a new, never-used tag:
   `git tag vX.Y.Z && git push origin vX.Y.Z`. A prerelease such as
   `vX.Y.Z-rc.1` must also match all three manifests.
4. Inspect the **Release** workflow in Actions. Its validate/build/publish/release
   stages rerun the gates on the tagged commit, upload an archive, `.sha256`,
   and `release.json` into a draft, then recheck the tag's commit and exact
   uploaded asset names before publishing.

Actions must be enabled and the repository must allow the workflow's explicit
`contents: write` permissions on the publication jobs. No additional secrets
are required: the built-in `GITHUB_TOKEN` performs release writes. PR jobs
remain read-only, third-party actions are commit-pinned, and credentials are
not persisted in checkouts. Repository code is not executed in publication jobs.
Auto-generated notes use `.github/release.yml` and PR labels.

After downloading the release assets, verify with
`shasum -a 256 -c atlas-cartograph-X.Y.Z.tar.gz.sha256` (or `sha256sum -c` on
Linux), then install the archive with APM's experimental canvas support and
the appropriate consumer approval. Source installation pinned to `#vX.Y.Z`
remains supported; no separate package registry is involved.

If validation or building fails, nothing is published. If uploading or final
publication fails, inspect the retained draft and failed run before recovery.
Rerunning a failed final publication job can finish its existing draft; a full
rerun deliberately refuses an existing release. Only after confirming a draft
was never published may its owner delete that failed draft and rerun. Never
delete/recreate a published release or force-move a tag: ship a new version.
