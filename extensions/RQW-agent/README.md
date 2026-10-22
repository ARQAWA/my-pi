# Agent lifecycle and audit fixes

`agent` starts in-process subagents with caller-selected prompt, model, thinking and base tools, plus the workers below.
Subagents have no `agent` tool. This extension imports no other RQW extension. Optional RQW-tools definitions come
exclusively from a fresh `rqw-tools:subagent-tools` factory offer on `pi.events`; with no offer, Pi supplies stock tools.

## Workers

Main and every `agent` subagent can call `code_writer` or `shell_runner`. Each tool takes only a required `task`
brief: the whole role prompt, model, reasoning and tool allowlist are fixed, not caller overrides. Every call creates
a fresh in-process session in the caller's cwd, with no send or resume. Subagents retain both worker tools even
with an empty base-tool subset; workers have no `agent`, `code_writer` or `shell_runner` tools. Maximum delegation
depth is main -> subagent -> worker. These are product workers; [PROCESS.md](../../PROCESS.md) governs development.

### Briefs and reports

Use workers for noisy mechanical work, not when writing the brief costs more than doing it yourself. Trust the
result rather than redoing it. Independent calls may run in parallel; never give two code_writers the same file.
Caller-facing instructions live in [descriptions/](descriptions/); complete role rules live in [roles/](roles/).

| Worker | Brief fields in `task` | Work and final report | Tools |
| --- | --- | --- | --- |
| `code_writer` | goal; exact files; exact decided change; constraints; how to check | Writes code/configs, never documentation or prompts; may run a focused check of its change. Reports `done` or `blocked: <reason>`, changed files, checks and deviations. | `read`, `edit`, `write`, `grep`, `find`, `bash` |
| `shell_runner` | directory; commands in order; timeout; on failure stop or continue | Runs the given commands without choosing alternatives or fixing failures. Reports each command, exit code, duration, outcome, verbatim error lines and full-output path in the OS temp directory; services include readiness, port, log path and process id. | `bash`, `read`, `grep`, `find` |

An ambiguous or contradictory brief is reported as blocked instead of guessed. The tool returns `code_writer#N started`
or `shell_runner#N started` without waiting for completion; do not wait or poll. Its final result arrives later as
`[code_writer#N] ...` or `[shell_runner#N] ...` in the direct caller's session, never directly to main for a nested worker.

### Runtime and delivery

