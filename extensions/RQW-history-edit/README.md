# RQW-history-edit

In the TUI, double Escape in an empty idle editor opens messages from the current branch. `/edit-history` opens the same list. Enter selects a message for editing. Escape restores the draft and returns to the list; Escape again closes it.

Navigation stops at the first and last message. Owner: «Неудобно в самый верх и самый низ переезжать.»

Enter sends the edited text, the selected message's images and any new images. It permanently replaces the current session file with the path before that message. Other branches in that file are removed. The current session name, labels on retained entries and subagent records are retained. Subagent files and delivered-result receipts are not removed. Existing `/fork` files are unchanged.

The edit is refused while a subagent is running, or when the session has no saved file. A busy session cannot be edited. The extension uses Pi's public session APIs and does not patch Pi.

Disable independently with `-extensions/RQW-history-edit/index.ts`, then reload or restart. Tests: `test/extensions/RQW-history-edit/`. Decision: [History edit](../../DECISIONS.md#history-edit).
