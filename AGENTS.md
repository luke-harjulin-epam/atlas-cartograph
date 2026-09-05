# Repository guidance

- Implement Cartograph in `src/`; `.github/extensions/cartograph/extension.mjs`
  is only the Copilot discovery entry point.
- Keep hand-authored documentation under `docs/`. This repository is not an APM
  marketplace and has no generated documentation or package catalog.
- Do not edit an installed user extension or the main checkout when working in
  a worktree. The project extension loads this worktree's source.
- Use Node.js built-ins and ES modules. The Copilot SDK is supplied at runtime.
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
- Isolate monitor-specific parsing, permissions and setup in
  `src/activity/providers/`. Use the shared normalized event protocol; do not
  couple the model, renderers or transport to a particular OS logger.
- Keep `macos-eslogger` as the default unless a default change is explicitly
  requested. Alternative implementations belong behind the provider registry,
  not silent fallbacks with different read/write coverage.
- Never auto-elevate the OS collector, retain system-wide access logs, expose
  collector tokens in snapshots, or describe opens as individual read syscalls.
- Run targeted Node tests with `node --test test/<file>.test.mjs`; `npm test`
  runs the suite. No install or build step is required.
- Update user-facing docs when changing settings, collector semantics, or setup.
