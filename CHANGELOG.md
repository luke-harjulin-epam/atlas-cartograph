# Changelog

## Unreleased

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
