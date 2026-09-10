# atlas-cartograph

Cartograph is an Atlas knowledge-graph viewer for GitHub Copilot App canvases.
Open one or more Atlas stores, explore their relationships, and watch recent
external file accesses illuminate the graph.
Use **Search** for map highlighting and keyboard-accessible selection across
every open Atlas, including nodes on hidden layers.
Graph search updates immediately while serialising edits, so delayed replies
cannot replace newer typed text.
Full-state ordering also prevents delayed responses from restoring deleted nodes
or stale previews.
**Layers** discovers Core types from `SCHEMA.json` and installed contributions
from `schema.d/`, with store-qualified schema/type controls and live updates.
Unknown and legacy pages remain available without declaring a schema.
Untyped `index.md` pages appear as **Navigation indexes**, not undeclared types.
See [schema layers](docs/usage.md#schema-and-type-layers) for behavior and limits.

The v0.3.0 release line adds volumetric galaxies, unified toolbar search,
two-stage node selection, anchored pulses and smoother camera behavior,
with version/SHA/FPS visibility and APM 0.30.0 distribution.
See the [changelog](CHANGELOG.md#030---2026-09-09) for the release changes.

## Run

Requires Node.js 22 or later. No npm dependency installation or build is needed.

```sh
npm start
```

The viewer opens all recognized Atlas stores under the current project's
`.atlas/`, including nested mounts such as `.atlas/github.com/owner/store`.
An explicit path overrides discovery. This repository includes tracked development
stores under `.atlas/local/`: the 5-node mini Atlas and the 505-node stress Atlas.
They open together on a fresh clone; opening them does not start a stress workload
or OS collector. In projects without mounts, the viewer shows the picker instead.
To open only the sample:

```sh
npm start -- .atlas/local/mini-atlas
```

Open the printed local URL. In Copilot App, reload extensions and open the
**project** Cartograph canvas: `.github/extensions/cartograph/extension.mjs`
is a development shim for `.apm/extensions/cartograph/extension.mjs`.
The installed user extension is left unchanged.
If both extensions are listed, select `project:cartograph` explicitly.

Native startup registers only the canvas, without session lifecycle hooks.
Each new panel uses the caller's working directory from canvas context, or
matching session metadata when that context is absent. It never guesses from
the extension process directory or a previous panel. Missing/invalid metadata
fails before discovery; see [native workspace resolution](docs/usage.md#native-workspace-resolution).

See [development Atlases](.atlas/README.md) for dataset contents and safe usage.
These datasets ship with the repository, not with installations into consumers'
`.atlas/`. The small sample remains separately bundled inside the APM runtime.
Reusable `demo:lifecycle`, `demo:mixed`, `demo:stress`, `demo:server` and
`demo:adaptive` npm commands default to offline dry-runs; actual activity always
requires an explicit `--run`.

Mounted stores must have distinct `atlas_id` values (or distinct labels when
no ID is declared). A duplicate key is rejected with both conflicting paths,
without replacing the current graph. Change the conflicting store's
`SCHEMA.json` ID or open the stores separately. Explicit `atlas://id/page`
links stay within the named Atlas and work with one or multiple stores open.

## Install with APM

Use an APM version with experimental canvas support (validated with 0.30.0),
repository access, and Copilot App canvas support. Canvas packages execute code;
review and trust this package before installing it.

In the consuming project's `apm.yml`, merge this canvas-only approval with any
existing executable settings. Initialize an APM project first if needed.

```yaml
executables:
  allow:
    sergio-sisternes-epam/atlas-cartograph:
      canvas: true
```

APM 0.30.0 checks the source dependency reference for canvas approval;
`apm approve` can record a different package identity. Use the explicit
repository-key grant above rather than granting unrelated executable types.

From the consuming project:

```sh
apm experimental enable canvas
apm install sergio-sisternes-epam/atlas-cartograph --target copilot
```

Install from a ref containing `apm.yml`. Use `#<tag-or-commit>` on the package
reference to pin a version; use `#v0.3.0` after that release is published.

Reload project extensions and open **Cartograph**. APM deploys the complete
runtime to `.github/extensions/cartograph/`; it does not deploy the development
shim or depend on a `src/` directory in the consumer. Only Node built-ins and
the host-provided Copilot SDK are external code dependencies. Atlas mounts in
the consumer's `.atlas/` remain data, not executable imports.
For offline archives, APM 0.30.0 instead requires the exact
`name#version@sha256:<digest>` approval key printed by `apm install`.
Grant only `canvas: true` under that key in `executables.allow`; changed content
requires a new grant. A bundle-name-only or legacy `allowExecutables` grant
does not approve the archive.
The viewer uses local fallback fonts; it does not fetch Google Fonts or other
third-party UI assets.
Native canvas chat asks the same Copilot session, shows queued/working status,
and receives **Copilot** answers back in the drawer through request-scoped
callbacks. Each question sends only a compact **cartograph-chat** activation
card; the bundled `atlas/cartograph-chat.md` owns the instructions for reading
mounted pages, citing sources and delivering replies. Standalone development
mode remains labelled local search.
While it works, brief labels such as **Searching the Atlas**, **Reading pages**
and **Preparing answer** explain the current stage beside the animated dots.
See [chat usage](docs/usage.md#chat-with-this-atlas) for timeouts and delivery.
Chat starts folded. Its fixed top-right button opens a right-hand panel at 25% of the
window width, with a 360px minimum (capped at 90% on narrow windows). The graph
and its controls use the remaining space. The rounded composer has an embedded
send arrow and grows with your draft, scrolling after 45% of the window height
or 384px, whichever is smaller. Enter sends; Shift+Enter adds a line.
Close or Escape inside chat restores the full map without clearing the
conversation or draft.
Use the diagonal-arrow **Full screen** icon to read wide tables across the canvas.
Its arrows point inward when expanded: click again or press Escape to restore
the drawer. One split-panel icon stays at the top-right in every size to open
or close chat; there is no duplicate toggle in the toolbar.
Node previews and their backdrop stay within the graph area, so you can keep
chatting about a selected page or reopen chat without dismissing its preview.
Page previews show web provenance in a separate **External sources** section:
readable link rows identify the destination and its repository/domain, instead
of displaying only a URL's final segment. Titles can come from frontmatter or
be derived locally; no remote metadata is fetched. Internal relationships stay
as chips. See [source links](docs/usage.md#external-source-links) for authoring.

The small bottom-left badge shows the runtime version and abbreviated source SHA.
Hover for the full SHA; `+ local` marks uncommitted runtime changes. Release
archives carry their source identity in stamped runtime metadata. Unstamped or
placeholder deployments show `SHA unavailable` rather than borrowing the
consumer project's commit.
The adjacent FPS counter samples rendered frames once per second; `-- FPS`
means a sample is not yet available. This measures rendering cadence, not GPU time.
The footer has dedicated space below map controls and honours bottom safe areas.

**Layers** and **Atlases** use 3D galaxy layouts: strongly connected pages form
a dense core, surrounded by three thick spiral arms and a sparse halo. The
default camera starts obliquely and rotates at its original idle speed; drag to
orbit. Spiral arms have substantial vertical depth, not just a few halo outliers.
Large overviews use subtle
relationships and fewer labels, restoring detail through zoom, search,
selection and activation. The toolbar **Search stars** field finds every page by title, ID,
Atlas, path, type or kind, including hidden-layer pages; its query also drives
map highlighting. Search fills the available toolbar width between controls.
The menu opens Options as a full-height right-hand overlay over the Atlas,
beside chat when it is open. Close or Escape dismisses Options.
Results appear as you type; press Down with an empty field
to browse every node. Escape closes results without hiding the query.
Clear the field to reset highlighting.
This is deterministic visual organization, not a gravity simulation.
The decorative pulse follows each galaxy's core, or the selected node.
Select a node once to highlight it, its visible first-degree neighbors and
their connecting relationships; select it again to open Markdown.
Grouping changes use bounded, shortest-angle turns and briefly pause automatic
activation following so the two camera motions cannot fight each other.

## CI and releases

Pull requests, pushes to `main`, and merge-queue entries run the same validation:
version alignment, JavaScript syntax, the full Node.js 22/24 suite on Linux and
macOS, and an isolated APM archive pack/install exercise with lockfile and
deployed-file integrity audits. The aggregate merge check is
named **CI**; require it in the default-branch ruleset. PR runs cannot publish.
The package check also imports the deployed native entrypoint against a
synthetic SDK transport and exercises registration, workspace resolution and
actions. This is not real-host native acceptance: verify the exact archive in
the intended Copilot App before release, without modifying its runtime.

After a reviewed version change reaches `main`, pushing `vX.Y.Z` starts the
release pipeline. The tag must match `package.json`, the runtime `package.json`,
and `apm.yml`, and point to a commit in `main`'s history. Pre-release tags such as
`v0.1.0-rc.1` produce GitHub prereleases.

Each release contains `atlas-cartograph-X.Y.Z.tar.gz`, its SHA-256 checksum,
and `release.json` with source commit, tag, and packaging metadata. The pipeline
uploads everything to a draft and rechecks its tag and assets before publishing,
and refuses to overwrite an existing release. It uses only the built-in
`GITHUB_TOKEN`, with write
permission limited to the two publication jobs; no npm or Docker credentials
are needed. Releases retain this repository's access restrictions.

See [contributing](CONTRIBUTING.md#release-procedure) for tagging and recovery.

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
Single-node close-in framing uses a faster zoom with coordinated translation;
multi-node following, zoom-out, orbit and idle restoration keep their usual pace.
The return pan follows zoom progress to keep the Atlas in view during zoom-out.

Copilot canvases show accesses from **the current Copilot session and its tool
processes**, excluding Cartograph and its descendants. Unrelated applications,
other sessions, and the host application's separate background scans are not
included. The standalone development server retains all-application scope.
Collector startup verifies that the live viewer still belongs to the selected
session; a reused session PID alone is not sufficient. Live status requires a
first accepted file-access observation, not just process creation, execution,
exit or an empty heartbeat. Later empty heartbeats can maintain Live after
that observation, even when its highlight has expired.

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
for normally accessible directories. New-node green glows fade over **10 seconds
total from creation**; new relationships glow green for 3500 ms.
Deleted nodes and relationships
leave non-interactive red ghosts that fade out over 3500 ms. These effects stay
separate from the read-activation path, including links between existing nodes.
The whole-node fade-in remains 3500 ms; reaching the final layout position
does not cut the ten-second glow short.
Empty Markdown files also appear immediately, using their filenames as titles.

Edits refresh node metadata, relationships, and the selected page without
resetting search, layers, or grouping. Camera following is independently
switchable and does not change the layout. Folder watching works even
when read highlighting is paused or no read collector is running. See
[live-update behavior and limits](docs/usage.md#live-graph-updates).
If folder watching reports an error, reopen the same Atlas to retry failed
watchers. Unreadable scans retain the last valid graph rather than treating
unreadable files as deletions.

## Repository

| Path | Purpose |
| --- | --- |
| `apm.yml` / `apm.lock.yaml` | APM package manifest and dependency lock |
| `.apm/extensions/cartograph/` | Canonical, self-contained canvas runtime and sample Atlas |
| `docs/` | Hand-authored documentation |
| `test/` | Node.js built-in tests |
| `.github/extensions/cartograph/` | Repository-only development discovery shim |

Run `npm test` for the test suite. See [contributing](CONTRIBUTING.md).
