# atlas-cartograph

Cartograph is an Atlas knowledge-graph viewer for GitHub Copilot App canvases.
Open one or more Atlas stores, explore their relationships, and watch recent
external file accesses illuminate the graph.

## Run

Requires Node.js 22 or later. No dependency installation or build is needed.

```sh
npm start -- ./src/fixtures/mini-atlas
```

Open the printed local URL. In Copilot App, reload extensions and open the
**project** Cartograph canvas: `.github/extensions/cartograph/extension.mjs`
loads the source in `src/`. The installed user extension is left unchanged.
If both extensions are listed, select `project:cartograph` explicitly.

## File-access activity

Open the map's activity controls to start an explicit macOS OS-event collector
and configure the highlight lifetime (default **5 seconds**). Accessed nodes
glow brighter, unrelated nodes dim, and pulses follow consecutive activations
along existing relationships, not every relationship between active nodes.
Edges expire with either endpoint; the previous map state
returns after the last highlight expires.

Visual activations normally stay **400 ms apart**, smoothly accelerating toward
**200, 100, or 50 ms** as the queue grows or ages. Repeated observations share a
file's queue slot and display a count. The Knowledge Activation panel shows queue depth, lag,
current speed and aggregation. Actual file access and graph changes are never
delayed; each displayed highlight gets the full configured lifetime.

**Automatically frame changing nodes** is on by default in Knowledge Activation.
The camera gently pans, zooms and turns toward the active surface for displayed
accesses and node/relationship creation/deletion effects. Drag to rotate while
automatic framing continues; your angle takes priority for five seconds after
release. Manual zoom/reset/island navigation pause following for five seconds;
selected nodes keep focus. Idle restoration preserves manual rotation. Turn the option
off for manual framing. Reduced-motion preferences suppress automatic movement.

Copilot canvases show accesses from **the current Copilot session and its tool
processes**, excluding Cartograph and its descendants. Unrelated applications,
other sessions, and the host application's separate background scans are not
included. The standalone development server retains all-application scope.

Read monitoring is not a normal filesystem watcher. The bundled collector uses
macOS 13+ `eslogger`, requires administrator authorization and Full Disk Access,
and observes file opens and modified closes, not every individual read syscall.
Cartograph never requests elevated permissions automatically.

See [setup and usage](docs/usage.md), [access monitoring](docs/file-access.md),
and [architecture](docs/architecture.md). Monitoring is provider-based;
[`macos-eslogger` remains the default](docs/monitor-providers.md), with no
alternative monitor enabled automatically.

## Live graph updates

Open Atlas folders are watched automatically for creates, edits, and deletes
from **any application**, without administrator privileges or Full Disk Access
for normally accessible directories. New nodes and relationships glow green
for 2000 ms, fading back to their default colour. Deleted nodes and relationships
leave non-interactive red ghosts that fade out over 2000 ms. These effects stay
separate from the read-activation path, including links between existing nodes.

Edits refresh node metadata, relationships, and the selected page without
resetting search, layers, or grouping. Camera following is independently
switchable and does not change the layout. Folder watching works even
when read highlighting is paused or no read collector is running. See
[live-update behavior and limits](docs/usage.md#live-graph-updates).

## Repository

| Path | Purpose |
| --- | --- |
| `src/` | Extension, local server, graph rendering, collector, and sample Atlas |
| `docs/` | Hand-authored documentation |
| `test/` | Node.js built-in tests |
| `.github/extensions/cartograph/` | Copilot discovery entry point |

Run `npm test` for the test suite. See [contributing](CONTRIBUTING.md).
