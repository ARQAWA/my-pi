## Independent review

- Review follows the native `reviewer` skill supplied by `RQW-review`. `blindreview` selects `spotty`,
  `highreview` selects `bossy`; launch the initial pass as a fresh ordinary `agent` with `agent_type`,
  `role_file` set to the absolute package `extensions/RQW-review/REVIEWER.md` path and
  `include: ["user_messages"]`. The profiles default to `openai-codex/gpt-6.1-sol` low and medium respectively.
  The explicit role file keeps the package review contract when a same-name personal or project profile overrides
  the offered profile's instructions; profile discovery and precedence stay unchanged. Read-only is an instruction,
  not a git guard or sandbox. Record `Review: agent#N CLEAN`. If the required skill, profile, role file or `agent` is unavailable,
  report the blocker; do not substitute another runtime or copied whole-system prompt.
- Main names the change class in the task brief and squash message. Reasons and owner sources:
  [DECISIONS.md, Task pipeline](../DECISIONS.md#task-pipeline).
  1. Proofreading: typos, wording, quote spans, links and formatting of passive documents, with no change of meaning
     and no new or changed rule. Proof is local and saved under [Delivery](../PROCESS.md#delivery). The message
     carries `Change-class: proofreading` and `Doc-check: <absolute log path>`, with no review trailer. Never use it
     for runtime prompts, the `coordinator-rules` block, `package.json` or a changed rule.
  2. Ordinary: one independent review covers both result and code, including requirement completeness, real bugs,
     regressions and meaningful quality. Use blind review with `agent_type: "spotty"` unless the owner explicitly
     requests high review. Record exactly one `Review: agent#N CLEAN`; no separate code review or size threshold.
  3. Critical/high-risk: one result review plus a separate read-only code review. Use the owner-requested blind or
     high profile for result review and `agent_type: "code-reviewer"` for code review. Record `Review: agent#N CLEAN`
     and `Code-review: CLEAN`. Runtime prompts also need their mechanical checks and a model probe of the claimed
     behavior. The brief states the concrete risk behind the class.
- An answer or report without changes needs no review. The [third-party installation fast path](third-party-installation-fast-path.md)
  keeps its explicit exception. There is no `Combined-review` shortcut: ordinary work already uses one review for
  result and code. An explicit owner-requested blind/high review always keeps its requested profile.
- Subagents self-check and fix defects before independent review. Main checks evidence against the agreement and
  routes fixes to subagents. Each independent pass is complete for its class and returns every finding at once.
  Reviewers cannot expand scope.
- The review cycle, ported from the owner's Codex CLI reviewer skills (`DECISIONS.md`, [Review](../DECISIONS.md#review)).
  It runs when the owner asks for a review or checked result, or when this section requires it; never on Main's own
  initiative. The task has these sections in order: `<agreement>` only when needed, containing only decisions the
  owner himself accepted, each with source and evidence of acceptance; then `<object>` with exact paths or readable
  references, primary requirements, governing rules, source evidence, the diff as a file path and stage
  `pre-action` or `pre-completion`; then `<criterion>`; and from a changed-object pass on, `<rejected_earlier>`.
  `include: ["user_messages"]` mechanically appends raw user messages after the task. Do not retype them.
  Every review brief, including code and test-integrity review, follows these agreement-source rules and includes
  in `<criterion>`: "Any element beyond the owner's requirements and decisions the owner himself accepted is a finding."
  Set no file, search, tool-call or turn quotas, and leave reviewed files unchanged until the verdict.
- Result-review findings for `spotty` and `bossy`: `FINDINGS:` requires the source quotes defined by the profile.
  Admit a finding when its evidence is verbatim and shows a real requirement breach; for an omission, verify the
  quoted requirement and complete inspected file or section. Fix admitted findings exactly to their REQUIRED OUTCOME.
  Reject only a non-verbatim quote, content already present, or a NOT AGREED item covered by the agreement, with that
  evidence. Route all admitted fixes in one batch and recheck only affected places and checks.
- `CLEAN` requires concise concrete `CHECKED:` evidence for the inspected object and criterion, not a bare verdict or
  a long per-obligation checklist. `UNCHECKED:` names genuinely unavailable required evidence. Taste, unsupported
  hypotheticals and unrequested requirements are rejected.
- Missing or malformed evidence, or a bare `CLEAN`, is incomplete. `send` the SAME reviewer to supply concise evidence
  from its retained inspection or mark the exact gap `UNCHECKED:`; do not start a fresh reviewer for format. A fresh
  reviewer is for a changed object, admitted findings requiring a new pass, or a failed reviewer under the bounded
  failure rule below. No repeated reviews for confidence.
- No verdict, a provider error or a reviewer that could not start means no acceptance and no self-check substitute.
  Retry the unchanged failed review once under the existing bounded failure rule; if it fails again, tell the owner
  and wait. When this review contract changes, validate known defective, corrected and missing-source examples before
  claiming improved detection; these are not extra rounds in ordinary reviews.
- Code-review and test-integrity findings (`agent_type: "code-reviewer"` or `"test-reviewer"`): admit real evidenced
  defects, not taste or unlikely hypotheticals. Main validates them and routes admitted fixes in one batch, with
  evidence for rejections. The result-review quote and prompt-format rules do not apply to these reviewers. Their
  missing evidence is likewise completed by the same reviewer; a changed object gets a fresh reviewer.
- Routine test changes need no separate test-integrity review. The separate `test-reviewer` pass and `Test-change:` /
  `Test-review:` trailers remain only for mechanically detected weakening under
  [Quality control loop](quality-control-loop.md); critical/high-risk changes receive separate code review above.
- A CLEAN covers only the commit it reviewed. Any later commit sends changed places back to the required review.
  A conflict-free rebase changes no task places and needs only the checks in [Delivery](../PROCESS.md#delivery);
  conflict resolutions go back to review. Otherwise reuse CLEAN only for the identical commit. Stop when required
  reviews are clean, without a one-pass cap that leaves known bugs or endless fresh passes for confidence.
- A finished substage handed over separately gets its own independent check. Internal draft/stage commits are not
  handovers and create no automatic review gate. Reuse valid coverage in final review.
