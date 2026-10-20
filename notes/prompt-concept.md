# How the omp-lite system prompt was assembled (concept for rebuilding on Pi 1.3.0)

Reconstructed from git history, `DECISIONS.md`, `AGENTS.md` and omp session logs. Read-only research; nothing else was changed.

## Evidence keys

| Key | Path |
|---|---|
| REPO | `~/Documents/ChatGPT/my-omp-harness` (branch `master`; `lite` was merged into it, `SYSTEM.md` is byte-identical in `master` and in the `lite` worktree `~/Documents/ChatGPT/my-omp-harness-worktrees/lite`) |
| DEC-L / DEC-M | `DECISIONS.md` in the lite worktree / in REPO master (master is newer: todo on, bench34-41, models) |
| CODEX | `~/Documents/ChatGPT/my-codex-harness` (`new-model-instructions.md` and its git log) |
| CPI | `~/ai-project/cursor-pi/research/cursor/remaster/README.md` and `prompts/` |
| S-0216 | `~/.omp/agent/sessions/-Documents-ChatGPT-my-omp-harness/2026-10-16T15-06-24-992Z_01a14540-0160-747e-a913-89e6290a2960.jsonl` (adopting the GPT-5.5 prompt) |
| S-0217a | `.../-Documents-ChatGPT-my-omp-harness/2026-10-17T06-35-05-760Z_01a14892-3ca0-7669-b401-f94b34f54af7.jsonl` (GPT-6.1 Sol workflow borrowings) |
| S-BENCH | `~/.omp/agent/sessions/--private-tmp--/2026-10-17T18-16-01-617Z_01a14b13-f551-76b0-adfd-9f3110a50c9d.jsonl` (stand/bench session where omp-lite was built; timestamps below are UTC from this file) |
| S-PI | `~/.omp/agent/sessions/-ai-project-my-pi/2026-10-20T10-16-23-330Z_01a158cf-ea22-7691-a4f3-7ed708683c0c.jsonl` (Pi comparison, bench41, my-pi start) |

Commits of `SYSTEM.md` (REPO): `f30ff84` 2026-10-16 "Adopt GPT-5.5 prompt", `436aa2e` 2026-10-17 "Preserve task goals and cumulative decisions across turns", `b37b6a9` 2026-10-18 "omp-lite as is (... speed block, no Gold Standard ...)", then 2026-10-19 03:48-04:08 +0300: `3be0748` compact message rules, `67bdb25`, `59c0cdc`, `29f13b8`, `3f5703c`, `24bab93` merged into `working_with_the_user` replacing formatting and final-answer rules, `0f6f48d` and `816e3fa` (fixes from two sequential blind reviews), `c60b0da`, `07833be`, `a52b6cd` (last).

---

## 1. Where each section of the current `SYSTEM.md` came from

### 1.1 Lineage of the base text

