# Draft: `grep` tool description

Status: frozen draft, not the current text; see `extensions/RQW-tools/descriptions/grep.md`.

Name and parameters stay exactly as in Pi: `pattern`, `path`, `glob`, `ignoreCase`, `literal`, `context`, `limit`.
`{GREP_CHARS}` is the character budget the coordinator measures. Source keys: `OL` = omp-lite
`extensions/tools/grep/description.md` (line N) or `glob/description.md`; `SM` = `extensions/RQW-prompt/SYSTEM.md`
`<search_method>`; `OD:N` = `~/Documents/ChatGPT/my-omp-harness/DECISIONS.md` line N; `PA` = `notes/analysis-pi-tools.md`
1.8; `OA` = `notes/analysis-omplite-tools.md`; `R` = `notes/tools-requirements.md` item.

## 1. Description

```text
Search file contents with ripgrep; respects .gitignore. Returns matching lines as path:line: text, paths relative to path.

- Use this tool instead of rg or grep through bash.
- Default scope is the working directory; set path (a directory or one file) to narrow it.
- pattern is a regex: escape metacharacters, e.g. "functionCall\(", "\{", "\}", or set literal.
- Output is cut at {GREP_CHARS} characters, with no match cap unless you set limit. If it ends with a truncation notice, narrow pattern, path or glob.
- Call multiple tools in one response: it is always better to speculatively run several searches and read several files as a batch that are potentially useful.
- Search greedily in waves, broad first, then narrower. First response: several broad grep searches in parallel without limit, one per facet of the subject, each putting every name, synonym and spelling into one alternation, plus find for the deploy, run and entrypoint files (compose, Dockerfile, Makefile, systemd, CI, main, bin, __main__). Each next response, in one batch: read with read without offset or limit the files whose matching lines show a definition, configuration or entrypoint of the subject, and those run files; read other hits only around their matching lines with offset and limit; continue longer files from the returned offset; and grep the exact identifiers just found. Stop when every part of the question has an answer backed by a file and line, covering every implementation, caller and config key of the subject itself; do not follow the subject into neighbouring subsystems the question does not ask about.
```

## 2. Parameters

| Parameter | Description |
|---|---|
| `pattern` | Regex in ripgrep syntax; put every name, synonym and spelling into one alternation, e.g. "createUser\|create_user". |
| `path` | Directory or file to search, relative to the working directory or absolute (default: working directory). |
| `glob` | Filter files by one glob, e.g. '*.ts', '**/*.spec.ts' or '*.{ts,tsx}'. |
| `ignoreCase` | Case-insensitive search (default: false). |
| `literal` | Treat pattern as a plain string, not a regex (default: false). |
| `context` | Lines to show before and after each match (default: 0); they count against the {GREP_CHARS}-character budget. |
| `limit` | Maximum number of matches (default: no cap; output is still cut at {GREP_CHARS} characters). |

## 3. Reasons, line by line

Description:

1. "Search file contents with ripgrep; respects .gitignore." OL:1-3 ("Search the workspace with ripgrep", "respects
   .gitignore"); Pi spawns `rg` and its stock text says "Respects .gitignore" (PA, `grep.js:34, 93-99`). Tells the model
   ignored files will not show, so it does not distrust an empty result.
2. "path:line: text, paths relative to path." Pi output format (PA, `grep.js:145-147, 206`). Without it the model
   passes a path relative to the search dir to `read` from the working directory and gets "not found" when `path` is
   a subdirectory.
3. "Use this tool instead of rg or grep through bash." OL:3. Needed because `SM` and bench41 trained the method on `rg`
   through bash (OD:169); R4 moves search into the tool and the prompt must stop pointing at bash.
4. "Default scope is the working directory; set path to narrow it." OL:4, rewritten: Pi resolves `path` against cwd
   (`resolveToCwd(searchDir || ".")`, `notes/analysis-pi-tools.md:41`), so no "absolute path" demand; "one file" since
   Pi accepts a file (PA schema).
5. "pattern is a regex: escape metacharacters ... or set literal." OL:5 and SM line 1; `literal` is the Pi way to skip
   escaping (`--fixed-strings`, PA). Unescaped `(` or `{` make rg fail or match wrong.
6. "Output is cut at {GREP_CHARS} characters, with no match cap ...; narrow pattern, path or glob." OL:9 rewritten
   (no `head_limit`). Mechanic change per OA grep table row 1: Pi's default 100 matches truncates exactly the broad
   alternation wave; OD:27 and OD:113: with a 15 000 budget the first wave listed only file names and missed
   `config.rs`/`config.toml`, at 100 000 content mode returned.
7. "Call multiple tools in one response ... as a batch." `glob/description.md:6` and SM line 2 (moves here per R4).
   Cost model: a step costs about 2.2 s plus 1.16 s per 100 output tokens, a batch saves a whole step (OD:44). "Read
   every file that may relate to the subject in one response" is left to the `read` description (OD:47, OA section 4).
8. Wave method and stop rule. OL:10, rewritten for Pi: "content mode without head_limit" -> "without limit", "glob"
   -> `find`, "continue from the returned line" -> "returned offset" (Pi's read notice gives an offset). Evidence:
   bench17 omp-lite read 27 files (122 KB) per run, half never cited, T05 spent 2-4 extra steps (OD:112); bench41 the
   same method as `SM` raised stock Pi by 10.2 / 6.2 / 1.9 quality points on gpt-6-sol low / gpt-6-sol medium /
   gpt-6.1-sol medium (OD:174, my-pi `DECISIONS.md` Scope).

Dropped from the sources, no behaviour on Pi: OL:6 `type` ("Prefer type over broad glob"; Pi has no `type`, and the
"wildcard globs bypass ignore rules" claim is about omp-lite's engine, OD:33); OL:7 `multiline`; OL:8 `-A/-B/-C`
(Pi has `context`, covered in its parameter text); SM "Prefer `-t <type>`" (no such parameter); `glob/description.md:2,4`
("works fast", "sorted by modification time", false for Pi `find`, OA section 4).

Parameters:

- `pattern`: Pi text "Search pattern (regex or literal string)" (PA schema) plus the alternation rule of OL:10, so the
  first wave puts every spelling into one call; "ripgrep syntax" because Pi passes it to `rg` unchanged.
- `path`: Pi text (PA schema) plus "relative or absolute", matching `resolveToCwd`.
- `glob`: Pi text and examples (PA schema); `*.{ts,tsx}` added because one string is the only filter Pi has after
  `type` is gone, and rg globs accept braces.
- `ignoreCase`, `literal`: Pi has no text for them (PA schema); one line each so the model knows `literal` replaces
  escaping (description line 5).
- `context`: Pi text (PA schema) plus the budget note: Pi re-reads each matched file and adds context lines itself
  (PA), so a large `context` on a broad wave eats the budget (OD:27 failure mode).
- `limit`: Pi name kept (R3); default changes from 100 matches to no cap (OA grep row 1, OD:27, OD:113).
