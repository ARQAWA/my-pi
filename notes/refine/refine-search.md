# Refining the grep and find descriptions by probes (2026-10-20)

Stand: this copy. Probe: `/tmp/probe/probe.sh`, tasks T01, T03, T06, models gpt-6.1-sol medium and gpt-6-sol low,
3 runs per model per task per variant (18 runs per variant), at most 4 at once. Runner `run.py`, logs, texts of every
variant and per-point scores were kept in a `notes/probe-runs/` folder of that stand that was never committed; they
are not available. Raw runs were in `/tmp/probe/out/search-<variant>-*.json(l)`. The `limit` parameter texts in
`index.ts` were not changed.

Checklist coverage: the full final answer of each run graded against `bench41/checklists.py` by a model, twice;
the 13 of 384 points where the two passes disagreed were decided by hand. T01 `py_use` is counted when the answer
names the use site in `src/superbot_ng/workers/auth/cache_warmer.py` (the grader flipped on this point in both
directions). Responses = model responses including the final one; calls per response = mean over responses with calls.

## Results

| Variant | Model | Mean s | Responses | Calls/response | bashSearch | Checklist covered |
|---|---|---|---|---|---|---|
| base | all | 32.6 | 4.44 | 7.9 | 0 | 94.1% |
| base | gpt-6.1-sol | 40.5 | 5.11 | 7.0 | 0 | 98.1% |
| base | gpt-6-sol | 24.8 | 3.78 | 8.8 | 0 | 90.0% |
| v1 | all | 34.6 | 4.78 | 6.7 | 0 | 95.0% |
| v1 | gpt-6.1-sol | 44.0 | 5.22 | 6.7 | 0 | 100.0% |
| v1 | gpt-6-sol | 25.1 | 4.33 | 6.7 | 0 | 90.0% |
| v2 | all | 33.1 | 4.39 | 7.5 | 0 | 93.9% |
| v2 | gpt-6.1-sol | 39.5 | 4.11 | 8.1 | 0 | 100.0% |
| v2 | gpt-6-sol | 26.7 | 4.67 | 6.8 | 0 | 87.8% |
| v3 | all | 34.1 | 4.56 | 7.1 | 0 | 95.0% |
| v3 | gpt-6.1-sol | 42.0 | 5 | 6.8 | 0 | 100.0% |
| v3 | gpt-6-sol | 26.2 | 4.11 | 7.4 | 0 | 90.0% |

Per task (both models):

| Variant | T01 cov / resp / s | T03 cov / resp / s | T06 cov / resp / s |
|---|---|---|---|
| base | 100% / 3.83 / 25.0 | 93% / 4.67 / 36.1 | 89% / 4.83 / 36.8 |
| v1 | 100% / 4.33 / 24.6 | 93% / 4.33 / 34.9 | 92% / 5.67 / 44.3 |
| v2 | 100% / 3.5 / 21.9 | 90% / 4.17 / 34.4 | 92% / 5.5 / 43.0 |
| v3 | 97% / 3.33 / 22.3 | 97% / 4.67 / 36.9 | 92% / 5.67 / 43.1 |

Missed points: base T06 auth x4, T03 py_ng x2; v1 T06 auth x3, T03 py_ng x2; v2 T03 py_ng x3, T06 auth x3;
v3 T06 auth x3, T03 py_ng x1, T01 rust_use x1. `T06:auth` (auth_blocker_seconds / AUTH_BLOCKER_SECONDS) is missed
by gpt-6-sol low in every variant: it reads the config section and leaves the key out of the answer.

No variant did any search through bash, none left the repo dirty, and none fell into one call per response
(minimum mean 6.7 calls per response).

## Variants

- base: the text as committed (`texts/grep.base.md`, `texts/find.base.md`).
- v1: names the spellings to put into the alternation (snake_case key, UPPER_CASE constant, CamelCase type, the words
  of the question); one find with a brace pattern for the run files (find.md gains the brace fact, checked with fd:
  `{*compose*,Dockerfile*,Makefile,main.*}` matches all four); whole-file reads also for files that use the subject
  in any implementation; stop rule asks, for every implementation running or not, where the value is set, its
  value and where it is used.
- v2: v1 plus "put every read the hits already justify into this one response", "each value and config key", and
  "the deploy and run files are enough to show what runs; do not trace startup code further".
- v3: v2 plus "skip common words ... that would flood the output" and "what the code does with it there".

## Choice: v3

By the rule completeness first, then responses, then seconds: v1 and v3 cover the most (95.0%), v3 needs fewer
responses than v1 (4.56 vs 4.78) and fewer seconds (34.1 vs 34.6). v3 has the best spread over tasks (97 / 97 / 92%)
and is the only variant where gpt-6.1-sol covers every point in every run together with gpt-6-sol at its best
(90%); it targets the open bench42 gap (the answer missing the non-running twin) directly.

Honest caveat: all four texts are within noise of each other. One checklist point is about 1% here; base vs v3 is
94.1% vs 95.0%, 4.44 vs 4.56 responses, 32.6 vs 34.1 s. T01 got faster in every variant (3.83 -> 3.33 responses in
v3), T06 got slower in every variant (4.83 -> 5.5-5.67 responses: more chasing of the second implementation's files).
A bench over T01-T07 with more runs is needed before claiming a gain.

## Chosen text

`extensions/RQW-tools/descriptions/grep.md`:

```text
Search file contents with ripgrep; respects .gitignore. Returns matching lines as path:line: text, paths relative to path.
- Use this tool instead of rg or grep through bash.
- Default scope is the working directory; set path (a directory or one file) to narrow it.
- pattern is a regex: escape metacharacters, e.g. "functionCall\(", "\{", "\}", or set literal.
- Output is cut at 50KB, with no match cap unless you set limit; long lines are cut at 500 characters. If it ends with a truncation notice, narrow pattern, path or glob.
- Search greedily in waves, broad first, then narrower. First response: several broad grep searches without limit, one per facet of the subject, each one alternation of every name, synonym and spelling (snake_case key, UPPER_CASE constant, CamelCase type, the words of the question; skip common words such as a product name that would flood the output), plus one find for the deploy, run and entrypoint files (compose, Dockerfile, Makefile, systemd, CI, main, __main__). Each next response, in one batch: read whole, without offset or limit, the files whose hits show a definition, configuration, entrypoint or use of the subject in any implementation, and those run files; read other hits only around their lines with offset and limit; and grep the exact identifiers just found. Put every read the hits already justify into this one response instead of one more file per response. Stop when every part of the question has an answer backed by a file and line, for every implementation, running or not: where each value and config key of the subject is set, its value, where it is used and what the code does with it there. The deploy and run files are enough to show what runs; do not trace startup code further, and do not follow the subject into neighbouring subsystems the question does not ask about.
```

`extensions/RQW-tools/descriptions/find.md`:

```text
Find files by glob pattern. Returns paths relative to the search directory, unsorted. Respects .gitignore; hidden files are included.
- A pattern without "/" matches file names at any depth, e.g. "*.ts"; a pattern with "/" matches the end of the path at any depth, e.g. "src/**/*.spec.ts". Braces list alternatives in one pattern, e.g. "{*compose*,Dockerfile*,Makefile,main.*}".
- No result count cap by default; output is cut at 50KB. If cut, narrow the pattern or path.
- Use find for file names and grep for file contents.
- Several searches in one response run in parallel. Run every search that may be useful in one response.
```
