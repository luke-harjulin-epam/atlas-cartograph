# Repository guidance

- Implement Cartograph in `.apm/extensions/cartograph/`, the canonical,
  self-contained runtime source. Do not keep a second copy in `src/`.
  `.github/extensions/cartograph/extension.mjs` is only the development shim;
  APM distributes the real entry point and sibling assets, not that shim.
- Keep `apm.yml` and the runtime package metadata aligned with the root package
  version. Do not add a license declaration without an established license.
  Do not import application code outside the runtime bundle; Node built-ins and
  the host-provided Copilot SDK are the only external runtime code dependencies.
- Keep PR, main-push and merge-queue validation behind the stable `CI` gate.
  Reuse the same validation and package workflows for tag releases. Publication
  requires a matching SemVer tag in main history, completed checks and verified
  artifacts; never publish from PR events or replace an existing release.
- Keep CI actions commit-pinned and the APM download checksum-pinned. Use
  `scripts/package-apm.mjs` for isolated release packaging and producer/consumer
  lockfile audits; do not edit generated plugin manifests or install over the
  repository's development shim. Recheck the tag and exact asset set before
  publishing the completed draft.
- With no explicit root, open recognized Atlas mounts under the consumer
  workspace's `.atlas/`. Atlas content is external data, never executable code.
  Do not auto-open the sample or scan installed extension/package caches.
- Register the native canvas without cwd-cache lifecycle hooks. Resolve each
  new instance from `ctx.session.workingDirectory`, using
  `session.rpc.metadata.snapshot()` only for the same caller when context omits
  cwd. Reject invalid/missing paths and lexical/canonical installation paths;
  never fall back to process cwd, cached cwd or a parent directory. Existing
  instances retain their workspace. Native reload uses live reconciliation,
  preserves selection/filters and retries watchers; refresh failures propagate.
- Exercise the canonical and deployed native entrypoints with
  `test/native-extension.test.mjs`. Synthetic SDK transport coverage is not
  real-host acceptance. Keep APM 0.30.0's exact-content canvas-only grant in the
  disposable package consumer, with an explicit empty allow-map before probing
  the identity. No wildcard grants, legacy name-only approvals or shared installs.
- Track synthetic development stores under `.atlas/local/`, with distinct Atlas
  identities. Keep the local mini Atlas byte-identical to the packaged sample;
  keep the stress baseline's 505 nodes and 1508 relationships intact. Development
  fixtures ship in repository clones, not in consumer APM deployments. Never
  start workloads or privileged collectors simply by opening a store.
- Keep development runners in `scripts/dev/`, defaulting to offline dry-run.
  Require explicit execution and exact fixture/collector scope checks. Never
  overwrite baseline pages; clean up only owned temporary files. Synthetic
  activity belongs only in the explicitly labelled development preview server.
- Keep hand-authored documentation under `docs/`. This repository is not an APM
  marketplace and has no generated documentation or package catalog.
- Do not edit an installed user extension or the main checkout when working in
  a worktree. The project extension loads this worktree's source.
- Use Node.js built-ins and ES modules. The Copilot SDK is supplied at runtime.
- Keep universe layout single-sourced in `public/universe.js`; the Node entry
  re-exports it. Do not load third-party fonts or other UI assets at runtime.
  Index sorted sibling positions once per group instead of rescanning per node.
- Use deterministic, bounded volumetric galaxies for Layers and Atlases:
  high-mass central bulges, three thick spiral arms and a sparse halo. Keep
  Proximity's existing layout and never infer new relationships from placement.
  Fill the spiral arms' bounded volume with meaningful vertical depth; measure
  the bulk side profile, not just extreme halo points. Start at an oblique angle
  and retain the original 0.16-radian/second idle rotation, yielding to selection,
  manual orbit and reduced motion. Share core decoration, overview detail and camera behavior
  across WebGL and Canvas 2D. Overview edges remain visible; zoom, search,
  selection and active/hovered nodes retain access to labels.
- Keep the decorative pulse anchored to each projected galaxy core, or exactly
  to the selected node. Use the shared render clock and freeze it for reduced
  motion; never treat this pulse as evidence of file access.
- Interactive node activation highlights the selected node and visible
  first-degree neighbors/relationships first; repeating it opens Markdown.
  Resolve both stages atomically on the server. Explicit page navigation and
  native `select_node` retain their direct-preview contract.
- Keep one always-visible toolbar search field for both accessible results and
  map highlighting. Share title/ID/Atlas/path/type/kind matching with both
  renderers and activation framing; pre-index render nodes rather than building
  descriptions per frame. Keep hidden-layer results, bounded keyboard pages,
  pending text/caret protection and visible query text when results close.
  Down opens results/all-node browsing; Escape returns focus to the field.
  Do not replace the field with a search-button popup.
