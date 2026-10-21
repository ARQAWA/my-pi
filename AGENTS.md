# my-pi

A Pi package (`@earendil-works/pi-coding-agent` 1.3.0) that carries the omp-lite behaviour into stock Pi step by step.
Stock Pi tools stay as they are. Everything is an extension, one folder per extension under `extensions/`.

- `package.json`: the package manifest; extensions are listed under `pi.extensions`.
- `extensions/RQW-settings/`: extension 1, the harness settings. Turns on Pi's built-in `codemode` and `tool_search` by
  default (same rule as `grep` and `find` in RQW-tools). Details: `notes/settings-codemode.md`. Tests: `npm test`.
- `extensions/RQW-prompt/`: extension 2, the system prompt. `SYSTEM.md` is the text; `index.ts` puts it in place of Pi's
  default prompt prefix and appends the workstation, critical, environment and date blocks.
- `extensions/RQW-tools/`: extension 3, the base tools. Stock `read`, `bash`, `edit`, `write`, `grep`, `find` with our
  descriptions (`descriptions/*.md`), multi-file `edit` and `write`, and the ordered barrier (Pi's `codemode` is one call of it). Tests: `npm test`.
- `extensions/RQW-context/`: extension 4, the context window and the compaction threshold. Every model gets the
  window W = min(contextWindow, 500000) and compacts above W - R, where R = round(W / 10). Tests: `npm test`.
- `extensions/RQW-agent/`: extension 5, the subagents. One tool `agent` (start, send, interrupt, stop, restart) runs
  in-process Pi sessions with the whole system prompt, model, thinking and tools from the main agent; results come
  back as `[agent#N]` messages. Imports nothing from another extension folder: subagents get RQW-tools only when
  RQW-tools is loaded and offers them on `pi.events` channel `rqw-tools:subagent-tools`, otherwise Pi's stock
  tools. Tests: `npm test`.
- `extensions/RQW-review/`: extension 6, the `review` tool with levels `blind` and `high`. Each call runs a fresh
  read-only reviewer session in the same process (`createAgentSession`, stock `read`, `grep`, `find`) with
  `REVIEWER.md` as its prompt; the verdict comes back later as a `[review#N]` message. Tests: `npm test`.
- `extensions/RQW-statusbar/`: extension 7, an independent TUI footer in the owners omp layout. On by default;
  `/statusbar [on|off]` toggles it and restores the stock footer when off. Elements, evidence and limits:
  `notes/statusbar-omp.md`. Tests and deterministic renders: `extensions/RQW-statusbar/test/`, included in `npm test`.
- `extensions/RQW-models/`: extension 8, independent model picker and shortcuts, Opus medium for a new session.
  Public Pi API only; disable it separately in `pi config`. Tests: `extensions/RQW-models/test/`, `npm test`.
- `extensions/RQW-anthropic/`: extension 9, Anthropic subscription transport with OAuth recovery.
  Only `anthropic` and `openai-codex` remain visible, credentials stay. Toggle, migration and limits:
  `extensions/RQW-anthropic/README.md`; research: `notes/anthropic-adapter.md`. Tests use fake credentials: `npm test`.
- `pcli-vscode/`: the one exception to "Everything is an extension": a VS Code extension `arqawa.pcli` (ARQAWA PCLI) that
  runs a bundled Pi 1.3.0 in a VS Code terminal tab on Windows. Not a Pi extension, not in `pi.extensions`. Decisions:
  `DECISIONS.md` section PCLI; publishing: `.agents/skills/publish-pcli/SKILL.md`.
- Every `RQW-*` extension is self-contained and can be switched off alone (no import outside its folder, its tests load
  only it); `test/isolation.test.ts` proves it, `INSTALL.md` shows the switch, `DECISIONS.md` section Isolation.
- `INSTALL.md`: the install prompt. Given to an already installed Pi, it installs this package into it.
- `notes/`: research notes, such as how the omp-lite prompt was built.
- `WORKFLOW-MANIFEST.md`: how the owner works and what he expects of the work on my-pi; read it before any task.
- `PROCESS.md`: the working loop of a task, from discussion to merge, and the lessons of the first build session.
- `DECISIONS.md`: every accepted decision with its reason and the file that carries it.

Try it for one run: `pi -e ~/ai-project/my-pi`. No mentions of other products in the prompt.
