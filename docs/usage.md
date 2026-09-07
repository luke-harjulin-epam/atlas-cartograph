# Using Cartograph

## Open the viewer

Use Node.js 22 or later. `npm start -- /absolute/path/to/atlas` starts a
loopback-only development server and prints its URL. Without a path, `npm start`
opens recognized Atlas stores below the current project's `.atlas/`, including
nested mounts. If none exist, it opens the store picker. Stop it with Ctrl+C.

For a Copilot canvas, reload project extensions and open `cartograph` from
`project:cartograph`. The entry point under `.github/extensions/` imports
`.apm/extensions/cartograph/extension.mjs`; that directory owns all runtime code
and assets. In APM consumer projects, `.github/extensions/cartograph/` contains
the deployed runtime itself, not this repository's development shim. The SDK is
provided by Copilot, not an npm dependency. A separately installed user
Cartograph can coexist; choose the project provider to run this source.

An Atlas root contains `SCHEMA.json` or `index.md`. The bundled demonstration
store is `.apm/extensions/cartograph/fixtures/mini-atlas` in this source repository.
It is available as an explicit choice, never the automatic default. Use the map's Atlas controls to add another
store; both appear in the same graph. Selection, search, layers, previews, and
grouping continue to work during activity.

Opening the canvas without a root follows the same `.atlas/` discovery behavior
as the standalone server. An explicit canvas `root` overrides it. The search is
relative to the consumer workspace, not the extension installation directory.
For example, `.atlas/github.com/team/one` and `.atlas/github.com/team/two` can
open together. Atlas Markdown and schema files are graph data; the extension
does not execute code from those mounts.

Automatic discovery recognizes `SCHEMA.json`, `SCHEMA.md`, or `index.md` and
stops at each store boundary. Symlink aliases are deduplicated and cycles are
ignored. Discovery is bounded to 8 levels and 4096 directories; exceeding a
limit or encountering unreadable content reports an error rather than silently
opening a partial graph. Existing environment presets remain picker choices,
not automatic mounts.

