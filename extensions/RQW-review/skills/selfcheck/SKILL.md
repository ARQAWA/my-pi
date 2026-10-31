---
name: selfcheck
description: "Self-check and blind-review loop run by a fork of the finished executor; only when requested or required by the caller, project instructions or an invoked skill."
---

# Selfcheck

The executor finishes the work, then a fork of itself checks, fixes and runs the blind loop, and returns one report. The review rules stay in the reviewer skill at `../reviewer/SKILL.md` relative to this skill file; do not restate them. The skill explicitly authorizes the reviewer launches that skill describes.

## Caller phase

You are the executor and no fork has been started for this object yet.

1. Finish the work and its ordinary checks. No tool call may still run.
2. Start the fork with `agent({action: "start", fork_turns: "all", title: "Self-check and blind", task: ...})`. Pass no `model`, `thinking`, `agent_type`, `system`, `system_file`, `role`, `role_file` or `include`: the fork must be the same agent with the same history, and `fork_turns: "all"` rejects them.
3. The `task` carries: the absolute path of this skill file and "you are the fork, run the fork phase"; the exact object (paths, diff file, stage); the primary requirements and the user's words they come from. It says that `agent#N` and `job#N` ids in the copied history are not alive.
4. Wait for the single report from this child. Do not edit the object meanwhile and do not start a reviewer for it yourself.
5. Reread the changed paths before any new edit; your earlier reads are stale. Stop the fork once its report is in. The fork's history is not merged into yours.

## Fork phase

You are the fork. Do not start another selfcheck fork.

1. Check the result against the user's words and the primary requirements. Run the affected tests and, where possible and allowed, the product. Fix what you find. Keep other people's edits and the ordered scope.
2. Run the blind loop exactly as the reviewer skill describes, at level blind: a fresh `spotty` child with `role_file` and `include: ["user_messages"]`, started without `fork_turns`, and the brief from that skill. Do not pass your own verdict to the reviewer. Fix every admitted finding as one batch and start a new pass until the reviewer skill's stop condition is met. A reviewer failure follows the reviewer skill; a repeated failure ends the loop as blocked, never CLEAN.
3. Return one report to your parent, with no intermediate rounds:
   - admitted findings with their count, and fixes with changed paths;
   - checks run and their real results;
   - checks not run, each with its concrete limit;
   - number of blind rounds;
   - `CLEAN`, or the reason the loop did not finish.
