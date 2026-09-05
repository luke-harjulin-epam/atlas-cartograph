# File-access monitoring

This page describes the default `macos-eslogger` provider. Its permission
requirements have not changed. Other implementations can use the same
[normalized event interface](monitor-providers.md) without inheriting those
permissions or the macOS parser.

## What is an access?

The bundled macOS collector reads JSON Lines from
`/usr/bin/eslogger open close`. For a session-scoped canvas it also subscribes
to process `fork`, `exec`, and `exit` events to identify tool descendants.
Successful opens activate nodes, including
read-capable and write-capable opens; a modified close activates a written
file again. Unmodified closes do not extend highlights.

This detects ordinary external tools opening Atlas pages to read or write
them, without polling file timestamps or relying on write-only filesystem
watchers. It does **not** trace each `read`/`write` on an already-open file
descriptor, memory-mapped reads, or application-cache hits. An open does not
prove that bytes were consumed. This is an explicit diagnostic integration,
not an audit log or a security monitor.

`eslogger` is supplied on macOS 13 and later and needs root plus Full Disk
Access. Its output is a diagnostic format, not a stable API; OS upgrades may
require parser changes. Malformed/unsupported records are surfaced rather
than silently treated as observed activity. No native collector is bundled
for Linux or Windows. A failure, unavailable permission, or missing collector
must not be confused with a live but idle stream.

