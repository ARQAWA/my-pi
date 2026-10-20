# Refining texts for file-writing tasks by probes (2026-10-21)

Goal: on WRITE (create 3 files, run pytest) stock Pi writes after one look at the tree (`bash | write,write,write | bash`,
15.5 s / 4.2 responses on gpt-6.1-sol medium), this package explored first and then read 2-3 neighbouring files
(`find,bash | read,read | write | bash`, 21.8 s / 6.0). Close that gap without making EDIT and MULTI worse.

Method: `/tmp/probe/probe3.sh`, one stand per variant in `stands/<v>/` (package.json, extensions, node_modules link),
runner `stands/run.sh "<variants>" "<tasks>"` (3 runs x 2 models, 4 at a time), table `stands/table.py`. Out-names
`/tmp/probe/out/w2-<v>-<task>-<model>-r<n>.json(l)`. Models: gpt-6.1-sol medium, gpt-6-sol low. ok = tests pass, no
leftovers (EDIT, MULTI), all 3 files created (WRITE). Responses include the final one; calls/response counts responses
with calls. Sequence: tool calls per response, one entry per run.

## Variants

- base: current texts.
- v1: `write.md`, after "change part of a file with edit.": "When the task already names the files to create and what
  they hold, write them once you know where they go; before that, read only existing files the new code imports or
  extends."
- v2: `SYSTEM.md` `<general>`, new line after "Answer a question about the code in the chat ...": "When the task
  already says which files to create and what goes in them, a file list is enough to place them: read only the
  existing code they import or extend, then write them all in one call."
- v3: v2 plus `read.md`, at the end of the batching line: "A new file the task fully specifies needs no read of the
  files around it."

## Results, 3 runs per cell

