# my-pi

A Pi package (`@earendil-works/pi-coding-agent` 1.3.0) that carries the omp-lite behaviour into stock Pi step by step.
Stock Pi tools stay as they are; each step adds one layer and is measured before the next.

- `package.json`: the package manifest; extensions are listed under `pi.extensions`.
- `prompt/SYSTEM.md`: the system prompt. `extensions/prompt.ts` puts it in place of Pi's default prompt prefix
  (`customPrompt`) and appends the workstation, critical, environment and date blocks. Pi keeps its own project
  context, skills and cwd sections after it.
- `notes/`: research notes, such as how the omp-lite prompt was built.
- `DECISIONS.md`: every accepted decision with its reason and the file that carries it.

Try it for one run: `pi -e ~/ai-project/my-pi`. No mentions of other products in the prompt.
