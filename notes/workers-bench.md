# Workers benchmark (B3)

Measurement of code_writer and shell_runner on Haiku 5.5, GPT-6 Luna and GPT-5.6 Luna at four reasoning levels, and the level
the B4 rule selects. Task, method and bar: /tmp/cw-sr/TASKS.md, blocks B1-B4. Raw results stay in the OS temp
directory: `$TMPDIR/workers-bench` (here `/var/folders/cf/2mk2lmy9087c_lw961rpfvz00000gn/T/workers-bench`,
below `bench/`).

## Method

- Task set (B1): 25 tasks per role (15 tuning, 10 holdout) on fixture git repositories made by a script; each task
  has a brief, a deterministic check and a judge rubric. Proof that every check fails untouched and passes on the
  reference: `bench/logs/verify-20261021-235648.log`; brief-question check empty: `bench/logs/ask-20261021-235439/`.
- Runner (B2): `bench/lib/runner.ts`, a real `createAgentSession` built like the worker branch of
  `createSession()` in `extensions/RQW-agent/index.ts`: role prompt as the whole system prompt, the role's tool
  set from RQW-tools, the git guard on every bash call, credentials from the owner's Pi auth.
- Matrix: {Haiku 5.5, GPT-6 Luna, GPT-5.6 Luna} x {low, medium, high, xhigh} x {code_writer, shell_runner} x 25 tasks x 5 repeats,
  shuffled order (seed 20261021), at most 4 sessions at once, on the owner's Mac (`bench/matrix.mjs`).
- Pass: the deterministic check passes and the run ended without error (`blocked` fails except on the two
  commit-request tasks). A run is cut after 15 minutes and counts as failed.
- Judge: openai-codex/gpt-6.1-sol medium, blind to model and level, scores the report 0-10 by the rubric; for a
  failed run it also rates the caller's fix as small, medium or large. Changed lines: diff between the worker's
  fixture and the reference solution (code_writer only).
- Bar: a cell qualifies with at least 95% on tuning (at most 3 of 75 failed) and at least 95% on holdout (at most 2
  of 50 failed).

## Tuning loop

Classification of every failed tuning run and the fixes: `bench/logs/b3-tuning-round1-classification.md`.

- Round 1, all cells, roles as of 84fed6b (`bench/results/b3-tuning-round1.jsonl`, summary
  `bench/logs/b3-tuning-round1-summary.md`): 70 of 1200 runs failed. code_writer: 2 failures, both model limits
  (Luna). shell_runner: 68 failures, all role prompt defects (stop policy with batched commands, output path lost
  on timeout, service pid of a wrapper shell, error lines without the failing test name, unclear 40-line cap). No
  brief defects. Fix: 41f10a1.
- Round 2 (41f10a1) was stopped after about 180 runs and is not used: the service-start defect remained, and
  another matrix in the same directory (gpt-5.6-luna, not part of this measurement) ran at the same time, which put
  the total over 4 sessions and shared port 47811. Fix: 6a539c3. Round 3 started after that matrix ended.
- Round 3, all 8 shell_runner cells, roles 6a539c3 (`bench/results/b3-tuning-shell-r3.jsonl`, summary
  `bench/logs/b3-tuning-shell-r3-summary.md`): 9 of 600 failed; 8 role prompt defects (40-line cap competing
  with "each failing test"; service start after `&&`), 1 model limit. Fix: 1983702.
- Round 4, all 8 shell_runner cells, roles 1983702 (`bench/results/b3-tuning-shell-r4.jsonl`, summary
  `bench/logs/b3-tuning-shell-r4-summary.md`): 4 of 600 failed, all Luna copying 50 error lines despite the cap:
  model limit. Loop ended.