| Variant | Task | Model | ok | Seconds | Responses | Calls/response | Sequence (typical) |
|---|---|---|---|---|---|---|---|
| base | WRITE | gpt-6.1-sol | 3/3 | 21.3 | 6.00 | 1.47 | find,bash | find | read,read | write | bash; find,bash | find,find | read,read | write | bash; find,bash | find | read,read | write | bash |
| base | WRITE | gpt-6-sol | 3/3 | 15.5 | 5.00 | 2.08 | find,grep,bash | read,read,read | write | bash; find,find,bash | read,read,read,read | write | bash; find,find,grep,bash | read,read | write | bash |
| v1 | WRITE | gpt-6.1-sol | 3/3 | 17.0 | 5.33 | 1.08 | find,bash | find | write | bash; find | find | read | write | bash; find | find | write | bash |
| v1 | WRITE | gpt-6-sol | 3/3 | 16.6 | 5.33 | 2.08 | find,find,grep,bash | read,read,read | write | bash; find,grep,bash | read,find,find | read,read | write | bash; find,find,bash | read,read,read | write | bash |
| v2 | WRITE | gpt-6.1-sol | 3/3 | 19.2 | 6.33 | 1.00 | find | find | find | read | write | bash; find | find | write | bash; find | find | read | read | write | bash |
| v2 | WRITE | gpt-6-sol | 3/3 | 14.9 | 4.67 | 1.45 | find,find,find,bash | read,read | write | bash; find,find | write | bash; find | read | write | bash |
| v3 | WRITE | gpt-6.1-sol | 3/3 | 17.4 | 4.67 | 1.00 | find | write | bash; find | find | write | bash; find | find | write | bash |
| v3 | WRITE | gpt-6-sol | 3/3 | 14.6 | 4.67 | 1.45 | find,bash | write | bash; find | read,read,bash | write | bash; find,bash | read,read | write | bash |
| base | EDIT | gpt-6.1-sol | 3/3 | 22.0 | 5.33 | 2.77 | grep | find | read,read,read,read,read,bash | edit | bash,grep; grep,find,bash | read,read,read,read,read,find | edit | bash,grep,bash; grep,find,bash | read,read,read,read,read | edit | bash,grep,bash |
| base | EDIT | gpt-6-sol | 3/3 | 19.4 | 5.33 | 3.15 | grep,find,bash | read,read,read,read,read,find | edit | edit | bash,grep,bash; grep,find,bash | read,read,read,read,read,find,grep | edit | bash,grep,bash; grep,find,bash | read,read,read,read,read,find | edit | bash,grep,bash |
| v1 | EDIT | gpt-6.1-sol | 3/3 | 20.9 | 5.00 | 3.08 | grep,find,bash | read,read,read,read,read | edit | bash,grep,bash; grep,find,bash | read,read,read,read,read,find | edit | bash,grep,bash; grep,find,bash | read,read,read,read,read | edit | bash,grep,bash |
| v1 | EDIT | gpt-6-sol | 3/3 | 17.4 | 5.00 | 3.00 | grep,find,bash | read,read,read,read,read | edit | bash,grep; grep,find,bash | read,read,read,read,read | edit | bash,grep,bash; grep,find,bash | read,read,read,read,read,find | edit | bash,grep,bash |
| v2 | EDIT | gpt-6.1-sol | 3/3 | 21.5 | 5.00 | 3.00 | grep,find,bash | read,read,read,read,read | edit | bash,grep,bash; grep,find,bash | read,read,read,read,read | edit | bash,grep,bash; grep,find,bash | read,read,read,read,read | edit | bash,grep,bash |
| v2 | EDIT | gpt-6-sol | 3/3 | 17.3 | 5.33 | 2.92 | grep,find | read,read,read,read,read,bash | edit | bash,grep,bash; grep,find,find | read,read,read,read,read,bash | edit | edit | bash,grep; grep,find,bash | read,read,read,read,read,grep | edit | bash,grep,bash |
| v3 | EDIT | gpt-6.1-sol | 3/3 | 25.2 | 5.00 | 3.00 | grep,find,bash | read,read,read,read,read | edit | bash,grep,bash; grep,find,bash | read,read,read,read,read | edit | bash,grep,bash; grep,find,bash | read,read,read,read,read | edit | bash,grep,bash |
| v3 | EDIT | gpt-6-sol | 3/3 | 19.6 | 5.00 | 3.50 | grep,find,bash | read,read,read,read,read,find | edit | bash,grep,bash; grep,find,bash | read,read,read,read,read,grep | edit | bash,grep,bash; grep,find,bash | read,read,read,read,read | edit,edit,edit,edit,edit | bash,grep,bash |
| base | MULTI | gpt-6.1-sol | 3/3 | 21.2 | 5.00 | 2.17 | read,read,read,bash,find | read | edit | bash; read,read,read,find,grep,bash | read | edit | bash; grep,find,bash | read,read,read,read | edit | bash |
| base | MULTI | gpt-6-sol | 3/3 | 16.3 | 4.33 | 2.80 | read,read,read,find,grep,bash | edit | bash; read,read,read,find,grep,bash | edit | bash; read,read,read,grep,find | read,find,bash | edit,edit,edit | bash |
| v1 | MULTI | gpt-6.1-sol | 3/3 | 21.0 | 5.00 | 2.17 | read,read,read,find,bash | read | edit | bash; read,read,read,find,grep,bash | read | edit | bash; read,read,read,find,grep,bash | read | edit | bash |
| v1 | MULTI | gpt-6-sol | 3/3 | 15.8 | 4.67 | 2.55 | read,read,read,find,bash | read | edit,edit,edit | bash; read,read,read,find,grep,bash | edit | bash; read,read,read,find,bash | read | edit,edit,edit | bash |
| v2 | MULTI | gpt-6.1-sol | 3/3 | 20.0 | 5.00 | 2.00 | read,read,read,bash,find | read | edit | bash; read,read,read,find,bash | read | edit | bash; read,read,read,find,bash | read | edit | bash |
| v2 | MULTI | gpt-6-sol | 3/3 | 14.6 | 4.00 | 2.33 | read,read,read,bash | edit | bash; read,read,read,bash | edit,edit,edit | bash; read,read,read,find,bash | edit | bash |
| v3 | MULTI | gpt-6.1-sol | 3/3 | 19.7 | 5.00 | 2.08 | read,read,read,find,bash,grep | read | edit | bash; read,read,read,find,bash | read | edit | bash; read,read,read,find,bash | read | edit | bash |
| v3 | MULTI | gpt-6-sol | 3/3 | 15.9 | 4.33 | 2.40 | read,read,read,grep,bash | edit | bash; read,read,read,find,bash | read | edit,edit,edit | bash; read,read,read,find,bash | edit | bash |

