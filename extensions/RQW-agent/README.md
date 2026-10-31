# Agent lifecycle and profiles

`agent` starts in-process subagents with the default or a caller-selected prompt, model, thinking and base tools.
Optional `agent_type` selects a Codex TOML profile on this same lifecycle. Every subagent has `agent` itself,
recursively and without a depth limit. This extension imports no other RQW extension. Optional RQW-tools definitions come exclusively from a fresh
`rqw-tools:subagent-tools` factory offer on `pi.events`; with no offer, Pi supplies stock tools.
When RQW-web is loaded, its optional `rqw-search:subagent-web` registration offer also supplies `web` to every child,
including nested agents. Each call uses that child's model and thinking; no import reaches RQW-web.

Any extension can explicitly offer inline child factories on `rqw-agent:subagent-extension-factories` with
`{ offer(factory) }`. Before each child loader reload, RQW-agent collects and deduplicates those factories and appends
them to `DefaultResourceLoader.extensionFactories`. Each runs with the child's own `ExtensionAPI` and can reoffer itself
for nested children on the same channel. `noExtensions: true` stays unchanged; no project or package resources are loaded.

## Prompt and title

- Default prompt: the main agent's system prompt as Pi built it for the main run (RQW-prompt's text, project context
  such as AGENTS.md, skills and `<cwd>` when they are loaded), read through the public `ctx.getSystemPrompt()` of Pi
  1.4.0, then the adapted Codex 0.165.0 subagent reminder (`SUBAGENT_REMINDER` in [prompt.ts](prompt.ts)), then the optional
  `role` as `<role>...</role>`. A nested subagent gets the same main prompt (handed down, never its caller's prompt,
  so nothing repeats). `system` replaces the main prompt text; the subagent reminder is still appended after it
  (`system_file` too). There is no option to drop the reminder; a parent allows spawning by saying so in the task,
  role or system. `system` and `role` in
  one call are an error; on `restart` a new one replaces the old choice, otherwise the old choice is kept. The prompt is
  forced, so Pi appends nothing more.
- `title` (optional, 3-5 words; `agent` `start` and `restart`, kept on restart) is shown
  as `title` in `status`, in the wait result's display data (`results[i].display.title`) and in the message
  `details.title`. The package registers RQW-agent-ui before RQW-tool-ui for delivered-message cards and wait-result
  cards: collapsed waits are tool-ui's when it is loaded, Ctrl+O shows agent-ui's expanded wait cards. The delivered content keeps its `[agent#N] ...` format.
- The `agent` description and parameter descriptions adapt Codex 0.165.0 texts to this harness. They retain the
  approved trust and result-delivery guidance and describe our lifecycle, profiles and prompt files. The profile list
  is appended under `Available roles:`. No project-specific execution rules.

## Codex profiles

`agent_type` is the only profile selector on `start` and `restart`; there is no `profile` alias.
Without it, a new child keeps the generic prompt/model/thinking defaults. Profiles use Codex TOML syntax,
parsed by the direct dependency `smol-toml@1.9.1`. They configure a role on the existing Pi lifecycle, not a
Codex process or its complete configuration runtime.

Sources are loaded from weakest to strongest:

1. Extensions offer TOML paths on `pi.events` channel `rqw-agent:profiles` with `{ offer(paths: string[]): void }`.
2. `$CODEX_HOME/config.toml` and `$CODEX_HOME/agents/`, defaulting to `~/.codex`.
3. `getAgentDir()/config.toml` and `getAgentDir()/agents/`, normally `~/.pi/agent`.
4. Project directories from the project root to cwd: `.codex/config.toml` and `.codex/agents/`, then
   `.pi/config.toml` and `.pi/agents/` at each level.

A project `.codex` layer loads only when Codex trusts that directory: `projects.<path>.trust_level = "trusted"` in the
user config. Administrative and managed Codex config (`/etc/codex`, `managed_config.toml`) is not supported. Trust is looked up for the directory, then the project
root, then the git root; a linked worktree uses its main checkout, if its Git metadata is complete and consistent as in
Codex (`gitdir` and `commondir` both present, a separate git directory allowed). A trusted subdirectory does not open the
`.codex` of its parent. The project root of the `.codex` layers is the nearest directory with a `project_root_markers`
entry (default `.git`, where a `.git` directory without HEAD does not count); with no marker, or an empty list, only cwd
counts.

Project `.pi` layers are not gated and keep their own root, as before: the nearest directory with a `.git` entry, or the
filesystem root outside Git. They do not follow `project_root_markers`. This is the agreed exception to exact parity:
Pi's own sources keep priority over Codex at the same level.

Codex's built-in roles `default` ("Default agent.") and `worker` are always in the catalogue, with the source
`builtin:<name>`. They carry no model, effort or instructions, so the child keeps the parent's settings and prompt. A
user or project role of the same name replaces the built-in one completely, as in Codex. The built-in `explorer` is not
offered: it stays removed by the owner's earlier decision.

A later source wins for a same-name profile. Missing description or nicknames can inherit lower metadata;
a declaration without `config_file` retains the lower selected role file. Pi wins over Codex at the same
project directory; nearer project directories win over their ancestors. `agents/` discovery
recurses into `.toml` files. Config files contribute only `[agents.<name>]` role declarations with `config_file`
and role metadata; global auth, transport and limits are not imported. `config_file` is relative to its config.
Within one source, declarations are read before standalone files; duplicate names keep the first.
The extension reads Codex folders without writing to them. The concise catalog in the `agent` description
shows profile names, descriptions, source paths and effective settings, not the full role prompts.

A standalone role file can be used by Codex unchanged:

```toml
name = "reviewer"
description = "Inspect the requested change without modifying files."
model = "gpt-6.1-sol"
model_reasoning_effort = "low"
nickname_candidates = ["Ada", "Lin"]
developer_instructions = "Read the requested sources and return every evidenced defect. Do not modify files."
```

An explicit config declaration can point to that file:

```toml
[agents.reviewer]
description = "Inspect the requested change without modifying files."
config_file = "agents/reviewer.toml"
```

