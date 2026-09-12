# atlas-cartograph

Cartograph is an Atlas knowledge-graph viewer for the GitHub Copilot App.

| Graph and chat | Page preview | Galaxy |
| :---: | :---: | :---: |
| ![Cartograph graph with chat and knowledge activation](./docs/images/hero-activity.png) | ![Cartograph page preview](./docs/images/hero-preview.png) | ![Cartograph galaxy overview](./docs/images/hero-galaxy.png) |

## Why / what this is not

Open one or more Atlas stores, explore their relationships, and watch recent
external file accesses illuminate the graph. Search finds pages across every
open Atlas; Layers follows declared schema types and still keeps unknown pages
available.

Cartograph is a viewer, not a marketplace, skill package, or physics simulation.
Layout organizes existing pages and relationships; it does not invent new ones.
Atlas mounts are data, not executable code. Opening a store does not start a
privileged collector or a workload. A GitHub release does not update the family
catalog or existing installs.

## Install

```bash
apm experimental enable canvas # Enables Canvas deployment. This is an experimental feature in APM
apm marketplace add sergio-sisternes-epam/atlas-marketplace --name atlas # Install the Canvas
apm install atlas-cartograph@atlas
```

`--name atlas` is required so the package resolves as `atlas-cartograph@atlas`.

## Use

Reload extensions and open the **Cartograph** canvas. With no explicit root it
opens recognized Atlas stores under the current project's `.atlas/`. If none
are found, it shows the store picker.

From a source checkout (Node.js 22 or later; no npm install or build):

```markdown
Copilot, mount the project Atlas and open Cartograph
```

Open the printed local URL. If both a project and user extension are listed,
select `project:cartograph`.

Search, layers, chat, live graph updates, and file-access highlighting are
documented in [usage](docs/usage.md) and
[access monitoring](docs/file-access.md). Architecture notes live in
[architecture](docs/architecture.md).

## Related

- [`atlas@atlas`](https://github.com/sergio-sisternes-epam/atlas-marketplace) —
  Atlas package from the family catalog; this canvas depends on it
- [atlas-marketplace](https://github.com/sergio-sisternes-epam/atlas-marketplace) —
  public Atlas family catalog (`pkg@atlas`)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Report vulnerabilities through a
[private security advisory](https://github.com/sergio-sisternes-epam/atlas-cartograph/security/advisories/new);
do not file public issues for them.

## License

Copyright 2026 Sergio Sisternes.

Licensed under the [Apache License 2.0](LICENSE).