Per model over WRITE, EDIT and MULTI (9 runs each):

| Variant | Model | ok | Seconds | Responses | Calls/response |
|---|---|---|---|---|---|
| base | gpt-6.1-sol | 9/9 | 21.5 | 5.44 | 2.10 |
| base | gpt-6-sol | 9/9 | 17.1 | 4.89 | 2.69 |
| v1 | gpt-6.1-sol | 9/9 | 19.6 | 5.11 | 2.08 |
| v1 | gpt-6-sol | 9/9 | 16.6 | 5.00 | 2.53 |
| v2 | gpt-6.1-sol | 9/9 | 20.2 | 5.44 | 1.90 |
| v2 | gpt-6-sol | 9/9 | 15.6 | 4.67 | 2.27 |
| v3 | gpt-6.1-sol | 9/9 | 20.8 | 4.89 | 2.06 |
| v3 | gpt-6-sol | 9/9 | 16.7 | 4.67 | 2.48 |

Over both models (18 runs): base 19.3 s / 5.17 responses; v1 18.1 s / 5.06; v2 17.9 s / 5.06; v3 18.7 s / 4.78.
WRITE only: base 18.4 s / 5.50; v1 16.8 s / 5.33; v2 17.1 s / 5.50; v3 16.0 s / 4.67.

## What the runs show

- Every run of every variant is correct: 72 of 72.
- WRITE: base read `app/pricing.py` and `tests/test_pricing.py` before writing in 6 of 6 runs. v3 wrote without any
  read in 3 of 3 gpt-6.1-sol runs and 1 of 3 gpt-6-sol runs; one gpt-6.1-sol run hit the stock shape `find | write |
  bash` (13.9 s, 4 responses). v1 and v2 alone each cut reads only on one model: v1 left gpt-6-sol reading 2-3 files,
  v2 left gpt-6.1-sol reading in 2 of 3 runs and spread finds over 3 responses in one run (6.33 responses).
- The response gpt-6.1-sol still spends on WRITE is a second find: its first find uses a brace list of top-level
  names (`{app,tests,pyproject.toml,...}`), which returns only the directory names, so it lists `{app/**,tests/**}`
  next. That comes from the find description, which is outside this change.
- EDIT and MULTI: v3 equals or beats base on responses in every cell (EDIT 5.00 vs 5.33 on both models, MULTI 5.00 /
  4.33 equal). The EDIT gpt-6.1-sol seconds of v3 (25.2 vs 22.0) come from one 29.2 s run with the same 5 responses
  and the same calls as the other runs: model latency, not the text. No variant changed the read wave before an edit:
  every EDIT run still read all 5 files in one response.
- No variant made gpt-6.1-sol issue one call per response on EDIT or MULTI; the new lines say nothing about the order
  calls run in.

## Regression check, T01 and T05 (base vs v3, 3 runs per model)

