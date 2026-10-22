# Agent lifecycle and audit fixes

`agent` starts in-process subagents with caller-selected prompt, model, thinking and base tools, plus the workers below.
Subagents have no `agent` tool. This extension imports no other RQW extension. Optional RQW-tools definitions come
exclusively from a fresh `rqw-tools:subagent-tools` factory offer on `pi.events`; with no offer, Pi supplies stock tools.

## Workers

Main and every `agent` subagent can call `code_writer` or `shell_runner`. Omitted action (or `start`) takes a required
`task` brief and creates a fresh in-process session in the caller's cwd. The role prompt, model, reasoning and tool
allowlist are fixed, not caller overrides. Explicit `send` continues that assignment with its history. Subagents retain both worker tools even
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
or `shell_runner#N started` without waiting for completion. Its final result arrives once through `wait` or as
`[code_writer#N] ...` / `[shell_runner#N] ...` in the direct caller's session, never directly to main for a nested worker.

### Runtime and delivery

[workers.ts](workers.ts) supplies profiles to the same session runtime in [index.ts](index.ts) that implements `agent`:
allocation metadata, abortable creation, result delivery, caller-abort latching and shutdown are shared, not copied.
Registration takes the direct caller's API explicitly; there is no global caller session. Completed workers stay idle
with history until `stop` or caller shutdown. Idle retained sessions do not keep the parent assignment pending.
Each `start` is clean; only explicit `send` reuses history. Retained history costs memory; send pays its input tokens
and may trigger Pi compaction or a new cache write after expiry. There is no automatic eviction/cap. Caller shutdown
aborts and disposes active and retained sessions and drops their results. Caller Esc leaves accepted workers
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
There is no worker-specific execution, turn, token, output-growth or wall-clock limit; provider limits and explicit
management cancellation still apply. Wait timeout limits the caller's pause, never the child's lifetime.

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

## Wait, status and management

All three tools accept `wait`, `status`, `send`, `interrupt`, `stop`, `restart`; workers also keep `{task}` for a fresh
start. Management `id` belongs to that tool's kind (`agent` also accepts its legacy numeric string). `wait`/`status`
accept nonempty `ids` of fully qualified IDs, mixing any direct agents/workers. No access to siblings/grandchildren.

```js
agent({action: "wait", ids: ["agent#1", "code_writer#1", "shell_runner#1"], timeout_ms: 90000})
code_writer({action: "status", ids: ["code_writer#1"], messages: 8})
code_writer({action: "send", id: "code_writer#1", task: "Fix the reported assertion only"})
shell_runner({action: "stop", id: "shell_runner#1"})
```

Work in parallel when useful. When blocked, estimate remaining duration and choose `timeout_ms` somewhat longer on
**each** wait; 300000 ms is only the omission/null default, not a periodic requirement or maximum. A positive finite
safe integer is required; large waits use monotonic deadlines and platform-safe timer chunks. Timeout never stops a
child. Re-estimate and wait again, or inspect status before deciding management. No busy polling, model turn or network
request comes from the timer; children continue their own work/tokens. No new execution limits/watchdogs are added.

The tool returns text JSON mirrored in `details` (no outputSchema): `reason`, `timed_out`, `results`, `receipts`,
`statuses`; `target_changed` also identifies the old run/change. `result` returns the first selected completion and
any other already-ready results, including terminal errors. `timeout` returns every selected status without consuming
a future result. `idle` returns immediately if no selected run/result exists. Unknown/closed IDs are explicit status
errors. Interrupt/stop/restart wake old waits; they never silently follow replacements. Management registration is
ordered, but the wait Promise holds neither that queue nor the optional RQW-tools barrier.

Results have caller-local ID, epoch/run identity and a UUID delivery. A broker reserves a result for one waiter or
commits it to the usual push message. Repeated/competing waits receive receipts (`delivered_via`, `claimed_by`), not
second copies. Pending settlement messages can still be claimed; an already submitted Pi message cannot be recalled.
A wait handoff commits only with a successful finalized persisted toolResult. Failed hooks, abort or an outer codemode
error before saved handoff return the reservation to the message path. Nested ownership uses actual `parentToolCallId`
events, not ID parsing or the bounded nestedCalls log. A successful script deliberately filtering its result owns that
choice. In codemode use `text(result)` or return the result to read its JSON.

