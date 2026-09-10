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

The small bottom-left build badge shows the canvas version and the first eight
characters of its source commit SHA. Hover for the full SHA. `+ local` means
the runtime includes uncommitted source changes, so it is not the exact commit.
Release archives retain their source SHA in the deployed runtime via stamped
`cartograph-build.json` and `package.json` metadata. Source checkouts read Git
first so `+ local` still reflects uncommitted runtime files. Unsubstituted or
missing stamps show `SHA unavailable`; the consumer project's commit is never
used as the canvas version.
The FPS counter beside it reports rendered frames per second over a one-second
sample. It works with WebGL and Canvas 2D and resets after a suspended tab.
`-- FPS` means no current sample is available, including outside the map.
It measures rendering cadence rather than GPU execution time.
The footer reserves its own space below the map controls, with bottom padding
and safe-area clearance so the text is not clipped.

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

### Native workspace resolution

The native entrypoint joins with `canvases` only. It does not register
`onSessionStart` or `onUserPromptSubmitted` hooks to cache cwd, so registration
does not depend on a host hook processor being available.

When opening a new panel, Cartograph uses the public canvas callback's
`session.workingDirectory`. If that field is omitted, it requests
`session.rpc.metadata.snapshot()` from the joined SDK session and requires both
the callback and snapshot to identify that same session. A callback from a
different session must supply its own working directory. Metadata is read
afresh for each new panel, not cached across callers.

The directory must be absolute, existing, and outside extension installations
and package caches, including symlink targets. Missing metadata, invalid paths,
and RPC or filesystem failures stop the open before discovery or server startup.
There is no fallback to the extension process cwd, an earlier panel, the main
checkout, or a parent directory. Reopen from a local workspace with valid host
context to recover. This requirement also applies when supplying an absolute
Atlas root; a root selects a store, not the workspace for later relative actions
and picker discovery. Relative roots resolve against the validated workspace.
Remote-only directories unavailable on the extension's host are not supported.

Focusing an already open instance keeps its workspace, selection, and filters.
Close it and open a new instance to adopt a changed session directory. The native
`reload` action rescans mounted stores through live reconciliation, preserves
selection by file identity and retains query/layers, retries failed watchers,
and surfaces scan failures without replacing the last valid graph.

Canvas APIs are experimental. Local native-entrypoint tests substitute the SDK
transport; they do not establish compatibility with every Copilot App version.
Release acceptance must use the exact unmodified archive in the intended host.
Standalone `npm start` continues to use its invocation directory and does not
require SDK context or metadata.

## Search and select nodes

Type in the always-visible **Search stars** field in the map toolbar.
The field fills the available toolbar width, leaving space for the menu and
chat controls. The menu opens a full-height panel over the left side of the
Atlas without shrinking the graph. A logo and **Atlas Cartograph** header sit
above **Options**. With chat open, the panel stays within the Atlas area.
Its contents scroll independently; Close or
Escape dismisses it and returns focus to the menu button.
Options slides in and out from the left; chat slides in and out from the
right, including when closing full-screen chat. Both use a 180ms transition
and become non-interactive immediately on close. Reduced motion disables
these transitions.
One field searches by title, ID, Atlas,
full path, type or kind and uses that same query to highlight matching visible
nodes on the map. The result list includes hidden layers and supports native
keyboard controls without relying on canvas pointer targets. Results appear
as you type; press Down to enter the results or browse all nodes when the
field is empty. Use **Previous
page** and **Next page** to move through 25-node pages. Each entry includes its
Atlas and path to distinguish duplicate titles. The count reports the current
page or an explicit no-results state.

On the graph, click or tap a node once to select it and highlight its visible
first-degree neighbors and direct relationships. Click or tap that same node
again to open its Markdown preview. Selecting a different node starts with
neighborhood highlighting again.

In the results, Tab to a node and press Enter or Space once to select it,
then activate the same entry again to open its preview.
Selecting a node on a hidden layer reveals that layer. Close the preview to
return focus to the selected entry; **Open selected preview** and **Clear
selection** also work when the selected node is off-page. Escape closes the
results and returns focus to the toolbar field. The active query stays visible
while results are closed; clear the field to restore
unfiltered map highlighting. Live graph updates preserve the
focused entry and filter text; deleting that entry moves focus to the filter.
Wiki links, preview relationship links and the native `select_node` action
remain explicit page navigation and open the preview directly.

