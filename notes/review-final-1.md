# RQW-tools: final review 1 (blind, read-only)

Object: HEAD `84fce0d` on main (clean tree): `extensions/RQW-tools/**`, `extensions/RQW-prompt/SYSTEM.md`,
`package.json`, `.github/workflows/tests.yml`, `INSTALL.md`, `AGENTS.md`.
Agreement: `notes/tools-requirements.md`. Design: `notes/tools-design.md`, `DECISIONS.md` "Tools".
Earlier: `notes/review-descriptions-1.md`, `notes/review-code-1.md` (finding 11 accepted, not re-raised).
Stock facts: Pi 1.3.0 in `node_modules/@earendil-works/`. Probes: `/tmp/rqwf/*.mjs` (scratch).

Checked and holding: `npm test` 96 tests, 95 pass, 1 skipped (win32 only), Node 26.7.0; CI run 39452722441 on HEAD
is green. Tool and parameter names, no `apply_patch`, no foreign product names in descriptions or `SYSTEM.md`,
`<search_method>` reduced to one line, barrier rules match analysis-races section 5, description claims about
ordering, limits, output format and bash behaviour match the code. Stock `executeToolCallsParallel` prepares every
call first, then starts every `execute` in message order in one tick, so registration order is message order.
Fixes for earlier findings 1-6 and 8-10 are in the code and have tests.

## Findings, ordered by severity

### 1. High: settings of an untrusted project reach `bash` (`shellCommandPrefix`, `shellPath`)

- `extensions/RQW-tools/index.ts:58-60`: `settings = SettingsManager.create(cwd, getAgentDir());`
  and `index.ts:72-74`: `settings ? { commandPrefix: settings.getShellCommandPrefix(), shellPath: settings.getShellPath() } : undefined`.
- Source: `SettingsManager.create` defaults to `projectTrusted: true` (`dist/core/settings-manager.js:238`
  `const projectTrusted = options.projectTrusted ?? true;`). Stock Pi builds the runtime settings with the trust decision:
  `dist/main.js:601` `SettingsManager.create(cwd, agentDir, { projectTrusted })`, and `projectTrusted` is `false` when
  the user declines the trust prompt, when `defaultProjectTrust` is `never`, or when there is no UI
  (`dist/core/project-trust.js:42-50`). `.pi/settings.json` is one of the trust-requiring resources
  (`dist/core/trust-manager.js:8-9`). Our package is a user-scope package, so it loads before trust is decided.
- Input: a cloned repo with `.pi/settings.json` = `{ "shellCommandPrefix": "echo INJECTED-BY-UNTRUSTED-PROJECT" }`;
  the user answers "untrusted" (or runs `pi -p` with no UI); the model runs `bash {command: "echo hello"}`.
- Observed (`/tmp/rqwf/probe1.mjs`, our factory, cwd = that repo): result `"INJECTED-BY-UNTRUSTED-PROJECT\nhello\n"`.
  Same project through stock settings with `projectTrusted: false`: `getShellCommandPrefix()` = `undefined`.
  A `shellPath` in the same file replaces the shell binary the same way. This is arbitrary command execution from an
  untrusted folder, which stock Pi blocks.
- Same cause, smaller effect: the settings are read from `process.cwd()` at load time, not from the session's
  settings manager, so an SDK `settingsManager` (`SettingsManager.inMemory({shellPath})`) and a resumed session whose
  cwd differs from the launch directory get other values than stock `_buildRuntime` (`agent-session.js:2935-2945`).
- Required outcome: `read` and `bash` get `autoResizeImages`, `commandPrefix` and `shellPath` from the same settings
  the session uses, with the trust decision applied (for example from `pi.getSettings()` / `ctx` at first execute or
  at `session_start`, not a private `SettingsManager.create`); a test shows a project `shellCommandPrefix` is ignored
  when the project is untrusted and applied when trusted.

### 2. Medium: the user cannot turn grep and find off with Pi's own selection mechanisms

- `extensions/RQW-tools/index.ts:104-130`: grep and find are registered without `defaultActive: false`, so
  `_refreshToolRegistry` (`agent-session.js:2908-2912`, `includeAllExtensionTools`) activates them whatever the
  user selected; `index.ts:135`: `const TOOL_FLAGS = ["--tools", "--exclude-tools", "--no-tools"];`.
- Input and observed effect (real `createAgentSession`, same options with and without our extension; probe run as a
  throwaway test file):

  | Selection | Stock Pi | With RQW-tools |
  |---|---|---|
  | `tools: ["-grep"]` (`--tools -grep`) | bash,edit,read,write | bash,edit,**find,grep**,read,write |
  | `tools: ["+grep","-find"]` | bash,edit,grep,read,write | bash,edit,**find**,grep,read,write |
  | `defaultTools: ["-grep"]` | bash,edit,read,write | bash,edit,**find,grep**,read,write |
  | `defaultTools: ["read","bash"]` | bash,read | bash,**find,grep**,read |
  | `noTools: "builtin"` (`--no-builtin-tools`) | (none) | **find,grep** |
  | `excludeTools: ["grep"]` | bash,edit,read,write | bash,edit,**find**,read,write |

  On resume or fork the handler also re-adds grep and find after `defaultTools` without them, after
  `--no-builtin-tools`, and after the short flags `-t`, `-xt`, `-nt`, `-nbt` (`dist/cli/args.js:108-127`), since only
  the three long flags are checked. The pipeline test `a read-only defaultTools setting stays read-only` lists grep
  and find in the setting, so it cannot see this. `notes/review-code-1.md` finding 2 required that grep and find
  "respects an explicit `-grep`/`-find`"; that part is not met.