1. **OpenAI Codex GPT-5.5 base instructions** (openai/codex) → CODEX `aa11a48` (2026-10-16 10:09) "original GPT-5.5 base instructions without five cuts".
2. **Cursor's GPT-5.5 system prompt** as Cursor actually sends it (captured through the adapter log 2026-10-16) → CODEX `1770391` (2026-10-16 11:24): "the prompt Cursor sends to GPT-5.5 ... with Cursor renamed ...; the Cursor frame and tools, multi_tool_use.parallel, the test-coverage item, suggest-follow-ups, the every-30s update items, the headers rule, the 2-4 sections paragraph ... are removed". The tag skeleton `<general>`, `<editing_constraints>`, `<engineering_judgment>`, `<special_user_requests>`, `<working_with_the_user>`, `<main_goal>` and the line "You are a coding agent in X that helps the USER" are Cursor's.
3. **RC2** (CPI, "GPT-6.1 Sol release candidate 2 (2026-10-16)"): the Cursor GPT-5.5 prompt with OMP as product, plus one paragraph from Cursor GPT-5.6 Sol `<epistemic_rigor>`: "Do not reflexively agree ... Verify uncertain claims ...". CPI explains why the four full GPT-5.6 Sol blocks were left out: "the Cursor GPT-5.5 prompt is the owner's reference experience ... Further rules are added only for problems observed in use."
4. CODEX `68c2b10` "Prompt: add evidence-based independent judgment" → the full `<epistemic_rigor>` block and the `<engineering_judgment>` rules (structured parsers, no defensive layers around unshipped code). S-0216 assistant 15:09: "прямое несогласие с ошибочными утверждениями, ответы на возражения через факты, структурные парсеры ...".
5. REPO `f30ff84` (2026-10-16): CODEX's prompt replaces omp's `SYSTEM.md` wholesale. User, S-0216 15:21: «Я бы даже заменил наши текущие действующие правила и разрешения на этот промпт, потому что он эталонный. Этот GPT-5.5 — эталонный промпт». Adaptations: product renamed to omp, `ApplyPatch` → "Use the available file-editing tool ... in the format supplied for your model", ASCII rule widened ("such as the task's language ... Keep readable Unicode in structured data"), `date` and review items bound to "the tools and execution role available in this session" / "a named review procedure", subagent completion sentence added. The previous omp prompt ("You are an AI agent powered by ...", Personality, Writing style, PR descriptions, Using skills) was deleted.
6. REPO `436aa2e` (2026-10-17): continuity rules from the GPT-6.1 Sol analysis (S-0217a, user 06:38: «Он не сбивался с цели, продолжал работу, не забывал про цель»): "Treat new user messages as steering ...", "check it against the active objective ...", "Treat work across compactions ... as one continuing task", and `<main_goal>` "Carry the active, authorized task through ..." (replaced "Your main goal is to follow the USER's instructions at each message").

The user calls this base both "GPT-5.5 prompt" and "RC2" (S-BENCH 2026-10-17 20:38: «не систем GPT-5, а GPT-5.5, блядь»; 20:43: «это GPT-6.1 Sol Release Candidate промпт 2 ... смесь старого GPT-5.5 курсорского промпта с усилениями GPT-6.1 промпта»). Both names mean the Cursor GPT-5.5 text above.

### 1.2 Section by section (current text)

| Section | Source | What happened in omp-lite and why |
|---|---|---|
| `You operate in omp.` / `You are a coding agent in omp ...` | Cursor GPT-5.5 identity lines, product renamed | Kept. For Pi bench41 renamed to `pi` (REPO `bench/bench41-system-pi.template.md`). |
| `<epistemic_rigor>` | Cursor GPT-5.6 Sol block (CODEX `68c2b10`) | Kept. `b37b6a9` added "Verify uncertain claims", one of the four lost RC2 rules the user ordered back (S-BENCH 2026-10-17 20:52: «проверять неуверенное утверждение. Да, давай, их вписывай обязательно»). |
| `<general>` first paragraph + "If a tool exists ... prefer the tool" | Cursor GPT-5.5 | Kept. Cursor-specific lines dropped already in f30ff84: auto-attached state, Shell persistence, `Lxxx:` prefixes, `multi_tool_use.parallel`. |
| `<general>` **speed block**, 4 lines | Own; from bench17 step-cost measurements | Replaced "Parallelize tool calls whenever possible - especially file reads" in `b37b6a9`. Proposed in S-BENCH 2026-10-18 08:40, accepted 08:46: «Давай вставим блок вместо скрипта параллельности, уберем gold стандарт вообще». Basis: each step costs about 2.2 s plus 1.16 s per 100 output tokens; tools take 0.03-0.06 s between steps (DEC-L "Parallelism"). |
| `<general>` "several implementations ..." | Own (bench) | Added `b37b6a9`. S-BENCH 2026-10-18 00:33, option 5; user 00:40: «Да, пятый пункт тоже согласен. Мы делаем жадный поиск максимально по теме». Reason: small prompt lost points because answers did not say the Rust `/app/auth` runs in prod and Python is a twin (DEC-L "Answer rules"). |
| `<general>` "name the exact identifiers ..." | Own (bench) | Added `b37b6a9`. Reason: on T06 the Redis key `currency:tradeoffer:cooldown:{key}` was in the tool output in all four runs and in none of the answers (DEC-L "Answer rules"; S-BENCH 2026-10-18 07:18). |
| `<editing_constraints>` | Cursor GPT-5.5 | Kept unchanged since `f30ff84` (only the edit-tool and ASCII adaptations above). |
| `<engineering_judgment>` | Cursor GPT-5.5 + CODEX additions | Kept. The Cursor test-coverage item was cut already in CODEX `1770391`. |
| `<special_user_requests>` | Cursor GPT-5.5 | Kept, with the "named review procedure" sentence. |
| `<working_with_the_user>` intro + intermediary updates | Cursor GPT-5.5 | "Share intermediary updates while you work" → "only for a blocker or a changed assumption" (`b37b6a9`); the whole "Intermediary updates" section deleted. User S-BENCH 2026-10-18 00:40: «Промежуточные сообщения убираем». `29f13b8` re-added "or one note before a long wait" from Clear Communication's "Explain a long wait once" (DEC-L). |
| subagent-completion sentence | f30ff84 adaptation | Kept. |
| Continuity paragraphs | `436aa2e`, GPT-6.1 Sol | Kept. |
| "You are producing Markdown ..." + Language / Content / Shape / Choices and questions | Main harness skill `skills/clear-communication/SKILL.md` (REPO `436aa2e:skills/clear-communication/SKILL.md`), compressed | `3be0748`...`a52b6cd`. These rules replaced the Cursor "Formatting rules", "Final answer instructions" and their "Requirements" list (diff of `24bab93`). Details in 1.3. |
| `<main_goal>` | `436aa2e`, GPT-6.1 Sol | Kept. |