- Show the runtime version and source SHA in the small build badge. Only source
  checkouts may inspect Git; deployments use stamped runtime metadata, never
  the consumer repository's SHA. Mark uncommitted runtime changes explicitly.
  Show rendering FPS beside the build badge using the existing render loop,
  sample at most once per second and reset after suspension; do not add a
  second animation loop or report the capped simulation delta as frame rate.
- Keep page reads inside their mounted store, including canonical symlink
  targets. Preserve the originating Atlas in navigation and chat references.
- Reject duplicate mount keys before changing the mounted graph or selection.
  Explicit Atlas links must not fall back to another store; generate each mesh
  relationship once. Chat completions must update their own request placeholder.
- Treat SDK `send()` results as message IDs, never answer text. Native
  `atlas-chat` activation must deliver via `update_chat` with the originating
  instance/request and check acknowledgement. Enforce owner-session matching,
  idempotent retries, bounded replies and timeout/close cleanup. Keep queued
  and working indicators distinct, honour reduced motion, and keep standalone
  local search explicitly labelled. Do not capture unrelated session replies.
- Keep chat folded by default in a right-hand drawer at 25% of the viewport
  width. Reserve the remaining map area for both renderers and graph controls;
  keep resizing proportional and preserve drafts/history when collapsing.
  Folded chat must be inert; Escape and Close return focus to its toolbar toggle.
- Exclude fenced and inline code before extracting graph links from Markdown
  bodies. Preserve frontmatter relationship kinds and the original preview text.
- Resolve source-relative page links consistently in graph edges and preview
  navigation before basename aliases, without crossing mount boundaries.
- Keep zero-byte Markdown files as selectable graph nodes with filename titles.
- Read only visualization metadata from base and contribution schemas in
  `atlas/schema.mjs`. Ignore ownership receipts; never infer node membership
  from claimed folders or interpret template paths/constraints. Keep actual type,
  rendering kind and store-qualified schema/type identity separate.
- Include empty declared types in Layers. Surface sanitized schema diagnostics,
  distinguish untyped navigation indexes from explicit undeclared types using
  the shared node category helper,
  preserve undeclared pages, prune obsolete filter keys on schema changes and
  retain stable keyed navigation across identically named contributions.
- Guard path-scanning and state-changing HTTP routes with the shared canvas
  request validation; do not rely on CORS or JSON parsing as authorization.
  Bootstrap and SSE snapshots need the same boundary. Native EventSource may
  use same-origin Fetch Metadata instead of the canvas header, but never omit
  canonical Host and Origin validation.
  Share bounded JSON parsing across POST routes: cap streamed bytes at 1 MiB,
  return 413 before EOF when exceeded, and reject malformed/non-object JSON with 400.
- Handle preview/wiki navigation through one delegated click path. Preserve
  rapid layer intent with serialised updates and revisioned server snapshots,
  without blocking later authoritative changes from another client.
- Use the shared revision-aware state controller for search and layers. Query
  mutations from HTTP and canvas actions must both advance the server revision;
  never overwrite pending text or its caret with an older snapshot.
- Stamp every full-state payload with a monotonic emission revision and discard
  older bootstrap, SSE and action snapshots before applying any fields or timers.
- Order activity payloads independently across full-state and activity-only
  transports so an older response cannot replace a newer collector observation.
- Skip symlink loops during default discovery without hiding permission/I/O
  failures. Index layout labels and compress proximity parent chains.
- Preserve receiver activity per lexical path, physical target and mount identity
  when graph IDs change. Never copy one alias's counts onto another alias.
- Keep all graph nodes reachable through native keyboard controls with bounded
  pages, Atlas/path labels and focus preservation during live updates.
- Keep WebGL and 2D rendering on the same camera, playback and lifecycle clock;
  retain all edges, decorative labels and a working 2D fallback.
- Keep WebGL and Canvas 2D activity behavior equivalent, including reduced motion.
- Honour reduced motion in intro/welcome starfields as well as the graph, and
  release their animation loops and preference listeners on phase transitions.
- Keep adaptive 400/200/100/50 ms activity pacing in shared browser playback,
  never in filesystem operations or collector transport. Use queue depth and
  oldest waiting age, smooth speed changes, and at most one activation per frame.
  Display lifetimes start at presentation;
  disable/graph removal must cancel pending activity as well as active nodes.
- Record path segments only between consecutive displayed activations with an
  existing relationship. Never infer shortcuts from all active nodes, reverse
  earlier segments on a revisit, or reconnect across a removed path node.