- Final tuning data: code_writer from round 1 (its role prompt did not change), shell_runner from round 4:
  `bench/results/b3-tuning-final.jsonl`, with the guard reruns below: `bench/results/b3-tuning-final-guard.jsonl`. Holdout tasks were not read during tuning; the holdout matrix ran once
  with the final prompts (code_writer 84fed6b, shell_runner 1983702): `bench/results/b3-holdout.jsonl`, failures
  `bench/logs/b3-holdout-failures.txt`.

- GPT-5.6 Luna (added by the owner on 2026-10-22: «проверь шел раннера на луна 5.6 и код райтера тоже»). Its
  first tuning pass ran in a separate worker with the round-1 role prompts (ea930de, same text as 84fed6b):
  `bench/results/b3-tuning-luna56.jsonl` (analysed from the copy `bench/results/b3-tuning-luna56-copy.jsonl`,
  failures `bench/logs/luna56-tuning-failures.txt`). 69 of 600 failed. code_writer: 20, all 15-minute run timeouts
  after a write call ran to the 128000-token output limit: model limit; the code_writer prompt never changed, so
  these cells are final. shell_runner: 49, the same role prompt defects already fixed for the other models; its 4
  shell cells were rerun with roles 1983702 (`bench/results/b3-tuning-luna56-shell-final.jsonl`): 2 of 300 failed,
  both model limits. Final: `bench/results/b3-tuning-luna56-final-guard.jsonl`. Holdout once with the final prompts:
  `bench/results/b3-holdout-luna56.jsonl`, failures `bench/logs/b3-holdout-luna56-failures.txt`.

## Unmeasured changes

The service-start recipe in `extensions/RQW-agent/roles/shell_runner.md` changed after this benchmark: it now
places leading VAR=value assignments before `exec nohup`, rather than passing them to nohup as the executable.
This sentence/recipe change is unmeasured; the results below apply to the benchmark prompts, not this revision.
The git guard's redirection/operand parsing was also corrected after the benchmark; focused deterministic tests
cover that syntax fix, but the benchmark was not rerun with it.

## Git guard version

The measured `extensions/RQW-agent/git-guard.ts` version is 83d2365 (blob 3f13cad, after ca8ece6). Every record carries
`guard`: recorded (`worktreeHead`, `guardBlob`, added to the runner after the measurement) or inferred from the run
start against the 83d2365 commit time (`bench/lib/annotate-guard.mjs`). Holdout, shell_runner rounds 3-4 and every GPT-5.6 Luna run
started after it. 147 code_writer tuning runs of round 1 started before it; the 15 of them that ran a git command
or were the commit-request task (t15) were rerun with the current guard (list `bench/logs/guard-affected-tuning.txt`,
reruns `bench/results/b3-tuning-guard-rerun.jsonl`, all 15 passed) and replace the old records. The other 132 ran no
git command and had no guard block, so the guard did not take part in their outcome; they keep `before 83d2365`.

## Results

Source: `bench/logs/b3-final-3models-summary.md` (made by `bench/summarize.mjs` from
`bench/results/b3-tuning-3models.jsonl` and `bench/results/b3-holdout-3models.jsonl`). Judge mean,
times, tokens and report length are over tuning and holdout runs together; input tokens include cache reads and
writes.

