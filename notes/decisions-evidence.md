# Decision evidence

Frozen measurement, benchmark, probe and source evidence moved from
`30952e6:DECISIONS.md`. Active rules link here from [DECISIONS.md](../DECISIONS.md).
Complete original decision blocks and their provenance are preserved in
[DECISIONS-ARCHIVE.md](../DECISIONS-ARCHIVE.md). Historical figures are not new measurements
or current runtime guarantees. Frozen quotations retain their original attribution, not
newly verified owner authority. Original source ranges accompany the excerpts.

Measurement, probe and incident ledgers that active entries of [DECISIONS.md](../DECISIONS.md) link to. Each section
copies the original `DECISIONS.md` text at `30952e6` byte for byte, with its line range; the full original entries
are in [DECISIONS-ARCHIVE.md](../DECISIONS-ARCHIVE.md). Frozen evidence, not current rules.

## CI dying test file

Evidence for `[D-WORK-CI-EVIDENCE]`. Source: `DECISIONS.md` at `30952e6`, lines 132-142.

~~~text
- CI evidence for a test file that dies. Coordinator decision (technical), no owner quote: the `npm test` steps keep
  Node's default log output and also write a TAP copy, uploaded on failure with the job's macOS crash reports; a
  manual stress workflow repeats the 12 MB codemode tests with exit code and peak RSS per run.
  Reason: `codemode.test.ts` died silently once on macOS Node 24 (run 39948373095); on Node 24 the spec reporter
  shows such a file only as 'test failed', so the root cause was not recoverable without its exit code or signal,
  which the TAP copy carries. Carriers:
  `scripts/ci-npm-test.sh` (Node's default log reporter plus a TAP copy), `.github/workflows/tests.yml` (artifact
  `test-evidence-*`, also with `/Library/Logs/DiagnosticReports` for JetsamEvent memory kills) and
  `.github/workflows/codemode-stress.yml` (input `runs`, `summary.tsv` with exit code and peak RSS per run).
  Implementation choice: GitHub dispatches only workflows present on the default branch, so the stress workflow also
  runs on a push to the branch `codemode-stress` (30 runs), like `pcli.yml` with `pcli`.
~~~

## Scope bench41

Prompt baseline behind the bench41 template (file outside the repository). Archived entry: A-0029. Source: `DECISIONS.md` at `30952e6`, lines 161-163.

~~~text
- Reason: bench41 (`~/Documents/ChatGPT/my-omp-harness/bench/bench41.csv`, T01-T07, 3 runs): the omp-lite prompt alone
  raised stock Pi by 10.2 quality points on gpt-6-sol low, 6.2 on gpt-6-sol medium and 1.9 on gpt-6.1-sol medium;
  omp-lite beat that only on low (+3.5) and was lower and slower on both medium configs.
~~~

## Scope reviewer package sizing

Why `[D-SCOPE-REVIEWERS]` built its own extension. Archived entry: A-0034. Source: `DECISIONS.md` at `30952e6`, lines 174-176.

