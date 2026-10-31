# RQW-send-now

Force-send queued steering with Enter, the oh-my-pi gesture. Decision and owner quotes:
[DECISIONS.md, Send now](../../DECISIONS.md#send-now).

## Behavior

- While the agent works, Enter with text queues a follow-up. When the run is idle but background work remains, or during compaction with background work, Enter also queues it. Option+Enter on macOS and Alt+Enter on Windows send steering. PCLI uses the VS Code terminal; this key has not yet been verified there. Idle and compaction queueing require an active RQW-agent hold for the same session; otherwise Enter keeps Pi's behavior.
- Enter on an empty editor while steering is queued interrupts the current turn and sends the queued text to the
  agent at once as a new user message. The editor is empty afterwards.
- Nothing queued, or only follow-ups: empty Enter does nothing,
  as in stock Pi.
- Ctrl+backslash aborts the current turn, returns queued text to the editor and asks the session's extensions to stop background work. File calls may finish on their own.
- Escape, Alt+Up and every other key stay Pi's. Dialogs, selectors and overlays keep their own Enter: the gesture
  acts only when Pi's input editor (`CustomEditor` or a subclass, such as RQW-statusbar's) has focus.
- The key is Pi's configured `tui.input.submit` binding (`enter` by default; `\r` on Windows and legacy terminals,
  CSI-u under the Kitty protocol). Key releases and bracketed paste do not trigger it.
- In the TUI it also re-writes `\x1b[?2004h` (bracketed paste on) at `session_start`, after every `tool_execution_end` and at `agent_end` and `agent_settled`, so a child process that switched it off cannot turn pasted newlines into Enter.
- Only in the interactive TUI. Print, JSON and RPC modes are unaffected.

## How

No custom editor (RQW-statusbar owns that slot). A version-checked Pi 1.4.0 runtime hook captures the owning session by its session manager, using weak references. The hook restores its predecessor on shutdown when it is still on top; other wrappers remain intact. An incompatible hook or queue disables the gesture and leaves Enter to Pi. Check this hook on every Pi update, including Windows PCLI:

1. `ctx.ui.onTerminalInput` sees the Enter before the editor. It acts when the editor text is empty, the agent is
   not idle, steering is queued and the input editor has focus (the TUI comes from a widget factory, removed at once).
2. `ctx.abort()`: Pi moves both queues into the editor (steering first, joined by blank lines) and aborts the run.
   The extension takes that text and clears the editor in the same key handler.
3. When the session is idle, `pi.sendUserMessage(text)` sends it. Pi already expanded templates and skills when it
   queued the text, so they are not expanded again.

The real steering queue decides the gesture after the provisional input period. While a steering input is still
being submitted, its provisional count also permits the gesture, preserving two Enter keys in one terminal batch.
A swallowed input can still trigger it during that brief period. A message still on its way lands in Pi's queue
after the abort; before sending, and when the session ends first, the extension takes anything left in
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
- A steering input swallowed during the provisional period can still trigger a force-send. A delayed input is
  not available to send until Pi queues it. Pi's separate compaction queue is not visible to this gesture.
- The text, including steering that landed in Pi's queue after the abort, goes back to the editor with a warning
  when no model is selected or the session ends (`/reload`, `/new`, `/resume`, quit) before the interrupted run
  settles. A send Pi itself rejects later shows Pi's error.

## Switch off

Like every RQW extension: `-extensions/RQW-send-now/index.ts` in the package entry, see
[INSTALL.md](../../INSTALL.md#switch-one-extension-off). Then empty Enter is stock Pi again.

## Tests

`test/extensions/RQW-send-now/send-now.test.ts` and `test/extensions/RQW-send-now/queue.test.ts`.
