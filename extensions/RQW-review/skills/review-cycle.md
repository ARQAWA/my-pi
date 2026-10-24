# Review cycle

Blind review by a separate read-only model on Main's team, for the user's agreement and the requested criterion.
This is the caller's execution procedure for both `highreview` and `blindreview`, ported from the source Codex
`subagents` skill. Pi's `review` tool is the specialised transport that starts the actual fresh reviewer subagent;
it is not a skill and does not require RQW-agent. Codex uses its generic `spawn_agent` with a pinned profile instead.

## Invocation and waiting

Use only when the user asks for review or a checked result, or an invoked skill requires it; never on your own initiative.
Use the level selected by the invoking skill: `blind` is Smarty, `high` is Bossy. `LEVELS` in `../index.ts` pins their
models and efforts independently of Main's model. Each call of `review` starts a fresh session from zero, never a fork.
The call returns at once and the verdict arrives automatically as a `[review#N]` message.
Keep working, but leave reviewed files unchanged until it arrives.

Do not declare the task complete before this review's verdict is received and handled.
If no other work remains, end this turn silently and wait for the automatic verdict notification; do not poll or take filler turns.
Owner messages and interrupts remain allowed. A failed or incomplete verdict is not acceptance.
By default a reviewer inherits GPT Fast; pass `fast_gpt: false` when the user forbids Fast for subagents.

## Brief

Supply primary requirements, governing rules and evidence, not only your summary; use absolute paths for work in another directory.
The transport assembles these sections in order:

1. `<user_messages>`: the caller branch's user messages verbatim and in order; images are `[image]`. Compaction and
   branch summaries are labelled as Main's text, not the user's words.
2. `<agreement>`, only when supplied: accepted proposals and decisions that are not in the user's own messages,
   verbatim. An unaccepted plan or retelling is not an agreement.
3. `<object>`: exact paths or readable references, primary requirements, governing rules, source evidence, the diff
   as a file path, and stage `pre-action` or `pre-completion`.
4. `<criterion>`: what this check confirms and which deliverable must fulfil each obligation; an exclusion cannot
   silently waive a governing requirement of this pass.
5. `<rejected_earlier>`, from the second pass on: every earlier rejected finding verbatim and its reason. Supply them
   through `rejected_earlier`; the transport also retains the history for the same level, object and criterion.

Do not impose file, search, tool-call or turn quotas.

## Verdict and continuation

- `CLEAN` passes only with complete CHECKED evidence and no UNCHECKED. Structure alone cannot prove coverage:
  assess every required obligation against CHECKED. Run no extra pass for confidence, but preserve every independent
  pass and its order required by the invoking procedure.
- `FINDINGS:` are your teammate's findings. Find each quote by searching for it. A finding whose two quotes stand
  verbatim in their sources is admitted; for an omission, verify the quoted requirement and the complete inspected
  file or section instead of demanding nonexistent text. Fix it exactly to its REQUIRED OUTCOME and no further;
  do not reject it, argue with it or put it to the user. Reject a finding only when a quote is not verbatim, the
  allegedly missing content is present in the cited object, or a NOT AGREED element is covered by a verbatim quote
  of the agreement, and give that reason with the quote.
- Fix all admitted findings in one batch, then call review with the same level, object and criterion and every
  rejection so far in rejected_earlier, until CLEAN. Every pass is complete and returns all findings at once;
  every new call starts a fresh reviewer.
- `UNCHECKED:` or missing CHECKED makes the check incomplete regardless of its leading verdict. Resolve missing
  sources or evidence or retry malformed output; never record it as acceptance.
- No verdict, an error or a reviewer that could not start: the check has not passed, and no self-check replaces it.
  Call review again once on the unchanged object; if it fails again, tell the user and wait.

The prohibition on premature completion is an instruction, not a mechanical completion guarantee. Ending a turn
while waiting is not completing the task; delivery remains nonblocking. When this review contract changes, validate
it against known defective, corrected and missing-source examples before claiming improved detection; those checks
are not extra rounds in ordinary task reviews.
