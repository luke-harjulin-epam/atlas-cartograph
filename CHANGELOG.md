# Changelog

## Unreleased

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
- Import the installed Cartograph implementation into `src/`, with documentation
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