### 1.3 How Clear Communication was merged

User, S-BENCH 2026-10-19 00:36: «Communication да, мне нравится. Давай его перенесем, чтобы он был только частью»; 00:36: «самым простым способом, максимально компактным, чтобы он сохранил всю свою концепцию, но был суперкомпактным»; 00:52: «компактно переносишь ... так, чтобы он органично врос в него, не дополняя, а заменяя те вещи, которые там уже есть. И перепроверь двойными слепыми проверками»; 00:55: «последовательно проводи их». Two Opus-high blind reviews ran one after the other; first found 8 findings, second 5, both ended CLEAN (assistant 00:57-01:11, commits `0f6f48d`, `816e3fa`).

What came from where in the merged text:
- From Clear Communication: Russian with «ты»; bold first sentence that carries the main point; "only what he needs for his next step" and «почему»/«подробнее»; "shorten by leaving facts out, never by packing"; 1-4 sentences, max 12; `---` separators; no headings, bold only in first sentence; detailed form with bold labels; self-contained messages, no codes; approvals with proposal, reason, alternatives; the «Вопросы · N» format with «— *рекомендую*» and the closing «> Ответь одной строкой ...» line; "Preserve meaning" and handoff rules (now the scope paragraph "They change only how messages read ... never replaces a missing source with a summary").
- Kept from the Cursor final-answer rules, compressed: flat lists numbered `1. 2. 3.`, native format for PR descriptions and docs, backticks, fenced blocks with info string, "Cite code ... never large blocks and never to show the final code", Markdown links and PR links, "user does not see tool output", never tell him to save or copy a file, "no 'if you want' lines", "Never praise your plan by contrasting it with an implied worse alternative", no emojis or em dashes, "coined metaphors, internal jargon or slash-heavy noun stacks".
- File references: "a real local file as its accurate repository-relative path ... `src/app.py:12`" replaced Cursor's clickable absolute links in `b37b6a9`. User S-BENCH 2026-10-18 00:40: «Ссылки на файлы делаем как у Пи». Reason: about 30 absolute links per answer, about 750 tokens and 12 s (assistant 00:33).
- Dropped: "Headers are optional" and "use at most 2-4 high-level sections" (RC2 rules restored on 2026-10-17, superseded by "No headings" in `24bab93`); "Never overwhelm ... 50-70 lines"; "For casual chit-chat, just chat" (`c60b0da` removed the last "Casual chat" line); Clear Communication's examples, its "Reapply silently before sending" mechanics and its reference to the Gold Standard.
- Cross-links added: Content and Shape refer to `<general>` so that the answer-completeness rules (implementations, identifiers) win over brevity.

### 1.4 What was deliberately removed and why

