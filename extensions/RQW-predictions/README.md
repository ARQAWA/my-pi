# RQW-predictions

A gray next-message suggestion in the empty input of the main interactive chat. Tab turns it into ordinary text.
Nothing is sent by the extension; every other mode and every child session stays quiet.

## Behaviour

- After each finished answer (`turn_end`, outcome `completed`, stop reason `stop`) one automatic attempt runs.
  It is skipped for good when a message of yours is already queued at that moment. No retries, no total limit.
- Ctrl+E generates by hand and also repeats a failed run; it needs an idle chat and no queued message.
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

## Keys

`keybindings.ts` wraps the live Pi keybindings manager in memory and takes Ctrl+E and Ctrl+R away from every action:
the line end keeps End; session rename in `/resume` loses Ctrl+R (use `/name`). Nothing is written to any settings file.
If the manager has an unknown shape nothing changes, a warning is shown and the manual keys stay off; automatic
suggestions and Tab keep working. The keys are handled only by the decorated main editor.
Terminals decide what arrives: Windows VS Code binds Ctrl+E to Quick Open, which the terminal never sees by default.

## Footer status

State goes out on `pi.events` channel `rqw-predictions:activity` as `{ sessionId, state, abortedUntil? }` with `state`
`brewing`, `aborted` or `idle` (`abortedUntil` is a `performance.now()` value). A footer answers by asking on
`rqw-predictions:activity-query` with `offer(state)`; the first query also tells this extension that a footer exists.
Without one, the stock `ui.setStatus` line shows `prediction` and a maroon `prediction aborted`.

## Boundaries

- Own folder only; no import from another extension. Each of RQW-statusbar, RQW-skill-dollar and the transports can be off.
- The editor is decorated in place (`render`, `handleInput`); an editor shape other than border, one row, border stays stock.
- Not done: scrolling of a suggestion taller than the screen (it is drawn whole), and speed measurements on macOS and Windows.
- Tests: `test/extensions/RQW-predictions/`.
