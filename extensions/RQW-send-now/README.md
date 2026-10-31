# RQW-send-now

Steering keys and the silent force-send. Decisions and owner quotes:
[DECISIONS.md, Send now](../../DECISIONS.md#send-now), `[D-KEYS-STEER]` and `[D-KEYS-ESC]`.

## Behavior

- While the agent works, Enter with text queues a follow-up. When the run is idle but background work remains, or during compaction with background work, Enter also queues it. Idle and compaction queueing require an active RQW-agent hold for the same session; otherwise Enter keeps Pi's behavior.
- Ctrl+Enter and Alt+Enter with text give the editor its own submit: while the agent works it queues steering, otherwise it sends (with only background running it starts the main turn). Alt+Enter never forces. PCLI's VS Code terminal does not send Ctrl+Enter by itself; PCLI adds the key later, Alt+Enter works there meanwhile.
- Force-send: with user steering waiting (queued, or still on its way through input handlers), an empty Enter, an empty Ctrl+Enter on Codex (`openai-codex`) and Escape on other providers interrupt the turn without any notice and send the steering at once as a new user message. Several messages go as one, joined by blank lines, images with them. Follow-ups, other queued messages and the editor draft stay. On other providers an empty Ctrl+Enter does nothing (empty Enter and Escape force); on Codex Escape stays Pi's (interrupt, queue back to the editor). Without steering waiting, Escape stays Pi's.
- The interrupted reply stays an aborted message in the session; only its "Operation aborted" row is not drawn (also after `/reload` and resume). An aborted tool call still shows its result.
- Ctrl+backslash aborts the current turn, returns queued text to the editor and asks the session's extensions to stop background work. File calls may finish on their own.
- Escape: one press while the turn (or a compaction) works is Pi's and interrupts it. A second press within 500 ms
  stops the session's background like Ctrl+backslash; Ctrl+backslash stays as an alias. With only background running the
  first press is taken here (so Pi's own double Escape cannot open its tree), and the second also cancels a force-send that
  has not started and returns its text to the editor. Busy is captured on the first press; for 500 ms after a stop more
  presses are swallowed. Idle without background, Escape stays Pi's and RQW-history-edit's. An open autocomplete list
  and other focused components keep their Escape.
- Alt+Up and every other key stay Pi's. Dialogs, selectors and overlays keep their own Enter: the keys act only when
  Pi's input editor (`CustomEditor` or a subclass, such as RQW-statusbar's) has focus and shows no autocomplete list.
- Key releases, auto-repeats and bracketed paste do not trigger a key. Ctrl+Enter is read as Kitty `CSI 13;5u` or modifyOtherKeys `CSI 27;5;13~`.
- In the TUI it also re-writes `\x1b[?2004h` (bracketed paste on) at `session_start`, after every `tool_execution_end` and at `agent_end` and `agent_settled`, so a child process that switched it off cannot turn pasted newlines into Enter.
- Only in the interactive TUI. Print, JSON and RPC modes are unaffected.

## Editor hints

The empty main input shows one dim italic key hint, two spaces after the cursor. Priority is: prediction cancellation,
waiting Codex steering, waiting other-provider steering, main interruption, background stop, and an idle follow-up.
The exact texts are `ctrl+r to interrupt`, `ctrl+enter to send now`, `esc to send now`, `esc to interrupt`,
`esc esc to stop background` and `ctrl+enter to steer`. Compaction and retry use `esc to interrupt`.
Typed text, including a space, hides the hint. It is not input; Tab and Enter keep their own behavior.
RQW-predictions paints the hint when available; otherwise this extension decorates the same editor instance.
The old queue, hold and loader key hints are hidden while this painter is active and restored when it stops.
The version-checked Pi UI patch leaves unsupported shapes stock.

## How

No custom editor (RQW-statusbar owns that slot). A version-checked Pi 1.4.0 runtime hook (`queue.ts`) captures the owning session by its session manager, using weak references, and wraps `_queueUserInput`, `_queueSteer` and `prompt` on that session. The wrappers call whatever the prototype has at call time, so other wrappers stay; they are removed with the last lease, and the binding hook is restored when it is still on top. An incompatible shape disables the keys and leaves them to Pi. Check this hook on every Pi update, including Windows PCLI.

1. `ctx.ui.onTerminalInput` sees the key before the editor.
2. A steering key with text calls the editor's own submit (`handleInput("\r")`).
3. The force takes the user steering messages out of Pi's display list and delivery queue in one synchronous step (messages are matched by text, so follow-ups and other message kinds stay), then calls the session's own `abort()`. `ctx.abort()` is not used: it moves both queues to the editor.
4. From then on `_queueSteer` routes steering into the pending send instead of Pi's queue. `prompt` sends a busy, non-command steer from the editor straight to `_queueUserInput` (with expansion turned off: input handlers, then `_queueSteer` with the text as it is), so a run that ends while input handlers await cannot turn the input into a separate run. The send waits for the abort and for the inputs that were on their way; handled or rejected inputs send nothing.
5. When the session is idle, the send starts Pi's own run path with the prepared text and images (`_startRun`, as the RQW-agent follow-up hold does). The input handlers already ran when the steering was queued, so they do not run again, and templates and skills are not expanded again. A run that fails before it starts puts the text back in the editor.
6. A `message_end` handler marks the interrupted reply before Pi draws it; `quiet.ts` wraps the assistant message's `updateContent` and removes its status row (a Spacer and a Text) for marked replies. The mark is also the custom entry `rqw-send-now`, written for every interrupted reply (with `unsent: true` when the send was cancelled, never happened or failed before the run started, then the reply is not replayed to the model), so resume and `/reload` draw the same.

Closer to oh-my-pi: Pi drops an aborted reply from later requests (pi-ai `transform-messages`), so the model would
not see what it had written when it was interrupted. For the reply a force-send interrupts, a `context_with_system`
handler replays its text as a finished reply before the sent message. The choice is stored as the custom entry
`rqw-send-now` with the reply timestamp. Other aborted replies, for example after Escape, stay dropped as in stock Pi.

## Limits

- Of the interrupted reply only its text is kept for the model. Thinking and unfinished tool calls are dropped (oh-my-pi keeps
  them and synthesizes tool results). No completed tool results are lost: Pi runs tools only after a reply is
  complete, and an abort during tool execution keeps the reply and its results.
- Only the editor's busy prompt is tracked. A steer from an extension (`sendUserMessage`) or a registered command is not. A steer that reaches Pi's queue after its run ended stays there until the next run, as in stock Pi.
- Images of text that goes back to the editor (a cancelled force, no model, `/reload`) are dropped; the editor holds only text.
- A force-send cancelled by a second Escape stays pending until the run has settled, then its text and any late
  steering return to the editor with a warning. The same happens when no model is selected. When the session ends
  (`/reload`, `/new`, `/resume`, quit) first, the reserved text returns at once and inputs still on their way are caught until they settle, then return after it; one that finds Pi's context already invalid is left to the session's own steering queue (the session survives `/reload`). A send Pi itself rejects later shows Pi's error.
- Codex quick steering is owned by RQW-codex; it drains the current Lite response before the next request.
- Pi's separate compaction queue is not visible to the force.

## Switch off

Like every RQW extension: `-extensions/RQW-send-now/index.ts` in the package entry, see
[INSTALL.md](../../INSTALL.md#switch-one-extension-off). Then Ctrl+Enter, Alt+Enter and Escape are stock Pi again.

## Tests

`test/extensions/RQW-send-now/`: `send-now.test.ts`, `steer.test.ts`, `escape.test.ts`, `queue.test.ts`, `keys.test.ts` and `stop.test.ts`, with the shared `harness.ts`.
