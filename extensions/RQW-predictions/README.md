# RQW-predictions

A gray next-message suggestion in the empty input of the main interactive chat, and a gray piece of a few words at the cursor
of a text you are already typing. Tab turns either into ordinary text.
Nothing is sent by the extension; every other mode and every child session stays quiet.

## Behaviour

- After each finished answer (`turn_end`, outcome `completed`, stop reason `stop`) one automatic attempt runs.
  It is skipped for good when a message of yours is already queued at that moment. No retries, no total limit.
- Ctrl+E on an empty input generates by hand and also repeats a failed run; it needs an idle chat and no queued message.
  Ctrl+R cancels a running request: the footer status turns maroon for 2000 ms.
- The request is a fork of what the main model last saw (the shared `rqw:context-fork:v1` contract, as `/btw`);
  without a transport offer it is one direct `streamSimple` call. The last user message is the prompt Codex serves,
  the JSON reply instruction and the owner's rule «if there is no obvious next user message, set suggestion to null».
  The model and effort are the chat's. Tools never run. A hosted-tool refusal (`decline("unsupported_hosted_tools")`) is final.
- The prompt comes from `codex-prompt.ts`: Codex's own endpoint, the saved `openai-codex` login read-only, a 300000 ms cache.
  Predictions therefore need that login also in an Anthropic chat.
- The suggestion is kept until the next finished answer. Typing hides it, clearing the input shows the same one again.
  It is drawn whole and wrapped, in the theme's `dim` colour; the real buffer stays `""` until Tab.
  Tab inserts it as one undoable edit. Enter, Right, Shift+Tab and key releases do nothing special.

## Prompt continue (a piece at the cursor)

- Ctrl+E with text in the input (a whitespace-only input counts) asks for a piece instead of a suggestion. Same conditions
  as the empty-input Ctrl+E; one request at a time. The ready suggestion is not touched.
- The cursor decides where it goes: at the end the model continues the text, in the middle it inserts right there.
  The request is the same fork of the chat's context, with the chat's model and effort, so the prompt cache is reused.
  Only the last message differs: the served prompt, then an insert rule with `<before_cursor>` and `<after_cursor>`
  (paste markers expanded), then the schema and silence rules. The draft and the rule are only at the end.
- The reply is cut to its first line and at most six words (`MAX_WORDS` in `context.ts`), control codes removed. A leading space is
  dropped when the text before the cursor already ends in whitespace, a trailing one when the text after already starts with it.
  `null`, blank or unparsable replies show nothing and end the chain.
- The piece is drawn gray (the theme's `dim`) in the text line at the cursor, wrapped as Pi will wrap it after Tab. The real
  buffer and cursor stay as typed. Hidden while the chat works, a message waits, a menu is open or another component has the focus.
- Tab takes the piece that was really drawn, as one undoable insert, and at once asks the next piece for the new text; nothing
  is shown while it runs. Tab without a drawn piece keeps its stock path.
- A piece and its request end when the draft key (text plus cursor) differs. It is checked after every `handleInput` and
  `handleMouse` of the editor and in every frame, so typing, deleting, undo, cursor keys, clicks and Pi's own `setText` all count,
  without a key list. Then it is gone for good, also if the text comes back. Ctrl+R during the request is the maroon abort, on a
  shown piece it only removes it. A new turn (`agent_start`, so Enter), a new answer, another model and another branch end it quietly.
- Escape is not handled: in the scrolled fullscreen view RQW-scroll takes it, so the piece stays until a key or Ctrl+R removes it.
- Pi's private editor parts are used (`state`, `layoutText`, `lastWidth`, `scrollOffset`, `renderedVisibleLineCount`,
  `expandPasteMarkers`). They are checked once at decoration and every frame must have exactly the visible rows plus two borders.
  Otherwise one warning appears, pieces are off, and Ctrl+E with text falls back to the suggestion request. Recheck on every Pi update.
- Not measured: the delay of one piece on a big context, and whether the Codex server cache is hit (its fork drops `previous_response_id`).

## Keys

`keybindings.ts` wraps the live Pi keybindings manager in memory and takes Ctrl+E and Ctrl+R away from every action:
the line end keeps End; session rename in `/resume` loses Ctrl+R (use `/name`). Nothing is written to any settings file.
If the manager has an unknown shape nothing changes, a warning is shown and the manual keys stay off; automatic
suggestions and Tab keep working. The keys are handled only by the decorated main editor.
Ctrl+E means a piece when the input has text. Terminals decide what arrives: Windows VS Code binds Ctrl+E to Quick Open, which the terminal never sees by default.

## Footer status

State goes out on `pi.events` channel `rqw-predictions:activity` as `{ sessionId, state, abortedUntil? }` with `state`
`brewing`, `aborted` or `idle` (`abortedUntil` is a `performance.now()` value). A footer answers by asking on
`rqw-predictions:activity-query` with `offer(state)`; the first query also tells this extension that a footer exists.
Without one, the stock `ui.setStatus` line shows `prediction` and a maroon `prediction aborted`.

## Boundaries

- Own folder only; no import from another extension. Each of RQW-statusbar, RQW-skill-dollar and the transports can be off.
- The editor is decorated in place (`render`, `handleInput`, `handleMouse`); an editor shape other than border, one row, border stays stock.
- Not done: scrolling of a suggestion taller than the screen (it is drawn whole), and speed measurements on macOS and Windows.
- Tests: `test/extensions/RQW-predictions/`.
