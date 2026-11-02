# RQW-cwd

A chat that starts in a system folder moves to the temp folder `os.tmpdir()` before the first paint.

## Folders

Only the exact folder matches; subfolders never do. Links are not resolved.

| system | folders |
| --- | --- |
| macOS | `/`, home, home `Downloads` |
| Windows | `C:\`, user profile, its `Downloads`, `C:\Users`, `C:\Program Files`, `C:\Windows` |

Windows ignores case, separator kind and a trailing separator. Other systems have no list.

## How

Runtime patch of Pi 1.5.0's `InteractiveMode.prototype.init` (`[D-SCOPE-RUNTIME-PATCH]`), installed by the extension
factory, which runs before the interactive mode starts. On the first init in a matching folder:

1. `process.chdir(os.tmpdir())`.
2. A new session for the temp folder: the default history folder becomes the temp group, an explicit `sessionDir`
   stays, `--no-session` stays in memory.
3. Pi's own `teardownCurrent("new")`, then the stored runtime factory `createRuntime` rebuilds settings, resources,
   extensions, tools and session for the temp folder; `apply` installs it.
4. Stock init then binds the new session, so footer, title and extensions see the temp folder.

Old session files are not moved or changed. A resumed chat from a system folder also starts a new temp chat.
Print and RPC modes do not use `InteractiveMode` and stay unchanged. The patch is inert after the first init.

## Fallback

- Another Pi version or init shape: no patch; a chat in a system folder gets a startup warning.
- Unknown runtime shape or a failed `chdir`: nothing changes, a warning after init.
- A failed rebuild: the original chat is rebuilt in its own folder with its own session, then a warning.

Decision: `DECISIONS.md` `[D-CWD-TEMP]`. Tests: `test/extensions/RQW-cwd/`.
