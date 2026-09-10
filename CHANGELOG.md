# Changelog

## Unreleased

### Changed

- Replace the Add atlas text with a compact SVG plus icon and accessible label.
- Removing the last selected node layer now restores all node layers, including
  schema types and fallback categories, without changing link visibility.
- Simplify Options into compact sections with shared information popups,
  separate node/link filters, collapsed Other pages, and a fixed branded header.
  Keep Atlas controls focused through updates and retain full schema identities.
  On narrow layouts, Options and chat take turns without clearing chat drafts.
- Reduce information buttons to 12px with an 8px glyph, retaining visible
  keyboard focus.
- Keep menu text brief and move explanations into shared **i** information
  popups across activation settings, layer controls and search. Preserve
  visible errors, permissions, private-token warnings and key counters.
- Prioritize collector/file-change status and a contextual setup shortcut in
  Knowledge Activation. Preserve unsaved duration drafts until Save or Cancel,
  improve helper-text contrast, show reduced-motion suppression, and clarify
  playback pace. Keep setup task-oriented and move process mechanics into
  provider diagnostics without removing permission or private-token warnings.
- Move view navigation into a status-bar popup showing the selected view.
  Keep all available views reachable through bounded pages and keyboard controls.
  Match its two-line label and chevron in Knowledge Activation, with collector
  status, change status and playback timing on the same row.
- Combine Knowledge Activation and zoom in a floating bottom status bar,
  removing the click-to-focus hint. Open concise activation settings above
  the bar, with separate Collector setup and Diagnostics disclosures.
  Fetch private connection details only while Collector setup is open.
- Fill the available toolbar width with search and show Options in a
  full-height left-side overlay with an Atlas Cartograph logo/header,
  independent scrolling and Escape/Close.
  Slide Options and chat in and out over 180ms, with instant reduced-motion
  behavior and no width snap when closing full-screen chat.
- Add a full-screen chat toggle for reading wide tables. Restore or Escape
  returns to the drawer, preserving the conversation and draft.
  Use one persistent top-right panel icon to open or close chat in every size.
- Show external sources as readable, keyboard-accessible preview rows with
  descriptive labels, repository/domain context and an external-link icon.
  Prefer optional frontmatter titles; derive fallback labels locally without
  fetching websites. Keep internal relationships as chips.
- Rename the bundled answering activation to `cartograph-chat` and send only
  its compact activation card. Keep progress, retrieval and reply-delivery
  instructions in the bundled file instead of repeating them in every question.
- Show brief request-specific chat progress labels as the agent searches,
  reads pages and prepares its answer. Replace each stage in place, keep the
  original timeout, and retain plain Working status for older callers.
- Give the chat drawer a readable 360px minimum, capped to fit narrow windows.
  Add a rounded, auto-growing multiline composer with an embedded SVG send
  arrow; retain Enter-to-send, with Shift+Enter for new lines and IME protection.
- Fold chat into a right-hand panel using 25% of the window width, with the
  graph and its controls kept alongside it. Resize proportionally, preserve
  drafts/history on collapse, and support Escape with focus restoration.
- Stamp deployed runtimes with `cartograph-build.json` as well as
  `cartographBuild`, so installed canvases keep the source SHA when Git is
  absent. Unsubstituted export placeholders still show `SHA unavailable`.
- Native canvas chat sends a compact Atlas envelope to the joined Copilot
  session. The host reads mounted pages; local keyword search remains only for
  HTTP/dev servers without a session.

### Fixed

- Preserve external source URLs, including `.md` suffixes, queries and
  fragments, and read source objects using `path`, `url` or `uri`.
- Confine node previews and their backdrop to the graph area so chat remains
  usable alongside a selected page, including reopening a folded chat panel.
- Deliver native chat answers through acknowledged, request-scoped canvas
  callbacks instead of displaying SDK message IDs. Reject wrong-session,
  conflicting and stale replies; expire unanswered requests and release timers.
