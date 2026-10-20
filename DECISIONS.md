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
- Accepted limit: Pi's compaction summary lists changed files from `args.path` only, so files given in `write.files[]`
  or in `edits[].path` are missing from that list. Fixing it needs a change in Pi itself; the files stay in the
  transcript and in the tool results.
- Proof: `npm test` (`node --test`, no model) and `.github/workflows/tests.yml` on macOS, Linux and Windows, plus a job
  reproducing PowerShell, portable Git Bash without admin, then Node.

## Context

- `extensions/RQW-context/index.ts` applies the owner's rule to every model: W = min(model.contextWindow, 500000) is
  the context window Pi uses, R = `Math.round(W / 10)` (a .5 rounds up), and Pi compacts above W - R. 272 000 ->
  window 272 000, compaction above 244 800; 500 000 and 1 000 000 -> window 500 000, compaction above 450 000.
  Built-in, models.json and extension models alike, at start (`--model`), on resume, after `/model` and model cycling.
  No per-model list.
- The window above 500 000 is lowered for the session, not only the trigger. Owner, on the open question: option b,
  «овераить его, если оно выше 500 тыс. токенов на 500 тыс. токенов», with compaction at W - R and R = 10% of W.
  Reason: with the trigger alone the footer showed 45% at compaction and Pi still treated a 1M model as 1M everywhere
  else; the rule says the window itself becomes 500 000.
- Mechanism, window: Pi reads every limit from the session model, `agent.state.model` (`agent-session.js:1037`
  `get model() { return this.agent.state.model; }`): the pre-prompt and next-turn trigger (`420-422`), threshold and
  overflow checks after a response (`2376`, `2407`, `2477`), no auto-retry on overflow (`3013`), context usage and the
  footer percent (`3472-3499`, `footer.js:134`), the model of every request (`456`, `agent-loop.js:132`), whose
  output cap pi-ai derives from it (`pi-ai/dist/api/simple-options.js:5-9`: contextWindow - context - 4096), and the
  summary requests (`_getSummarizationRequestAuth(this.model)`). `state.model` is a plain property
  (`pi-agent-core/dist/agent.js:40`), so the extension replaces it on each session's state with an accessor that
  stores `{ ...model, contextWindow: 500000 }` for a model above 500 000 and the same object otherwise, one stable copy
  per declared model. It is installed from `AgentSession.prototype._buildRuntime`, which Pi runs in the session
  constructor right after `this.agent = config.agent` (`agent-session.js:177`, `210`) and again on `/reload`
  (`2988`), so every assignment Pi makes later (`setModel` `1985`, cycling `2037`, `2064`, registry refresh `2711`)
  goes through it. Reason for an internal hook: the extension API has no way to change the session model's window.
  `pi.setModel` takes a model but appends a `model_change` entry, reapplies the thinking level and is not called at
  start, resume or registry refresh; `pi.registerProvider` with `models` "replaces all existing models for this
  provider" (`extensions/types.d.ts:1442`); models.json `modelOverrides` needs an entry per model; the `model_select`
  event is a notification. Extensions get Pi's own `AgentSession` class (jiti alias in the library, virtual modules
  in the bundle); the tests run both.
- Load check: before patching anything the extension checks that both internals it patches exist,
  `AgentSession.prototype._buildRuntime` and `SettingsManager.prototype.getCompactionSettings`. If either is missing
  (another Pi version), it throws one load error naming the missing method and patches nothing. Reason: Pi turns the
  throw into a load error and keeps running (`core/extensions/loader.js:524-537`), so a half-installed patch would run
  a rule the user is told is off; now the rule is either whole or absent.
- Mechanism, reserve: Pi compacts when `contextTokens > model.contextWindow - reserveTokens` (`compaction.js:176`) and
  reads reserveTokens from `SettingsManager.getCompactionSettings(model)` at every check. The extension wraps that
  method on Pi's class and returns contextWindow - (W - R), which is R itself once the window is W: a computed
  `compaction.modelOverrides` reserve for every model, the way Pi's docs tune the trigger per model
  (`docs/compaction.md:457`). `pi.getSettings()` returns a copy and has no setter.
- Consequences for a model above 500 000, all as for a 500 000 model: footer and `getContextUsage()` show the window
  500k and 90% at the threshold; summary output limits are 40 000 and 25 000 for a split turn (0.8 and 0.5 x R,
  `compaction.js:512`, `727`); the output cap of a request is 500 000 - context - 4096, about 45 900 at 450 000
  context (the test sees 45 902); an answer reporting more than 500 000 input tokens counts as overflow
  (`pi-ai/dist/utils/overflow.js:147-150`). With compaction on and a history of several turns Pi recovers: a
  completed answer is kept and the session is compacted with reason `overflow` and no retry
  (`agent-session.js:2410-2414`); a length stop with no output at 99% of the window is compacted and retried once
  (`2440`, `overflow.js:156-159`). Nothing about the window goes to the provider: the OpenAI-compatible body has only
  `max_completion_tokens` changed, every other field as stock Pi.