Layer buttons update immediately and serialise rapid changes. A saving message
remains until acknowledgement; failures restore the last confirmed view and show
an error. Versioned snapshots prevent delayed responses undoing newer changes.
**All** restores every node category, including those without a dedicated layer
button, and is only shown as active when all those categories are enabled.

Search updates immediately and coalesces rapid typing. Older
snapshots cannot replace pending text or move its caret. A failed request shows
an error beside the input and restores the last confirmed query; clear the input
to remove the filter.

The map uses WebGL where available, with the same labels, camera and controls
as its 2D fallback. If WebGL is interrupted, rendering continues in 2D with a
status notice; graph selection and playback are retained.

## External source links

Open a page's Markdown preview to see its **External sources**. Each HTTP/HTTPS
source is a full clickable row with a descriptive label, repository/domain
context and an external-link icon. Tab to a source and press Enter to open it.
Hover or focus the row to see its full destination. Internal Atlas sources and
relationships remain navigation chips.

Cartograph recognises strings and source objects with `path`, `url` or `uri`
in the page's frontmatter:

```yaml
sources:
  - https://github.com/example/project/pull/8
  - uri: https://github.com/example/project/releases/tag/v0.3.0
    title: Version 0.3.0 release notes
  - path: decisions/design.md
```

An optional `title` takes precedence over a derived label. Without a title,
GitHub links identify pull requests, issues, releases, commits or files; other
sites show a readable path with their domain. Labels are derived locally:
opening a preview does not fetch external titles, favicons or page contents.
External source links keep the complete destination, including `.md` suffixes,
query strings and fragments. Non-HTTP/HTTPS schemes are not external web links.
The viewer recognises these metadata forms; your Atlas's schema remains the
authority for authoring and validation.

## Chat with this Atlas

Use the diagonal-arrow **Full screen** icon in the chat header when you need
more room for tables or long answers. It fills the Cartograph canvas, not the
host application's window. The arrows point inward when maximised; click
**Restore** or press Escape to return to the normal drawer. A second Escape
folds it. A single split-panel icon stays at the top-right whether chat is
folded, open or full-screen; use it to open or close the panel.
Drafts and conversation are retained, and
covered graph controls are unavailable to keyboard/pointer interaction until
you restore or close chat. This size preference is local to the page.

The map chat button talks to the same Copilot session that opened the canvas.
Replies are labelled **Copilot**, not a session identifier. Cartograph sends
only a compact `cartograph-chat` activation card: the bundled activation path,
your question, open Atlas identities/roots, selection, query and request routing.
No page bodies or repeated answering instructions are included.
The bundled `atlas/cartograph-chat.md` activation directs the
agent to read mounted Markdown through session file tools, cite sources, and
send the answer back to this drawer with the `update_chat` canvas action.

**Waiting for Copilot…** means the request is queued. Once the agent starts,
short stage labels such as **Searching the Atlas**, **Reading pages**, and
**Preparing answer** appear beside animated dots. Each stage replaces the
previous pending label, not the conversation history. Older callers without
a label still show **Working…**. Reduced motion keeps a
static status. Sending the prompt is not completion: the indicator remains
until the answer, an error, or a ten-minute timeout. An identical reply retry
does not duplicate the answer; replies cannot overwrite another completed
request. The drawer retains the most recent 50 messages. Older pending
requests are discarded when trimmed, and closing the canvas cancels its
pending requests. Reopening starts a new chat.

The answer appears in the canvas. The host may also retain the prompt, tool
calls and a brief acknowledgement in its session transcript. A transcript-only
answer is not a delivered canvas reply. If a request expires, send it again.
Chat is unavailable for a canvas owned by a different session from the joined
extension; it never silently sends that question to another session.

Session page reads can light Knowledge Activation when its collector is
connected. Canvas scans and previews remain excluded; no collector starts
automatically. Failures never fall back to keyword search. Standalone
`npm start` still uses explicitly labelled **Local Atlas search**, because it
has no host session.

## Atlas grouping

**Layers** and **Atlases** draw each group as a volumetric galaxy rather than
packing stars onto a flat plane. The highest-mass pages, based on existing kind
and relationship metadata, form a dense central bulge. Three spiral arms, a
volumetric arms and a sparse halo give the surrounding pages visible depth.
Most arm nodes now occupy substantial vertical space, rather than relying on
a few distant halo points to make an otherwise thin disk look three-dimensional.
Core lighting is shared by WebGL and Canvas 2D.