1. **Gold Standard** (`skills/gold-standard`, appended by `harness.ts`, 11.8k chars). Removed in `b37b6a9`. DEC-L "Scope": "written against GPT-5.6 over-engineering and fight greedy search". Steps: S-BENCH 2026-10-17 20:30 the agent showed that "Finish the whole task ..." swells answers and "Gather only the minimum information ... as quickly and shallowly as possible" forces piecewise reading (00:33 2026-10-18: «Почему он читает кусками. Так велит Gold Standard»). User 20:32: «у курсора нет золотого стандарта. У курсора есть только системный промпт. Как насчёт того, чтобы убрать золотой стандарт»; 00:40 2026-10-18: «Gold Standard против жадного поиска. Выбираем жадный поиск, записываем в описание инструментов». Briefly re-added during the rollback of 2026-10-18 00:05 (user «6 вернуть»), finally removed 08:46.
2. **Workflow Manifest principles** (REPO `436aa2e:WORKFLOW-MANIFEST.md`). Six manifest lines were put into `<general>` on 2026-10-17 20:47, removed in the rollback (user 00:05 «4- убрать»), and not returned. User S-BENCH 2026-10-18 08:39: «кратчайший путь — это была борьба с тем, как работает старый весь workflow-манифест. У нас GPT-5.5 заебись работала. Это всё появилось, когда мы стали работать с GPT-5.6 и с его оверинжинирингом ... Просто оставить параллелизм, суперэффективность, супербыстрость. Именно что мы работаем на скорость, а не на количество шагов». Removed principles listed in DEC-L "Scope": "everything agreed and nothing beyond", "heavy work only on request", "dig deeper only at a contested point", "shortest path". Note: "adding nothing outside its scope" survives in `<main_goal>` from `436aa2e`.
3. **`omp-tools` skill** (tool rules appended after the prompt) and **`GPT_NOTES`**. Cut to active tools on 2026-10-17 21:06, then removed. User 00:13 2026-10-18: «Удали нахуй GPT Notes». Its job moved into per-tool `description.md`.
4. **`main-workflow`, `subagents`, `clear-communication` skills, reviews, goal, todo text.** Dropped when the stand was built (S-BENCH 2026-10-17 17:31 brief; DEC-L). Clear Communication came back only as compact `SYSTEM.md` rules (1.3). The approval step became `skills/approval`, off (`disabledExtensions: [skill:approval]`; user 00:46 2026-10-19: «режим согласования вынеси в отдельный skill ... Пока выключи его»).
5. **Clickable absolute links and mandatory progress updates**: see table above.
6. **"give the key steps and decisions; do not narrate every call"**: added for brevity, removed in the rollback (user 00:05 «3+» on the "убрать" proposal).
7. **`OMPLITE_TRIM`**: a shorter answer rule for non-running implementations plus a 500-line first read, rejected and deleted (section 4).

---

## 2. Design principles agreed for the prompt as a whole

