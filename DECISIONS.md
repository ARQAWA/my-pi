# my-pi: decisions

Every accepted decision, with its reason and the file that carries it.

## Work policy

- Engineering work continues on GPT-6.1-Sol at low, medium or high reasoning; small changes may use GPT-6-Luna, and GPT-6-Sol may be selected when its reasoning level fits the task (user: «Всё остальное продолжай делать моделями GPT-6-1-sol low, medium, high ... мелочь ... GPT-6-Luna ... можешь ... GPT-6-sol ... reasoning ... выбери сам»).
- RQW Review finishing work uses GPT-6.1-Sol low and GPT-6-Sol low (user: «RKV Review заканчивает на моделях GPT-6-1-Sol-Low и GPT-6-Low. Вот на таких моделях»). This does not change the product reviewer pins Haiku 5.5 medium and Sonnet 5.5 recorded below.
- Claude model benchmarks and tuning are paused until the owner explicitly resumes them; saved results stay in place (user: «задачи ... замеры на Sonnet ... на Cloud ... на паузе ... дам команду»).
- Carried by `WORKFLOW-MANIFEST.md`; no prompt, model configuration, code or tests change.

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
- Active engineering workers, including subagents, use GPT-6.1-Sol low, medium or high; small checks may use GPT-6-Luna, and GPT-6-Sol is also available at a task-appropriate reasoning level. RQW Review finishes on GPT-6.1-Sol low and GPT-6-Sol low. This supersedes the earlier active Sonnet/Opus worker rule (user: «Всё остальное продолжай делать моделями GPT-6-1-sol low, medium, high»; «RKV Review заканчивает на моделях GPT-6-1-Sol-Low и GPT-6-Low»).
- Claude model probes, benchmarks and tuning are dormant until the owner explicitly resumes them; do not start or continue those runs before then (user: «замеры на Sonnet ... на паузе»; «дам команду, когда их продолжать»). Existing results remain. This pause does not change product reviewer model pins such as Haiku 5.5 and Sonnet 5.5 below.
- Non-Claude model probes, including the four SYSTEM.md edits, may run on GPT-6 and GPT-6.1 now.
  Claude probes remain paused until an explicit resume command (user: «Замеры правок System LMD можно тоже
  проводить на модели GPT-6»). Earlier Sonnet/Haiku probe choices apply only after that command.
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
- `WORKFLOW-MANIFEST.md` is accepted with all nine sections, built from a keep/cut table of the
  old codex and omp manifests (user: «Да, давай оставим все пункты. Да, этот манифест мы оставим»).
- Providers: `/login` and the model list show only two providers, openai-codex and our own Anthropic subscription
  adapter `RQW-anthropic` (Claude Code login, as in omp, with self-healing); every other provider is hidden (user:
  «Это именно отключить. Когда мы заходим в логин, там должны быть только кодекс, авторизация и авторизация через
  Anthropic, которую ты сейчас делаешь. И всё»).
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
- `createTools(cwd, settings)` in `index.ts` builds the six definitions with one barrier of their own; the factory
  registers one set for the session and answers a request on `pi.events` channel `rqw-tools:subagent-tools` with
  `createTools` itself (section Agent). Nothing in RQW-tools depends on RQW-agent. A test in `test/tools.test.ts`
  checks the answer and that each call gives fresh definitions.
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
  (`pi-ai/dist/utils/overflow.js:147-150`). With compaction on and a history of several turns that a summary can
  fit, Pi recovers: a completed answer is kept and the session is compacted with reason `overflow` and no retry
  (`agent-session.js:2410-2414`); a length stop with no output at 99% of the window is compacted and retried once
  (`2440`, `overflow.js:156-159`). Nothing about the window goes to the provider: the OpenAI-compatible body has only
  `max_completion_tokens` changed, every other field as stock Pi.