- Label native replies **Copilot** and show queued/working status with animated
  dots that respect reduced motion. Ship the `cartograph-chat` answering activation
  with the runtime so the agent sends its answer into the originating drawer.

## 0.3.0 - 2026-09-09

### Added

- Add a compact version/source-SHA and FPS footer, with safe-area clearance
  and a local-change marker. Release archives retain their source identity.
- Add bounded volumetric galaxies for Layers and Atlases: high-mass cores,
  three spiral arms with substantial side-on depth, and sparse halos.
  Keep every node and relationship, with Proximity layout unchanged.

### Changed

- Unify search in the always-visible toolbar field, sharing title/ID/Atlas/
  path/type/kind matching with the map and accessible paginated results.
  Down opens all nodes when the field is empty; Escape returns to the field.
- Select a node once to highlight its immediate neighborhood and again to
  open Markdown, consistently for pointer, touch and keyboard activation.
- Fade new-node green glows over ten seconds total from creation, retaining
  3.5-second node opacity, relationship and deletion fades.
- Speed up single-node close-in framing while preserving other camera timing.
- Retain the original idle rotation speed and reduced-motion/manual overrides.

### Fixed

- Restore the decorative pulse, anchored to galaxy cores or the selected node.
- Keep the Atlas in view during zoom-out by coupling return pan to zoom progress.
- Bound grouping transitions to the shortest camera turn, pausing stale
  activation targets so they cannot fight the new layout.
- Preserve query revisions, caret and keyboard focus through live updates;
  selected neighborhoods stay highlighted while a search query is active.

## 0.2.0 - 2026-09-09

- Remove native startup's optional lifecycle-hook dependency. Resolve each
  panel's workspace from canvas context or matching session metadata, rejecting
  missing/invalid directories and installation paths without scanning fallback
  locations. Preserve native reload selection and filters through live graph
  reconciliation, with watcher retries and visible refresh failures.
- Validate canonical and packaged native registration/actions using a synthetic
  SDK transport. Upgrade isolated packaging to checksum-pinned APM 0.30.0 and
  exact-content canvas-only executable approval, removing workstation ownership
  metadata from the final archive; real-host acceptance remains
  a separate release gate.

- Label untyped navigation indexes separately from undeclared types and untyped
  pages across Layers, islands, previews and the node browser. Index filenames
  do not imply missing schema declarations or outdated content.

- Discover Core and installed contribution type layers from `SCHEMA.json` and
  `schema.d/*.json`, excluding ownership receipts. Show store-qualified schema
  groups, per-type counts (including empty types), and undeclared/legacy layers.
- Refresh schema membership without page edits or restart, prune removed layer
  keys, and reveal pages whose declaration disappears. Preserve page types,
  relationships, selection and relationship/provenance toggle semantics.
- Report confined, content-free schema diagnostics. Ambiguous declarations are
  omitted rather than assigned to an arbitrary owner; pages remain renderable.

## 0.1.1 - 2026-09-07

- Frame compact Knowledge Activation groups more closely, using the existing
  20x manual zoom ceiling instead of a 3x automatic cap and fitting the active
  set into a larger padded area without changing manual overrides or reduced motion.
- Keep multiple Atlases in separate, size-aware orbital groups in Atlases
  grouping, preventing large stores from expanding into smaller ones. Preserve
  single-Atlas, Layers and Proximity positioning.
- Include the mini and 505-node stress development Atlases under tracked
  `.atlas/local/` paths, so a fresh repository clone opens both automatically.
  Keep the packaged mini Atlas self-contained and give the stress fixture a
  distinct identity for multi-Atlas discovery.
- Rehome lifecycle, mixed-activity, stress and adaptive-preview runners into
  `scripts/dev/`, with offline dry-run defaults, scoped preflight, bounded load
  and cleanup that never removes baseline pages.

## 0.1.0 - 2026-09-05