The supported role fields are `name`, `description`, `developer_instructions`, `model`,
`model_reasoning_effort` and `nickname_candidates`. Standalone discovered files require nonempty `name`,
`description` and `developer_instructions`; config declarations can supply the name and description instead.
`developer_instructions` is inline TOML text, never a path for another prompt file. It supplies the default role
after the main system prompt and subagent reminder. `nickname_candidates` must contain distinct nonempty
ASCII names made of letters, digits, spaces, underscores or hyphens. They remain profile metadata and never
supply an automatic title; lifecycle IDs remain `agent#N`.

Codex applies only a fixed set of role overrides (codex-rs `AgentRoleOverrides`); every other key of a role file is
ignored by Codex too, `sandbox_mode` included, because a Codex child inherits its parent's permissions. The same holds
here: other keys, known or unknown to Codex, change nothing and their values are not type checked (Pi has no copy
of the full Codex config schema). Pi has no equal of
six Codex overrides: `model_reasoning_summary`, `model_verbosity`, `personality`, `service_tier`, `features` and
`skills`. They are read and type checked by the Codex schema (enum values, strings, booleans, the known keys of `skills`; unknown keys are accepted as Codex serde does), so a
bad value makes the role unavailable, but they are not applied, and the catalogue line of the role names them after
`not applied:`. They wait for
a public Pi API; no sandbox or tool filtering stands in for them. Malformed TOML and invalid supported role fields
remain errors.

A bare GPT ID, such as `gpt-6.1-sol`, resolves to `openai-codex/gpt-6.1-sol`. Other bare IDs require one exact,
unique match in Pi's model registry; an explicit `provider/id` names that exact model. Missing, ambiguous or
unavailable models fail without a fallback. Effort `none` maps to Pi `off`; `minimal`, `low`, `medium`, `high`,
`xhigh` and `max` keep their names. Unsupported values, including `ultra`, `persistent` and custom efforts, fail.
The selected model must support the requested effort.

A profile's model, effort and instructions are defaults. Explicit `model` and `thinking` override the corresponding
profile defaults. The ordinary `role`, `role_file`, `system` and `system_file` options override the profile's prompt
default, using the same mutual-exclusion and file-validation rules as generic agents. Fields the profile does not
set use ordinary defaults. Task, tools, title, Fast and lifecycle controls stay ordinary agent options.

```js
agent({action: "start", agent_type: "spotty", include: ["user_messages"], task: "<object>...</object>\n<criterion>...</criterion>"})
```

Saved child configuration keeps `profile: { name, path, sha256 }` and the resolved prompt alongside the
model and thinking. `resume` uses that saved version even if the file changed or disappeared. `restart`
re-reads and validates the selected profile before closing the old child; failed validation leaves it intact.
The profile path and SHA identify the bytes loaded for that child, not the latest file contents. Status and
message `details.profile` expose the same provenance; waits expose it under `results[i].display.profile`.

RQW-review is one optional provider: it offers `spotty` and `bossy` and discovers native review skills.
Each reviewer is an ordinary recursive agent; read-only is its role instruction, not tool filtering, a git guard
or a sandbox. Its role forbids spawning agents even though the shared runtime exposes `agent`.
Disabling a provider removes only its offered resources; user profiles remain independent.

## Prompt files and caller messages

General `agent` starts and restarts accept `system_file` or `role_file` instead of the matching inline prompt.
Paths resolve relative to the caller's cwd. A regular UTF-8 file supplies its exact text, including whitespace and a
literal BOM; invalid UTF-8 is rejected. `system_file` replaces the whole prompt; `role_file` supplies the role text
without trimming inside the default prompt's role block. Inline roles keep their existing normalization.
A matching inline and file option are an error, as is mixing any system option with any role option.

Restart keeps the previous prompt choice unless a new one is supplied. An inherited file choice is re-read before
the old child is replaced; a changed file therefore changes the new prompt and hash. Failed file/config validation
leaves the old child intact. Push message `details.prompt_file` and wait `details.results[i].display.prompt_file`
carry the same `{kind: "system" | "role", path, sha256}` provenance: the absolute resolved path and SHA-256 of the
bytes actually loaded, not of a later file version. This is prompt-file provenance, not an F2 run manifest.

`include: ["user_messages"]` on start/restart appends a `<user_messages>` block after the task. It contains verbatim
user-role text from this caller's current session branch, including entries before compaction, in branch order.
Text parts are joined with newlines; images and non-user messages are omitted. A nested caller supplies its own
session's messages, not the root session's. The block is not prefixed to the task, and inclusion is not inherited on
restart. Without a task, restart remains idle.

## Child tools and settings

- `codemode` and `tool_search`: a child gets Pi's own built-in definitions
  (`createCodemodeExtension`, `createToolSearchExtension`) when its caller has them active, as main has them through
  RQW-settings. With an RQW-tools offer, the child's codemode is Pi's definition built from the child's own API and
  passed to the factory as `options.codemode`; the factory returns it with a job of
  the child's registry (after 12 s it goes to the background as a whole script, like main's). Without an offer it is registered exactly as
  Pi's built-in factory does. The offer is asked for during the child's loader reload when it has codemode, otherwise
  right after the reload.
- Profiles: nested callers use the same profile discovery and `agent_type` selection as main. RQW-review offers
  role files through `rqw-agent:profiles`, not another tool or child runtime.
