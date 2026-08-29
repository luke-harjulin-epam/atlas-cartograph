# atlas-cartograph

Cartograph knowledge-graph viewer as a **GitHub Copilot App Canvas**.

It is not a Vercel/Grok web app. The viewer lives in
`.github/extensions/cartograph/` and opens in the Copilot side panel via
`open_canvas`.

## What shipped

- Atlas parse + scan (frontmatter, wikilinks, `relates_to`, `atlas://`)
- Star-map graph (WebGL with Canvas2D fallback)
- Opening crawl, welcome gate, star sky, hyperspace jump
- Reads a mounted `atlas/` root or `fixtures/mini-atlas`
- Does **not** vendor the Atlas CLI or dump process-memory stores

## Open the canvas

From a Copilot session in this repo:

1. The project extension loads from `.github/extensions/cartograph/`
2. Ask the agent to open Cartograph, or call:

```text
open_canvas({ canvasId: "cartograph", instanceId: "cartograph-1" })
```

Optional open input:

- `root` — Atlas folder (absolute or repo-relative)
- `skipIntro` — skip crawl / jump and go to the map

Agent actions on an open instance: `open_atlas`, `select_node`, `set_query`,
`get_state`, `reload`.

## Atlas roots

Priority:

1. `ATLAS_ROOT` / `ATLAS_VIEWER_ROOT`
2. `atlas/` in the workspace (OKF / mounted Atlas)
3. `fixtures/mini-atlas` (small fixture in this repo)

Any folder with `SCHEMA.json` or `index.md` is an Atlas. Legacy okf-wiki
stores (`knowledge/`, `SCHEMA.md`) still open.

```bash
export ATLAS_ROOT=/absolute/path/to/atlas
export ATLAS_PRESETS="Project:/path/to/project-atlas"
```

## Tests

```bash
npm test
```

## Layout

```
.github/extensions/cartograph/   Copilot canvas extension
  extension.mjs                  joinSession + createCanvas
  server.mjs                     loopback iframe + scan APIs
  atlas/                         parse / link / scan / layout
  public/                        crawl, welcome, jump, star map
fixtures/mini-atlas/             small Atlas fixture
```

Origin: Atlas fork of okf-wiki/addons/graph-viewer (Cartograph), ported off
Grok Build into this Copilot canvas host.