- Known limits of the 500 000 window, no code change: the window rule is the owner's, and both follow from it.
  1. The output cap. pi-ai clamps a request's output to `contextWindow - context - 4096` with a floor of 1 token
     (`pi-ai/dist/api/simple-options.js:5-9`), so on a 1M model it reaches 1 token at about 495 900 context tokens.
     Pi does not recover in two cases. With `compaction.enabled: false` there is no compaction at all
     (`agent-session.js:2363-2364`): measured `max_completion_tokens` at context 0 / 480 000 / 497 000 / 520 000 is
     `[128000, 15902, 1, 1]` (stock Pi `[128000, 128000, 128000, 128000]`); a provider that obeys it answers 1 token
     with stop reason `length` and no error. A history that is one oversized turn, such as a 700 000-token first
     paste, gives requests with a 1-token cap; the overflow compaction that follows also has its turn-prefix summary
     capped at 1 token and fails with "Turn prefix summarization failed: generation hit the token cap and the summary
     is incomplete". The test pins the cap with compaction off.
  2. Summaries of prose-heavy histories. A summary request is a fresh context that pi-ai sizes by characters
     (3.5 per token), so a chat history of English prose, about 4.4 chars per real token, estimates above the window
     at the threshold and the summary's output cap is 1 token: on a 1M model the compaction at 450 000 fails with
     "Summarization failed: generation hit the token cap and the summary is incomplete", then up to two failed
     summary requests per prompt. Stock Pi does the same on a native 272 000 or 500 000 model; it is new for 1M models
     only because stock Pi would not compact them before 983 616. Tool results are cut to 2 000 chars before the
     estimate (`compaction/utils.js:82`), so tool-heavy coding sessions do not reach it.
- Models up to 500 000 keep their own object; only the reserve changes. The model registry is not touched: `/model`
  and `--list-models` show the declared window, the session and the footer show 500k. So one model shows two windows
  through events and RPC: `model_select.model` is the object passed to `setModel` and RPC `set_model` returns the
  registry object (`rpc-mode.js:371-372`), both with the declared window; the session state (`ctx.model`,
  `model_select.previousModel`, RPC `get_state` and `get_session_stats`) has the capped one. There is no fix without
  a Pi API.
- A reserve the user set still wins, measured against the capped window W: `compaction.reserveTokens` for all models
  and `compaction.modelOverrides["provider/id"].reserveTokens` for that model, Pi's own precedence (1M with a reserve
  of 30 000 compacts above 470 000). A user reserve of W or more would leave a threshold of 0 or below, so Pi would
  compact before every request; then the rule's R applies instead (1M with 600 000 compacts above 450 000). Pi's docs
  example (`docs/compaction.md:444-457`), `"some-provider/big-model": { "reserveTokens": 400000 }`, "triggers
  compaction above 600K tokens" for a 1M model; with the extension the window is 500 000, so it compacts above
  100 000. `compaction.enabled: false` still turns off threshold and overflow compaction. A models.json
  `contextWindow` (a model entry or `modelOverrides`) is the model's declared window: up to 500 000 Pi uses it as
  written, also to lower a 1M model; above 500 000 it is capped like any other source, because Pi's composed model
  does not say where its window came from. A model without a positive contextWindow keeps Pi's values, as stock: for
  a window of 0 or undefined Pi itself compacts after every response, because its post-response check is
  `tokens > 0 - reserve` (`agent-session.js:2376`, `2477`; only the pre-request check has a `<= 0` guard, `421`); a
  response is skipped only when nothing lies beyond `keepRecentTokens` to summarize. The extension leaves that
  unchanged.
- Both wraps live as long as the process, one per class (`Symbol.for` guards): SDK sessions in the same process get
  the rule too, and a `/reload` without the extension keeps it until restart.
- Out of scope: virtual models (`pi.registerVirtualModel`; Pi 1.3.0 ships none), owner's option a. A virtual model
  (`api` `pi-virtual`) is never capped and `getCompactionSettings` returns Pi's own values for it. Reason: Pi reads
  the settings of the virtual selection but checks them against the routed physical model's window
  (`agent-session.js:420-422`, `481`, `2363`, `2376`); a reserve from the virtual model's declared window made Pi
  compact before every prompt (1M virtual routed to 272k: reserve 550 000, threshold below 0). Under a virtual model
  the behaviour is stock Pi's: the routed model's declared window and Pi's reserve.
- Proof: `extensions/RQW-context/test/context.test.ts` runs real sessions of the library and the bundle with a
  scripted provider that reports exact usage and a local OpenAI-compatible endpoint: Pi's own `session.model`,
  `getContextUsage()`, `compaction_start` at W - R + 1 and not at W - R (also after a switch, `/reload`, resume, fork
  and `/new` through `AgentSessionRuntime`, and in the pre-request check `_exceedsCompactionThreshold` between tool
  turns), user reserves in memory and in a file-backed `settings.json`, overflow recovery above 500 000, the output cap
  with compaction off, a virtual model as stock, load order, a load without either internal, and the request body
  against stock Pi.

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
