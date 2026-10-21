# my-pi

A Pi package (`@earendil-works/pi-coding-agent` 1.3.0) that carries the omp-lite behaviour into stock Pi step by step.
Stock Pi tools stay as they are. Everything is an extension, one folder per extension under `extensions/`.

- `package.json`: the package manifest; extensions are listed under `pi.extensions`.
- `extensions/RQW-settings/`: extension 1, the harness settings. Empty for now.
- `extensions/RQW-prompt/`: extension 2, the system prompt. `SYSTEM.md` is the text; `index.ts` puts it in place of Pi's
  default prompt prefix and appends the workstation, critical, environment and date blocks.
- `extensions/RQW-tools/`: extension 3, the base tools. Stock `read`, `bash`, `edit`, `write`, `grep`, `find` with our
  descriptions (`descriptions/*.md`), multi-file `edit` and `write`, and the ordered barrier. Tests: `npm test`.
- `extensions/RQW-context/`: extension 4, the context window and the compaction threshold. Every model gets the
  window W = min(contextWindow, 500000) and compacts above W - R, where R = round(W / 10). Tests: `npm test`.
- `extensions/RQW-agent/`: extension 5, the subagents. One tool `agent` (start, send, interrupt, stop, restart) runs
  in-process Pi sessions with the whole system prompt, model, thinking and tools from the main agent; results come
  back as `[agent#N]` messages. Imports nothing from another extension folder: subagents get RQW-tools only when
  RQW-tools is loaded and offers them on `pi.events` channel `rqw-tools:subagent-tools`, otherwise Pi's stock
  tools. Tests: `npm test`.
- `pcli-vscode/`: the one exception to "Everything is an extension": a VS Code extension `arqawa.pcli` (ARQAWA PCLI) that
  runs a bundled Pi 1.3.0 in a VS Code terminal tab on Windows. Not a Pi extension, not in `pi.extensions`. Decisions:
  `DECISIONS.md` section PCLI; publishing: `.agents/skills/publish-pcli/SKILL.md`.
- `INSTALL.md`: the install prompt. Given to an already installed Pi, it installs this package into it.
- `notes/`: research notes, such as how the omp-lite prompt was built.
- `DECISIONS.md`: every accepted decision with its reason and the file that carries it.

Try it for one run: `pi -e ~/ai-project/my-pi`. No mentions of other products in the prompt.