[workers.ts](workers.ts) supplies profiles to the same session runtime in [index.ts](index.ts) that implements `agent`:
allocation metadata, abortable creation, result delivery, caller-abort latching and shutdown are shared, not copied.
Registration takes the direct caller's API explicitly; there is no global caller session. Completed worker sessions
are disposed; caller shutdown aborts pending workers and drops their results. Caller Esc leaves accepted workers
running and keeps late answers without waking the aborted caller; see [Results and main abort](#results-and-main-abort).

A subagent's native run can settle while workers are pending. Their messages wake it normally; its parent keeps the
logical assignment open across those wakeups. Answers from native runs ending with pending workers or unconsumed
worker results are intermediate and are not delivered to main. Main gets the answer after no workers/results remain
pending. `stop`, `restart` and parent shutdown close that subagent's workers and discard their late results.
`interrupt` aborts pending workers and drops their results without closing the worker runtimes; a later `send` can
start fresh workers in the same subagent. Queued/preflight worker calls are canceled too, and issued ids stay reserved.

Workers use fresh optional RQW-tools definitions through the original offer bus, otherwise stock tools, as described
above. Session state and delivery remain caller-local. The ordered edit/check barrier is available when RQW-tools is
loaded. [worker-model.ts](worker-model.ts) selects from the fixed primary/fallback chain, skipping missing candidates
and provider auth-check failures; exhausting the candidates returns a clear No credentials error. The accepted chain,
measured reasoning levels, reasons and evidence have one decision record: [Workers](../../DECISIONS.md#workers).
There is no worker-specific token cap or timeout; provider limits and caller cancellation still apply.

### Git guard

Neither worker changes git state. Supported read-only git queries include `status`, `diff`, `log`, `show`, `blame`,
`ls-files`, `rev-parse`, `grep`, branch/tag listing, `remote -v`, submodule status/summary and config reads. Mutations,
including staging, commits, branch/tag creation/deletion, merges, pushes, pulls, fetches and config writes, are blocked;
unknown git commands are rejected too. The caller owns state-changing git, not the worker.

Every worker bash call passes [git-guard.ts](git-guard.ts)'s `blockedGit` through the session's `tool_call` hook; a
refusal is a tool error, not a shell invocation. The guard checks chained commands, subshells, command substitutions
and env prefixes, re-inspects known launchers, find executable actions and eval, and rejects unchecked piped bare shells.
It also rejects git config/pager execution options and executable environment overrides, even on read-only commands.
`command -v` / `-V` lookups are not execution. Pager environment variables and non-injecting git config settings are
allowed; config injection via `GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_*`, `GIT_CONFIG_VALUE_*` or `GIT_CONFIG_PARAMETERS`
remains blocked. Piped-shell errors identify unchecked shell execution, not an observed git mutation.
Listing options consume their values before mutation checks; shell parameter expansions do not become false comments.
Heredoc bodies are data, consumed in declaration order through their literal terminator lines (`<<-` strips tabs).
Expanding bodies inspect command substitutions; arithmetic and ordinary quotes remain data. Unquoted backslash-newline
continuations are joined before terminator matching. Unterminated/unsupported heredocs fail as unchecked. Known bare
or `-s` shells fed by heredocs/here-strings are also unchecked; shells with a script-file operand accept stdin data.
Numeric arguments before `&>` or `&>>` remain arguments, not IO descriptors. This shell syntax guard is not a sandbox
and does not interpret external scripts, aliases or computed commands.

Offline proofs: `test/workers.test.ts`, `test/nested-workers.test.ts`, `test/worker-model.test.ts` and
`test/git-guard.test.ts`. [Isolation](../../DECISIONS.md#isolation) applies to workers and their tests too.

## Prompt cache

Child Anthropic Messages requests carry the built-in `cacheRetention: "short"` policy (5m), independently of
RQW-anthropic and user config. Cache markers stay enabled; background warming is off. The existing stream guard
applies the option before RQW-anthropic can supply its generic OAuth 1h fallback. Other APIs are unchanged.
Policy, approval and measurements: [DECISIONS.md, Agent](../../DECISIONS.md#agent),
[prompt cache policy](../../notes/prompt-cache-policy.md). Package wire proof: `test/prompt-cache.test.ts`.

## Cancellation and replacement

Each tool call captures both its explicit caller signal and `ctx.signal` before entering the ordered queue. Canceled
queued actions do not execute. Auth, resource loading, SDK creation and run preflight have abortable fences. A session
that materializes after cancellation is disposed. A late SDK prompt cannot reach the provider after its run was canceled.
Late pre-run compaction is aborted before its summary request.

A new child is accepted only after Pi reports active preflight/compaction or the run has already ended. Cancellation
before acceptance closes that newly created child. Cancellation of the main run does not stop an already accepted,
independent child. `send` to an idle child uses the same preflight fence but retains that child's identity and history.

`restart` first validates its configuration, then removes the old id and closes the old session before creating its
replacement. A failed or canceled replacement leaves that id invalid, not pointing at a disposed session. Configuration
validation failure before replacement leaves the still-valid old child untouched. A successful replacement retains the
same id and the old settings unless overrides were supplied. Queued old follow-ups are cleared before abort/disposal.

## Results and main abort

A terminal `length` answer retains its partial text and adds
`error: Response was truncated: the model reached its output token limit.` Empty truncated answers also get the marker.
A final `compaction_end.errorMessage` without `willRetry` is delivered as `error: <reason>`. Successful retry/recovery
drops only the provisional assistant attempt, including its truncation marker. Genuine final answers and errors remain
in order across follow-ups.

Print and JSON wait for accepted children in `agent_end`, while `ctx.signal` is live, using an abortable race. Main abort
returns without waiting for independent children. `agent_before_settle` only checks continuation and late-result flow.

TUI Esc and RPC abort latch the main session as aborted through `agent_settled`. A child that finishes **after** that
abort is appended without waking the main model. The next main run clears the latch and sees the saved result once.
Ordinary idle delivery after a new main run still wakes the model. The same late-idle bug was reachable here as in the
reference RQW-review fix; no implementation is imported from that extension.

## IDs and history

Every issued positive safe integer is immediately persisted with `pi.appendEntry('agent', { id })`, before creating the
child. This also covers calls nested in codemode, which have no outer `agent` tool-result entry, and failed/canceled starts.
Reload/resume/fork reads this metadata plus compatible legacy owned outer prefixes: `[agent#N]` custom results and
`agent#N started`, `restarted`, `stopped`, `interrupted`, `is idle`, `: sent` or `: queued after the current run` tool results.
Numbers mentioned inside result bodies or errors do not allocate ids. Unsafe integers are ignored. At
`Number.MAX_SAFE_INTEGER` allocation fails before another child is constructed. A live map entry cannot be overwritten
by a rounded duplicate id.

## Offline proof

All tests use real Pi 1.3.0 SDK sessions or its actual CLI with faux providers. No real models, credentials or network
are required. Use Node 22.19.0 or the current Node runtime from the repository root:

```sh
node --import ./test/no-network.mjs --test --test-concurrency=1 extensions/RQW-agent/test/*.test.ts test/agent-tools.test.ts
RQW_AGENT_BUN=1 node --import ./test/no-network.mjs --test extensions/RQW-agent/test/cli.test.ts
```

The second command requires an installed Bun. CLI children use a temporary HOME and agent directory, an allowlisted
environment, offline flags and the same transport-denying preload before Pi loads. They cover normal text/JSON/RPC,
main cancellation during text/JSON waiting, late-after-abort RPC, and actual builtin codemode nested ids. The CLI faux
provider asserts that an empty base-tool subset declares exactly the worker tools, matching [Workers](#workers).
SDK regressions cover auth/queue/loader/factory/creation/preflight cancellation, failed replacement, unrecovered
length/summary failure, safe ids, reload, shutdown and TUI/RPC late-after-abort. Coverage also includes successful retry,
compaction, settings inheritance, exact system prompt and optional-tools integration.

SDK TUI-mode Esc proof exercises `clearQueue()` plus `abort()`, not a keyboard/renderer test. Native Windows/Linux and
real provider transports are not exercised by a local macOS run. Pi's separate compaction summarizer retains Pi's own
system prompt; exact caller `system` applies to task requests. Bare SDK `session.dispose()` does not emit lifecycle
shutdown: hosts must emit `session_shutdown` or use Pi's runtime lifecycle. Child sessions remain in-memory; reload
restores issued ids, not child sessions. Accepted process-sharing and end-of-session delivery limits are unchanged.
