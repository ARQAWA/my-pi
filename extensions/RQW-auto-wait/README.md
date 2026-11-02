# RQW-auto-wait

Independent main-chat automatic waiting for direct agents and main background jobs. After the current turn settles, live work gets one context-free wait card. Final results from available sources are collected into one hidden custom message and start one model turn. No polling or timer is used. Explicit `agent wait` and `job wait` remain available.

Input closes the card without stopping work. An input accepted before a result claim runs first. During an auto-wake run, a prompt without a streaming behavior is queued as a normal follow-up. A narrow `AgentSession.prompt` runtime patch is checked against Pi 1.4.0 and restored on shutdown. An incompatible shape disables auto-wake and leaves native input and explicit waits unchanged.

Claims commit only after the custom message appears in the selected branch. Failed preflight and branch changes release claims. Historical unclosed cards are shown as interrupted, without restarting work. Background process results are not recovered after the process exits. Durable agent receipts remain best effort across a crash.

Sources are optional and communicate over `pi.events`; the extension imports no other extension. Disable it independently in `pi config`.
