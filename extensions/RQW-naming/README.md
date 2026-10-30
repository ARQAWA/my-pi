# RQW-naming

Independent native session naming for stock Pi 1.4.0. No Pi patches, wrappers,
private fields, cross-extension imports, settings changes, or display components.
Registered in `package.json` under `pi.extensions`, so normal package loading
enables it. Switch it independently through Pi's package filter and `/reload`.
Native `/name` remains unchanged.

## Behavior

- Generate in the background once after the first user message, and after every
  successful compaction. Reloading/resuming an existing conversation does not
  repeat the first-message trigger.
- Use all currently available projected context, including the compaction summary
  and kept messages; do not recover discarded context or shorten it locally.
- Match the current session provider: `anthropic/claude-haiku-5-5` for Claude, `openai-codex/gpt-5.6-luna` for GPT.
  All use `low` reasoning without fallback. Credential availability is checked
  through the public model registry, not its private runtime field.
- In one request, ask for 1-10 candidates ranked by meaning, best first, then use
  the first valid name. There is no user picker. Every generated name
  must have at most four whitespace-separated words AND 32 Unicode code points;
  overlong candidates are rejected, never truncated.
- `/rename-gen` uses the same pipeline with current context. A failed attempt may
  be retried three times after the initial attempt. Final failure notifies with
  warning severity and preserves the previous name. Invalid candidate batches
  count against the same budget.
- A newer trigger or session switch cancels pending work. An external/native
  name change cancels pending generation so it is not overwritten by that old
  trigger. The next automatic trigger or `/rename-gen` may replace a manual name.
- The `rename_session` tool takes one `name`, trims it and sets it through `pi.setSessionName`; an empty name is an error. A manual name cancels pending generation, as native `/name` does.
- Successful names use public `pi.setSessionName`, so they persist in native
  history and `/resume`. RQW-statusbar owns title rendering, not this extension.

## Public API contract

Verified against both installed and worktree Pi 1.4.0:
`ExtensionAPI.setSessionName/getSessionName` and `session_info_changed` provide
native persistence and name-change notification. The latter also fires for
native `/name`. `session_start`, `message_end`, `session_compact`, and
`session_shutdown` provide lifecycle boundaries. Public
`sessionManager.buildSessionProjection` and `convertToLlm` provide
compaction-aware context, serialized in full (Pi's summarization serializer
would truncate tool results). The first-user event message is included explicitly
because Pi persists it only after notifying extensions. Public registry
availability/streaming provide the model request path with explicit `low`
reasoning. No other extension needs to import this folder.

## Decisions / authority

Owner (verbatim, session `2026-10-21T18-16-12-433Z_01a15fad-8f91-7306-bd46-1528008fbdc6.jsonl`, user
messages at lines 930, 944 and 971):

> 1а самые низкие ризонинги пусть генерит 10 вариантов на основе контекста
> 2а + после каждого компакшена на основе полного контекта
> 3 ручное не надо, токлько перегенрация и автовыбор лучшего по смыслу из вариантов внутри /rename-gen команда
> 4а

> Если упала генерация до 3х ретраев и потом варнинг если сдохло в итоге

> враиант а
>
> RQW-statusbar +

Reason: short meaningful native names without blocking the main agent, a manual
candidate picker, or loss of a previous name on failure. Carriers: `core.ts`
(candidate generation/validation/selection) and `index.ts` (triggers, cancellation,
retries, notification, native persistence). The approved variant is four words
AND 32 Unicode code points. The root [naming decision](../../DECISIONS.md#naming)
records the accepted contract and package registration.

## Verification

Tests: `test/extensions/RQW-naming/`.
