# Repository index

- [AGENTS.md](AGENTS.md): repository orientation and agent instructions.
- [PROCESS.md](PROCESS.md): development procedure.
- [DECISIONS.md](DECISIONS.md): accepted product decisions.
- [BACKLOG.md](BACKLOG.md): open and deferred work.
- [extensions/](extensions/): independent package extensions and native theme data.
- [extensions/RQW-codex-compat/](extensions/RQW-codex-compat/README.md): Codex skill roots, rules, instructions and compatibility matrix.
- [extensions/RQW-tabs-link/](extensions/RQW-tabs-link/README.md): chat-to-chat tools for visible main Pi tabs.
- [extensions/RQW-predictions/](extensions/RQW-predictions/README.md): gray next-message suggestion in the main input, Ctrl+E and Ctrl+R.
- [test/](test/): extension and repository tests.
- [scripts/](scripts/): CI watcher and status tools.
- [pcli-vscode/](pcli-vscode/): bundled Windows VS Code terminal extension.
- [.pi/](.pi/): repository-only agent profiles, review skills and development extensions.
- [.github/workflows/](.github/workflows/): CI workflows.
- [INSTALL.md](INSTALL.md): installation.

Extension load order is the `pi.extensions` list in [package.json](package.json).
Each extension has an `index.ts` entrypoint and a README.