The home view starts obliquely and rotates at the original idle speed
(0.16 radians per second). Selection and reduced motion still stop idle rotation.
Drag to orbit freely; activation following still turns toward active nodes.
The expanding decorative pulse stays at each galaxy's projected core. With a
node selected, it follows that node instead, including during pan, zoom and
orbit. This decoration is not a read-activity indicator; reduced motion freezes
its expansion.
Grouping changes use shortest-angle, speed-limited camera turns and pause
activation following for five seconds, so an old activation target cannot
fight the new layout's framing.
Placement is deterministic, not a force/gravity simulation: it adds no edges
and changes no page metadata or schema membership. A group labelled
**Undeclared types** remains undeclared; a galaxy shape does not supply missing
schema declarations.

Large galaxy overviews keep relationships visible at lower opacity and show
high-mass labels instead of hundreds of overlapping names. Ordinary label
detail returns by 3x zoom. Search, selection, hover and active read labels remain
available, and **Search** always reaches every page.

Choose **Atlases** grouping to give each mounted store its own galaxy.
With multiple Atlases, each group's size reflects its node count but stays
within a bounded region, leaving space between groups. Large stores such as the
505-node stress Atlas no longer spread around the globe into smaller Atlases.
Relationships between stores remain visible across the gaps.

**Layers** groups declared types by store and schema, while undeclared/legacy
pages retain their rendering categories. **Proximity** still uses existing
folder/relationship neighborhoods and its previous layout, not schema ownership.
The separation is in
3D: groups can still line up in projection while
you orbit the camera. Open **View** in the floating status bar to inspect a
group, or select **All** to return to the overview. The popup lists the available
views for the current grouping, with counts and full Atlas/schema labels.
Large lists use Previous/Next pages. Arrow keys move between options; Enter
selects, and Escape closes the popup. Selecting a view closes the popup and
updates the status-bar label without changing search or layer filters.

## Schema and type layers

In Options, **Layers** lists **Core** from `SCHEMA.json` and each installed
contribution from `schema.d/*.json`. The base and contributions declare types
in `templates.by_type`; contributions identify themselves with
`contribution_id`. Ownership files ending in `.receipt.json` are ignored.
Every declared type is listed, even with no current pages. Each schema shows
its originating Atlas and relative source file; duplicate names in different
stores are independent controls.

Choose a schema or individual type while **All** is active to isolate it, then
toggle other types or schemas to combine them. A dashed schema button means
only some of its types are enabled. Counts show total nodes in each layer,
independent of search and visibility. **All** restores every type and legacy
category without changing **Relates** or **Provenance**. **Pages without schema
declarations** separates **Navigation indexes** (untyped `index.md` files),
**Undeclared types** (explicit types without a matching declaration), and
**Untyped pages** (ordinary untyped pages). Neutral Experiences, Decisions and
Work categories retain filename-derived navigation for older store layouts.
An explicit undeclared `type: index` belongs to Undeclared types, not Navigation
indexes; a declared index type belongs to its schema. These labels do not imply
that content is outdated or invalid. The node browser and previews
show the actual page type rather than its fallback rendering style.

Membership uses an exact match between page frontmatter `type` and a declared
type ID. Rendering style remains backward compatible. A synthetic observatory
could declare `instrument` in Core and `calibration` in a contribution, while
freely nesting either type and ordinary pages in the same folders. Folder
ownership (`claimed_folders`) does not assign pages to a contribution or create
another Atlas. Cross-type links use the same graph relationship rules.

Saving, installing or removing schema files refreshes the catalog through the
existing filesystem watcher, without touching pages or restarting Cartograph.
Unchanged type keys retain their filter settings for the current canvas;
new declarations start visible. Removed keys are discarded, and pages whose
declaration disappears are revealed in **Undeclared types**.
Selecting a hidden node from navigation reveals its layer. Browser reloads
retain the server's current canvas filters; a new canvas starts with All.

Metadata reads remain inside the mounted store, including symlink targets.
Malformed, unreadable, oversized or conflicting metadata produces a visible
diagnostic in Options. Files are limited to 1 MiB. Conflicting type IDs are
omitted from all claimants, and duplicate contribution identities are omitted;
there is no last-file-wins override. Valid independent declarations remain
available and affected pages remain renderable as undeclared. Diagnostics do
not include JSON payloads or parser excerpts. A failed page read still retains
the last valid graph and reports a separate filesystem refresh error.

