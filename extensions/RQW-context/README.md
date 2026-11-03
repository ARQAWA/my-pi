# RQW-context

Independent context-window and compaction policy for Pi 1.5.0.

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
- Native Pi compaction, summary routing and overflow recovery remain in charge. Pi 1.5.0 compact does not
  read `preparation.settings`; there is no summary-reserve rebinding or reserve-intent bookkeeping.
  Summary requests use the summarizing model's output limit, not R. Native pi-ai also clamps output to
  the window minus estimated input minus 4096, with a floor of one token. Oversized input and prose-heavy
  summaries can therefore remain unrecoverable; this extension adds no recovery algorithm.

Huge-tail compaction (`large-tail.ts`):

- When the safe projection offer exists but Pi's free projection throws `RangeError`, the existing manual and automatic
  entrances use one shared bypass, not copies of Pi's private methods. It prepares through `prepareSnapshot`, calls
  the normal generator and stores a normal `appendCompaction` entry, then refreshes the session context.
- Before/after extension hooks, cancellation, error events, idle state, queued messages and overflow retry remain.
  Threshold compaction can adopt a ready/running background summary through the same generator seam.
- The offer and the session methods used by the bypass are checked. Missing seams, no offer and ordinary branches
  stay on the native path. This fixes the stack overflow, not a single retained message larger than the model window.

Background compaction (`background.ts`):

- At Pi's checkpoints, from 75% of W and below Pi's own threshold, Pi's own summary generator runs without being
  awaited on a snapshot of the projected context, once per compaction generation. Disabled compaction, or an explicit
  reserve whose threshold is below 75%, starts nothing.
- When the summary is ready and still fresh, the next checkpoint says "threshold reached" and Pi's normal threshold
  path stores it with no new request. The snapshot cut is kept; everything after it stays verbatim.
- If Pi's threshold is reached while the request is running, Pi waits within its normal compaction path. A successful,
  still fresh result is stored; failure, abort or a stale result falls back to normal compaction. Manual compaction and
  overflow abort the background request without waiting. Stale means another compaction, the leaf or cut off the branch,
  a `context_edit` of a summarized input or the previous compaction, or a changed previous summary or summarized input.
  Cancelling Pi's compaction also cancels the wait and the background request.
- Before each request the session dispatch `rqw:background-summary:v1` `{ type, signal }` lets a transport route it.
- `pi.events` channel `rqw-context:background-compaction` carries `{ sessionId, active }`: true when the request
  starts, false once, as soon as it ends in any way: ready, failed, aborted, stale, superseded by a compaction, session
  shutdown or `dispose()`. A late end of an older request never switches off a newer one.
- The projected preparation is a local copy of Pi 1.5.0 helpers that neither the npm root nor the compiled bundle
  exports. The oracle tests compare it with Pi's `prepareCompaction`; recheck them on every Pi update. Without the
  summary generator seam background compaction stays off and W/R works as before.
- The projection of the branch goes through `globalThis[Symbol.for("rqw:safe-projection:v1")]` when RQW-history-edit
  offers it (Pi's own call overflows the stack on a tail of about 120000 entries after a compaction); without the offer
  it is Pi's `buildSessionProjection`.
- Manual or overflow compaction aborts the request. At the threshold it is also aborted when a
  `session_before_compact` handler cancels or supplies the compaction and Pi never asks the generator. A disposed
  session, such as a stopped subagent, aborts it too, through a shape-checked `dispose` wrapper.
- Subagents use it through the shared prototypes, without the status event or the shutdown abort.

Hooks are process-wide while any extension owner remains. `session_shutdown` releases one owner;
SDK `dispose()` alone does not. Unsupported private Pi boundaries fail at load. Each patched property holds one
forwarding slot (`hooks.ts`); a reloaded module only replaces what the slot runs, so `/reload` puts the new code
in effect. A process that started on an older release keeps that release's hooks until Pi is restarted once.
The extension can be disabled independently.

Tests: `test/extensions/RQW-context/`.
See [decisions](../../DECISIONS.md#context).
