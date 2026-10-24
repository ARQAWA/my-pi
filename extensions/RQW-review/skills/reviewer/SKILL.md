---
name: reviewer
description: "Review procedure for blind and high reviews through ordinary agent profiles; only when requested or required by an invoked skill."
---

# Reviewer

Blind review by a separate read-only model that works with you as one team for the user's agreement: it checks the requested criterion, including checks beyond the agreement and exclusions, and gets the user's own messages verbatim. Use it when the user asks for a review or a checked result: his skills `$blindreview` and `$highreview` ask for these levels, and a skill he calls may run it as its procedure. Never launch a reviewer on your own initiative or as an automatic step of other work. Keep working meanwhile, but leave the reviewed files unchanged until its verdict.

- Level: blind by default; high when the user asks for it. The level picks the profile: blind `spotty` (`gpt-6.1-sol` low), high `bossy` (`gpt-6.1-sol` medium). Launch a fresh child each pass with `agent({action: "start", agent_type: "spotty", include: ["user_messages"], task: ...})` for blind or `agent({action: "start", agent_type: "bossy", include: ["user_messages"], task: ...})` for high; the profile supplies the model default, and the task plus included user messages are the reviewer's input, with every path absolute when the work runs in another directory. The ordinary `agent` tool from RQW-agent is required; if it or the selected profile is unavailable, report that the reviewer cannot run. There is no standalone review tool or fallback.
- Brief: put the task sections below in this order; agent mechanically appends `<user_messages>` at the END, after the task. Do not reproduce user messages yourself. Supply primary requirement and governing-rule sources, not only Main's summary; each reviewer reads them independently, including any required user-facing explanation rules:
  - `<agreement>`, only when there are any: accepted proposals and decisions that are not in the user's own messages, verbatim.
  - `<object>`: exact paths or readable references to the object, primary requirements, applicable governing rules and source evidence, the diff as a file path, and the stage: pre-action or pre-completion; use the saved rules for a versioned workflow.
  - `<criterion>`: what this check confirms and which deliverable must fulfill each obligation; an exclusion cannot silently waive a governing requirement of this pass.
  - `<rejected_earlier>`, from the second pass on: the findings rejected in earlier passes, each with its reason.
  - `<user_messages>`: agent appends every message of the user in this conversation, verbatim and in order, after all task sections via `include: ["user_messages"]`; these are raw user texts, not compaction or branch summaries.
- Do not impose file, search, tool-call or turn quotas on a reviewer. Read-only inspection may take as many calls as the in-scope check needs; large or truncated sources are read in complete parts.
- The verdict comes as the reviewer's final:
  - `CLEAN` with complete `CHECKED:` evidence and no `UNCHECKED:`: this pass passed; run no extra pass for confidence, but preserve every independent pass and its order required by the invoking procedure.
  - `FINDINGS:`: your teammate's findings. Find each quote by searching for it. A finding whose two quotes stand verbatim in their sources is admitted; for an omission, verify the quoted requirement and the complete inspected file/section instead of demanding nonexistent text: fix it exactly to its REQUIRED OUTCOME and no further; do not reject it, argue with it or put it to the user. Reject a finding only when a quote is not verbatim, the allegedly missing content is present in the cited object, or a NOT AGREED element is covered by a verbatim quote of the agreement, and give that reason with the quote. Fix all admitted findings in one batch, then launch a fresh reviewer with the same level, object and criterion and every rejection so far in `<rejected_earlier>`, until CLEAN.
  - `UNCHECKED:` or missing required `CHECKED:` evidence: the check is incomplete regardless of its leading verdict. Resolve missing sources/evidence or retry malformed output; never record it as acceptance.
  - No verdict, an error or a reviewer that could not start: the check has not passed, and no self-check replaces it. Launch it again once on the unchanged object; if it fails again, tell the user and wait.

When changing this review contract, validate it against known defective, corrected and missing-source examples before claiming improved detection. These checks are not extra rounds in ordinary task reviews.
