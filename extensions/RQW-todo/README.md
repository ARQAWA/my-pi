# RQW-todo

An independent main-chat todo list and compact panel. Disable the extension alone in `pi config`.

Use `$todo` or `/skill:todo` to enable the mode for the session. Ask «выключи список» to turn it off. The model uses `todo` with `off: true`; this hides the panel and stops the request summary and reminder. The list remains in the branch and reappears when the mode is enabled again. Closing a list does not turn the mode off.

The `todo` tool updates multiple items by `id` in one call. New items need `text`. Statuses are `pending`, `active`, `done`, `dropped` and `blocked`. `dropped` and `blocked` require a `note` with a reason. Steps replace the item's previous steps and have `pending`, `active` or `done` status. `new: true` starts another list only after every item in the previous one is `done` or `dropped`. A blocked item remains open.

State is saved in tool-result details and restored from the current session branch, including after compaction or resume. While a list is open, a request-only summary keeps open items and the current item's steps in the model context. Closed items appear only as names; a fully closed list does not enter the summary.

The three-line panel sits above the editor, after the statusbar activity line. It follows the active item, then a blocked item or the first pending item. With steps it shows the current item, current step and next open item; otherwise it shows the current and next two items. A blocked item is marked with a yellow `!` and its reason. Once the list is closed the panel disappears. There are no timers or animation.

`/todo` opens a full-screen view of all items, steps and reasons, followed by closed lists from the current branch, newest first. Use arrows or Page Up and Page Down to scroll; Escape closes the view.

Before a completed turn ends, the extension gives at most one hidden reminder per user message when pending or active items remain. Blocked items alone do not trigger it. Aborted and failed turns do not trigger it; Escape never restarts the work.

The package registers RQW-todo after RQW-statusbar to place the panel next to the editor. Contract: [D-TODO-PANEL](../../DECISIONS.md#todo-panel). Tests: `test/extensions/RQW-todo/` and `test/synthetic-todo.test.ts`.
