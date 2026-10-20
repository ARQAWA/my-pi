# my-pi: decisions

Every accepted decision, with its reason and the file that carries it.

## Scope

- my-pi is built on stock Pi 1.3.0 with its own tools (`read`, `bash`, `edit`, `write`); the interface and the omp-lite
  tools are dropped (user: «Давай полностью отбросим все UI припоны и оставим только чистую механику и промпты»,
  «Так же мы можем отбросить тулинг»).
- Reason: bench41 (`~/Documents/ChatGPT/my-omp-harness/bench/bench41.csv`, T01-T07, 3 runs): the omp-lite prompt alone
  raised stock Pi by 10.2 quality points on gpt-6-sol low, 6.2 on gpt-6-sol medium and 1.9 on gpt-6.1-sol medium;
  omp-lite beat that only on low (+3.5) and was lower and slower on both medium configs.
- Public repository [ARQAWA/my-pi](https://github.com/ARQAWA/my-pi) (user: «он должен быть паблик»).
- Dropped for good: loading of `eval`, `lsp`, `ast_grep` (user: «eval нахуй не нужен, lsp ... ast-grep ... выбросить
  всё это на помойку»; Pi has its own codemode).
- Postponed, not dropped (user: «мы их не упраздняем, а откладываем»): subagents (`review`, `codebase_explorer`,
  `code_writer`, `shell_runner`, `custom`), the `define-goal` skill and work orders, the task list with the check
  before stopping (later switched on by a skill rather than always on), and the interface (whether the omp-lite UI can
  be rebuilt in Pi is decided later).
- Reviewers are ported after all, as the one exception to the postponed subagents: two blind reviewers, `blind` and
  `high`, with one shared prompt (user: «Smart не нужен ... Надо только большого и маленького reviewer ... будет Blind и
  High»). They run in the same process through Pi's SDK `createAgentSession` (user: «Да, конечно, через SDK, через
  createAgentSession»), read only, and are checked on a model with a known-answer set (user: «Конечно, делай
  проверки, расходуй токены»). Their concept and models come from the history first: Spotty and Bossy in
  `my-omp-harness` branch `deprecated` (Haiku 5.5 and Sonnet 5.5) and in `my-codex-harness` (gpt-6-sol, gpt-6.1-sol).
- All subagents of the work on this repository run on Opus only, at low, medium or high reasoning (user: «всех
  саб-агентов переводи на Opus low, medium или high ... Sonnets больше не используй, только Opus»).
