# Agent lifecycle and audit fixes

The public `agent` description, parameters, task/system text, model choice, thinking and six-tool defaults are unchanged.
This extension imports no other RQW extension. Optional RQW-tools definitions still come exclusively from a fresh
`rqw-tools:subagent-tools` factory offer on `pi.events`; with no offer, Pi supplies stock tools.

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
main cancellation during text/JSON waiting, late-after-abort RPC, and actual builtin codemode nested ids. SDK regressions
cover auth/queue/loader/factory/creation/preflight cancellation, failed replacement, unrecovered length/summary failure,
safe ids, reload, shutdown and TUI/RPC late-after-abort. The original tests are unchanged, including successful retry,
compaction, settings inheritance, exact system prompt and optional-tools integration.

SDK TUI-mode Esc proof exercises `clearQueue()` plus `abort()`, not a keyboard/renderer test. Native Windows/Linux and
real provider transports are not exercised by a local macOS run. Pi's separate compaction summarizer retains Pi's own
system prompt; exact caller `system` applies to task requests. Bare SDK `session.dispose()` does not emit lifecycle
shutdown: hosts must emit `session_shutdown` or use Pi's runtime lifecycle. Child sessions remain in-memory; reload
restores issued ids, not child sessions. Accepted process-sharing and end-of-session delivery limits are unchanged.
