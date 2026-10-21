# RQW-send-now

Force-send queued steering with Enter, the oh-my-pi gesture. Decision and owner quotes:
[DECISIONS.md, Send now](../../DECISIONS.md#send-now).

## Behavior

- While the agent works, Enter with text queues it as steering: stock Pi, unchanged.
- Enter on an empty editor while steering is queued interrupts the current turn and sends the queued text to the
  agent at once as a new user message. The editor is empty afterwards.
- Nothing queued, or only follow-ups (Pi's follow-up key: Alt+Enter, Ctrl+Q on Windows): empty Enter does nothing,
  as in stock Pi.
- Escape, Alt+Up and every other key stay Pi's. Dialogs, selectors and overlays keep their own Enter: the gesture
  acts only when Pi's input editor (`CustomEditor` or a subclass, such as RQW-statusbar's) has focus.
- The key is Pi's configured `tui.input.submit` binding (`enter` by default; `\r` on Windows and legacy terminals,
  CSI-u under the Kitty protocol). Key releases and bracketed paste do not trigger it.
- Only in the interactive TUI. Print, JSON and RPC modes are unaffected.

## How

Public Pi API only, no custom editor (RQW-statusbar owns that slot):

1. `ctx.ui.onTerminalInput` sees the Enter before the editor. It acts when the editor text is empty, the agent is
   not idle, steering is queued and the input editor has focus (the TUI comes from a widget factory, removed at once).
2. `ctx.abort()`: Pi moves both queues into the editor (steering first, joined by blank lines) and aborts the run.
   The extension takes that text and clears the editor in the same key handler.
3. When the session is idle, `pi.sendUserMessage(text)` sends it. Pi already expanded templates and skills when it
   queued the text, so they are not expanded again.

Pi tells extensions only whether anything is queued, so steering is counted from `input` events with
`streamingBehavior: "steer"`, minus the queued user messages Pi delivers (Pi delivers steering before follow-ups).
A run's own starting prompt, the first user message after `before_agent_start`, is not counted as a delivery.
The count resets when the queue is empty and no steering input is on its way. Pi awaits input handlers and then
queues within the same chain of microtasks, so an input counts as on its way until the next event-loop turn; a
batch of keys (text, Enter, Enter in one terminal chunk) arrives synchronously within that window. After Pi's
dequeue key the queue is empty with nothing on its way, so the count resets. A message still on its way lands in
Pi's queue after the abort; before sending, and when the session ends first, the extension takes anything left in
the queue through Pi's restore, keeping what the user typed meanwhile, and sends or restores it with the rest.

Closer to oh-my-pi: Pi drops an aborted reply from later requests (pi-ai `transform-messages`), so the model would
not see what it had written when it was interrupted. For the reply a force-send interrupts, a `context_with_system`
handler replays its text as a finished reply before the sent message. The choice is stored as a session custom
entry `rqw-send-now` with the reply timestamp, so resume and `/reload` build the same request. Other aborted
replies, for example after Escape, stay dropped as in stock Pi.

## Limits

- Several queued messages go as one message, in queue order, joined by blank lines. Follow-ups queued together
  with steering go in it too; oh-my-pi would send them after the steering.
- A follow-up-only queue is left alone; oh-my-pi interrupts there but does not resume follow-ups either.
- Of the interrupted reply only its text is kept. Thinking and unfinished tool calls are dropped (oh-my-pi keeps
  them and synthesizes tool results). No completed tool results are lost: Pi runs tools only after a reply is
  complete, and an abort during tool execution keeps the reply and its results.
- Pi's queue restore is text only. Steering typed in the TUI is text (pasted images are file paths, kept);
  images an extension attached to steering via `sendUserMessage` are dropped, as with Escape. Custom messages an
  extension queued into Pi's agent queue are cleared by the abort, as with Escape.
- If another extension's `input` handler swallows a steering message while other messages are queued, the count
  stays above zero until the queue empties; queued follow-ups alone could then be force-sent. An `input` handler
  that waits past an event-loop turn delays Pi's queueing; an empty Enter in that window treats the queue as
  having no steering, as stock Pi would.
- The text, including steering that landed in Pi's queue after the abort, goes back to the editor with a warning
  when no model is selected or the session ends (`/reload`, `/new`, `/resume`, quit) before the interrupted run
  settles. A send Pi itself rejects later shows Pi's error.

## Switch off

Like every RQW extension: `-extensions/RQW-send-now/index.ts` in the package entry, see
[INSTALL.md](../../INSTALL.md#switch-one-extension-off). Then empty Enter is stock Pi again.

## Tests

`extensions/RQW-send-now/test/send-now.test.ts`, in `npm test`: Pi's real `InteractiveMode` on a scripted
terminal with a faux streaming model and only this extension loaded. Force-send with the interrupted text replayed
(also after `/reload`), nothing queued, follow-up only, dialog focus, a `CustomEditor` subclass, extension off,
session end before the send (also with keys batched in one chunk), several messages, keys batched in one chunk,
steering queued while a run prepares, dequeue then follow-up, key encodings.
