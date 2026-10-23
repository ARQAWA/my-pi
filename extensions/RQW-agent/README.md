# Agent lifecycle and audit fixes

`agent` starts in-process subagents with the default or a caller-selected prompt, model, thinking and base tools, plus
the workers below. A general subagent has `agent` itself, recursively and without a depth limit; explorers and workers
are leaves. This extension imports no other RQW extension. Optional RQW-tools definitions come exclusively from a fresh
`rqw-tools:subagent-tools` factory offer on `pi.events`; with no offer, Pi supplies stock tools.

## Prompt, kinds and title

- Default prompt: the main agent's system prompt as Pi built it for the main run (RQW-prompt's text, project context
  such as AGENTS.md, skills and `<cwd>` when they are loaded), read through the public `ctx.getSystemPrompt()` of Pi
  1.4.0, then a short subagent reminder (`SUBAGENT_REMINDER` in [prompt.ts](prompt.ts): it is a subagent, its answer
  goes to its caller, instructions addressed to the main agent or a coordinator do not apply to it), then the optional
  `role` as `<role>...</role>`. A nested subagent gets the same main prompt (handed down, never its caller's prompt,
  so nothing repeats). `system` stays the whole-prompt override: exactly that text, as before. `system` and `role` in
  one call are an error; on `restart` a new one replaces the old choice, otherwise the old choice is kept. The prompt is
  forced, so Pi appends nothing more.
