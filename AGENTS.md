# Repository guidance

- Implement Cartograph in `.apm/extensions/cartograph/`, the canonical,
  self-contained runtime source. Do not keep a second copy in `src/`.
  `.github/extensions/cartograph/extension.mjs` is only the development shim;
  APM distributes the real entry point and sibling assets, not that shim.
- Keep `apm.yml` and the runtime package metadata aligned with the root package
  version. Do not add a license declaration without an established license.
  Do not import application code outside the runtime bundle; Node built-ins and
  the host-provided Copilot SDK are the only external runtime code dependencies.
- With no explicit root, open recognized Atlas mounts under the consumer
  workspace's `.atlas/`. Atlas content is external data, never executable code.
  Do not auto-open the sample or scan installed extension/package caches.
- Keep hand-authored documentation under `docs/`. This repository is not an APM
  marketplace and has no generated documentation or package catalog.
- Do not edit an installed user extension or the main checkout when working in
  a worktree. The project extension loads this worktree's source.
- Use Node.js built-ins and ES modules. The Copilot SDK is supplied at runtime.
- Keep universe layout single-sourced in `public/universe.js`; the Node entry
  re-exports it. Do not load third-party fonts or other UI assets at runtime.
  Index sorted sibling positions once per group instead of rescanning per node.
- Keep page reads inside their mounted store, including canonical symlink
  targets. Preserve the originating Atlas in navigation and chat references.
- Reject duplicate mount keys before changing the mounted graph or selection.
  Explicit Atlas links must not fall back to another store; generate each mesh
  relationship once. Chat completions must update their own request placeholder.
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
- Keep all graph nodes reachable through native keyboard controls with bounded
  pages, Atlas/path labels and focus preservation during live updates.
- Keep WebGL and 2D rendering on the same camera, playback and lifecycle clock;
  retain all edges, decorative labels and a working 2D fallback.
- Keep WebGL and Canvas 2D activity behavior equivalent, including reduced motion.
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
- Keep ordinary filesystem changes in the replaceable `atlas/watch.mjs` source
  and `atlas/live.mjs` reconciliation service, separate from read providers.
  Watch only mounted roots; close handles and debounce timers on detach/close.
- Publish explicit filesystem graph deltas for lifecycle effects. Mounting,
  filtering, or regrouping is not file creation/deletion; deleted ghosts must
  never participate in picking, previews, stats, or read-path traversal.
- Lifecycle opacity uses a smooth 2000 ms wall-clock fade for the whole node,
  including labels and new attached edges, not just its colored overlay.
  Do not resume the legacy entrance flash when a lifecycle fade finishes.
- Animate relationships only from explicit `createdEdges` / `deletedEdges`
  filesystem deltas. Compare endpoint file identities and relationship kinds,
  not transient graph IDs. Mounts, filters and metadata edits must not replay
  edge glows. Keep deleted edges outside the live graph and read paths;
  snapshot deleted endpoints and follow surviving endpoints by file identity
  until the 2000 ms red fade expires. Respect relationship-layer visibility.
- Live scans must surface errors and retain the last valid graph rather than
  falsely interpreting permission/read failures as deletions. Preserve selection
  by file identity unless that file was deleted.
- Copilot canvases default to the current CLI session's process tree, not the
  whole host application. Exclude the viewer subtree and fail closed on unknown
  ancestry; do not silently broaden process scope to make a demo light up.
  The receiver supplies its own `viewerPid`; require a current viewer-to-root
  lineage before seeding the collector, not just the root PID's presence.
  Process lifecycle records update ancestry but cannot make monitoring Live.
- Isolate monitor-specific parsing, permissions and setup in
  `.apm/extensions/cartograph/activity/providers/`. Use the shared normalized event protocol; do not
  couple the model, renderers or transport to a particular OS logger.
- Keep `macos-eslogger` as the default unless a default change is explicitly
  requested. Alternative implementations belong behind the provider registry,
  not silent fallbacks with different read/write coverage.
- Never auto-elevate the OS collector, retain system-wide access logs, expose
  collector tokens in snapshots, or describe opens as individual read syscalls.
- Run targeted Node tests with `node --test test/<file>.test.mjs`; `npm test`
  runs the suite. No install or build step is required.
- Update user-facing docs when changing settings, collector semantics, or setup.
