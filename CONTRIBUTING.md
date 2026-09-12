# Contributing

Use Node.js 22 or later. There are no npm dependencies to install.

Keep runtime code in `.apm/extensions/cartograph/` and documentation in `docs/`.
There is no generated duplicate of this source. Tests use Node's built-in runner
under `test/`; run `npm test` or a targeted `node --test` invocation.
Schema changes need `test/atlas-schema.test.mjs`, frontend interaction, live
reload and renderer coverage. Invent synthetic domain fixtures; never copy or
lightly anonymize consumer schemas. Exercise empty types, colliding mounted
contributions, schema-only changes, receipts, invalid metadata and confinement.
Cover untyped `index.md`, explicit undeclared `type: index`, and declared index
types separately; labels must agree across controls, islands and navigation.
Do not treat `claimed_folders` as knowledge placement or add native compiler
validation to the viewer.
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
For native startup/action changes, run
`node --test test/native-extension.test.mjs test/atlas-live.test.mjs`.
The harness imports the unmodified canonical entrypoint and a copied deployment
in a CommonJS consumer, replacing only the SDK transport through a Node module
loader. It checks hookless registration, caller/metadata precedence, missing and
invalid workspaces, installed-directory launches, absolute/relative roots,
isolated caller contexts, action dispatch and process-scoped activity metadata.
It never starts a privileged collector. Keep this synthetic harness separate
from the runtime bundle. A passing harness or standalone HTTP server does not
prove compatibility with the real host's experimental canvas protocol.
Before release, exercise the exact packaged runtime in a session-scoped host
installation, including default discovery, `get_state`, `set_layers`,
`select_node` and `reload`, without source edits or preview-only shims.

`apm.yml` declares the self-contained canvas directory and an APM dependency on
`atlas` from marketplace `atlas` (`sergio-sisternes-epam/atlas-marketplace`).
Keep its version,
the runtime `package.json` and root `package.json` aligned. Application imports,
browser assets, collectors and fixtures must resolve within the bundle.
The build badge reads this runtime's version and source-checkout SHA, marking
uncommitted runtime changes. Release packaging stamps `cartographBuild` and
`cartograph-build.json` in the isolated producer, never the canonical source or
generated plugin manifest. Source checkouts prefer Git so a stale stamp cannot
hide local edits. Deployed bundles must not read the consumer's Git identity;
unsubstituted or missing stamps show an unavailable SHA. Cover both paths with
`test/build-info.test.mjs` and the package smoke checks.
The repository discovery shim is not distribution source; do not run a
first-party APM deployment over that locally authored shim.

After dependency changes, run `apm lock --target copilot`. APM 0.30.0 lockfiles
record git coordinates for marketplace plugins, so `apm install --frozen` and
`apm audit --ci` look for `_marketplace/atlas/atlas` and fail ref-consistency.
Replay with a normal install and `apm audit --no-policy --no-fail-fast` when
checking the Atlas graph; canvas packaging checks lock identity instead of
fetching private Atlas. Use `npm run pack:apm -- --dry-run` to inspect the
bundle or `npm run pack:apm` to
create it under ignored `build/`. APM's plugin format preserves canvas assets;
the legacy `--format apm` path is not suitable for this canvas-only package
with APM 0.30.0. Packing may generate `.github/plugin/plugin.json` metadata.
For installation testing, use a disposable consumer and an isolated APM home
(set both `HOME` and `APM_HOME` to isolate configuration),
enable the experimental `canvas` flag there, and approve only this package.
Never change user-wide executable trust or install globally as part of tests.
With APM 0.30.0, source dependency approval must use its exact dependency key
under `executables.allow`: the repository reference for remote installs, or the
literal dependency path for local installs. The offline plugin-bundle installer
instead requires an exact `name#version@sha256:<digest>` key in
`executables.allow`. The packer first probes a disposable consumer with an
explicit empty allow-map, asserts that no files were deployed, then grants only
canvas access to the validated identity printed by APM. Omitting the executable
block enables legacy permissive behavior and is not an approval test. Do not grant
other executable types to silence unrelated APM warnings.
Keep lockfiles and canonical `.apm/` source; do not commit `apm_modules/`, built
archives or local browser artifacts. The project is licensed under Apache
License 2.0; keep the root license and SPDX declarations in `apm.yml` and both
package manifests aligned.

