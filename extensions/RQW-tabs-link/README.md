# RQW-tabs-link

Chats in visible Pi tabs on one computer can list, read and message each other. You open the tabs yourself; the
extension never opens, resumes or focuses one. Disable it alone in `pi config`.

Subagents never load this extension: RQW-agent starts children with `noExtensions: true` and only its own factories
(`extensions/RQW-agent/index.ts:1037-1041`). A non-TUI mode (print, rpc, json) registers nothing either.

## Tools

All three are plain code. There is no model call, no summary, no fuzzy search and no waiting for a reply.
Equal input and equal state give an equal result. Errors have a fixed code and text.

1. `list_chats({query?, cursor?, limit?})` returns `chats, nextCursor, untrustedDataNotice`. A chat is
   `id, title, cwd, status, updatedAt`; `status` is `open`, `closed` or `unknown`. `query` is a case-insensitive
   substring of id or title. Order: `updatedAt` descending, then `id`. Limit 10, at most 50.
2. `read_chat({chatId, cursor?, turnLimit?, includeOutputs?, maxOutputCharsPerItem?})` returns stored turns of an
   open chat from its memory, never from its session file. The turn projection is in `history.ts`.
3. `send_message_to_chat({chatId, prompt, model?})` queues a prompt of 1 to 1000 UTF-8 bytes and returns
   `{chatId, status}` with `accepted`, `delivered` or `unknown`. It never returns the reply; read it later with
   `read_chat`. Errors: `closed`, `not_found`, `queue_full`, `model_unavailable`, `duplicate_conflict`, `bad_request`.

The tools mirror Codex `list_threads`, `read_thread` and `send_message_to_thread`; `chatId` is the Pi session id.

## Closed and missing chats

A session file without an open owner is `closed`, with or without an earlier registry record. Read and send then
return `chatId`, `openHint` and "Chat is closed. Ask the user to open it." The hint is shown, never run: open a new
tab and use `/resume`, or run `pi --session <id>` (with `--session-dir` for a custom folder).

`not_found` needs a complete search that found no session file. An unreadable folder, or an owner that stays
silent, gives `unknown`. A silent owner is never taken for a closed chat.

Limit: the search covers Pi's session store of the profile, this tab's own session folder and the folders recorded by
registered chats. A closed chat in a custom `--session-dir` that no tab ever registered cannot be found and returns
`not_found`, although it exists.

## Delivery

The receiving tab queues up to 20 messages in arrival order and sends them with `pi.sendMessage` as a follow-up,
after its current work. It never interrupts a run and never answers a dialog. While a dialog is open the message waits.
Source and delivery id are in the message text and in its details.

`accepted` means the receiving extension took the message. `delivered` means the entry exists in Pi's history, which Pi
writes after its message events. The tool answers at once with the current status and never waits; a repeat of the
same call (same delivery id) shows `delivered` once the entry is stored.
A delivery id repeated with equal content gets the earlier status and is not sent again; other content under the same
id is refused. After a crash or restart an accepted message that left no trace has status `unknown` and is never
resent. Exactly-once delivery across crashes is not promised.

Messages go out one turn at a time. A message that never started when everything settled (an aborted run, a cleared
queue, a failed send) is released as `unknown`, never delivered, its model override is undone and the next message
goes. If Pi still delivers it later, the stored entry turns it into `delivered`.

Delivery limits, as Pi 1.4.0 gives no public signal for them:

1. After an aborted run Pi may still hold a released message in its own queue, so it can arrive after a later one.
   `ctx.hasPendingMessages()` counts only user-text queues (`pi-coding-agent/dist/core/agent-session.js:1954-1955,2826`);
   a custom message is queued through `agent.followUp` (`agent-session.js:1866`) and is not visible.
2. If Pi fails to start the delivered run, the message is released as `unknown` and the model is put back only at the
   chat's next run: the failed start emits no `agent_settled` and no extension event (`agent-session.js:1427-1433,2766-2771`).

An explicit `model` is checked against the receiver's available models and credentials before anything is accepted; a refused model returns `model_unavailable` and nothing is stored or sent. It applies to the delivered turn only: the
model and the thinking level are put back independently, before the request that carries a queued message of the
owner, or at the end of the run. A setting the owner changed meanwhile keeps the owner's choice. A restart after a
crash undoes an override that is still in place; the restore marker is stored before the model changes.

## Channel and state

Each tab listens on `127.0.0.1` on a random port; requests carry a random secret and a random generation token that is
new at every session start. Frames are JSON lines of at most 64 KiB; a larger answer is sent as several chunks and
is never cut. The registry is one file per chat in the profile's state folder.

A chat is held by a numbered lock folder with its owner (process id, instance id, generation token, port) already
inside. The holder listens before it takes the lock. Nothing is deleted to make room: a lock is replaced by the next
epoch only when its holder is confirmed dead, and only one rename to that epoch can win. Dead means a dead process, a
refused connection, or another identity answering on the port; a process id alone proves nothing, and a silent holder
stays unknown. A second tab with the same session id keeps the link off and warns. Pi cannot lock the session file
itself, so this guards known chats only.
