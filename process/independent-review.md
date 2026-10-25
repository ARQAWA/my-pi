## Independent review

- Result review follows the native `reviewer` skill supplied by `RQW-review`. `blindreview` selects `spotty`,
  `highreview` selects `bossy`; launch each pass as a fresh ordinary `agent` with `agent_type` and
  `include: ["user_messages"]`. The profiles default to `openai-codex/gpt-6.1-sol` low and medium respectively and append
  the reviewer role to the main prompt and subagent reminder. Read-only is an instruction, not a git guard or sandbox.
  Record `Review: agent#N CLEAN`. If the required skill, profile or `agent` is unavailable, the check cannot run;
  report the blocker rather than substituting a separate runtime or copied whole-system prompt.
- Main names the change class in the task brief and in the squash message. Reasons and the owner's words:
  [DECISIONS.md, Task pipeline](../DECISIONS.md#task-pipeline).
  1. Proofreading: typos, wording, quote spans, links and formatting of passive documents, with no change of meaning
     and no new or changed rule. Proof is local: the owner-quote check of touched quotes, a link check and a format
     check of the touched files, saved in a log. No independent review and no application CI. The squash message
     carries `Change-class: proofreading` and `Doc-check: <absolute log path>`; `deliver-check` accepts them only for
     the passive documents it lists. Never for runtime prompts, the `coordinator-rules` block, `package.json`, a
     changed rule or a `QA: #N` fix.
  2. Meaning change of process or documents: one clean result review, plus a code review where the path rule below
     applies.
  3. Runtime prompts (`extensions/RQW-prompt/SYSTEM.md`, agent role profiles,
     `extensions/RQW-review/profiles/*.toml`, `extensions/RQW-review/skills/**/SKILL.md`,
     `extensions/RQW-tools/descriptions/*.md`): mechanical checks and a model
     probe of the claimed behavior, plus the reviews of class 2.
- Except for proofreading and the [third-party installation fast path](../PROCESS.md#third-party-installation-fast-path), every
  squash merge requires a clean result review. Result review invokes `blindreview` with `agent_type: "spotty"`
  for small work and `highreview` with `agent_type: "bossy"` for large work. An answer or report without changes
  needs no review. Explicit owner requirements for a review take precedence.
- Small work is at most 100 added plus deleted lines, all inside one extension, with no owner-visible behavior change.
  One combined result and code review covers it: one `agent` with `agent_type: "code-reviewer"` given the result criteria,
  recorded as `Combined-review: agent#N CLEAN`. Large work and any owner-visible behavior change get the separate
  result review and code review below. A QA fix, a workflow change and a test-integrity trigger are never small.
  `deliver-check` enforces the line limit and the single extension; that reviewer verifies that no owner-visible
  behavior changes.
- Subagents first self-check their work and fix defects before independent review. Main checks their evidence and
  acceptance against the agreement, routing needed fixes to subagents. The final independent result review checks agreed completeness,
  consistency, documentation and absence of unagreed additions. Each pass is a complete review and returns every
  finding at once.
- The review cycle, ported from the owner's Codex CLI reviewer skills (`DECISIONS.md`, [Review](../DECISIONS.md#review)).
  It runs when the owner asks for a review or a checked result, or when this section requires it, such as before
  a squash merge; never on Main's own initiative. The task has these sections in this order: `<agreement>` only
  when needed, containing only decisions the owner himself accepted, each with its source and evidence of his
  acceptance; Main's or another agent's approval is not agreement. Then `<object>` (exact paths or readable
  references, primary requirements, governing rules, source evidence, the diff as a file path, and the stage
  `pre-action` or `pre-completion`), `<criterion>` (what the check confirms and which deliverable must fulfil each
  obligation; an exclusion cannot silently waive a governing requirement of this pass) and, from the second
  pass on, `<rejected_earlier>`. `include: ["user_messages"]` mechanically appends `<user_messages>` after the task:
  every user-role text of the caller's selected branch, verbatim and in order, including entries before compaction.
  Images and non-user messages are omitted; nested callers contribute their own messages. Do not retype the messages.
  Every review brief, including code and test-integrity review, follows these agreement-source rules and includes
  in `<criterion>`: "Any element beyond the owner's requirements and decisions the owner himself accepted is a finding."
  Set no file, search, tool-call or turn quotas, and leave the reviewed files unchanged until the verdict.
- For large work, run a separate read-only code reviewer in parallel with result review whenever a changed path falls outside
  the `tests.yml` `paths-ignore` filters used by `scripts/deliver-check.mjs`, considering both base and head filters.
  This includes extension READMEs even though their contents are prose. Root Markdown, `notes/**` and `.agents/**`
  alone are excluded by the current filters. Workflow logic is executable configuration and needs code review too.
  Start an `agent` with `agent_type: "code-reviewer"`; its profile supplies the model, effort and review instructions.
  Its task brief defines the exact review scope and permitted supporting context, changed files, diff, callers,
  relevant tests and evidence.
  This role checks bugs, regressions and meaningful code quality, not a second requirements ritual.
- Result-review verdicts and admission, for the `spotty` and `bossy` profile agents only; the code and
  test-integrity reviewers follow the next bullet. `CLEAN` with a complete `CHECKED:` and no `UNCHECKED:` passes the pass; run no extra pass for confidence,
  but keep every independent pass and its order that this section requires. `FINDINGS:` are the teammate's findings:
  Main finds each quote by searching for it. A finding whose two quotes stand verbatim in their sources is admitted;
  for an omission, verify the quoted requirement and the complete inspected file or section instead of demanding
  nonexistent text. Fix an admitted finding exactly to its REQUIRED OUTCOME and no further; do not reject it, argue
  with it or put it to the owner. Reject a finding only when a quote is not verbatim, the allegedly missing content is
  present in the cited object, or a NOT AGREED element is covered by a verbatim quote of the agreement, and give that
  reason with the quote. Main routes all admitted fixes to subagents in one batch, and subagents recheck the affected parts
  and checks, not untouched parts. Then a fresh reviewer runs with the same level, object and criterion and every
  rejection so far in `<rejected_earlier>`, until `CLEAN`. `UNCHECKED:` or missing `CHECKED:` evidence makes the pass
  incomplete whatever the leading verdict: resolve the missing sources or evidence, or retry malformed output; never
  record it as acceptance. No verdict, an error or a reviewer that could not start means the check has not passed and
  no self-check replaces it: launch it once more on the unchanged object, and if it fails again tell the owner and wait.
  When this review contract changes, validate it against known defective, corrected and missing-source examples before
  claiming improved detection; these checks are not extra rounds in ordinary task reviews.
- Code-review, test-integrity and `Combined-review` findings (`agent_type: "code-reviewer"`,
  `agent_type: "test-reviewer"`; the combined reviewer uses the same code profile): admit
  real evidenced defects, not taste or unlikely hypotheticals. Check findings rather than accepting them just because a
  quote exists. Main validates real findings and routes admitted fixes to subagents in one batch; explain rejected
  findings with evidence. Subagents recheck affected parts and checks, not untouched parts. The result-review quote and
  `CHECKED:` rules above, and the prompt formats they name, do not apply to these reviewers.
- A CLEAN covers only the commit it reviewed. Any commit after CLEAN sends the places it changed back to review:
  result review, and code review when the path-based requirement above applies. A conflict-free rebase onto the
  delivery destination changes no task places: it needs the checks in [Delivery](../PROCESS.md#delivery) on the new head,
  not new review; places changed
  while resolving conflicts go back to review.
  Otherwise reuse CLEAN only while its commit is unchanged. Stop when the required reviews are clean; do not
  invent either a one-pass cap that leaves known bugs or endless fresh passes for confidence.
- A finished substage handed over separately gets its own blind independent check. Internal draft/stage commits
  are not handovers and do not create an automatic review gate. Reuse its valid coverage in final review.
