---
type: experience
title: Porting Cartograph to a Copilot canvas
created: 2026-08-30
work_id: migrate-cartograph
relates_to:
  - path: work/migrate-cartograph
    kind: implements
  - path: decisions/copilot-canvas
    kind: follows
sources:
  - knowledge/atlas-pages
---

# Porting Cartograph to a Copilot canvas

## Context

Cartograph was a Grok/Vercel React app. The Copilot App host wants it as a side-panel canvas.

## What happened

Atlas parse and scan stayed in Node. The star map, crawl, welcome gate, and hyperspace jump run in a loopback iframe.

## Outcome

The viewer opens with `open_canvas` against canvas id `cartograph` and reads a mounted `atlas/` root or this fixture.
