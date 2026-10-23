# Draft: `bash` tool description and the system-prompt change

Status: frozen draft, not the current text; see `extensions/RQW-tools/descriptions/bash.md` and
`extensions/RQW-prompt/SYSTEM.md`.

Sources: `notes/tools-requirements.md` (items 1, 3, 4, 6, 7, 8, 9), `notes/analysis-pi-tools.md` 1.4 and 4,
`notes/analysis-omplite-tools.md` bash and 4, `notes/analysis-windows.md` 1.2, 1.3, 1.5,
omp-lite `extensions/tools/bash/description.md`, `extensions/RQW-prompt/SYSTEM.md`.

`{BASH_CHARS}` is the character cap the coordinator measures (item 8). Parameters stay Pi's: `command`, `timeout`.

## Part 1. `bash` tool

### description (all platforms)

```text
Run a command in a fresh bash shell in the working directory; returns stdout and stderr together.
- One fact per command or pipeline; chain dependent steps with `&&`. Nothing carries over between calls: `cd`, exported variables and functions last only for that command.
- Without `timeout` (seconds) a command has no deadline. Set it for builds, tests, installs and anything that may hang. A command that does not exit, such as a server or watcher, holds the call until its timeout kills it with all its child processes.
- Search and read with the grep, find and read tools, not with rg, grep, find, cat, head or sed in the shell. Use bash for git, builds, tests and running programs.
- In one response a bash call starts only after every write and edit placed before it has finished, so it sees their result; a write or edit placed after it waits for it to finish. All other calls run in parallel: put independent commands in separate calls of the same response.
- Only the last {BASH_CHARS} characters of output are shown; the full output is then saved to a file named in the result. Read that file with read or grep instead of running the command again.
- A non-zero exit code marks the result as an error and is reported with the output.
```

### description, extra lines on win32 only

```text
- The shell is Git Bash. Write paths as `C:/dir/file` with forward slashes. `/tmp` and other mount paths point to different directories in bash and in the file tools; use `C:/...` paths for files both touch.
- Before a native Windows program whose arguments start with `/`, such as `cmd /c` or `taskkill /F`, put `MSYS_NO_PATHCONV=1`, or bash rewrites those arguments into paths.
- Native Windows programs may print in the console code page instead of UTF-8; garbled letters in their output are an encoding issue, not wrong data.
```

Conditional line, only if the wrapper does not move long commands into a temp script (`analysis-windows.md` 1.2 item 1):

```text
- A command is limited to about 32,000 characters; write a long script to a file with write and run `bash <file>`.
```

### parameters

| Name | Description |
|---|---|
| `command` | `Bash command to run.` |
| `timeout` | `Seconds before the command and its child processes are killed. No deadline when omitted.` |

Not carried over from omp-lite: persistent shell, `eval`, `cwd`, `pty`, internal URIs, `block_until_ms`, `bg_N`,
background jobs, services, `artifact://`, "No head/tail/redirection". Pi's own guideline about `PI_*` variables never
reaches the model (custom prompt drops `promptGuidelines`, `analysis-pi-tools.md` 4) and is not added.

## Part 2. `extensions/RQW-prompt/SYSTEM.md`

### Change 1: `<search_method>` (lines 22-26)

Old:

```text
<search_method>
- This harness has no search tool: search the workspace with `rg` through bash; it respects .gitignore. Read files with the read tool. Supply a regex pattern and escape metacharacters, e.g. "functionCall\(", "\{", "\}". Prefer `-t <type>` over broad `-g` globs. The default scope is the workspace root; give a path to narrow it.
- You have the capability to call multiple tools in a single response. It is always better to speculatively run multiple searches and read multiple files as a batch that are potentially useful. Read every file that may relate to the subject in one response.
- Search greedily in waves, broad first, then narrower. First response: several broad `rg -n` searches as separate parallel bash calls, printing matching lines without a match limit, one per facet of the subject, each putting every name, synonym and spelling into one alternation, plus `rg --files -g` for the deploy, run and entrypoint files (compose, Dockerfile, Makefile, systemd, CI, main, bin, __main__). Each next response, in one batch: read with read without offset or limit the files whose matching lines show a definition, configuration or entrypoint of the subject, and those run files; read other hits only around their matching lines with offset and limit; continue longer files from the returned offset; and `rg` the exact identifiers just found. Stop when every part of the question has an answer backed by a file and line, covering every implementation, caller and config key of the subject itself; do not follow the subject into neighbouring subsystems the question does not ask about.
</search_method>
```

New:

```text
<search_method>
- Search with the grep and find tools and read files with read, following the method in the grep description. Put every search and read that may relate to the subject into one response.
</search_method>
```

### Change 2: line 14 in `<general>` ("globs" names no Pi tool)

Old:

```text
- Put every tool call that does not need another call's result into the same response: searches, globs, file reads, writes and edits of different files, and shell commands all run at the same time. Use a separate response only when a call needs an earlier call's output, and gather all changes to one file into one edit call.
```

New:

```text
- Put every tool call that does not need another call's result into the same response: searches, file finds, file reads, writes and edits of different files, and shell commands all run at the same time. Use a separate response only when a call needs an earlier call's output, and gather all changes to one file into one edit call.
```

No other line in `SYSTEM.md` mentions `rg`, a missing search tool or shell search. `index.ts:33`
("the bash tool runs bash") stays true on Windows, where it runs Git Bash.
