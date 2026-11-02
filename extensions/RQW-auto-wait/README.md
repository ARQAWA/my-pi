# RQW-auto-wait

Independent automatic delivery of results of direct agents and background jobs. It is the only way a result arrives: the `agent` and `job` tools have no `wait` action (`[D-AUTO-WAIT-EVERYWHERE]`). After the current turn settles, live work gets one context-free wait card. Final results from available sources are collected into one hidden custom message and start one model turn. No polling or timer is used. Switched off by hand, it leaves results to `status` only. The settled turn's final answer stays visible; intermediate work follows the normal worked-for fold.

Input closes the card without stopping work. An input accepted before a result claim runs first. During an auto-wake run, a prompt without a streaming behavior is queued as a normal follow-up. A narrow `AgentSession.prompt` runtime patch is checked against Pi 1.4.0 and restored on shutdown. An incompatible shape disables auto-wake and leaves native input unchanged.

Modes. tui and rpc deliver when Pi is idle; rpc draws no card, so a client can write while the agents run. Print and json exit when the turn settles, so the extension holds the `agent_before_settle` boundary while direct agents or jobs live. Ready results are added as one hidden message in that same run and the turn continues; waiting uses the source subscriptions, with no timer or polling. The hold ends on `session_shutdown`, `rqw:stop-background:v1`, a session or tree change, or `AgentSession.abort` (a narrow runtime patch with a shape check, restored on shutdown). An incompatible shape disables the hold and leaves stock behavior. A boundary that another handler already continues does not start a hold.

Claims commit only after the custom message appears in the selected branch. Failed preflight and branch changes release claims. Historical unclosed cards are shown as interrupted, without restarting work. Background process results are not recovered after the process exits. Durable agent receipts remain best effort across a crash; after a restart RQW-agent redelivers what was ready and reports an id that is gone as `lost`.

A subagent takes results from the same kinds of source in its own loop (RQW-agent `background.ts`), so a child's final answer reaches its parent only when nothing it started is still running.

Sources are optional and communicate over `pi.events`; the extension imports no other extension. Disable it independently in `pi config`.
