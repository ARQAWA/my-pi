# RQW-history-edit

In the TUI, double Escape in an empty idle editor opens messages from the current branch. `/edit-history` opens the same list. Enter selects a message for editing. Escape restores the draft and returns to the list; Escape again closes it.

Navigation stops at the first and last message. Owner: «Неудобно в самый верх и самый низ переезжать.»

Enter sends the edited text, the selected message's images and any new images. It permanently replaces the current session file with the path before that message. Other branches in that file are removed. The current session name, labels on retained entries and subagent records are retained. Subagent files and delivered-result receipts are not removed. Existing `/fork` files are unchanged.

Before navigation, the original branch is anchored and the session file is copied to a sibling `.rqw-edit-<pid>.bak` file without loading it into a Buffer. The replacement is written one JSONL entry at a time to a temporary file before renaming it over the session. The backup is removed only after a successful replacement and session switch. A failed edit renames the backup back, restores the previous branch and keeps the draft; the restored branch is also retained on resume. If the backup cannot be restored, it stays on disk and its path appears in the error. Recovery after a session replacement runs through a fresh command context, not the invalidated context. If recovery itself fails, the next submit retries restoration of the original leaf. A successful retry consumes that submit, exits edit mode, keeps the typed text in the editor and shows `Previous branch restored.` as an info notice. The next Enter follows Pi's normal submit path for messages, built-in commands and shell input. Another recovery failure keeps the draft blocked and shows an English error. A session switch also clears the block.

The edit is refused while a subagent is running, or when the session has no saved file. A busy session cannot be edited. The extension uses Pi's public session APIs and does not patch Pi.

Disable independently with `-extensions/RQW-history-edit/index.ts`, then reload or restart. Tests: `test/extensions/RQW-history-edit/`. Decision: [History edit](../../DECISIONS.md#history-edit).