`status` is a local snapshot, without invoking the child model or consuming a result. `messages` defaults to 8,
validated from 5 to 10: chronological role/time/tool IDs, trimmed head/tail previews, image/binary metadata only,
thinking presence/size rather than raw reasoning, plus unfinished assistant/tool data. State distinguishes native
running/preflight/model/retry/compaction, streaming tool arguments, running tools and idle; `pending_children` explains
a native-idle subagent still awaiting workers. Elapsed/idle/activity ages are monotonic. Diagnostics preserve parallel
call IDs, previews, argument byte growth, last updates and repetition suspicions (not stall verdicts). Known session
token totals/run deltas and explicitly incomplete live usage are not token estimates derived from bytes. Preview budgets
(1200 characters/message, 12000/ID) limit representation only, never execution/history.

`interrupt` returns the pre-interrupt snapshot and `interruption_requested`: it requests abort, clears follow-ups and
preserves history. Cancellation may still be pending: send is rejected until settlement. `stop` closes and forgets the
ID. `restart` fences the old generation and creates a fresh session with the same external ID; without task it is idle,
not a replay. Workers cannot override fixed configuration. An in-process tool may ignore AbortSignal and still have
side effects; controls do not wait indefinitely for it. No transaction or forced JavaScript kill is promised. Inspect
files/commands before retrying. Reload/resume restores ID high-water marks, never live children.

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

Print/JSON use one caller-wide non-consuming fallback wait at `agent_end`, not serial waits per profile. It uses the
omitted default; completion follows normal message continuation, and timeout adds compact status so the caller can
decide. A native-idle subagent uses the same bounded fallback for its own workers, never forwarding an intermediate
timeout as its final answer to main. Explicit wait takes priority. TUI/RPC idle callers keep normal push wakeups.
Caller abort ends only its wait, leaving accepted children running; late results do not wake the aborted caller.
`agent_before_settle` checks continuation and late-result flow.

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

All tests use real Pi 1.4.0 SDK sessions or its actual CLI with faux providers. No real models, credentials or network
are required. Use Node 22.19.0 or the current Node runtime from the repository root:

```sh
node --import ./test/no-network.mjs --test --test-concurrency=1 extensions/RQW-agent/test/*.test.ts test/agent-tools.test.ts
RQW_AGENT_BUN=1 node --import ./test/no-network.mjs --test extensions/RQW-agent/test/cli.test.ts
```

The second command requires an installed Bun. CLI children use a temporary HOME and agent directory, an allowlisted
environment, offline flags and the same transport-denying preload before Pi loads. They cover normal text/JSON/RPC,
main cancellation during text/JSON waiting, late-after-abort RPC, and actual builtin codemode nested ids. The CLI faux
provider asserts that an empty base-tool subset declares exactly the worker tools, matching [Workers](#workers).
`test/coordinator.test.ts` covers broker races, handoff, caller-chosen deadlines, implicit fallback and explicit-wait
priority with virtual time. `test/activity.test.ts` covers live diagnostics, usage, trimming and argument growth.
`test/wait.test.ts` uses real sessions for mixed waits, retention, history, cancellation-pending tools and hook failure.
CLI scenarios cover direct/nested waits, mixed workers, codemode handoff and outer error/timeout/abort; the same focused
CLI file runs under Bun in CI. SDK regressions cover auth/queue/loader/factory/creation/preflight cancellation, failed replacement, unrecovered
length/summary failure, safe ids, reload, shutdown and TUI/RPC late-after-abort. Coverage also includes successful retry,
compaction, settings inheritance, exact system prompt and optional-tools integration.

SDK TUI-mode Esc proof exercises `clearQueue()` plus `abort()`, not a keyboard/renderer test. Native Windows/Linux and
real provider transports are not exercised by a local macOS run. Pi's separate compaction summarizer retains Pi's own
system prompt; exact caller `system` applies to task requests. Bare SDK `session.dispose()` does not emit lifecycle
shutdown: hosts must emit `session_shutdown` or use Pi's runtime lifecycle. Child sessions remain in-memory; reload
restores issued ids, not child sessions. Accepted process-sharing and end-of-session delivery limits are unchanged.