| model | role | level | tuning pass | holdout pass | qualifies | judge mean (all runs) | wall median s | wall p90 s | median input tok | median output tok | median report chars | failed runs: fix small/medium/large/unrated | changed lines vs reference (median, sum) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| claude-haiku-5-5 | code_writer | low | 75/75 (100.0%) | 50/50 (100.0%) | yes | 9.7 | 4.6 | 7.6 | 17601 | 615 | 283 | 0/0/0/0 | - |
| claude-haiku-5-5 | code_writer | medium | 75/75 (100.0%) | 50/50 (100.0%) | yes | 9.7 | 4.9 | 8.0 | 17792 | 693 | 303 | 0/0/0/0 | - |
| claude-haiku-5-5 | code_writer | high | 75/75 (100.0%) | 50/50 (100.0%) | yes | 9.6 | 5.6 | 9.5 | 17825 | 759 | 326 | 0/0/0/0 | - |
| claude-haiku-5-5 | code_writer | xhigh | 75/75 (100.0%) | 50/50 (100.0%) | yes | 9.5 | 8.3 | 13.5 | 24265 | 987 | 359 | 0/0/0/0 | - |
| claude-haiku-5-5 | shell_runner | low | 75/75 (100.0%) | 50/50 (100.0%) | yes | 9.6 | 6.4 | 12.4 | 19507 | 944 | 479 | 0/0/0/0 | - |
| claude-haiku-5-5 | shell_runner | medium | 75/75 (100.0%) | 50/50 (100.0%) | yes | 9.6 | 7.6 | 13.4 | 19741 | 971 | 486 | 0/0/0/0 | - |
| claude-haiku-5-5 | shell_runner | high | 75/75 (100.0%) | 50/50 (100.0%) | yes | 9.6 | 8.5 | 15.3 | 19877 | 1058 | 500 | 0/0/0/0 | - |
| claude-haiku-5-5 | shell_runner | xhigh | 75/75 (100.0%) | 50/50 (100.0%) | yes | 9.6 | 11.1 | 21.7 | 21442 | 1232 | 518 | 0/0/0/0 | - |
| gpt-6-luna | code_writer | low | 75/75 (100.0%) | 50/50 (100.0%) | yes | 9.9 | 7.1 | 12.6 | 15602 | 299 | 170 | 0/0/0/0 | - |
| gpt-6-luna | code_writer | medium | 75/75 (100.0%) | 49/50 (98.0%) | yes | 9.8 | 7.2 | 14.2 | 15774 | 318 | 169 | 1/0/0/0 | 7, 7 |
| gpt-6-luna | code_writer | high | 74/75 (98.7%) | 50/50 (100.0%) | yes | 9.8 | 7.9 | 15.1 | 16299 | 335 | 168 | 0/1/0/0 | 8, 8 |
| gpt-6-luna | code_writer | xhigh | 74/75 (98.7%) | 50/50 (100.0%) | yes | 9.9 | 10.2 | 17.9 | 13870 | 401 | 175 | 1/0/0/0 | 1, 1 |
| gpt-6-luna | shell_runner | low | 72/75 (96.0%) | 49/50 (98.0%) | yes | 9.5 | 7.3 | 13.0 | 11440 | 485 | 344 | 4/0/0/0 | - |
| gpt-6-luna | shell_runner | medium | 75/75 (100.0%) | 50/50 (100.0%) | yes | 9.6 | 7.6 | 14.2 | 11463 | 507 | 352 | 0/0/0/0 | - |
| gpt-6-luna | shell_runner | high | 74/75 (98.7%) | 50/50 (100.0%) | yes | 9.7 | 11.7 | 19.0 | 11661 | 571 | 369 | 1/0/0/0 | - |
| gpt-6-luna | shell_runner | xhigh | 75/75 (100.0%) | 50/50 (100.0%) | yes | 9.8 | 14.6 | 27.8 | 11789 | 689 | 358 | 0/0/0/0 | - |
| gpt-5.6-luna | code_writer | low | 67/75 (89.3%) | 42/50 (84.0%) | no | 8.5 | 8.2 | 900.0 | 13949 | 620 | 149 | 12/1/3/0 | 7, 193 |
| gpt-5.6-luna | code_writer | medium | 70/75 (93.3%) | 41/50 (82.0%) | no | 8.6 | 8.4 | 899.9 | 14240 | 624 | 149 | 12/1/1/0 | 7, 22245 |
| gpt-5.6-luna | code_writer | high | 74/75 (98.7%) | 43/50 (86.0%) | no | 9.1 | 8.3 | 23.7 | 14470 | 660 | 149 | 8/0/0/0 | 6, 47483 |
| gpt-5.6-luna | code_writer | xhigh | 69/75 (92.0%) | 46/50 (92.0%) | no | 9.0 | 9.5 | 589.8 | 14830 | 702 | 147 | 6/1/3/0 | 7, 125 |
| gpt-5.6-luna | shell_runner | low | 74/75 (98.7%) | 49/50 (98.0%) | yes | 9.6 | 7.6 | 12.3 | 11550 | 562 | 341 | 2/0/0/0 | - |
| gpt-5.6-luna | shell_runner | medium | 74/75 (98.7%) | 50/50 (100.0%) | yes | 9.6 | 8.4 | 13.1 | 11647 | 605 | 344 | 1/0/0/0 | - |
| gpt-5.6-luna | shell_runner | high | 75/75 (100.0%) | 49/50 (98.0%) | yes | 9.6 | 8.7 | 14.7 | 11760 | 661 | 339 | 1/0/0/0 | - |
| gpt-5.6-luna | shell_runner | xhigh | 75/75 (100.0%) | 50/50 (100.0%) | yes | 9.6 | 9.3 | 17.3 | 11846 | 750 | 348 | 0/0/0/0 | - |