1. **The Cursor GPT-5.5 text is the reference; speed it up, do not break it.** S-BENCH 2026-10-17 20:34: «Он для меня эталон, и я не хочу его ломать. Я бы хотел его только ускорить, но не сломать». Also S-0216 15:21 (quoted above). CPI: "Further rules are added only for problems observed in use."
2. **One system prompt, no extra principle layers.** S-BENCH 2026-10-17 20:32: «у курсора нет золотого стандарта. У курсора есть только системный промпт». `harness.ts` appends only the environment line (DEC-L "Scope"; `extensions/harness.ts:39-45`).
3. **Tool rules live in tool descriptions; `SYSTEM.md` holds only rules that span all tools.** S-BENCH 2026-10-18 08:56: «Давай как-то делать пиздато, чтобы system.md был достаточно тонким, а всё, что касается инструментов, описывать в самих инструментах так, как это делается в самом курсоре»; 17:05: «В Agent MD описать, что у нас инструкции всех инструментов внутри самих инструментов прописываются». Carried by AGENTS.md rule 1 and layout line "SYSTEM.md rules that span all tools; nothing tool-specific"; DEC-L "Parallelism".
4. **Speed means wall-clock time, not steps or tokens.** S-BENCH 2026-10-18 08:39 (quoted in 1.4); 00:59: «Ты не считаешь по токенам время. Ты считаешь время нормально, по часам». DEC-L "Measurement": "Speed is wall clock only". The speed block encodes the cost model.
5. **Greedy, wide and deep search on the subject, with a stop rule.** S-BENCH 2026-10-18 00:24: «дай ему ЖАДНЫЙ ШИРОКИЙ ГЛУБОКИЙ АЛГОРИТМ МАКСИМАЛЬНО БЫСТРЫЙ И ЖАДНЫЙ с ОБРЕЗКАМИ хитрыми»; 00:40: «Мы должны найти всё, что относится к этой теме. Это супер критически важно для нас». The wave method sits in `extensions/tools/grep/description.md`; the stop rule ("do not follow the subject into neighbouring subsystems") was added after bench17 T05 wandered into Mongo and quarantine code (DEC-L "Search method").
6. **Everything in parallel.** S-BENCH 2026-10-18 07:24: «Агент должен быть суперэффективный, суперпараллельный»; 17:19: «Все инструменты должны быть доступны в параллели без эксклюзива». In the prompt this is the "same response" line of the speed block.
7. **Compact, replacing instead of adding.** S-BENCH 2026-10-19 00:36 and 00:52 (quoted in 1.3). Also 2026-10-18 08:04: «Я хочу зарезать промпты максимально. Вернуть их максимально, при этом не потеряв в качестве».
8. **But do not thin `SYSTEM.md` further.** S-BENCH 2026-10-18 14:41: «Тоньше System MD не надо делать. И так заебись. Уже максимально тонко ... Тем более, это всего лишь первый запрос».
9. **Brevity without loss of clarity or quality.** S-BENCH 2026-10-17 20:29: «чтобы агент отвечал максимально кратко, насколько это возможно, но при этом понятно ... краткость не означает непонятность». The length lever is `textVerbosity: low` in config, not prompt text (DEC-L "Answer rules"; S-BENCH 2026-10-17 23:59 assistant; `settings/config.yml:70`). Rejection of TRIM confirms quality wins over a few seconds (section 4).
10. **No mentions of other products.** S-BENCH 2026-10-18 16:54: «Давай как-то без упоминания слова «курсор». Мы делаем свой пиздатый tooling». AGENTS.md rule 7. The host product name itself stays ("You operate in omp").
11. **Stock tool names; names do not matter to the model.** S-BENCH 2026-10-18 08:04: «нейминги пусть у всех наших основных инструментов будут такие же, как у стокового OMP или у стокового Pie». AGENTS.md rule 3.
12. **English prompt, Russian output.** Never stated as one sentence by the user, but consistent: every prompt and description is English; the Russian rule is a prompt line ("Every text for the user is in simple Russian and addresses him as «ты»"). The user asked for translations of English prompt lines (S-BENCH 2026-10-18 08:41: «На русский мне переведи, я не понимаю»), and before the merge the agent noted the lite prompt was "на английском и без этих деталей" (2026-10-19 00:31). Russian quotations stay in Unicode inside the English prompt (ASCII rule exception).
13. **Prompt changes need the owner's agreement and a recorded reason.** AGENTS.md "Checks": "A change of model-facing text needs the owner's agreement"; DEC-L header "Change a decision only by editing its entry here together with the file"; S-BENCH 2026-10-18 07:31: «Надо записать все решения». Benches rerun only after the owner agrees on the change set (DEC-L "Measurement").
14. **Answer completeness beats brevity for code questions.** Rules 1.2 "several implementations" and "exact identifiers", and the Shape cross-reference to `<general>`.
15. **Mechanics before prompt only when measured.** For Pi: S-PI 12:24: «здесь будем собирать по шагам эту обвязку. Начнём с промта»; 10:50: «по нашим тестам из коробки стоковый Pi быстрее нашего my omp harness но точность страдает сильно».

---

## 3. Behaviour rules outside `SYSTEM.md`

### 3.1 Where they live