For renderer changes, inspect both WebGL and Canvas 2D paths, reduced-motion
behavior, selection, and the return to baseline after activity expires.
Exercise the floating status bar beside chat and at narrow widths: zoom stays
independent of the activation disclosure, Escape restores focus, and private
connection details load only for Collector setup and clear when it closes.
Cover the View popup with large group lists, duplicate labels, live updates,
keyboard navigation and selection; it must not change search or layer filters.
For activation settings, cover duration drafts across blur, updates, toggle
saves and failures; Cancel uses the latest confirmed value. Keep setup metadata
provider-owned, render diagnostics literally, and verify reduced-motion status
and normal-text contrast without starting a collector.
Information popups need keyboard/focus, outside dismissal, live-text, owner
closure and narrow-viewport coverage. Keep private commands out of help copies
and keep operational errors and permission warnings visible.
For Options, cover the fixed header and scrolling body with long Atlas/schema
identities, chat open and closed, and the Other pages disclosure. Layout, node
layers and link visibility remain independent; live updates must retain focus
on Atlas controls and preserve disclosure state.
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
history. The SDK stub must return a message ID from `send`, never pretend to
return assistant text. Cover `update_chat` progress/completion, identical retries,
foreign owners/instances, timeout and close cleanup with
`node --test test/session-chat.test.mjs test/native-extension.test.mjs test/frontend-interactions.test.mjs`.
The native harness exercises callbacks in both canonical and copied deployments;
also verify an actual host question/read/reply cycle in the canvas drawer.
Keep chat revision coverage across HTTP/native snapshots, progress, completion,
failure, expiry and cancellation. Duplicate callbacks and non-chat changes must
not advance it. Use serialization-count regressions with large answers to prove
unchanged snapshots and drawer toggles skip full-history work while preserving
focus and draft state; keep unversioned-server compatibility covered.
Ship `atlas/cartograph-chat.md` inside the runtime bundle, not as an installed-user
patch. Keep chat prompts limited to activation-card data; progress, retrieval
and delivery instructions belong in that file. Cover escaped card values and
the deployed activation path. Markdown blocks must work without blank lines around headings or quotes.
Relative-link cases must use duplicate basenames and confirm that graph edges
and preview navigation resolve the same source-directory target.
External-source cases must retain exact HTTP/HTTPS destinations, including
`.md`, queries and fragments. Cover string sources and titled `path`/`url`/`uri`
objects, mixed lists, safe escaping and rejection of non-web schemes as
external links. Keep internal sources and their graph edges unchanged.
In the browser, check meaningful GitHub and generic-site labels, repository
context, whole-row activation, native modified clicks, visible keyboard focus
and full URLs on hover/focus. Long links must wrap inside the graph-only
preview while chat stays usable. Do not fetch remote titles or favicons.
Use fake clocks to cover normal 400 ms spacing and adaptive 200/100/50 ms targets,
queue-age pressure, smooth acceleration/recovery, full displayed lifetimes,
repeat coalescing, endpoint pulse expiry, and pending-event cancellation.
Cover simultaneous visible aliases of a physical file, per-node observation
consumption, unchanged graphs and ID remapping without alias collapse or replay.
Keep layout output stable across input order and bound sibling lookup work with
an operation-count regression rather than a machine-dependent timing threshold.
Galaxy layout changes need `test/universe.test.mjs` and both renderer paths:
cover central mass concentration, coherent spiral arms, nonzero thickness,
bounded non-overlapping Atlas volumes, oblique home framing and the original
idle rotation rate. Measure the central 80% side-profile thickness rather than
letting a few outliers satisfy depth coverage. Preserve Proximity positions,
all graph relationships, labels on interaction/detail zoom, and keyboard access
through Search. Do not add
force simulation or a second animation clock merely to create galaxy depth.
Search has one input and one result list. Keep its metadata matching shared
with WebGL, Canvas 2D and activation framing, with pre-indexed render text.
Keep the search field visible in the toolbar; results are not a separate
search-button popup. Cover hidden layers, Arrow Down browsing, Escape focus return, remote revisions,
failed requests, caret/focus preservation and selected-neighborhood visibility.
Use a triangular graph to prove that A -> B -> C never pulses A -> C. Cover
revisits, unrelated consecutive nodes, and removal of intermediate nodes;
recorded segments must not be reconstructed from the current active-node order.
Browser-asset changes need only a page refresh, not an extension reload or
collector restart.
Exercise chat full-screen/restore with a real Markdown table, draft and open
preview. Covered controls must be inert, resizing must keep tables contained,
and Escape restores the drawer before closing it. Preserve history and graph
state without server mutations.
Cover automatic camera framing with fake clocks: default-on/off controls,
single and widely spread activations, changed relationship endpoints (including
deletion ghosts), query/layer filtering, five-second manual override, selection,
reduced-motion suppression, throttled fitting and restoration after idle.
The camera follows displayed effects, independently of collector settings.
Also cover simultaneous manual orbit and automatic pan/zoom, pointer capture,
front-facing surface normals, dispersed/opposing targets, angular wraparound,
bounded critically damped motion, zoom-in hysteresis and manual-angle restoration.
Single-node close-in framing should reach at least 95% of its zoom target within
two seconds from the widest view, without leaving a distant node offscreen.
Keep multi-node, zoom-out and restoration timing unchanged. Node/relationship
opacity, relationship and deletion fades share a 3500 ms duration; new-node
glows have a separate 10000 ms deadline from creation.
Cover the whole zoom-out trajectory, not just its final camera state: pan and
zoom must return together without losing the Atlas. Cover ten-second new-node
glows independently of arrival, including late deltas, remapping and reduced motion.
Regrouping must cancel stale following and navigate by the shortest bounded
turn after arbitrary manual revolutions. Pulse circles must share the projected
galaxy core or selected-node position in both renderers.
Cover first-stage neighborhood highlighting, repeated activation opening the
preview, rapid clicks, touch and keyboard activation, and explicit one-step
page navigation. Do not send racing selection and preview requests.
FPS counts completed render frames against uncapped monotonic timestamps, with
one-second UI samples and resets on suspension/disposal. Reuse the graph loop.
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
Check node and edge opacity at 0, 1750 and 3500 ms, and new-node glow expiry
at 10000 ms; overlay-only fades are not
enough. Freeze simulation time to confirm that completed wall-clock fades do
not restart the legacy node entrance animation.
Exercise unique-file bursts and sustained repeated traffic with deterministic
clocks. Verify one activation per frame, per-node bounded queues, exact sequence
counter deltas (including same-millisecond batches), no invented paths after
aggregation, and throttled load/status UI. Unknown capture loss must not be
reported as zero; cancelled graph observations are not collector drops.
Cover relationship additions between existing nodes as well as new nodes:
the edge fades in with a brief green glow, does not enter read playback, and
returns to normal after 3500 ms. Mounts, filters and unchanged links must not glow.
Deleted relationships must fade red for 3500 ms without staying in the live
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
`package.yml` downloads checksum-pinned APM 0.30.0, verifies frozen resolution,
audits the producer lockfile, and builds the plugin archive. It installs that
exact archive in a fresh CommonJS consumer, audits its deployed-file integrity,
compares every deployed runtime file, exercises the native entrypoint contract
using synthetic SDK transport, and exercises default Atlas discovery,
every public HTML/JavaScript/CSS asset, and the authenticated bootstrap API.
Neither job starts a privileged collector.