- Preserve the selected monitor provider when recreating an activity service
  from its public snapshot; fail explicitly if that provider is unavailable.
- Require an accepted file access before reporting Live, including for direct
  providers; empty heartbeats maintain Live only after that first observation.
- Retry failed root and parent watchers when the same Atlas is reopened, without
  replacing healthy handles or retrying continuously on status broadcasts.
- Include zero-byte Markdown pages in initial and live graphs with filename
  titles, keeping previews available when a file is emptied.
- Preserve newer activity across delayed full-state and activity-only responses.
- Resolve relative page links consistently in graph edges and preview navigation.
- Stop intro/welcome star motion when reduced motion is requested and respond
  to preference changes without leaking animation frames or listeners.
- Ignore fenced and inline Markdown code when deriving graph relationships,
  while preserving links in prose and declared frontmatter relationships.
- Reject stale full-state snapshots so delayed bootstrap/action replies cannot
  restore deleted nodes, old previews or earlier navigation phases.
- Skip self-referential symlink entries during default Atlas discovery while
  retaining errors for unreadable paths.
- Compress proximity parent chains and index Atlas/cluster labels to avoid
  quadratic grouping work on long chains, many mounts and disconnected graphs.
- Preserve independent activity counts, timestamps and sequences for file aliases
  during graph rebuilds and ID qualification, without activating newly added aliases.
- Preserve search intent during rapid typing, delayed replies and snapshots,
  with serialised/coalesced edits, shared query revisions and visible rollback.
- Report the All layer control as active only when every node layer is enabled,
  including the otherwise unnamed node categories.
- Add read-only PR, main-push, and merge-queue CI with a stable aggregate gate,
  Node.js 22/24 coverage on Linux/macOS, version/syntax validation, and a real
  APM bundle installation exercise with producer/consumer lockfile audits.
- Add tag-based GitHub releases with matching-version/main-history gates,
  checksum-pinned packaging, SHA-256 assets, source metadata, categorised notes,
  prerelease detection, and draft-first publication with final tag/asset checks
  and no overwriting of existing releases.
- Reject duplicate Atlas mount keys without changing the active graph, keep
  explicit Atlas references scoped to their target, and emit mesh edges once.
  Support `atlas://` page navigation with a single store open.
- Keep overlapping chat replies and failures attached to their original prompts,
  without reviving responses removed from the bounded history.
- Separate adjacent headings, thematic breaks, and blockquotes from ordinary
  text while keeping consecutive quoted lines together.
- Render Markdown lists directly after paragraphs/headings and preserve items
  when ordered and unordered lists meet. Separate activity-summary status text
  for accessible reading and share one universe layout implementation.
- Constrain page reads to mounted stores, guard canvas HTTP actions against
  cross-origin requests, and preserve Atlas identity in navigation and chat.
- Load all graph batches instead of silently truncating large stores. Correct
  installation-directory detection on Windows.
- Remove remote font loading and restore visible keyboard focus for inputs.
- Protect bootstrap and event-stream snapshots before discovery or subscription,
  preserving native browser EventSource through same-origin Fetch Metadata.
- Preserve explicit Atlas keys and sidebar targets; avoid duplicate frontmatter
  relationships and parse URI-valued lists without losing their relationship kind.
- Preserve active and queued playback across multi-Atlas ID remapping; keep
  hidden observations consumed so revealing a layer does not replay them.
- Reject collector startup when the viewer is no longer descended from the
  selected session, including root PID reuse before the initial snapshot.
- Require a valid file-access observation for Live status; process lifecycle
  records still update ancestry without claiming file monitoring is live.
- Preserve separate playback highlights and pending observations for visible
  aliases of the same physical file.
- Index sorted sibling positions once per layout group instead of performing
  quadratic node lookups.
- Bound all JSON POST bodies to one MiB while streaming, return 413 for oversized
  input, and reject malformed or non-object JSON with 400 instead of false success.
- Route preview/wiki links through one click handler so navigation and external
  tabs are not duplicated.
