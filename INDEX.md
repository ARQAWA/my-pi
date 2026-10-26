# Repository index

Start here to find code; each extension README maps its actual files and resources.

## Repository navigation

- [AGENTS.md](AGENTS.md): repository orientation and agent instructions.
- [PROCESS.md](PROCESS.md): mandatory development procedure; [process/](process/) holds task-loaded rules.
- [DECISIONS.md](DECISIONS.md): accepted choices; [BACKLOG.md](BACKLOG.md): open and held work.
- [extensions/](extensions/): independent package extensions and native theme data.
- [test/extensions/](test/extensions/): mirrored extension tests; [test/](test/): repository tests.
- [scripts/](scripts/): repository development and delivery tooling.
- [pcli-vscode/](pcli-vscode/): bundled Windows VS Code terminal extension, outside pi.extensions.
- [.pi/](.pi/): repository-only agent profiles and development extensions.
- [.github/workflows/](.github/workflows/): CI and quality notifications.
- [INSTALL.md](INSTALL.md): installation.

## Extension load order

Derived from `package.json` -> `pi.extensions`. Each extension uses `index.ts` with meaning-named modules and resources beside it. Subfolders group needed resources; there is no `src/` layer. Large files are mapped, not split by this index.

| Order | Extension and file map | Entrypoint | Tests | Purpose |
| --- | --- | --- | --- | --- |
| 1 | [RQW-settings](extensions/RQW-settings/README.md) | [`extensions/RQW-settings/index.ts`](extensions/RQW-settings/index.ts) | [tests](test/extensions/RQW-settings/) | Harness defaults, tool selection and GPT Fast settings |
| 2 | [RQW-prompt](extensions/RQW-prompt/README.md) | [`extensions/RQW-prompt/index.ts`](extensions/RQW-prompt/index.ts) | [tests](test/extensions/RQW-prompt/) | System prompt replacement and environment context |
| 3 | [RQW-tools](extensions/RQW-tools/README.md) | [`extensions/RQW-tools/index.ts`](extensions/RQW-tools/index.ts) | [tests](test/extensions/RQW-tools/) | Base tools and background jobs |
| 4 | [RQW-context](extensions/RQW-context/README.md) | [`extensions/RQW-context/index.ts`](extensions/RQW-context/index.ts) | [tests](test/extensions/RQW-context/) | Context window and compaction reserve policy |
| 5 | [RQW-agent](extensions/RQW-agent/README.md) | [`extensions/RQW-agent/index.ts`](extensions/RQW-agent/index.ts) | [tests](test/extensions/RQW-agent/) | Recursive subagents, profiles and persisted sessions |
| 6 | [RQW-review](extensions/RQW-review/README.md) | [`extensions/RQW-review/index.ts`](extensions/RQW-review/index.ts) | [tests](test/extensions/RQW-review/) | Reviewer profiles and native Agent Skills |
| 7 | [RQW-statusbar](extensions/RQW-statusbar/README.md) | [`extensions/RQW-statusbar/index.ts`](extensions/RQW-statusbar/index.ts) | [tests](test/extensions/RQW-statusbar/) | Terminal footer, editor borders and activity display |
| 8 | [RQW-models](extensions/RQW-models/README.md) | [`extensions/RQW-models/index.ts`](extensions/RQW-models/index.ts) | [tests](test/extensions/RQW-models/) | Model and reasoning draft picker |
| 9 | [RQW-anthropic](extensions/RQW-anthropic/README.md) | [`extensions/RQW-anthropic/index.ts`](extensions/RQW-anthropic/index.ts) | [tests](test/extensions/RQW-anthropic/) | Anthropic subscription authentication and transport |
| 10 | [RQW-scroll](extensions/RQW-scroll/README.md) | [`extensions/RQW-scroll/index.ts`](extensions/RQW-scroll/index.ts) | [tests](test/extensions/RQW-scroll/) | Escape returns a scrolled transcript to the latest message |
| 11 | [RQW-session](extensions/RQW-session/README.md) | [`extensions/RQW-session/index.ts`](extensions/RQW-session/index.ts) | [tests](test/extensions/RQW-session/) | Copy session ID and confirmed permanent session removal |
| 12 | [RQW-send-now](extensions/RQW-send-now/README.md) | [`extensions/RQW-send-now/index.ts`](extensions/RQW-send-now/index.ts) | [tests](test/extensions/RQW-send-now/) | Enter sends queued steering from an empty editor |
| 13 | [RQW-mouse](extensions/RQW-mouse/README.md) | [`extensions/RQW-mouse/index.ts`](extensions/RQW-mouse/index.ts) | [tests](test/extensions/RQW-mouse/) | Windows fullscreen mouse reporting recovery |
| 14 | [RQW-providers](extensions/RQW-providers/README.md) | [`extensions/RQW-providers/index.ts`](extensions/RQW-providers/index.ts) | [tests](test/extensions/RQW-providers/) | Provider visibility without credential removal |
| 15 | [RQW-codex](extensions/RQW-codex/README.md) | [`extensions/RQW-codex/index.ts`](extensions/RQW-codex/index.ts) | [tests](test/extensions/RQW-codex/) | Codex subscription authentication and protocol overlay |
| 16 | [RQW-web](extensions/RQW-web/README.md) | [`extensions/RQW-web/index.ts`](extensions/RQW-web/index.ts) | [tests](test/extensions/RQW-web/) | Subscription web search and public URL reading |
| 17 | [RQW-naming](extensions/RQW-naming/README.md) | [`extensions/RQW-naming/index.ts`](extensions/RQW-naming/index.ts) | [tests](test/extensions/RQW-naming/) | Background native session name generation |
| 18 | [RQW-agent-ui](extensions/RQW-agent-ui/README.md) | [`extensions/RQW-agent-ui/index.ts`](extensions/RQW-agent-ui/index.ts) | [tests](test/extensions/RQW-agent-ui/) | Compact delivered agent result cards |
| 19 | [RQW-tool-ui](extensions/RQW-tool-ui/README.md) | [`extensions/RQW-tool-ui/index.ts`](extensions/RQW-tool-ui/index.ts) | [tests](test/extensions/RQW-tool-ui/) | Compact tool calls and output rendering |

## Native theme resources

- [`extensions/RQW-theme/theme.json`](extensions/RQW-theme/theme.json): native `pi.themes` data, not an extension and no fake entrypoint. [File map](extensions/RQW-theme/README.md).

## Keep this index current

After changing the manifest or adding, removing or renaming extension files, run `node scripts/repo-index.mjs --write`. Update the generator's short descriptions when responsibilities change. Hand-written README content outside generated markers is preserved.
Run `node scripts/repo-index.mjs --check` to detect stale maps.
