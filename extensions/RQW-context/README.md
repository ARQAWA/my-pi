# RQW-context

Independent context-window and compaction policy for Pi 1.4.0.

- For each physical model, W = min(contextWindow, 500000), R = Math.round(W / 10).
  Threshold compaction starts strictly above W - R, not at equality.
- Physical request/check scopes supply the actual routed target's limits. Automatic preparation uses the
  triggering target; manual preparation uses the latest successful response after native abort settles.
  Virtual selections keep their identity, routing state, thinking and declared or unknown window.
  Registry models are not mutated; physical windows above the cap use stable copies.
  Queued prompts started by native `compaction_end` and their tool continuations do not overwrite the
  inherited manual-compaction scope. Only an actual request scope receives routed physical limits.
- Explicit global `compaction.reserveTokens` and per-selection
  `compaction.modelOverrides["provider/id"].reserveTokens` keep native precedence when below W.
  A reserve at or above W falls back to R. `compaction.enabled: false` keeps native disabling behavior.
- Native Pi compaction, summary routing and overflow recovery remain in charge. Pi 1.4.0 compact does not
  read `preparation.settings`; there is no summary-reserve rebinding or reserve-intent bookkeeping.
  Summary requests use the summarizing model's output limit, not R. Native pi-ai also clamps output to
  the window minus estimated input minus 4096, with a floor of one token. Oversized input and prose-heavy
  summaries can therefore remain unrecoverable; this extension adds no recovery algorithm.

Background compaction (`background.ts`):

- At Pi's checkpoints, from 65% of W and below Pi's own threshold, Pi's own summary generator runs without being
  awaited on a snapshot of the projected context, once per compaction generation. Disabled compaction, or an explicit
  reserve whose threshold is below 65%, starts nothing.
- When the summary is ready and still fresh, the next checkpoint says "threshold reached" and Pi's normal threshold
  path stores it with no new request. The snapshot cut is kept; everything after it stays verbatim.
- Not ready, stale, manual or overflow: the background request is aborted and Pi compacts normally, without waiting.
  Stale means another compaction, the leaf or cut off the branch, a `context_edit` of a summarized input or the
  previous compaction, or a changed previous summary or summarized input.
- Before each request the session dispatch `rqw:background-summary:v1` `{ type, signal }` lets a transport route it.
- `pi.events` channel `rqw-context:background-compaction` carries `{ sessionId, active }`: true when the request
  starts, false once, as soon as it ends in any way: ready, failed, aborted, stale, superseded by a compaction, session
  shutdown or `dispose()`. A late end of an older request never switches off a newer one.
- The projected preparation is a local copy of Pi 1.4.0 helpers that neither the npm root nor the compiled bundle
  exports. The oracle tests compare it with Pi's `prepareCompaction`; recheck them on every Pi update. Without the
  summary generator seam background compaction stays off and W/R works as before.
- Entering a manual, overflow or not-ready threshold compaction aborts the request, also when a
  `session_before_compact` handler cancels or supplies the compaction and Pi never asks the generator. A disposed
  session, such as a stopped subagent, aborts it too, through a shape-checked `dispose` wrapper.
- Subagents use it through the shared prototypes, without the status event or the shutdown abort.

Hooks are process-wide while any extension owner remains. `session_shutdown` releases one owner;
SDK `dispose()` alone does not. Unsupported private Pi boundaries fail at load. Restart Pi after updating
hook implementations; `/reload` alone is insufficient. The extension can be disabled independently.

Tests: `test/extensions/RQW-context/`.
See [decisions](../../DECISIONS.md#context).
