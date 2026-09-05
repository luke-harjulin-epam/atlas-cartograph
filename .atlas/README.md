# Development Atlases

These synthetic datasets are tracked in Git and included in repository clones.
They are viewer fixtures, not project knowledge or process memory. Opening them
does not start a workload or an OS collector.

| Store | Atlas ID | Baseline |
| --- | --- | --- |
| `local/mini-atlas` | `cartograph-mini` | 5 nodes, 11 relationships |
| `local/stress-test-atlas` | `cartograph-stress-test` | 505 nodes, 1508 relationships; 500 read targets |

From the repository root, `npm start` discovers both stores together. To inspect
one store, pass its path, for example:

```sh
npm start -- .atlas/local/stress-test-atlas
```

The stress store preserves the original synthetic session fixture. Its identity
is distinct from the mini Atlas so both can be mounted at once. Keep all baseline
pages, links and filenames when changing its runners.

`local/mini-atlas` is a checked-in copy of the small sample in
`.apm/extensions/cartograph/fixtures/mini-atlas`. Keep the two in sync; a regression
test compares every file. The packaged sample remains self-contained for installed
canvases, but these repository datasets and development runners are not part of the
APM runtime bundle and are not copied into a consumer's `.atlas/`.

Do not put `SCHEMA.json` or `index.md` in `.atlas/` or `.atlas/local/`: these are
namespaces, not stores. Store metadata belongs in each named fixture directory.
Do not add personal Atlases, access tokens, collector logs or captured user content.

## Development runners

The original session-local runners now live in `scripts/dev/`. They resolve the
fixtures relative to the repository, not the invoking terminal's directory.
Every command defaults to an offline dry-run; `--help` explains its options.

| Command | Fixture | Purpose |
| --- | --- | --- |
| `npm run demo:lifecycle` | mini | Node and relationship creation/deletion |
| `npm run demo:mixed` | mini | Lifecycle changes plus real session-scoped reads |
| `npm run demo:stress` | stress | Bounded real-read load, up to 25 reads/s by default |
| `npm run demo:server` | stress | Dedicated synthetic-only preview server |
| `npm run demo:adaptive` | stress | 300 explicitly synthetic observations and one temporary page |

For lifecycle changes, start a viewer with only the mini Atlas mounted, then pass
the exact printed URL:

```sh
npm start -- .atlas/local/mini-atlas
# In a second terminal, replace 12345 with that viewer's actual port:
npm run demo:lifecycle -- --check --url http://127.0.0.1:12345/
npm run demo:lifecycle -- --run --url http://127.0.0.1:12345/
```

Mixed and stress scenarios instead require a Copilot canvas with only the
matching fixture mounted and its collector explicitly started by the user. Run
the scenario through the same Copilot session's tool runner, not a separate
terminal or session. Preflight checks the mount, process scope, filters and
watcher. A real probe must be observed before load begins. These commands never
start or elevate a collector or change monitoring settings.

`npm run demo:stress -- --dry-run --max-rate 2000` shows the original six-stage
plan (up to 31,585 offered reads, including the probe). Actually running that plan
also requires `--run --url <canvas-url>`. Lower ceilings omit the higher stages;
capture loss and offered-versus-observed throughput remain best-effort.

For a demonstration without OS monitoring, explicitly start the dedicated
synthetic preview and use its printed URL:

```sh
npm run demo:server -- --run
# In a second terminal, replace 12345 with the synthetic viewer's actual port:
npm run demo:adaptive -- --run --url http://127.0.0.1:12345/
```

This preview binds an ephemeral loopback port and identifies its observations as
synthetic. It does not emit events on startup; the exercise refuses ordinary
collector endpoints. Stop the server with Ctrl-C.

Runners never overwrite or delete baseline pages. They create exclusively owned
temporary `cartograph-*` pages and clean them up on completion, SIGINT or SIGTERM.
Externally edited or replaced files are left intact with an error. After a hard
kill, inspect leftovers with `git status --short -- .atlas/` before removing only
the scenario's temporary files. Preflight refuses extra pages until the baseline
is restored.