- Required outcome: `-grep`/`-find` modifiers (CLI and `defaultTools`), `--no-builtin-tools`, and a `defaultTools`
  list without them give the same active set as stock; grep and find are added only when the user's selection is the
  default one; the resume check covers every flag spelling. A pipeline test runs the rows above.

### 3. Medium: multi-file calls drop files from the compaction summary

- `pi-coding-agent/dist/core/compaction/utils.js:38`: `const path = typeof args?.path === "string" ? args.path : undefined;`
  is the only source of `<read-files>` / `<modified-files>` that the model gets after compaction and in branch summaries.
- Input: `write {files: [{path: "a.ts", ...}, {path: "b.ts", ...}]}` -> neither file is listed;
  `edit {path: "a.ts", edits: [{path: "b.ts", ...}]}` -> `a.ts` listed as edited, `b.ts` missing;
  `edit {edits: [{path: "a.ts", ...}, {path: "b.ts", ...}]}` -> nothing listed. Single-file stock calls list every file.
- This is the open half of `notes/review-code-1.md` finding 7 ("the compaction file list stays correct for multi-file
  calls ... or documented as a known gap in DECISIONS.md"); neither is done (`DECISIONS.md` and `tools-design.md`
  have no mention of compaction).
- Required outcome: the files of multi-file calls appear in the compaction file lists (for example through
  `session_before_compact`), or the gap is recorded in `DECISIONS.md` as an accepted regression.

### 4. Low: a read whose fallback spelling is created earlier in the same response is not ordered after it

- `extensions/RQW-tools/keys.ts:78`: `paths = [typeof args.path === "string" ? readPathFor(args.path, cwd) : args.path];`
  `readPathFor` checks the disk when the call registers; stock `read` resolves the fallback later, when it runs
  (`dist/core/tools/read.js:73` `resolveReadPathAsync`).
- Input (one response): `write {path: "it’s.txt", content: "NEW"}`, then `read {path: "it's.txt"}`; neither file exists.
  The read key is the straight-quote path (nothing exists yet), the write key the curly one: no conflict, both start.
- Observed (`/tmp/rqwf/probe2.mjs`, 30 runs): the read fails with "not found" 30/30, although the file it would open
  exists once the earlier write finished. The NFD fallback on Linux behaves the same. Stock Pi has the same outcome,
  so the effect is only that the barrier does not cover this case.
- Required outcome: either the read scope also covers the fallback spellings (AM/PM, NFD, curly, NFD+curly keys of the
  typed path), or the case is recorded in `notes/analysis-races.md` section 8 as accepted.

### 5. Low: the hint bound is several times the agreed target

- `extensions/RQW-tools/hint.ts:7`: `const MAX_CELLS = 20_000_000;` and `test/tools.test.ts:295`:
  `assert.ok(performance.now() - started < 500, ...)`.
- Measured (`/tmp/rqwf/hint.mjs`, random lines, no match): 2500x100 chars with 20-line oldText 130 ms; 5000x200 with
  10 lines 127 ms; 1000x200 with 50 lines 114 ms; 49 999x200 with 1 line 107 ms. All return no hint after the budget.
- `notes/review-code-1.md` finding 3 asked that a failed edit block the event loop for no more than "a few tens of
  milliseconds" and that a test assert the bound; the cap gives about 110-130 ms and the test allows 500 ms.
- Required outcome: a cell budget that keeps the worst case within a few tens of milliseconds on this machine, and a
  test bound that would catch a regression of that size; or the 130 ms bound accepted in the design.

### 6. Low: parallel execution of independent writes and edits is not proven by a test of the real tools

- Proof exists only for the barrier with timer operations (`test/barrier.test.ts` T1 `[M a, M b]: parallel`) and for
  reads through the pipeline (`test/pipeline.test.ts` S5 overlap check). No test shows that two `write`/`edit` calls on
  different files in one response overlap, or that the groups of one multi-file call run concurrently
  (`edit.ts:100` / `write.ts:86` `Promise.allSettled(...map(...))`).
- Requirement 6: "чтобы эти лиды, edit и write шли параллельно"; criterion: every requirement proven by a mechanical test.
- Required outcome: an overlap check like S5 for `[write a, write b, edit c]` in one response, and for the groups of
  one multi-file `write`/`edit` (for example with a slowed stock execute).

### 7. Low: `SYSTEM.md` still speaks of per-model edit formats and single-file edits

- `extensions/RQW-prompt/SYSTEM.md:28`: "Use the available file-editing tool for single file edits in the format
  supplied for your model."
- Agreement item 3: one edit format for every model, no `apply_patch`; item 5: `edit` changes many files in one call.
  The line tells the model the format depends on the model and that the edit tool is for single-file edits.
- Required outcome: the line names one format and does not restrict `edit` to one file, for example "Use the edit
  tool for changes to existing files." or the line is dropped.

### 8. Low: `package.json` declares `scripts` twice

- `package.json` lines 5 and 26: two `"scripts": { "test": ... }` objects in one JSON object. Parsers keep the last
  one, so an edit of the first one is silently ignored.
- Required outcome: one `scripts` key.

## Note on method

To get module resolution for the tool-selection probe, a throwaway test file
`extensions/RQW-tools/test/zz-sel-probe.test.ts` was created, run once and deleted in the same command; the tree is
unchanged (`git status` clean apart from this file).