This is visualization metadata discovery, not Atlas compiler validation.
Cartograph does not validate required fields, sections, dates or `relates_to`
target constraints, load template files, execute/fetch schema content, or
interpret additional namespaced metadata. Legacy Atlas and okf-wiki remain
usable without schema type declarations.

## Live graph updates

Folder watching starts automatically for every open Atlas. No read collector,
administrator authorization, or extra permission for normally accessible
directories is needed. Changes made by any application are detected; this
watcher does not identify the process that changed a file.

- **Create a page:** its node, label, and attached relationships fade in over
  3500 ms. The node's green glow fades over **10 seconds total from creation**,
  independently of its arrival time. Arrival does not cut the glow short or
  start a second ten-second timer.
- **Delete a page:** it leaves the graph immediately; a red, non-interactive
  ghost fades out smoothly over 3500 ms without an expanding particle burst.
  A deleted selected page closes its preview.
- **Edit a page:** its metadata, relationships and open preview refresh in place.
- **Add a relationship:** the new edge fades in with a green glow that rises
  and fades over 3500 ms, then returns to its normal appearance. This also
  applies to links between existing nodes; unchanged relationships do not glow.
- **Delete a relationship:** it leaves the live graph immediately and leaves a
  red glow fading out over 3500 ms. This also happens to attached relationships
  when a node is deleted. The fading edge is non-interactive and carries no
  read-path pulses.

New-node glows last ten seconds; node opacity, relationship and deletion effects
last 3.5 seconds. They respect reduced motion and do not create
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

The floating bottom bar keeps **Knowledge Activation** status on the left,
the **View** selector beside it, and zoom controls on the right. Activation's
title sits above the collector/change statuses and playback timing.
Both selectors use the same expand/collapse chevron.
Click the activation section to open settings above
the bar. Zoom buttons do not open or close settings. Escape or the cross closes
settings and returns focus to the status section.

Use **Follow activity**, **Highlight file access**, and **Highlight duration**
for everyday controls. Read collector and file-change status appear first and
remain separate, even when highlighting is off. **Set up collector** opens the
setup instructions when the collector is waiting, disconnected or reporting an
error. This shortcut is hidden while the canvas connection itself is lost.
Expand **Collector setup** for provider instructions and the private connection
command; opening settings alone does not fetch connection details or start a
collector. Closing setup clears the command. **Diagnostics** contains process
scope, provider process mechanics, playback counters, repeated observations and
timing details. Setup keeps authorization and private-token warnings visible.
Settings belong to the current canvas; a new canvas defaults to five seconds.
Valid durations are 0.1 to 300 seconds.

Checkboxes apply immediately. Duration edits show **Unsaved changes** until you
choose **Save** or **Cancel**. A draft survives live updates, moving focus,
checkbox changes and closing/reopening settings; a failed save keeps it for
retry. Cancel restores the latest confirmed duration without sending a request.
Drafts are local to the current page and do not survive a browser reload.
The inline **ms** value is playback pace between displayed activations, not
collection latency; its tooltip and accessible description explain the difference.

**Follow activity** is on by default. The camera smoothly
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
active set changes. Read highlights keep their configured lifetime;
new-node glows last ten seconds and other lifecycle effects stay at 3500 ms.
A single activated node uses faster close-in zoom and
coordinated translation so it comes into view promptly even from a wide view.
Multi-node following, zoom-out, surface rotation and idle restoration retain
their normal timing.

Drag to rotate at any time: automatic pan/zoom continues framing the changing
nodes while you control the angle, including for five seconds after release.
Automatic surface-angle selection then resumes gently. Wheel/zoom controls,
reset and island navigation still pause all following for five seconds.
Selected nodes keep focus. Once the effects end, the camera holds for one
second, then smoothly returns to its pre-activation framing. A manually chosen
angle replaces the original angle for that restoration.
During the return, pan follows zoom progress so the Atlas stays in view instead
of drifting away while zoom unwinds. The zoom-out duration is unchanged.
Uncheck the option to stop following without restoring the old zoom.
Reduced-motion preferences suppress automatic camera movement. When following
is enabled, **Paused by reduced motion** explains the suppression without
clearing your preference.
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
new-node glows keep their ten-second deadline, other lifecycle effects remain
3500 ms, and graph changes are not queued.

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
