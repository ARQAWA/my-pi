# Windows analysis for RQW-tools (Pi 1.3.0, PowerShell -> Git Bash -> pi, no WSL, no admin)

Status: frozen evidence, the original read-only analysis on Pi 1.3.0. The package now pins Pi 1.4.0; the current
Windows behavior is in [DECISIONS.md, Tools](../DECISIONS.md#tools) and CI runs on `windows-latest`.

Read-only analysis for requirement 9 of `notes/tools-requirements.md` ("Works on macOS and on Windows ... Proof without
the owner's hands: GitHub Actions Windows runner and documentation").

`PI` below = `/Users/arkadijcukavin/stock-bench/pi/node_modules/@earendil-works/pi-coding-agent`. Line numbers are
from the unbundled `PI/dist/...` files. The `pi` binary runs `dist/bundle/cli.js` (`PI/package.json:9-11`), which
holds the same code in bundled chunks (`normalizeWindowsShellPath`, `detectLineEnding` and `fileMutationQueues` are in
`dist/bundle/chunks/chunk-66G7ITPS.js` / `chunk-WJUNYZC5.js`).

Status tags: **[code]** read in source, **[doc]** Pi docs, **[platform]** Windows/Node/MSYS behaviour from general
knowledge, must be confirmed by a probe, **[owner]** only the owner's machine can show it.

---

## 1. Shell, spawning, encoding, line endings, paths

### 1.1 How Pi picks the shell on Windows [code][doc]

`PI/dist/utils/shell.js:58-102` `getShellConfig(customShellPath)`:

1. `shellPath` from settings, must exist, else throws (`:60-65`). Settings key `shellPath`, `shellCommandPrefix`
   (`PI/docs/settings.md:142-143`).
2. `%ProgramFiles%\Git\bin\bash.exe`, then `%ProgramFiles(x86)%\Git\bin\bash.exe` (`:66-81`).
3. `where bash.exe`, first hit that exists (`:15-35`, `:83-86`).
4. Else throws "No bash shell found" with install hints (`:87-91`).

Legacy WSL `C:\Windows\System32\bash.exe` gets `-s` and the command on stdin; every other bash gets `-c <command>`
(`:8-14`). Docs: `PI/docs/windows.md:19-23`, `PI/docs/shell-aliases.md:83`.

Consequences for the owner:

- Git for Windows installed without admin ("Only for me", as `my-omp-harness/INSTALL.md:3` prescribes) lives in
  `%LOCALAPPDATA%\Programs\Git`, which step 2 never checks. It works anyway in the owner's chain because `pi` is started
  inside Git Bash: the Git Bash session's `PATH` (passed to node in Windows form) starts with `<Git>\mingw64\bin`,
  `<Git>\usr\bin`, so `where bash.exe` returns `<Git>\usr\bin\bash.exe`, the real MSYS bash. [platform]
- If `pi` is ever started from plain PowerShell with a per-user Git, the user `PATH` usually holds only `<Git>\cmd`, so
  Pi throws. Fix: `shellPath` in `~/.pi/agent/settings.json`, or our `bash` wrapper adds
  `%LOCALAPPDATA%\Programs\Git\bin\bash.exe` as a candidate before `where`. Prior art hard-codes the admin location and
  would fail here: `my-omp-harness/omp-vscode/extension.js:13` (`C:\Program Files\Git\bin\bash.exe`).
- `<Git>\bin\bash.exe` is a launcher that sets `MSYSTEM` and `PATH`; `<Git>\usr\bin\bash.exe` is plain MSYS bash and
  relies on the inherited `PATH`. Both work when the parent is Git Bash. [platform]

Our extension replaces `bash` and can call `createLocalBashOperations({ shellPath })` (`PI/dist/core/tools/bash.js:132-134`)
or its own spawn; `shellCommandPrefix` is applied only by Pi's built-in bash tool (`PI/docs/shell-aliases.md:148-150`),
so the wrapper must read and apply it itself if we want to keep it.

### 1.2 How bash commands are spawned [code]

`PI/dist/core/tools/bash.js:48-125`:

- `spawn(shell, ["-c", command], { cwd, detached: process.platform !== "win32", env, stdio: ["ignore","pipe","pipe"],
  windowsHide: true })` (`:63-69`). Plain `child_process.spawn`, not cross-spawn.
- Env = `getShellEnv()` (`shell.js:115-126`): copies `process.env`, finds the PATH key case-insensitively (`Path` vs
  `PATH`) and prepends `getBinDir()` = `~/.pi/agent/bin` (`PI/dist/config.js:519-520`), so bash commands see the
  downloaded `rg.exe`/`fd.exe`. Session vars `PI_SESSION_ID`, `PI_MODEL`... added in `bash.js:135-157`.
- Timeout/abort: `killProcessTree` runs `%SystemRoot%\System32\taskkill.exe /F /T /PID` (`shell.js:157-172`). On
  Windows there is no signal code; the timeout path is reported via the `timedOut` flag (`bash.js:84-109`).
- Exit wait: `waitForChildProcess` waits for both pipes, then a 100 ms idle grace after `exit`, re-armed on every
  chunk; the comment names Windows daemonized descendants that never let `close` fire
  (`PI/dist/utils/child-process.js:3`, `:13-104`).
- `shellCommandPrefix` is joined with `\n` (`bash.js:173`).

Windows-specific risks of this spawn path [platform]:

1. **Command-line length.** The whole command travels as one argv element through `CreateProcessW`, limit 32,767 UTF-16
   chars. A model writing a big heredoc through `bash` fails on Windows (ENAMETOOLONG/E2BIG-like spawn error) where
   macOS allows ~1 MB. Fix in our wrapper: on `win32`, when the command is longer than ~8 KB, write it to a temp file
   and run `bash <file>` (keeps stdin free; stdin transport `-s` would let the command eat its own script).
2. **MSYS command-line parsing.** Node/libuv quotes an argument only if it contains space, tab or `"`. MSYS (Cygwin)
   rebuilds argv from the Windows command line itself and expands globs and strips quotes in unquoted words. A command
   with no space, e.g. `ls*.txt` or `echo'x'`, can be altered before bash sees it. Cheap fix: make sure the command
   string always contains a space (e.g. prefix one space) so libuv wraps it in quotes. Probe it.
3. **MSYS path conversion for native programs.** When bash starts a native `.exe`, MSYS rewrites arguments that look
   like POSIX paths: `/c/x` -> `C:/x` (useful), but also `taskkill /F` -> `F:/`, `cmd /c` -> `C:/`, `/foo` ->
   `C:/Program Files/Git/foo`. Remedy per command: `MSYS_NO_PATHCONV=1 cmd` (Git for Windows) or `//F`. Do not set it
   globally: it would also kill the useful `/c/x` conversion. One line in the `bash` description on `win32` is enough.
4. **Process tree.** `taskkill /T` follows Windows parent PIDs; MSYS `fork`/`exec` create real Windows children, so the
   tree is visible. Background jobs that keep a pipe open are released by the 100 ms grace. Probe both.
5. **Speed.** Each call starts a fresh MSYS bash (fork emulation, AV scan): ~50-300 ms per call. Not a correctness
   problem; parallel calls are still independent processes.

### 1.3 Encoding [code][platform][owner]

- Bash output is decoded as streaming UTF-8 (`TextDecoder` in `PI/dist/core/tools/output-accumulator.js:19`, `:39-51`);
  invalid bytes become U+FFFD, no crash. `sanitizeBinaryOutput` drops control chars but keeps `\r` (`shell.js:133-136`).
- Arguments go through `CreateProcessW` (UTF-16), so Cyrillic commands and paths reach bash intact; MSYS defaults to
  `C.UTF-8` when `LANG` is unset. [platform]
- MSYS tools (coreutils, grep, git) print UTF-8. Native programs writing to a pipe use the ANSI or OEM code page:
  on a Russian Windows that is CP1251/CP866. Affected: `cmd`, Windows PowerShell 5.1 (`[Console]::OutputEncoding`
  OEM), Python without `PYTHONUTF8`, many .NET/Java tools. Output turns into U+FFFD mojibake. [owner: real code pages]
  Cheap mitigation in our bash env on `win32`: `PYTHONUTF8=1`, `PYTHONIOENCODING=utf-8`. `chcp.com 65001` affects only
  programs that use the console code page; not a general fix.
- `git` quotes non-ASCII file names (`core.quotepath=true` default) on both OSes: `"\320\237..."`. Optional env for the
  bash tool: `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.quotepath GIT_CONFIG_VALUE_0=off`.
- Windows PowerShell 5.1 `>`/`Out-File` writes **UTF-16LE with BOM**. The owner lives in PowerShell, so such files
  appear. Pi's `read` decodes every file as UTF-8 (`read.js:111-112`) and `edit` too (`edit.js:116-117`): a UTF-16 file
  reads as garbage with NULs and an edit writes it back as UTF-8, corrupting it. Same for legacy CP1251 text files
  (U+FFFD round-trip). Recommended guard for `read`/`edit` (all OSes): detect `FF FE`/`FE FF` BOM and refuse; for
  `edit`, refuse when `Buffer.from(text, "utf8")` does not equal the raw bytes (invalid UTF-8), so nothing is silently
  rewritten.

### 1.4 CRLF and BOM in read/edit/write/grep [code]

- **read**: `buffer.toString("utf-8").split("\n")` (`read.js:111-113`). CRLF lines keep a trailing `\r` in the text
  sent to the model; a UTF-8 BOM stays as an invisible U+FEFF at line 1. No transformation otherwise. With Git for
  Windows' default `core.autocrlf=true`, most working-tree files of the owner are CRLF, so every line costs one extra
  char of output. Recommendation: strip `\r` before `\n` in the displayed text (display only).
- **edit** keeps CRLF and BOM: `splitBom` (`PI/dist/utils/text.js:2-4`) -> `detectLineEnding` -> `normalizeToLF` ->
  apply -> `bom + restoreLineEndings(newContent, originalEnding)` (`edit.js:119-126`, `edit-diff.js:9-23`). `oldText`
  and `newText` are normalized to LF too (`edit-diff.js:217-218`), so a model that copies `\r` from `read` still
  matches. Limits:
  - the ending is chosen from the **first** line break only (`edit-diff.js:9-17`); a mixed file is rewritten entirely
    in that ending, and lone `\r` (old Mac) becomes the chosen ending (`edit-diff.js:18-20`): a whole-file diff from a
    one-line edit;
  - the write is an in-place `fs.writeFile(path, content, "utf-8")` (`edit.js:39-40`), not atomic.
- **write** writes the given content as is (`write.js:17`, `:44-47`): no BOM, no CRLF. Overwriting an existing CRLF or
  BOM file silently converts it to LF/no-BOM. With `autocrlf=true` git hides it; with `.gitattributes eol=crlf` or
  `autocrlf=false` it is a whole-file diff. Decision for the coordinator: either leave as stock, or (recommended, cheap,
  consistent with `edit`) when `write` overwrites an existing file, reuse that file's BOM and line ending.
- **grep**: rg is run without `--crlf` (`grep.js:93-100`), so on CRLF files a pattern ending in `$` does not match
  `foo\r\n`. Output lines are stripped of `\r` (`grep.js:138`, `:200-201`). Recommendation: pass `--crlf` (harmless on
  LF files) at least on `win32`.
- **find**: `\r` is stripped from fd output lines (`find.js:206`).

### 1.5 Path resolution [code]

`resolveToCwd` -> `resolvePath` -> `normalizePath` (`PI/dist/core/tools/path-utils.js:35-44`,
`PI/dist/utils/paths.js:59-87`):

| Input | Result on win32 | Evidence |
|---|---|---|
| `C:\x`, `C:/x`, `c:/x` | `path.resolve` -> `C:\x` / `c:\x` (drive case kept as typed) | `paths.js:83-87` |
| `/c/x`, `/C/x`, `/mnt/c/x`, `/cygdrive/c/x` | `C:\x` (drive upper-cased) | `paths.js:50-58`, `:67-69` |
| `/tmp/x`, `/usr/bin`, `/home/u` | not converted -> `path.resolve` -> `<current drive>:\tmp\x`. Git Bash maps `/tmp` to `%TEMP%`, `/usr` to `<Git>\usr`: **tool and bash disagree** | `paths.js:53-55` |
| `~`, `~/x`, `~\x` | `os.homedir()` = `%USERPROFILE%`. Git Bash `~` = `$HOME`; differs if the user set `HOME` | `paths.js:70-77` |
| `@x` | `@` stripped | `paths.js:64-66` |
| `file:///C:/x` | `fileURLToPath` | `paths.js:78-80` |
| `\\server\share\x`, `//server/share` | untouched (UNC) | `paths.js:51` |
| relative | against `ctx.cwd` | `path-utils.js:42-44` |
| unicode spaces | normalized to space | `paths.js:6`, `:61-63` |

`resolveReadPath` adds only macOS fallbacks (AM/PM narrow space, NFD, curly quote) (`path-utils.js:45-71`).

Universal form for the model on Windows: `C:/x` (works in Node, in MSYS bash without quoting backslashes, in rg/fd).
The prompt already says "absolute like `<home with forward slashes>`/..." (`extensions/RQW-prompt/index.ts:27-29`);
omp-lite said the same ("never /c/... or backslashes", `notes/prompt-concept.md:103`). Tool descriptions on `win32`
should warn about `/tmp` and other MSYS mount paths.

Output paths: grep and find relativize and convert to `/` (`grep.js:71-73`, `find.js:10-14`). The bash full-output
file is `join(os.tmpdir(), ...)` (`PI/dist/utils/output-files.js:16`) and is shown with backslashes
(`bash.js:243-249`); `cat C:\Users\...` in bash then breaks on the backslashes. Our wrapper should print it with `/`.
`read`'s own fallback hint puts the path unquoted into a bash command (`read.js:138-139`): breaks on spaces.

### 1.6 Case-insensitivity [code][platform]

NTFS (and default APFS on macOS) is case-insensitive, case-preserving.

- Pi's mutation queue key is `realpath(resolve(path))`, or `resolve(path)` if the file does not exist yet
  (`PI/dist/core/tools/file-mutation-queue.js:11-22`). Native `realpath` on Windows returns the on-disk case and an
  upper-case drive, so existing files serialize correctly; two **new** files `A.txt` and `a.txt` (or `c:/x` vs `C:/x`)
  in one batch get different keys and race.
- Our own barrier (bash waits for earlier write/edit of the same response, requirement 7) must compare keys
  case-insensitively on `win32` and `darwin`: `realpath` when the file exists, else `resolve(...).toLowerCase()`.
  Plus 8.3 short names (`C:\Users\RUNNER~1\...` on the runner): only `realpath` expands them.
- `write` to `foo.txt` when `Foo.txt` exists overwrites `Foo.txt` and keeps its name.
- rg `--glob` is case-sensitive by default even on Windows; fd uses smart case. Same as macOS.
- Prior art compares Windows paths lower-cased: `PI/dist/utils/windows-self-update.js` (`normalizePath(...).toLowerCase()`).

### 1.7 Path length [platform]

- Node's fs layer converts absolute paths with `path.toNamespacedPath` (`\\?\C:\...`) for most calls, so
  read/write/edit beyond 260 chars usually work without the `LongPathsEnabled` registry key (which needs admin).
- `spawn` with a `cwd` longer than ~258 chars fails in `CreateProcessW`: the bash tool cannot run in a very deep cwd.
- rg/fd (Rust std) handle long paths. Git needs `core.longpaths=true`.
- All three must be probed; the runner's registry state is not the owner's.

### 1.8 Reserved and invalid names [platform]

`CON PRN AUX NUL COM1-9 LPT1-9` (also with an extension, e.g. `nul.txt`, on most builds), names ending in `.` or space
(silently trimmed by Win32), chars `< > : " | ? *` and 0x00-0x1F. `a:b.txt` relative creates an NTFS alternate data
stream `b.txt` on file `a`. A `\\?\` path can create a real file named `nul` that Explorer cannot delete.
Pi has no guard. Recommendation: on `win32`, `write`/`edit` reject any path segment that is a reserved name, has a
forbidden char (except the drive colon), or ends in `.`/space, with a clear error. One small function.

---

## 2. rg and fd on Windows

[code] `PI/dist/utils/tools-manager.js`:

- Lookup (`:75-92`): first `getBinDir()/rg.exe` / `fd.exe` = `%USERPROFILE%\.pi\agent\bin\` (override root with
  `PI_CODING_AGENT_DIR`, `PI/dist/config.js:476`, `:491-497`); then system PATH by spawning `rg --version` /
  `fd --version` / `fdfind --version` (`:63-73`). libuv `spawnSync` resolves only `.exe`/`.com`, so `.cmd` shims do not
  count. Found on PATH -> the bare name is used.
- Download (`:228-288`), called lazily on the first grep/find (`grep.js:52-55`, `find.js:119-127`) through
  `ensureTool` (`:300-342`): latest version from the `github.com/<repo>/releases/latest` redirect, no API quota
  (`:99-121`); asset `ripgrep-<v>-x86_64-pc-windows-msvc.zip`, `fd-v<v>-x86_64-pc-windows-msvc.zip` (aarch64 for ARM)
  (`:34-37`, `:55-58`); saved to `<agentDir>\bin\`; extracted with `%SystemRoot%\System32\tar.exe` (bsdtar, reads zip),
  fallback `powershell.exe Expand-Archive` (`:180-214`); unique extract dir per call (`:251`); `renameSync` into place
  (`:273`). Everything is under the user profile: **no admin needed**.
- `PI_OFFLINE=1` skips download with a warning (`:12-17`, `:308-311`). No proxy support: no proxy handling in
  `PI/dist/utils/management-http.js` (grep "proxy": no hits). Node 22 `fetch` ignores `HTTPS_PROXY` and the Windows
  certificate store by default. [platform]
- Fallback when both lookup and download fail: none. grep/find return "ripgrep (rg) is not available and could not be
  downloaded" / "fd is not available ..." (`grep.js:53-55`, `find.js:124-127`). Git for Windows ships GNU `grep` and
  `find` in `usr/bin` but no rg/fd.

Risks:

1. **Parallel first use race.** No single-flight: two grep calls in one response both download, both `renameSync` onto
   `rg.exe`. On Windows replacing an `.exe` that the other call is already running fails with EPERM/EACCES, so one
   grep fails on the very first parallel batch (`tools-manager.js:248`, `:273`). Fix: our wrapper keeps one pending
   `ensureTool` promise per tool.
2. **AV/SmartScreen.** Files written by Node `fetch` carry no Mark-of-the-Web, and `CreateProcess` does not invoke
   SmartScreen, so no prompt. Defender scans the first launch (delay). [platform] Smart App Control (clean Windows 11
   installs), AppLocker/WDAC or a corporate EDR may block unsigned `rg.exe`/`fd.exe` in the profile: spawn error, grep
   unusable. [owner]
3. **Proxy/TLS interception** in a corporate network: download fails. [owner]

Owner-side fallbacks without admin: `winget install --scope user BurntSushi.ripgrep.MSVC sharkdp.fd` (links in
`%LOCALAPPDATA%\Microsoft\WinGet\Links`, on PATH), `scoop install ripgrep fd`, or copy `rg.exe`/`fd.exe` into
`%USERPROFILE%\.pi\agent\bin\`. Recommended tool behaviour: no automatic fallback; on failure the error text names
these three options and `git grep -n` / `grep -rn` through bash.

Windows-specific grep/find mechanics [code]: rg/fd are spawned with `child_process.spawn` without `windowsHide`
(`grep.js:101`, `find.js:161`); for a pattern with `/`, find adds `--full-path` and rewrites `/` to `[/\\]` on
`win32` (`find.js:147-158`); `--hidden` covers dotfiles and files with the Windows hidden attribute.

---

## 3. File locking

[platform] Windows opens files with share modes. libuv opens with `FILE_SHARE_READ|WRITE|DELETE`, so Node readers
never block each other. Errors appear when another process holds the file without those share flags:

| Operation | Typical holder | Error from Node |
|---|---|---|
| `writeFile` (in place, `CREATE_ALWAYS`/truncate) | Office, some IDE/indexers, backup, OneDrive/Dropbox sync, AV mid-scan | `EBUSY` (sharing violation) |
| `writeFile` on a file with **hidden** or **system** attribute | none needed: `CREATE_ALWAYS` refuses | `EPERM` |
| `writeFile` on a **read-only** file | none | `EPERM` |
| `rename(tmp, target)` replacing target | target open without `FILE_SHARE_DELETE` (AV, indexer, sync, editor preview) or delete pending | `EPERM` / `EACCES` (`ERROR_ACCESS_DENIED`) |
| `rename` onto a running `.exe` | the process | `EPERM` |
| `unlink`/`rm` | same holders | `EBUSY`/`EPERM` (Node `fs.rm` has `maxRetries` for these) |

Stock Pi: in-place `fs.writeFile` with no retry for both `write` and `edit` (`write.js:17`, `edit.js:39-40`);
serialization only inside one Pi process (`file-mutation-queue.js:27-50`).

Is atomic temp+rename safe on Windows? Only with retries, and it is not more robust than in-place there:

- the replace step is exactly the operation AV/indexers/sync clients break most often (the reason npm's `graceful-fs`
  retries `rename` on `EACCES`/`EPERM`/`EBUSY` on win32 for up to 60 s);
- it drops explicit ACLs, alternate data streams, hard links, the read-only/hidden attributes, and changes the file ID;
- a crash leaves `*.tmp` files that watchers and rg see.

Recommendation (simplest that works on both OSes):

1. Keep in-place `writeFile` for `write` and `edit`, as stock.
2. Wrap the write (and the read in `edit`) in a bounded retry on `EBUSY`, `EPERM`, `EACCES`, win32 only: e.g. 8
   attempts, backoff 25 -> 50 -> 100 -> 200 -> 400 ms, total under ~2 s, then fail with "file is locked by another
   process or read-only: <path>". Bounded so a parallel batch never hangs.
3. For `EPERM` on an existing file, retry once with flag `r+` + `truncate` (works for hidden/system files; still fails
   for read-only, which is the correct answer).
4. If the coordinator chooses temp+rename for macOS atomicity, the same retry must wrap the `rename`, and after the
   budget it must fall back to in-place write and delete the temp file.

---

## 4. Node vs Bun

- Pi needs Node `>=22.19.0` (`PI/package.json:94-96`). On Windows the documented install is npm
  (`npm install -g --ignore-scripts @earendil-works/pi-coding-agent`, `PI/docs/quickstart.md:15-18`); the `pi.dev`
  installer is for macOS/Linux (`:9-12`). So on the owner's machine our extension runs under **Node**. A Bun-compiled
  `pi` exists only as a build target (`build:binary` in `PI/package.json`; `isBunBinary` in `PI/dist/config.js:18-20`).
  Rule: only `node:` builtins, no `Bun.*`.
- The `pi` CLI is a Node bundle with `isBundledNode = true`, so extensions get `@earendil-works/pi-coding-agent` from
  the bundle's virtual modules (`dist/bundle/chunks/chunk-66G7ITPS.js`: `usesEmbeddedModules=...||isBundledNode` ->
  `virtualModules`), while `import` of the package from plain Node resolves to the unbundled `dist/index.js`
  (`PI/package.json:12-21`, alias path `PI/dist/core/extensions/loader.js:33-84`, `:471-477`). Two module instances =
  two `fileMutationQueues` maps. Probes must load through `dist/bundle/index.js` to match the CLI.
- Node behaviour on Windows that our code must respect [platform]:
  - `{...process.env}` is a plain, case-sensitive object, but Windows env is case-insensitive: setting `env.PATH` when
    the key is `Path` creates two keys and the child sees an undefined one. Reuse Pi's lookup (`shell.js:117`).
  - `spawn` of `.cmd`/`.bat` without `shell: true` throws `EINVAL` since the April 2024 security fix (Node 18.20.2,
    20.12.2, 21.7.3+). Pi uses `cross-spawn` for such cases (`PI/dist/utils/child-process.js:4-11`).
  - `child.kill()` is `TerminateProcess`, no tree, no graceful signal; use `taskkill /T` as Pi does.
  - `os.homedir()` = `USERPROFILE`, not `HOME`; `os.tmpdir()` may be an 8.3 short path; `os.EOL` is `\r\n` (never use
    it for file content).
  - `fs.realpath` (native) returns canonical case and expands 8.3 names; `path.resolve` keeps the typed case.
  - `stat().ino` is the NTFS file index (bigint), so `getFileRevision` (`paths.js:21-29`) works; on FAT/exFAT ino is 0.
  - Node 22 `fetch` does not use system proxy or system CA store by default.
- Related bug outside the tools, same package: `extensions/RQW-prompt/index.ts:13-22` checks `join(dir, name)` with
  `X_OK`; on Windows the files are `git.exe`, `node.exe`, so the Environment line reports "none found". Needs
  `PATHEXT` (`.exe`, `.cmd`) on `win32`.

---

## 5. Proof plan without the owner

### 5.1 What the runner gives [platform]

- `windows-latest` (Windows Server 2025 image) and `windows-2022`: Git for Windows in `C:\Program Files\Git`;
  `shell: bash` = `C:\Program Files\Git\bin\bash.EXE --noprofile --norc -e -o pipefail {0}` (Git Bash). PowerShell 7
  (`pwsh`) and Windows PowerShell 5.1 present. Node preinstalled; pin with `actions/setup-node`.
- `npm i -g` works without extra rights (global prefix on PATH). Public repo `ARQAWA/my-pi`: standard runners free.
- The runner user is an administrator, the system locale is en-US (ACP 1252 / OEM 437), the profile path contains an
  8.3 short name in `TEMP` (`C:\Users\RUNNER~1\...`). Defender state is unknown: the workflow logs it.
- Per-user Git is simulated: extract PortableGit into `%LOCALAPPDATA%\Programs\Git`, hide the system Git from Pi's
  lookup by pointing `ProgramFiles`/`ProgramFiles(x86)` to an empty dir, and start the chain exactly like the owner:
  `pwsh` -> portable `bash.exe -l` -> `node`.

### 5.2 Probe harness

`probes/windows/run.mjs` (plain Node, no model):

1. `const root = execSync("npm root -g")`; `import(pathToFileURL(join(root, "@earendil-works/pi-coding-agent/dist/bundle/index.js")))`
   to get `discoverAndLoadExtensions` and the stock `create*ToolDefinition` from the same bundle as the CLI.
2. `discoverAndLoadExtensions([repoDir], workDir, agentDir)`; take `extension.tools.get(name).definition` for `read`,
   `bash`, `edit`, `write`, `grep`, `find` (registration stores `{ definition }`, `loader.js:231-241`).
3. Call `definition.execute(id, params, signal, onUpdate, ctx)` with a minimal `ctx` (`cwd`, a stub `sessionManager`
   with `getSessionId()`/`getSessionFile()`), and for parallel probes start several `execute` in one tick, as Pi does
   for one response.
4. Run each probe against our tools and against the stock definitions; write `report.json` (probe, tool, ours, stock,
   pass/fail, timings) and exit non-zero on any failure of ours. Stock results are recorded, not asserted.
5. All test files live under `<RUNNER_TEMP>/проба с пробелом é 🚀/ws`; a second pass uses the 8.3 form of the same
   dir.

### 5.3 Windows-specific probes

| ID | Probe | Pass condition (ours) |
|---|---|---|
| W1 | Shell resolution: default; ProgramFiles hidden + portable Git; `shellPath`; nothing found | bash path logged; per-user Git found; clear error when none |
| W2 | Quoting: `'..'`, `"..\"..\\.."`, `$'\t'`, multi-line, Cyrillic+emoji args, space-less `ls*.txt`, `echo'x'` | output byte-identical to expected |
| W3 | 40,000-char command (heredoc) | succeeds (stock: spawn error expected) |
| W4 | Encoding: `printf 'Привет'`; `cmd //c echo Привет`; `python -c "print('Привет')"` with/without `PYTHONUTF8`; `powershell -c "'Привет'"`; `printf '\xff'` | UTF-8 cases exact; native cases recorded; no crash |
| W5 | Timeout/abort: `sleep 30` timeout 1; `(sleep 60 &); sleep 60` aborted; `(sleep 5 &); echo done` | returns < 3 s; `tasklist` shows no leftover `sleep.exe`; `done` returns < 1 s |
| W6 | MSYS path conversion: `cmd /c echo hi` vs `MSYS_NO_PATHCONV=1 cmd /c echo hi`; `node -e` with `/c/x` arg | documented behaviour matches description |
| W7 | Path forms for every tool: `C:\x`, `C:/x`, `c:/x`, `/c/x`, `/cygdrive/c/x`, `sub\f`, `~`, `~/x`, `~\x`, `@x`, `file:///C:/x`, mixed `C:/a\b`, UNC `\\localhost\C$\...`, 8.3 path | all resolve to the same file |
| W8 | `/tmp/x` in write vs `ls /tmp/x` in bash | divergence documented / handled as decided |
| W9 | Case: write `Foo.txt`, read `foo.txt`; one batch writes new `A.txt` + `a.txt`; one batch write `Foo.txt` + bash `cat foo.txt` | deterministic final content; bash sees new content |
| W10 | Long path: 300-char dir chain for write/read/edit/grep/find; bash with that cwd | fs tools pass; bash error is clear |
| W11 | Reserved/invalid: `nul`, `CON.txt`, `aux.js`, `com1`, `a:b.txt`, `x.`, `x `, `a<b` | clear refusal, no file or ADS created |
| W12 | CRLF edit: byte-exact outside the change; mixed-ending file; lone CR; UTF-8 BOM kept | CRLF and BOM kept; mixed case as decided |
| W13 | write over CRLF/BOM file | as decided (keep ending/BOM recommended) |
| W14 | UTF-16LE file made by `powershell.exe -c "'x' > f"`; CP1251 file | read warns, edit refuses, file bytes unchanged |
| W15 | read of CRLF file | no `\r` in displayed text (if adopted) |
| W16 | grep `foo$` on CRLF file; context lines; Cyrillic file names; files with hidden attribute | match found; paths with `/` |
| W17 | find `src/**/*.ts`, `*.TS`, Cyrillic names, `.gitignore` | same results as macOS fixture |
| W18 | Lock: hold target with `[IO.File]::Open(p,'Open','ReadWrite','None')` for 1.5 s, then write/edit | succeeds after retry (stock: `EBUSY`) |
| W19 | Lock held 10 s | fails within the retry budget with the locked-file message |
| W20 | Share without Delete (`'ReadWrite'`) during write | in-place write OK (rename path would `EPERM`) |
| W21 | `attrib +h` file -> write/edit; `attrib +r` -> write/edit | hidden OK via `r+`; read-only clear error |
| W22 | rg/fd provisioning: empty `PI_CODING_AGENT_DIR`, no rg on PATH, 4 parallel greps + 2 finds first call | one download each, no `EPERM`, all calls succeed; time logged |
| W23 | `PI_OFFLINE=1`, no rg | clear error naming winget/scoop/manual copy |
| W24 | Env: child PATH has one PATH key with `<agentDir>\bin`; `HOME` vs `USERPROFILE` `~` | single key; `~` mismatch recorded |
| W25 | Truncated bash output: full-output path readable by `read` and by `cat` in bash | both succeed |
| W26 | Full macOS race suite (requirement 7) rerun on Windows | identical verdicts |
| W27 | `pi --version` and a load smoke: `discoverAndLoadExtensions` returns no errors; tool names/params unchanged | pass |

Matrix: `windows-latest` and `windows-2022`; Node `22.19.0` (minimum) and `24`; Git `system` and `portable`.
Optional `windows-11-arm` (aarch64 rg/fd assets exist in `tools-manager.js:34-37`, `:55-58`).

### 5.4 Workflow sketch

```yaml
# .github/workflows/windows-probes.yml
name: windows-probes
on:
  workflow_dispatch:
  push:
    paths: ["extensions/**", "probes/**", ".github/workflows/windows-probes.yml"]

jobs:
  probes:
    strategy:
      fail-fast: false
      matrix:
        os: [windows-latest, windows-2022]
        node: ["22.19.0", "24"]
        git: [system, portable]
    runs-on: ${{ matrix.os }}
    defaults:
      run:
        shell: bash
    env:
      PI_VERSION: 1.3.0
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}

      - name: Facts
        shell: pwsh
        run: |
          node --version; git --version
          where.exe bash.exe; where.exe rg.exe; where.exe fd.exe
          [Console]::OutputEncoding; (Get-Culture).Name; Get-WinSystemLocale
          Get-ItemProperty HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem -Name LongPathsEnabled -ErrorAction SilentlyContinue
          Get-MpComputerStatus -ErrorAction SilentlyContinue | Select-Object RealTimeProtectionEnabled
          ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole('Administrators')
          $env:TEMP

      - name: Install Pi
        run: |
          npm i -g --ignore-scripts "@earendil-works/pi-coding-agent@${PI_VERSION}"
          pi --version

      - name: Workspace with spaces and non-ASCII
        run: |
          WS="$RUNNER_TEMP/проба с пробелом é 🚀"
          mkdir -p "$WS/ws" "$WS/agent"
          cp -r "$GITHUB_WORKSPACE" "$WS/my-pi"
          echo "WS=$WS" >> "$GITHUB_ENV"

      - name: Probes (system Git Bash)
        if: matrix.git == 'system'
        env:
          PI_CODING_AGENT_DIR: ${{ runner.temp }}\pi-agent-system
        run: node "$WS/my-pi/probes/windows/run.mjs" --repo "$WS/my-pi" --work "$WS/ws" --report "$WS/report.json"

      - name: Portable Git (per-user, no admin)
        if: matrix.git == 'portable'
        shell: pwsh
        run: |
          $rel = Invoke-RestMethod https://api.github.com/repos/git-for-windows/git/releases/latest -Headers @{ Authorization = "Bearer ${{ github.token }}" }
          $asset = $rel.assets | Where-Object name -like 'PortableGit-*-64-bit.7z.exe' | Select-Object -First 1
          Invoke-WebRequest $asset.browser_download_url -OutFile "$env:RUNNER_TEMP\pg.exe"
          & "$env:RUNNER_TEMP\pg.exe" -y -o"$env:LOCALAPPDATA\Programs\Git" | Out-Null

      - name: Probes (PowerShell -> portable Git Bash -> node, Program Files Git hidden)
        if: matrix.git == 'portable'
        shell: pwsh
        run: |
          New-Item -ItemType Directory -Force "$env:RUNNER_TEMP\nowhere" | Out-Null
          $env:ProgramFiles = "$env:RUNNER_TEMP\nowhere"
          ${env:ProgramFiles(x86)} = "$env:RUNNER_TEMP\nowhere"
          $env:PI_CODING_AGENT_DIR = "$env:RUNNER_TEMP\pi-agent-portable"
          $env:PATH = ($env:PATH -split ';' | Where-Object { $_ -notlike '*\Program Files\Git*' }) -join ';'
          $bash = "$env:LOCALAPPDATA\Programs\Git\bin\bash.exe"
          & $bash -lc 'node "$WS/my-pi/probes/windows/run.mjs" --repo "$WS/my-pi" --work "$WS/ws" --report "$WS/report.json"'
          if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: report-${{ matrix.os }}-node${{ matrix.node }}-${{ matrix.git }}
          path: ${{ runner.temp }}/**/report.json
```

Notes on the sketch: `$WS` is set through `GITHUB_ENV`, so the pwsh step passes it to the portable bash via the
environment; the lock probes (W18-W20) start a `pwsh` helper from inside `run.mjs` that opens the file and sleeps;
the PortableGit release lookup uses the API with the workflow token to avoid the anonymous quota.

### 5.5 What only the owner's machine can show

1. Real code pages (Russian ACP 1251 / OEM 866) and the output of the native tools the owner actually uses.
2. Defender or a third-party AV/EDR: lock timing, scan delays, and whether unsigned `rg.exe`/`fd.exe` in the profile
   are allowed (Smart App Control, AppLocker/WDAC).
3. Corporate proxy or TLS interception for the rg/fd download and for `pi install git:...`.
4. Where his Git is installed, his Git Bash `PATH`/`HOME`, and his git config (`autocrlf`, `longpaths`, `quotepath`).
5. A non-admin account (the runner is admin), `LongPathsEnabled` on his machine.
6. Projects inside OneDrive-redirected folders (Files On-Demand placeholders, sync locks) and a Cyrillic user name in
   the profile path.
7. His editor's locking behaviour and the TUI in his terminal (Windows Terminal key handling,
   `PI/docs/windows.md:65-67`).

---

## Summary of recommended changes for RQW-tools on win32

1. `bash`: candidate `%LOCALAPPDATA%\Programs\Git\bin\bash.exe`; temp-script transport for commands over ~8 KB;
   always-quoted command arg; `PYTHONUTF8=1`/`PYTHONIOENCODING=utf-8`; full-output path with `/`; PATH key reused.
2. `write`/`edit`: bounded retry on `EBUSY`/`EPERM`/`EACCES`; `r+` fallback for hidden files; reserved/invalid name
   guard; refuse UTF-16 and invalid UTF-8 in `edit`; optional: `write` keeps an existing file's ending and BOM.
3. Barrier keys: `realpath` or lower-cased `resolve` on `win32`/`darwin`.
4. `read`: strip `\r` before `\n` in displayed text.
5. `grep`: `--crlf`; single-flight `ensureTool` for rg and fd; actionable error when unavailable.
6. Descriptions on `win32`: use `C:/...` paths; `/tmp` differs between bash and tools; `MSYS_NO_PATHCONV=1` for
   native commands with `/flags`.
7. Outside tools: `extensions/RQW-prompt/index.ts:13-22` needs `PATHEXT` on Windows.