- Reviewers, accepted plan (user: «То, что ты предложил по ревьюерам — it's OK, я принимаю»): own extension
  `RQW-review` on `createAgentSession`, no ready package (pi-subagents: ~98k lines, ~1.3k tokens per request, fails
  strict schemas). One tool `review` with `level` `blind` or `high`; a fresh read-only session per pass with `read`,
  `grep`, `find` and the shared Spotty prompt; no main prompt, extensions, skills or AGENTS.md in the reviewer;
  `blind` on Haiku 5.5 medium, `high` on Sonnet 5.5, levels fixed by measurement; no silent model fallback; the
  extension copies the user's messages verbatim into the brief; the verdict arrives later as a message. The two
  reviewers keep this contract and these two models only (user: «Ревьюеры будут только на этих двух моделях»).
  When each runs is decided by measurement (user: «Реши сам, найди самое лучшее решение»); quality is measured on a
  rebuilt known-answer set and the prompt is tuned on it (user: «найди сам самый лучший способ замерить, и после
  этого можешь подтюнить его промптом»).
- A separate task: a general subagent for the main agent, like the subagents this work uses (user: «Любого рандомного
  саб-агента ... Чтобы он мог ему ставить задачу, прерывать, выключать, перезапускать. Он мог ему посылать
  сообщение follow-up»). It starts with no system prompt of its own: the main agent gives the whole prompt, the model
  and the reasoning level (user: «должен подниматься без системного промпта, чтобы основной агент передавал ему весь
  системный промпт»).
- Autonomous work commits, pushes and merges into `main` by itself after proof and a clean review (user: «Да,
  слияние без команды»). Model runs, tests and checks against the source are always part of the work (user:
  «Прогоны на модели, тесты, сверка с кодом входят в работу всегда»).
- `WORKFLOW-MANIFEST.md` lives in this repository and records how the owner works, so the agent can align with it;
  it is not a description of the package (user: «манифест — это чисто для нас ... надо закрепить именно принципы
  работы ... как я работаю как владелец всей системы»).
- Open work: `RQW-context` (context window and compaction rule) and faster file writing in `RQW-tools`.

## Structure

- Everything is an extension, one folder per extension under `extensions/`, listed in `package.json` under
  `pi.extensions`: first `settings`, second `prompt` (user: «в этом репозитории мы всё будем делать extension... Первый
  extension — это будут настройки, второй — промты, настройки промта»).
- Every extension folder carries the prefix `RQW-`: `RQW-settings`, `RQW-prompt` (user: «у всех наших extension был
  префикс типа RQW- и название»).
- Tools work: requirements compiled in `notes/tools-requirements.md`. Tool and parameter names stay exactly as in Pi;
  no `apply_patch`, one edit format for every model (user: «имена такие же, как в P... никакой хуйни не надо
  навяливать из ОМП лайта»; «Нет, не надо для GPT patch делать. Пусть работает одинаково везде»).
- `INSTALL.md` is the install prompt: the user runs it inside an already installed Pi, and that Pi installs this
  package into itself with `pi install` and asks for `/reload` (user: «чтобы можно было его везде воссоздавать,
  воссобирать с нуля, просто промтом одним через install prompt»; «install.md — это про установку именно наших обвесов
  на уже установленный Pi. Я внутри Pi запускаю этот промпт»).
- The start was empty: both extensions were no-ops. The prompt is built first, everything else after it (user: «Старт
  должен быть пустой... сначала надо сделать промпт пиздатый, а потом всё остальное будем делать»).

## Tools

- `extensions/RQW-tools/` replaces `read`, `bash`, `edit`, `write` and turns on `grep` and `find` by registering them.
  Each tool spreads the stock definition and keeps its `execute`; only descriptions and the multi-file wrappers change.
  Design and reasons: `notes/tools-design.md`; evidence: `notes/analysis-*.md`.
- Ordered conflict barrier: a call waits only for earlier calls of the same response it conflicts with; bash conflicts
  with every call, read never with read, otherwise equal path key or ancestor. Reason: stock Pi measured 20 of 20 races
  for read/write, bash/read and case-variant writes (`notes/analysis-races.md` section 2). bash is serialized against
  bash because its footprint is unknown.
- In-place writes stay; on Windows `EBUSY`/`EPERM`/`EACCES` are retried for about 1.5 s. Temp file plus rename was
  rejected: rename fails on Windows when another process holds the file.
- Limits: grep and find get no match cap by default (`limit` 100000 when unset); the stock 50KB output cap stays. Reason:
  Pi's default 100 grep matches cuts the broad first search wave; omp-lite's 51 200-character budget equals 50KB for
  ASCII. read and bash keep the stock 2000 lines / 50KB, as measured in bench41.
- The search wave method moved from `SYSTEM.md` into the grep description; `<search_method>` keeps one line.
- read, bash, edit and write are registered with `defaultActive: false`: they replace the built-ins of the same name, so
  Pi's defaults and the user's `--tools` / `defaultTools` still decide which are on. grep and find are activated by
  registration; on resume or fork they are re-added unless the user passed `--tools`, `--exclude-tools` or `--no-tools`.
  Reason: the code review showed that activating on registration overrode an explicit `--tools -edit`.
- read and bash are built with the user's settings (`shellPath`, `shellCommandPrefix`, `images.autoResize`), as stock
  Pi builds them. Reason: without `shellPath` a Windows setup with Git outside Program Files finds no bash.
- The read key mirrors stock `resolveReadPath` (NFD, curly quote and AM/PM variants), so a read and a write of the same
  file spelled differently still meet in the barrier.
- The `ls` and other stock tools beyond the six are not wrapped and stay outside the barrier; they are off by default.
- The descriptions do not explain the barrier order (bash waits for earlier calls, a read waits for an earlier write).
  Reason, measured on gpt-6.1-sol medium, T01: with those lines the model made one call per response in 8 of 8 runs
  (14-18 responses); without them it batched in 9 of 9 runs (3-5 responses). The barrier works without the model
  knowing it.
- bench42 (commit `0a2028e`, T01-T07, 3 runs, same completion judge and checklists as bench41; rows in
  `notes/bench42.csv`). Pi with the bench41 prompt vs my-pi:

  | Config | Pi + prompt | my-pi |
  |---|---|---|
  | gpt-6-sol medium | 47.4 s / q91.9 | 47.0 s / q89.0 |
  | gpt-6.1-sol medium | 64.6 s / q99.0 | 67.2 s / q92.5 |
  | gpt-6-sol low | 28.4 s / q90.5 | 27.4 s / q89.6 |

  Speed is the same. The quality gap comes from T01 (80/93/80 vs 67/80/67: the answer misses the Python twin) and one
  gpt-6.1-sol run of T02 that wrote its answer to `TRADING_LOGIC.md` (q18, 256 s); without that run gpt-6.1-sol medium
  is 57.8 s / q96.2. Open: tune the grep description against T01.
- bench42 regraded with 5 judge votes per answer, majority per point: 92.9 / 91.0, 96.2 / 91.6, 90.5 / 89.0
  (Pi + prompt / my-pi). The 90% bootstrap interval of the difference includes zero on every config. The T01 gap was
  judge noise on one point; both stands miss the Python usage point equally. Judging from now on: 5 votes, majority.
- The `TRADING_LOGIC.md` run: the model's reasoning shows it hit the answer length limit of the prompt and moved the
  answer into a file, which the prompt allowed ("the file is the answer"). `SYSTEM.md` now says to answer a question
  about the code in the chat and to create or change files only when the task asks for it.
- edit and write descriptions refined by probes (`notes/refine/refine-editwrite.md`; EDIT, WRITE and a multi-block task,
  gpt-6.1-sol medium and gpt-6-sol low, 3 runs per cell): the multi-file form comes first and a rename gets one edit per
  occurrence with enough of its line. Failed edit calls 5 -> 0, multi-file edit calls 12 of 23 -> 15 of 16, all runs
  correct in both texts. A variant that told the model bash sees the changed files again made gpt-6.1-sol issue one
  call per response and was rejected.
- read description refined by probes (`notes/refine/refine-readbash.md`; T02, T05, EDIT, WRITE, two models, 96 runs):
  read a needed file whole in one call and read every file needed next in one response. Correctness 99.6 -> 100,
  whole-file reads 79% -> 84%, responses equal; the speed change is within noise. bash stays as it was: no run searched
  or read through bash, and a line asking to run tests in the same response as the edit split responses on gpt-6.1-sol.
- grep and find descriptions refined by probes (`notes/refine/refine-search.md`; T01, T03, T06, two models, 72 runs):
  the wave names the spellings to try, reads every file the hits already justify in one response, and the stop rule
  asks for where each value is set, used and what the code does with it, for every implementation. find shows brace
  alternatives. Checklist coverage 94.1% -> 95.0%, within noise; chosen by the rule completeness, then responses.
- Second description review (`notes/review-descriptions-2.md`, 8 findings) fixed as wording only: grep respects
  .gitignore inside a git repository only, a grep glob with "/" matches from path, find also returns directories, the
  edit hint may be absent, a cut grep line is read around instead of narrowing, a tool result that names cat or sed
  overrides the ban, a long file written in parts is the one exception to one edit call per file. bench43 measured the
  texts before these fixes.
- bench43 (commit `9e13b55`, T01-T07, 5 runs, judge 5 votes with majority per point). Pi + prompt / my-pi:
  gpt-6-sol medium 38.2 s q90.8 / 37.6 s q90.8; gpt-6.1-sol medium 51.4 s q96.8 / 52.1 s q96.8; gpt-6-sol low
  26.4 s q89.6 / 24.2 s q91.4. 90% intervals of my-pi minus Pi + prompt: quality [-1.7, 2.3], [-2.2, 2.2],
  [-0.5, 4.1]; seconds [-1.9, 0.8], [-1.2, 2.6], [-3.4, -1.1]. my-pi is equal on medium and faster on low; no file
  written in any run. Both stands miss the same points: T01 Python usage, T06 auth blocker delay, T03 Python NG copy.
- Prompt line for implementations that do not run: say where the value is set, where it is used and what that code
  does. Probes T01, T03, T06, two models, 3 runs, judge 5 votes: gpt-6.1-sol medium q95.6 -> 100, gpt-6-sol low
  q85.6 -> 92.2, speed and responses unchanged. A second line asking to name every setting on the code path made both
  models worse (q87.0 / 83.3) and was rejected.
- Edit tasks (EDIT rename across 4 files, WRITE 3 new files, MULTI 3 blocks in one file plus 2 files; 5 runs, two
  models): every run of stock Pi, Pi + prompt and my-pi passed its tests. Seconds Pi / Pi + prompt / my-pi:
  gpt-6.1-sol medium 21.0 / 22.0 / 22.6, gpt-6-sol low 17.0 / 18.8 / 17.2; my-pi minus Pi + prompt on gpt-6-sol low
  [-2.2, -0.9] s. On WRITE both prompted stands read the repository before writing, stock Pi writes at once.
- bench44, the final check (commit `7890a8b`; stock Pi, Pi + bench41 prompt and my-pi run at the same moment; T01-T07,
  5 runs; judge 5 votes, majority per point; rows in `notes/bench44.csv`). Seconds / quality:

  | Config | Pi | Pi + prompt | my-pi |
  |---|---|---|---|
  | gpt-6-sol medium | 29.9 s / q81.7 | 37.8 s / q90.2 | 37.6 s / q93.6 |
  | gpt-6.1-sol medium | 40.7 s / q94.1 | 49.6 s / q97.2 | 50.0 s / q99.0 |
  | gpt-6-sol low | 16.3 s / q74.0 | 26.5 s / q89.0 | 27.1 s / q93.8 |

  90% intervals, my-pi minus Pi + prompt: quality [0.6, 6.3], [-0.3, 3.4], [1.9, 7.5]; seconds [-2.2, 1.7],
  [-1.9, 2.9], [-0.8, 1.9]. my-pi minus stock Pi: quality [8.6, 15.2], [3.2, 6.5], [15.3, 24.2]; seconds [6.3, 9.0],
  [7.3, 11.5], [9.7, 11.9]. my-pi answers better than both at the speed of Pi + prompt; stock Pi is faster because it
  stops early with incomplete answers. No run changed the repository. Edit tasks: see the edit-task entry above.
- Faster writing (`notes/refine/refine-write2.md`, `notes/refine/refine-find.md`; WRITE, EDIT, MULTI, T01, T03, T05,
  T06; two models): a new file the task fully specifies needs no read of its neighbours (one line in `SYSTEM.md`, one
  in `read.md`), and the find example shows that "app" returns the directory only while "app/**" returns its files.
  Measured in two steps: the read lines against main (WRITE 18.4 s / 5.5 responses -> 16.0 s / 4.7, T01 and T05
  checklists equal), then the find example against that (edit tasks 19.4 s -> 17.3 s, question checklists 94.8% ->
  96.3%, not lower). All runs correct. gpt-6.1-sol still makes a second find in 2 of 6 WRITE runs. A review then made
  the find, read and prompt wording exact (full-path matching, imported code, long files in parts) without new runs.
- Accepted limit: Pi's compaction summary lists changed files from `args.path` only, so files given in `write.files[]`
  or in `edits[].path` are missing from that list. Fixing it needs a change in Pi itself; the files stay in the
  transcript and in the tool results.
- Proof: `npm test` (`node --test`, no model) and `.github/workflows/tests.yml` on macOS, Linux and Windows, plus a job
  reproducing PowerShell, portable Git Bash without admin, then Node.

## Prompt

- First step is only the prompt extension (user: «пока делаем только экстеншен который заменяет промпт систменый на
  наш»). `extensions/RQW-prompt/index.ts` sets `systemPromptOptions.customPrompt` in `before_agent_start` to
  `extensions/RQW-prompt/SYSTEM.md` plus the workstation, `<critical>`, environment and date blocks. Not
  `forceSystemPrompt`: Pi still appends project context, skills and `<cwd>` and records the prompt as sections.
- The text follows the concept in `notes/prompt-concept.md` and starts from the bench41 template, the only measured
  version on Pi (+10.2 / +6.2 / +1.9 quality points on gpt-6-sol low / gpt-6-sol medium / gpt-6.1-sol medium).
- The search wave method stays a `<search_method>` section of the prompt, since Pi's tools are stock and their
  descriptions are not ours; the `<critical>` verify line stays as in omp-lite. Both are the recommended options the
  user did not overrule.
- Writing a file longer than about 400 lines in parts (bench35 lost a response to the output limit) lives in the
  `write` description, as in omp-lite, each part in its own response. Removed against bench41: the working
  directory from the date line, because Pi already appends `<cwd>`.

## Review

- `extensions/RQW-review/` is the accepted reviewers plan (user: «То, что ты предложил по ревьюерам — it's OK, я
  принимаю»): one tool `review` with `level` `blind` or `high` (user: «Smart не нужен ... будет Blind и High»), held
  to the existing contract and nothing more (user: «эти три саб-агента должны быть забиты за тем контрактом, который
  есть, и всё»).
- Models live in one table, `LEVELS` at the top of `index.ts`: `blind` is `anthropic/claude-haiku-5-5` with thinking
  medium, `high` is `anthropic/claude-sonnet-5-5` with thinking low (user: «Ревьюеры будут только на этих двух
  моделях»). The thinking levels are to be confirmed by the known-answer measurement. No fallback: a missing model,
  missing credentials, a failed request or no verdict in 10 minutes give `[review#N] Review failed: <reason>`.
- Parameters: `level`, `object` (paths, the diff as a file path, the stage), `criterion`, optional `agreement`
  (accepted proposals and decisions that are not in the user's own messages) and `rejected`. The description has
  four sentences, under 500 characters. Empty strings count as not given, since strict mode fills every field.
- The diff goes in as a file path, not as a command: the reviewer only reads files and cannot run one.
- The extension builds the brief itself (`buildBrief`): the user's messages of the current branch, verbatim, numbered
  and in order, with compaction and branch summaries labeled as not the user's words, then `agreement`, `object`,
  `criterion` and `rejected`. Reason: the main agent no longer retypes the user's words, the largest output cost of a
  call, and the words cannot drift.
- Each call is a fresh session in the same process: `createAgentSession` with in-memory `SessionManager` and
  `SettingsManager` (compaction off), a resource loader with no extensions, skills, prompt templates, themes, context
  files or appended prompt, `REVIEWER.md` as the prompt and the tools `read`, `grep`, `find` only. Pi still adds its
  `<cwd>` block after the prompt, so relative paths in the brief resolve; nothing else is added.
- The reviewer gets Pi's stock `read`, `grep` and `find`, not the RQW-tools ones. Reasons: the RQW descriptions carry
  the main agent's method (grep: a broad search wave plus a find for deploy and run files; read: read the files you
  will change), which works against the reviewer's first batch of whole-file reads; the barrier never orders
  read-only calls, so an own barrier adds nothing; the RQW definitions are built inside the RQW-tools factory and
  are not exported. The execute code is the same stock code, so the output matches. Cost: stock caps of 100 grep
  matches and 1000 find results, each with a note on how to get more.
- The reviewer uses the session's own model runtime, `ctx.modelRegistry.runtime`, private to TypeScript only.
  Reason: providers and logins that the user's extensions register reach the reviewer (here `pi-claude-auth`
  registers the `anthropic` provider), and no second runtime refreshes the same OAuth login.