~~~text
- Reviewers, accepted plan (user: «То, что ты предложил по ревьюерам — it's OK, я принимаю»): own extension
  `RQW-review` on `createAgentSession`, no ready package (pi-subagents: ~98k lines, ~1.3k tokens per request, fails
  strict schemas). One tool `review` with `level` `blind` or `high`; a fresh session per pass with `read`, `bash`,
~~~

## Tools edit strict sampling replay

Evidence for `[D-TOOLS-EDIT-STRICT]`. Source: `DECISIONS.md` at `30952e6`, lines 248-263.

~~~text
- edit is sent without strict tool sampling: our edit sets `constrainedSampling` to undefined, so Pi does not send it
  as an Anthropic `strict` tool (constrained decoding); read, bash and write keep the stock `strict: "prefer"`. Owner:
  «01a15f4f-7b7e-70e6-b1e2-bb238ce75359 Также в этой сессии поработал агент, и там дохуя ошибок записи. Он делает
  параллельные эдиты: проредактировал и потом снова делает через время параллельные эдиты. И там целая вереница
  эдитов красная, с ошибками. Он потом перепосчитал файлы и снова отредактировал. Надо разобраться, этот баг
  пофиксить.» Reason: in that session (claude-opus-5-5) all 15 failed edit calls carried garbled arguments, not
  stale text: a replay of the files from Git plus every successful edit matched each successful oldText exactly once.
  Each failed oldText broke where Cyrillic text began (literal `\u0430`-style escapes, a lone `"` or `\b`, an added
  newline, newText `x`). All were single calls; both parallel batches succeeded, so neither the barrier nor
  multi-file grouping was involved. Pi 1.4.0 marks stock edit `strict: "prefer"` and Opus 5.5 `supportsStrictTools`.
  Probe replaying the session before four failing turns, 4 runs each: edit as sent (strict) 0 of 12 Cyrillic edit
  calls usable; the stock-shaped edit schema with strict garbled 5 of 9 calls; edit without strict matched 40 of 41
  blocks (the miss: a space for a line break). gpt-6.1-sol matched all 27 blocks with and without strict. A strict
  write of a 14 000-character file with 5 500 Cyrillic letters came through intact 4 of 4, so write keeps strict.
  Carried by `extensions/RQW-tools/index.ts`; test in `extensions/RQW-tools/test/tools.test.ts` (the Anthropic
  request has no `strict` on edit and keeps it on write).
~~~

## Tools codemode watchdog

Incident record behind `[D-TOOLS-CODEMODE-WATCHDOG]`; analysis also in `notes/settings-codemode.md#test-watchdog`. Source: `DECISIONS.md` at `30952e6`, lines 268-274.

~~~text
- Owner: «Отдельной задачей разобрать, почему тест кодмода на Windows иногда не укладывается в 5 секунд, и исправить причину».
  Reason: the 500 KB codemode ordering test spent its watchdog budget streaming about 31,000 tiny faux-provider
  deltas before tools could execute, not waiting in the barrier. Its faux provider now uses fixed larger chunks;
  a deterministic delta-count assertion prevents that overhead returning. The 5 s deadlock watchdog, payload,
  ten repetitions and ordering assertions stay unchanged; no runtime barrier or codemode change is needed.
  Carrier: `extensions/RQW-tools/test/codemode.test.ts`; analysis and proof:
  [notes/settings-codemode.md, Test watchdog](notes/settings-codemode.md#test-watchdog).
~~~

## Tools barrier order lines

Evidence for `[D-TOOLS-HIDDEN-ORDER]` (commit `0a2028e`). Source: `DECISIONS.md` at `30952e6`, lines 296-299.

~~~text
- The descriptions do not explain the barrier order (bash waits for earlier calls, a read waits for an earlier write).
  Reason, measured on gpt-6.1-sol medium, T01: with those lines the model made one call per response in 8 of 8 runs
  (14-18 responses); without them it batched in 9 of 9 runs (3-5 responses). The barrier works without the model
  knowing it.
~~~

## Tools bench42

bench42 result, its first interpretation, the five-vote regrade and the `TRADING_LOGIC.md` run; evidence for `[D-TOOLS-JUDGING]` and `[D-TOOLS-ANSWER-IN-CHAT]`. Rows: `notes/bench42.csv`. Source: `DECISIONS.md` at `30952e6`, lines 300-317.

~~~text
- bench42 (commit `0a2028e`, T01-T07, 3 runs, same completion judge and checklists as bench41; rows in
  `notes/bench42.csv`). Pi with the bench41 prompt vs my-pi:

  | Config | Pi + prompt | my-pi |
  |---|---|---|
  | gpt-6-sol medium | 47.4 s / q91.9 | 47.0 s / q89.0 |
  | gpt-6.1-sol medium | 64.6 s / q99.0 | 67.2 s / q92.5 |
  | gpt-6-sol low | 28.4 s / q90.5 | 27.4 s / q89.6 |

  Speed is the same. The quality gap comes from T01 (80/93/80 vs 67/80/67: the answer misses the Python twin) and one
  gpt-6.1-sol run of T02 that wrote its answer to `TRADING_LOGIC.md` (q18, 256 s); without that run gpt-6.1-sol medium
  is 57.8 s / q96.2. Open: tune the grep description against T01.
- bench42 regraded with 5 judge votes per answer, majority per point: 92.9 / 91.0, 96.2 / 91.6, 90.5 / 89.0
  (Pi + prompt / my-pi). The 90% bootstrap interval of the difference includes zero on every config. The T01 gap was
  judge noise on one point; both stands miss the Python usage point equally. Judging from now on: 5 votes, majority.
- The `TRADING_LOGIC.md` run: the model's reasoning shows it hit the answer length limit of the prompt and moved the
  answer into a file, which the prompt allowed ("the file is the answer"). `SYSTEM.md` now says to answer a question
  about the code in the chat and to create or change files only when the task asks for it.
~~~

## Tools description probes

Evidence for `[D-TOOLS-EDIT-WRITE-DESC]`, `[D-TOOLS-READ-DESC]`, `[D-TOOLS-SEARCH-DESC]` and `[D-TOOLS-DESC-PRECISION]`. Source: `DECISIONS.md` at `30952e6`, lines 318-335.

~~~text
- edit and write descriptions refined by probes (`notes/refine/refine-editwrite.md`; EDIT, WRITE and a multi-block task,
  gpt-6.1-sol medium and gpt-6-sol low, 3 runs per cell): the multi-file form comes first and a rename gets one edit per
  occurrence with enough of its line. Failed edit calls 5 -> 0, multi-file edit calls 12 of 23 -> 15 of 16, all runs
  correct in both texts. A variant that told the model bash sees the changed files again made gpt-6.1-sol issue one
  call per response and was rejected.
- read description refined by probes (`notes/refine/refine-readbash.md`; T02, T05, EDIT, WRITE, two models, 96 runs):
  read a needed file whole in one call and read every file needed next in one response. Correctness 99.6 -> 100,
  whole-file reads 79% -> 84%, responses equal; the speed change is within noise. bash stays as it was: no run searched
  or read through bash, and a line asking to run tests in the same response as the edit split responses on gpt-6.1-sol.
- grep and find descriptions refined by probes (`notes/refine/refine-search.md`; T01, T03, T06, two models, 72 runs):
  the wave names the spellings to try, reads every file the hits already justify in one response, and the stop rule
  asks for where each value is set, used and what the code does with it, for every implementation. find shows brace
  alternatives. Checklist coverage 94.1% -> 95.0%, within noise; chosen by the rule completeness, then responses.
- Second description review (`notes/review-descriptions-2.md`, 8 findings) fixed as wording only: grep respects
  .gitignore inside a git repository only, a grep glob with "/" matches from path, find also returns directories, the
  edit hint may be absent, a cut grep line is read around instead of narrowing, a tool result that names cat or sed
  overrides the ban, a long file written in parts is the one exception to one edit call per file. bench43 measured the
  texts before these fixes.
~~~

## Tools bench43

Intermediate benchmark (commit `9e13b55`). Source: `DECISIONS.md` at `30952e6`, lines 336-340.

~~~text
- bench43 (commit `9e13b55`, T01-T07, 5 runs, judge 5 votes with majority per point). Pi + prompt / my-pi:
  gpt-6-sol medium 38.2 s q90.8 / 37.6 s q90.8; gpt-6.1-sol medium 51.4 s q96.8 / 52.1 s q96.8; gpt-6-sol low
  26.4 s q89.6 / 24.2 s q91.4. 90% intervals of my-pi minus Pi + prompt: quality [-1.7, 2.3], [-2.2, 2.2],
  [-0.5, 4.1]; seconds [-1.9, 0.8], [-1.2, 2.6], [-3.4, -1.1]. my-pi is equal on medium and faster on low; no file
  written in any run. Both stands miss the same points: T01 Python usage, T06 auth blocker delay, T03 Python NG copy.
~~~

## Tools inactive implementation probe

Evidence for `[D-TOOLS-INACTIVE-IMPL]` (commit `7890a8b`). Source: `DECISIONS.md` at `30952e6`, lines 341-344.

~~~text
- Prompt line for implementations that do not run: say where the value is set, where it is used and what that code
  does. Probes T01, T03, T06, two models, 3 runs, judge 5 votes: gpt-6.1-sol medium q95.6 -> 100, gpt-6-sol low
  q85.6 -> 92.2, speed and responses unchanged. A second line asking to name every setting on the code path made both
  models worse (q87.0 / 83.3) and was rejected.
~~~

## Tools edit tasks

Edit-task speed comparison (commit `7890a8b`). Source: `DECISIONS.md` at `30952e6`, lines 345-348.

~~~text
- Edit tasks (EDIT rename across 4 files, WRITE 3 new files, MULTI 3 blocks in one file plus 2 files; 5 runs, two
  models): every run of stock Pi, Pi + prompt and my-pi passed its tests. Seconds Pi / Pi + prompt / my-pi:
  gpt-6.1-sol medium 21.0 / 22.0 / 22.6, gpt-6-sol low 17.0 / 18.8 / 17.2; my-pi minus Pi + prompt on gpt-6-sol low
  [-2.2, -0.9] s. On WRITE both prompted stands read the repository before writing, stock Pi writes at once.
~~~

## Tools bench44

Final benchmark of the tools work (commit `7890a8b`). Rows: `notes/bench44.csv`. Source: `DECISIONS.md` at `30952e6`, lines 349-361.

~~~text
- bench44, the final check (commit `7890a8b`; stock Pi, Pi + bench41 prompt and my-pi run at the same moment; T01-T07,
  5 runs; judge 5 votes, majority per point; rows in `notes/bench44.csv`). Seconds / quality:

  | Config | Pi | Pi + prompt | my-pi |
  |---|---|---|---|
  | gpt-6-sol medium | 29.9 s / q81.7 | 37.8 s / q90.2 | 37.6 s / q93.6 |
  | gpt-6.1-sol medium | 40.7 s / q94.1 | 49.6 s / q97.2 | 50.0 s / q99.0 |
  | gpt-6-sol low | 16.3 s / q74.0 | 26.5 s / q89.0 | 27.1 s / q93.8 |

  90% intervals, my-pi minus Pi + prompt: quality [0.6, 6.3], [-0.3, 3.4], [1.9, 7.5]; seconds [-2.2, 1.7],
  [-1.9, 2.9], [-0.8, 1.9]. my-pi minus stock Pi: quality [8.6, 15.2], [3.2, 6.5], [15.3, 24.2]; seconds [6.3, 9.0],
  [7.3, 11.5], [9.7, 11.9]. my-pi answers better than both at the speed of Pi + prompt; stock Pi is faster because it
  stops early with incomplete answers. No run changed the repository. Edit tasks: see the edit-task entry above.
~~~

## Tools faster writing probes

Evidence for `[D-TOOLS-SPECIFIED-WRITE]`. Source: `DECISIONS.md` at `30952e6`, lines 362-368.

~~~text
- Faster writing (`notes/refine/refine-write2.md`, `notes/refine/refine-find.md`; WRITE, EDIT, MULTI, T01, T03, T05,
  T06; two models): a new file the task fully specifies needs no read of its neighbours (one line in `SYSTEM.md`, one
  in `read.md`), and the find example shows that "app" returns the directory only while "app/**" returns its files.
  Measured in two steps: the read lines against main (WRITE 18.4 s / 5.5 responses -> 16.0 s / 4.7, T01 and T05
  checklists equal), then the find example against that (edit tasks 19.4 s -> 17.3 s, question checklists 94.8% ->
  96.3%, not lower). All runs correct. gpt-6.1-sol still makes a second find in 2 of 6 WRITE runs. A review then made
  the find, read and prompt wording exact (full-path matching, imported code, long files in parts) without new runs.
~~~

## Background jobs evidence

Evidence for `[D-TOOLS-BG]`: the first live probe and its two refinements, the snapshot cost, the replay behind FR-safe, the pilot probe defects and the code-review fixes. Paths under `my-pi-evidence/` and `$TMPDIR` are outside this repository. Source: `DECISIONS.md` at `30952e6`, lines 403-422, 435-453, 503-525.

~~~text
  job is explicit: `job wait`, then the dependent call. Reason: Pi starts every call of a response before any can
  reach 12 s and starts the next response only after all of them returned, so "registered before the handoff" means
  "same response"; this keeps the measured same-response ordering (section Tools, ordered conflict barrier) and lets a
  server or a long build stop blocking the agent; Codex 0.163.0 and oh-my-pi 18.8.9 do not order shell calls at all.
  Race analysis, rejected alternatives and cost: `my-pi-evidence/bash-background/D4-ORDERING.md`; design:
  `DESIGN.md` there. Carriers: `extensions/RQW-tools/jobs.ts`, `barrier.ts`, `nested.ts`, `index.ts`, `codemode.ts`,
  `descriptions/bash.md`, `descriptions/job.md`; `extensions/RQW-agent/index.ts`, `roles/*.md`.
  Proof: `extensions/RQW-tools/test/background.test.ts` (injected threshold, gate-file commands),
  `test/barrier-detach.test.ts` in that folder (held operations, an independent oracle, randomized detach; it fails
  with a no-op detach, and the queued-edit test fails when file jobs detach too),
  `extensions/RQW-agent/test/wait.test.ts` (job tool in a child, interrupt and stop).
  Two refinements from the first live probe (logs `my-pi-evidence/bash-background/probe/runs/`): `wait` keeps
  collecting for 250 ms after the first selected job ends, because a call queued behind it ends milliseconds later
  and returning without it cost the model one more response in 7 of 8 build runs; and a bash call whose own
  `timeout` ends it within 1 s after the threshold stays in the foreground (as oh-my-pi bounds its wait by the
  timeout), because `timeout: 12` reported a dying server as running.
  Live probe (owner D6: Haiku 5.5 and GPT-6 Luna, both thinking high; 28 runs in two rounds): builds went to the
  background, same-response calls ran after them, dependent calls followed a `job wait`, models batched calls, and
  every job was waited for, killed or ended by its timeout before the final answer. Report and logs:
  `my-pi-evidence/bash-background/probe/REPORT.md`.
~~~

~~~text
  sessions, they get attributed notes. Effects report (O1): a top-level bash or codemode call takes a snapshot of
  the working tree (every file of `git ls-files -co --exclude-standard`, or outside git a walk of at most 20000 files
  without .git, node_modules, .next, target, .venv, __pycache__, with mtime and size) right before its command starts,
  and a job takes another when it ends. What changed is the difference of the two states, never a time cutoff: a file
  written just before the start is not a change whatever the clocks say (the code review found the cutoff's false
  reports; a test with the files aged had hidden it). A file the snapshot does not list (git-ignored, outside the
  tree) falls back to its mtime against the start. Cost, paid by every top-level bash and codemode call (measured,
  `$TMPDIR/bb-r3-snapshot-cost.log`): 8-12 ms for this repository (283 files), 17-18 ms for a 1420-file repository,
  133-150 ms for a 20000-file walk outside git; each report states its own cost in `scanned`. Owner's cost decision
  (option 1A of `my-pi-evidence/bash-background/SNAPSHOT-COST.md`: the exact snapshot before every call, against a
  cheaper scan at the handoff with an uncertainty list): «Да, если это всего лишь 150 миллисекунд на 20 тыс. файлов,
  конечно, блядь, надо делать снимок файлов точный. Это 1А.» Reason: only the exact states before and after give no
  false attribution and no missed early change, and the price is small: about 8-22 ms in the git repositories measured
  and about 150 ms for 20000 files outside git. The current exact pre-start snapshot of every top-level bash and
  codemode call stays unchanged, no code change. Carriers: `snapshot` in `extensions/RQW-tools/ledger.ts`, taken in
  `begin()` of `jobs.ts` before the command starts and compared with the end snapshot by the effects report. Proof:
  `extensions/RQW-tools/test/ledger.test.ts` ("a snapshot compares states, not times") and
  `extensions/RQW-tools/test/background.test.ts` (a file written just before the start or with a future mtime is not
  reported; `scanned` names both snapshot costs). The report lists under
~~~

~~~text
  Reason: the replay of 131598 recorded tool calls left D4 with 4090 silent overlaps between background jobs and later
  calls at the same wall time; FR-safe leaves none silent, makes 45 later calls wait for a held resource, and keeps the
  same-response order; the owner chose it. Carriers: `extensions/RQW-tools/footprint.ts`, `ledger.ts`, `barrier.ts`
  (held entries, followers), `jobs.ts`, `index.ts`, `codemode.ts`, `keys.ts`, `descriptions/job.md`,
  `descriptions/write.md`; `extensions/RQW-agent/index.ts`, `extensions/RQW-review/index.ts` (labels, the reviewer's
  `job`), `notes/prompt-tools-isolation.md` (section text); races R16-R24:
  `notes/analysis-races.md` section 9. Pilot live probe (Haiku 5.5 and GPT-6 Luna, thinking high; logs
  `my-pi-evidence/bash-background/probe-2/`) found six defects, fixed here: the footprint read a subshell's `)` as
  part of a written path; an append by the caller's own bash was reported as a change of the build job; a write of a same-response follower, which starts the moment the job's work
  ends and before its scan, was reported as the job's (the scan now runs before the barrier releases those calls); a
  tracked file the job deleted was not reported (git lists index entries); and `waiting for` named the holds of a call
  that a same-response follower waits for in full; a follower queued behind the job was listed as running alongside
  it. The port note is computed before the server starts and also goes
  into its handoff. The code review of 1ecb796 found the races fixed above (slot wakeups, a killed queued call still
  holding its file, nested bash without claims, the P1 check outside the write's critical section, alias and owner
  identity, the time cutoff); each has a test in `background.test.ts` (#3-#8) or `ledger.test.ts` that fails on the
  code before the fix. Proof: `extensions/RQW-tools/test/footprint.test.ts`, `ledger.test.ts`,
  `barrier-detach.test.ts` (held oracle, randomized; it fails when held entries are ignored),
  `background.test.ts` (R16 and R17 fail when the classifier holds nothing), `extensions/RQW-agent/test/
  nested-workers.test.ts` and `extensions/RQW-review/test/review.test.ts` (labels, reviewer `job` lifetime),
  `extensions/RQW-agent/test/agent.test.ts` and `extensions/RQW-review/test/subagent.test.ts` (offered child codemode,
  explorer `job`, path labels, a child reviewer's jobs on the child's end), `background.test.ts` ("S1 across sessions"),
  `test/prompt-tools-isolation.test.ts` (section text).
~~~

## Tools historical cross-platform proof

Historical verification at the start of the tools work. Archived entry: A-0074. Source: `DECISIONS.md` at `30952e6`, lines 526-528.

~~~text
- Historical proof: `npm test` (`node --test`, no model) and `.github/workflows/tests.yml` on macOS, Linux and Windows, plus a job
  reproducing PowerShell, portable Git Bash without admin, then Node. Current verification policy is in [Work policy](#work-policy);
  this historical coverage is not a Linux requirement or PowerShell runtime authorization.
~~~

Frozen excerpts from `30952e6:DECISIONS.md`, not new checks or live measurements. Quotations in these frozen originals retain their original attribution, not newly verified owner authority. Pi 1.3.0 context figures were not re-measured on Pi 1.4.0. The bench45 CSV was external, not bundled raw evidence.

## Context limits

Original lines: 567-575. Source: `30952e6:DECISIONS.md`.

```text
- Consequences for a model above 500 000, all as for a 500 000 model: footer and `getContextUsage()` show the window
  500k and 90% at the threshold; summary requests reach the provider with the 500 000 window and without an explicit
  output limit (Pi 1.4.0; before it they were 0.8 and 0.5 x R, 40 000 and 25 000); the output cap of a request is
  500 000 - context - 4096, about 45 900 at 450 000 context (the test sees 45 902); an answer reporting more than
  500 000 input tokens counts as overflow (`pi-ai/dist/utils/overflow.js:152-156`). With compaction on and a history of several turns that a summary can
  fit, Pi recovers: a completed answer is kept and the session is compacted with reason `overflow` and no retry
  (`agent-session.js:2440-2443`); a length stop with no output at 99% of the window is compacted and retried once
  (`agent-session.js:2437-2443`, `2467-2469`, `overflow.js:161-165`). Nothing about the window goes to the provider:
  the OpenAI-compatible body has only `max_completion_tokens` changed, every other field as stock Pi.
```

Original lines: 576-601. Source: `30952e6:DECISIONS.md`.

```text
- Known limits of the 500 000 window, no code change: the window rule is the owner's, and all follow from it.
  The numbers below were measured on Pi 1.3.0 with explicit summary caps; Pi 1.4.0 keeps the same pi-ai clamp
  (`simple-options.js:3-9`) on a summary request, now sized from the model's output limit. Not re-measured.
  1. The output cap. pi-ai clamps a request's output to `contextWindow - context - 4096` with a floor of 1 token
     (`pi-ai/dist/api/simple-options.js:5-9`), so on a 1M model it reaches 1 token at about 495 900 context tokens.
     Pi does not recover in three cases. With `compaction.enabled: false` there is no compaction at all
     (`agent-session.js:2392-2394`): measured `max_completion_tokens` at context 0 / 480 000 / 497 000 / 520 000 is
     `[128000, 15902, 1, 1]` (stock Pi `[128000, 128000, 128000, 128000]`); a provider that obeys it answers 1 token
     with stop reason `length` and no error. A history that is one oversized turn, such as a 700 000-token first
     paste, gives requests with a 1-token cap; the overflow compaction that follows also has its turn-prefix summary
     capped at 1 token and fails with "Turn prefix summarization failed: generation hit the token cap and the summary
     is incomplete". When the part a compaction summarizes (all but the last `keepRecentTokens`) of a text-heavy
     history estimates above about 496 000 tokens by characters, every request gets a 1-token cap and every
     compaction fails: the summary request is capped the same way ("Summarization failed: generation hit the token
     cap and the summary is incomplete"). A text-heavy history a little above the window still recovers, a resumed
     one too: Pi checks a resumed session at its first prompt (`agent-session.js:1483-1485`, `_prepareRun`); in review runs against
     a local stub the dead end began between 535 000 and 541 728 tokens (summary cap 5 112 at 534 864, 1 at
     541 728). A tool-heavy history of the same size recovers, because summaries cut tool results to 2 000 characters
     (`compaction/utils.js:82`). The test pins the cap with compaction off.
  2. Summaries of prose-heavy histories. A summary request is a fresh context that pi-ai sizes by characters
     (3.5 per token), so a chat history of English prose, about 4.4 chars per real token, estimates above the window
     at the threshold and the summary's output cap is 1 token: on a 1M model the compaction at 450 000 fails with
     "Summarization failed: generation hit the token cap and the summary is incomplete", then up to two failed
     summary requests per prompt. Stock Pi does the same on a native 272 000 or 500 000 model; it is new for 1M models
     only because stock Pi would not compact them before 983 616. Tool results are cut to 2 000 chars before the
     estimate (`compaction/utils.js:82`), so tool-heavy coding sessions do not reach it.
```

## Context proof

Original lines: 654-669. Source: `30952e6:DECISIONS.md`.

```text
- Proof: `extensions/RQW-context/test/context.test.ts` runs real sessions of the library and the bundle with a
  scripted provider that reports exact usage and a local OpenAI-compatible endpoint: Pi's own `session.model`,
  `getContextUsage()`, `compaction_start` at W - R + 1 and not at W - R (also after a switch, `/reload`, resume, fork
  and `/new` through `AgentSessionRuntime`, and in the pre-request check `_exceedsCompactionThreshold` between tool
  turns), user reserves in memory and in a file-backed `settings.json`, overflow recovery above 500 000, the output cap
  with compaction off, native virtual selection with capped physical requests, load order, a load without either internal, the request body
  against stock Pi, and the switch: listed in `settings.json`, dropped, `/reload` gives window 1 000 000 and reserve
  16 384, listed again and `/reload` gives the rule back. `test/isolation.test.ts` checks the same through the
  `packages` filter. Concurrent SDK tests in `context.test.ts` run for library and bundle: A/B shutdown in both
  orders, package-filter reload excluding B while A remains, reload A, and stock values after the last owner leaves.
  Tests emit `session_shutdown` before SDK `dispose()` so their owner tokens do not leak between cases.
  `extensions/RQW-context/test/routing.test.ts` also covers native routed physical targets in library and CLI
  bundle, operation-local thresholds, captured selection and original reserve intent despite later settings changes,
  independently routed summary budgets, concurrent sessions and last-owner restoration. These are synthetic-provider
  tests, not cloud or interactive-terminal proof.

```

## Prompt history

Original lines: 676-677. Source: `30952e6:DECISIONS.md`.

```text
- The text follows the concept in `notes/prompt-concept.md` and starts from the bench41 template, the only measured
  version on Pi (+10.2 / +6.2 / +1.9 quality points on gpt-6-sol low / gpt-6-sol medium / gpt-6.1-sol medium).
```

Original lines: 684-685. Source: `30952e6:DECISIONS.md`.

```text
- The four optional `SYSTEM.md` edits at `f6e9327` are not adopted as a package; main keeps its prompt unchanged. The owner wanted the minimum changes without breaking the prompt, and explicitly permitted GPT measurement (user: «Замеры правок System LMD можно тоже проводить на модели GPT-6»). On GPT-6 low, wall time improved by about 6.9%; on GPT-6.1 medium, quality changed by -2.29 percentage points (90% CI [-5.81, +1.24]). This does not prove a general regression, but does not establish safe noninferiority for the common prompt. Measurement-based rejection completes this task, rather than pausing it. Evidence and candidate history: `notes/bench46-gpt.md`, `notes/bench46-gpt.csv`, commits `80bec267` and `f6e9327`; the deployed carrier remains `extensions/RQW-prompt/SYSTEM.md` on main.

```

## Prompt isolation source

Original lines: 696-699. Source: `30952e6:DECISIONS.md`.

```text
- Source proof, Pi 1.4.0: `dist/core/extensions/runner.js`, `emitBeforeAgentStart`, shares one normalized options
  object across handlers; `dist/core/system-prompt.js`, `buildSystemPromptSections`, uses `customPrompt` as preamble
  and still appends `sections` after cwd. `promptGuidelines` and tool guidelines are built only without customPrompt,
  so they cannot carry these instructions. `forceSystemPrompt` deliberately bypasses sections; no override is added.
```

Original lines: 704-708. Source: `30952e6:DECISIONS.md`.

```text
- Exact runtime text diff and risks: `notes/prompt-tools-isolation.md`. Proof: `test/prompt-tools-isolation.test.ts`,
  real package filtering, sessions and prompt/tool patch replay on a faux provider, both orders, standalone extensions,
  explicit tool selections, active-tool changes and disabling either extension through reload. `npm test` includes
  package tests. No live model runs in this task; GPT measurements of the changed text follow separately.

```

## Codemode history

Original lines: 742-754. Source: `30952e6:DECISIONS.md`.

```text
- A script's tool call finds the barrier of its script by its tool call id: Pi gives it `<codemode id>/<n>`, and the
  group registers its barrier under the codemode call's id. A nested id with no registered ancestor goes to the outer
  barrier, or runs at once when an ancestor has a live entry there, so it never waits for itself. Reason: the first
  version carried the barrier in `AsyncLocalStorage`, and Bun, which runs the Pi release binaries (`pi.exe` of PCLI
  included), drops that context in a worker's `message` callback; every script that called a tool hung (review A).
  Proven on Node 22 and 26 (`npm test`) and on Bun 1.3.14 (the runtime inside the Pi 1.4.0
  binary, read from the release's `pi.exe`) and 1.4.3:
  `extensions/RQW-tools/test/bun/codemode-check.mjs` runs Pi's CLI under Bun with a faux model; CI job `bun-codemode`.
  Pi 1.4.0 admits codemode scripts through a FIFO wait for a worker slot (`PI_CODEMODE_MAX_WORKERS`, default 2, read
  per call), capped at 60 seconds or the script's remaining deadline, instead of failing at once with "Codemode worker
  limit reached"; the wait counts against the script timeout and each worker has a 256 MB VM limit, so a script
  that waits on slots held by other waiting scripts can still time out. It is not unlimited parallel capacity and does
  not replace the barrier above. Details: `notes/settings-codemode.md`, Limits.
```

Original lines: 755-759. Source: `30952e6:DECISIONS.md`.

```text
- Measured with codemode on (bench45, T01-T07, 5 runs, the bench44 judge; `~/stock-bench/bench45.csv`): gpt-6.1-sol
  medium quality 99.5 -> 97.4 (90% interval -3.7 to -0.5), seconds 51.1 -> 50.4, calls 40.9 -> 35.7; codemode called
  32 times in 19 of 35 runs, `tool_search` never; most of the loss is one T06 point. gpt-6-sol low never calls
  codemode: 91.9 -> 93.7, within noise. Edit, write and multi-file probes pass on both. Kept on by the owner's
  request; the cost is recorded here.
```

## Isolation coverage history

Original lines: 813-822. Source: `30952e6:DECISIONS.md`.

```text
- Proof: `test/isolation.test.ts` (in `npm test`). The list comes from `package.json` `pi.extensions`, so a new
  extension is covered without a change to the test. Static part: every relative import of every file under
  `extensions/<E>/` resolves inside it. Runtime part, one child process per variant (`test/isolation-run.ts`, real
  `DefaultResourceLoader` and `AgentSession`, a faux 1M model, Pi's `codemode` and `tool_search` as built-in
  factories): for each extension E switched off through the `packages` filter, no load or bind errors and the loaded
  set is all but E; every other extension registers the same tools with the same descriptions as with everything
  on; a model turn with a `read` call completes; switching E off with `/reload` gives the same loaded set, registered
  tools, compaction reserve for a 1M model and session window as a fresh start without it. Before this change it
  failed on the `RQW-settings` import of `../RQW-tools/selection.ts` and on the RQW-context reload trace (550 000
  against 16 384).
```

## Prompt isolation measurements

Original lines: 841-853. Source: `30952e6:DECISIONS.md`.

```text
- Prompt/tools isolation is complete (section Prompt/tools isolation): `SYSTEM.md` no longer describes RQW-tools;
  RQW-tools supplies conditional search and execution sections. The package-level
  `test/prompt-tools-isolation.test.ts` checks tool availability and reload independently of extension-local tests.
  Owner: «Когда мы делаем эти отдельные модули, они должны быть полностью изолированы, самодостаточны, чтобы мы могли
  включать и выключать, как feature флаги.» We accept Pi's native sections to meet that requirement, despite the
  measured change on fixed GPT-6.1-sol medium questions: +0.56 assistant steps, +1.85 s and -3.33 checklist points;
  GPT-6-sol low gained 6.67 checklist points. All 36 edit acceptance checks passed. The medium losses concern Rust
  field-declaration citations rather than wrong values; the variant gained the T06 auth blocker delay. This is not
  behavioral neutrality. Pi puts these sections after cwd, changing instruction position and removing two redundant
  partial-write reminders; preserving their former positions would require extra coupling. Evidence and limits:
  `notes/prompt-isolation-gpt.md`, 72 raw rows in `notes/prompt-isolation-gpt.csv`. The four optional manifesto edits
  remain unadopted and separate (`notes/bench46-gpt.md`).

```

## Agent proof

Original lines: 1086-1114. Source: `30952e6:DECISIONS.md`.

```text
- Proof: `extensions/RQW-agent/test/agent.test.ts`, faux-provider tests (a copy of the RQW-agent folder in a
  folder with no other extension loads and delivers, and the source has no `../` import; without RQW-tools the
  subagent's `write` is the stock one, no `files`; exact system prompt, model,
  thinking, tool subset, management actions, steering while running (`steer.test.ts`: a held tool call, `send` during it, the message in the next request after the tool result, nothing aborted), the main turn, shutdown, errors, call order, print
  mode; one request only after `stop`, `restart` or `session_shutdown` with a queued follow-up; a result arriving
  while the main agent streams continues its run once; after TUI Esc and after RPC abort the result is in the session
  once, no run starts, and the next prompt carries it once; in a continued session that already holds an `[agent#1]`
  result, a new result while busy still continues the run once, in TUI and print mode; a queued follow-up that fails
  delivers the first answer and the error in one message; a first task that fails for good with a queued follow-up that
  succeeds delivers the error and the answer in one message; an error that Pi retries is not delivered; neither is an
  overflow error nor a truncated `length` answer that Pi compacts and retries; `interrupt`, `stop` and `restart` right
  after `start` in one batch return at once and leave no subagent request; two results
  that arrive while a second extension's slow `agent_before_settle` handler, loaded after RQW-agent, runs get one main
  turn that sees both; in a continued session a new subagent gets `agent#2`; after an interrupt above the threshold `send` returns within 100 ms and `interrupt`, `stop`, `restart` or `session_shutdown` right after it send no summary request, and `stop`, `restart` or `session_shutdown` during that summary abort it and send nothing more). Each test passes alone. With
  an empty extension the original 13 fail; without the queue clearing, the delivery change or the `continue` the new
  tests fail; with a per-instance delivery counter the two continued-session tests fail; on 6b2cfb5 the two review C tests fail; on ff8781b
  the four tests changed or added for review D fail except the retried-error one, which fails without the
  `auto_retry_start` line; on 8344d2e the two review E tests fail. On 0789ab1 the seven review F tests fail; with only the `compaction_start` line six of them fail. On
  40574b5 the folder and stock-tools tests fail; with no offer from RQW-tools the RQW-tools test fails, and so it does
  when RQW-tools offers its main definitions with the main barrier. The mandatory package integration in `test/agent-tools.test.ts` checks `write.files[]` and a
  separate subagent barrier while the main barrier is held; after filtering RQW-tools out and reloading,
  new subagents get stock write. It has no missing-folder skip; extension-local tests load only RQW-agent. Live runs
  in a fixture repository with `pi -e <repo> --model anthropic/<model> --thinking low --mode json -p <prompt>`:
  Haiku 5.5 started a subagent with its own prompt, read a file and answered a follow-up (`[agent#1] ZED: 3`,
  `[agent#1] ZED: alpha`); Haiku 5.5 queued a follow-up, interrupted a `sleep 40`, restarted
  (`[agent#1] W: RESTARTED`, 11 s, no `sleep` left); Opus 5.5 ran two subagents, one with an inherited model, and got
  the queued follow-up in the same message (`[agent#1] W: ... first ... W: ... second`,
  `[agent#2] Q: The bug is in add ...`).

```

<a id="workers-b4-results"></a>
## Workers B4 benchmark results

Used by `[D-WORKERS-REASONING]`. Source: DECISIONS.md at `30952e6`, archive A-0140 (lines 1179-1194).

```text
Source: [workers benchmark, Results and B4](notes/workers-bench.md#b4-chosen-levels), saved log
  `logs/b3-final-3models-summary.md` under the benchmark directory named in that report. Each pair below is
  low vs medium; judge means cover all runs.

  | Model | Role | Tuning pass: low vs medium | Holdout pass: low vs medium | Judge mean: low vs medium | Chosen |
  | --- | --- | --- | --- | --- | --- |
  | anthropic/claude-haiku-5-5 | code_writer | 75/75 vs 75/75 | 50/50 vs 50/50 | 9.7 vs 9.7 | low |
  | anthropic/claude-haiku-5-5 | shell_runner | 75/75 vs 75/75 | 50/50 vs 50/50 | 9.6 vs 9.6 | low |
  | openai-codex/gpt-6-luna | code_writer | 75/75 vs 75/75 | 50/50 vs 49/50 | 9.9 vs 9.8 | low |
  | openai-codex/gpt-6-luna | shell_runner | 72/75 vs 75/75 | 49/50 vs 50/50 | 9.5 vs 9.6 | medium |

  GPT-6 Luna shell_runner low qualifies but loses to medium on pass rate, so medium is selected. The separately
  measured GPT-5.6 Luna is not in this model chain and is not used. Its code_writer met the bar at no level:
  holdout pass rates were 84.0%, 82.0%, 86.0% and 92.0% for low, medium, high and xhigh, with runaway writes hitting
  the 15-minute cut. Those measurements do not add a model or change the accepted primary/fallback chain.
```

<a id="review-gpt-match"></a>
## Reviewer GPT match probes

Used by `[D-REVIEW-MODELS]`. Source: DECISIONS.md at `30952e6`, archive A-0147 (lines 1261-1267).

```text
Reason, from the gpt-match probes (`notes/reviewer-probes.md`, section "GPT match for the Claude slots"):
  GPT-5.6-Luna medium matches Haiku 5.5 medium (recall 94.1% against 95.6%, 164 of 165 dispute items right for
  both, 12.6 s and 0.0027 USD per pass against 14.4 s and 0.0022) and GPT-5.6-Luna high matches Sonnet 5.5 low
  (recall 96.3% against 96.7%, 165 of 165 against 154 with the strict reply parse, 0.0043 USD against 0.0226, but
  20.8 s against 6.7 s and 31 of 33 clean cases against 33); GPT-6-Luna is unusable. Limits: 17 false findings for
  Luna high against 15 for Sonnet low, 10 for Luna medium against 1 for Haiku medium; one run set per cell, so
  one- or two-item differences are noise.
```

<a id="review-dispute-sources"></a>
## Earlier owner sources of the dispute rule (omp sessions)

Used by `[D-REVIEW-DISPUTES]`; these quotes come from omp session files outside the Pi session folder and were not re-verified. Source: DECISIONS.md at `30952e6`, archive A-0150 (lines 1366-1386).

```text
Earlier owner sources: 2026-10-09
    (`~/.omp/agent/sessions/-Documents-ChatGPT-my-omp-harness/2026-10-09T21-54-24-425Z_01a122a9-0429-72c6-a863-e5df03772564.jsonl:103`):
    «Второй чувак не идёт слепо её править, а у него контекста больше, потому что он сам эту работу делал. И он видит,
    перепроверяет своё решение, свою работу и либо принимает правку, либо её отклоняет и пишет, почему он её
    отклоняет. И в итоге они приходят к консенсусу.»; the same file `:99`: «Ну, то есть если она меняет, а-а-а, как бы
    согласованный план, то её отклоняют»; «То есть мы либо отклоняем правку, потому что она как бы нарушает, либо мы её
    принимаем, и всё.»; 2026-10-14
    (`~/.omp/agent/sessions/-Documents-ChatGPT-my-omp-harness/2026-10-12T15-30-39-654Z_01a130bc-c3a6-7101-b570-e995b9c08136.jsonl:3964`):
    «Он должен согласовывать со мной только те места, которые однозначно являются неоднозначными. Там, где reviewer не
    сможет провести нормальное review, не сможет подтвердить результат работы, потому что формулировка
    неоднозначная. Или он согласовывает со мной решения, которые он придумал самостоятельно, которые отличаются от
    того, что я ему сказал сделать.»; 2026-10-09
    (`~/.omp/agent/sessions/--private-tmp--/2026-10-09T06-26-18-422Z_01a11f57-50b6-7042-9bc8-745d0f4b32ed.jsonl:344`):
    «И если он чё-то реджектит, то он в следующем запуске присылает свои реджекты из прошлых прогонов. ... Там должны
    работать в команде, а не быть друг у друга.» The former rule that a finding with verbatim quotes is mandatory and
    never rejected was an agent proposal inside an approved plan, not the owner's words; the 2026-10-21 messages
    replace it. The three-message limit has no earlier owner source; it comes from 2026-10-21.
```

<a id="review-dispute-probes"></a>
## Dispute wording probes

Used by `[D-REVIEW-DISPUTES]`. Source: DECISIONS.md at `30952e6`, archive A-0150 (lines 1346-1356), A-0150 (lines 1357-1365), A-0150 (lines 1390-1397).

```text
The measured v3h text had the clause (it made GPT-6.1-Sol rule UNDECIDED on that case); the adopted text, with
    the exception sentence added after the probes, was not measured as a whole (`notes/reviewer-probes.md`, section
    U12).
```

```text
Reason: Sonnet 5.5 wrote a one-line remark before `FINDINGS:` in 11 of 147 (low)
    and 4 of 147 (medium) dispute passes with the adopted wording, which left the dispute open; the rescore with
    tolerant extraction resolves all of them (`notes/reviewer-probes.md`, section "Sonnet's remark before
    `FINDINGS:`").
```

```text
the
  dispute wording in `REVIEWER.md` and `NEXT` was measured on models in the probe campaign
  (`notes/reviewer-probes.md`: 8 reviewer configs x 49 dispute fixtures x 3 runs per wording; the main side on three
  main configs, 43 fixtures x 3 runs per round), with the limits listed there.
```

<a id="review-live-smoke"></a>
## Reviewer live smoke runs (historical)

Used by `[D-REVIEW-TESTS]`; no saved raw log is named for these timings. Source: DECISIONS.md at `30952e6`, archive A-0164 (lines 1494-1509).

```text
Proof: `extensions/RQW-review/test/review.test.ts` (real sessions, faux providers for the main and the reviewer
  models) and one real run per level: a temp copy of a fixture with `calc.py` (`add` returns `a - b` instead of the
  sum) and a correct `config.py` (`MAX_ITEMS = 50`), command
  `pi -e /tmp/my-pi-review --mode json --model anthropic/claude-opus-5-5 --thinking low -p "<prompt>"`, the prompt
  quoting the request and asking to call `review` and then `sleep 150`. Both verdicts named the defect and nothing
  else and started a main turn: `blind` in 8.7 s (`EVIDENCE: "return a - b"`), `high` in 3.8 s. After the delivery
  fixes, tests for print and json mode (the run waits and continues with the verdict), a verdict arriving while the
  main agent streams (continues its run once), TUI Esc and RPC abort (the verdict is in the session once, no run
  starts, the next prompt carries it once), two verdicts that arrive while a slow second extension
  (`test/slow-settle.ts`, loaded after RQW-review) holds `agent_before_settle` (one main turn for both), and grep and
  find with `"null"`, `"undefined"` and blank arguments through Pi's validation and inside a reviewer session.
  Without the `agent_before_settle` handler, the busy-time delivery, the `settling` flag or `reviewerTools`, these
  tests fail. Every test passes when run alone, which needs the `checkAuth` fallback. Live run in json mode with no
  `sleep`: Haiku 5.5 as the main model replied `started`, the run waited, `[review#1] FINDINGS: ... EVIDENCE:
  "return a - b"` arrived after 5.1 s and the main agent answered it in the same run (`GOT VERDICT: ... returns
  a - b instead of the sum`), exit 0 in 13 s.
```

<a id="pcli-bundle"></a>
## PCLI bundle observations

Used by `[D-PCLI-PIN]`. Source: DECISIONS.md at `30952e6`, archive A-0168 (lines 1526-1533).

```text
(44.06 MB, [run](https://github.com/ARQAWA/my-pi/actions/runs/39824069227), job `e2e`)
```

```text
The `pi.exe` of 1.4.0 still embeds Bun 1.3.14 (read from the binary).
```

<a id="pcli-mouse-sources"></a>
## PCLI wheel cause: Pi sources and upstream history

Used by `[D-PCLI-MOUSE-CAUSE]`. Source: DECISIONS.md at `30952e6`, archive A-0175 (lines 1556-1572).

```text
Cause, read from the Pi 1.4.0 sources: `TuiBase.start()` (`pi-tui/dist/tui.js:591-597`) calls `beforeTerminalStart`,
  then `terminal.start`, then `afterTerminalStart`. `TuiAltScreen.beforeTerminalStart` (`tui-alt-screen.js:158-195`)
  writes `?1049h` and the mouse enable `?1000h ?1002h ?1003h ?1004h ?1006h` (without `?1003h` in tmux, Zellij and
  screen: `TMUX`, `ZELLIJ`, `STY` set, or `TERM` starting with `tmux` or `screen`), before `terminal.start` turns on raw
  mode and `enableWindowsVTInput` (`terminal.js:117-138`). ConPTY loses what is written that early, VS Code's terminal
  never learns that the app wants the mouse, and the wheel in the alternate screen becomes arrow keys, which move
  through the editor's input history. `TuiAltScreen` has no `afterTerminalStart` of its own, and the same start path
  runs again after the external editor, a TUI mode switch and suspend/resume. Upstream: issue earendil-works/pi#9656
  (its workaround sends the mouse commands again after the terminal started, and only them: moving `?1049h` breaks
  the Kitty keyboard protocol); PRs 9655 and 10560 were closed unmerged; related 11205, 11172, 8913. The loss of the
  commands is measured (Proof below); the wheel-to-arrows step on the owner's VDI is not reproduced here.
```

<a id="pcli-mouse-capture"></a>
## PCLI wheel capture measurement

Used by `[D-PCLI-MOUSE-PROOF]`. Source: DECISIONS.md at `30952e6`, archive A-0178 (lines 1595-1610).

```text
A model of ConPTY that drops writes before `start` gives 0 and 1; it is a model, the measurement
  follows. `test/isolation.test.ts` covers the extension through the manifest. Capture: job `mouse` of
  `.github/workflows/pcli.yml` (`workflow_dispatch`, or a push to branch `pcli`) runs `pcli-vscode/test/mouse.mjs`,
  which drives `pcli-vscode/test/mouse-suite.cjs` in a real VS Code: VS Code's own node-pty starts the PCLI chain
  (PowerShell, Git Bash, the bundled Bun-build `pi.exe` 1.4.0) twice, stock and with `-e extensions/RQW-mouse/index.ts`,
  and counts `?1000h` in the pseudo terminal's output once Pi is in the alternate screen. Measured on `windows-latest`
  with VS Code 1.143.0 and Pi 1.4.0 ([run](https://github.com/ARQAWA/my-pi/actions/runs/39824069227), job `mouse`):
  0 times stock, 1 time with the extension, `?1049h` once in both, the set arriving after `?2004h` (2013 bytes with the
  extension, 1727 stock). This also shows that the Bun build loads the extension, with its pi-tui module shared with Pi.
```

<a id="models-reports"></a>
## RQW-models local implementation reports (historical)

Used by `[D-MODELS-TESTS]`; the "Windows/Linux" sentence is wrong for current CI (macOS and Windows only). Source: DECISIONS.md at `30952e6`, archive A-0205 (lines 1873-1890).

```text
This is parser testing, not manual terminal testing. The local implementation report records no live Claude
  requests and no independent agent review. The P2 implementation report records passing model tests on macOS, Node 22.19.0 and 26.7.0. Regression coverage
  includes rapid snapshot contexts, reasoning queued behind a switch, real CLI mixed scoped suffixes and a saved
  default selecting the second scoped model. The complete repository suite passes on both with
  `--test-concurrency=1`, versions run sequentially. Strict TypeScript checking was not rerun: this worktree has no
  local compiler or typecheck script. No unrelated tests or timeouts were changed. Windows/Linux remain covered by
  the existing CI matrix but were not run locally, and no terminal
  capture or corporate VDI test was performed.
```

<a id="models-ci-fixture"></a>
## RQW-models CI fixture investigation

Used by `[D-MODELS-CI-FIXTURE]`; written for Pi 1.3.0. Source: DECISIONS.md at `30952e6`, archive A-0206 (lines 1891-1906).

```text
Pi 1.3.0 native-provider registration starts asynchronous availability refreshes, while
  `findInitialModel` reads the synchronous snapshot. In a clean home with no configured auth, initial selection can
  be empty; the agent retains `unknown/unknown` even when Codex becomes available by `session_start`. Without Opus,
  RQW correctly preserves that initial selection, and Pi reports no API key. A clean-home CLI probe reproduced it.
  A gated faux auth resolver reproduced both snapshot timings: without config the early selection was absent and
  the settled selection was Codex; with config both were `openai-codex/gpt-6.1-sol`, without Anthropic auth.
  No evidence calls for changing RQW production auth selection. The CLI regression asserts the exact fallback
  model; a saved or explicit unlisted model is replaced as the listed-models rule above requires.
  Offline mode and the fetch prohibition remain intact.
  The fixture-fix report records passing model tests on macOS, Node 22.19.0, 24.21.0 and 26.7.0; the full suite passes on
  Node 22.19.0 and 26.7.0 with 387 passed and the existing Windows-only test skipped. Twenty clean-home CLI
  probes with the seeded config passed. The local fixture-fix report records no live requests or CI rerun.
```

<a id="statusbar-local-proof"></a>
## RQW-statusbar local proof boundary (historical)

Used by `[D-STATUSBAR-ANIMATION]` and the other Status bar entries. Source: DECISIONS.md at `30952e6`, archive A-0214 (lines 1965-1968).

```text
Local proof uses deterministic snapshots, no-request Pi library/bundle sessions, local git fixtures and a PTY
  smoke run where available. The local implementation report records no independent agent review or live model run.
  Windows paths are exercised locally; native Windows execution remains the existing CI job. These are proof
  boundaries, not exceptions to the workflow's independent-review requirement.
```

<a id="scroll-pty-probe"></a>
## RQW-scroll local PTY probe

Used by `[D-SCROLL-TESTS]`. Source: DECISIONS.md at `30952e6`, archive A-0225 (lines 2071-2080).

```text
A local PTY probe of the real CLI in
  fullscreen with `doubleEscapeAction: fork` confirmed the InteractiveMode wiring: scrolled up, a quick Escape pair
  jumped down without the fork notice; the next pair at the bottom showed it.
```

<a id="session-research"></a>
## RQW-session research: Pi 1.4.0 internals and Codex comparison

Used by `[D-SESSION-SCAN]`. Source: DECISIONS.md at `30952e6`, archive A-0231 (lines 2116-2121), A-0232 (lines 2122-2126).

```text
Pi 1.4.0 research: `dist/utils/output-files.js` creates random-named OS-temp outputs with no session ID;
  `dist/core/session-manager.js` stores names/labels/history in JSONL and discovers recent files by mtime;
  `dist/modes/interactive/components/session-selector.js` tries `trash` then unlink, which does not meet permanent-delete
  semantics. RQW-agent and RQW-review create in-memory child sessions; RQW-statusbar has no per-session persistence;
  RQW-anthropic's install ID is global, not deletable session data. Pi's `dist/utils/clipboard.js` uses native/clip on
  Windows and emits OSC 52 for remote markers or `PI_CLIPBOARD_OSC52=1`, not simply because VS Code is present.
```

```text
Codex comparison, read-only `codex-harness` `upstream/main`,
  `codex-rs/thread-store/src/local/delete_thread.rs`: hard deletion stops writers, removes active/archived plain and
  compressed rollouts, materialized history, name-index entries and state rows, and invokes host-data cleanup.
  It refuses external fork-history references. Pi has no equivalent database or reference-index sidecars; this extension
  preserves Pi's independent fork JSONLs and shared referenced files instead. These are different storage models.
```