| Place | Rules |
|---|---|
| `extensions/harness.ts:7-12` | Environment line: embedded bash-compatible shell with built-in grep, sed, find, xargs, jq and coreutils; absolute forward-slash paths (Windows: "never /c/... or backslashes"); programs found on PATH. |
| omp `packages/coding-agent/src/prompts/system/project-prompt.md` (in `~/Documents/ChatGPT/oh-my-pi`) | `<project-context><workstation>` OS, Arch, Model; repo rules and AGENTS.md list; `<critical>`: "Each response MUST advance the task; completion only stopping condition", "MUST default to informed action ...", and for Main "Before yielding, MUST verify significant behavioral changes: run the specific test ..." (subagents get "Changes complete → yield ..."). |
| omp user-side `<system-reminder>` | "Today: ...; current working directory: ... Do not repeat this information in your reply." |
| `extensions/tools/grep/description.md` | ripgrep usage, escaping, prefer `type`, multiline, "at least" truncation; the greedy wave method and stop rule. |
| `extensions/tools/read/description.md` | Read whole by default; "speculatively read multiple files as a batch"; up to 1000 lines then offset; "Read every file that may relate to the subject in one response"; code ranges grow to the enclosing block. "Read whole files rather than pieces" was removed as it contradicted grep's point reads (DEC-L "Parallelism"). |
| `extensions/tools/glob/description.md` | Batch searches. |
| `extensions/tools/bash/description.md` | One fact per command, `&&` for dependencies, scripts to `eval`, `cwd` not `cd`, timeouts, background jobs, "NEVER poll", no head/tail, services. |
| `extensions/tools/edit/description.md`, `write/description.md` | Batching across files, per-file locks, busy refusal; write long files (> about 400 lines) in parts (reason: bench35 single write hit the 128 000-token output limit, DEC-M). |
| `eval`, `load_tools`, `lsp`, `ast_grep` descriptions | When each tool beats grep; load in the first response; eval not for searching/reading. |
| `todo/description.md` (master only) | Plan for multi-stage work, ops in the `todo` field of work calls, never a todo-only response. |
| `code_writer`, `shell_runner`, `codebase_explorer`, `review`, `custom` descriptions + `agents/*.md` | Brief and trust rules, "brief about as long as the code" threshold, explorer only for an extra independent area. |
| `settings/config.yml` | `textVerbosity: low` and read/tool limits. |

### 3.2 What a harness with only `read`, `bash`, `edit`, `write` needs in its prompt

This was already done once: bench41 template `REPO/bench/bench41-system-pi.template.md` (DEC-M "Results log", S-PI 11:21). It is the current `~/ai-project/my-pi/prompt/SYSTEM.md` minus the tail that `extensions/prompt.ts` generates.

Needed and present in the template:
1. **Search method as a prompt section** (`<search_method>`): the grep wave rewritten for `rg -n` through bash, "separate parallel bash calls", `rg --files -g` for deploy and entrypoint files, read whole definition/config/entrypoint files, point reads elsewhere, stop rule. Also "This harness has no search tool" — added after a strict review found that "prefer the tool instead of shell" contradicted search through bash (S-PI 11:21).
2. **Batch reading** from the `read` description: "speculatively run multiple searches and read multiple files as a batch", "Read every file that may relate to the subject in one response".
3. **Environment line**, adapted: "the bash tool runs bash".
4. **omp-injected blocks** copied for parity: `<workstation>`, `<critical>` (Main variant), and the date/cwd line with "Do not repeat this information in your reply" (the review found it missing at first, S-PI 11:21).
5. `textVerbosity`/verbosity low on the provider request (checked in the first request, S-PI 11:21). This is config, not prompt.

Worth considering, not yet in the template:
1. **Long writes in parts** (`write/description.md`): the output-limit loss is model-side and applies to Pi's `write` too. Either a prompt line or a Pi tool-description override.
2. **Shell hygiene** from `bash/description.md`: chain dependent commands with `&&`, set a timeout for long commands. Pi `bash` has only `command` and `timeout`, so the rest (pty, background, `block_until_ms`, `artifact://`) does not apply.
3. **Read limits**: the wave rule says "read without offset or limit"; Pi's read returns up to 2000 lines or 50 KB, not 1000. The "continue from the returned offset" wording fits; the code-block range expansion line must not be carried over (no equivalent in Pi).

