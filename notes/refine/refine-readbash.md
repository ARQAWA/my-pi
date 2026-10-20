# Refining the read and bash descriptions by probes (2026-10-20)

Method: `/tmp/probe/probe.sh`, tasks T02, T05, EDIT, WRITE; gpt-6.1-sol medium and gpt-6-sol low; 3 runs per model per
task per config (24 runs per config, 96 in total, out-names `rb-<config>-<task>-<model>-<effort>-r<n>`). Responses =
model responses including the final one. Calls/response = tool calls per response that has calls. Correctness: T02/T05
= share of bench41 checklist points the final answer covers (model grader, same prompt for every run); EDIT = tests pass
and no `calc_total` left; WRITE = tests pass and all 3 files exist.

## Configs

- base: the current texts.
- v1: read changed (whole-file read stated as the rule, ranges only around one hit in a large file; batch every file
  needed next, including files to change, their tests and the code they call); bash unchanged.
- v2: v1 read + one bash line: "To check your edit and write calls, put the test or build command after them in the
  same response; it sees their changes."
- v3: read with "when a search or file list shows the files you need, read them all in the next response, not one
  per response" instead of "read every file that may relate"; bash unchanged.

## Summary per model

| Config | Model | Mean s | Responses | Calls/response | bashSearch total | Correctness |
|---|---|---|---|---|---|---|
| base | gpt-6-sol low | 32.5 | 5.42 | 5.57 | 0 | 99.2 |
| base | gpt-6.1-sol medium | 71.3 | 6.58 | 6.9 | 0 | 100 |
| v1 | gpt-6-sol low | 36.0 | 5.58 | 5.78 | 0 | 100 |
| v1 | gpt-6.1-sol medium | 66.2 | 6.42 | 7.08 | 0 | 100 |
| v2 | gpt-6-sol low | 33.8 | 5.5 | 5.59 | 0 | 99.2 |
| v2 | gpt-6.1-sol medium | 73.8 | 6.42 | 6.94 | 0 | 100 |
| v3 | gpt-6-sol low | 34.8 | 5.83 | 4.98 | 0 | 100 |
| v3 | gpt-6.1-sol medium | 72.6 | 6.5 | 7.32 | 0 | 100 |

Over both models: base 51.9 s / 6.00 responses / 6.31 calls per response / correctness 99.6 / 79% whole-file reads;
v1 51.1 s / 6.00 / 6.48 / 100 / 84%; v2 53.8 s / 5.96 / 6.33 / 99.6 / 85%; v3 53.7 s / 6.17 / 6.23 / 100 / 81%.
bashSearch was 0 in all 96 runs; tests passed in 12 of 12 EDIT/WRITE runs of every config.

## Per task

| Config | Model | Task | Mean s | Responses | Calls/response | bashSearch | Correctness |
|---|---|---|---|---|---|---|---|
| base | gpt-6-sol low | T02 | 53.5 | 5.3 | 7.92 | 0 | 97 |
| base | gpt-6-sol low | T05 | 37.7 | 5.3 | 9.08 | 0 | 100 |
| base | gpt-6-sol low | EDIT | 23.0 | 6 | 3.67 | 0 | 100 |
| base | gpt-6-sol low | WRITE | 15.8 | 5 | 1.58 | 0 | 100 |
| base | gpt-6.1-sol medium | T02 | 155.9 | 8.3 | 10.5 | 0 | 100 |
| base | gpt-6.1-sol medium | T05 | 82.3 | 7.3 | 9.42 | 0 | 100 |
| base | gpt-6.1-sol medium | EDIT | 23.1 | 5 | 3.0 | 0 | 100 |
| base | gpt-6.1-sol medium | WRITE | 24.0 | 5.7 | 1.14 | 0 | 100 |
| v1 | gpt-6-sol low | T02 | 64.7 | 6.7 | 8.29 | 0 | 100 |
| v1 | gpt-6-sol low | T05 | 39.2 | 5 | 8.5 | 0 | 100 |
| v1 | gpt-6-sol low | EDIT | 23.5 | 5.7 | 3.71 | 0 | 100 |
| v1 | gpt-6-sol low | WRITE | 16.5 | 5 | 1.92 | 0 | 100 |
| v1 | gpt-6.1-sol medium | T02 | 142.6 | 8.3 | 9.73 | 0 | 100 |
| v1 | gpt-6.1-sol medium | T05 | 78.6 | 7 | 10.72 | 0 | 100 |
| v1 | gpt-6.1-sol medium | EDIT | 23.5 | 5 | 3.0 | 0 | 100 |
| v1 | gpt-6.1-sol medium | WRITE | 20.0 | 5.3 | 1.31 | 0 | 100 |
| v2 | gpt-6-sol low | T02 | 55.4 | 6 | 7.93 | 0 | 97 |
| v2 | gpt-6-sol low | T05 | 40.3 | 5.3 | 8.92 | 0 | 100 |
| v2 | gpt-6-sol low | EDIT | 23.3 | 5.7 | 3.14 | 0 | 100 |
| v2 | gpt-6-sol low | WRITE | 16.2 | 5 | 1.92 | 0 | 100 |
| v2 | gpt-6.1-sol medium | T02 | 175.5 | 8.3 | 11.05 | 0 | 100 |
| v2 | gpt-6.1-sol medium | T05 | 75.2 | 6 | 10.53 | 0 | 100 |
| v2 | gpt-6.1-sol medium | EDIT | 25.3 | 6 | 2.2 | 0 | 100 |
| v2 | gpt-6.1-sol medium | WRITE | 19.1 | 5.3 | 1.31 | 0 | 100 |
| v3 | gpt-6-sol low | T02 | 58.5 | 6.3 | 7.31 | 0 | 100 |
| v3 | gpt-6-sol low | T05 | 42.2 | 6 | 6.87 | 0 | 100 |
| v3 | gpt-6-sol low | EDIT | 22.4 | 6 | 3.33 | 0 | 100 |
| v3 | gpt-6-sol low | WRITE | 16.1 | 5 | 1.58 | 0 | 100 |
| v3 | gpt-6.1-sol medium | T02 | 156.7 | 8.3 | 10.23 | 0 | 100 |
| v3 | gpt-6.1-sol medium | T05 | 93.4 | 7.3 | 10.74 | 0 | 100 |
| v3 | gpt-6.1-sol medium | EDIT | 22.4 | 5.3 | 2.77 | 0 | 100 |
| v3 | gpt-6.1-sol medium | WRITE | 17.9 | 5 | 1.5 | 0 | 100 |