For a local reproduction, run `npm run check:version`,
`npm run check:syntax`, `npm test`, and `npm run pack:release` with APM 0.30.0
on `PATH` (or set `APM_BIN` to its absolute path). The last command requires
an empty `build/release/`; move or remove only your previous generated output
before repeating it. Producer, consumer, `HOME`, and `APM_HOME` are temporary
and removed automatically. Packaging never deploys over the development shim.

The packer uses `pack --format plugin --archive --archive-format tar.gz`.
Before installation, it normalizes the verified tar members with BSD or GNU tar:
zero owner/group IDs, empty owner/group names, epoch file times and ordinary
file modes. This removes workstation metadata without changing runtime bytes
or generated APM manifests. The normalized archive is the one installed,
audited and checksummed.
APM 0.30.0 still needs explicit `pack --target copilot`: without it, the isolated
producer records `minimal` and bundle installation fails, despite the flag's
upstream deprecation. The offline consumer's exact-content approval is confined
to the disposable test project. Do not broaden user-wide trust or bypass
integrity checks. When upgrading APM, update the binary checksum and script version
together and re-exercise the complete install path.

These isolated audits enforce lockfile and deployed-file consistency, not
organisation policy: the disposable projects have no Git remote for policy
discovery. Organisations needing additional policy gates must supply their
approved policy explicitly rather than infer compliance from these audits.

## Release procedure

The next prepared release is v0.4.0. A local archive with that version is only a
candidate until the reviewed source reaches `main` and the tag workflow publishes
it. Do not reuse an older native-acceptance archive as a release asset.

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

### Marketplace handoff

The private
[`sergio-sisternes-epam/apm-marketplace`](https://github.com/sergio-sisternes-epam/apm-marketplace)
catalog pins Cartograph by version and commit. Source release publication does
not advance that pin. Follow the marketplace's own contribution guidance for
the separate catalog PR:

1. Finish the source release first. Record its URL and resolved tag commit;
   confirm the published assets and manifest version match that commit.
2. Update only Cartograph's authoritative `apm.yml` catalog entry to the released
   version and full commit SHA. Do not pin unreleased branch work.
3. Use the marketplace's pinned APM version (currently 0.30.0) to run `apm pack`.
   Commit the manifest and regenerated `.claude-plugin/marketplace.json`, align
   the README package row and `Unreleased` notes, and review its `AGENTS.md`
   and `CONTRIBUTING.md`. Never hand-edit the generated catalog.
4. Require `validate-and-pack` and maintainer review before merging. That merge
   publishes the catalog change; no separate marketplace release is required.
5. In an approved consumer, refresh/update the package and confirm it resolves
   the released SHA. Consumers need access to both private repositories, and
   existing lockfiles/installations must not be assumed to update automatically.
