# my-pi

A Pi package (`@earendil-works/pi-coding-agent` 1.3.0) that carries the omp-lite behaviour into stock Pi step by step.
Stock Pi tools stay as they are. Everything is an extension, one folder per extension under `extensions/`.

- `package.json`: the package manifest; extensions are listed under `pi.extensions`.
- `extensions/RQW-settings/`: extension 1, the harness settings. Empty for now.
- `extensions/RQW-prompt/`: extension 2, the system prompt. `SYSTEM.md` is the text; `index.ts` puts it in place of Pi's
  default prompt prefix and appends the workstation, critical, environment and date blocks.
- `INSTALL.md`: the install prompt. Given to an already installed Pi, it installs this package into it.
- `notes/`: research notes, such as how the omp-lite prompt was built.
- `DECISIONS.md`: every accepted decision with its reason and the file that carries it.

Try it for one run: `pi -e ~/ai-project/my-pi`. No mentions of other products in the prompt.