## Chosen: v1 (read changed, bash unchanged)

read.md:

```
Read a file from the local filesystem. Text files and images (jpg, png, gif, webp, bmp); images are sent as attachments.
- Without offset and limit a file comes back whole up to 2000 lines or 50KB; a longer file returns its first part and ends with "Use offset=N to continue". Read a file you need beyond one spot whole in one call, not in ranges; use offset and limit only around one hit in a large file.
- Several reads in one response run in parallel. In one response, read every file you will need next: the files the answer rests on, the files you will change, their tests and the code they call.
- Use read to examine files instead of cat, head or sed through bash.
```

bash.md (unchanged):

```
Run a command in a fresh bash shell in the working directory; returns stdout and stderr together.
- One fact per command or pipeline; chain dependent steps with `&&`. Nothing carries over between calls: `cd`, exported variables and functions last only for that command.
- Without `timeout` (seconds) a command has no deadline. Set it for builds, tests, installs and anything that may hang. A command that does not exit, such as a server or watcher, holds this call and every later call until its timeout kills it with all its child processes; never run one without `timeout`. Processes left running in the background after the command ends are not tracked.
- Search and read with the grep, find and read tools, not with rg, grep, find, cat, head or sed in the shell. Use bash for git, builds, tests and running programs.
- Only the last 2000 lines or 50KB of output are shown; the full output is then saved to a file named in the result. Read that file with read or grep instead of running the command again.
- A non-zero exit code marks the result as an error and is reported with the output.
```

## Why

- Correctness first: v1 and v3 scored 100 on every run; base and v2 each had one T02 run of gpt-6-sol low at 91.
  Among v1 and v3, v1 needs fewer responses (6.00 vs 6.17) and fewer seconds (51.1 vs 53.7). v1 also raised the share
  of whole-file reads in T02/T05 from 79% to 84% and calls per response from 6.31 to 6.48.
- The differences between configs are within run-to-run noise (T02 on gpt-6.1-sol medium runs from 118 to 162 s inside the v1
  config). v1 helped gpt-6.1-sol medium (71.3 -> 66.2 s, 6.58 -> 6.42 responses) and cost gpt-6-sol low 3.5 s, all on
  T02 (53.5 -> 64.7 s, one 9-response run). It is kept because it is never worse on correctness and the rule matches the
  measured goal; it is not a proven speedup.
- v2 rejected: no model put the test run in the same response as the edit in any run, and gpt-6.1-sol medium on EDIT
  then split the test run and the leftover grep into separate responses (responses 5 -> 6, calls per response
  3.0 -> 2.2), the same failure as the earlier barrier-order line. A description line about call order stays out.
- bash stays as it is: no run read or searched through bash in any config, so there was nothing for it to fix; the one
  bash change tried (v2) made things worse.
- Facts checked against the stock code: read returns up to 2000 lines / 50KB from `offset` and ends a cut file with
  "Use offset=N to continue" (`dist/core/tools/read.js`); bash keeps the last 2000 lines / 50KB and names the full-output
  file (`dist/core/tools/bash.js`). bash.win32.md needed no fix.