Not needed: `eval`, `load_tools`, `lsp`, `ast_grep`, `todo`, subagent rules, edit locks and `apply_patch` notes (Pi's `edit` is one file with `edits[]`; "gather all changes to one file into one edit call" already sits in the speed block).

Pi side effects of `systemPromptOptions.customPrompt` (`/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/system-prompt.js:78-110`): the preamble, the one-line tool list, the rules list ("Use bash for file operations like ls, rg, find", per-tool `promptGuidelines`, "Be concise in your responses", "Show file paths clearly") and the Pi docs block are dropped; `appendSystemPrompt`, project context, skills and a `<cwd>` section are still appended.

---

## 4. Measured effects and rejected variants

From DEC-L/DEC-M "Results log" and S-BENCH, S-PI. Time is wall clock from `run.json`; quality is a judge checklist score.

| Bench | Change measured | Result |
|---|---|---|
| bench4 (S-BENCH 2026-10-18 00:00) | Brevity edits of SYSTEM.md (links, updates, "key steps") | 151 → 130 s, quality 93 → 91; answer still about 19k chars. |
| 2026-10-17 21:52 (S-BENCH) | `textVerbosity: low` | Main agent output about 7.6k → 3.2k tokens, answer 19k → 7.3k chars on the large prompt. "Длину по-настоящему срезал только verbosity: low" (00:00). |
| After rollback, 2026-10-18 00:20 | Subagents off, links/updates back | Large prompt 400 → 94 s at quality 98 (Pi 77 s, 98). |
| Estimate 2026-10-18 00:33 | Cost of absolute links / call args / updates | about 750 tokens (12 s), 430 (7 s), 200 (3 s) per large run; estimate, not a run. |
| bench13-16 | small/large prompts | omp-lite 17.5 vs Pi 17.4 s; large 54.9 vs 84.2 s. |
| bench17 | before 100k budgets | omp-lite 43.4 s / q88.3; Pi 42.4 s / q79.7. |
| bench18 (gpt-6.1-sol low) | budgets, Rust search, stock names, **speed block, no Gold Standard**, eval wrapper together | omp-lite 61.6 s avg / 56.9 median, q99.3, 30 calls; Pi 63.9 / 43.8, q92.3, 12.7 calls. Effects not separated. |
| bench19-20 | read variants base/expand/map | omp-lite ties Pi on average time, leads quality by 9-17 points on gpt-6-sol, 4 on gpt-6.1-sol high. |
| bench21 | stock Codex CLI and stock omp | gpt-6-sol low: Codex 45.2 s q77.7; omp 57.1 s q83.2. |
| **bench22** | **`OMPLITE_TRIM=1`** (short rule for non-running implementations + first read 500 lines) | low: 32.0 → 29.4 s, q93.0 → 89.9; gpt-6-sol high: 53.9 → 49.8, q91.6 → 89.0; gpt-6.1-sol high: 107.0 → 107.2, q99.3 → 96.4. Answers only 6-10% shorter. Rejected: user S-BENCH 2026-10-18 16:06: «то, что ты сделал, что привело к потере качества, мы это убираем, от этого отказываемся нахуй». The two parts were not measured separately. |
| bench23 | restructure with `load_tools` | 23.8 s vs 32.0 s, judged 88.8 vs 90.5 by the fallback judge (noise). |
| bench25-33 | tool loading and explorer descriptions | Description wording changes behaviour: `load` mode kept; explorer narrowed; see DEC-L "Tool set". |
| bench34-39 (DEC-M "Todo") | todo | About 20% time on questions, about 70% on code changes, no quality gain; todo kept only for multi-stage tasks. |
| **bench41** (S-PI; DEC-M; `REPO/bench/bench41.csv`) | **stock Pi vs Pi with the omp-lite prompt vs omp-lite (todo off)**, T01-T07, 3 runs | gpt-6-sol low: Pi 34.0 / 29.1 q77.3; pi-prompt 38.5 / 32.1 q87.5; omp-lite 44.9 / 27.7 q91.0. gpt-6-sol medium: 49.7 / 39.4 q83.0; 49.7 / 45.6 q89.2; 67.3 / 36.6 q86.3. gpt-6.1-sol medium: 67.5 / 41.2 q96.2; 71.7 / 56.8 q98.1; 170.8 / 133.6 q90.8. The prompt alone adds 10.2 / 6.2 / 1.9 points for 0-4.5 s average. On gpt-6.1-sol medium all of Pi's loss was the "which implementation runs in prod" point; with the prompt it was never lost. Cost: 1.5x more calls, about 3035 vs 2478 output tokens. |

Other rejected or withdrawn prompt variants:
1. Hard "Final answer limit: at most 120 lines" (S-BENCH 2026-10-17 20:29) — not adopted; user preferred GPT-6.1 style "краткость не означает непонятность".
2. Six manifest lines in `<general>` — added 2026-10-17 20:47, removed 2026-10-18.
3. Explorer trigger line in `SYSTEM.md` — not added; the rule lives in the tool description, as in Cursor (S-BENCH 2026-10-17 20:56).
4. Explicit threshold "finds it in 1-2 searches" — rejected by the user 20:38: «Как агент знает, что она находится за один-два поиска ... агент никогда не знает, что он знает, что он не знает».
5. "key steps" line, GPT_NOTES, omp-tools — removed (1.4).
6. Two grep tools for code and text — rejected (DEC-L "Code mode of read").

Unmeasured: the speed block alone, the two answer rules alone, and the whole Clear Communication merge (user 2026-10-19 00:37: «пробы больше не делаем»). bench41 is the only run with the final text, and it was on Pi.

---

## 5. Open questions and contradictions

1. **"Tool rules only in tool descriptions" vs Pi.** With stock tools, the search method has to sit in the system prompt (`<search_method>`), or the harness must override Pi's tool descriptions/`promptGuidelines`. bench41 used the prompt; which way my-pi takes is not decided.
2. **`<critical>` "Before yielding, MUST verify ... run the specific test"** is omp's Main default, copied verbatim into the Pi template. The removed manifest said "Ordinary verification is reading and logic". The owner never discussed this line; it is now an unreviewed part of the prompt.
3. **Duplicate cwd.** With `customPrompt` Pi still appends a `<cwd>` section, and the template adds "current working directory: ...". Harmless, but not parity with omp, where cwd comes only in the user-side reminder.
4. **Position of the date/cwd line.** In omp it is a user-side `<system-reminder>`; in my-pi it is in the system prompt and computed once per `before_agent_start`. Date at midnight and cache effects were not checked.
5. **RC2 rules restored on the user's order, then removed.** "Headers are optional" and "2-4 sections" were ordered back (2026-10-17 20:52: «Обязательно вписывай») and later superseded by "No headings" in `24bab93`. The later explicit "replace, not add" instruction covers this, but the owner never addressed those two rules by name.
6. **Intermediary updates.** User: «Промежуточные сообщения убираем» (2026-10-18 00:40); the merge brought back "one note before a long wait" from Clear Communication. Small, and accepted through the reviewed merge, but a softening.
7. **Clear Communication reversal.** 2026-10-17 20:59: «убери ещё промпт clear communication»; 2026-10-19 00:36: «Communication да, мне нравится. Давай его перенесем». The final state is the compact merge; it never went through a bench.
8. **Names of the base prompt.** The user says both "GPT-5.5 prompt" and "GPT-6.1 Sol RC2". Per CPI they are the same Cursor GPT-5.5 text plus one GPT-5.6 Sol paragraph; `<epistemic_rigor>` and `<engineering_judgment>` additions came from CODEX `68c2b10`, not from RC2.
9. **"No product names" vs host names.** AGENTS.md rule 7 bans other products; the prompt names its host ("omp", "pi"). The bench41 template renamed omp → pi. Nothing in the prompt names Cursor, Codex or OpenAI.
10. **lite vs master DECISIONS diverge.** DEC-L says todo off and base tools without `todo`; DEC-M has todo as a base tool. For Pi only the prompt matters, but any todo rule must come from DEC-M.
11. **bench41 parity gaps.** omp-lite kept subagents and `load_tools` (only todo was off). The fallback `completion` judge was used. 3 runs per task: 2-3 point gaps are noise. One omp-lite run wrote `TRADING_LOGIC.md`, and the contaminated low run was redone.
12. **Precedent in Codex.** CODEX `c6cd72d` (2026-10-19) "Inherit my-omp-harness in Codex as closely as Codex allows" already ported `SYSTEM.md` to another harness, moving the grep waves into a `codex-tools` skill. It is a second worked example of the same porting problem.