- Preserve rapid layer changes with optimistic serialised updates, authoritative
  snapshot revisions and visible error rollback.
- Add keyboard-operable node browsing with filtering, bounded pages, Atlas/path
  labels and focus-preserving selection and preview navigation.
- Enable the production WebGL graph layer with shared camera/playback, 2D
  decorations and labels, complete edge rendering and context-loss fallback.
- Move canonical runtime source into `.apm/extensions/cartograph/` and add an
  APM manifest, lockfile and self-contained runtime metadata for distribution.
  Preserve the repository development shim without shipping it to consumers.
- Open recognized Atlas mounts beneath the consumer workspace's `.atlas/` by
  default, including nested/multiple stores. Explicit paths override discovery;
  absent mounts show the picker instead of automatically opening the sample.
- Keep automatic framing active during manual camera rotation, yielding only
  automatic orientation for five seconds after release. Turn toward the active
  surface, hold stable angles for dispersed activity, and soften pan/zoom/orbit
  with speed-limited damping and delayed zoom-in. Preserve manual angles on idle.
- Rename the Reads panel to Knowledge Activation and add default-on automatic
  camera framing for displayed accesses and node/relationship lifecycle effects.
  Smoothly pan/zoom with padding, restore the previous framing after idle, and
  respect manual navigation, selected nodes, filters and reduced motion.
- Adapt read playback from 400 ms toward 200/100/50 ms under queue pressure,
  with age-based acceleration and gradual recovery. Preserve full highlight
  lifetimes and immediate graph changes.
- Count coalesced observations and displayed relationship traversals; show
  queue depth, lag, current speed, merged/cancelled counts and capture limitations.
  Use observation sequence metadata to avoid inventing paths through aggregated
  events and process at most one activation per frame.
- Show deleted relationships as non-interactive red glows fading out over
  2000 ms, including when an endpoint is deleted. Keep the existing green
  creation effects and red node deletion fades.
- Fade new relationships in with a brief 2000 ms green glow, including links
  added between existing nodes, independently of read-path pulses.
- Smooth whole-node creation and deletion over 2000 ms, fading new labels and
  attached edges in and deletion ghosts out without expansion or particle bursts.
- Watch mounted Atlas folders for live create/edit/delete changes using an
  unprivileged, replaceable filesystem change source. Reconcile graph metadata,
  relationships, previews and collector targets without resetting view state.
- Animate created nodes in green and deleted nodes as temporary non-interactive
  red ghosts, independent of session-scoped read pulses. Surface watcher errors
  separately and retain the last valid graph on failed scans.
- Highlight only the activation path between consecutive displayed accesses.
  Keep untraversed relationships dim, preserve earlier path directions on
  revisits, and discard expired or removed segments without creating shortcuts.
- Pace visual read/write activations 400 ms apart without delaying filesystem
  operations or collector delivery. Start each displayed highlight's lifetime
  when it appears, coalesce repeated pending accesses, and synchronize pulses
  to the displayed endpoints.
- Import the installed Cartograph implementation into this repository, with documentation
  under `docs/` and a project-local Copilot discovery entry point.
- Add opt-in external file-open/write activity using an explicitly authorized
  macOS collector and scoped, authenticated loopback ingestion.
- Highlight concurrently accessed Atlas nodes for a configurable five-second
  default, with temporal relationship pulses and endpoint-bound expiry.
- Preserve selection and graph layout through activity; expose collector status,
  pause controls, and reduced-motion rendering.
- Separate monitor implementations behind a provider registry and normalized
  read/write event protocol. Keep `macos-eslogger` as the unchanged default;
  provider-specific setup, permissions, and parsers no longer live in the
  shared transport or UI.
- Scope Copilot canvas activity to the current CLI session and its tool
  descendants, excluding Cartograph's subtree and unrelated host-app scans.
  Keep all-application scope for standalone development servers and display
  the active scope in the activity panel.
