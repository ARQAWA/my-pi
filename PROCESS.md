# Development process

How one task on my-pi runs, from the owner's request to the merge. The principles live in `WORKFLOW-MANIFEST.md`;
this file is the working loop that carries them out, compiled from the first build session (20-21 October 2026,
`C:` source named in `DECISIONS.md`) and the mistakes made in it. Where the two disagree, the manifest wins.
Model choices live in `DECISIONS.md`, section Work policy.

## The loop

1. **Discuss.** While the owner thinks aloud or plans, answer briefly and change nothing: no files, commits, pushes
   or branches. A question such as "is this adequate?" is not a go, and neither is "давай" alone while he asks to discuss or
   plan ("Давай обсудим"); the go is an explicit command to act, such as "делай" or "запускай".
2. **Compile the agreement.** Before a large task starts, list every requirement the owner stated across the whole
   conversation, with his words. Ask once, in one message, only what changes the result; decide the rest and record it.
3. **Plan.** A short plan in the owner's terms: what gets built, what runs in parallel, what proves it. Keep every
   stage the owner named (for example drafts, refinement by probes, review, per-tool probes); never shrink it silently.
4. **Execute.** One branch per task. The main agent coordinates: it splits
   the work into self-contained subagent tasks and runs as many at once as the work allows (10-15 is normal).
5. **Prove.** The proof fits the claim:
   - mechanics: deterministic `npm test` without a model;
   - configuration behavior: citations of Pi's docs and source; no token-burning probes when the owner says "docs only";
   - prompt and description changes: model runs on the allowed models; my-pi must beat both Pi + our prompt and stock Pi;
   - CI green on Windows, macOS and Linux, including portable Git Bash and Bun;
   - each `RQW-*` extension still switches off alone.
6. **Review.** A blind independent check of every completed substage, and one independent review of the whole work
   against the agreement. Fix the findings that are real defects
   backed by quotes; taste is not a finding. Corner cases are proven as the manifest requires; on top of that the
   owner's rule of 21 October limits findings to obvious real errors: «Не надо делать микроправки всяких хуёвин, которые возможно
   никогда не всплывут ... Надо править именно очевидные жирные ошибки, а не вылизывать до предела». A fresh reviewer checks again (for large work
   split into parts, only the parts the fixes touched). Stop at CLEAN.
7. **Ship.** Commit, push, merge into `main`, wait for green CI. A docs-only change (root `*.md`, `notes/`, `.agents/`)
   starts no CI, so there is nothing to wait for. `DECISIONS.md` and the
   docs change in the same merge.
8. **Report once.** The result, what the owner should try himself with exact commands, and what stays paused.

## Lessons from the first session

- Never act on a question or during a discussion. The tools extension was pushed without a go and had to be removed.
- "Rollback" means history as if nothing happened (reset to the earlier commit and force-push), not a revert commit;
  only on the owner's request.
- Work only in this repository. Other repositories, such as my-omp-harness, are read-only: a commit there was a mistake.
- Pi's names stay as they are; nothing is renamed after omp-lite. The owner sometimes says "OMP" meaning Pi.
- No status messages while working: no "waiting for agents", no lists of unfinished work, no repeated updates.
  Every answer, a status answer included, is at most three paragraphs of at most three lines each, and the work goes on.
- Answer exactly what was asked. "What did I forget to port?" means items from the old harness, not a checklist of
  your own.
- Explain every artifact in the chat in plain words: what it is, how it was built and why.
- Scope is what was ordered. No forks; if a fork seems needed, stop and discuss.
  Assemble all work already done; add nothing new.
- A task is done only when every part of it is done; a sub-part left behind (faster writes in RQW-tools) is a failure.
- After a compaction, a model switch or a long break, rebuild the agreement from the owner's messages and `DECISIONS.md`
  before continuing.
- A budget change pauses only what the owner paused (Claude measurements); everything else continues on the
  allowed models. Stop superseded subagents at once.
- Review loops end at CLEAN on real defects. Six review rounds on rare races cost hours the owner did not want.