Failed runs: tuning in `bench/logs/b3-final-3models-summary.md` (section "Failed runs"), holdout in
`bench/logs/b3-holdout-failures.txt` and `bench/logs/b3-holdout-luna56-failures.txt`. For Haiku and GPT-6 Luna every
failed run was rated "small" by the judge except one "medium". GPT-5.6 Luna code_writer failures are almost all
15-minute timeouts after a runaway write; the huge changed-line sums (up to 47483) are those runaway file
contents.

## B4: chosen levels

Rule (TASKS.md B4): take low when it qualifies, its pass rate (here tuning and holdout together) is not lower than
medium's and its judge mean is at most 0.5 below medium's; otherwise the qualifying medium.

| model | role | B4 outcome |
|---|---|---|
| anthropic/claude-haiku-5-5 | code_writer | low (low 100.0%, judge 9.7; medium 100.0%, judge 9.7) |
| anthropic/claude-haiku-5-5 | shell_runner | low (low 100.0%, judge 9.6; medium 100.0%, judge 9.6) |
| openai-codex/gpt-6-luna | code_writer | low (low 100.0%, judge 9.9; medium 99.2%, judge 9.8) |
| openai-codex/gpt-6-luna | shell_runner | medium (low qualifies but loses on pass rate or judge; medium 100.0%, judge 9.6) |
| openai-codex/gpt-5.6-luna | code_writer | neither low nor medium qualifies: owner decides from the four-level table |
| openai-codex/gpt-5.6-luna | shell_runner | medium (low qualifies but loses on pass rate or judge; medium 99.2%, judge 9.6) |

Haiku 5.5 and GPT-6 Luna: all 16 cells qualify. GPT-6 Luna shell_runner: low qualifies (121 of 125) but its pass
rate is below medium's (125 of 125), so medium. GPT-5.6 Luna shell_runner: low (123 of 125) is below medium (124
of 125), so medium.

GPT-5.6 Luna code_writer: no level qualifies (holdout below 95% at every level, tuning too except high). By TASKS.md B3 the
owner chooses from this trade-off table (all four levels, tuning and holdout together; source
`bench/logs/b3-final-3models-summary.md`):

| level | pass rate | wall median s | wall p90 s | failed runs: fix small/medium/large | median changed lines of failed runs | median input / output tokens |
|---|---|---|---|---|---|---|
| low | 109/125 (87.2%) | 8.2 | 900.0 | 12/1/3 | 7 | 13949 / 620 |
| medium | 111/125 (88.8%) | 8.4 | 899.9 | 12/1/1 | 7 | 14240 / 624 |
| high | 117/125 (93.6%) | 8.3 | 23.7 | 8/0/0 | 6 | 14470 / 660 |
| xhigh | 115/125 (92.0%) | 9.5 | 589.8 | 6/1/3 | 7 | 14830 / 702 |