- Use server observation `sequence`, `firstSequence`, and `count` to account for
  merged reads and prove path continuity; never invent traversal counts from
  repeated file counts. Ambiguous coalesced paths are omitted. Keep one pending
  slot per visible node, use indexed relationship pairs, and throttle status UI.
- Show queue/lag, merged and cancelled observations, and collector errors
  separately. Capture loss is unknown, not zero. Keep all counters transient.
- Keep playback observations, pending slots and highlights per visible node,
  even when multiple mounts represent the same physical file. Use file identity
  to remap IDs, not to collapse aliases or infer a traversal between them.
- Activity must remain scoped to open Atlas files, exclude viewer reads, expire
  independently per node, and preserve selection/search/layer state.
- Keep the Knowledge Activation camera option client-side and default-on.
  Fit displayed activations and lifecycle endpoints/ghosts, never raw queued
  reads. Use padded, capped zoom and at most one bounds fit per 200 ms.
  Keep pan/zoom following during manual orbit; yield only automatic orientation
  for five seconds after release. Zoom/reset/island navigation still pause all
  following for five seconds. Yield to selected nodes.
  Face the active surface using mean radial normals, retaining stable angles
  for opposing/dispersed activity. Use shortest-angle, speed-limited critical
  damping and zoom-in hysteresis; preserve manual orbit on idle restoration.
  Disable automatic movement for reduced motion; restore the previous framing
  after a one-second idle hold. Turning following off must not restore old zoom.
  Accelerate only single-node close-in framing, keeping its translation in
  step with zoom; retain normal multi-node, zoom-out, orbit and restoration timing.
  Couple automatic restoration pan to zoom progress so the Atlas stays in view
  throughout the return, and discard that trajectory when new activity arrives.
  Regrouping pauses stale activation following for five seconds. Navigation
  uses shortest-angle, speed-limited turns even after many manual revolutions,
  with pitch targets inside the supported orbit range.
- Keep ordinary filesystem changes in the replaceable `atlas/watch.mjs` source
  and `atlas/live.mjs` reconciliation service, separate from read providers.
  Watch only mounted roots; close handles and debounce timers on detach/close.
- Publish explicit filesystem graph deltas for lifecycle effects. Mounting,
  filtering, or regrouping is not file creation/deletion; deleted ghosts must
  never participate in picking, previews, stats, or read-path traversal.
- Lifecycle opacity uses a smooth 3500 ms wall-clock fade for the whole node,
  including labels and new attached edges, not just its colored overlay.
  Do not resume the legacy entrance flash when a lifecycle fade finishes.
  Fade a new node's green glow over 10000 ms total from creation, independently
  of its 3500 ms opacity fade or arrival. Keep that deadline across graph
  remapping; reduced motion keeps static markers for the same lifetime.
- Animate relationships only from explicit `createdEdges` / `deletedEdges`
  filesystem deltas. Compare endpoint file identities and relationship kinds,
  not transient graph IDs. Mounts, filters and metadata edits must not replay
  edge glows. Keep deleted edges outside the live graph and read paths;
  snapshot deleted endpoints and follow surviving endpoints by file identity
  until the 3500 ms red fade expires. Respect relationship-layer visibility.
- Live scans must surface errors and retain the last valid graph rather than
  falsely interpreting permission/read failures as deletions. Preserve selection
  by file identity unless that file was deleted.
- Explicit Atlas reopen/refresh must retry failed root and parent watchers even
  for unchanged roots. Automatic status broadcasts must not create retry loops.
- Copilot canvases default to the current CLI session's process tree, not the
  whole host application. Exclude the viewer subtree and fail closed on unknown
  ancestry; do not silently broaden process scope to make a demo light up.
  The receiver supplies its own `viewerPid`; require a current viewer-to-root
  lineage before seeding the collector, not just the root PID's presence.
  Process lifecycle records update ancestry but cannot make monitoring Live.
- Empty or excluded batches cannot make monitoring Live before the service
  accepts an access; later empty heartbeats can maintain an established stream.
- Isolate monitor-specific parsing, permissions and setup in
  `.apm/extensions/cartograph/activity/providers/`. Use the shared normalized event protocol; do not
  couple the model, renderers or transport to a particular OS logger.
- Keep `macos-eslogger` as the default unless a default change is explicitly
  requested. Alternative implementations belong behind the provider registry,
  not silent fallbacks with different read/write coverage.
- Preserve a chosen provider from public snapshot metadata when recreating its
  service; a missing provider must fail rather than select a different default.
- Never auto-elevate the OS collector, retain system-wide access logs, expose
  collector tokens in snapshots, or describe opens as individual read syscalls.
- Run targeted Node tests with `node --test test/<file>.test.mjs`; `npm test`
  runs the suite. No install or build step is required.
- Update user-facing docs when changing settings, collector semantics, or setup.