- `REVIEWER.md` is the Spotty body from `my-omp-harness` `deprecated:agents/spotty.md` with two changes for Pi: the
  `read` note (Pi's read prints no line numbers; the bracketed continuation note is not file content) and the final
  answer as the last message instead of a `yield` call, worded as in master `agents/review.md`. The verdict format
  stays: `CLEAN`, or `FINDINGS:` with numbered `FINDING n` blocks (REQUIREMENT, MISMATCH, EVIDENCE, REQUIRED
  OUTCOME), and an optional `UNCHECKED:` section.
- Async: the call returns `review#N started` at once. The verdict, the reviewer's last assistant text, arrives as
  `pi.sendMessage({ customType: "review", content: "[review#N] <verdict>", display: true }, { triggerTurn: true,
  deliverAs: "followUp" })`; `details` carry level, model, thinking and seconds for the user and logs only. Numbers
  count per session and go on after a resume. `session_shutdown` aborts every running review and delivers nothing;
  the 10-minute timer does not keep the process alive.
- Proof: `extensions/RQW-review/test/review.test.ts` (real sessions, faux providers for the main and the reviewer
  models) and one real run per level: a temp copy of a fixture with `calc.py` (`add` returns `a - b` instead of the
  sum) and a correct `config.py` (`MAX_ITEMS = 50`), command
  `pi -e /tmp/my-pi-review --mode json --model anthropic/claude-opus-5-5 --thinking low -p "<prompt>"`, the prompt
  quoting the request and asking to call `review` and then `sleep 150`. Both verdicts named the defect and nothing
  else and started a main turn: `blind` in 8.7 s (`EVIDENCE: "return a - b"`), `high` in 3.8 s.
- Open: `ctx.modelRegistry.runtime` may be renamed by a Pi update, then every review fails with "the model runtime of
  the session is not reachable"; a verdict queued when the session ends is lost; the reviewer may read a file the
  main agent is still editing; in one smoke run Haiku wrote a MISMATCH of more than 20 words.

## PCLI

- `pcli-vscode/` is a VS Code extension `arqawa.pcli` ("ARQAWA PCLI", win32-x64) that starts Pi like CCLI starts Codex
  (user: «надо сделать extension, как Arkava CLI, такой же, только PCLI... учитывая все требования, все ограничения»).
  It is outside `extensions/`, has no `RQW-` prefix and is not in `pi.extensions`: it is not a Pi extension. Carried by
  `pcli-vscode/package.json`, `AGENTS.md`.
- VDI constraint: everything runs inside VS Code as a subprocess of the extension host (user: «у нас нет админских прав,
  у нас нет wsl, и нам нельзя запускать ничего такого прямо на хосте, только внутри vs code, только как extension vs
  code, как субпроцесс extension VS code. только так»). Carried by `pcli-vscode/extension.js`.
- Pi is pinned to 1.3.0 and bundled in the VSIX (about 43 MB), no update at runtime (user: «мы не будем автоматически
  обновлять PCLai. Как есть 1.3 версия, так и есть.»; «1 да давай 2 да давай»). `vscode:prepublish` runs
  `pcli-vscode/fetch-pi.mjs`: it downloads `pi-windows-x64.zip` of the release `earendil-works/pi` v1.3.0, checks the
  hard-coded SHA256 from the release's SHA256SUMS and extracts it into `pcli-vscode/pi/` (git-ignored). A new Pi
  version means new VERSION, URL and SHA256 there and a new VSIX.
- Release binary, not npm: Pi from npm is a Node program and would run inside `Code.exe` with `ELECTRON_RUN_AS_NODE=1`,
  which leaks into every bash command Pi runs and depends on the Node version of VS Code. `pi.exe` carries its own
  runtime; the same path (Bun exe from a GitHub release) already works on the VDI in omp-vscode. Carried by
  `pcli-vscode/fetch-pi.mjs`.
- Launch chain: extension host -> `powershell.exe` -> Git Bash (`C:\Program Files\Git\bin\bash.exe --login -i -c`) ->
  `pi.exe`, terminal through VS Code's own `node-pty`. The proxy comes from the `Code.exe` environment and the settings
  `http.proxy` / `http.proxyStrictSSL` (the latter sets `NODE_TLS_REJECT_UNAUTHORIZED=0`) and is also exported in the
  Git Bash command line, so profile scripts cannot override it; before the exports that line unsets `http_proxy`,
  `https_proxy`, `all_proxy` and `no_proxy`, because Pi prefers the lowercase names. `~/.pi/agent` (settings, login, sessions) is shared and
  not changed. Carried by `pcli-vscode/extension.js`.
- The tab sets `PI_SKIP_VERSION_CHECK=1`: the version is pinned, Pi must not ask for a newer one (user: «1 да давай 2
  да давай»). Carried by `pcli-vscode/extension.js`.
- One command, `Pi CLI: New Tab`; login is `/login` inside Pi. my-pi itself is installed into that Pi with `INSTALL.md`
  as before; the extension does not install it. Carried by `pcli-vscode/package.json`.
- No Marketplace description: no `description` field in `pcli-vscode/package.json`, no README, no LICENSE (user: «При
  публикации в маркетплейс там НЕ ДОЛЖНО БЫТЬ НИКАКОГО ОПИСАНИЯ»).
- Proof: `.github/workflows/pcli.yml` on `windows-latest` builds the VSIX, installs it into a real VS Code and runs
  `pcli-vscode/test/run.mjs` and `test/suite.cjs`: a local proxy `test/proxy.cjs` with a fake model, Pi answers through
  it, in two scenarios (proxy from the environment with a hostile Git Bash profile, proxy from VS Code settings). The
  fake model is HTTPS with a self-signed certificate: strict TLS fails, `http.proxyStrictSSL: false` works. It also
  checks CONNECT to GitHub with proxy credentials, paths with Cyrillic, spaces and an apostrophe, and no `pi.exe`
  left after closing tabs, `/quit` or VS Code itself. Not covered: a real model call and the corporate VDI restrictions.
- Publishing: skill `publish-pcli` (`.agents/skills/publish-pcli/SKILL.md`), `vsce publish --target win32-x64` from
  `pcli-vscode/` under publisher `arqawa`, `version` raised before each publish, only on a direct request.