- `explore` (`quick`, `medium` or `very thorough`) on `start` makes an explorer: the same default prompt with a very
  short file-search role at that thoroughness, the caller's current model, thinking as usual, tools `read`, `grep`,
  `find` and `bash` behind the [git guard](#git-guard) (no `edit`, `write`, `agent`, workers or review). It takes no
  `system`, `role`, `tools` or `model`; `restart` keeps it an explorer, optionally at another thoroughness. It is an
  `agent#N` child with the same wait/status/send/interrupt/stop/restart. A start option rather than a fourth tool:
  one schema field reuses the whole agent runtime and adds no tool to every request.
- `title` (optional, 3-5 words; `agent`, `code_writer`, `shell_runner`, `start` and `restart`, kept on restart) is shown
  as `title` in `status`, in the wait result's display data (`results[i].display.title`) and in the message
  `details.title`; the RQW-agent-ui result card shows it in its header after `<name>#<id>`. The delivered content keeps
  its `[agent#N] ...` format.
- The `agent` description carries only generic when/when-not advice adapted from Cursor (not for narrow questions,
  one or two known files or a single search; parallel starts for independent areas; full context and the exact
  return; trust the result; the user does not see it), no coordinator rules.

## Child tools and settings

- `codemode` and `tool_search`: a child (subagent, explorer, worker) gets Pi's own built-in definitions
  (`createCodemodeExtension`, `createToolSearchExtension`) when its caller has them active, as main has them through
  RQW-settings. Child codemode is the stock definition, not RQW-tools' barrier-grouped one: its script calls are
  ordered among themselves by the child's barrier, not as one call against the child's parallel calls.
- `review`: a general subagent gets RQW-review's tool when RQW-review is loaded, through its own handshake
  `rqw-review:subagent-review` on `pi.events` ([RQW-review README](../RQW-review/README.md#review-in-subagents)).
- Settings: every child's in-memory `SettingsManager` copies the caller's effective `shellPath`, `shellCommandPrefix`,
  `images.autoResize` and `images.blockImages`, `retry` (including provider timeout and retries), `transport`,
  `httpIdleTimeoutMs`, `websocketConnectTimeoutMs`, `compaction` (enabled, reserve, kept tokens, per-model
  overrides), `thinkingBudgets`, `steeringMode`, `followUpMode` and `codemode` (mode, inline budget); `childSettings`
  in [index.ts](index.ts). These are the settings Pi's session reads for requests, retries, compaction, queues and
  tools. `cacheWarming` stays off. Not copied: UI and terminal settings, default model/thinking and enabled models
  (the child's model is explicit), default tools (explicit allowlist), packages, extensions, skills, prompts and themes
  (children load no resources), branch summaries (no tree navigation), session storage, sharing and telemetry.
- Workers keep their fixed role prompt and get a `<environment>` block with the working directory, OS and today's
  UTC date ([prompt.ts](prompt.ts)).

Proof: `test/agent.test.ts` ("subagent parity" and the default-prompt, role and error tests), `test/workers.test.ts`,
`test/nested-workers.test.ts`, `test/cli.test.ts`. Decision: [DECISIONS.md, Agent](../../DECISIONS.md#agent).

## Workers

Main and every `agent` subagent can call `code_writer` or `shell_runner`. Omitted action (or `start`) takes a required
`task` brief and creates a fresh in-process session in the caller's cwd. The role prompt, model, reasoning and tool
allowlist are fixed, not caller overrides. Explicit `send` continues that assignment with its history. Subagents retain `agent` and both worker tools even
with an empty base-tool subset; workers and explorers have no `agent`, `code_writer` or `shell_runner` tools. Delegation
is recursive without a depth limit (main -> subagent -> subagent ... -> worker); workers and explorers are always the
last level, and there is no global limit on the count. A subagent's answer waits for its own subagents and workers like
it waits for workers. These are product workers; [PROCESS.md](../../PROCESS.md) governs development.

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

## GPT Fast

A child (`agent`, `code_writer`, `shell_runner`) inherits its caller's GPT Fast state once, when it starts, and keeps it
for its life, `send` and `restart` included; a nested child inherits from its direct caller. The state is answered by
RQW-settings over `pi.events` (`rqw-settings:fast-gpt-query`); without it children stay on the standard tier. The optional
boolean `fast_gpt` overrides the inherited state (`false` when the user forbids Fast for subagents; `send` and
`restart` of `agent` may change it). `fast-gpt.ts` sets `service_tier: "priority"` on the child's openai-codex requests
through `before_provider_request`; Anthropic requests are untouched. Default, rule and quotes:
[DECISIONS.md, Settings](../../DECISIONS.md#settings). Proof: `test/fast-gpt.test.ts`.

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

`send` to a running child is Pi steering (`session.steer`): the message reaches the child after its current tool call
(Pi runs all calls of the current assistant turn first), before its next model request, and aborts nothing; a message
sent before the child's first request goes into that request. To an idle child `send` starts a new run with its
history. A child whose native run has ended and that only waits for its own pending workers gets the message at
once (reply `: sent`, a new run starts; the worker result still arrives once). A child parked in its own `wait` tool
call gets it after that call returns. `send` with `interrupt: true` redirects a running child in one call: it drops the child's queued steering and
follow-ups and aborts the current turn exactly like `interrupt` (session and history kept, pending workers aborted),
then returns at once with `<name>#N: interrupted, sent`, without waiting. The task is recorded as the child's next
run and starts automatically, once, as soon as the old run has stopped; there is no time limit, so a tool that
ignores the abort signal simply delays the start, and `status` shows `cancellation_requested` and `pending_sends`.
Until the start the child counts as running: a `wait` on it is never `idle` and ends with `target_changed` when the
new run begins; a native run that a worker result had woken is waited out first, so the new prompt never collides with it.
A further `send` before the start is appended after it, in order, and all pending tasks go in one prompt joined by
blank lines. A later `interrupt`, `stop` or `restart` drops them. On an idle child the flag makes a plain `send`.
Without the flag nothing changes. Use plain `interrupt` only to cancel. Decision: [DECISIONS.md, Agent](../../DECISIONS.md#agent).

`interrupt` returns the pre-interrupt snapshot and `interruption_requested`: it requests abort, clears queued steering and follow-ups and
preserves history. Cancellation may still be pending: a plain send is rejected until settlement (`send` with `interrupt: true` is accepted and queued). `stop` closes and forgets the
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
same id and the old settings unless overrides were supplied. Queued old steering and follow-ups are cleared before abort/disposal.

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
`agent#N started`, `restarted`, `stopped`, `interrupted`, `is idle`, `: sent`, `: queued after the current run` (older) or `: queued after the current tool call` tool results.
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
provider asserts that an empty base-tool subset declares exactly `agent` and the worker tools (plus `codemode` in the
scenario where main has it active), matching [Workers](#workers).
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

## UI metadata and running-count offer (P4)

Delivered custom messages keep their original content byte-for-byte. Their `details` add
`{ id, outcome: "finished" | "failed", model?, thinking?, seconds }` beside `delivery` and `run`.
`model` is the last assistant response's actual `provider/id`, omitted before any assistant response;
`thinking` is the selected level when known. Runtime is monotonic, rounded to 0.1 seconds.
Final errors, aborts and truncation are failed; a recovered retry is finished. Quiet cancellation still
suppresses delivery as before. These fields do not change execution, steering or delivery ownership.

For wait, the same metadata is at `result.details.results[i].display`. The existing result item's
`outcome` remains `completed`/`error`, and the entire original wait `content` is unchanged. Consumers
must read display metadata from details, not parse it from the model-visible JSON text. A receipt is
not another delivered answer and adds no duplicate tool-use count. Proof: `test/ui-metadata.test.ts`.

### Contract for P6: `pi.events`, version 1

No cross-extension imports are needed. Each enabled producer offers one **source object per session
lifetime**. RQW-agent owns agent/worker counts, including nested workers; RQW-review owns review counts
inside its own folder. There is no generic native-job registry or invented job count.

- Listen on `rqw:running-counts:offer` for `{ version: 1, source }` **before** requesting existing sources.
- Emit `rqw:running-counts:request` with `{ version: 1, reply(source) }`. Every live producer replies
  synchronously. This handshake supports either extension load order.
- Deduplicate sources by object identity. Each source has `version: 1`, `snapshot()`,
  `subscribe(listener)` and `dispose()`.
- `snapshot()` returns a fresh `{ agents: number, workers: number, reviews: number }`. Sum the current
  snapshots of distinct live sources by kind. Missing/disabled producers contribute zero.
- `subscribe(listener)` returns an idempotent unsubscribe function. Subscribe, then take a snapshot;
  a live subscription has no initial callback. Subsequent callbacks contain changed counts only.
  A `null` callback means the source has been disposed: remove it, not merely its current counts.
- `dispose()` belongs to the **producer lifecycle**, not consumers. Consumers call only their own
  unsubscribe functions and the unsubscribe returned by `pi.events.on`. Disposal is idempotent,
  clears subscribers, sends each `null`, and makes snapshots zero. A late subscriber gets `null`
  immediately. A new `session_start` disposes the old source and offers a fresh one;
  `session_shutdown` disposes it without a replacement. Never retain sources across reload/switch.
- Consumer callbacks cannot interrupt producer execution. Offers and snapshots are presentation-only;
  no operation on a source starts, cancels or delivers a child result.

Counts read existing Activity native state and the existing runtime ownership tree, not pending results
or logical assignment IDs. A native-idle agent waiting for its worker contributes zero agents while the
running worker contributes one worker. Review counts read RQW-review's own running-job set. P4 adds no
statusbar consumer, timer, card or second child registry. Proof: `test/counts.test.ts` and the independent
RQW-review `test/counts.test.ts`; full extension isolation remains `test/isolation.test.ts` in CI.

Authority: proposal «Дизайн согласован и зафиксирован. Следующая задача T16: передавать индикатору реальные счётчики работающих агентов, воркеров и ревью через pi.events. Существующий учёт в extensions/RQW-agent/activity.ts переиспользуем, без дублирования.»; owner «+».
Reason: expose real background activity without coupling independently switchable extensions or changing
execution/delivery. Carriers: `activity.ts`, `index.ts`, `workers.ts`, `counts.ts`, and RQW-review's own
`counts.ts`/`index.ts`. Root decision/installation documentation is reserved for P10.
Public Pi 1.4.0 seams: root-exported `EventBus`/`createEventBus`, `pi.events.emit/on`,
`AgentSession.subscribe`, `AgentSession.thinkingLevel`, and `session_start`/`session_shutdown`.
No Pi patch, private-field access or method replacement is introduced by this producer work.