| Variant | Task | Model | ok | Seconds | Responses | Calls/response |
|---|---|---|---|---|---|---|
| base | T01 | gpt-6.1-sol | 3/3 | 25.5 | 3.67 | 6.00 |
| base | T01 | gpt-6-sol | 3/3 | 16.5 | 3.00 | 7.33 |
| v3 | T01 | gpt-6.1-sol | 3/3 | 24.1 | 3.33 | 6.43 |
| v3 | T01 | gpt-6-sol | 3/3 | 16.0 | 3.00 | 7.17 |
| base | T05 | gpt-6.1-sol | 3/3 | 82.6 | 6.67 | 10.88 |
| base | T05 | gpt-6-sol | 3/3 | 38.8 | 5.33 | 8.92 |
| v3 | T05 | gpt-6.1-sol | 3/3 | 82.1 | 7.67 | 10.25 |
| v3 | T05 | gpt-6-sol | 3/3 | 36.6 | 5.67 | 8.43 |

Checklist coverage (`~/stock-bench/bench41/checklists.py`), judged by reading every final answer in full:

| Variant | T01 gpt-6.1-sol | T01 gpt-6-sol | T05 gpt-6.1-sol | T05 gpt-6-sol |
|---|---|---|---|---|
| base | 15/15 | 15/15 | 18/18 | 18/18 |
| v3 | 15/15 | 15/15 | 18/18 | 18/18 |

Every answer covers every point: T01 the Rust value in `config.toml` and its use in `cache_warmer.rs`
`db_refresh_due()`, the Python `AUTH_CACHE_DB_REFRESH_SEC = 600` in `settings/auth.py` and its use in
`workers/auth/cache_warmer.py`, and that `docker-compose.app.yml` runs the Rust `/app/auth`; T05 the addfunds page, topic
`ch.wallet_stats_events.v1`, table `superbot.wallet_stats_events` via `clickhouse_injector`, `kafka_payload_max_bytes =
131072`, Python `WALLET_STATS_KAFKA_PAYLOAD_MAX_BYTES = 128 * 1024` in `settings/runtime.py`, Rust services from
`docker-compose.app.yml`. No run changed the repository. Seconds are equal; T05 on gpt-6.1-sol took 7.67 responses vs
6.67 (runs 7, 8, 8 vs 8, 6, 6) at the same 82 s, within the run-to-run spread of that cell.

## Chosen: v3

Correctness ties everywhere, v3 has the fewest responses (4.78 over 18 runs vs 5.17 base) and is the only variant that
dropped the reads on WRITE for both models; WRITE 18.4 s / 5.50 -> 16.0 s / 4.67. The regression check shows no loss
of coverage on T01 and T05. Left in `extensions/RQW-prompt/SYSTEM.md` and `extensions/RQW-tools/descriptions/read.md`;
`write.md` and `edit.md` unchanged.

```diff
--- a/extensions/RQW-prompt/SYSTEM.md
+++ b/extensions/RQW-prompt/SYSTEM.md
@@ <general>
 - Answer a question about the code in the chat, however long the answer; create or change files only when the task asks for it.
+- When the task already says which files to create and what goes in them, a file list is enough to place them: read only the existing code they import or extend, then write them all in one call.
 - Stop exploring as soon as every part of the question is backed by code you have seen, and write the final answer once.
--- a/extensions/RQW-tools/descriptions/read.md
+++ b/extensions/RQW-tools/descriptions/read.md
-- Several reads in one response run in parallel. In one response, read every file you will need next: the files the answer rests on, the files you will change, their tests and the code they call.
+- Several reads in one response run in parallel. In one response, read every file you will need next: the files the answer rests on, the files you will change, their tests and the code they call. A new file the task fully specifies needs no read of the files around it.
```

Why both lines: the prompt line alone (v2) moved gpt-6-sol but not gpt-6.1-sol; together with the read line, which
sits where the model decides its read wave, both models skipped the neighbour reads. Facts: `write` takes several files
in one call (`files[]`, `write.ts`), so "write them all in one call" is true.

Limits: 3 runs per cell; differences under one response or a few seconds are within noise. The remaining WRITE gap to
stock Pi on gpt-6.1-sol is the second find (see above), which needs a change in `find.md`, not in these files.
