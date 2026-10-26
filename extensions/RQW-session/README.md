# RQW-session

Independent session commands for Pi 1.4.0. No tool, UI replacement, other-extension import or Pi patch.

- `/copy-session`: copy the current ID and notify `Session ID copied: <id>`. Stock `/copy` still copies the last
  assistant message. Clipboard failures produce an error notification, not success.
- `/remove`: ask `Delete this session permanently?` in one Pi selection dialog: `1. No` first (selected by
  default), then `2. Yes`. Enter on the default, Escape or cancellation deletes nothing. Down then Enter chooses
  Yes. After Yes, switch to a fresh empty session using Pi's `/new` runtime path, then permanently unlink the old
  JSONL, its exact adjacent `.children` session tree and their unshared referenced artifact files (no trash). Cancelling the session switch deletes nothing.
  Without dialog-capable UI it refuses; RPC may select via its UI bridge. An empty/in-memory session simply becomes
  a new empty session. No custom keyboard handling is installed.

## Cleanup contract

The current JSONL must be inside Pi's agent directory (`PI_CODING_AGENT_DIR`, normally `~/.pi/agent`). A custom
`--session` file outside it is refused. Once the old runtime has shut down, cleanup reads its final on-disk JSONL,
including entries written at shutdown. Session names, labels, branches, usage and embedded images are in that file.
Pi discovers recent sessions from JSONL timestamps/mtimes; there is no last-session pointer or name-index sidecar.

Only Pi-generated artifact basenames are eligible: `pi-bash`, `pi-powershell`, `pi-output`, `pi-codemode`, or
`pi-mcp`, followed by `-`, exactly 16 hex digits and an extension; clipboard files use `pi-clipboard-<UUIDv4>` plus
an extension. References may occur in any JSONL string, but a `fullOutputPath` key grants no extra permission:
credentials, settings and arbitrary temp files are not artifacts. The only removable directory tree is the exact
`<current-session.jsonl>.children` sibling, including nested descendants and regular sidecar files. A symlink,
special entry or non-directory at that tree root refuses removal before switching. Before switching sessions it
scans all JSONLs recursively below the agent's `sessions` directory and the current session's directory. After
shutdown, it repeats that discovery and shared-reference scan before deleting artifacts, so references saved by
surviving sessions during replacement are retained. Descendant sessions being removed do not count as surviving
references. User-created forks, unrelated sessions and similarly named trees remain unchanged.

Only regular artifact files lexically and physically inside the OS temp directory are eligible. The agent directory
is used to validate/discover session JSONLs, not as an additional artifact root. Traversal components and symlink
leaves are rejected; resolving a parent symlink cannot escape the temp root. A symlink in session discovery or an
unreadable JSONL refuses removal before switching and names the offending file. Malformed JSONL lines, including
truncated tails, do not block removal: raw line text is scanned conservatively with JSON escapes decoded so shared
references on Windows remain protected. Reads are streamed asynchronously; each string/line is normalized once,
with one combined reference search and canonical-path sets rather than rescanning transcripts per artifact/alias.
Long scans periodically yield to the event loop. File read handles close before deletion, including on Windows.
The outgoing JSONL and descendant tree are reread after shutdown to include final output references. Descendant
files and their empty directories are removed before the parent JSONL. If cleanup fails after switching, the new
session remains active and the error identifies the old session file. Cleanup is not atomic: an error partway
through may leave some artifacts or descendants deleted and the old JSONL present.

**Limit:** Pi 1.4.0 names temp artifacts randomly, without session ownership metadata. Unreferenced temp files,
including spills from in-memory children and RQW-review's in-memory reviewers, cannot safely be attributed and
are left for OS temp cleanup. Persisted child JSONLs inside the owned tree do contribute artifact references.
Child runtimes are cancelled/disposed by their own native shutdown handlers; RQW-session adds no runtime tracking
or cross-extension dependency. RQW-anthropic's installation ID,
credentials, settings and other shared configuration are not session artifacts. User exports and remote/provider
copies are not erased. This is local permanent deletion, not forensic secure erasure.

## Clipboard on Windows / VDI

Uses Pi's exported `copyToClipboard`, exactly as `/copy` and `app.message.copy` do. On Windows Pi tries its native
clipboard, then `clip`. On a Windows VDI in a VS Code terminal without SSH markers this is the path used; clipboard
redirection to the user's local machine depends on the VDI environment. Pi additionally emits OSC 52 for SSH/Mosh
or `PI_CLIPBOARD_OSC52=1`. VS Code alone does not enable OSC 52; set that environment variable in the launching
environment if the terminal/client requires and supports OSC 52. The extension does not change owner settings.

## Switch off and proof

Follow [INSTALL.md](../../INSTALL.md#switch-one-extension-off) with
`-extensions/RQW-session/index.ts`, then `/reload` or restart. Both commands disappear without changing other
extensions. Tests: `test/extensions/RQW-session/session.test.ts`, `test/isolation.test.ts`.

Decision and research: [DECISIONS.md](../../DECISIONS.md#session-commands).

<!-- repo-index:start -->
## File map

Generated by `node scripts/repo-index.mjs --write` from the repository root.

| File | Responsibility |
| --- | --- |
| [`README.md`](README.md) | Hand-written contract and generated file map |
| [`artifacts.ts`](artifacts.ts) | Session artifact discovery and deletion boundaries |
| [`index.ts`](index.ts) | Pi extension entrypoint: Copy session ID and confirmed permanent session removal |

Tests: [`test/extensions/RQW-session/`](../../test/extensions/RQW-session/).
<!-- repo-index:end -->
