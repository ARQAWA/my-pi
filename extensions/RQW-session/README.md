# RQW-session

Independent session commands (`/copy-session`, `/remove`, `/cleanup`) and a fast `/resume` list for Pi 1.4.0. No tool, UI replacement or other-extension import. The only Pi patch is the list below.

- `/copy-session`: copy the current ID and notify `Session ID copied: <id>`. Stock `/copy` still copies the last
  assistant message. Clipboard failures produce an error notification, not success.
- `/remove`: works like Remove Session in the `/resume` picker. It asks `Delete this session?` in one Pi selection
  dialog: `1. No` first (selected by default), then `2. Yes`. Enter on the default, Escape or cancellation deletes
  nothing. After Yes, it switches to a fresh empty session using Pi's `/new` runtime path, then deletes the old JSONL
  with a local copy of stock `deleteSessionFile` (Pi 1.4.0): `trash` first (`--` before a leading dash), else
  `unlink`. Messages: `Session moved to trash`, `Session deleted`, `Failed to delete: <error>`. Cancelling the session
  switch deletes nothing. Without dialog-capable UI it refuses; RPC may select via its UI bridge. An empty/in-memory
  session simply becomes a new empty session. Only the JSONL is deleted: no `.children` tree, no artifacts.
  No custom keyboard handling is installed.

- `/cleanup`: deletes, permanently and without a dialog, every `<name>.jsonl.children` directory whose sibling
  `<name>.jsonl` no longer exists, under Pi's `sessions/` directory (`PI_CODING_AGENT_DIR`, normally `~/.pi/agent`).
  One asynchronous `readdir` per project folder, run in parallel; no file content is read. Skipped: the current
  session's own tree, files, symlinks and anything outside `sessions/`. It notifies the count removed, or
  `Nothing to clean`. Pi temp files (`pi-bash-*` and the like) have no session owner and are left to the OS.

- Deleted open session: the file is expected when the window has seen it exist (at session start, after each
  turn or agent end, and on input) or the session already has user or assistant entries (Pi writes the file with the
  first one). When you submit a message and an expected file is gone (missing, or recreated by a later append so that its first valid JSON entry is not a Pi session header, `type: "session"` and a string `id`, as Pi's loader decides; blank and malformed lines are skipped, reading stops at that entry, and a file with no valid entry counts as deleted), the message is not sent. The
  window shows the error `Session file was deleted. Opening a new session.`, then opens a fresh empty session and puts
  your text back into the editor (images are not restored). If the switch is refused, the text stays and a second error
  says a new session could not be opened. A brand-new session with no entries and no seen file is untouched. Mechanism, all public Pi
  API: an `input` handler sees the message and hands the text to a hidden command `/session-deleted` through
  `pi.sendUserMessage("/session-deleted", { expandPromptTemplates: true })`, because only a command context has
  `newSession`; the command opens the session and sets the editor text in `withSession`. Because a deleted session is
  dead by design, `/cleanup` has no liveness logic.

- Fast `/resume` list (`list.ts`): a runtime patch (`[D-SCOPE-RUNTIME-PATCH]`) of `SessionManager.list` and `listAll`.
  No cache and no background work. Per file and per call: one `stat`, the header line, then 64 KB windows read from the end
  until the last line starting `{"type":"session_info"`; only that line is parsed. Only a session without a name also
  scans forward for its first user message. The date is the file's mtime. The row shows the size (`123 KB`, `2.2 MB`)
  where Pi prints the message count, and `allMessagesText` is empty, so the search covers id, name and folder only.
  `onProgress` is called once with the finished list. Stock runs when the shape differs (the sources must contain
  `listSessionsFromDir`), for a relative or `~` directory, and on any error. The patch is removed on `session_shutdown`. Limits: `pi --resume` from the command line
  opens the list before extensions load, so it stays stock; the age keeps Pi's form (`3d`). Measured on 30 real files
  (317 MB, one folder of 239 MB), warm OS cache: stock 862 ms current folder and 1143 ms all; now 1.5 ms and 25 ms.

**Limit:** `/remove` deletes only the JSONL, so its subagent tree stays until `/cleanup`.

## Clipboard on Windows / VDI

Uses Pi's exported `copyToClipboard`, exactly as `/copy` and `app.message.copy` do. On Windows Pi tries its native
clipboard, then `clip`. On a Windows VDI in a VS Code terminal without SSH markers this is the path used; clipboard
redirection to the user's local machine depends on the VDI environment. Pi additionally emits OSC 52 for SSH/Mosh
or `PI_CLIPBOARD_OSC52=1`. VS Code alone does not enable OSC 52; set that environment variable in the launching
environment if the terminal/client requires and supports OSC 52. The extension does not change owner settings.

## Switch off and proof

Follow [INSTALL.md](../../INSTALL.md#switch-one-extension-off) with
`-extensions/RQW-session/index.ts`, then `/reload` or restart. All three commands and the fast list disappear without changing other
extensions. The fast list is switched off with the same entry. Tests: `test/extensions/RQW-session/session.test.ts`, `list.test.ts`, `test/isolation.test.ts`.

Decision and research: [DECISIONS.md](../../DECISIONS.md#session-commands).
