---
type: index
title: Cartograph stress test - READY
relates_to:
  - path: work/index
    kind: related
  - path: experiences/index
    kind: related
  - path: decisions/index
    kind: related
  - path: knowledge/index
    kind: related
---

# Cartograph stress test - READY

Disposable visualization fixture, not stored knowledge. No stress workload starts on opening.

500 read targets in four linked groups; 505 baseline nodes and 1508 relationships.

1. Simple: target 1 real file read per second for 24s; 1 temporary node is created, connected, disconnected and deleted.
2. Light: target 5 real file reads per second for 12s; 2 temporary nodes are each created, connected, disconnected and deleted.
3. Busy: target 25 real file reads per second for 12s; 5 temporary nodes are each created, connected, disconnected and deleted.
4. Heavy: target 100 real file reads per second for 12s; 10 temporary nodes are each created, connected, disconnected and deleted.
5. Very heavy: target 500 real file reads per second for 12s; 25 temporary nodes are each created, connected, disconnected and deleted.
6. Extreme: target 2000 real file reads per second for 12s; 50 temporary nodes are each created, connected, disconnected and deleted.

Six seconds of breathing room between stages, then 45 seconds of recovery. Targets are offered load, not guaranteed collector throughput. All activity is genuine filesystem I/O from this Copilot session, never synthetic HTTP events. Final cleanup restores this baseline.

Observe green births, red removals, adaptive 400/200/100/50 ms playback, merged counts and queue age. Short-lived transients and capture loss remain best-effort; collector errors stop the run.