- Settings: every child's in-memory `SettingsManager` copies the caller's effective `shellPath`, `shellCommandPrefix`,
  `images.autoResize` and `images.blockImages`, `retry` (including provider timeout and retries), `transport`,
  `httpIdleTimeoutMs`, `websocketConnectTimeoutMs`, `compaction` (enabled, reserve, kept tokens, per-model
  overrides), `thinkingBudgets`, `steeringMode`, `followUpMode` and `codemode` (mode, inline budget); `childSettings`
  in [index.ts](index.ts). These are the settings Pi's session reads for requests, retries, compaction, queues and
  tools. `cacheWarming` stays off. Not copied: UI and terminal settings, default model/thinking and enabled models
  (the child's model is explicit), default tools (explicit allowlist), packages, extensions, skills, prompts and themes
  (children load no resources), branch summaries (no tree navigation), session storage, sharing and telemetry.
- `job`: an offered set includes RQW-tools' `job` tool and a child-local registry. `jobs.abortAll()` runs on interrupt and `jobs.dispose()` on close. Background jobs survive the caller's Esc and new messages; child interrupt, stop, restart and shutdown end them. Optional `notify` and `retain` hooks bridge notification waits into the child's session. Without them `job wait` blocks. A running file-tool call finishes on its own.

Decision: [DECISIONS.md, Agent](../../DECISIONS.md#agent).

## Recursive lifecycle

Main and every general subagent can call `agent`, even with an empty base-tool subset. Delegation is recursive
without a depth limit or a global child-count limit. Each child chooses its prompt, model,
thinking and base tools through the same `agent` options. The extension registers only `agent`.

The generic `RuntimeHandle` in [coordinator.ts](coordinator.ts) connects the caller-local lifecycle and result broker
to the session runtime in [index.ts](index.ts). Registration takes the direct caller's API explicitly; there is no
global caller session. Completed agents keep their history until `stop` or caller shutdown. After exactly five
finished-idle minutes, an eligible live child releases its SDK session into the same saved-slot restore path.
Parent wait/status interactions rearm the grace period. Both parent metadata and child history must reopen durably;
in-memory or unavailable histories stay awake. The session manager the caller keeps for a sleeping child is released with
its session, so a sleeping child holds no history in memory. A committed outer codemode handoff may intentionally filter its result.
Committed delivery run IDs are appended one per line to `<owning-session-file>.children/delivered`.
Hydration reads these receipts alongside the selected branch, so historical children do not prevent sleep
and filtered results are not delivered again after wake or restart. In-memory sessions skip the receipt file.
Receipt write errors do not block delivery; a result may repeat after wake if its receipt could not be saved.
Running descendants, uncommitted results or notifications, queued messages and retained background jobs block sleep.
Delivery/queue settlement rechecks overdue children without polling. Sleep is not stop: send, explicit resume and
exact status restore the same file, history, caller-local ID and session ID. No lifecycle state or metadata format is
added. Disposal can release provider sockets/continuations; ordinary cache expiry and reconnect still apply.
Idle retained sessions do not keep the parent assignment pending. Each `start` is clean; explicit `send` reuses history,
and `resume` retries an interrupted or failed provider request without adding a message. Send pays its input tokens and may
trigger Pi compaction or a new cache write after expiry. There is no child-count cap. Caller shutdown aborts
and disposes live sessions while preserving durable child histories and recovery metadata for persisted parents.
Caller Esc leaves accepted agents running and keeps late answers without waking the aborted caller; see
[Results and main abort](#results-and-main-abort).

A subagent's native run can settle while its descendants are pending. Their messages wake it normally; its parent
keeps the logical assignment open across those wakeups. Answers from native runs ending with pending descendants
or unconsumed descendant results are intermediate and are not delivered to the parent. The parent gets the answer
after no descendants/results remain pending. `stop`, `restart` and parent shutdown close that subagent's descendants
and discard their late results. `interrupt` aborts pending descendants and drops their results without closing their
runtimes; a later `send` can start fresh agents in the same subagent. Queued/preflight calls are canceled too, and
issued ids stay reserved.

Session state and delivery remain caller-local.
There is no child-specific execution, turn, token, output-growth or wall-clock limit; provider limits and explicit
management cancellation still apply. Wait timeout limits the caller's pause, never the child's lifetime.

## Background progress notifications

After 50 non-final assistant responses containing at least one `toolCall`, a child starts one background progress
summary from its own cached context. Counting happens at `message_end`, before the tools finish: one response is
one step, regardless of how many tools or nested codemode calls it contains. Text-only responses and terminal
`stop`, `error`, `length` or `aborted` responses do not count. Only a successful parent `send` or delivered progress
report resets the counter. `status` and `wait` do not. `progressSteps` lives in the existing `rqw-agent-child`
metadata and survives Pi restart and explicit resume; there is no additional state file.

The model supplies summary prose only. Counting, triggering, cancellation, stale-report rejection and delivery are
code-owned. The child never waits for the summary and receives no report instruction, summary message or extra
session entry. The fork preserves the previous complete provider request's prompt, tools and conversation, then
appends a text-only summary instruction and the latest response's tool intent. Pending tool calls are described as
text, not sent as unmatched tool-call messages. Session hooks are not replayed. No fork tool is executed.

The direct parent receives a notification from the notification mechanism, not an answer from the child:
`customType: "agent_progress"`, beginning `[notification] agent#N has worked 50 tool-call steps without communication.`
It includes the summary and says the agent continues working. Fixed code text and the embedded skill both ask:
"Check whether this child has drifted outside its task and still follows the plan in its brief. Decide whether to send
a correction." The parent decides whether to send anything. This notice neither completes a wait nor claims or
publishes a final result. Nested agents notify only their direct parent through its durable `rqw-agent-inbox` bridge.
Busy-parent notices use the existing context-only delivery and settlement continuation, outside the clearable
follow-up queue. Caller abort preserves the notice without automatically waking the aborted caller.

`resources_discover` offers [agent-progress](skills/agent-progress/SKILL.md). The notification also embeds that actual
short skill text because child parents use `noSkills: true`. Its reminder covers only agreed scope, simple engineering
and no avoidable token spending. It asks for no reviewer, separate model turn, child instructions or mandatory
repository-specific manifesto path. Decision and owner source: `D-AGENT-PROGRESS` in
[DECISIONS.md, Agent](../../DECISIONS.md#agent).

### Provider fork offer

`progress.ts` emits the shared public `pi.events` request `rqw:context-fork:v1`:

```ts
{
  sessionId: string,
  model: Model<Api>,
  context: Context,
  reasoning?: ThinkingLevel,
  signal: AbortSignal,
  offer(infer: () => Promise<AssistantMessage>): void
}
```

A provider offers synchronously, capturing independent cloned cache state before the child's next request advances
it; inference runs asynchronously. The request's context is a cloned snapshot, not a live session object. The provider
owns its inherited request timeout and cancellation. Without an offer there is no unsafe fresh-request fallback.
Errors, provider timeouts or unavailable cache do not affect the child or trigger a per-turn retry loop: another
attempt can start only at the next 50-step boundary. No new setting, timer, execution limit or retry is added.

Parent send, final response, failure, interrupt, stop, restart or shutdown invalidates an in-flight or queued report;
it can be delivered before a final answer, never after it. Compaction and model selection also invalidate the snapshot
but preserve the counter. Later qualifying responses reach the next 50-step boundary normally. Ongoing ordinary
turns do not invalidate an in-flight report. Provider failures and stale results never change final-result ownership.

## Main-chat progress cards

Only the top-level TUI caller also registers [main-progress.ts](main-progress.ts). Every 50 assistant responses with
`stopReason: "toolUse"` and at least one tool call, without an assistant text update, start an independent summary.
Parallel calls and codemode's nested calls count as one response. Any nonblank assistant text, including streamed
text and text beside a tool call, resets the next counter. Owner input, job/child notifications, model selection and
compaction do not reset it. A reached summary survives later text, a final answer and ordinary `agent_end`; only
abort, session switch and shutdown cancel it. Slow requests can coexist and finish out of order. There is no timer,
queue, replacement of earlier summaries or automatic retry between the next 50-step boundaries.

The snapshot is taken at `message_end`, before its tools run. It contains the last 65 tool-call responses, or fewer
when unavailable; the first two normal windows are 1–50 and 36–100. Current calls are `running`, not unmatched wire
tool calls. Completed results are matched by call ID; running background jobs stay `running`. Bounded argument and
output excerpts, omission counts and truncation markers keep the JSON input within 64 KiB and the model's input
budget. Full outputs and the whole branch are never cloned or serialized. One parent-link walk from `getLeafEntry`
through `getEntry(parentId)` runs at each reached threshold and on resume, never in a render frame. It stops at 65
responses or the root, with no entry cap: O(k) visited entries and O(1) lookups, not O(65) entries on a sparse branch.

An invisible `rqw-main-progress-counter-v1` custom entry every 50 tool-call responses stores `stepOrdinal`,
`silentCount` and `sourceToolCallId`. Resume validates the persisted source response and applies only records after
that source, not the source twice. It does not start old requests again. A crash before the source response was saved
cannot advance the recovered count. A new session starts separately; child progress semantics are unchanged.

The request uses public `ctx.modelRegistry.streamSimple`, the response's physical model and actual effort, with a
separate abort signal and no main `sessionId`, hooks, tools or history. Codex uses its direct transport; Anthropic uses
its registered subscription transport. This is a small standalone request, not the child's full cache fork. Native
thinking/output limits and provider auth recovery remain intact. It spends extra subscription tokens; no cache hit
is promised. Failures, invalid summaries and persistence errors are silent and never create error cards.

The model returns one or two lowercase Russian paragraphs, up to four sentences each and seven words per sentence.
Code validates this structured JSON, rejects control characters and unsafe sentence shapes, and renders each main
sentence in bold as plain terminal text. `Progress update` and its step range are English. Gold label, muted range,
steel left border and a theme-native card background distinguish it from an assistant answer. Expanded output keeps
the same full card. It never changes editor state or injects a turn.

`pi.appendEntry("rqw-main-progress-v1", ...)` plus `registerEntryRenderer` persist and render the card. Native `custom`
entries never project to model messages, including compaction. Existing RQW-blocks history replays them on resume,
`/reload` and compaction, loading older intervals lazily; no replay path or runtime patch is added here. Without
RQW-blocks, stock Pi hides entries before its kept range, but their JSONL records remain. Without RQW-agent the renderer
is absent and records remain intact. The existing worked-for fold rules are unchanged: cards can fold with the work,
not act as always-visible boundaries. Cards delivered after a final answer remain at their delivery position.

No automatic generation in print, JSON or RPC. Tests fake Pi and the model registry through the registration entry:
`test/extensions/RQW-agent/main-progress.test.ts`. Decision: `[D-MAIN-PROGRESS]` in [DECISIONS.md](../../DECISIONS.md#agent).

## GPT Fast

A child agent inherits its caller's GPT Fast state when it starts; a nested child
inherits from its direct caller. The state is answered by RQW-settings over `pi.events` (`rqw-settings:fast-gpt-query`);
without it children stay on the standard tier. The optional boolean `fast_gpt` is accepted by `agent` on `start`,
`send` and `restart` (`false` when the user forbids Fast for subagents). On `start` it replaces the inherited state. On
`send` it changes the child's state for its next requests and stays; on `restart` it is used by the new session. Without
`fast_gpt`, `send` keeps the child's state and `restart` carries the old state over; the child's own agents follow its
state. `fast-gpt.ts` sets `service_tier: "priority"` on the child's openai-codex requests
through `before_provider_request`; Anthropic requests are untouched. Default, rule and quotes:
[DECISIONS.md, Settings](../../DECISIONS.md#settings).

## Wait, status and management

`agent` accepts `wait`, `status`, `send`, `resume`, `interrupt`, `stop` and `restart`.
Management `id` accepts an `agent#N` ID or its numeric string. `wait`/`status`
accept nonempty `ids` of fully qualified direct agent IDs. Management targets remain direct
children only; `status depth` adds read-only descendant visibility, not access to manage grandchildren or siblings.

```js
agent({action: "wait", ids: ["agent#1", "agent#2"], timeout_ms: 90000})
agent({action: "status", ids: ["agent#1"], messages: 8})
agent({action: "send", id: "agent#1", task: "Fix the reported assertion only"})
agent({action: "stop", id: "agent#2"})
```

Work in parallel when useful. When blocked, estimate remaining duration and choose `timeout_ms` somewhat longer on
**each** wait; 300000 ms is only the omission/null default, not a periodic requirement or maximum. A positive finite
safe integer is required; large waits use monotonic deadlines and platform-safe timer chunks. Timeout never stops a
child. Re-estimate and wait again, or inspect status before deciding management. No busy polling, model turn or network
request comes from the timer; children continue their own work/tokens. No new execution limits/watchdogs are added.

### Notification waits

Where the caller can receive notifications (TUI, RPC, a nested subagent, an offered job registry), `wait` does not
hold the call by default. It registers its subscription and takes a snapshot in one synchronous step. A result that is
ready now returns at once as before. Otherwise it returns `reason: "waiting"` with the statuses and `terminate: true`,
so the caller's turn ends with no further model request. The one later notification (the first or all selected results,
an alert, or the `timeout_ms` deadline) is delivered once through the existing broker as the usual `[agent#N]` message and
wakes an idle caller; a busy caller gets it at its settlement boundary. No model request, timer poll or network request
is made merely to wait. The notification is a `child_wait` message. While the parent is busy, Pi retains it outside
its clearable steering/follow-up queues and persists it at turn end, including after Esc. A successful busy run
continues once to read it; an aborted run leaves the persisted text for the next owner turn without waking itself.
A repeated wait returns only a receipt for that retained delivery, not another copy.
A persisted child that waits for its own children keeps it as an `rqw-agent-inbox` entry of its own session, acknowledged by that persisted message and not by a clearable steering queue. Owner messages, Esc and send-now reach the caller without cancelling accepted children.
A wait inside a codemode script stays blocking because the outer script owns its result. The blocking fallback for print and json is only
for external hosts: a root session that Pi itself runs in print or json mode ends with its run, so no notification can wake
it. An in-process child agent whose offered factory got the `notify`/`retain` bridge gets notifications whatever mode its SDK
reports, print included. A caller without a `notify` callback keeps the blocking wait. A new wait on the same targets replaces the older notification, so a result is never
announced twice. `job wait` of RQW-tools follows the same rule through the same callback; see
[DECISIONS.md, Tools](../../DECISIONS.md#tools). Decision: `[D-AGENT-NOTIFY]` in [Agent](../../DECISIONS.md#agent).

`wait` accepts `until: "first" | "all"`, default `"first"`. The default returns the first selected completion and
any other already-ready results, including terminal errors. `"all"` holds early completions until every selected
target has a result, a delivery receipt, or is inactive. It reserves those results for wait delivery only when the
whole selection is ready. An alert, timeout or caller abort releases held completions to the message path without
consuming them in the wait. Already-delivered answers remain receipts, not copies.
`wake_on_alert` defaults to `true`: an alert created on a selected child after this wait registered returns early
with `reason: "alert"` and statuses, without consuming results. Old alerts do not repeatedly wake later waits.
Set `wake_on_alert: false` to wait for the selected completion condition or deadline instead.

The tool returns text JSON mirrored in `details` (no outputSchema): `reason`, `timed_out`, `results`, `receipts`,
`statuses`; `target_changed` also identifies the old run/change. `timeout` returns every selected status without consuming
a future result. `idle` returns immediately if no selected run/result exists. Unknown/closed IDs are explicit status
errors. Interrupt/stop/restart wake old waits; they never silently follow replacements. Management registration is
ordered, but the wait Promise does not hold that queue.

Results have caller-local ID, epoch/run identity and a UUID delivery. A broker reserves a result for one waiter or
commits it to the usual push message. Repeated/competing waits receive receipts (`delivered_via`, `claimed_by`), not
second copies. Pending settlement messages can still be claimed; an already submitted Pi message cannot be recalled.
A wait handoff commits only with a successful finalized persisted toolResult. Failed hooks, abort or an outer codemode
error before saved handoff return the reservation to the message path. Nested ownership uses actual `parentToolCallId`
events, not ID parsing or the bounded nestedCalls log. A successful script deliberately filtering its result owns that
choice. In codemode use `text(result)` or return the result to read its JSON.

`status` is a local snapshot, without invoking the child model or consuming a result. `depth` defaults to 0 and
must be a nonnegative safe integer. Positive depth adds compact read-only snapshots of descendants under `children`,
one generation per depth step. Descendant snapshots carry caller-local IDs nested under their parent and omit
message previews; they do not grant management access. For selected direct children, `messages` defaults to 8,
validated from 5 to 10: chronological role/time/tool IDs, trimmed head/tail previews, image/binary metadata only,
thinking presence/size rather than raw reasoning, plus unfinished assistant/tool data. State distinguishes native
running/preflight/model/retry/compaction, streaming tool arguments, running tools and idle; `pending_children` explains
a native-idle subagent still awaiting descendants. Elapsed/idle/activity ages are monotonic. Diagnostics preserve parallel
call IDs, previews, argument byte growth, last updates and repetition suspicions (not stall verdicts). Known session
token totals/run deltas and explicitly incomplete live usage are not token estimates derived from bytes. Final core-mode
settlement also completes usage; a response without reported token usage keeps `usage_complete: false`. Preview budgets
(1200 characters/message, 12000/ID) limit representation only, never execution/history.

`agent` supports these wait/status options and `alert_after_ms` on start/restart. Status `alerts` contains
`{kind, at, detail}` items with an ISO timestamp and trimmed diagnostic text. `activity.ts` keeps the latest 32 for
presentation only and resets the history on a new logical run; the alert version remains monotonic for wait wakeups.
Kinds are `error`, `repetition`, `long_turn` and `schema_rejection_repeated`.

`error` reports provider/runtime failures and truncation. `repetition` reports the existing identical-call or live
argument-fragment suspicion, not a proven loop. `alert_after_ms` is an optional positive finite safe integer,
disabled by default and inherited on restart. It emits `long_turn` once for a native turn exceeding the threshold,
never stops a child and does not time a native-idle parent awaiting descendants. Turn end, logical run end and
close cancel the alert timer; no alert timers remain running while idle.

`schema_rejection_repeated` reports the second matching detectable Pi 1.4 argument parsing/schema rejection.
Detection requires an error event without `durationMs` and the exact Pi diagnostic prefix
`Validation failed for tool "<name>":` or `Invalid arguments for tool "<name>": `.
Schema diagnostics are compared before the `Received arguments` section, so different rejected arguments can share
the same validation error. Arbitrary tool failures and semantic answer judgments do not count.
No `stalled_tool` alert is implemented.

`send` to a running child is Pi steering (`session.steer`): the message reaches the child after its current tool call
(Pi runs all calls of the current assistant turn first), before its next model request, and aborts nothing; a message
sent before the child's first request goes into that request. To an idle child `send` starts a new run with its
history. A child whose native run has ended and that only waits for its own pending agents gets the message at
once (reply `: sent`, a new run starts; the descendant result still arrives once). A child parked in its own `wait` tool
call gets it after that call returns. `send` with `interrupt: true` redirects a running child in one call: it drops the child's queued steering and
follow-ups and aborts the current turn exactly like `interrupt` (session and history kept, pending descendants aborted),
then returns at once with `<name>#N: interrupted, sent`, without waiting. The task is recorded as the child's next
run and starts automatically, once, as soon as the old run has stopped; there is no time limit, so a tool that
ignores the abort signal simply delays the start, and `status` shows `cancellation_requested` and `pending_sends`.
Until the start the child counts as running: a `wait` on it is never `idle` and ends with `target_changed` when the
new run begins; a native run that a descendant result had woken is waited out first, so the new prompt never collides with it.
A further `send` before the start is appended after it, in order, and all pending tasks go in one prompt joined by
blank lines. A later `interrupt`, `stop` or `restart` drops them. On an idle child the flag makes a plain `send`.
Without the flag nothing changes. Use plain `interrupt` only to cancel. Decision: [DECISIONS.md, Agent](../../DECISIONS.md#agent).

`interrupt` returns the pre-interrupt snapshot and `interruption_requested`: it requests abort, clears queued steering and follow-ups and
preserves history. Cancellation may still be pending: a plain send is rejected until settlement (`send` with `interrupt: true` is accepted and queued). `stop` closes and forgets the
ID. `restart` fences the old generation and creates a fresh session with the same external ID; without task it is idle,
not a replay. An in-process tool may ignore AbortSignal and still have
side effects; controls do not wait indefinitely for it. No transaction or forced JavaScript kill is promised. Inspect
files/commands before retrying. Reload/resume restores owned durable child histories as described below; it does
not restore operating-system processes.

## Prompt cache

Child Anthropic Messages requests carry the built-in `cacheRetention: "short"` policy (5m), independently of
RQW-anthropic and user config. Cache markers stay enabled; background warming is off. The existing stream guard
applies the option before RQW-anthropic can supply its generic OAuth 1h fallback. Other APIs are unchanged.
Policy and approval: [DECISIONS.md, Agent](../../DECISIONS.md#agent).

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

Every delivered final result ends with Cursor's completion follow-up (`FOLLOW_UP` in [prompt.ts](prompt.ts)): "Perform
any necessary follow-up actions in response to the subagent completion above. If no follow-up work is needed, no further
action is required. Don't repeat the same confirmation every time." It follows a blank line after the result text in the
pushed `[agent#N]` message content, in each `results[].text` of a `wait` result and in each `results[].text` of a
completed `child_wait` notification. A `waiting` receipt, an already-delivered receipt, the timeout `child_wait` and
`agent_progress` notices carry none. The result cards hide this follow-up paragraph, so a collapsed card shows the real end of the answer.

An external print/json host uses one caller-wide non-consuming fallback wait at `agent_end`, not serial waits per child.
It is bounded by the omitted default `timeout_ms` (300000); completion follows normal message continuation, and a timeout
adds compact status so the caller can decide. A native-idle subagent that only waits for its own agents is not bounded
that way: it parks on its active runs by their completion events with no implicit timeout, and a descendant result wakes it
through the normal message path. Only when no run is active does it use the bounded wait, and it never forwards an
intermediate timeout as its final answer to main. Explicit wait takes priority. TUI/RPC idle callers keep normal push wakeups.
Caller abort ends only its wait, leaving accepted children running; late results do not wake the aborted caller.
`agent_before_settle` checks continuation and late-result flow.

TUI Esc and RPC abort latch the main session as aborted through `agent_settled`. A child that finishes **after** that
abort is appended without waking the main model. The next main run clears the latch and sees the saved result once.
Ordinary idle delivery after a new main run still wakes the model.

## IDs and history

Every issued positive safe integer is immediately persisted with `pi.appendEntry('agent', { id })`, before creating the
child. This also covers calls nested in codemode, which have no outer `agent` tool-result entry, and failed/canceled starts.
Reload/resume/fork reads this metadata plus compatible legacy owned outer prefixes: `[agent#N]` custom results and
`agent#N started`, `restarted`, `stopped`, `interrupted`, `is idle`, `: sent`, `: queued after the current run` (older) or `: queued after the current tool call` tool results.
Numbers mentioned inside result bodies or errors do not allocate ids. Unsafe integers are ignored. At
`Number.MAX_SAFE_INTEGER` allocation fails before another child is constructed. A live map entry cannot be overwritten
by a rounded duplicate id.

## Persistence and resume

A persisted caller owns child Pi JSONL files in the exact adjacent directory
`<parent.jsonl>.children/agent-N/`. Descendants recursively use the same layout.
In-memory callers keep in-memory children. Children do not appear as unrelated top-level session files.
Durability applies only to children created after the updated extension is loaded: a child started by the earlier
in-memory build has no saved history and cannot be recovered retroactively, and a running Pi must be reloaded before its
new agents are saved.
Versioned `rqw-agent-child` entries in the parent's selected branch store the local id, generation, child file,
run state, exact prompt/configuration, model, thinking, tools, settings, Fast, title and selected profile provenance
`{name, path, sha256}`. The prompt/configuration and task are written once and again only when their text changes.
Restore remembers the text of the saved record, so a restore or a resume without changes writes no new copy; later entries are short and restore takes the omitted fields from the previous entry of the same child.
An ordinary prompt starts with the saved `base`: the record keeps only the text after it as `system_tail`, and
restore joins the trimmed `base` and the tail. An own `system` and records written earlier keep the whole `system` and are read as before.
The `base` text itself is written once per branch as an `rqw-agent-base` entry `{version: 1, ref, text}`; a record keeps only
`base_ref`, the first 16 hex characters of the text's SHA-256. Records written earlier keep `base` inline and are read as before.
Every command a child accepts (a steering `send`, a `send` while a run stops, an idle `send`) is saved in its record as
`pending_sends`, batches `{n, tasks}`, until its user message is in the child's history. Only parent commands create user
messages, so `n`, the ordinal of that user message, tells whether a batch has arrived. Tasks queued while a run stops
become one batch, as they become one message. `interrupt`, `stop` and `restart` clear the list by writing a record.
On resume the batches whose `n` is not yet in the history are sent once, in order, whatever the last request was; the
first one as the next prompt, the others as steering. A batch already in the history is never sent again.

A notification wait is saved in the parent session as an `rqw-agent-wait` entry when it is created, so a crash after its
tool result is saved but before the turn ends loses nothing; a restore raises it only if the tool result of its `call` is
saved without error. The entry holds `wait_id`, `call`, the targets with their run, `until`, `wake_on_alert` and `deadline_at`, a wall-clock time in
milliseconds. Replacing it by a wait on the same targets and canceling it write a closing entry `{wait_id, open: false}`;
sending its `child_wait` writes it only once that message is seen persisted, so a crash before that re-raises the wait. An ordinary shutdown writes no closing entry either: the accepted waits are restored with the reopened session. Blocking waits, such as inside codemode, are not saved. If the opening entry cannot be written, the `wait` call fails instead of being accepted. A wait that replaces another saves its own opening entry first and closes the old one only after that; if the closing entry
cannot be written, the new `wait` call fails and the old wait stays accepted. Canceling a wait works the same way: a failed closing write keeps the wait accepted. The closing entry of a
replacement names the replacing wait (`replaced_by`); if a restore drops that one for lack of a saved tool result, the old wait is restored.
When the parent's children are restored, every wait still open (no closing entry and no `child_wait` with its
`wait_id`, whether a message of the session or an entry of a nested caller's durable inbox) is raised first, before the saved answers are published, with the same `wait_id`, targets, options and the rest of
its deadline; a past deadline gives a `timeout` `child_wait` at once. Such a wait follows only the run that continues an
interrupted child after the crash (a run that starts as crash recovery writes the run it continues, `recovers`, into the child's record in the same entry, so a
restored wait follows it even when the crash came before the wait's own saved run changed, also for a recovery that finished and is restored as a saved slot; any other run change gives `target_changed`); `interrupt`, `stop` and `restart` wake it as before, and any other change of run ends it with
`target_changed`. A child waiting for its recovery counts as active for this wait, and `interrupt` on it pauses it and wakes the wait.
The saved answers are registered before the restored waits judge their targets, and a wait that follows a continuing run is saved
again with that run, so a second crash restores it too.

A final answer is saved in the child's record, with its `delivery` id, before it is delivered; the saved answer is the outbox.
After a restore its message carries that same id, not a new one. Records and receipts written earlier have no id and are read as before.
A child record from before `pending_sends` and `history` has only its saved task: it counts as one pending batch, sent when the history has no user message.
A `wait` inside a codemode script may let the script filter the answer, and the delivery receipt is written only later. So when
that wait call ends, an `rqw-agent-accept` entry saves the call, the script's call, the outcome of the wait and the runs and
delivery ids it took. After a restore those answers count as delivered only if the wait succeeded and the script's own tool
result is saved without error; a wait error the script caught sends the answer again.
Completed durable children remain saved slots during parent hydration and `wait`; neither opens their histories or
constructs SDK sessions. Wait snapshots for these slots report saved identity, model, title and idle state, without
inventing live diagnostics. `send` opens only its target with the original history, configuration and session identity.
`status` materializes selected slots where exact previews, token totals or descendant diagnostics require the runtime;
this is the exact-status fallback, not a summary substitute. Unfinished recovery remains eager, and already live
completed children are reused. Concurrent restoration shares a per-generation promise; branch cancellation fences
late construction. Saved answers still use the existing exactly-once delivery broker. No metadata format is added.

Resume retains the saved resolved prompt and profile version, except the subagent reminder: when a child is restored
from disk or resumed, `withCurrentReminder` in [prompt.ts](prompt.ts) rebuilds its saved `system`. Either of the two exact legacy
reminder blocks is replaced in place by the current `SUBAGENT_REMINDER`, a prompt with
neither old nor current block gets the current one appended after a blank line, and a prompt that already has it is unchanged. The
rest of the text, including a `<role>` block, stays byte for byte, and the rebuilt text is written back to the saved
configuration at the next persist. Cost: the system prompt prefix changes once, so the first request of each restored
or resumed child is a one-time provider prompt cache miss. Restart reloads its TOML. Restoring the parent makes
the same caller-local ids available. Stopped mappings are tombstoned; restart creates a new history rather than
resurrecting the old generation. Old child files remain inside the owned tree until parent removal.
Persisted entries with unknown child kinds are ignored without deleting their history files.

`agent({action:"resume", id:"agent#1"})` retries an interrupted request or a last request that failed with a
network/provider error, from saved history without a new task message. The caller explicitly chooses to retry after
seeing the failure; this adds no automatic retry loop. Failed requests stay idle on parent continuation and
`/resume-agents`; only the explicit `resume` action retries them.
Active or cancellation-pending children cannot be resumed;
successfully completed children stay idle and require `send` for a new task. A child paused by hand with `interrupt` gets a durable
`paused` state with its reason. It stays paused after reload, session switch and Pi restart until an explicit `resume` or
`/resume-agents`. The parent's continuation restores only unfinished children that were active or interrupted by a shutdown, and a paused child that still has an accepted command to send.
A fork or clone copies the parent transcript but not the children's files: it does not claim the original `.children` tree,
so a saved child entry that points into another session's tree is unavailable with a clear diagnostic. That never blocks a new
`agent` start or the main chat, and one broken or lost child never blocks the recovery of the others. Children are not
copied on fork. `/resume-agents` resumes unfinished children
without calling the main model first. Their final result wakes the main chat normally. Continuing a restored
parent mechanically recovers its unfinished children; merely opening an old session does not start work.

Recovery keeps completed tool results and fills missing results with an explicit interrupted/error result warning that
side effects may already exist. It omits only a failed assistant attempt through append-only context edits.
No old tool call is automatically executed again. The model decides whether another action is safe after seeing
the interrupted result. Recovery is fail-closed: a missing or empty JSONL of an established or unknown history is a `recovery_error` of that
child alone, never a new history. Only a saved state of `idle`, `runNumber` 0 and no task, as a task-less `restart` writes
it, may restore an empty retained or new session under the same id, with no task message. The saved task and configuration are provenance only and are never turned into a task
message, a rebuilt history or an inferred transcript. Pi writes a child's file with its first user message. A record
keeps `history`: false until a persist sees that message (a record without the field counts as true). When the process
ended while it was false and the file is absent, restore opens a new empty session and sends the accepted task from
`pending_sends`, so one task arrives. With `history` true a missing file stays a `recovery_error`. The other children are
still recovered.

Pi 1.4.0 exposes no `AgentSession.continue`. Resume reconstructs a child session, uses public `agent.continue()`
and owns its core-run busy, abort, idle and settlement fences. Prompt/provider hooks still apply. This path does
not inherit Session's post-run automatic retry and overflow-recovery loop; errors are delivered for an explicit
retry instead. Persisted settings and ordinary threshold compaction remain available. Session files are appended
synchronously without fsync: this is restart recovery, not a power-loss or external-effect transaction guarantee.
Operating-system jobs are not restored after the Pi process ends. Disabling RQW-agent leaves the saved files intact;
RQW-session `/cleanup` independently removes child trees whose parent session file is gone.

## Offline proof

Tests: `test/extensions/RQW-agent/unit.test.ts`.

Native Windows/Linux and real provider transports are not exercised by a local macOS run. Pi's separate compaction summarizer retains Pi's own
system prompt; exact caller `system` applies to task requests. Bare SDK `session.dispose()` does not emit lifecycle
shutdown: hosts must emit `session_shutdown` or use Pi's runtime lifecycle. Persisted parents keep child histories
and local ids across restart; in-memory parents do not. Accepted process-sharing limits are unchanged.

**Session switch.** While any child runs, `session_before_switch` (`/new`, `/resume`) and `session_before_fork` (`/fork`) are cancelled with the notice
«дождись сабагентов», because the replacement shuts the session down and aborts the children. After they end the switch or fork works.
A finished but undelivered result does not block it. Test: `test/extensions/RQW-agent/unit.test.ts`.

## Display metadata and running-count offer

Delivered custom messages keep their original content byte-for-byte. Their `details` add
`{ id, outcome: "finished" | "failed", model?, thinking?, seconds }` beside `delivery` and `run`.
`model` is the last assistant response's actual `provider/id`, omitted before any assistant response;
`thinking` is the selected level when known. Runtime is monotonic, rounded to 0.1 seconds.
Final errors, aborts and truncation are failed; a recovered retry is finished. Answer text, including
an `error:` prefix, does not mark a run as failed. Quiet cancellation still suppresses delivery as before. These fields do not change execution, steering or delivery ownership.

For wait, the same metadata is at `result.details.results[i].display`. The existing result item's
`outcome` remains `completed`/`error`, and the entire original wait `content` is unchanged. Consumers
must read display metadata from details, not parse it from the model-visible JSON text. A receipt is
not another delivered answer and adds no duplicate tool-use count.

<a id="contract-for-p6"></a>

### Running-count contract: `pi.events`, version 1

The anchor `#contract-for-p6` is a stable alias of this section for existing references. No cross-extension imports are
needed. The consumer is RQW-statusbar (`activity.ts`, `CountsWatch`), which spells the
channel names itself. Each enabled producer offers one **source object per session
lifetime**. RQW-agent owns agent counts, including nested agents and reviewer-profile agents.
RQW-review produces no separate review counts. RQW-tools independently offers Main's actual background jobs
as `backgroundProcesses`; child jobs are represented by their owning agent, not counted again as Main jobs.

- Listen on `rqw:running-counts:offer` for `{ version: 1, source }` **before** requesting existing sources.
- Emit `rqw:running-counts:request` with `{ version: 1, reply(source) }`. Every live producer replies
  synchronously. This handshake supports either extension load order.
- Deduplicate sources by object identity. Each source has `version: 1`, `snapshot()`,
  `subscribe(listener)` and `dispose()`.
- RQW-agent's `snapshot()` returns a fresh `{ agents: number, reviews: number }`, with `reviews: 0`.
  RQW-tools offers `{ agents: 0, backgroundProcesses: number }` through an independent v1 source.
  Sum snapshots of distinct live sources by kind. The consumer accepts optional `backgroundProcesses`,
  treating its absence in older v1 sources as zero. Missing/disabled producers contribute zero.
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

An agent counts once when it has an active logical assignment (`a.run`), pending sends or native activity.
A native-idle child waiting for its own jobs or children still counts. Counts recurse through the existing
runtime ownership tree, so a waiting parent and its active descendant each count once. Completed undelivered
results count zero; genuinely idle or AFK agents with no pending assignment do not linger.
Reviewer profiles count as ordinary agents; the compatibility `reviews` field is zero for this producer.
This counts producer adds no timer, card or second child registry.
The waiting categories and idle distinction follow [D-STATUSBAR-WAITS](../../DECISIONS.md#status-bar).
Reason: expose real background activity without coupling independently switchable extensions or changing
execution/delivery. Carriers: `activity.ts`, `index.ts`, `coordinator.ts` and `counts.ts`.
Public Pi 1.4.0 seams: root-exported `EventBus`/`createEventBus`, `pi.events.emit/on`,
`AgentSession.subscribe`, `AgentSession.thinkingLevel`, and `session_start`/`session_shutdown`.
No Pi patch, private-field access or method replacement is introduced by this producer work.