Directory changes use a separate unprivileged watcher, not `eslogger`. It keeps
the graph synchronized with creates, edits and deletes from any application and
drives green/red lifecycle effects without claiming to observe reads. See
[live graph updates](usage.md#live-graph-updates).

## Highlight lifecycle

The first visual activation starts on the next frame. Normal traffic is spaced
**400 ms apart**; larger or older queues smoothly accelerate toward **200, 100,
or 50 ms**. This delays only the visualization, never file reads/writes,
collector delivery or graph changes. A fresh burst of three different files
still appears at approximately 0, 400, and 800 ms.

Each displayed access refreshes only that file's timer, five seconds by default,
starting when it appears rather than when the OS event was received.
Multiple files remain active independently. Non-active nodes dim; active
nodes have a brighter halo than their normal state. A pulse is recorded from
the immediately preceding displayed activation to the new one, provided that
the preceding node is still active and they have a visible graph relationship.
Its direction follows that step, even if the stored graph edge points the
opposite way. Other relationships between active nodes stay dim.

For example, Experiences -> Decisions -> Work pulses Experiences -> Decisions
and Decisions -> Work, never the Experiences -> Work shortcut. If consecutive
nodes are unrelated, no edge is invented and no older related node is used as
a substitute.

Repeated accesses to a pending file share one queue slot, retaining the latest
metadata and an observation count; heartbeats do not replay or double count
events. A visible file stays lit while its refresh waits. Long bursts can take
longer to display, with at most one pending entry per visible graph node.
Returning to a backgrounded tab accelerates aged work but never plays its whole
backlog in one frame. If merged observations contain interleaved accesses,
ambiguous path segments are omitted rather than connecting unrelated steps.

The Knowledge Activation summary shows pending activations, oldest waiting time and current
speed. Its expanded panel shows merged and graph-cancelled observation counts,
repeated file counts, and actual displayed relationship traversal counts.
Counts are transient received observations, not every read syscall or proof
that capture was lossless. Collector errors are separate from visual overload;
the number of lost capture events is unknown.

The panel's default-on camera-follow option frames displayed accesses and
filesystem lifecycle effects, not queued raw events. It changes neither capture
scope nor path evidence: many active nodes can still have no highlighted
relationships when coalescing makes read order ambiguous. See
[camera controls](usage.md#activity-controls) for manual override and reduced motion.

Only existing graph relationships are used. No adjacency is inferred from
filenames. Recorded path segments retain their direction and start time when
other nodes activate or expire. Traversing a relationship again replaces its
previous pulse with the latest step; consecutive repeats of one node do not
create a self-edge or restart an earlier pulse.

A segment expires after the configured lifetime from that step, or sooner if
either endpoint expires or its relationship is removed. Removing an intermediate
node never joins its remaining neighbors into a shortcut. Once no active nodes remain, the renderer
returns to its previous selection, search, and layer presentation.

Changing the duration applies to displayed nodes using their latest presentation
time and to pending nodes when they appear. Normal server-side expiry does not
cancel a pending activation or shorten its displayed lifetime. Pausing clears
both queued and visible highlights and removes collector targets; it
does not stop the separately launched OS process. Graph reloads, additions,
and removals reconcile active nodes by physical file path, not just their
Atlas-local IDs. Removed Atlas files cease to match. The collector refreshes
its target list periodically, so allow approximately two seconds after
adding a store or after a new file appears in the live graph before accessing
its files. A new file's creation glow does not depend on that target refresh.

Playback discards nodes removed from the visible graph and never transfers an
old highlight to another Atlas file that reuses its ID. Renumbering the same
physical file when another Atlas opens preserves its queue position, highlight
lifetime, and actual traversed relationships. Hiding a layer cancels its
displayed/pending effects but keeps its observations consumed: revealing it
does not replay old reads, and only fresh reads enter playback.
API snapshots and
`get_state` still report raw, unpaced observations. Their raw relationship list
describes co-active nodes, not the displayed activation path; the browser records
its own path during playback rather than rendering that list directly.

Reduced-motion preferences suppress traveling animations while retaining
static access highlights. Activity does not select nodes, open previews, or
rebuild graph layouts.

## Scope, privacy, and permissions

Copilot canvases additionally require the access to originate from the current
session's CLI process or one of its descendants. Cartograph and its descendants
are excluded. This is narrower than the whole host application: unrelated
host-app background scans, other sessions, and external terminals are not
included. It is a process boundary, not an interpretation of user intent;
a tool in this session that reads every page will still activate every page.

The provider seeds existing parent relationships and follows process lifecycle
events so a short-lived `head` or `cat` can be attributed even after it exits.
Unknown ancestry is not treated as permission to include an event. The receiver
also checks the supplied ancestry against the canvas scope before activating
nodes. These are filtering checks on authenticated provider metadata, not
cryptographic proof of process identity.

Attribution remains best-effort: the initial process snapshot has
second-resolution birth times. Detected event-sequence gaps, session-root exit,
or an unverified root identity change stop collection rather than broadening
scope. Already-verified tools retain their original session lineage if their
parent exits or they are reparented.

The standalone `npm start` server retains all-application scope. The selected
scope is displayed in activity controls and remains fixed for that canvas.
After a scope update, restart the collector with the current canvas command;
an old open/close-only command cannot provide session ancestry.

The privileged system logger emits system-wide metadata into a pipe. The
unprivileged adapter filters against the exact files represented by open
Atlas nodes before forwarding any event. This means unrelated system events
are processed transiently by the adapter, but never sent to Cartograph,
logged, or retained as a history.

Only absolute file paths, PID, access kind, and bounded ancestor PID lists
are forwarded, not contents or whole Endpoint Security records. Process events
may contain command-line metadata in the local OS pipe; the adapter does not
retain or forward arguments or executable paths. Active highlights retain
their last PID and access kind only until expiry, not as an access history.
Both lexical and canonical paths are
matched, so symlinked Atlas roots work. Basename matching is deliberately not
used: identical names in different stores are different nodes. Cartograph's
own server PID is excluded to prevent scans, previews, and chat reads from
triggering their own activity.

Transport is loopback HTTP, bound to `127.0.0.1`. Every collector request uses a
random per-canvas bearer token. The connection command is fetched only on
request by the same-origin canvas UI; it is absent from normal graph/SSE
snapshots. Treat the command as a temporary secret. The token is not stored
in source control or written to a telemetry file.

## Troubleshooting

**Waiting:** run the command from activity controls. Live status requires
evidence that the system logger is emitting events.

**Permission failure:** read the system logger's terminal error; authorize the
terminal for Full Disk Access and provide administrator approval. Restart the
pipeline. Cartograph cannot bypass macOS privacy controls.

**Disconnected:** the stream ended or its heartbeat was lost. Restart the
command from the currently open canvas; a reopened canvas has a new token.

**No highlight:** confirm that the file is an actual node in an open Atlas,
the layer containing it is visible, and the reading process belongs to the
displayed scope. For session-scoped canvases, ask that Copilot session to read
the file; reading it in a separate terminal is deliberately excluded.
For all-application scope, the read must occur outside the collector's process
group. Reusing already-open descriptors or cached content may not emit
an open event. Newly created pages become targets after the directory watcher
updates the graph and the collector refreshes its targets. Check the separate
graph-watch status if the new node has not appeared.

**Unsupported format:** OS logger formats can change. Do not suppress parser
errors or substitute filesystem-write events while claiming read coverage.

## Options without administrator privileges

These are possible read-monitor replacements, not enabled access providers.
An ordinary filesystem watcher already runs separately for graph synchronization:

| Source | Coverage | Tradeoff |
| --- | --- | --- |
| Ordinary filesystem watcher | Changes, replacements, and renames in accessible Atlas directories | Cannot detect reads; events may be coalesced |
| Copilot/tool instrumentation | Reads and writes explicitly reported by cooperating tools | Does not automatically see accesses inside arbitrary shell commands or unrelated apps |
| Editor integration | Opens/reads and saves reported by that editor | Coverage is limited to the instrumented editor |
| Opt-in command wrapper or library | Accesses performed through the wrapper/library | Tools must cooperate; unwrapped access is invisible |

These approaches require only normal permission to access the Atlas files,
not system-wide observation privileges. Protected macOS locations may still
require the relevant per-app privacy permission. Combining filesystem changes
with explicit read notifications offers useful coverage without claiming to
observe every application.

A normal macOS process cannot reliably observe every other process's file
reads. Polling access timestamps is not a reliable replacement: updates may
be delayed, coalesced, or disabled, and cached application reads may perform
no filesystem access at all. The current provider remains the default while
its behavior is evaluated.