- Known limits of the 500 000 window, no code change: the window rule is the owner's, and all follow from it.
  1. The output cap. pi-ai clamps a request's output to `contextWindow - context - 4096` with a floor of 1 token
     (`pi-ai/dist/api/simple-options.js:5-9`), so on a 1M model it reaches 1 token at about 495 900 context tokens.
     Pi does not recover in three cases. With `compaction.enabled: false` there is no compaction at all
     (`agent-session.js:2363-2364`): measured `max_completion_tokens` at context 0 / 480 000 / 497 000 / 520 000 is
     `[128000, 15902, 1, 1]` (stock Pi `[128000, 128000, 128000, 128000]`); a provider that obeys it answers 1 token
     with stop reason `length` and no error. A history that is one oversized turn, such as a 700 000-token first
     paste, gives requests with a 1-token cap; the overflow compaction that follows also has its turn-prefix summary
     capped at 1 token and fails with "Turn prefix summarization failed: generation hit the token cap and the summary
     is incomplete". When the part a compaction summarizes (all but the last `keepRecentTokens`) of a text-heavy
     history estimates above about 496 000 tokens by characters, every request gets a 1-token cap and every
     compaction fails: the summary request is capped the same way ("Summarization failed: generation hit the token
     cap and the summary is incomplete"). A text-heavy history a little above the window still recovers, a resumed
     one too: Pi checks a resumed session at its first prompt (`agent-session.js:1452-1454`); in review runs against
     a local stub the dead end began between 535 000 and 541 728 tokens (summary cap 5 112 at 534 864, 1 at
     541 728). A tool-heavy history of the same size recovers, because summaries cut tool results to 2 000 characters
     (`compaction/utils.js:82`). The test pins the cap with compaction off.
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
  the rule too, and a `/reload` without the extension keeps it until restart. The reverse holds too: the patch of
  Pi's classes is installed once per process, so after an update of my-pi a `/reload` keeps the old RQW-context code;
  Pi must be restarted for RQW-context changes to apply (`INSTALL.md` step 4). Reason for text, not code: a
  replaceable implementation behind the guards adds machinery for a case a restart covers.
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

## Settings

- `codemode` and `tool_search`, Pi's built-in tools, are active by default (owner: «Давай включим CodeMode и Tool
  Search»). `extensions/RQW-settings/index.ts` adds them to the active tools at `session_start` under the same rule as
  `grep` and `find`: no tool flag in argv and no `defaultTools` setting, shared through
  `extensions/RQW-tools/selection.ts`. A tool is added only if it is registered, so `-builtin:codemode` gives no error.
  Any user selection (`--tools`, `--exclude-tools`, `--no-tools`, `--no-builtin-tools`, `defaultTools`) leaves the stock
  set. Mode `on` (Pi's default) is kept: Pi appends a "Codemode: `tools.<name>(args)` resolves to ..." line to the
  descriptions of our six tools in each request. Texts, source lines and the barrier check: `notes/settings-codemode.md`.
- `codemode` is a call of the RQW-tools barrier with scope "all", like `bash`; the tool calls of its own script are
  ordered by a barrier of that call. RQW-tools replaces Pi's built-in `codemode` at `session_start` with the same
  definition and a grouped `execute` (`extensions/RQW-tools/nested.ts`, `codemode.ts`), so `-builtin:codemode` still
  means no `codemode`. Reason: `[codemode(write f), read f]` let the read run first.
- A script's tool call finds the barrier of its script by its tool call id: Pi gives it `<codemode id>/<n>`, and the
  group registers its barrier under the codemode call's id. A nested id with no registered ancestor goes to the outer
  barrier, or runs at once when an ancestor has a live entry there, so it never waits for itself. Reason: the first
  version carried the barrier in `AsyncLocalStorage`, and Bun, which runs the Pi release binaries (`pi.exe` of PCLI
  included), drops that context in a worker's `message` callback; every script that called a tool hung (review A).
  Proven on Node 22 and 26 (`npm test`) and on Bun 1.3.14 (the Pi 1.3.0 binary) and 1.4.3:
  `extensions/RQW-tools/test/bun/codemode-check.mjs` runs Pi's CLI under Bun with a faux model; CI job `bun-codemode`.
  Known limit of stock Pi 1.3.0 on Bun, `pi.exe` included: a codemode call that starts right after other scripts,
  such as the third in one message, can fail with "Codemode worker limit reached" (2 workers, a slot freed only on
  the worker's late `exit` event); Node does not do this; the take-over does not change it. Details:
  `notes/settings-codemode.md`, Limits.
- Measured with codemode on (bench45, T01-T07, 5 runs, the bench44 judge; `~/stock-bench/bench45.csv`): gpt-6.1-sol
  medium quality 99.5 -> 97.4 (90% interval -3.7 to -0.5), seconds 51.1 -> 50.4, calls 40.9 -> 35.7; codemode called
  32 times in 19 of 35 runs, `tool_search` never; most of the loss is one T06 point. gpt-6-sol low never calls
  codemode: 91.9 -> 93.7, within noise. Edit, write and multi-file probes pass on both. Kept on by the owner's
  request; the cost is recorded here.
- On `/reload` the `session_start` handlers of RQW-settings and RQW-tools leave the active set alone: Pi keeps the tools
  the user switched off, and the handlers had added them again.

## Agent

- A general subagent for the main agent, the one the Scope section names as a separate task. The owner's words: «должна
  быть опция поднимать любых рандомных саб-агентов, которые являются саб-потоком основного агента. Можно за базу взять
  агента General Purpose из курсора и его воспроизвести»; «этот кастомный саб-агент, абстрактный саб-агент, должен
  подниматься без системного промпта, чтобы основной агент передавал ему весь системный промпт. Полностью промптил его
  от начала до конца»; «Чтобы он мог ему ставить задачу, прерывать, выключать, перезапускать. Он мог ему посылать
  сообщение follow-up»; «чтобы основной агент тратил минимум токенов»; «все решения должны быть максимально простые ...
  без оверенджинеринга»; «всё должно быть доказано». Carried by `extensions/RQW-agent/index.ts`.
- One tool `agent` with `action` `start`, `send`, `interrupt`, `stop`, `restart` and the fields `id`, `system`, `task`,
  `model` (`provider/id`), `thinking` (Pi's levels `off` to `max`), `tools` (a subset of `read`, `bash`, `edit`,
  `write`, `grep`, `find`). Cost for the main agent on every request: description 584 characters, schema 636. The
  schema passes Pi's `makeStrictJsonSchema`; `null` in an optional field counts as omitted.
- In process, no spawn (Windows-safe): `createAgentSession` with `SessionManager.inMemory`, `SettingsManager.inMemory`,
  and `DefaultResourceLoader` with `noExtensions`, `noSkills`, `noPromptTemplates`, `noThemes`, `noContextFiles`; cwd
  is the main session's `ctx.cwd`. Neither RQW-prompt nor AGENTS.md reaches the subagent.
- The system prompt is exactly `system`. Pi appends `<cwd>` and other sections to every custom prompt
  (`buildSystemPromptSections` in Pi's `dist/core/system-prompt.js`); only a forced prompt goes out as it is. So the
  loader carries one inline handler, `before_agent_start` returning `{ systemPrompt: system }`. This is the closest
  thing to "no extensions": the only handler is ours and does nothing else. A test checks that the request has one
  system message equal to `system`.
- The model runtime is the main session's, taken from `ctx.modelRegistry.runtime`, a plain field that is private only
  in the TypeScript types. Reason: one credential store and one OAuth refresh (risk 1 of
  `/tmp/pi-subagent-eval/report.md`), and providers that extensions register also serve the subagent, such as the
  `anthropic` overlay of the installed `pi-claude-auth`. If Pi renames the field, `start` fails and the tests show it.
- Defaults follow Cursor's generalPurpose: all tools, the main model ("inherit"), no subagents of its own (Cursor
  transcript 704ada44 in `cursor-like-harness/kb/sources/cursor-reverse-extra`). Here: the main session's model and
  thinking level, all six tools, and no `agent` tool for the subagent.
- No imports across extension folders: `extensions/RQW-agent/` loads and works with every other RQW-* switched off or
  absent, and switching RQW-tools off switches it off for subagents too (owner: «Когда мы делаем эти отдельные модули,
  они должны быть полностью изолированы, самодостаточны, чтобы мы могли включать и выключать, как feature флаги»;
  review G: the earlier `import rqwTools from "../RQW-tools/index.ts"` failed to load without that folder and gave
  subagents RQW-tools with RQW-tools off).
- Subagent tools follow the RQW-tools switch through a loose, optional handshake on Pi's shared event bus `pi.events`
  (`docs/extensions.md` line 87: "Communicate with another extension | `pi.events`"; `events: EventBus` in
  `dist/core/extensions/types.d.ts` line 1406; one bus per resource loader for all its extensions,
  `dist/core/resource-loader.js` lines 248 and 511). At every `start` and `restart` RQW-agent emits
  `rqw-tools:subagent-tools` with `{ offer(factory) }`. RQW-tools, when loaded, answers with `createTools`, a
  `(cwd, settings) => ToolDefinition[]` that builds the six tools with a barrier of their own; RQW-agent calls it with
  the main `ctx.cwd` and the main session's `pi.getSettings`, and passes the result as `customTools` with the `tools`
  allowlist. The answer is there when `emit` returns: the bus is a Node `EventEmitter`, and its wrapper calls the
  handler before its first `await` (`dist/core/event-bus.js` lines 4-18). Pi drops the handler of a stale instance on
  reload and dispose (`invalidate` in `dist/core/extensions/loader.js` lines 141-150, called from
  `dist/core/agent-session.js` lines 1007 and 2973). With no answer `customTools` is empty and Pi builds its stock
  tools. Reason: stock tools lose the barrier and multi-file `edit`/`write`, so with RQW-tools on the subagents keep
  them, and with it off they must not. RQW-tools works the same without RQW-agent.
- The subagent's `SettingsManager.inMemory` carries the main session's `shellPath`, `shellCommandPrefix` and
  `images.autoResize`, the three settings Pi builds stock read and bash from (`_buildRuntime` in
  `dist/core/agent-session.js` lines 2935-2946), so Git Bash on Windows applies to stock bash too. RQW-tools
  definitions read the main session's settings per call instead.
- Results are async. At the end of each run the main session gets `[agent#N] <text>` through `pi.sendMessage`. The
  text is every final answer of the run, so a follow-up queued during the run does not hide the first answer (the brief
  said "last assistant text"). The text also carries every final error of the run as `error: <reason>`, in order with
  the answers: a failed follow-up does not hide the first answer (`[agent#1] FIRST ANSWER\n\nerror: bad request`,
  review C), and a first task that fails for good does not vanish when Pi then runs a queued follow-up that succeeds
  (`[agent#1] error: bad request: first task\n\nSECOND ANSWER`, review D). An attempt that Pi repeats is not a result. Pi
  repeats a request on two paths and emits an event only when it does: `auto_retry_start` for a retryable error
  (`_prepareRetry` in Pi's `agent-session.js`), and `compaction_end` with `willRetry: true` for a context overflow error
  or a recoverable `length` stop (`_checkCompaction`, review E). Either event removes the error or partial text of the
  last assistant message, and only when that message added one: a `length` stop with no text adds nothing, so an
  earlier answer stays. Threshold compaction has `willRetry: false` and removes nothing. Bad calls (unknown
  id or model, no credentials, missing `system` or `task`) fail at once as a tool error, which costs less than a later
  message. Credentials are checked as Pi's prompt checks them: the registry's auth snapshot, then
  `runtime.checkAuth(provider)`, because the snapshot fills asynchronously and alone rejected valid models.
- Delivery never loses a result to an abort of the main agent (review finding: a follow-up waits in the main agent's
  queue, which TUI Esc clears through `clearQueue()` and RPC `abort` leaves without a turn). When the main session is
  idle (`ctx.isIdle()`), the message goes with `triggerTurn: true` and starts a turn. When it is busy, it goes with
  `triggerTurn: false`: Pi holds it outside the queue and appends it to the session at the end of the current turn or
  run, aborted or not (`sendCustomMessage`, `_flushPendingCustomMessages` in Pi's `agent-session.js`), and the
  `agent_before_settle` handler returns `continue: true` while such a result is not yet followed by an assistant
  message in the branch (tracked by a delivery id in `details`, a `randomUUID()` that no other extension instance or
  process repeats: a counter restarted at 1 after `/reload`, `/resume`, `/fork` or `pi -c` and matched an old,
  answered entry of the same session, so the new result got no turn; review B). After an abort no turn starts, since
  Esc means stop; the result stays in the session and the model sees it on the next turn. Re-sending after an abort, the first
  idea, was dropped: after an RPC abort the old copy stays queued and would arrive a second time with an extra turn.
  Pi runs every extension's `agent_before_settle` handler in a row before it settles, so a result can come in after
  ours returned, for example while another extension's slow async handler runs after ours; held with
  `triggerTurn: false`, it would get no turn (review C). So our handler sets a `settling` flag when it lets the run
  stop, `turn_start` and `agent_settled` clear it, and `deliver` keeps results sent while it is set; the
  `agent_settled` handler sends them. Pi defers every `triggerTurn: true` call separately and runs one full turn for
  each, so only the last held result goes with `triggerTurn: !event.aborted`; the earlier ones go with
  `triggerTurn: false`, which Pi appends at once since the run is no longer active, and the one deferred turn sees all
  of them (review D: two results gave two main turns).
  Rare case: a result that arrives during a manual `/compact` with no run is appended without a turn and is seen on
  the next one.
- Ids `agent#N` never repeat within a session. Every extension instance (`/reload`, `/resume`, `/fork`, `pi -c`) starts
  its counter on `session_start` above the highest `agent#N` in the session's `[agent#N]` messages and `agent` tool
  results, so a new subagent in a continued session gets `agent#2`, not a second `agent#1` whose result would read as
  the old task's and to which a `send agent#1` meant for the old, killed subagent would go (review D).
- No timeout of our own: Pi's provider timeouts and retries apply, and the main agent can interrupt.
- `send` to a running subagent queues `session.followUp`; to an idle one it starts a new run with the history.
  `interrupt` calls `session.abort()`, drops the run's queued follow-ups, sends no message and keeps the history.
  `stop` disposes the session and forgets the id. Closing a session (`stop`, `restart`, `session_shutdown`) clears its
  queue before `dispose()`: `dispose()` aborts without Pi's abort flag, so Pi would run a queued follow-up on the
  disposed session and bill a request after `stopped`. `restart` disposes and creates a fresh session with the same
  `system`, model, thinking and tools or the ones given, and runs `task` if given.
- Calls of `agent` run one at a time in call order. Pi runs the calls of one response in parallel, and a batch of
  `start` and `send agent#1` failed without this (checked by removing it). `start`, `send` to an idle subagent and
  `restart` with a task return only once Pi has started the run, through the `preflightResult` callback of
  `session.prompt` (or once the run has ended). Before that Pi's async preflight runs with no active run, so an
  `interrupt`, `stop` or `restart` next in the same batch aborted nothing: the request still went out and `interrupt`
  waited for the whole run (review E).
- `start`, `send` and `restart` also return at Pi's `compaction_start`: Pi's run is active from there, and a pre-run
  compaction of a large history (for example after an interrupt) would otherwise hold the main agent, an `interrupt`
  behind it and Esc for a whole summary request. Closing a session (`stop`, `restart`, `session_shutdown`) calls
  `abort()` and disposes only after it: `dispose()` alone sets no abort flag, so Pi went on from an aborted pre-run
  compaction to a request from the disposed session (review F).
- Print and JSON modes exit when the main run settles, so there the `agent_before_settle` handler first waits for
  running subagents; their messages continue the same run. In the TUI and RPC a result for an idle main session
  starts a new turn.
- `session_shutdown` aborts and disposes every subagent without messages. No cap on the count.
- Accepted limits: a result that arrives after the main session ended is lost; a subagent may read files the main agent
  is editing; subagents share the process with the TUI.
- `RQW-context` patches Pi classes for the whole process, so a subagent gets the owner's universal window rule like
  every model: its window is capped at 500 000 and its compaction reserve is 10% of that window. Checked in review: a
  subagent on a 1 000 000 model sends its request with window 500 000 when RQW-context is loaded.
- Proof: `extensions/RQW-agent/test/agent.test.ts`, 34 tests on two faux providers (a copy of `index.ts` alone in a
  folder with no other extension loads and delivers, and the source has no `../` import; without RQW-tools the
  subagent's `write` is the stock one, no `files`; with RQW-tools loaded it takes `files` and runs while a `sleep 2`
  of the main session's RQW-tools bash still holds the main barrier; exact system prompt, model,
  thinking, tool subset, the five actions, follow-up while running, the main turn, shutdown, errors, call order, print
  mode; one request only after `stop`, `restart` or `session_shutdown` with a queued follow-up; a result arriving
  while the main agent streams continues its run once; after TUI Esc and after RPC abort the result is in the session
  once, no run starts, and the next prompt carries it once; in a continued session that already holds an `[agent#1]`
  result, a new result while busy still continues the run once, in TUI and print mode; a queued follow-up that fails
  delivers the first answer and the error in one message; a first task that fails for good with a queued follow-up that
  succeeds delivers the error and the answer in one message; an error that Pi retries is not delivered; neither is an
  overflow error nor a truncated `length` answer that Pi compacts and retries; `interrupt`, `stop` and `restart` right
  after `start` in one batch return at once and leave no subagent request; two results
  that arrive while a second extension's slow `agent_before_settle` handler, loaded after RQW-agent, runs get one main
  turn that sees both; in a continued session a new subagent gets `agent#2`; after an interrupt above the threshold `send` returns within 100 ms and `interrupt`, `stop`, `restart` or `session_shutdown` right after it send no summary request, and `stop`, `restart` or `session_shutdown` during that summary abort it and send nothing more). Each test passes alone. With
  an empty extension the original 13 fail; without the queue clearing, the delivery change or the `continue` the new
  tests fail; with a per-instance delivery counter the two continued-session tests fail; on 6b2cfb5 the two review C tests fail; on ff8781b
  the four tests changed or added for review D fail except the retried-error one, which fails without the
  `auto_retry_start` line; on 8344d2e the two review E tests fail. On 0789ab1 the seven review F tests fail; with only the `compaction_start` line six of them fail. On
  40574b5 the folder and stock-tools tests fail; with no offer from RQW-tools the RQW-tools test fails, and so it does
  when RQW-tools offers its main definitions with the main barrier. With the RQW-tools folder removed, 33 pass and
  the RQW-tools test is skipped. Live runs
  in a fixture repository with `pi -e <repo> --model anthropic/<model> --thinking low --mode json -p <prompt>`:
  Haiku 5.5 started a subagent with its own prompt, read a file and answered a follow-up (`[agent#1] ZED: 3`,
  `[agent#1] ZED: alpha`); Haiku 5.5 queued a follow-up, interrupted a `sleep 40`, restarted
  (`[agent#1] W: RESTARTED`, 11 s, no `sleep` left); Opus 5.5 ran two subagents, one with an inherited model, and got
  the queued follow-up in the same message (`[agent#1] W: ... first ... W: ... second`,
  `[agent#2] Q: The bug is in add ...`).

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
  four sentences, 426 characters (test limit 500). Empty strings count as not given, since strict mode fills every
  field.
- The main agent and the reviewer work as a pair, one team for the user's agreement (owner, 2026-10-09: «чтобы они
  действовали в одной команде ... либо принимает правку, либо её отклоняет и пишет, почему»; 2026-10-20: «он с ним
  действует в унисон, в паре ... их синергия должна идти в рамках плагина. Это не должно размазываться»). The reviewer
  side is `REVIEWER.md` ("on Main's team"). The main side lives in three carriers of `index.ts`, each paid only where
  it is needed:
  - `DESCRIPTION` (every request while the plugin is on): who the reviewer is, "works with you as one team for the
    user's agreement", and how to call it; the handling rules left it.
  - the tool result, `startedText`: `review#N started. Keep working, but leave the reviewed files unchanged until its
    verdict.`
  - the verdict wrapper, `verdictMessage`: `[review#N]` first, the verdict verbatim, then one paragraph of `NEXT` by
    kind. `clean` (the trimmed verdict is exactly `CLEAN`): passed, no further pass for confidence.
    `incomplete` (a trimmed verdict begins with `CLEAN` but includes extra nonblank text): resolve UNCHECKED or retry
    malformed output, never claim passed or treat it as findings needing field access. `findings` (other reviewer
    text): find each quote by searching; a finding with both quotes verbatim is admitted and fixed exactly to
    its REQUIRED OUTCOME and no further, never rejected, argued with or put to the user; reject only when a quote is not
    verbatim or a NOT AGREED element is covered by a verbatim agreement quote, giving that quote; fix all admitted in
    one batch, then call `review` again with the same level, object and criterion and every rejection so far, until
    CLEAN. `failed` (the catch branch, not parsed text): the check has not passed and no self-check replaces it; retry
    once on the unchanged object, then tell the user and wait.
  Not `promptSnippet` or `promptGuidelines`: RQW-prompt sets `systemPromptOptions.customPrompt`, and Pi builds the
  section where they go only without a custom prompt, so they would never reach the model while RQW-prompt is on.
  Not `SYSTEM.md`: turning RQW-review off must remove the pair completely, and with the rules in the plugin it does.
  Source: `/tmp/review-pair.md` section 3.
- Reviewer-side tuning candidates, not edits (`REVIEWER.md` changes only through the measurement bench):
  1. REQUIRED OUTCOME names the one end state the agreement requires, never a choice between fixes or a question to
     the user (the 2026-10-09 loops came partly from such choices).
  2. Describe the real brief tags: `<user_messages>` (every user message of the branch in order, summaries labeled as
     not the user's words), `<agreement>`, `<object>`, `<criterion>` and, from the second pass, `<rejected_earlier>`;
     requirements come from the messages this object answers.
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
- grep and find go to the reviewer as `customTools` (`reviewerTools`): the stock definitions with a
  `prepareArguments` that drops optional arguments equal to the string `"null"`, `"undefined"` or blank
  (`dropEmptyOptional`) before Pi validates them; execute stays stock. Reason (review finding): stock grep passed
  `--glob null` to rg and answered "No matches found", so a reviewer could confirm a removed name was gone everywhere.
  RQW-tools has no such normalizer to reuse; a real JSON `null` Pi already strips.
- The reviewer uses the session's own model runtime, `ctx.modelRegistry.runtime`, private to TypeScript only.
  Reason: providers and logins that the user's extensions register reach the reviewer (here `pi-claude-auth`
  registers the `anthropic` provider), and no second runtime refreshes the same OAuth login.
- `REVIEWER.md` is the Spotty body from `my-omp-harness` `deprecated:agents/spotty.md` with two changes for Pi: the
  `read` note (Pi's read prints no line numbers; the bracketed continuation note is not file content) and the final
  answer as the last message instead of a `yield` call, worded as in master `agents/review.md`. The verdict format
  stays: `CLEAN`, or `FINDINGS:` with numbered `FINDING n` blocks (REQUIREMENT, MISMATCH, EVIDENCE, REQUIRED
  OUTCOME), and an optional `UNCHECKED:` section.
- Async: the call returns `review#N started. ...` at once. The verdict, the reviewer's last assistant text, arrives as
  `pi.sendMessage({ customType: "review", content: "[review#N] <verdict>\n\n<next step>", display: true }, ...)`; `details` carry
  `n`, level, model, thinking and seconds for the user and logs only. Numbers count per session and go on after a
  resume. `session_shutdown` aborts every running review and delivers nothing; the 10-minute timer does not keep the
  process alive.
- Delivery: a verdict never waits in the agent's queue and gets exactly one main turn unless the run was aborted
  (review findings: in print and json mode Pi disposed the session when the main run settled and the verdict never
  came; a follow-up waited in the agent's queue, which TUI Esc and RPC `clear_queue` clear and an RPC abort or an
  error-ended run leaves without a turn; a verdict that came in while another extension's slow `agent_before_settle`
  handler ran after ours got no turn).
  The `session_start` context is kept. When `ctx.isIdle()`, the verdict goes with `triggerTurn: true, deliverAs:
  "followUp"` and starts a turn. When busy, it goes with `triggerTurn: false`: Pi appends it to the session at the
  end of the current turn or run, aborted or not, and the `agent_before_settle` handler returns `continue: true`
  while the verdict is not yet followed by an assistant message in the branch. Each review sends one verdict, so its
  number `n` in `details` is the delivery number. When that handler returns without `continue`, a `settling` flag is
  set until `turn_start` or `agent_settled`; verdicts that arrive meanwhile wait in a `late` list, and the
  `agent_settled` handler sends them, all but the last with `triggerTurn: false` and the last with
  `triggerTurn: !event.aborted`, so several get one turn. After an abort no turn starts; the verdict stays in the
  session and the model sees it on the next prompt, once. In print and json mode the handler first waits for running
  reviews (each ends within the 10-minute timeout), and their verdicts continue that same run before Pi exits.
- Credentials: a review fails with "no credentials" only when both `ctx.modelRegistry.hasConfiguredAuth(model)` and
  `await runtime.checkAuth(provider)` say so, as in Pi's own prompt. Reason: the auth snapshot behind
  `hasConfiguredAuth` is filled asynchronously, so right after startup or a reload it can miss credentials that exist.
- Proof: `extensions/RQW-review/test/review.test.ts` (real sessions, faux providers for the main and the reviewer
  models) and one real run per level: a temp copy of a fixture with `calc.py` (`add` returns `a - b` instead of the
  sum) and a correct `config.py` (`MAX_ITEMS = 50`), command
  `pi -e /tmp/my-pi-review --mode json --model anthropic/claude-opus-5-5 --thinking low -p "<prompt>"`, the prompt
  quoting the request and asking to call `review` and then `sleep 150`. Both verdicts named the defect and nothing
  else and started a main turn: `blind` in 8.7 s (`EVIDENCE: "return a - b"`), `high` in 3.8 s. After the delivery
  fixes, tests for print and json mode (the run waits and continues with the verdict), a verdict arriving while the
  main agent streams (continues its run once), TUI Esc and RPC abort (the verdict is in the session once, no run
  starts, the next prompt carries it once), two verdicts that arrive while a slow second extension
  (`test/slow-settle.ts`, loaded after RQW-review) holds `agent_before_settle` (one main turn for both), and grep and
  find with `"null"`, `"undefined"` and blank arguments through Pi's validation and inside a reviewer session.
  Without the `agent_before_settle` handler, the busy-time delivery, the `settling` flag or `reviewerTools`, these
  tests fail. Every test passes when run alone, which needs the `checkAuth` fallback. Live run in json mode with no
  `sleep`: Haiku 5.5 as the main model replied `started`, the run waited, `[review#1] FINDINGS: ... EVIDENCE:
  "return a - b"` arrived after 5.1 s and the main agent answered it in the same run (`GOT VERDICT: ... returns
  a - b instead of the sum`), exit 0 in 13 s.
- Open: `ctx.modelRegistry.runtime` may be renamed by a Pi update, then every review fails with "the model runtime of
  the session is not reachable"; a verdict that finishes after the session ended (quit, `/new`, `/resume`, reload)
  is dropped, since `session_shutdown` aborts running reviews; in print and json mode the run waits up to 10 minutes
  for a slow review; a verdict that arrives during a manual `/compact` with no run is appended without a turn and is
  seen on the next one; the reviewer may read a file the main agent is still editing; the main agent's own RQW-tools
  grep still passes a string `"null"` glob to rg; in one smoke run Haiku wrote a MISMATCH of more than 20 words.

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