See [APM installation](../README.md#install-with-apm) for experimental canvas
enablement and package approval. Reloading extensions after an APM install
loads the deployed canvas. The OS read collector is still separately started
by the user; installing the package does not elevate privileges.

## Browse and select nodes

Choose **Browse nodes** in the map toolbar to explore every node using native
keyboard controls, without relying on canvas pointer targets. Filter by title,
Atlas, path or kind, or use **Previous page** and **Next page** to move through
25-node pages. Each entry includes its Atlas and path to distinguish duplicate
titles. The count reports the current page or an explicit no-results state.

Tab to a node and press Enter or Space to select it and open its preview.
Selecting a node on a hidden layer reveals that layer. Close the preview to
return focus to the selected entry; **Open selected preview** and **Clear
selection** also work when the selected node is off-page. Escape closes the
browser and returns focus to **Browse nodes**. Live graph updates preserve the
focused entry and filter text; deleting that entry moves focus to the filter.

Layer buttons update immediately and serialise rapid changes. A saving message
remains until acknowledgement; failures restore the last confirmed view and show
an error. Versioned snapshots prevent delayed responses undoing newer changes.
**All** restores every node category, including those without a dedicated layer
button, and is only shown as active when all those categories are enabled.

**Search graph** also updates immediately and coalesces rapid typing. Older
snapshots cannot replace pending text or move its caret. A failed request shows
an error beside the input and restores the last confirmed query; clear the input
to remove the filter.

The map uses WebGL where available, with the same labels, camera and controls
as its 2D fallback. If WebGL is interrupted, rendering continues in 2D with a
status notice; graph selection and playback are retained.

## Atlas grouping

Choose **Atlases** grouping to give each mounted store its own orbital group.
With multiple Atlases, each group's size reflects its node count but stays
within a bounded region, leaving space between groups. Large stores such as the
505-node stress Atlas no longer spread around the globe into smaller Atlases.
Relationships between stores remain visible across the gaps.

Single-Atlas positioning and the **Layers** and **Proximity** layouts are
unchanged. The separation is in 3D: groups can still line up in projection while
you orbit the camera. Use an Atlas's island-navigation button to inspect it.

## Live graph updates

Folder watching starts automatically for every open Atlas. No read collector,
administrator authorization, or extra permission for normally accessible
directories is needed. Changes made by any application are detected; this
watcher does not identify the process that changed a file.

- **Create a page:** its node, label, and attached relationships fade in over
  2000 ms, accompanied by a softly rising and fading green glow.
- **Delete a page:** it leaves the graph immediately; a red, non-interactive
  ghost fades out smoothly over 2000 ms without an expanding particle burst.
  A deleted selected page closes its preview.
- **Edit a page:** its metadata, relationships and open preview refresh in place.
- **Add a relationship:** the new edge fades in with a green glow that rises
  and fades over 2000 ms, then returns to its normal appearance. This also
  applies to links between existing nodes; unchanged relationships do not glow.
- **Delete a relationship:** it leaves the live graph immediately and leaves a
  red glow fading out over 2000 ms. This also happens to attached relationships
  when a node is deleted. The fading edge is non-interactive and carries no
  read-path pulses.

Lifecycle effects last two seconds, respect reduced motion, and do not create
steps in the read-activation path. They remain enabled when read highlighting
is paused. Filtering, regrouping, or removing an Atlas from the viewer does not
pretend that its files were deleted.

Updates are debounced for 150 ms (with a one-second maximum wait during a
continuous burst), so ordinary atomic editor saves become one update rather
than a deletion followed by creation. Notifications are hints: Cartograph
rescans the mounted graphs and compares file paths. Renames appear as a deletion
and creation; no claim of stable file identity across renames is made.

The graph-watching status is separate from the read collector's status. Errors
are displayed; failed scans preserve the last valid graph rather than inventing
deletions. Fix the reported access/format problem and save again. Closing an
Atlas releases its watches; closing the canvas releases all watches and timers.
A removed root is watched through its parent so it can be reopened on recreation.

Watching follows the scanner's supported Markdown pages, ignored directories,
and nesting limits. Native filesystem notifications are best-effort, especially
on network/virtual mounts; very short-lived files between scans may never appear.
Protected folders can still require normal macOS per-app access permission.
The watcher does not use access timestamps or request elevated privileges.

To load this backend feature into an already running extension, reload project
extensions once and reopen the canvas. If you also use read highlighting, start
the new canvas's collector command. Ordinary file-change updates need neither
that command nor subsequent refreshes.

## Activity controls

Open **Knowledge Activation** in the map to see collector status, change the
highlight duration in seconds, pause highlighting, and get the collector
command. Settings belong to the current canvas; a new canvas defaults to five
seconds. Valid durations are 0.1 to 300 seconds.

**Automatically frame changing nodes** is on by default. The camera smoothly
pans and zooms to currently displayed read highlights, new/deleted nodes, and
both ends of new/deleted relationships. It fits the whole changing set, rather
than chasing individual events under load. Search matches and visible layers
constrain the targets. It also gently turns the activated surface toward the
viewer. When activity covers opposing sides or is widely dispersed, there is
no single useful face, so the angle stays stable instead of flipping.
Compact active groups can zoom up to **20x**, the same ceiling as manual zoom,
instead of stopping at 3x. The changing set uses up to about 80% of the view's
width and 70% of its height, leaving padding for glows, labels and controls.
Wider sets zoom out as needed to keep their nodes and connecting paths together.
Speed-limited, damped motion and delayed zoom-in reduce sudden shifts as the
active set changes. Read highlights keep their configured lifetime; lifecycle
effects stay at 2000 ms.

Drag to rotate at any time: automatic pan/zoom continues framing the changing
nodes while you control the angle, including for five seconds after release.
Automatic surface-angle selection then resumes gently. Wheel/zoom controls,
reset and island navigation still pause all following for five seconds.
Selected nodes keep focus. Once the effects end, the camera holds for one
second, then smoothly returns to its pre-activation framing. A manually chosen
angle replaces the original angle for that restoration.
Uncheck the option to stop following without restoring the old zoom.
Reduced-motion preferences suppress automatic camera movement.
This checkbox belongs to the current browser page and resets to on after a
page reload. It remains independent of read highlighting: filesystem changes
can frame themselves even without a running read collector.

Visual activations normally appear 400 ms apart, without slowing actual file
operations. Under pressure, playback smoothly accelerates using these targets:

| Pending activations | Target delay |
| --- | --- |
| 1–5 | 400 ms |
| 6–15 | 200 ms |
| 16–40 | 100 ms |
| 41+ | 50 ms |

If the oldest item has waited two seconds, the target is at most 100 ms; after
five seconds, it is 50 ms. Speed returns gradually to 400 ms as the queue drains.
Each highlight keeps its full configured lifetime from when it appears;
creation/deletion glows remain 2000 ms and graph changes are not queued.

The Knowledge Activation summary shows queue depth, oldest waiting age and current delay.
Expand it for merged/cancelled counts and repeated node or relationship counts.
Repeated reads share one slot per visible file; uncertain path segments are not
drawn. Status updates are limited to five per second and only one activation
plays per animation frame, even after returning from a background tab.
At 50 ms, maximum playback throughput is 20 activations/second (lower at low
frame rates). Large unique-file bursts can still build a backlog; this is not
a lossless event journal, and capture loss remains unknown.

Consecutively activated, related files pulse only after both are displayed;
a burst can keep playing after its raw OS observations have expired.

Pulses trace the displayed activation path: Experiences -> Decisions -> Work
lights those two steps, not the Experiences -> Work shortcut. Other graph
relationships stay dim even while both endpoints are active.
Heavy, interleaved traffic may therefore light many nodes with few or no pulses:
merged observations cannot prove a consecutive traversal, and the viewer does
not fabricate one.

Run the displayed command manually in an authorized macOS terminal. It invokes
the system `eslogger` with `sudo`, piping events into an **unprivileged** Node.js
collector. Do not run the Node.js collector or the entire pipeline as root.
The command resolves standalone `node` from that terminal's `PATH`, not the
executable hosting the Copilot extension. Confirm `node --version` is 22 or
later in the terminal where you start the collector.
Full Disk Access may need to be granted to the terminal in System Settings >
Privacy & Security. Neither Copilot nor Cartograph grants this permission.

The activity panel shows its process scope. In Copilot, this is the current
session's CLI process and its descendants, excluding the Cartograph process
and its descendants. The host application's unrelated background scans,
other Copilot sessions, and external terminals are outside this scope.

Wait for the live status, then ask this Copilot session to read one Atlas page,
or run the following through this session's tool runner:

```sh
head -n 5 /absolute/path/to/atlas/index.md
```

Open a related page next, within the configured duration, to see a pulse from
the preceding activation to the new one. Launch the privileged collector itself
from the separately authorized terminal as before. Reading a page in that
terminal will not activate a session-scoped canvas.

When running the standalone development server with `npm start`, scope remains
all applications because there is no Copilot session root. In that mode, read
the sample page from a different terminal to the collector: `eslogger`
suppresses events from its own pipeline's process group.

Ctrl+C stops the pipeline. Closing the canvas closes its receiver and clears
its activity timer; the collector exits when it can no longer reach that
receiver. Each separate canvas has its own collector command and token.

The canvas also accepts `activityDurationMs` at open time and the
`configure_activity` action with `enabled` and/or `durationMs`.
Use `get_state` to inspect activity without exposing the collector token.

`monitorProvider` selects a registered monitor when opening a new canvas.
The only shipped implementation, and unchanged default, is `macos-eslogger`.
Its command explicitly selects `--provider macos-eslogger`; existing collector
commands without `--provider` still use that default. Each canvas uses one
provider for its lifetime; changing providers requires opening a new canvas.

See [file-access monitoring](file-access.md) for exact semantics and limits.
See [monitor providers](monitor-providers.md) for the replacement interface.
