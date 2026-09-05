---
type: decision
title: Host Cartograph as a Copilot canvas
created: 2026-08-30
relates_to:
  - path: work/migrate-cartograph
    kind: informs
---

# Host Cartograph as a Copilot canvas

Do not ship a Vercel web app. Register a project extension under `.github/extensions/cartograph/` that serves the graph viewer to `open_canvas`.

Keep Atlas parse/scan. Do not vendor the Atlas CLI. Consume `atlas/` or `fixtures/mini-atlas`.
