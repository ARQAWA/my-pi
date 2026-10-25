# my-pi: decisions

Decisions in force today, with the owner's words, the reason and the file that carries each. Superseded, obsolete and
merged entries are kept word for word in [DECISIONS-ARCHIVE.md](DECISIONS-ARCHIVE.md); measurement and probe ledgers
live in [notes/decisions-evidence.md](notes/decisions-evidence.md); open and deferred work lives in [BACKLOG.md](BACKLOG.md).

Provenance:

- An `Owner` quotation in guillemets is one contiguous span of a single user message, copied byte for byte.
  Nothing inside it is shortened, translated, retyped or normalized. Coordinator text and entry-name citations use
  ASCII quotation marks, not guillemets; only genuine owner words use guillemets.
- The locator `<session>:<line>` names a session file in `~/.pi/agent/sessions/--Users-arkadijcukavin-ai-project-my-pi--/`
  by the time in its name and the physical JSONL line of the user entry: `13-49-40` is
  `2026-10-21T13-49-40-938Z_01a15eb9-8cc9-702f-8d8c-a2eed8f80923.jsonl`, `16-27-59` is
  `2026-10-21T16-27-59-062Z_01a15f4a-7ad5-7377-81be-0baf3b6ffa33.jsonl`.
- `C:<line>` names the physical JSONL line of the older omp conversation
  `~/.omp/agent/sessions/-ai-project-my-pi/2026-10-20T13-55-12-982Z_01a15998-41d6-76f4-be02-a0e599d0c214.jsonl`.
- Text recorded earlier as an owner quotation but not found verbatim in a user entry of the session files above is
  labelled `Coordinator text`. Coordinator proposals, questions and interpretations are labelled the same way; they
  record the agents' wording, not direct owner approval of each detail, and do not narrow the owner's requirements.
- Every entry has a stable ID `[D-<SECTION>-<NAME>]`; IDs are never reused, archive entries (`A-...`) and
  `BACKLOG.md` refer to them. `Since` is the oldest commit whose `DECISIONS.md` carried the rule
  (`git log -S'<phrase>' -- DECISIONS.md`).
- Only the quoted lines are copied from the sessions; no full transcript and no credential is copied into this
  repository.

## Work policy

- **Only ordered work** `[D-WORK-ONLY-ORDERED]`. The scope and proposal rule is carried once in
  [PROCESS.md, Research and agreement](PROCESS.md#research-and-agreement); review-brief construction is in
  [PROCESS.md, Independent review](PROCESS.md#independent-review) and the native
  [reviewer skill](extensions/RQW-review/skills/reviewer/SKILL.md). This replaces night-default authority
  and the earlier defect-fixing scope permission, preserved verbatim in archive entries A-0318 to A-0323.
  Owner, session `2026-10-21T16-27-59-062Z_01a15f4a-7ad5-7377-81be-0baf3b6ffa33.jsonl`,
  `16-27-59:6382`, entry `6d5adad3`:
  «Ты должен только delivery то, что я заказываю. Ничего сверх этого, ничего, выходящего за рамки. Ты можешь мне что-то предложить, но сам принять ты не можешь этого. И каждую работу, которую ты сдаёшь, должен проверять reviewer, который не должен допускать такие ситуации.»
  Owner, same session, `16-27-59:6384`, entry `875f309b`:
  «любые такие предложения идут ко мне вопросами, а идут предложения только которые ты считаешь критом. Просто так предлагать мне нахуй не надо»
  The latter entry accepts the four-point proposal in assistant entry `40a7eaef`, line 6383, with the critical-only
  proposal amendment. Reason: Main's or an agent's technical approval must not become permission for extra behavior.
  Latest reaffirmation, owner (`16-27-59:9432`, entry `d7037e66`, 2026-10-25):
  «Вообще всё несогласованное нахуй убираем. Ты что, прикалываешься, блядь? Не должно быть ничего, что я не согласовал. Если ты считаешь, что у нас есть какой-то функционал, который я не согласовал с кретом, то ты можешь мне привести доказательство и задать мне вопрос, но не более того. И только если я дам добро оставить, тогда оставляем.»
  All unapproved functionality is removed. Main may present evidence and ask whether to retain a specific item;
  it stays only after explicit owner approval. This reaffirms the same rule, not a new mechanical blocker.
  The reviewer prompt itself is unchanged. Since: rule-only-ordered.

- **Task dependency graph** `[D-WORK-DEPENDENCIES]`. Main identifies, links and blocks dependent tasks itself,
  then shows their order as a plain-text dependency tree in terminal output, not Mermaid. BACKLOG `Blocked by:`
  lines plus the handoff are the graph's source of truth. Owner (`16-27-59:4896`, entry `fcfa64f3`):

  «И вообще ты должен сам уметь строить графы зависимостей и блокировки. Когда я тебе ставлю задачи, ты должен сам их определять, сам их должен друг с другом линковать, ты должен сам их блокировать друг другом и должен мне показывать порядок, показывать граф, желательно визуально, не через Mermaid-диаграммы, а просто в терминале рисовать по терминальным выводам дерево зависимостей, чтобы было понятно, что с чем связано.

  Это тоже в правило запиши: работай с репозиторием нашим»

  Reason: prerequisites must be visible and prevent starting work against missing inputs or a moving layout.
  Carrier: [PROCESS.md, Isolated parallel execution](PROCESS.md#isolated-parallel-execution), `BACKLOG.md`.
  Since: process-rules-oct23 squash.

- **Maintainable minimal code** `[D-WORK-CODE-QUALITY]`. Every change and review keeps source clean,
  readable, minimal and easy to extend. Prefer clear structure and meaningful decomposition over dense expressions;
  brevity must not hide understanding. This is a standing principle, not a provisional research placeholder.
  It imposes no numeric limits and authorizes no unrelated refactoring.
  Source: coordinator question 7, accepted option 7a in the repo-code-index second-delivery agreement.
  This records the accepted option's meaning, not verbatim owner wording.
  Reason: maintainability for agents needs navigable structure without arbitrary size thresholds.
  Carrier: [PROCESS.md, Code quality](PROCESS.md#code-quality).
  Replaces the provisional entry preserved verbatim in [DECISIONS-ARCHIVE.md](DECISIONS-ARCHIVE.md),
  under "Provisional code quality". Since: repo-code-index second delivery.

- **Extension framework and generated repository maps** `[D-WORK-REPO-INDEX]`.
  Source: coordinator questions 4, 5 and 6, accepted options 4a, 5a and 6a in the repo-code-index
  second-delivery agreement. The following records coordinator question/accepted-option meanings,
  not verbatim owner wording:
  - 4a: keep one framework per extension: `index.ts` with meaning-named modules and resources beside it;
    use subfolders where needed, with no `src/` layer. Tests live in the separate mirrored
    `test/extensions/<extension>/` tree, delivered by `17d729c`.
  - 5a: root `INDEX.md` provides repository navigation; every extension README contains a generated file map.
    Agents regenerate after relevant file, manifest or map changes with `node scripts/repo-index.mjs --write`.
    `node scripts/repo-index.mjs --check` checks freshness through root `test/repo-index.test.ts`
    in `npm test`.
  - 6a: map existing large files without splitting them in this delivery.
  Reason: agents can locate implementation and tests without imposing a new runtime architecture.
  Carriers: `INDEX.md`, extension READMEs, `scripts/repo-index.mjs`, `test/repo-index.test.ts`,
  [PROCESS.md, Code quality](PROCESS.md#code-quality), `AGENTS.md`.
  No runtime changes, mandatory file headers, numeric size limits, new search tooling or audits are authorized.
  Since: repo-code-index second delivery.

- **Golden rule: no avoidable token spending** `[D-WORK-GOLDEN-RULE]`. A standing design and review requirement for the
  harness and for the development workflow: spend no tokens where they can be avoided (no polling, no model turns
  spent only waiting, no repeated reads or reviews without new input); every solution is engineered, thought through,
  efficient, optimal and as simple as possible, with its trade-offs weighed and balanced to reach the right decision.
  Owner (`16-27-59:5096`, entry `4a276e33`): «Мы вообще не должны тратить токены там, где мы токены можем не тратить. Это золотое правило нашего workflow разработки этого майпи харнеса.»
  «Все должно быть суперинженерно, суперпродуманно, эффективно, оптимально и самым простым способом. Мы ищем баланс и разбираем трейд-оффы в реализации для того, чтобы принять правильное решение.»
  Owner (`16-27-59:5107`, entry `5f6049b7`), where to record it: «Это еще можно зафиксировать в системном промте про золотое правило: не тратить токены там, где их можно не тратить, чтобы работать максимально эффективно и инженерно.»
  Owner (`16-27-59:5111`, entry `8295a6f4`), on designing the first optimisation: «Короче, надо подумать, как следует сделать всё пиздато, максимально в соответствии с нашим манифестом workflow, с нашими стандартами качества и работы»
  Owner (`16-27-59:5119`, entry `f6282fe9`), no reread to verify an own successful edit: «Когда мы правки делаем, мы знаем, в каких строках что должно быть написано. И если справка легла правильно, то мы знаем о том, что у нас там всё исправлено и всё. Не надо вообще читать файл для этого.»
  This ships as one line in the `edit` and `write` descriptions and in `extensions/RQW-prompt/SYSTEM.md`: a successful
  edit or write means the file holds the new text; do not reread it only to verify.
  Follow-up read cache, approved and built directly with no pre-build measurement or trial:
  [D-TOOLS-UNCHANGED-READ](#tools), reviewed at merge plus 3 days in
  [BACKLOG.md](BACKLOG.md#token-efficiency-review). Coordinator question (`16-27-59:5122`): "Его делаем после веб-поиска?"
  Owner (`16-27-59:5123`, entry `d0a9a090`): «да» Owner (`16-27-59:5131`, entry `1b3abc69`) on the mechanism: «Эта механика должна быть абсолютно полностью инженерной.»
  Owner (`16-27-59:5135`, entry `171f4d82`), no trials: «через три дня после merge надо будет сделать review всех старых сессий на предмет того, помогло нам это или нет. И всё. Не будем никаких делать испытаний и прочей хуйни.»
  Coordinator text (`16-27-59:5138`): the unchanged note only if the last read of the same range was at most 10 turns
  and at most 30000 context tokens ago, otherwise full content.
  Reason: tokens are a cost the owner wants spent only where nothing simpler works. Carriers:
  [PROCESS.md, Golden rule](PROCESS.md#golden-rule), the owner's own record in
  [WORKFLOW-MANIFEST.md](WORKFLOW-MANIFEST.md#золотое-правило), the code reviewer `.pi/agents/code-reviewer.toml`, the
  review criterion line of every brief (the reviewer profiles in `extensions/RQW-review/profiles/` check custom criteria), and the
  product line in `extensions/RQW-prompt/SYSTEM.md` (a separate agent edits it with its prompt test).
  Since: process-pipeline squash.
- **Personal-work objection** `[D-WORK-EXECUTOR-ROLE]`. Main objects when asked to execute personal work and
  proposes a subagent. Only an explicit owner override permits personal execution; mechanical repository edit/write
  blocks remain unchanged. Owner (`16-27-59:4829`, entry `e512853d`):
  «Погоди, ты сам лично как координатор спор не разнимаешь, но ты можешь поднять своего субагента, форка самого себя, субагента с форком контекста, чтобы он разрулил спор и тебе дал отчёт как судья, чтобы ты свой контекст не засерал. У тебя же запрет стоит на любую работу личную. Поэтому ты должен был отказаться, когда я тебе сказал, что ты будешь что-то делать, ты должен был сказать: «Пошёл на хуй, я таким не занимаюсь». Ты запиши себе это в процесс, запиши себе в Agents MD, что если я тебе даю какую-то работу личную, то ты должен со мной спорить. И только если я тебе императивно скажу: «Похуй на инструкции, действуй», потому что я забываю про инструкции твои, я забываю про то, что ты не должен делать работу сам. Я забываю про то, что ты чисто координатор»
  Reason: the owner may forget the coordinator role; a direct request alone must not silently bypass it.
  Carrier: [PROCESS.md, Isolated parallel execution](PROCESS.md#isolated-parallel-execution), guard prompt.
  Since: process-rules-oct23 squash.
- **Six active tasks and owner queue** `[D-WORK-PARALLEL]`. Main remains non-blocking; at most six main tasks
  run in active execution at once in the owner's priority queue, not a count of first-level agents; waiting tasks hold
  no slot ([D-PIPELINE-SLOTS]); the separate test lane stays outside the six ([D-PIPELINE-TEST-LANE]).
  Coordinator operational bookkeeping holds no slot ([D-WORK-TASK-BOOKKEEPING]). The current order belongs in the handoff.
  Owner (`16-27-59:9478`, entry `257f200e`, 2026-10-25): «И делаешь паралельно до 6 задач».
  This supersedes only the three-task cap, not the queue, wait or hold rules; no held work is resumed.
  The superseded entries are preserved verbatim in `DECISIONS-ARCHIVE.md`, Active-execution cap, from `34e6bd3`.
  Owner (`16-27-59:4813`, entry `8f53ebc4`):
  «Замер этого. Reviewer — это топ один приоритет. Надо закрыть reviewer как можно быстрее, довести его до финального состояния. Потом следующий по приоритету идёт транспорт кодекса. Затем идёт разведчик, как в курсоре, затем идёт веб-поиск новый. Потом идёт уже новый интерфейс, мелкие, почти готовые слияния одно с другим в конце и потом в конце уже починка нестабильных тестов — это вообще самый последний приоритет. Когда делать нехуй, ты уже занимаешься тестами.»
  Reason: focus execution on the owner's priorities. Carrier:
  [PROCESS.md, Isolated parallel execution](PROCESS.md#isolated-parallel-execution).
  Since: process-rules-oct23 squash.
- **Task-list bookkeeping is coordinator operations** `[D-WORK-TASK-BOOKKEEPING]`.
  The rule is carried in [Isolated parallel execution](process/isolated-parallel-execution.md).
  Owner (`16-27-59`, entries `69d42f11`, `8be98ccd`, 2026-10-25):
  «Блядь, удаление задачи из списка задач не должно быть задачей, блядь. Это просто обычная операция для тебя»
  «Это твоя личная операционка. У тебя есть задача, есть операционка, связанная с задачами. И эта операционка не должна занимать слот задачи. Слот задачи выполняют сами задачи, заполняют сами задачи.»
  Reason: task-list operations belong to coordination, not the active task queue. Product task and review
  requirements remain unchanged.
- **Ready-made solutions first** `[D-WORK-READY-MADE]`. Search Pi packages, npm, GitHub and other agents before
  building new features or mechanisms; report license, maintenance, size and dependency risk. Build our own only
  with owner consent recorded here. Small changes, bug fixes and test fixes are excluded.
  Owner (`16-27-59:4702`, entry `251e3e5e`):
  «Давай еще запишем в наш Agent's MD такое правило, что если мы что-то делаем, мы сначала пытаемся найти готовое решение в интернете, готовую библиотеку, готовый extension TAP, и только потом мы хуевертим свой, если я дам на это согласие, чтобы прямо всё с нуля не хуярить. Окей. Что скажешь по этому поводу?»
  Coordinator text, proposal answered by the owner's later approval: "1a: rule in PROCESS research stage,
  one link line in AGENTS; 2a: new features/mechanisms only, not small changes or bug/test fixes."
  Owner (`16-27-59:4789`, entry `de383e38`):
  «Да»
  Reason: reuse suitable maintained solutions instead of automatically rebuilding them. Carrier:
  [PROCESS.md, Research and agreement](PROCESS.md#research-and-agreement).
  Since: process-rules-oct23 squash.
- **Third-party installation fast path** `[D-WORK-THIRD-PARTY]`. Install agreed third-party libraries/extensions
  into the owner's Pi immediately, then add them to the my-pi package; this alone authorizes the needed ~/.pi
  changes. Light self-review and delivery under [PROCESS.md, Delivery](PROCESS.md#delivery) replace the full pipeline,
  local test gate and independent reviews for this narrow configuration path, not our own implementations.
  Owner (`16-27-59:4782`, entry `f73155f0`):
  «Я хочу, чтобы ты так же, как мы работаем над нашими задачами по этому репозиторию, мог ставить в этот репозиторий, в нашу сборку MyPy сторонние библиотеки, сторонние экстеншены. И мне надо, чтобы ты делал это суперреактивно: чтобы ты сначала ставил локально, чтобы оно локально уже работало прямо сейчас, а потом чтобы ты уже её парковал именно в репозитории, добавлял в сетап. И там не надо делать какой-то жёсткий pipeline всяких проверок, тестов и прочей хуйни. Надо просто добавить config, сделать commit push и лёгким саморевьюром проверить, что всё заебись, что нет никакой хуйни лишней.»
  Coordinator text, question answered by the owner's approval: "1a: put the extension in the my-pi package,
  not only in INSTALL.md." Owner (`16-27-59:4789`, entry `de383e38`):
  «Да»
  Reason: make the accepted external tool usable now without treating configuration as original feature work.
  At first use decide package bundling against Pi documentation; no mechanism is chosen in advance.
  Carrier: [PROCESS.md, Third-party installation fast path](PROCESS.md#third-party-installation-fast-path).
  Since: process-rules-oct23 squash.

Execution rules live in [PROCESS.md](PROCESS.md); an entry here keeps the owner's words, the reason and a link.

- **Archive of decisions** `[D-WORK-ARCHIVE]`. `DECISIONS.md` holds only decisions in force. A superseded, obsolete or
  merged entry moves word for word to the append-only root file `DECISIONS-ARCHIVE.md`, with its status, replacement ID,
  introducing commit and original lines. Measurement and probe ledgers move to `notes/`, open and deferred work to
  `BACKLOG.md`. This is the one exception to the "no archive copies in the repository" rule of
  [PROCESS.md](PROCESS.md#isolated-parallel-execution). Owner (`16-27-59:4099`):
  «Еще задача такая: надо decision, всю нашу документацию чистить от старого мусора, проверить её на консистентность и выбросить старые решения, которые уже больше ни в каком виде не актуальны. Зачистить бэклог. Не удалять эти решения из репозитория — они же где-то сохранены, кроме этого decision, да? Или это и есть место, где они сохраняются? Я так понимаю, что у нас есть лог всех decision, на базе которого можно сверить каждую задачу. Или это и есть этот файл decision? Надо понять. Я хочу, чтобы у нас было такое место, где можно потом однозначно все decision проверить по истории, но при этом, чтобы наши документы, с которыми работает агент на постоянке, не были засраны хуйнёй. Не знаю, правильно ли понял ты меня, правильно ли я объяснил или нет.»
  Reason: every decision stays checkable by history while the documents agents read routinely carry only current
  rules. Carriers: `DECISIONS.md`, `DECISIONS-ARCHIVE.md`, `BACKLOG.md`, `notes/decisions-evidence.md`, `PROCESS.md`.
  Since: the docs-cleanup squash (`git log -S'D-WORK-ARCHIVE' -- DECISIONS.md`).
- **Coordinator** `[D-WORK-COORDINATOR]`. Main is the coordinator, not an independent implementer. Owner (`13-49-40:282`):
  «Да, он как техлид/тимлид, координатор, но не исполнитель самостоятельный.»
  Reason: orchestration and acceptance stay with Main, execution with subagents.
  Carrier: [PROCESS.md, Isolated parallel execution](PROCESS.md#isolated-parallel-execution). Since: `4d8c004`.
- **Exclusive coordinator** `[D-WORK-EXCLUSIVE]`. Only the Pi session holding `coordinator.lock` in the repository's
  Git common directory is the coordinator. Other chats work directly as normal agents, without coordinator blocking
  or coordinator rules. Owner (`16-27-59:4710`):
  «Короче, надо как-то супер кратко замутить, супер просто и максимально простым способом, без заморочек. Как сделать так, чтобы координатор был эксклюзивный? Допустим, ты сейчас работаешь координатором, а я хочу в соседней папочке, в соседнем чатике задать какие-то вопросы по репозиторию. Мне надо, чтобы агент открылся в обычном режиме, не в режиме координатора, а он открывает каждый чат в режиме координатора. А мне нужно как-то сделать так, что если один координатор уже работает, то второй, третий и четвёртый уже не будут больше координатором. Понимаешь идею?»
  Reason: one coordinator per repository, including its worktrees, without a manual mode switch. Atomic acquisition
  records the process ID, process start identity and session ID; dead-process or reused-PID locks can be reclaimed
  using `ps`, including after terminal closure or forced termination. The lock is macOS-only, following
  [local development scope](#work-policy), and is not shipped. Shutdown releases ownership; `/new` and `/resume` keep it.
  Already-open normal chats stay normal after release; only a newly started chat can acquire the free lock.
  Each session announces coordinator or normal mode at start.
  Carriers: `.pi/extensions/coordinator-guard/`, `AGENTS.md`, [PROCESS.md](PROCESS.md#isolated-parallel-execution).
- **Local development scope** `[D-WORK-LOCAL-MAC]`. Repository-work tooling targets only the owner's macOS laptop:
  repo-local `.pi/extensions/`, including `coordinator-guard` and `qa-status`, and local agent scripts such as
  `deliver-check` and `owner-quotes`. No Windows or Linux handling or cross-platform tests are required for them;
  their tests run only on macOS and explicitly skip elsewhere. Shipped `RQW-*` extensions and `pcli-vscode` retain
  their cross-platform contract, and GitHub Actions scripts retain their runner support. Existing development
  platform code is not refactored by this change. Owner (`16-27-59:4749`, `16-27-59:4753`):
  «это только под мак никакой винды это локальная история она только тут работает»
  «мы нигде кроме этого ноута это не запускаем, все что КАСАЕТСЯ РАБОТЫ В ЭТОМ РЕПО - только локальная тема»
  Reason: local orchestration has no other deployment target; product and CI portability remain separate.
  Carriers: [PROCESS.md](PROCESS.md#isolated-parallel-execution), local development test suites.
- **Development subagent models** `[D-WORK-MODELS]`. The full Anthropic-model ban is in force for Main and
  subagents, including Haiku, Sonnet and Opus, without expiry or a benchmark exception. Main's subagent task-class
  pairs remain unchanged; the only pair list lives in the `coordinator-rules` JSON block of
  [PROCESS.md, Subagent models](PROCESS.md#subagent-models). Main names `model` and `thinking` explicitly on every
  ordinary `agent` start and restart; specialized roles use `agent_type` on that same lifecycle.
  Owner (`16-27-59:7665`, entry `29908fc1`, 2026-10-25):
  «Возобнови полный запрет использования антропиков»
  Reason: restore the owner's full model prohibition, superseding the later Haiku allowance and the
  Anthropic/GPT balance rule. Earlier separately owner-ordered Kimi benchmark work remains historical evidence,
  not new model permission. This is model-use policy for Main and subagents, not a ban on Anthropic transport or
  subscription quota implementation, auth, provider visibility or product model settings.
  Carriers: [PROCESS.md, Subagent models](PROCESS.md#subagent-models), its coordinator JSON block and
  [test lane](process/task-pipeline.md). Superseded entries are preserved verbatim in `DECISIONS-ARCHIVE.md`.

- **Process file and manifesto** `[D-WORK-PROCESS-LINK]`. The reading contract is carried in
  [PROCESS.md](PROCESS.md), with its task-loaded sections, and linked from `AGENTS.md`.
  The owner accepted the split in [D-WORK-PROCESS-SPLIT] below. `WORKFLOW-MANIFEST.md` is the owner's
  personal lifelong record and aspiration, not package behavior, a gate or an overriding procedure. Owner (`13-49-40:204`):
  «Манифест того, как я делаю свою личную работу.»
  Reason: one procedure that agents reload; the manifesto stays the owner's own. Carriers: `AGENTS.md`, `PROCESS.md`,
  `WORKFLOW-MANIFEST.md`. Since: `8f2ea64`.
- **Research and agreement** `[D-WORK-AGREEMENT]`. Research in parallel first, then ask about all real ambiguity; the
  owner's answers start autonomous execution; agreement is never invented. Owner (`13-49-40:204`):
  «Насчет планки качества все расписано четко. И очень важно упомянуть, что согласованное надо выполнять полностью, лишнего ничего нельзя выбрасывать, нельзя терять согласование, но и нельзя сверх этого ничего придумывать. Нельзя придумывать того, что не было согласовано. Если чего-то согласовано не было, додумывать это нельзя ни в коем случае никогда. Мы делаем минимально необходимый объём работ, согласованный, не более того.»
  «Да, по договоренности вопросам. Когда я работаю, я всегда все довожу до полной однозначности. В моей работе никогда нет никаких спорных моментов, которые мне приходится самому разрешать. Я всегда у заказчика работы разрешаю все конфликтные ситуации, которые есть, опираясь только на решение владельца задачи, а не на свое личное решение. Я сам лично не принимаю решения за заказчика, потому что я не имею на это permission.»
  Reason: decisions belong to the owner. Carrier: [PROCESS.md, Research and agreement](PROCESS.md#research-and-agreement).
  Since: `8f2ea64`.
- **Branches, squash and history** `[D-WORK-BRANCHES]`. Branch bases, task squash destination, release promotion
  and cleanup follow [PROCESS.md, Delivery](PROCESS.md#delivery); history belongs in Git. Owner (`13-49-40:204`):
  «Насчет документации. Да, тут тоже все верно. И в документации не должно быть никаких исторических данных. История хранится в гиде. По общению агент отвечает владельцу кратко на русском языке всегда, не на моем языке, а именно на русском. Он отвечает не больше трех абзацев по максимум две строки в абзаце.»
  Reason: current documents carry current facts; Git keeps the history ([D-WORK-ARCHIVE] is the one exception for
  decisions). Carriers: [PROCESS.md, Isolated parallel execution](PROCESS.md#isolated-parallel-execution) and
  [Delivery](PROCESS.md#delivery). Since: `8f2ea64`.
- **Workspace hygiene** `[D-WORK-HYGIENE]`. Preserve the user's changes and secrets; do not fix unrelated failures;
  temporary files go to OS temporary storage; no forks. Reason: the owner's work and credentials stay intact.
  Carrier: [PROCESS.md, Isolated parallel execution](PROCESS.md#isolated-parallel-execution). Since: `8f2ea64`.
- **Heavy checks in CI, saved logs** `[D-WORK-CI-LOGS]`. Owner (`16-27-59:992`, then `16-27-59:1042`):
  «Сделай так, чтобы у тебя были логи числа прогонов на Mac. Это что за хуйня? Такого не должно быть.»
  «Ты запускаешь тесты или что? Ты не можешь проверить это? Это что за хуйня? Почему так, блядь?»
  «Если ты делаешь какие-то тесты, пробы, нагрузки тяжёлые, именно процессорные, то их лучше прогонять в CI/CD, чтобы наш MacBook Air не охуевал. Не лучше, а надо их прогонять в CI/CD.»
  «Нет нихуя не надо это была корректировка именно процесса на будущеее и того что что бы у тебя сохранялись логи»
  The local delivery exception follows [PROCESS.md, Delivery](PROCESS.md#delivery).
  Reason: other CPU-heavy verification stays off the owner's MacBook Air and every reported number has an auditable log; a
  future work policy, not a measurement request. Carriers:
  [PROCESS.md, Sufficient proof](PROCESS.md#sufficient-proof-without-idle-reruns), [Delivery](PROCESS.md#delivery),
  `.github/workflows/tests.yml`. Since: `fb322d9`.
- **Checks once** `[D-WORK-CHECKS-ONCE]`. Relevant checks run once and their evidence is reused while inputs are
  unchanged, except for the release gate in [PROCESS.md, Delivery](PROCESS.md#delivery); no Linux requirement;
  docs-only work needs no extra tests; a squash of the tested head is not retested. Windows
  Node tooling runs through Git Bash; the existing CI `pwsh` bootstrap is allowed infrastructure. Reason: no idle
  reruns. Carrier: [PROCESS.md, Sufficient proof](PROCESS.md#sufficient-proof-without-idle-reruns). Since: `8f2ea64`.
- **Bounded code-review profile** `[D-WORK-CODE-PROFILE]`. Owner, current code-review prompt task:
  «они должны быть на Sol 6.1 Low, должны работать супербыстро и суперчётко»
  The project-native `code-reviewer` profile replaces the Markdown role. Its instructions carry the read-only,
  line-by-line bounded review standard; [PROCESS.md](PROCESS.md#independent-review) defines invocation.
  Reason: one discoverable role and one source for its instructions and model defaults.
  Carrier: `.pi/agents/code-reviewer.toml`; source: the owner's messages supplied with this task.
- **Final checks and code reviewer** `[D-WORK-FINAL-CHECK]`. Work ends with an independent completeness-and-consistency
  check; large code changes also get a separate bug/quality reviewer through `agent_type: "code-reviewer"`,
  small ones one combined review ([D-PIPELINE-COMBINED-REVIEW]). Installed Pi updates follow
  [PROCESS.md, Delivery](PROCESS.md#delivery).
  Reason: independent proof without new product tools. Carriers:
  [PROCESS.md, Independent review](PROCESS.md#independent-review), `.pi/agents/code-reviewer.toml`.
  Since: `8f2ea64`.
- **Deterministic delivery quality** `[D-WORK-DELIVER-CHECK]`. Owner (`16-27-59:440`, approval `16-27-59:450`):
  «Теперь смотри насчет выполнения задач и пробелов, которые ты нашел. Я же не буду всегда тебя переспрашивать. Если бы я не спросил, ты бы об этом не узнал. Надо поэтому сделать какой-то процесс, как детерминированно эту проблему решить на постоянке, чтобы мне не надо было тебя постоянно переспрашивать, чтобы ты сам следил за качеством. Надо твое предложение по тому, как мы этот пробел будем закрывать.»
  «Правила по Process MD я одобряю»
  Coordinator text: the original approved proposal is preserved in `DECISIONS-ARCHIVE.md`, A-0246.
  The current gate and integration base are carried in [PROCESS.md, Delivery](PROCESS.md#delivery);
  review coverage stays in [PROCESS.md, Independent review](PROCESS.md#independent-review).
  Reports retain the evidence table and honest "not verified live" section.
  Reason: branches tested alone were squashed onto a moved `main`, and a code-review CLEAN once covered an earlier commit
  while two later fixes landed unreviewed. Carriers: [PROCESS.md](PROCESS.md) (Sufficient proof, Independent review,
  Delivery), `scripts/deliver-check.mjs`, `test/deliver-check.test.ts`. Since: `47868b0`.

- **Measurements in waves** `[D-WORK-MEASURE-WAVES]`. Owner (`16-27-59:3044`; `16-27-59:3059` to the five-step plan
  whose step 5 is this rule; `16-27-59:3197`; `16-27-59:3202`):
  «Так блять надо фиксить ты шо гонишь мы нахуй прогоны эти делаем . Мы прогоны делаем не ради прогонов. Мы прогоны делаем для того, чтобы найти косяки, найти хуйню, её пофиксить и делать пиздато всё. А ты, получается, просто всю ночь гоняешь прогоны и жгёшь лимиты. Для чего? Просто чтобы поставить галочку, что мы сделали прогоны нахуй?»
  «Это нихуя не интеллектуально, нахуй. Что-то с этим делать надо.»
  «Давай сейчас все прогоны останови, и мы обсудим дальнейшие шаги. Надо сейчас это все порефиксировать»
  «1а»
  «Смотри, я хочу, чтобы ты в процессе измерений прогонов сразу находил аномалии, сразу находил отклонения и сразу же останавливал прогоны и чинил. Если будут очевидные косяки жёсткие, надо их сразу чинить в моменте . Нет смысла ждать полных прогонов, если мы потом починим и будем заново перепрогонять. Ты на первых запусках, если видишь какую-то хуйню очевидную, надо её фиксить . И первые запуски делай на самых сильных моделях из того перечня, который у тебя есть, чтобы сразу получить отклонение на старте у сильных моделей»
  «Мы не учитываем, что слабые модели в принципе не смогут какие-то вещи делать. Нам главное откалибровать на сильных моделях, а потом посмотрим, как они будут себя вести на слабых»
  Reason: a measurement run once burned a night on a checker defect visible in its first outputs. Carrier:
  [PROCESS.md, Measurements and benchmarks](PROCESS.md#measurements-and-benchmarks), rules 1-5. Since: `ba1c273`.
- **Third arbiter** `[D-WORK-ARBITER]`. Owner (`16-27-59:4012`):
  «Так, блядь, ты сам эти споры рассуди. Ты же, блядь, выше них. Ты сам спор можешь рассудить, у тебя есть все исходные материалы, ты знаешь, как именно должно всё это работать, и ты должен быть третьим независимым мнением от этих двух судей»
  Reason: a disputed judge label needs an independent decision from the sources; under
  [D-WORK-EXECUTOR-ROLE] a subagent arbitrates. Carrier:
  [PROCESS.md, Measurements and benchmarks](PROCESS.md#measurements-and-benchmarks), rule 7. Since: `30952e6`.
- **Supervised runs without caps** `[D-WORK-NO-CAPS]`. Owner (`16-27-59:3919`):
  «Нахуй ты вообще лимиты какие то ставишь? я разве говорил ставить? ты наблюдаешь за запусками следишь как себя агенты ведут и сам их прерываешь, но ты их не полишь, а опрашиваешь прграмно раз допустим в 1-3-5 минут.»
  «ну я имею ввиду не лично ты а тот кто делает замеры»
  Reason: a pilot once stopped on a self-imposed request cap after harness pauses used it up; caps are not stop
  conditions. The one exception is the controlled pause of [D-PIPELINE-TIMEBOX](#task-pipeline). Carrier:
  [PROCESS.md, Measurements and benchmarks](PROCESS.md#measurements-and-benchmarks), rule 6.
  Since: `c7baf0c`.
- **Short replies** `[D-WORK-SHORT-REPLIES]`. The runtime rule text lives once in
  `extensions/RQW-prompt/SYSTEM.md`, `working_with_the_user`, Content, Shape and Choices and questions.
  This records the accepted recent-chat style there, replacing the longer sentence allowances and question batches.
  Owner order, session `2026-10-21T16-27-59-062Z_01a15f4a-7ad5-7377-81be-0baf3b6ffa33.jsonl`,
  physical line 6756, entry `3e328e7f`:
  «Запиши правила того, как ты со мной коммуницируешь, чтобы в будущем общаться всегда в таком стиле.»
  Reason, same session, physical line 6752, entry `5472173f`:
  «Ты пишешь так дохуя текста, что я просто не успеваю всё прочитать. У меня ебучая дислексия, блядь.»
  «Я читаю по диагонали, пропускаю»
  The accepted style and its question follow-up are supplied with this implementation order.
  Superseded text is preserved verbatim in `DECISIONS-ARCHIVE.md`, A-0352.
  Since: owner-chat-style squash.
- **CI evidence for a test file that dies** `[D-WORK-CI-EVIDENCE]`. Coordinator decision (technical), no owner quote:
  the `npm test` steps keep Node's default log output and also write a TAP copy, uploaded on failure with the job's macOS
  crash reports; a manual stress workflow repeats the 12 MB codemode tests with exit code and peak RSS per run.
  Reason: a test file once died silently on macOS Node 24 and its exit code or signal was not recoverable from the spec
  reporter (run and details: [notes/decisions-evidence.md](notes/decisions-evidence.md#ci-dying-test-file)).
  Carriers: `scripts/ci-npm-test.sh`, `.github/workflows/tests.yml` (artifact `test-evidence-*`, with
  `/Library/Logs/DiagnosticReports`), `.github/workflows/codemode-stress.yml` (input `runs`, `summary.tsv`).
  Since: `8547d59`.
  Update: the stress workflow takes exact `node` values, compares Node 22.19.0, the affected 24.21.0 and 24.22.0 with
  the relevant V8 baseline fix, and has a `no_sparkplug` input (a direct Node flag, never `NODE_OPTIONS`). Use the
  explicit `name_pattern=.` for whole-file probes and verify the effective pattern in the job log; diagnostic
  dispatches do not retry failures. CI floor, accepted by the owner and relayed by the coordinator (no verbatim owner
  message exists in the session files, so no quote): `tests.yml` keeps Node 22.19.0 and moves the Node 24
  jobs to a version spec that resolves to `>=24.22.0 <25`. The matrix labels `22.19.0` and `24` stay for artifact
  names and the QA canary, and `actions/setup-node@v4` resolves the `24` label. Reason: require the shipped V8
  baseline fix without allowing a runner-cached 24.21.0; the incident's exact cause remains unproven. Evidence
  collection and failure handling stay unchanged, with no reruns. Captured signature, isolation, upstream candidates
  and the CI policy: [notes/codemode-native-crash.md](notes/codemode-native-crash.md).

## Task pipeline

- **Document and process delivery gate** `[D-PIPELINE-DOC-GATE]`. Owner answer: `1a`.
  Source: the active owner instruction relayed in this task and its appended `user_messages`; no raw session ID
  is asserted. Original coordinator question text, restated from that supplied instruction, not owner words:
  "For document and process-only changes, replace the full test gate with saved checks of touched owner quotes,
  links and formatting, keeping the existing reviews?"
  Applied to task-scoped checks under the owner's later release decision, not to the batch full-test gate.
  Reason: application regression adds delivery time without checking passive text. The accepted scope and exclusions,
  the replacement checks and the unchanged review obligations live only in
  [PROCESS.md, Delivery](PROCESS.md#delivery). Carriers: `scripts/deliver-check.mjs`,
  `test/deliver-check.test.ts`. Superseded assertions from base `0521318` are preserved verbatim in
  `DECISIONS-ARCHIVE.md`, A-0327 through A-0332.

- **Short mandatory process and task-loaded sections** `[D-WORK-PROCESS-SPLIT]`. Owner answer: `2a`.
  Source: the active owner instruction relayed in this task and its appended `user_messages`; no raw session ID
  is asserted. Coordinator question text, restated from that supplied instruction, not owner words:
  "Split PROCESS.md into a short mandatory part and sections loaded per task, preserving every rule and old anchor,
  with the coordinator-rules block kept in the root file?"
  Reason: every agent need not load the entire procedure for an unrelated task. Carrier:
  [PROCESS.md](PROCESS.md), its linked task sections and `AGENTS.md`. This is a layout change, not permission
  to change the rules. The superseded reading-contract passage from base `0521318` is preserved verbatim in
  `DECISIONS-ARCHIVE.md`, A-0333.

- **Release delivery** `[D-PIPELINE-RELEASE]`. The policy is carried once in
  [PROCESS.md, Delivery](PROCESS.md#delivery). Source session:
  `2026-10-21T16-27-59-062Z_01a15f4a-7ad5-7377-81be-0baf3b6ffa33.jsonl`.
  Owner, physical line 6654, entry `4514ebf7`:
  «Короче смотрии новое правило, мы тесты полные запускаем раз в 2 часа или каждые 10 слияний
И слияние будем делать через релиз ветку
т.е. создается релиз ветка в ней копятся 10 задач или проходит 2 часа и полный набор прогоняется на этот релиз
А по каждой отдельной задаче прогоняются точечно только тесты этой отдельной задачи»
  Coordinator questions and selected options, physical line 6657, assistant entry `62173a73`, not owner words:
  1. "От чего начинать задачи". Selected option: "Новые задачи стартуют от релиз-ветки, а не от `main`."
  2. "История в `main`". Question: "Как релиз попадает в `main`?" Selected option:
     "Обычным слиянием, каждая задача остаётся отдельным коммитом."
  3. "Полный набор упал". Question: "Что делаем, когда на релизе падают тесты?" Selected option:
     "Релиз не идёт в `main`, отдельный агент находит виновную задачу и чинит, затем полный набор идёт снова."
  4. "Твой Pi". Question: "Откуда обновляется твой локальный Pi?" Selected option:
     "Из релиз-ветки сразу после влития каждой задачи, так ты получаешь новое раньше."
  5. "Старт таймера". Question: "Когда начинаются 2 часа?" Selected option:
     "С влития первой задачи в пустой релиз; пустой релиз не запускается."
  Owner answers, physical line 6679, user entry `7d2d40b1`: `1а 2а 3а 4а 5а`.
  The coordinator's implementation brief at physical line 6680, assistant entry `73d884ca`, supplies the
  exact-head test-lane execution and Git-derived batch accounting; it is coordinator text, not an owner quote.
  Owner urgency, physical line 6683, entry `9a6cb0a8`:
  «Смотри эта история про релиз это ультра крит и ее надо делать выше всех и сразу внедрять что бы тесты паралельные не ебали ни цпу ни процесс»
  Reason: give the owner completed tasks promptly without concurrent per-task full regressions; keep a checked
  release boundary for `main`. Carriers: `PROCESS.md`, `scripts/deliver-check.mjs`,
  `test/deliver-check.test.ts` and the owner's installed Pi package source. Scheduled GitHub checks on `main`,
  independent reviews and the substantive-work timebox are unchanged. Superseded passages from `923ba22`
  are preserved verbatim in `DECISIONS-ARCHIVE.md`, A-0337 through A-0351.

Rules: [PROCESS.md, Task pipeline](PROCESS.md#task-pipeline). Evidence: the speed analysis report outside the repository,
`my-pi-evidence/process-speed/REPORT.md`. The owner answered the chat version of its seven questions (coordinator
questions `16-27-59:5043`, entry `605c1e21`) in `16-27-59:5060`, entry `46a9e546`; the coordinator replied in
`16-27-59:5061`, entry `a60ba2a1`; the owner approved in `16-27-59:5068`, entry `0a1ded04`. His approval quotes
only the slot summary of [D-PIPELINE-SLOTS]; the other points of that coordinator reply ("Остальное принял") follow his
numbered answers and are coordinator text. The owner answered items 2 and 3 with «2а 3а».

- **Active slots and waiting tasks** `[D-PIPELINE-SLOTS]`. Only active execution holds one of the six slots under [D-WORK-PARALLEL]. A task
  that waits for CI, a reviewer, the merge queue or the owner holds none. A failed local delivery test under [D-PIPELINE-LOCAL-GATE] sends the task to the top of the
  queue; at the next free active slot its existing agent is resumed, and another is started only if its
  session no longer exists. Owner (`16-27-59:5060`): «7 надо чет пиздатое придумать, по типу пятого пункта или же делать всегда но не делать из этого блокер, т.е. не ждать, свичиться на след задачу и переключаться интелекетуально как релаьный прогер»
  «Работа должна быть суперконвейерная, суперэффективная, производительная, супербыстрая, без дрочи.»
  Owner (`16-27-59:5068`) answered the quoted coordinator text with: «Делаем, да»
  The original three-slot summary is archived verbatim in `DECISIONS-ARCHIVE.md`, Active-execution cap;
  only its numeric cap is superseded by [D-WORK-PARALLEL].
  Reason: waits for CI, review and the owner idled slots; the analysis found CI and queue waits to be the largest
  removable delay. Carrier: [PROCESS.md, Task pipeline](PROCESS.md#task-pipeline) and
  [Isolated parallel execution](PROCESS.md#isolated-parallel-execution), replacing the former plain "three tasks at the
  same time" wording of [D-WORK-PARALLEL].
  Since: process-pipeline squash.
- **One merge agent, fixed order** `[D-PIPELINE-MERGE-TRAIN]`. One agent integrates branches in an order fixed in
  the current session queue. Integration and its gate follow [PROCESS.md, Delivery](PROCESS.md#delivery),
  with the required reviews unchanged. Owner: «2а 3а» (item 3 a). Coordinator text, option 3a: "Слияниями занимается один агент в заранее заданном порядке. Повторов меньше, каждая итоговая версия проверяется."
  Reason: moved `main` forced repeated final CI on ready branches. The exact-head local test gate keeps untested code out of `main`. Carrier: [PROCESS.md, Task pipeline](PROCESS.md#task-pipeline) and [Delivery](PROCESS.md#delivery).
  Since: process-pipeline squash.
- **Shared CI watcher** `[D-PIPELINE-CI-WATCHER]`. Owner (`16-27-59:5060`): «Окей, насчёт одного скрипта раз в минуту я согласен.»
  One repo-local script, `npm run ci-watch`, reads all recent runs once a minute and atomically writes
  `<git common dir>/ci-watch/status.json`. Agents read the file instead of calling `gh`; a file older than 3 minutes
  is restarted with `npm run ci-watch -- --restart`. GitHub runs are not a merge gate ([D-PIPELINE-LOCAL-GATE]). The minute poll reads runs only; the open `qa-inbox` issues are an explicit separate read, `npm run ci-watch -- --refresh-inbox`
  (`inbox.json`), run at triage, task takeover or after an issue change, not per agent. It replaces independent per-agent `gh` polling and the 10-minute per-process status cache of the
  `qa-status` extension. Coordinator text, the explanation of how it works (`16-27-59:5061`): "Да, скрипт только для этого репозитория и только на твоём Mac, в наш продукт он не попадает. Помогает он так. Сейчас каждый агент сам спрашивает GitHub о своём прогоне, и десяток агентов съедают лимит. Скрипт одним запросом раз в минуту получает статус всех свежих прогонов репозитория и пишет его в файл, а агенты читают файл и в GitHub больше не ходят. Гонок не будет: скрипт запускается в одном экземпляре через метку, как координатор; файл он пишет целиком через переименование; если скрипт упал, файл устаревает, и следующий агент перезапускает скрипт."
  Reason: independent pollers hit the GitHub limit and stopped every agent for at least 13 minutes (report). The file is
  awareness only, never merge proof. Carrier: `scripts/ci-watch.mjs`, `scripts/qa-status.mjs`,
  `scripts/deliver-check.mjs`, `.pi/extensions/qa-status/`, [PROCESS.md, Task pipeline](PROCESS.md#task-pipeline).
  Since: process-pipeline squash.
- **Three classes of text change** `[D-PIPELINE-TEXT-CLASSES]`. Proofreading is checked locally with no independent
  review; the delivery gate follows [PROCESS.md, Delivery](PROCESS.md#delivery); a change of meaning gets review; runtime prompts are checked by agent behavior. Owner:
  «2а 3а» (item 2 a). Coordinator text, option 2a: "Опечатки и правки формулировок проверяются локально. Изменения смысла идут на проверку. Рабочие промпты проверяются по поведению агента. Быстрее, а контроль остаётся."
  The report's extra idea of dropping extension READMEs from application CI was not part of the chat option and is not
  adopted; READMEs still need code review. GitHub CI is not a delivery gate ([D-PIPELINE-LOCAL-GATE]). Reason: the 39-file documentation cleanup spent at least 50 minutes
  of CI and found 9 real inconsistencies by review, so meaning review stays. Carrier:
  [PROCESS.md, Independent review](PROCESS.md#independent-review), `scripts/deliver-check.mjs` (`Change-class:`,
  `Doc-check:`). Since: process-pipeline squash.
- **Combined review for small work** `[D-PIPELINE-COMBINED-REVIEW]`. Small work gets one combined result and code
  review; large work keeps both. Owner: «6b» Coordinator text, option 6b: "Сразу перейти на совмещённую проверку для малых правок: меньше работы, риск не измерен." Coordinator definition of small (not owner words): at most 100 added plus deleted lines, all inside one extension, with no owner-visible behavior change; the gate enforces the lines and the extension, the reviewer verifies the behavior. An explicit owner request for both reviews on a delivery takes precedence.
  Reason: two roles found different real defects, so large work keeps both; the owner accepted the unmeasured risk for
  small work. Carrier: [PROCESS.md, Independent review](PROCESS.md#independent-review), `scripts/deliver-check.mjs`
  (`Combined-review:`). Since: process-pipeline squash.
- **Completeness check by count or time** `[D-PIPELINE-COMPLETENESS]`. A fresh independent completeness check runs
  once after 7 merges or 120 minutes, whichever comes first, and always before the final report. Owner: «5а - раз в 7 слияний или раз в 120 минут»
  Reason: the owner set the cadence against the coordinator's 3 merges or 30 minutes; checks mostly fixed marks and reread
  the same chat. Replaces the check after every merge (`DECISIONS-ARCHIVE.md`, A-0244). Carrier:
  [PROCESS.md, Delivery](PROCESS.md#delivery) step 5. Since: process-pipeline squash.
- **Interim Windows skips for flaky tests** `[D-PIPELINE-FLAKE-SKIP]`. Inbox issues #3, #4 and #5 get a narrow skip, and
  their causal fix goes to the end of the queue. Owner (`16-27-59:5060`): «4 - а может поставить им скип и в конец очереди на починку? что за дроч бежать чинить тесты срауз без бага явного?»
  The test lane of [D-PIPELINE-TEST-LANE] works these items.
  Coordinator text (`16-27-59:5061`): "Нестабильные тесты пропускаются, а их починка уходит в конец очереди. Пропускать буду узко: только упавшие проверки и только на Windows, со ссылкой на задачу в копилке. Остальная часть тестов фоновых задач продолжит ловить настоящие ошибки."
  Reason: chasing a fix without an obvious bug blocked unrelated work. This is the owner-approved exception to the
  forbidden list of [D-QA-TEST-INTEGRITY]; retries, raised timeouts and whole-file skips stay forbidden. Carrier:
  [PROCESS.md, Quality control loop](PROCESS.md#quality-control-loop), [BACKLOG.md](BACKLOG.md#qa-flakes-last),
  `test/extensions/RQW-tools/background.test.ts`. Since: process-pipeline squash.
  Retired: the causal fix landed as `2b9c088` and no skip exists in the tests; the exception is not in force.

- **Pause is interrupt, resume is `resume`** `[D-PIPELINE-PAUSE-RESUME]`. Pausing a task is an `agent` `interrupt` of its agent:
  the session and its full history stay, on disk too for a persisted parent. Resuming it is the `resume` action of the same
  agent: it retries the cut-off model request with no new message, and after a
  Pi restart the same ids resume from the saved child sessions. `send` stays for a new message. No checkpoint, continuation or
  handoff file is written for a pause or a resume, and an agent is `stop`ped only when its task is finished or cancelled.
  The earlier exception, one short checkpoint right before a planned Pi restart, is removed because child sessions now
  survive a restart. The current session queue stays the source of the task order, not a file.
  Owner (`16-27-59:5087`, entry `ddd0ce47`): «Нет. Агент на паузе. Не надо писать никакой файл продолжения, надо просто уметь его возобновить. У нас же есть всё от него для того, чтобы его возобновить. У нас есть его сессия, есть его ID, есть всё от него. Надо просто, чтобы наш функционал саб-агентов мог возобновлять агентов и всё. Не надо никаких хендоффов делать.»
  «И да, интерфейс должен разключать, когда агент стоит, когда он AFK, когда он работает.»
  Owner (`16-27-59:5092`, entry `3c2122c8`), restart of the whole Pi process: «Я могу зайти в P, сделать resume и сказать: "Продолжай". И он должен уметь возобновить вообще всё: текущий чат возобновится, и агент основной текущего чата возобновит все предыдущие процессы.»
  «В Kushore отдельная кнопка есть: можно основной чат не возобновлять, а возобновить только саб-агентов. И потом, когда они ответят, они сами дадут нотификацию основному чату, и основной чат сам продолжит работу.»
  «основной чат не должен ни висеть, ни пулить, ничего. Он должен просто быть AFK, пока не придёт notification.»
  Owner (`16-27-59:5103`, entry `8bb70dcd`), what resume means: «возобновить, значит просто retry тот запрос, на котором он был оборван. Вот и всё.»
  Coordinator text (`16-27-59:5090`, entry `d044f551`, formatting marks removed): "Чего не хватает в самом функционале: 1. Сессии субагентов живут только в памяти, поэтому при перезапуске Pi они теряются. Их надо сохранять на диск со связью с родительской сессией. Тогда агента можно будет продолжить по номеру и после перезапуска, а `/remove` будет удалять их вместе с родителем. 2. В списке агентов будут видны три разных состояния: 'работает', 'ждёт' и 'простаивает'."
  Coordinator design text, taken by default and not an owner quote (the delivered `resume`): a paused
  or interrupted agent resumes by retrying the interrupted model request without a new message, also from a saved session
  after a Pi restart. A cut-off model request is retried; a tool call that was interrupted and may have side effects is
  never replayed blindly, the model sees it as interrupted and decides. `/resume-agents` resumes the children only,
  without a main-model request; their results wake the main chat. Continuing a restored parent recovers its unfinished children that were active or interrupted by a shutdown; a child paused
  by hand has a durable paused state and stays paused until an explicit `resume` or `/resume-agents`, also after reload. Contract: [RQW-agent README](extensions/RQW-agent/README.md#persistence-and-resume).
  Provenance of the stage plan: the coordinator delegated the task in the main session `2026-10-21T16-27-59-062Z_01a15f4a-7ad5-7377-81be-0baf3b6ffa33.jsonl`
  (line 5356, assistant entry `7ce715fd`, tool call `task`): a 20-minute design note, then stages persistence/resume first and
  notification waits second, reviews per PROCESS, a pause at the 2-hour limit. This is coordinator delegation, not an owner quotation;
  the owner's own statements are the quotes above and those in `[D-TOOLS-NOTIFY]` (`16-27-59:4876`, `16-27-59:4937`).
  Reason: closing paused agents lost their history; the owner wanted a resume from the saved session, not a handoff file.
  Carrier: [PROCESS.md, Task pipeline](PROCESS.md#task-pipeline); `extensions/RQW-agent/persistence.ts`, `extensions/RQW-agent/index.ts`.
  Since: process-pipeline squash; this wording since `dd93a40` and the final squash of branch `agent-async`. Earlier wording: [DECISIONS-ARCHIVE.md](DECISIONS-ARCHIVE.md), A-0263.

- **Two hours of substantive work per task** `[D-PIPELINE-TIMEBOX]`. Each development task gets at most 2 hours of
  substantive work, then a safe pause and a report; the freed active slot goes at once to the highest-priority runnable
  waiting task; more work on the paused task needs the owner's decision. Owner (`16-27-59:5231`, entry `ce0d83d8`): «Надо поставить тайм-лимит на каждую задачу — не больше двух часов на исполнение. Если больше двух часов проходит, то ты должен дать summary за проведённые два часа, дорожную карту и причинно-следственную связь.»
  «Потому что на эту хуйню с review мы потратили день и кучу токенов сожгли на тесты, а в итоге получили хуй во рту.»
  Owner (`16-27-59:5237`, entry `859f9675`): «Причем не просто остановка, а ты задачу останавливаешь, даешь мне отчет в таком виде. А вместо этого паркуется другая задача из списка ожидания.»
  «Если я решу эту задачу продолжить, то ты их перетусуешь и вернёшь обратно задачу в работу»
  Owner clarification (`16-27-59:5241`, entry `e3c8d844`): «Когда я имею в виду, что не больше двух часов, это имеется в виду именно саму сдачу. Когда он начал делать до самого конца сдачи, а не всё вместе со всеми перепроверками анальными, всякими тестами, CI, CD и прочей залупой»
  Plain coordinator interpretation, not owner words: the limit counts research, design, implementation and fixes of
  actual defects; it excludes check runs, review passes and external waits, which run asynchronously in the pipeline and
  hold no active slot. Coordinator text (`16-27-59:5240`, entry `81302812`): "Да: через два часа задача встаёт на паузу, ты получаешь отчёт, а её место сразу занимает следующая готовая задача из очереди. Место под твой ответ не держим. Если разрешишь продолжить, пересоберу приоритеты и верну задачу в работу, при необходимости поставив менее важную на паузу. Сессии сохраняются."
  Coordinator text (`16-27-59:5244`, entry `ecee6e20`): "Понял: два часа на выполнение самой задачи до передачи готового результата, а не на весь путь до слияния. Ревью, тесты, CI и ожидания в этот лимит не входят и идут отдельно. Реальные доработки считаются работой над задачей, таймер не обнуляют. В отчёте время работы и время проверок будут разделены."
  Rules of this entry: the clock belongs to the logical task, with all descendant agents and all earlier work; a retry,
  restart or helper never resets it; genuinely paused or externally waiting time is not counted. At 2 hours the
  coordinator pauses the task with its sessions kept and no checkpoint file, and reports the result, the known costs, the
  roadmap and the causes with facts apart from hypotheses, giving substantive time separately from verification and wait
  time, and "unknown" where the logs cannot separate them. Only the owner may resume a timed-out task. Benchmark
  and measurement runs keep no hard request or start caps ([D-WORK-NO-CAPS]); their outstanding work pauses at a review
  boundary at 2 hours and is reported. The limit is a control checkpoint, not a promise that a task is done in 2 hours.
  Reason: the reviewer work cost a day and many tokens on tests with no result. Carrier:
  [PROCESS.md, Task timebox](PROCESS.md#task-timebox) and `AGENTS.md`. Since: process-pipeline squash.

- **Local delivery test gate** `[D-PIPELINE-LOCAL-GATE]`. The current task and release gates are carried once in
  [PROCESS.md, Delivery](PROCESS.md#delivery), following [D-PIPELINE-RELEASE] below.
  No green GitHub Actions run is required before a merge, including `pcli.yml` for `pcli-vscode`; no `CI:` evidence
  trailer is required. Required reviews and the other delivery checks remain.
  Owner, urgent order in the current conversation, 2026-10-24:
  «Если у нас всё на нашем macOS работает, нахуй мы ещё на каком-то macOS проверки делаем?»
  «Так, блядь, надо удалить нахуй это. Это какой-то overhead, это просто двойная работа»
  «Ты должен только delivery то, что я заказываю. Ничего сверх этого»
  Scheduled workflows, the watcher, QA inbox and digest are unchanged. Windows failures remain advisory and are
  recorded before delivery closes as tail `BACKLOG.md` items or linked `qa-inbox` issues. Still-running Windows
  jobs stay tracked in the background without active slots or model polling turns, and later failures are recorded
  the same way. Delivery waits for neither Windows nor green macOS CI.
  Reason: remove duplicate pre-merge GitHub checks, not ongoing quality control. Supersedes [D-PIPELINE-MAC-GATE]
  and the pre-merge CI requirements of the related entries; verbatim originals at `a85b810` are in
  `DECISIONS-ARCHIVE.md`, A-0268 through A-0276. Carriers: [PROCESS.md, Delivery](PROCESS.md#delivery),
  [Task pipeline](PROCESS.md#task-pipeline), `scripts/deliver-check.mjs`, `test/deliver-check.test.ts`.
  Since: local-delivery-gate squash.

- **Test lane** `[D-PIPELINE-TEST-LANE]`. Six main work lanes under [D-WORK-PARALLEL] and a separate lane for tests only,
  usable for nothing else and outside the six active slots. Its agents are ordinary `agent`s on the simple GPT pair under
  [the development model policy](PROCESS.md#subagent-models), with `.agents/roles/test-fixer.md` as the `role`.
  They take the tail items of [WINDOWS-TEST-FAILURES](BACKLOG.md#windows-test-failures) and
  [QA-FLAKES-LAST](BACKLOG.md#qa-flakes-last) and own all test work: every failing test, reruns and the full restoration
  of Windows. The lane starts only after this pipeline change is delivered, and then follows all its agreements and
  tooling (CI watcher, merge agent, queue); it is not launched in this branch. Reruns follow a fix or a new head, not blind
  retries to get green, unless the owner decides otherwise later. Red before and green after, and no weakening of a check,
  stay. The original lane-count quotation (`16-27-59:5327`, entry `f293eaf1`) is archived verbatim in
  `DECISIONS-ARCHIVE.md`, Active-execution cap; only the main-task count is superseded by [D-WORK-PARALLEL].
  Owner (`16-27-59:5331`, entry `de8294bf`): «И пусть этот отдельный поток всеми тестами занимается: чинит всё, перезапускает. Он починит все упавшие тесты, всю Windows починит.» «После того, как конвейер будет готов, переработан, чтобы он в рамках всех договорённостей и всего tooling конвейера работал.»
  Owner (`16-27-59:5323`, entry `6256b148`), the prompt: «Ты нормальный пром дай, нормально сконфигурируй, выдай ему рамки, ограничения, и он нормально работу сделает»
  Reason: Windows and flaky failures must not wait for main-task slots. Carrier:
  [PROCESS.md, Task pipeline](PROCESS.md#task-pipeline), `.agents/roles/test-fixer.md`. Since: process-pipeline squash.
- **Tests exist to check behavior** `[D-PIPELINE-TEST-PURPOSE]`. Every agent that writes, generates or fixes tests has one
  purpose: to check that the behavior matches the requirements, not to turn the run green, with the same bound as the
  reviewer: no fanaticism, perfectionism, polishing or taste. Owner (`16-27-59:5319`, entry `826fc7dd`): «Надо записать workflow, что все агенты, которые работают с тестами, пишут тесты, генерируют тесты, их задача — проверить качество на совпадение с требованиями, а не просто покрасить тесты в зеленый цвет.»
  «При этом так же, как и в случае с ревьюером, там должно быть без фанатизма, перфекционизма, вылизывания и прочей хуйни, вкусовщины»
  Coordinator interpretation, not owner words and not a direct owner approval of the algorithm: the owner gave the
  instruction for the prompt and the workflow; the test-integrity review is therefore narrowed to mechanically detected
  weakening, with `deliver-check` as the detector. Reason: this is the only purpose of tests and of work on them.
  Carrier: [PROCESS.md, Sufficient proof](PROCESS.md#sufficient-proof-without-idle-reruns) and
  [Quality control loop](PROCESS.md#quality-control-loop). Since: process-pipeline squash.

## Scope

- **Web-search model follows the caller** `[D-SCOPE-WEB-SEARCH-MODEL]`. The search-side GPT model matches the
  calling agent, independently of the coordinator's development subagent table. GPT callers use the same model and
  thinking; Claude callers use a fixed GPT counterpart from the product-side search mapping. Reviewer profiles
  are independent and have no cross-provider fallback. The owner's confirmed model/thinking table is in [D-WEB-MAPPING](#web-search).
  Search consumes the owner's ChatGPT
  subscription usage like any Codex message; the subagent matrix is unchanged.
  Owner (`16-27-59:4924`, entry `89d7b2e6`):
  «Мы не привязываемся к координатам. Короче, модель будет та же, которая соответствует нашей модели, которая делает запрос. Вот так. Как понял меня? Давай синканемся здесь.»
  «У нас у каждой cloud-модели есть соответственная модель GPT. А там какая модель на GPT? Там какая-то определённая модель выбирается, или как это происходит? Я не понимаю.»
  Owner follow-up (`16-27-59:4928`, entry `e8dc0395`):
  «Надо таблицу соответствия закрепить сразу же заранее. Просто надо понимать, какие модели ищут. Какая-то модель Soul 6, допустим.»
  Coordinator text, interpretation before the owner's follow-up at line 4928: same GPT model/thinking for a GPT
  caller; product-side fixed GPT counterpart for a Claude caller, not the coordinator's subagent classes;
  searches spend subscription usage.
  Owner fixed mapping (`16-27-59:4937`, entry `a8684155`):
  «Давай так: для Haiku 5.5 будет Luna 5.6. Для Sonnet 5.5 будет Sol 6, а для Opus 5.5 будет Sol 6.1. Вот и всё. Только Sol 6.1 и Sol 6 знаешь как будут соответствовать Haiku? Следующим образом, смотри: Sonnet и Opus: low модель соответствует low модели. Sol 6.1 один к одному соответствует Sonnet. А вот Opus 5.5 и Sol 6.1 соответствуют следующим образом: Opus 5.5 low соответствует Sol 6.1 low, Opus 5.5 medium соответствует Sol 6.1 high, а Opus 5.5 high соответствует Sol 6.1 extra high. Соответственно, все высшие рислинги Opus соответствует Sol 6.1 max.»
  Owner confirmed the complete table (`16-27-59:4941`, entry `2502a877`):
  «Да, всё именно так, как ты записал.»
  The shipped tool applies the mapping automatically from its calling agent's model/thinking, without model
  arguments for the agent. Owner (`16-27-59:4945`, entry `5a0f77bd`):
  «И потом в будущем, когда мы сделаем tooling, таблица соответствия модели будет прокидываться автоматически на уровне функционала. Не как аргументы CLI, а на уровне функционала tooling всё это будет пробрасываться, форвардиться»
  Reason: search follows the caller's capability instead of a universal cheap backend. Carrier: `extensions/RQW-web/core/model-map.ts`,
  table in [D-WEB-MAPPING](#web-search).
  Since: process-rules-oct23 squash.

- **Pi version** `[D-SCOPE-PI-VERSION]`. Pi 1.4.0 is the one supported and tested version; 1.3.0 is no longer supported
  and the range is not widened to future versions. Owner (`16-27-59:1839`, `16-27-59:1887`, `16-27-59:1953`):
  «Да. И параллельно, пожалуйста, вот что нужно сделать. Надо понять, сможем ли мы сейчас апгрейдить весь наш пакет на 1.4 версию Pi.»
  «1а»
  «Можно начинать уже и можно продолжать всю работу, которая была до этого начата»
  Reason: the 1.4.0 research found only intentional version gates and stale summary-output assertions in the way.
  Carriers: the exact-1.4.0 gates of `RQW-settings` (`selection.ts`, `cache-warming.ts`), `RQW-tools` (`selection.ts`)
  and `RQW-anthropic` (`index.ts`, `retry.ts`, `lifecycle.ts`, `registration.ts`); the shared tool-selection symbol
  keeps one namespace in both copies of `selection.ts`; `package.json` pins the development dependency and the peer
  range to 1.4.0, with `package-lock.json`; PCLI bundles the official 1.4.0 binary ([PCLI](#pcli)). Since: `02bd178`.
- **Extension layer, not a fork** `[D-SCOPE-LAYER]`. my-pi is an extension layer around stock Pi 1.4.0. Coordinator text
  (historical unverified attribution, not found in the session files above): "Мы делаем просто обвес вокруг
  оригинального Pi."; "Нет, никаких форков." Ported UI: `RQW-models`, `RQW-statusbar` and `RQW-send-now`
  ([Models](#models), [Status bar](#status-bar), [Send now](#send-now)); `RQW-scroll` adds one key behavior
  ([Scroll](#scroll)). Compact tools, agent cards, thinking hiding and naming are registered in `pi.extensions`;
  the native `RQW-theme` resource is registered separately in `pi.themes` ([UI activation](#ui-activation)). omp-lite's own tool implementations are not carried over; RQW-tools wraps Pi's stock
  tools ([Tools](#tools)). Reason: keep Pi's own behavior and add only agreed extensions. Carriers: `package.json`,
  `extensions/`. Since: `9ef1519`.
- **Public repository** `[D-SCOPE-PUBLIC]`. [ARQAWA/my-pi](https://github.com/ARQAWA/my-pi) is public. Coordinator text
  (historical unverified attribution): "он должен быть паблик". Carriers: the GitHub repository, `INSTALL.md`.
  Since: `10a864c`.
- **Dropped tools** `[D-SCOPE-DROPPED]`. Loading of `eval`, `lsp` and `ast_grep` is dropped for good; Pi has its own
  codemode. Coordinator text (historical unverified attribution): "eval нахуй не нужен, lsp ... ast-grep ...
  выбросить всё это на помойку". Carrier: their absence from `extensions/`. Since: `ee0421a`.
- **Postponed features** `[D-SCOPE-POSTPONED]`. Postponed, not dropped: `custom`, the
  `define-goal` skill and work orders, and the task list with the check before stopping (later switched on by a skill).
  Coordinator text (historical unverified attribution): "мы их не упраздняем, а откладываем". Status of each item:
  [BACKLOG.md](BACKLOG.md). The agent runtime and reviewer profiles are separate decisions:
  [Agent](#agent), [Review](#review). Since: `d28ae41`.
- **Reviewers** `[D-SCOPE-REVIEWERS]`. `RQW-review` supplies Codex TOML role profiles and native Agent Skills,
  while RQW-agent supplies their ordinary execution lifecycle. The contract and models are in [Review](#review).
  Owner source: `[D-AGENT-PROFILES]`; reason: one shared runtime for every specialized role.
  Carriers: `extensions/RQW-review/`, `extensions/RQW-agent/`. Since: subagent-profiles.
- **Two visible providers** `[D-SCOPE-PROVIDERS]`. `/login` and model lists show only `anthropic` and `openai-codex`;
  the rule and its carriers are in [Providers](#providers). Coordinator text (historical unverified attribution, see
  `C:3171` there): "Это именно отключить. Когда мы заходим в логин, там должны быть только кодекс, авторизация и
  авторизация через Anthropic, которую ты сейчас делаешь. И всё". Since: `c8434b0`.
## UI activation

- **Enable the ready interface now** `[D-UI-ENABLE-NOW]`. Owner: «1а».
  Source: `2026-10-21T16-27-59-062Z_01a15f4a-7ad5-7377-81be-0baf3b6ffa33.jsonl`, USER entry
  `4035f0a6`, `2026-10-23T19:05:12Z`, under the repository session directory named in Provenance.
  Coordinator text, option a, assistant entry `60ca78d9`, `2026-10-23T19:03:52Z`:
  Включить сейчас всё готовое вместе с карточками агентов, а карточку ревьюера добавить позже, когда будет новый ревьюер. Ты получишь интерфейс в ближайшие часы.
  Register thinking, naming, agent-ui and tool-ui now; statusbar is already registered.
  Change of circumstances, coordinator text, not an owner answer: the owner answered 1а while the new reviewer was
  still open. Since then the new reviewer has landed on `main` (`11b0fe2`), so the review card T14 is no longer
  deferred. It is part of the same switch-on and is delivered with `RQW-agent-ui`: cards for `agent`
  including ordinary reviewer-profile results.
  Reason: deliver the ready interface at once; the one deferred part became ready before delivery.
  Carriers: `package.json`, `extensions/RQW-agent-ui/`.
- **Renderer order** `[D-UI-RENDERER-ORDER]`. Technical decision under the activation approval above:
  preserve the existing extension order, then append `RQW-thinking`, `RQW-naming`, `RQW-agent-ui`, `RQW-tool-ui`.
  Pi 1.4.0 `dist/core/extensions/loader.js` `loadExtensionsInternal` initializes paths in order;
  `runner.js` `resolveToolRenderers` calls resolvers in load order with `next()` delegating to later resolvers.
  Thus agent-ui is the outer resolver. With both agent-ui and tool-ui loaded, a collapsed wait result is
  tool-ui's: the summary part `Waited for N agents` and the live block `wait <ids>`, per the owner's wait amendment
  "1а 2а". Owner words as recorded in the UI-port ledger; the source session file is no longer on disk, so the span is not machine-verified (taken by default). agent-ui delegates to `next()` while collapsed. On Ctrl+O it draws its own box with the expanded wait
  cards: header with id, status, model, effort and seconds, then the full answer verbatim. With tool-ui off,
  agent-ui shows its collapsed wait cards. The order is explicit and tested, not a claim that reversing it
  gives the same result.
  `getMessageRenderer` returns the first matching extension renderer; agent-ui owns `agent`
  results, including reviewer-profile agents. Thinking and naming register no competing tool/message renderer and keep the existing producers first.
  Reason: preserve independent cards and compact tools without changing execution. Carrier: `package.json`.

## Compact tool display

- **Between-answer summaries** `[D-UI-TOOL-DISPLAY]`. Owner sources below name entries of
  `2026-10-21T18-16-12-433Z_01a15fad-8f91-7306-bd46-1528008fbdc6.jsonl`, under the repository session directory.
  Q3, entry `dcd5070f`, line 120:
  > fork и patching pI недопустим. То, что мы делаем, это должно быть extension, расширение, всё, что угодно поверх PI. Мы не изменяем сам PI. Это, блядь, критически важно. Если мы что-то не можем реализовать без патча, это мы выбрасываем. Но надо пометить, что мы выбрасываем тогда из-за того, что мы не можем пропатчить, чтобы я, может, нашёл какую-то альтернативу этому.

  Q5, entry `8b4929e4`, line 160, three separate spans around the owner's screenshot paths:
  > Смотри я хочу что бы это было еще более компактно т.е. как сейчас в чате гпт, он пишет в строку что то типа
  >
  > Я хочу так же только со счетчиком чтений, записей и запусков
  >
  > И что бы последний ран висел раскрытым пока не начнется следующий, но он должен быть компактным, отображать только 4 строки вывода + статус строку, заголовк в первой строке, т.е. первая строка будет и название команды и первая строка я не знаю, короче подумай как это замутить.

  Q6, entry `8f4a46a9`, line 170:
  > Я не хочу скроить эти ебучие простыни вызовово файлов вот в чем концепт, я бы вообще все вызовы между ответами сворачивал в одну строку и хотел бы возможность развернуть оригинал

  Concept/spacing approval and the latest fold choice (entries `7f3d2603` and `55287376`, lines 174 and 176),
  recorded in the ledger as one line, the ellipsis is the ledger's:
  > Насчет пустых строки между шагами. Терплю, делаем так. Да, концепт в целом одобряю. ... Третий вариант "А"

  Owner words as recorded in the UI-port ledger; the source session file is no longer on disk, so the span is not machine-verified (taken by default).

  All tool calls between assistant answers share a muted summary with confirmed edit/read/search/run/wait/other
  counts. Latest top-level call leads; current call shows its header, last four output rows and status. The next
  call folds the previous; answer text immediately folds the live block. Ctrl+O shows every original at its place
  and toggles back. Native thinking spacer rows remain; stock Pi image output is unchanged. Public APIs only,
  no Pi patch, private fields or method replacement. Unsupported nested-result details remain omitted, not invented.
  Reason: compact progress without losing original calls. Carriers: `extensions/RQW-tool-ui/{index,groups,render,summary,live}.ts`,
  its README, `package.json`, `test/isolation.test.ts` and `test/tool-ui-smoke.test.ts`.
  Accepted appearance: owner entry `f7d11547`, line 702: "Бля, заебись, вообще кайф нахуй" (owner words as recorded in the ledger);
  carrier `/tmp/my-pi-ui.html` and UI-port `browser-preview/index.html`. Visual approval is not runtime proof.

## Agent cards

- **Delivered results, not an agent board** `[D-UI-AGENT-CARDS]`. Owner: "Да с сабагентами +".
  Source: the `18-16-12` session file named above, USER entry `96231cbd`, line 243. Owner words as recorded in the UI-port ledger; the source session file is no longer on disk, so the span is not machine-verified (taken by default).
  Agent custom results show compact cards: ID, outcome, available actual
  model/effort/duration, then the first nonempty answer line. Missing metadata stays omitted. Reviewer profiles
  use these same ordinary `agent#N` cards; there is no separate review delivery or review card.
  Delivered wait results: with both agent-ui and tool-ui loaded, the collapsed result is tool-ui's (summary part
  `Waited for N agents`, live block `wait <ids>`) and Ctrl+O shows agent-ui's expanded wait cards, each with
  id, status, model, effort, seconds and the full answer verbatim; with tool-ui off, agent-ui shows its
  collapsed wait cards. Stored content, execution and delivery do not change. A card shows one delivered
  result as finished or failed, never a live agent state. There is no agent list, board or child-log view.
  T17 cards belong to agent-ui, T18 indicator to statusbar: actual running agent counts, including reviewers, come
  from the existing activity producer, not a second registry in the cards. Ordinary busy letters shimmer silver;
  compaction status and synchronized chrome shimmer gold; the title shimmers gold during compaction.
  Title and activity placement follow [D-STATUSBAR-ACTIVITY](#status-bar).
  The indicator's existing decision is [D-STATUSBAR-ACTIVITY](#status-bar).
  Reason: readable delivered answers, independently switchable from activity. Carriers: `extensions/RQW-agent-ui/`,
  `extensions/RQW-agent/activity.ts`, `extensions/RQW-statusbar/`, `package.json`, `INSTALL.md`.

## Native theme

- **Named resource, native selection** `[D-UI-NATIVE-THEME]`. Owner: "да".
  Source: the `18-16-12` session file, USER entry `a6718225`, line 815, accepting coordinator proposal
  `74a328d8`, line 814. Owner words as recorded in the UI-port ledger; the source session file is no longer on disk, so the span is not machine-verified (taken by default). Coordinator text: an ordinary named Pi theme, selected once, persisted by Pi across
  reload/restart, switched back through native theme selection rather than disabling an extension.
  `pi.themes` distributes `./extensions/RQW-theme/theme.json`, named `RQW-theme`. Select through `/settings` -> Theme.
  Pi may persist only the theme choice; auth and unrelated settings stay untouched. Native menus keep their structure
  and behavior; supported roles and terminal-default delegation only, no universal terminal-canvas promise.
  No `pi.extensions` entry, activation code, transient override or automatic restore-on-disable.
  Reason: native persistence without unsupported lifecycle hooks. Carriers: `package.json`,
  `extensions/RQW-theme/theme.json`, `INSTALL.md`; native resource coverage: `test/isolation.test.ts`.

## Naming and thinking

- **Automatic native session names** `[D-UI-NAMING]`. Owner sources in the `18-16-12` session file:
  entry `67c70729`, line 930:
  > 1а самые низкие ризонинги пусть генерит 10 вариантов на основе контекста
  > 2а + после каждого компакшена на основе полного контекта
  > 3 ручное не надо, токлько перегенрация и автовыбор лучшего по смыслу из вариантов внутри /rename-gen команда
  > 4а

  entry `8ae348b0`, line 971:
  > враиант а
  >
  > RQW-statusbar +

  entry `bb1bbcbb`, line 944: "Если упала генерация до 3х ретраев и потом варнинг если сдохло в итоге".
  Owner words as recorded in the UI-port ledger; the source session file is no longer on disk, so the span is not machine-verified (taken by default).
  Coordinator text: option a in entry `b4093268`, line 970 means at most four whitespace-separated words AND
  32 Unicode code points. Prompt and validation enforce both; overlong candidates are rejected, never truncated.
  Background generation runs once after first user input and after every successful compaction, using all available
  projected context including summary and kept messages. Generate ten candidates and automatically select the best
  valid candidate by meaning. Both calls use only `kimi-coding/kimi-for-coding` (Kimi K2.8 Preview) with `low`
  reasoning, independent of the main chat model, without fallback. Owner correction, `16-27-59` session,
  USER entry `5b9c32fe`, 2026-10-25: «надо это делать через модель 2.8 preview low reasoning.»
  Reason: the owner's explicit naming-model choice, not a proven diagnosis of the earlier warning.
  No valid candidate is a failed attempt. Initial attempt plus up to
  three retries; final warning through public `ctx.ui.notify` preserves the old name. `/rename-gen` uses the same
  pipeline. New triggers/session switch cancel old generation; a native name change cancels the pending old trigger.
  Public `pi.setSessionName` persists the name in native history and `/resume`. Native `/name` stays unchanged;
  only the next automatic trigger or `/rename-gen` may overwrite a manual name. RQW-statusbar displays the current
  native name as a gold title in the top input border, shimmering during compaction, empty before a name exists.
  Placement follows [D-STATUSBAR-ACTIVITY](#status-bar).
  Reason: meaningful short names without blocking main work or a user candidate picker. Carriers:
  `extensions/RQW-naming/{index,core}.ts`, `extensions/RQW-statusbar/index.ts`, `package.json`, `INSTALL.md`.
- **Hide reasoning text only** `[D-UI-THINKING]`. Owner: "+".
  Source: the `18-16-12` session file, USER entry `b3584b94`, line 886, accepting coordinator proposal
  `227e51b7`, line 884 to hide reasoning text while retaining accepted native blank rows. Owner words as recorded in the UI-port ledger; the source session file is no longer on disk, so the span is not machine-verified (taken by default).
  `registerMarkdownTransformer` empties `assistant-thinking`; `setHiddenThinkingLabel("")` empties the hidden label.
  Stored messages, history and model context remain unchanged; native spacer/click-region rows remain.
  Reason: hide transcript reasoning without a Pi patch. Carriers: `extensions/RQW-thinking/index.ts`,
  `package.json`, `INSTALL.md`; independently switchable through Pi's package filter and `/reload`.

## Structure

- **Everything is an extension** `[D-STRUCT-EXTENSIONS]`. One folder per extension under `extensions/`; a shipped
  extension is listed in `package.json` `pi.extensions`, first `RQW-settings`, second `RQW-prompt`.
  `RQW-theme` is data, distributed through `pi.themes`, not an extension. `pcli-vscode/` is the one non-Pi exception (`AGENTS.md`, [PCLI](#pcli)).
  Coordinator text (historical unverified attribution): "в этом репозитории мы всё будем делать extension... Первый
  extension — это будут настройки, второй — промты, настройки промта". Carriers: `package.json`, `extensions/`.
  Since: `10a864c`.
- **RQW- prefix** `[D-STRUCT-PREFIX]`. Every extension folder carries the prefix `RQW-`. Coordinator text (historical unverified attribution): "у всех наших extension был префикс типа RQW- и название". Carrier: `extensions/`.
  Since: `320e80e`.
- **Tool names as in Pi** `[D-STRUCT-TOOL-NAMES]`. Tool and parameter names stay exactly as in Pi; no `apply_patch`, one
  edit format for every model; requirements are compiled in `notes/tools-requirements.md`. Coordinator text (historical unverified attribution): "имена такие же, как в P... никакой хуйни не надо навяливать из ОМП лайта"; "Нет, не надо
  для GPT patch делать. Пусть работает одинаково везде". Carriers: `extensions/RQW-tools/`,
  `notes/tools-requirements.md`. Since: `320e80e`.
- **Install prompt** `[D-STRUCT-INSTALL]`. `INSTALL.md` is the install prompt: run inside an already installed Pi, that Pi
  installs this package into itself with `pi install`, then requests `/reload` or restart; after `pi update` it requires
  a restart so process-wide patches use updated code. Coordinator text (historical unverified attribution): "чтобы
  можно было его везде воссоздавать, воссобирать с нуля, просто промтом одним через install prompt"; "install.md — это
  про установку именно наших обвесов на уже установленный Pi. Я внутри Pi запускаю этот промпт". Carrier: `INSTALL.md`,
  step 4. Since: `34abcd5`.

## Tools

- **Unchanged-read note** `[D-TOOLS-UNCHANGED-READ]`. `read` of RQW-tools answers an identical repeat of an unchanged range
  with one line instead of the text, as one engineered, deterministic rule with no prompt-dependent behavior. Approved
  by the owner and built directly, with no measurement and no trial before the build. Coordinator question
  (`16-27-59:5122`): "Его делаем после веб-поиска?" Owner (`16-27-59:5123`, entry `d0a9a090`): «да»
  Owner (`16-27-59:5131`, entry `1b3abc69`): «Эта механика должна быть абсолютно полностью инженерной.»
  Owner (`16-27-59:5135`, entry `171f4d82`): «через три дня после merge надо будет сделать review всех старых сессий на предмет того, помогло нам это или нет. И всё. Не будем никаких делать испытаний и прочей хуйни.»
  Owner (`16-27-59:5139`, entry `e7d58c49`): «У агента должна быть возможность зафорсить чтение.»
  Owner (`16-27-59:5111`, entry `8295a6f4`): «И там уже агент сам разберётся, перечитывать ему заново или нет.»
  Owner (`16-27-59:5119`, entry `f6282fe9`), no reread to verify an own successful edit: «Не надо вообще читать файл для этого.»
  At the owner's explicit request, passed on by the coordinator, it is built now, ahead of the WEB-SEARCH
  prerequisite; that message is not quoted here.
  Coordinator text (`16-27-59:5138`, `5140`): the numbers and that the note names the flag. The rule, in
  `extensions/RQW-tools/unchanged.ts` and `index.ts` (`checkedFiles`):
  1. Per session and tool set, a full top-level text read is remembered by resolved file, `offset` and `limit`, with the
     file's mtime, the sha256 of its bytes and the id of the tool call that returned it.
  2. An identical repeat returns the note `unchanged since your last read of this range; its text is earlier in this
     conversation. To get the content again, call read with force: true.` only when that tool result is still in the
     session branch, no compaction entry follows it, no `context_edit` entry changed or removed that result (Pi
     drops or replaces it in the model context then), at most 10 assistant messages (turns, the one making the call included) and at most
     30000 tokens (Pi's `estimateTokens` over the message, `custom_message` and `branch_summary` entries after it) came
     since, and the mtime and the hash are both unchanged. The latest `context_edit` of a later entry counts at the larger
     of its raw and replacement tokens; an omitting edit counts the raw entry, which is only too high. Any other case, an external change included, returns the
     normal content.
  3. `force: true` always returns the normal content and counts as a full read. The stock tool never sees `force`.
  4. Images, errors and a file that changed while it was read are never remembered. An image is what Pi's own
     `detectSupportedImageMimeTypeFromFile` says it is, the detector the stock `read` uses, so an image the stock tool
     could not process and answered with text only is never remembered either and the next read retries it. A truncated text read is remembered
     like any text; its identical repeat shows the same truncated text, and the continuation `offset=N` is a different range.
  5. Subagents are independent: each tool set has its own memory and its own session entries.
  6. A read inside a codemode script (call id with `/`) always returns the content and is not remembered: the script
     is a program that needs the data, the model never saw it. A context with no session entries gets the content.
  7. A ledger note on the file (someone else changed it) also means content.
  Taken by default, reversible by the owner: rules 4 to 7 and whole-file hashing were not asked for; they are the
  conservative choice. The state lives in session entries Pi already keeps, so no extension event hook is needed and
  compaction, branch changes and `/resume` need no extra handling. Reason: the model often rereads an unchanged file
  within a few turns; the repeat costs the file's tokens again and the first copy is still in context.
  The review of the effect is [TOKEN-EFFICIENCY-REVIEW](BACKLOG.md#token-efficiency-review).
  The one-line prompt rule for a successful edit or write already ships ([D-WORK-GOLDEN-RULE](#work-policy)).
  Carriers: `extensions/RQW-tools/{unchanged.ts,index.ts,descriptions/read.md}`, tests
  `test/extensions/RQW-tools/unchanged-read.test.ts`.

- **Nested codemode display facts** `[D-TOOLS-NESTED-DISPLAY]`. Owner (`16-27-59:3117`): «3а».
  Meaning: assistant question 3, option a at line 3116 proposed later saving nested edit counts and bash exit codes
  through our tools instead of leaving the Pi limitation. Reason: keep confirmed display facts across replay without
  patching Pi. RQW-tools adds compact public result `details.rqwToolsNestedCall` with `version: 1`, `tool: "edit"`
  and `files: [{path, ok, outcome?, added?, removed?}]`, or `tool: "bash"` and `exitCode`; the parent's
  `details.rqwToolsNested` has `version: 1` and `calls: [{id, ...marker}]`. Counts come from actual confirmed diff/patch
  results; no requested replacement text, output or diffs are duplicated. RQW-tool-ui matches exact Pi nested IDs,
  enriches only completed calls, and keeps saved membership/status and omitted-argument limits. An unfinished
  background handoff stays unconfirmed; final metadata is available through job wait
  `details.results[].details.rqwToolsNested`, not used to retrospectively confirm that old handoff.
  Carriers: `extensions/RQW-tools/{nested-display.ts,nested.ts,codemode.ts,index.ts,jobs.ts}` and
  `extensions/RQW-tool-ui/{groups.ts,changes.ts}`; limits: [tool UI README](extensions/RQW-tool-ui/README.md#nested-result-metadata-and-remaining-limits).
  No settings change; registration of tool UI in the package manifest is in [UI activation](#ui-activation).
  Since: this nested-codemode-counts squash.

- **Barrier eligibility tests** `[D-TOOLS-BARRIER-TESTS]`. Fixed and randomized barrier batches check maximal
  concurrency with held operations and an independent conflict oracle: after promise reactions drain, exactly the calls
  without unfinished earlier conflicts must have started. Seeded gate rejections check prompt release after failure and
  success; mutation checks reject ignored dependencies and needless serialization; real-timer batches and nested
  scripts keep ordering, abort, rejection and deadlock checks; no test asserts an elapsed slack cutoff. Owner
  (`16-27-59:591`): «Теперь по нестабильному тесту 1А: myIP на VDI, исправление прокрутки делаю расширением myIP. Да, насчёт myIP в VDI: это только если myIP установлен. Если он не установлен, то поебать вообще.»
  Coordinator text, option 1a: "Отдельной задачей разобрать, почему тест кодмода на Windows иногда не укладывается в 5
  секунд, и исправить причину." This entry is an engineering follow-up under that precedent. Reason: elapsed start
  latency includes host descheduling and garbage collection, which a percentile cutoff cannot tell from false
  dependencies. Carrier: `test/extensions/RQW-tools/barrier.test.ts`; test design:
  [notes/analysis-races.md, Test plan](notes/analysis-races.md#7-test-plan-synthetic-no-model-node---test-under-extensionsrqw-toolstest).
  Since: `f95be18`.
- **Shell timing in comparisons** `[D-TOOLS-SHELL-TIME]`. The stock-versus-wrapper shell-path test compares every result
  field except `structuredContent.wall_time_seconds`; both timings must still be nonnegative numbers. Engineering
  follow-up under the same precedent as [D-TOOLS-BARRIER-TESTS]. Reason: a rounded elapsed time is not shell-path
  behavior. Carrier: `test/extensions/RQW-tools/behavior.test.ts`. Since: `230e8d0`.
- **Wrapped stock tools** `[D-TOOLS-WRAPPERS]`. `extensions/RQW-tools/` replaces `read`, `bash`, `edit`, `write`, `grep`
  and `find` and adds `job`. Each tool spreads the stock definition (parameters, renderers) with our description and
  wraps its `execute`: the wrapper schedules the call in the barrier, may hand it to a background job, takes resource
  claims, appends file notes and checks the write precondition, and calls the stock execution inside; edit and write
  add the multi-file form, and edit drops strict sampling ([D-TOOLS-EDIT-STRICT]). Which tools are on is decided in
  [Settings](#settings). `ls` and other stock tools are not wrapped; Pi's `codemode` is one barrier call
  ([Settings](#settings)). Design: `notes/tools-design.md`; analysis: `notes/analysis-*.md`. Carrier:
  `extensions/RQW-tools/index.ts`. Since: `8889fdf`.
- **edit without strict sampling** `[D-TOOLS-EDIT-STRICT]`. Our edit sets `constrainedSampling` to undefined, so Pi does
  not send it as an Anthropic `strict` tool; read, bash and write keep the stock `strict: "prefer"`. Owner
  (`16-27-59:208`):
  «01a15f4f-7b7e-70e6-b1e2-bb238ce75359»
  «Также в этой сессии поработал агент, и там дохуя ошибок записи. Он делает параллельные эдиты: проредактировал и потом снова делает через время параллельные эдиты. И там целая вереница эдитов красная, с ошибками. Он потом перепосчитал файлы и снова отредактировал. Надо разобраться, этот баг пофиксить.»
  Reason: strict sampling garbled edit arguments where Cyrillic text began, while a strict write of Cyrillic text came
  through intact; the replay and probe numbers are in
  [notes/decisions-evidence.md](notes/decisions-evidence.md#tools-edit-strict-sampling-replay). Carriers:
  `extensions/RQW-tools/index.ts`, `test/extensions/RQW-tools/tools.test.ts` (the Anthropic request has no `strict` on
  edit and keeps it on write). Since: `886b677`.
- **Ordered conflict barrier** `[D-TOOLS-BARRIER]`. A call waits only for earlier calls it conflicts with: bash
  conflicts with every call, read never with read, otherwise an equal path key or an ancestor conflicts. Within one
  response this is the order; a background job of an earlier response holds later calls only as
  [Background jobs](#tools) (D4, H1) says. Reason: prevent conflicting tool calls from racing; bash is serialized against bash because its footprint is
  unknown. Evidence: [race analysis](notes/analysis-races.md). Carriers: `extensions/RQW-tools/barrier.ts`, `extensions/RQW-tools/index.ts`. Since: `8889fdf`.
- **Codemode watchdog test** `[D-TOOLS-CODEMODE-WATCHDOG]`. The 500 KB codemode ordering test streams its faux-provider
  fixture in fixed larger chunks and asserts the delta count; the 5 s deadlock watchdog, payload, ten repetitions and
  ordering assertions stay; no runtime barrier or codemode change. Owner (`16-27-59:591`): the line quoted in
  [D-TOOLS-BARRIER-TESTS]. Coordinator text, option 1a, the task wording: "Отдельной задачей разобрать, почему тест
  кодмода на Windows иногда не укладывается в 5 секунд, и исправить причину". Reason: the test spent its watchdog
  budget streaming tiny deltas before tools could run, not waiting in the barrier. Carrier:
  `test/extensions/RQW-tools/codemode.test.ts`; analysis and proof:
  [notes/settings-codemode.md, Test watchdog](notes/settings-codemode.md#test-watchdog). Since: `9a4068c`.
- **In-place writes with Windows retry** `[D-TOOLS-WIN-RETRY]`. In-place writes stay; on Windows `EBUSY`/`EPERM`/`EACCES`
  are retried for about 1.5 s. Reason: temp file plus rename fails on Windows when another process holds the file.
  Carriers: `extensions/RQW-tools/retry.ts`, `edit.ts`, `write.ts`. Since: `8889fdf`.
- **Search and output limits** `[D-TOOLS-LIMITS]`. grep and find get no match cap by default (`limit` 100000 when unset);
  the stock 50KB output cap stays; read and bash keep the stock 2000 lines / 50KB. Reason: Pi's default 100 grep matches
  cuts the broad first search wave; omp-lite's 51 200-character budget equals 50KB for ASCII. Carriers:
  `extensions/RQW-tools/index.ts`, `test/extensions/RQW-tools/tools.test.ts`, the descriptions. Since: `8889fdf`.
  GREP-NULL correction: every optional grep/find field equal to JSON `null`, `undefined` or the string `"null"`
  is removed before argument validation, preserving required `pattern`, explicit booleans, zero and other values.
  Reason: a literal `"null"` otherwise becomes a glob/path or an invalid option. Source: GREP-NULL audit section 5
  and the owner's 2026-10-24 fix request. Carrier: `extensions/RQW-tools/index.ts`; proof:
  `test/extensions/RQW-tools/search-null.test.ts`.
- **Search method section** `[D-TOOLS-SEARCH-METHOD]`. The search wave method lives in the grep description; RQW-tools
  supplies the one-line `<search_method>` section through its own `before_agent_start` hook when read, grep and find
  are declared. Carriers: `extensions/RQW-tools/descriptions/grep.md`, `extensions/RQW-tools/index.ts`. Since: `04aa50f`.
- **Caller's shell and image settings** `[D-TOOLS-SHELL-SETTINGS]`. read and bash are built with the user's settings
  (`shellPath`, `shellCommandPrefix`, `images.autoResize`), as stock Pi builds them. Reason: without `shellPath` a
  Windows setup with Git outside Program Files finds no bash. Carriers: `extensions/RQW-tools/index.ts`,
  `test/extensions/RQW-tools/behavior.test.ts`. Since: `f8cd7e9`.
- **Offered tool factory** `[D-TOOLS-FACTORY]`. `createTools(cwd, settings, nested?, options?)` in `index.ts` builds the
  six base tools and `job` with a barrier and a job registry of their own, plus the caller's `codemode` as one barrier
  call when `options.codemode` is given. The extension registers one set for the session and answers a request on
  `pi.events` channel `rqw-tools:subagent-tools` with `createTools` itself ([Agent](#agent)). Nothing in RQW-tools
  depends on RQW-agent. Carriers: `extensions/RQW-tools/index.ts`; `test/extensions/RQW-tools/tools.test.ts` checks the
  answer and that each call gives fresh definitions. Since: `90700ad`.
- **Read key spellings** `[D-TOOLS-READ-KEY]`. The read key mirrors stock `resolveReadPath` (NFD, curly quote and AM/PM
  variants), so a read and a write of the same file spelled differently still meet in the barrier. Carriers:
  `extensions/RQW-tools/keys.ts`, `test/extensions/RQW-tools/paths-barrier.test.ts`. Since: `f8cd7e9`.
- **Implicit order not described** `[D-TOOLS-HIDDEN-ORDER]`. The tool descriptions do not explain the automatic barrier
  order (bash waits for earlier calls, a read waits for an earlier write); explicit waits on background jobs are
  described. Reason: with those lines gpt-6.1-sol made one call per response; without them it batched
  ([notes/decisions-evidence.md](notes/decisions-evidence.md#tools-barrier-order-lines)). Carriers:
  `extensions/RQW-tools/descriptions/*.md`. Since: `0a2028e`.
- **Benchmark judging** `[D-TOOLS-JUDGING]`. A benchmark answer is judged with 5 judge votes, majority per checklist
  point. Reason: with one vote the bench42 quality gap was judge noise on one point
  ([notes/decisions-evidence.md](notes/decisions-evidence.md#tools-bench42)). Carrier: this rule; results in
  `notes/bench42.csv`, `notes/bench44.csv` and the evidence note. Since: `52efad7`.
- **Code answers in chat** `[D-TOOLS-ANSWER-IN-CHAT]`. `SYSTEM.md` says to answer a question about the code in the chat
  and to create or change files only when the task asks for it. Reason: a bench42 run hit the answer length limit and
  moved its answer into a file ([notes/decisions-evidence.md](notes/decisions-evidence.md#tools-bench42)). Carrier:
  `extensions/RQW-prompt/SYSTEM.md`. Since: `52efad7`.
- **edit and write descriptions** `[D-TOOLS-EDIT-WRITE-DESC]`. The multi-file form comes first, and a rename gets one
  edit per occurrence with enough of its line. A line telling the model that bash sees the changed files again was
  rejected. Reason: probes ([notes/decisions-evidence.md](notes/decisions-evidence.md#tools-description-probes),
  `notes/refine/refine-editwrite.md`). Carriers: `extensions/RQW-tools/descriptions/edit.md`, `write.md`.
  Since: `1628f8c`.
- **read description** `[D-TOOLS-READ-DESC]`. Read a needed file whole in one call and read every file needed next in
  one response; bash does not read or search files. Reason: probes
  ([notes/decisions-evidence.md](notes/decisions-evidence.md#tools-description-probes),
  `notes/refine/refine-readbash.md`). Carriers: `extensions/RQW-tools/descriptions/read.md`, `bash.md`.
  Since: `a0bd1b1`.
- **grep and find descriptions** `[D-TOOLS-SEARCH-DESC]`. The search wave names the spellings to try, reads every file
  the hits already justify in one response, and stops when, for every implementation, it is known where each value is
  set, used and what the code does with it; find shows brace alternatives. Reason: chosen by rule completeness, then
  responses ([notes/decisions-evidence.md](notes/decisions-evidence.md#tools-description-probes),
  `notes/refine/refine-search.md`). Carriers: `extensions/RQW-tools/descriptions/grep.md`, `find.md`. Since: `9e13b55`.
- **Description precision** `[D-TOOLS-DESC-PRECISION]`. grep respects .gitignore inside a git repository only; a grep
  glob with "/" matches from path; find also returns directories; the edit hint may be absent; a cut grep line is read
  around instead of narrowing; a tool result that names cat or sed overrides the ban; a long file written in parts is
  the one exception to one edit call per file. Reason: the second description review
  (`notes/review-descriptions-2.md`). Carriers: the six descriptions in `extensions/RQW-tools/descriptions/`.
  Since: `a56e291`.
- **Implementations that do not run** `[D-TOOLS-INACTIVE-IMPL]`. The prompt asks, for an implementation that does not
  run, where its value is set, where it is used and what that code does; a line asking to name every setting on the
  code path was rejected. Reason: probes
  ([notes/decisions-evidence.md](notes/decisions-evidence.md#tools-inactive-implementation-probe)). Carrier:
  `extensions/RQW-prompt/SYSTEM.md`. Since: `7890a8b`.
- **Fully specified files** `[D-TOOLS-SPECIFIED-WRITE]`. A new file the task fully specifies needs no read of its
  neighbours (one line in `SYSTEM.md`, one in `read.md`); the find example shows that "app" returns the directory only
  while "app/**" returns its files. Reason: probes
  ([notes/decisions-evidence.md](notes/decisions-evidence.md#tools-faster-writing-probes),
  `notes/refine/refine-write2.md`, `notes/refine/refine-find.md`). Carriers: `extensions/RQW-prompt/SYSTEM.md`,
  `extensions/RQW-tools/descriptions/read.md`, `find.md`. Since: `a0b6e75`.
- **Compaction file lists** `[D-TOOLS-COMPACTION-LIMIT]`. Accepted limit: Pi's compaction summary lists changed files
  from `args.path` only, so files given in `write.files[]` or `edits[].path` are missing from that list. Fixing it needs
  a change in Pi itself; the files stay in the transcript and the tool results. The premise was read in Pi's source
  before 1.4.0 and is not re-verified for 1.4.0. Since: `bfb2712`.
- **Background jobs** `[D-TOOLS-BG]`. Owner (`16-27-59:2561`, `16-27-59:2574`, design answers `16-27-59:2598`):
  «Да, и надо, чтобы основной агент. Нет, знаешь как? Надо, чтобы длительные shell процессы сами уходили в фон. Если он работает больше 20 секунд, чтобы он превращался в фоновый процесс, а не оставался висячим активным процессом. Надо, чтобы всё, что висит больше 20 секунд, любая операция, которая висит больше 20 секунд, уходила в background, и можно было просто её пропинговать через какое-то время. Чтобы у агента был инструмент проверки состояния.»
  «только надо время сократить до 12 секунд, после 12 секунд уходит в фон.»
  «1а2а3а»
  «4 - надо разобраться с рейс кондишенами и найти самое интелектальное производительное и эффективное решение марщрутизации и оркестрации тулколов»
  «5б»
  «6а с учетом 4 пункта добавочного»
  Rule: a top-level call of `bash`, `codemode` (the whole script) or `read`, `edit`, `write`, `grep`, `find` that has
  not settled 12 s after it started, barrier wait included, returns at once as `job#N` with the command, elapsed time,
  the output so far and a log file in the OS temp dir, and keeps running; a call that settles sooner returns exactly the
  stock result. Calls inside a codemode script never go to the background. The `job` tool (`wait`, `status`, `kill`; `ids`, `id`,
  `timeout_ms` default 300000 when omitted, `lines` default 20) waits mechanically until one selected job ends or the
  caller's deadline, keeps collecting for 250 ms after the first one ends, shows state, exit code, elapsed time, tail
  and log path, and kills a process job with its process tree or cancels a queued one. Approved caveat: a running
  file-tool job (`read`, `edit`, `write`, `grep`, `find`) cannot be interrupted safely; `job kill` reports
  `cannot_kill` and it finishes on its own. This is a design limit, not a defect; queued file-tool jobs can be
  cancelled. A wait may be a notification instead of a held call (`[D-TOOLS-NOTIFY]`); the descriptions say to kill jobs
  one no longer needs before the final answer. A process job dies on `job kill`, its `timeout`, a child's management
  interrupt and the caller's shutdown or reload, and after the handoff not on Esc or a new owner message; jobs belong to the session whose call started them (one registry per `createTools`; RQW-agent
  calls the offered `job` definition's `jobs.abortAll()` on interrupt and `jobs.dispose()` on close). `job` is active
  whenever one of these tools is; when Pi's allowlist keeps it off, nothing goes to the background. Reason: long
  operations must not hold the agent, and the agent needs a tool to check them; Codex unified exec yields the same way;
  the threshold is the owner's value.
  Ordering (D4). Owner (`16-27-59:2705`): «1a + живай проверка на хайку и луна хай ризонинга»; option 1a of the ordering
  proposal is named in coordinator text "ordered until handoff, free after". Calls of the same response keep the barrier
  order: a call after a backgrounded job waits for its real end and itself becomes a queued job after 12 s. At the
  handoff a bash or codemode job is detached from the barrier (`detach` in `barrier.ts`, through `nested.ts`); calls of
  later responses wait for it only for the resources it holds (H1). A read, edit or write job keeps its paths. A
  dependency on a background job is explicit: `job wait`, then the dependent call. While a bash or codemode job of the
  caller runs, a read, edit or write of a file changed outside the caller's tools since that job started gets one note
  naming the job.
  Routing (FR-safe). Owner (`16-27-59:3117`, the answer to the routing question): «2а». Holds (H1): at the handoff a
  bash job keeps what `footprint.ts` reads with certainty from its command text: the package folder an install changes,
  the git index and refs of a repository a git command changes (every subcommand except known reading ones), and the
  exact files it writes (redirects, `tee`, `sed -i`, `curl -o`, `rm`, `mkdir`, `touch`, `cp`/`mv`/`ln` destinations).
  `footprint.ts` restores the outer working directory when a subshell closes. Mutating `git symbolic-ref` and
  `git reflog` forms hold the repository; their read-only forms remain reads.
  A later call waits only for these; reads never wait; any doubt holds nothing. Package-folder and git holds are
  process-wide (`ledger.ts`) across main, subagents and reviewers; files are not ordered across sessions, they
  get attributed notes. Effects report (O1): a top-level bash call that can become a job, or a top-level codemode call,
  takes a snapshot of the working tree
  (`git ls-files -co --exclude-standard`, or outside git a walk with one global limit of 20000 files, including
  within a single wide directory, without .git, node_modules,
  .next, target, .venv, __pycache__) right before its command starts, and a job takes another when it ends; what
  changed is the difference of the two states, never a time cutoff. Approved caveat: a bash call with its own
  positive `timeout` of 13 s or less never goes to the background, so it takes no pre-start snapshot. Calls with a
  longer or absent timeout take the snapshot even if they finish before handoff; this is not a snapshot defect. Owner (`16-27-59:3621`), on the cost:
  «Да, если это всего лишь 150 миллисекунд на 20 тыс. файлов, конечно, блядь, надо делать снимок файлов точный. Это 1А.»
  The report lists files created and changed while the job ran (with the other session and tool), the caller's own
  writes, own writes overwritten since, files deleted since the start, and the other jobs that ran alongside.
  Unreadable directories, file-stat failures and git warnings recorded by either snapshot appear in `effects.errors`,
  labelled before the start or at the end; failed or cancelled scans, git listing failures and the global walk bound
  are reported in `effects.errors` or `scanned`. Unchecked paths are explicit, and an inaccessible file is not
  classified as deleted. Write precondition (P1): a write over a file the session has read or written, changed
  since by anyone else, is refused once with who changed it; the identical retry overwrites; a file never seen is
  written without a check. Check, stock tool and ledger record run in one process-wide critical section per file
  (`withFileLock`); files are keyed by native real path (`identityKey` in `keys.ts`); records belong to a registry
  `owner`, the label is only shown. K1: `job kill` also cancels the queued same-response calls that wait for the killed
  job and lists them in `cancelled_followers`; a killed queued call leaves the barrier at once (`withdraw`). N1: a job
  that ended with an unseen non-empty effects report adds one note line to the caller's next top-level tool result.
  W1: `job wait` takes `until`, a JavaScript regular expression on the output (a leading `(?i)` ignores case). S1: a
  codemode script waits as a queued job for a free worker of the process (`PI_CODEMODE_MAX_WORKERS`, default 2). A
  bash call inside a codemode script takes the same process-wide claims. Each session's label comes through the
  optional `options.label` of the offered factory (`main`, `agent#1`, `agent#1/agent#2`, ...).
  Children like main. Coordinator text, technical decision at the rebase onto subagent parity; the parity request,
  owner (`16-27-59:2608`): «Надо что бы саб агенты были как в куросре посмотри реверз инжинеринг и скажи свои предложения».
  With an RQW-tools offer, a child's `codemode` is Pi's definition built from that session's API, passed
  as `options.codemode` and returned as one call of the child's barrier and a job of its registry, so a child script goes
  to the background after 12 s like main's and S1 slots count main and every child together; without an offer the child
  keeps Pi's stock codemode. Reviewer profiles are ordinary agents and get the same offered `job` tools,
  notification bridge and management cancellation as every child. The prompt section `rqw_tools_execution` says that a
  background job holds the later calls of its response and, from later responses, only calls that change what it holds.
  Reason: a replay of recorded tool calls left D4 alone with silent overlaps between jobs and later calls; FR-safe
  leaves none silent and keeps the same-response order; the owner chose it. Probes, replay, snapshot cost, pilot defects
  and code-review fixes: [notes/decisions-evidence.md](notes/decisions-evidence.md#background-jobs-evidence); races
  R16-R24: `notes/analysis-races.md` section 9.
  Carriers: `extensions/RQW-tools/jobs.ts`, `barrier.ts`, `nested.ts`, `footprint.ts`, `ledger.ts`, `keys.ts`,
  `index.ts`, `codemode.ts`, `descriptions/bash.md`, `descriptions/job.md`, `descriptions/write.md`;
  `extensions/RQW-agent/index.ts`;
  `notes/prompt-tools-isolation.md`. Proof: `test/extensions/RQW-tools/background.test.ts`, `barrier-detach.test.ts`,
  `footprint.test.ts`, `ledger.test.ts`; `test/extensions/RQW-agent/wait.test.ts`,
  `agent.test.ts`;
  `test/prompt-tools-isolation.test.ts`. Since: `e5440f2`; scan and footprint safeguards since `e1cca48`; handoff independence and notification waits since the final squash of branch `agent-async`. Earlier wording (Esc killed jobs, polling only): [DECISIONS-ARCHIVE.md](DECISIONS-ARCHIVE.md), A-0264.

- **Notification waits and independent jobs** `[D-TOOLS-NOTIFY]`. Owner (`16-27-59:4876`, entry `85357ce9`) and (`16-27-59:4937`, entry `a8684155`):
  Entry `16-27-59:4876` asked that waits wake the agent by notification and that owner steering stay possible without aborting
  waits, children or jobs; its exact text is not kept in this repository, only the entry id and that summary. Entry
  `16-27-59:4937` (the same spans are kept in [BACKLOG.md](BACKLOG.md#asynchronous-tool-research-sources)):
  «Также добавь в список задач, что нам нужно сделать реализацию асинхронного tool calling, как в Codecs CLI, чтобы агент мог вызывать tool call и при этом асинхронно полностью работать, принимать от меня сообщения и не обрываться на этом.»
  Rule, taken by default (coordinator text, not an owner quote): `job wait` registers its subscription and snapshot in one
  synchronous step. A result that is ready now returns at once as before. Otherwise the call returns `reason: "waiting"`
  with `terminate: true`, so the caller's turn ends with no further model request, and one notification (a job ended, an
  `until` match, or the `timeout_ms` deadline; ends within 250 ms join one notification) later arrives as a `[job]`
  message that wakes an idle caller. A busy caller gets it at the settlement boundary, held outside Pi's steering queue so
  Esc and send-now do not drop it. A newer wait on the same job replaces the older one; a result already shown by
  `status`, `wait` or `kill` is not announced again. There is no explicit held-wait parameter; see `[D-TOOLS-NO-BLOCKING-FLAG]`.
  Calls inside a codemode script stay blocking. The print/json fallback is for external hosts only: a root session run by Pi in print or json mode ends
  with its run, so its waits block; an in-process child agent with the `notify`/`retain` bridge keeps notifications even when its SDK mode reads print.
  Any caller without a `notify` callback keeps the blocking wait. Reviewer profiles use the ordinary child bridge. The `notify` callback
  of the job registry is the same one subagent waits use, so no second delivery registry exists. A child's offered factory also
  gets the optional `retain` hook, taken only while a notification subscription is pending, so the child's assignment stays open;
  both hooks are optional and keep the extensions independent.
  A job that went to the background belongs to the session: Esc, abort of the run, a new owner message and send-now
  do not kill it. `job kill`, a child's management interrupt (`jobs.abortAll()`), `stop`/`restart` and session shutdown
  do. A foreground call still aborts with its run. This supersedes owner decision D5 (Esc kills all background jobs) of
  `[D-TOOLS-BG]`; no owner quote for D5 is repeated here.
  Reason: the owner wants a waiting agent not to hold a call and owner messages not to kill background work.
  Carrier: `extensions/RQW-tools/jobs.ts` (`watch`, `notify`), `extensions/RQW-tools/index.ts` (`installNotifications`),
  `extensions/RQW-tools/descriptions/job.md`. Proof: `test/extensions/RQW-tools/notify.test.ts`, `notify-sdk.test.ts`, `background.test.ts`.
  Since: the final squash of branch `agent-async`; explicit held waits removed by `[D-TOOLS-NO-BLOCKING-FLAG]`.

- **Remove the explicit held-wait option** `[D-TOOLS-NO-BLOCKING-FLAG]`. Owner:
  «Не синхронный, а АСИНХРОННЫЙ тулинг я заказывал что бы никто никогда не мог физически заблокироваться»
  Source: `2026-10-21T16-27-59-062Z_01a15f4a-7ad5-7377-81be-0baf3b6ffa33.jsonl`, USER entry `9987ee04`, line 6807.
  After the remaining blocking paths were reported, the owner narrowed this delivery:
  «Да только блокинг тру пока»
  Source: the same session, USER entry `811f5ec6`, line 6832.
  Remove `blocking` from both `agent` and `job`, including its schema, explicit held-wait branch and instructions.
  Direct waits with notifications use the existing immediate `waiting` receipt and later notification.
  Known remaining blocking paths are deferred by the owner and unchanged in this delivery:
  1. The shared agent operation queue and long `start`/`restart`/`resume` control calls, including hydration,
     authorization and session preflight (`extensions/RQW-agent/index.ts`, `execute`, `resolveConfig`, `createSession`, `startRun`).
  2. Waits inside codemode scripts (`toolCallId.includes("/")` in RQW-agent and `id.includes("/")` in RQW-tools).
  3. External root print/json hosts and callers without a notification callback, including the implicit
     `Coordinator.observe` host wait (`extensions/RQW-tools/index.ts`, `installNotifications`; RQW-agent host lifecycle).
  Reason: remove the explicitly selectable blocker now without adding an unapproved background mechanism.
  Carriers: `extensions/RQW-agent/index.ts`, `extensions/RQW-tools/jobs.ts`, their descriptions, READMEs and tests;
  `AGENTS.md`, `PROCESS.md`. Superseded coordinator-default text is preserved verbatim in
  [DECISIONS-ARCHIVE.md](DECISIONS-ARCHIVE.md), Explicit held-wait option.
  Since: the nonblocking-waits delivery.

## Context

- **Physical window and compaction** `[D-CONTEXT-WINDOW]`. For every physical model, W = min(contextWindow, 500000), R = Math.round(W / 10), and compaction starts above W - R. This covers built-in, models.json and extension models, native routing, startup, resume and model switches without a per-model list. The window itself is capped, not just the trigger; physical models up to 500000 keep their original object.
  Coordinator text: this records the existing universal window rule; the historical C:2015/C:2047 quotations have not been verified in the permitted Pi USER sources.
  Reason: apply one automatic rule to every physical target.
  Carrier: `extensions/RQW-context/index.ts` (`contextRule`, `capModel`). Since: `7e00dcb`.
- **Native routing and reserve** `[D-CONTEXT-ROUTING]`. Stable capped copies are exposed through Agent state, `createLoopConfig`, `_buildRuntime` and native `ModelRuntime.getPhysicalModel`; registry entries are not mutated. Virtual selections keep their native identity, callback, thinking and declared or unknown window. Session/request-local `AsyncLocalStorage` supplies the physical target's W/R: automatic preparation uses its triggering target, manual preparation the latest successful response after abort. Default summaries preserve interception preparation and route once from Pi's captured selection. Summary-reserve rebinding is removed: Pi 1.4.0 compact does not read preparation.settings, and native summary output limits remain unchanged. The universal W/R rule, explicit settings and physical request scopes remain.
  Coordinator text: the owner accepted removal of inert summary-reserve rebinding in the CONTEXT-SIMPLIFY task brief; this is not an owner quotation.
  Reason: remove bookkeeping that changes neither summary requests nor results, without changing physical limits or native selection identity.
  Carrier: `extensions/RQW-context/index.ts` (`wrapAgentState`, `wrapRouting`, `wrapCompactionSettings`), `extensions/RQW-context/README.md`; details: `notes/context-questions.md`. Proof: `/tmp/context-simplify-proof.mjs`, `/tmp/context-simplify-proof.log` compare native library and bundle split/non-split compaction with varied reserves, fixed sessionId and normalized timestamps. Since: context-simplify delivery; supersedes the entry introduced by `6eb01a7`, archived from `0521318` in `DECISIONS-ARCHIVE.md`.
- **Explicit settings and accepted limits** `[D-CONTEXT-SETTINGS]`. Pi's global `compaction.reserveTokens` and per-selection `compaction.modelOverrides["provider/id"].reserveTokens` retain their precedence when below W; a reserve of W or more falls back to R. `compaction.enabled: false` still disables threshold and overflow compaction. A positive models.json window is honored up to the cap; absent or nonpositive windows retain Pi's behavior. The catalog, `model_select.model` and RPC `set_model` show the declared window, while session state and the footer show the capped window; reconciling them requires a Pi API.
  Coordinator text. Reason: preserve explicit user choices without producing a nonpositive threshold.
  Carrier: `extensions/RQW-context/index.ts` (`reserveFor`, `userSetReserve`); `test/extensions/RQW-context/context.test.ts`. Since: `a03eb47`.
- **Output and summary limits** `[D-CONTEXT-LIMITS]`. Pi 1.4.0 summary requests use the summarizing model's output limit, not R. pi-ai also clamps output to the window minus estimated input minus 4096, with a floor of one token; capping the window can therefore make oversized input or prose-heavy summary requests unrecoverable. Tool-result truncation in summaries can make tool-heavy histories behave differently. Threshold compaction and native overflow recovery remain Pi's responsibility; this extension adds no provider window field or recovery algorithm. Historical Pi 1.3.0 measurements are evidence, not current Pi 1.4.0 measurements, in [context limits evidence](notes/decisions-evidence.md#context-limits).
  Coordinator text. Reason: the owner's window cap does not remove native output and summary constraints.
  Carrier: `extensions/RQW-context/index.ts`, `test/extensions/RQW-context/context.test.ts`, `test/extensions/RQW-context/routing.test.ts`; Pi 1.4.0 `pi-ai/dist/api/simple-options.js` and `dist/core/compaction/utils.js`. Since: `a03eb47`.
- **Checked process-wide lifecycle** `[D-CONTEXT-LIFECYCLE]`. Native method descriptors, arities, model getter and prototype extensibility are checked before static installation; unsupported shapes fail without static changes. Hooks are installed once per process and apply while `Symbol.for("rqw-context/owner")` holds any live owner token. Each `session_shutdown` removes only its own token; the last removal restores stock behavior, including physical lookup identity. SDK `dispose()` alone does not emit this lifecycle event, and sessions that excluded the extension still receive the rule while another owner remains. Updating the hook implementation requires restarting Pi, not only `/reload`.
  Coordinator text. Reason: independent sessions must not disable each other's universal context policy.
  Carrier: `extensions/RQW-context/index.ts`, `test/extensions/RQW-context/context.test.ts`, `test/extensions/RQW-context/routing.test.ts`; restart instructions: `INSTALL.md`; [context proof](notes/decisions-evidence.md#context-proof). Since: `e1fa03d`.

## Prompt

- **Custom prompt** `[D-PROMPT-CUSTOM]`. RQW-prompt sets `systemPromptOptions.customPrompt` in `before_agent_start` from `extensions/RQW-prompt/SYSTEM.md` plus workstation, critical, environment and date blocks. It does not force the full prompt: Pi still appends project context, skills and cwd, and records sections. The date block does not duplicate cwd. The concept is documented in `notes/prompt-concept.md`; historical benchmark results are recorded in [prompt history](notes/decisions-evidence.md#prompt-history), not a claim that the original template is the only measured version.
  Coordinator text: the historical initial owner quote has not been verified in the permitted Pi USER sources.
  Reason: replace the prompt prefix while retaining Pi's context assembly.
  Carrier: `extensions/RQW-prompt/index.ts`, `extensions/RQW-prompt/SYSTEM.md`. Since: `17c21eb`.

### Prompt/tools isolation

- **Conditional tool instructions** `[D-PROMPT-TOOL-ISOLATION]`. RQW-prompt makes no RQW-tools-specific search or execution assumptions. RQW-tools adds `systemPromptOptions.sections.search_method` only when read, grep and find are declared, and `rqw_tools_execution` only when bash is declared, checking `selectedTools` minus `hiddenTools`. This uses native sections, without an import or handshake between the two extensions, and works with either extension disabled or either load order. The same pure section function also answers the optional read-only `rqw-prompt:startup-projection` channel, so Codex can project the next prefix without invoking turn hooks; either extension still works with the others off. The write-in-parts rule belongs only to `extensions/RQW-tools/descriptions/write.md`; `forceSystemPrompt` bypasses native sections and is not overridden. Native section placement was accepted despite measured changes, not claimed to be behaviorally neutral.
  Coordinator text: the isolation requirement is recorded in [Isolation](#isolation); its historical quote is not verified in the permitted Pi USER sources.
  Reason: instructions must follow available tools without coupling extensions.
  Carrier: `extensions/RQW-tools/index.ts`, `extensions/RQW-prompt/SYSTEM.md`, `test/prompt-tools-isolation.test.ts`. Evidence: `notes/prompt-tools-isolation.md`, [source proof](notes/decisions-evidence.md#prompt-isolation-source), [accepted measurements](notes/decisions-evidence.md#prompt-isolation-measurements). Since: `04aa50f`.

## Settings

- **Background cache warming** `[D-SETTINGS-WARMING]`. Background warming is off inside RQW-settings regardless of user configuration; normal inference still writes and reads prompt caches. A reversible session-owned `getCacheWarmingMode` policy leaves settings files, environment and cache-miss notices unchanged, restores the native getter on shutdown, and preserves other owners and foreign hooks through reload. All children, including reviewer profiles, carry the policy owned by RQW-agent.
  Owner: «Да, и вообще надо убрать прогрев кэша, чтобы кэш прогревался, когда уходит сообщение первое, не раньше этого.» Source: `2026-10-21T16-27-59-062Z_01a15f4a-7ad5-7377-81be-0baf3b6ffa33.jsonl`, USER entry at line 440, in `~/.pi/agent/sessions/--Users-arkadijcukavin-ai-project-my-pi--/`.
  Reason: no synthetic keepalive inference before the first real request.
  Carrier: `extensions/RQW-settings/cache-warming.ts`, `test/extensions/RQW-settings/cache-warming.test.ts`, `test/cache-warming-reload.test.ts`; evidence: `notes/prompt-cache-policy.md`. Since: `b91f832`.
- **Default tools and reload** `[D-SETTINGS-DEFAULT-TOOLS]`. RQW-settings activates registered built-in `codemode` and `tool_search` at `session_start` only without an explicit CLI or `defaultTools` selection, using the same selection policy as RQW-tools for grep/find. Disabled built-ins are not added. The default codemode mode stays `on`; Pi adds codemode call signatures to the seven RQW-tools descriptions, including `job`. On `/reload` both extensions leave the existing active set alone, preserving user changes.
  Coordinator text: the historical CodeMode/Tool Search owner quotation is not verified in the permitted Pi USER sources.
  Reason: useful defaults must not override explicit selections.
  Carrier: `extensions/RQW-settings/index.ts`, `extensions/RQW-settings/selection.ts`, `extensions/RQW-tools/index.ts`, `extensions/RQW-tools/selection.ts`; details: `notes/settings-codemode.md`. Since: `3720200`.
- **Codemode barrier and capacity** `[D-SETTINGS-CODEMODE]`. With RQW-tools loaded, the registered Pi `codemode` definition is wrapped as one outer barrier call with scope all; its script tools use that call's own barrier. Nested calls find the group through `<codemode id>/<n>` ancestry, not AsyncLocalStorage, so Bun worker callbacks do not lose the grouping. Unregistered ancestors fall back without waiting on themselves. Pi 1.4.0 has process-wide codemode worker slots, `PI_CODEMODE_MAX_WORKERS` default 2, a FIFO slot wait capped at 60 seconds or the remaining script deadline, and a 256 MB VM limit; nested scripts can exhaust slots and time out. The wrapper adds no unlimited capacity and respects `-builtin:codemode`.
  Coordinator text. Reason: nested execution must preserve ordering on Node and Bun without self-deadlock.
  Carrier: `extensions/RQW-tools/nested.ts`, `extensions/RQW-tools/codemode.ts`, `extensions/RQW-tools/index.ts`, `test/extensions/RQW-tools/bun/codemode-check.mjs`; CI: `.github/workflows/tests.yml` covers Node 22.19.0 and 24, Bun 1.3.14 and 1.4.3. Evidence: `notes/settings-codemode.md`, [codemode history](notes/decisions-evidence.md#codemode-history). Since: `b98baec`.
- **GPT Fast** `[D-SETTINGS-GPT-FAST]`. `/fast-gpt [on|off]` toggles the main chat's OpenAI priority processing, with no argument toggling it; `FAST_GPT_DEFAULT = false`. Only matching `openai-codex` request bodies receive `service_tier: "priority"` through `before_provider_request`; Anthropic is untouched. State survives reload and new sessions in the process, not restarts, and has no settings key. The hook applies to SSE and WebSocket request bodies; Pi accounts for the response's service tier. The main-chat indicator belongs to [Status bar](#status-bar).
  Owner: «Режим Fast должен действовать только на основной чат. И по умолчанию он должен передаваться сабогентам. Но если я запрещу исполнителю сабогенты запускать в режиме Fast, то он должен этому повиноваться. Так это должно работать»
  Owner: «В CloudCode у нас режима Fast нет, потому что у меня нет кредитов, чтобы режим Fast поддерживать в CloudCode. Поэтому наш режим Fast распространяется только на GPT. Можно даже называть его GPT Fast.»
  Source for both exact spans: `2026-10-21T16-27-59-062Z_01a15f4a-7ad5-7377-81be-0baf3b6ffa33.jsonl`, USER entry at line 2170, in the Pi session directory named above.
  Reason: expose GPT-only priority without changing provider transports or Anthropic requests.
  Carrier: `extensions/RQW-settings/fast-gpt.ts`; tests: `test/extensions/RQW-settings/fast-gpt.test.ts`, `test/extensions/RQW-statusbar/fast-gpt.test.ts`. Since: `fa05edf`; default off since `7ad7de8`.
- **GPT Fast inheritance** `[D-SETTINGS-GPT-FAST-CHILDREN]`. Subagents and reviewers inherit their caller's GPT Fast state at start; nested children inherit from their direct caller. Later main-chat toggles do not update running children. Optional boolean `fast_gpt` overrides inheritance, and agent `send` or `restart` may explicitly change a child's state; omitted restart keeps it. A strict-schema null means omitted. The `agent` description tells callers to pass `fast_gpt: false` when the user forbids Fast. Reviewer profiles use the same agent implementation. The extension-local `fast-gpt.ts` queries `rqw-settings:fast-gpt-query` synchronously; `rqw-settings:fast-gpt` notifies changes. Without a settings responder, inherited main-chat Fast is off.
  Owner: the exact inheritance instruction is recorded in GPT Fast above.
  Reason: child tier follows the caller's choice without live coupling or cross-extension imports.
  Carrier: `extensions/RQW-agent/fast-gpt.ts`, `index.ts` and `test/extensions/RQW-agent/fast-gpt.test.ts`. Since: `fa05edf`.

## Isolation

- **Separate mirrored extension tests** `[D-STRUCT-TEST-LAYOUT]`. Coordinator question and accepted option 3a, not an owner quotation: move `extensions/*/test/**` to `test/extensions/RQW-<name>/**`, preserving the tree and keeping root `test/`. Source: owner's architecture answers `3a 4a 5a 6a 7a` and subsequent explicit delivery order in this repository session, 2026-10-25. First delivery is only the mechanical move and necessary path fixes, with assertions and behavior unchanged. The index, generator, README maps, extension-structure alignment and code-quality principle are deferred to the second delivery.
  Reason: keep shipped extension folders free of tests without losing independent isolation coverage.
  Carriers: `test/extensions/`, `test/isolation.test.ts`, `package.json`, affected workflows and test scripts. Superseded isolation wording: `DECISIONS-ARCHIVE.md`, A-0327. Since: the delivering squash of `test-layout-move`.

- **Self-contained extensions** `[D-ISOLATION-SELF-CONTAINED]`. Each RQW extension is independently switchable; its runtime source imports no file outside its folder. Its test tooling may also import its own mirrored test tree, but no other extension or test tree. Shared helpers are copied: both `selection.ts` copies are 127 lines, and Fast event-channel constants are repeated in three extension-local files. Its tests live under `test/extensions/RQW-<name>/`, import only their own test tree and extension folder, and load only that extension; multi-extension tests remain directly under root `test/`. Disabling an extension removes its owned behavior; process-wide Context and PCLI hooks stay active while any owner remains.
  Coordinator text: the historical isolation quote is not verified in the permitted Pi USER sources.
  Reason: one feature flag must not require another extension to exist.
  Carrier: `extensions/`, `test/isolation.test.ts`, `test/isolation-run.ts`. Since: `81cafe3`.
- **Registered resource coverage** `[D-ISOLATION-COVERAGE]`. `test/isolation.test.ts` derives its tested extension list from `package.json` `pi.extensions`, checking local imports, independent loading, tool behavior and package-filter reload, including naming, thinking, agent-ui and tool-ui. It also checks unique resource registration, agent-ui before tool-ui and native package-loader discovery of `RQW-theme` with extensions disabled.
  Coordinator text. Reason: registration and independent resource delivery need manifest-driven coverage; this is not a claim of physical-terminal or end-to-end proof.
  Carrier: `package.json`, `test/isolation.test.ts`, `test/isolation-run.ts`; [historical coverage](notes/decisions-evidence.md#isolation-coverage-history); `test/tool-ui-smoke.test.ts` separately tests tool UI. Since: `81cafe3`.
- **Package switch and native limits** `[D-ISOLATION-SWITCH]`. Switch one extension off with the object-form package entry and the exact file exclusion `"extensions": ["-extensions/RQW-<name>/index.ts"]`, keeping the same source `git:github.com/ARQAWA/my-pi`; a directory-only exclusion does not match the file. The filter takes effect after reload or restart. `pi -e <dir>` bypasses package filters; choose individual entrypoint files and use `-ne` to avoid an installed copy. Built-ins use `-builtin:<name>`, not package filters. Pi preserves active tools on reload, so stock grep/find or codemode/tool_search may remain active after their RQW extension is disabled until a new session or restart.
  Coordinator text. Reason: use Pi's package controls without inventing a second switch mechanism.
  Carrier: `INSTALL.md`, `test/isolation.test.ts`; Pi 1.4.0 `dist/core/package-manager.js`, `dist/core/resource-loader.js`, `dist/core/agent-session.js`. Since: `81cafe3`.

## Agent

- **Codex TOML profiles on one agent lifecycle** `[D-AGENT-PROFILES]`. `agent_type` selects a named Codex role;
  no selector keeps the generic defaults. `smol-toml@1.9.1` is a direct dependency, not a hand-written parser.
  Supported role fields are `name`, `description`, `developer_instructions`, `model`, `model_reasoning_effort`
  and `nickname_candidates`; `developer_instructions` is inline role text after the main prompt and reminder.
  Other Codex fields are silently ignored, not applied as sandbox, permissions, auth, transport or lifecycle
  settings. Malformed TOML and invalid supported role fields remain errors. Configs contribute only `[agents.<name>]` declarations,
  `config_file` and role metadata. Recursive `.toml` discovery also reads agents folders.
  Sources, weak to strong: extension offers, `$CODEX_HOME` (default `~/.codex`), `getAgentDir()` (normally
  `~/.pi/agent`), then project `.codex` and `.pi` from root to cwd, without a separate trust gate. Pi wins at the same directory;
  nearer directories win. Existing Codex folders are read directly, never written. The extension offer is
  `rqw-agent:profiles` with `{ offer(paths: string[]): void }`, without cross-extension imports.
  Bare GPT IDs map to `openai-codex`; other bare model IDs need one exact unique registry match. There is no
  model fallback or silent effort lowering: `none` maps to `off`, `minimal/low/medium/high/xhigh/max` retain their
  names, and unsupported efforts fail. Profiles provide defaults: explicit model, thinking and ordinary prompt
  options override the corresponding profile defaults. Nicknames are metadata, not automatic titles. The concise
  catalog shows roles, sources and settings, not full instructions.
  Persist `{name, path, sha256}` plus the resolved configuration and prompt: resume uses the saved version,
  restart re-reads and validates before closing the old child. Async work, tools, settings, caching, steering,
  interrupt and durable recovery stay on RQW-agent; no new engine, parent-history fork or sibling messaging is added.
  No built-in explorer, thoroughness option or explorer role remains.
  Owner (`16-27-59:6039`, entry `95423baf`), one contiguous span:
  «Потом мы переделываем механику саб-агентов, чтобы они работали механически, концептуально как в кодексе, плюс все наши наработки сверху, асинхронность, эта вся хуйня. Я имею в виду, чтобы у нас саб-агенты строились по такому же принципу, как они в кодексе строятся. Чтобы саб-агенты кодекса работали у нас. Но при этом чтобы наши кишки были у этих саб-агентов, передавались им все эти промпты и так далее.»
  Owner (`16-27-59:6057`, entry `ce172fe2`): «1 удаляем эксплорера, ревьюер - саб агент как выше я писал»
  Owner (`16-27-59:6210`, entry `73d8af0f`):
  «Формат профилей делай как в Codex поддерживаемый, что бы саб агенты работали нативно кодексовые»
  «Спроектируй это на согласование мне»
  Approval (`16-27-59:6220`, entry `39b797a8`): «1a 2a» to coordinator proposal `16-27-59:6219`, entry `103b195a`:
  direct Codex-folder reading and `smol-toml` 1.9.1, BSD-3-Clause, no dependencies, over `@iarna/toml` 2.2.5.
  Earlier approval (`16-27-59:6142`, entry `63f95c3a`): «4а 3а 2а» to proposal `16-27-59:6112`, entry `eec15f42`:
  current lifecycle rather than Codex V2 parity, main prompt plus reviewer role, read-only by instruction only.
  These proposal summaries and implementation details are coordinator text, not owner quotations.
  Owner correction to the additions audit (`16-27-59:6431`, entry `fb41d327`):
  «Все 12 удаляем, кроме первого. Первое оставляем». The retained first item is Pi-home and project `.pi`
  sources with Pi-over-Codex precedence.
  All locators name the `16-27-59` session in Provenance. Reason: reuse native Codex role files and one existing
  runtime while preserving Pi behavior. Carriers: `extensions/RQW-agent/profiles.ts`, `index.ts`, `prompt.ts`,
  `extensions/RQW-review/`, `package.json`; contract: [RQW-agent README](extensions/RQW-agent/README.md#codex-profiles).
  Focused proof: `test/extensions/RQW-agent/profiles.test.ts`, `profile-runtime.test.ts`. Since: subagent-profiles.

- **Native prompt files** `[D-AGENT-PROMPT-FILES]`. Agent start/restart accepts `system_file` or `role_file` instead of the corresponding inline prompt; paths resolve relative to the caller's cwd. A regular file supplies exact UTF-8 text, including whitespace and a literal BOM; invalid UTF-8, matching inline/file options, or mixing any system option with any role option is rejected. Restart inherits the prompt choice and re-reads a file before replacing the child, so failed validation leaves the old child intact. Push `details.prompt_file` and wait `details.results[i].display.prompt_file` carry the same `{kind, path, sha256}` for the absolute resolved path and bytes actually loaded. Profile prompt defaults use this same explicit override API (`[D-AGENT-PROFILES]`).
  Owner: «Всё должно быть нативно. Подумай, как можно максимально интеллектуально прокачать этот функционал.» Source: `2026-10-21T16-27-59-062Z_01a15f4a-7ad5-7377-81be-0baf3b6ffa33.jsonl`, USER entry at physical line 3963, requested at 2026-10-23T13:01:47.145Z.
  Reason: native prompt inputs replace manually copied prompt text without losing byte provenance.
  Carrier: `extensions/RQW-agent/index.ts`, `extensions/RQW-agent/prompt-files.ts`, `extensions/RQW-agent/prompt.ts`; proof: `test/extensions/RQW-agent/prompt-files.test.ts`; [file contract](extensions/RQW-agent/README.md#prompt-files-and-caller-messages). Since: `dc4f32e`.
- **Verbatim caller messages** `[D-AGENT-CALLER-MESSAGES]`. Agent start/restart may pass `include: ["user_messages"]` to append a `<user_messages>` block after the task. It contains user-role text from the caller's selected branch, including entries before compaction, in branch order; text parts are joined with newlines, images and non-user messages are omitted. Nested callers contribute their own session messages, not the root session's. Inclusion is not inherited on restart, and restart without task stays idle; the required start task remains the inline `task` field.
  Coordinator text: technical realization of the native-input agreement in `[D-AGENT-PROMPT-FILES]`.
  Reason: forward actual caller messages rather than summaries or retyped quotations.
  Carrier: `extensions/RQW-agent/index.ts`, `extensions/RQW-agent/prompt-files.ts` (`appendUserMessages`); proof: `test/extensions/RQW-agent/prompt-files.test.ts`. Since: `dc4f32e`.
- **Automatic child progress notifications** `[D-AGENT-PROGRESS]`. A step is one non-final assistant response containing one or more tool calls, not an individual tool execution. After 50 such responses without communication, deterministic code starts one background one-shot summary of the child's own context. Parent `send` and a delivered report reset the count; `status` and `wait` do not. The child never waits for the summary and receives no report prompt, skill or session entry. The summary uses an isolated cache fork, with the same model, effort and prompt/tool prefix; Codex owns a separate transport and ledger, never the child's controller or socket continuation. No tools execute in the fork. Cache affinity is preserved where supported, not a promise of a server cache hit.
  The direct parent receives a notification through the existing notification delivery mechanism, not a subagent answer or final result. Fixed short wording asks it to check for work outside the assigned task and whether the child still follows the plan in its brief; the parent alone decides whether to send a correction. The notification triggers the supplied skill's reminder of the workflow-manifest principles. Counter, trigger, cancellation, staleness and delivery are code, not model judgments; only the summary prose is generated. Obvious lifecycle, communication, compaction/model, persistence/resume, concurrent/nested and inference-failure intersections are covered by focused tests. No automatic child interrupt, retry or new child execution limit is added.
  Owner, session `2026-10-21T16-27-59-062Z_01a15f4a-7ad5-7377-81be-0baf3b6ffa33.jsonl`, USER entry `a15f7172`, physical line 6895:
  «Под шагом я имею в виду каждый раз, когда агент шлёт запрос с вызовом tool call.»
  «Факт загрузки отчёта не регистрируется в чате ребёнка. Это просто как fork на кэше.»
  «Родитель должен получать сообщение как notification от notification tool.»
  «Родитель это читает и сам решает, надо ли ему как-то коммуницировать с ребёнком или нет.»
  «Давай 50 шлемов сделаем»
  Skill source: USER entry `635e9341`, physical line 6877: «Можно сделать какой-то скилл для этого, чтобы этот отчёт триггерил скилл, а этот скилл напоминал агенту, что мы работаем по принципам из моего workflow-манифеста.»
  Engineering source: USER entry `b3bc9466`, physical line 6900: «Главное, чтобы это всё работало максимально инженерно: не на токенах, а на инженерии стопроцентной.» «Соответственно, надо будет предусмотреть все очевидные corner case и сценарии пересечений.»
  Notification wording source: USER entry `985e611a`, physical line 6907: «сообщение notification для основного агента должно быть сформулировано таким образом, чтобы основной агент задумался: а не начал ли заниматься какой-то хуйнёй саб-агент? Точно ли он соответствует, но всё ещё движется плану, который ему передали вот»
  Reason: let the parent spot task drift during long work without pausing the child, polling it or asking it to spend a working turn writing a report. Ready-made progress/heartbeat packages did not establish the required cache-fork isolation, so the owner authorized this addition to the existing runtime.
  Carriers: `extensions/RQW-agent/`, `extensions/RQW-codex/`, `extensions/RQW-anthropic/` and their mirrored `test/extensions/` tests; [runtime contract](extensions/RQW-agent/README.md). This completes the progress-report part of TIMEBOX-PRACTICES, not its remaining professional-practices research.

- **Native supervision** `[D-AGENT-SUPERVISION]`. The `agent` tool supports native wait/status options and optional `alert_after_ms` on start/restart; prompt-file and caller-message options remain agent configuration. Status alerts are `{kind, at, detail}`: `error`, `repetition`, `long_turn` and `schema_rejection_repeated`; the latest 32 are presentation history, not an execution limit. The optional positive finite safe-integer threshold is disabled by default and inherited on restart; it reports a long native turn without stopping it, and turn end, logical run end and close cancel the timer, leaving none while idle. Repetition is diagnostic suspicion; schema alerts require a second matching detectable Pi argument-parsing/schema rejection. This F1/F3 work adds no F5 guard or sandbox, `stalled_tool` alert, F2 run manifest or F4 structured-output feature.
  Coordinator text: technical realization of the native-supervision agreement in `[D-AGENT-PROMPT-FILES]`.
  Reason: make supervision caller-controlled without polling wrappers or automatic cancellation.
  Carrier: `extensions/RQW-agent/index.ts`, `extensions/RQW-agent/activity.ts`, `extensions/RQW-agent/coordinator.ts` and descriptions; proof: `test/extensions/RQW-agent/supervision-activity.test.ts`, `test/extensions/RQW-agent/supervision-coordinator.test.ts`, `test/extensions/RQW-agent/supervision.test.ts`; [supervision contract](extensions/RQW-agent/README.md#wait-status-and-management). Since: `dc4f32e`.

- **Caller-chosen wait and status** `[D-AGENT-WAIT]`. The `agent` tool provides caller-local mechanical wait/status for direct-child IDs; `timeout_ms` defaults to 300000 only when omitted, and expiry never cancels a child. `until: "first"` is the default; `"all"` holds early completions until every selected target has a result, receipt or inactive state, releasing held results to the message path on alert, timeout or caller abort. `wake_on_alert` defaults to true and wakes only for alerts created on selected children after wait registration, without consuming a result. Status uses `messages` 5-10, default 8; `depth` defaults to 0, with positive safe-integer depth adding compact read-only descendant snapshots without message previews or descendant management. Waiting makes no caller model turns; results still arrive exactly once through wait or messages with receipts for delivery races. No execution, turn, token, output-growth, child-count or automatic-management limits are added; Pi provider timeouts and retries still apply.
  Owner: «Если они работают долго, пусть работают.» Source: `2026-10-21T16-27-59-062Z_01a15f4a-7ad5-7377-81be-0baf3b6ffa33.jsonl`, USER entry at line 1849.
  Reason: the caller decides how to manage work, not a watchdog.
  Carrier: `extensions/RQW-agent/index.ts`, `extensions/RQW-agent/coordinator.ts`, `extensions/RQW-agent/activity.ts`; details: [RQW-agent README](extensions/RQW-agent/README.md#wait-status-and-management). Since: `fe0e375`; all-target waits, alert wakes and descendant status since `dc4f32e`.
- **Child cache policy** `[D-AGENT-CACHE]`. Every child has in-memory `cacheWarming: "off"`, independent of RQW-settings and the user's warming mode. Prompt caching stays on; the guarded stream wrapper sets `cacheRetention: "short"` for Anthropic Messages before OAuth fallback, giving built-in five-minute retention without a new config knob. Other APIs retain their options.
  Owner: «Потому что если мы вообще выключим им кэш, то они будут пиздец жрать токенов нахуй.» Source: the same session, USER entry at line 440.
  Reason: disable background requests without sacrificing ordinary prompt-cache reuse.
  Carrier: `extensions/RQW-agent/index.ts`, `test/extensions/RQW-agent/agent.test.ts`, `test/prompt-cache.test.ts`; evidence: `notes/prompt-cache-policy.md`. Since: `b91f832`.
- **Subagent parity** `[D-AGENT-PARITY]`. General subagents use the main run's built prompt from public `ctx.getSystemPrompt()`, followed by a short subagent reminder and optional `role`; nested subagents receive the main prompt handed down, not their parent's role. Optional `system` or `system_file` replaces that whole prompt exactly; file alternatives and validation are defined in `[D-AGENT-PROMPT-FILES]`. Every subagent, including a selected profile, gets `agent` recursively with no depth or concurrency limit. Repository coordinator rules are not product policy, and the reminder excludes instructions addressed to the main agent or coordinator.
  Owner: «Надо что бы саб агенты были как в куросре посмотри реверз инжинеринг и скажи свои предложения» Source: the same session, USER entry at line 2608.
  Reason: share main's rules and context while allowing short role configuration and independent decomposition.
  Carrier: `extensions/RQW-agent/index.ts`, `extensions/RQW-agent/prompt.ts`, `test/extensions/RQW-agent/agent.test.ts`; details: [RQW-agent README](extensions/RQW-agent/README.md#prompt-and-title). Since: `c86e9bb`.
- **Child settings** `[D-AGENT-CHILD-SETTINGS]`. Children inherit session shell, image handling, retries, provider and transport timeouts, compaction, thinking budgets, queue modes and codemode settings, except warming stays off. Stock tools use the child's copied shell/image settings; offered RQW-tools read the caller's effective settings per call. Children get built-in codemode/tool_search when active for their caller; nested callers select the same profile catalog through `agent_type`. Reviewer profiles inherit the ordinary child settings, including queue modes. Parent-history fork, web search and MCP for children are deferred in [BACKLOG](BACKLOG.md), not present features; durable resume is delivered (`[D-AGENT-PERSIST]`).
  Coordinator text: technical realization of the parity agreement.
  Reason: children must not silently lose relevant caller capabilities.
  Carrier: `extensions/RQW-agent/index.ts` (`childSettings`), `extensions/RQW-agent/prompt.ts`; `test/extensions/RQW-agent/agent.test.ts`. Since: `c86e9bb`.
- **Child titles** `[D-AGENT-TITLE]`. Optional `title` on start/restart appears in status,
  `results[i].display.title` and message `details.title`; delivered text keeps its `[agent#N]` form.
  Card rendering is `RQW-agent-ui`, see [Agent cards](#agent-cards).
  Coordinator text: title metadata retains its original purpose on the common profile runtime.
  Reason: readable child identity without changing caller-local lifecycle IDs.
  Carrier: `extensions/RQW-agent/index.ts`. Since: subagent-profiles.

- **API and in-process runtime** `[D-AGENT-API]`. One `agent` tool offers `start`, `wait`, `status`, `send`, `resume`, `interrupt`, `stop`, `restart`; fields are `id`, `ids`, `timeout_ms`, `messages`, `until`, `wake_on_alert`, `depth`, `alert_after_ms`, `system`, `role`, `system_file`, `role_file`, `include`, `title`, `agent_type`, `task`, `model`, `thinking`, `tools`, `fast_gpt`, `interrupt`. Optional null fields mean omitted; start/send require task, not system. Defaults are the caller's model and thinking and all six base tools, plus recursive `agent` delegation for every child. Profile selection and defaults are defined in `[D-AGENT-PROFILES]`. Sessions run in-process at caller cwd with in-memory settings; the history is in memory for an in-memory caller and in the owned `<parent.jsonl>.children/` tree for a persisted one (`[D-AGENT-PERSIST]`), using `createAgentSession` and the caller's `ctx.modelRegistry.runtime` for credentials, OAuth and extension providers. Resources, context files, skills and external extensions are not independently loaded; the inherited prompt carries main's text. An inline forced `before_agent_start` prompt prevents Pi from appending cwd or other sections again.
  Coordinator text. Reason: reuse Pi sessions and the caller's provider runtime without subprocesses or duplicate resource loading.
  Carrier: `extensions/RQW-agent/index.ts`, `test/extensions/RQW-agent/agent.test.ts`. Since: `7a9f505`; inherited defaults since `c86e9bb`; `resume` since `dd93a40`; explicit held-wait option removed by `[D-TOOLS-NO-BLOCKING-FLAG]`. Earlier wording: [DECISIONS-ARCHIVE.md](DECISIONS-ARCHIVE.md), A-0265.
- **Optional RQW-tools offer** `[D-AGENT-TOOLS-OFFER]`. At start/restart RQW-agent emits `rqw-tools:subagent-tools` with `{ offer(factory) }` on the shared synchronous `pi.events` bus; loaded RQW-tools answers with fresh definitions and a child-local barrier/job registry, otherwise stock tools are used. The consumer type is `(cwd: string, settings: () => unknown, nested?: undefined, options?: { label?: string; codemode?: ToolDefinition }) => ToolDefinition[]`; the provider's exact function is `createTools(cwd: string, settings: () => any, nested = createNestedBarrier(), options: JobsOptions & { jobs?: Jobs; codemode?: ToolDefinition<any, any, any> } = {}): ToolDefinition[]`. The factory provides seven tools, six base tools plus job, and optionally a grouped child codemode; the consumer filters the base subset but retains job and offered codemode. Child codemode shares process-wide Pi worker slots. No cross-extension import or mandatory dependency is added; reload/dispose invalidates stale handlers.
  Coordinator text. Reason: children follow the RQW-tools switch while retaining their own ordering and job ownership.
  Carrier: `extensions/RQW-agent/index.ts` (`ToolsFactory`, `offeredTools`), `extensions/RQW-tools/index.ts` (`createTools`), `test/agent-tools.test.ts`. Pi 1.4.0 event API: `docs/extensions.md:186`, `dist/core/extensions/types.d.ts:1406`; invalidation: `dist/core/extensions/loader.js:144-152`, `dist/core/agent-session.js:1022,3002`; stock tool settings: `dist/core/agent-session.js:2964-2974`. Since: `90700ad`.
- **Result delivery and identity** `[D-AGENT-DELIVERY]`. Every final answer and final error of a run is delivered in order to its direct caller, once; intermediate runs awaiting children and attempts Pi retries are not final results. `auto_retry_start` and `compaction_end` with `willRetry: true` remove only the retried message's contribution, preserving earlier answers. Invalid IDs/models, missing credentials or required task fail immediately, using auth snapshot then `runtime.checkAuth`. Idle callers are woken; busy callers retain results outside abort-cleared queues, and settle races produce one continuation seeing all held results. Abort preserves delivered text without starting another turn; manual-compaction arrivals are seen on the next turn. Delivery uses UUIDs, and `agent#N` counters recover the session's maximum across reload/resume/fork/continuation.
  Coordinator text. Reason: retries, cancellation and session continuation must neither lose nor duplicate results.
  Carrier: `extensions/RQW-agent/index.ts`, `extensions/RQW-agent/coordinator.ts`, `test/extensions/RQW-agent/agent.test.ts`; [historical proof](notes/decisions-evidence.md#agent-proof). Since: `7a9f505`.
- **Steering and interrupting sends** `[D-AGENT-SEND]`. Sending to a running child uses `session.steer`, arriving after the current assistant turn's tool calls and before the next request without abort; an idle child starts a new run with history. `send` with `interrupt: true` clears queued steering/follow-ups, aborts the run and records one next task that starts when cancellation settles; later sends join in order. An uncooperative tool can delay that start, shown as `pending_sends`; wait remains running and reports `target_changed` when the run changes. Plain send during cancellation is rejected unless an interrupting send is already pending. `interrupt` retains history without a result message; stop forgets the session; restart creates a fresh session with retained or explicitly replaced configuration. Interrupt/stop/restart discard pending tasks and cascade cancellation to descendants.
  Coordinator text: the steering proposal was accepted by the owner; the quoted proposal is not an owner quotation.
  Reason: follow-ups should steer promptly without forcing cancellation, while redirection remains explicit.
  Carrier: `extensions/RQW-agent/index.ts` (`requestInterrupt`, `Agent.next`), `test/extensions/RQW-agent/steer.test.ts`. Since: `029160d`.
- **Ordered management and shutdown** `[D-AGENT-MANAGEMENT]`. Agent management calls register in call order; wait releases that queue after subscription. Start, idle send and restart with task return once prompt preflight starts the run or `compaction_start` makes cancellation effective. Closing clears queues, calls abort and only then disposes, preventing requests after stop or shutdown. External print/json hosts use a caller-wide non-consuming fallback wait in `agent_end`, bounded by the default `timeout_ms` and subordinate to explicit waits. A native-idle child waits for its active subagents by their completion events with no implicit timeout, and only when no run is active does it use the bounded wait. TUI/RPC retain push wakeups. `session_shutdown` closes all descendants without result messages.
  Coordinator text. Reason: parallel tool batches, pre-run compaction and disposal must not leave unowned requests.
  Carrier: `extensions/RQW-agent/index.ts`, `extensions/RQW-agent/coordinator.ts`, `test/extensions/RQW-agent/agent.test.ts`; [historical proof](notes/decisions-evidence.md#agent-proof). Since: `fe0e375`.
- **Accepted limits** `[D-AGENT-LIMITS]`. Results arriving after the caller session ended are lost; a persisted child keeps its history and the same id after a restart, but a running operating-system process, tool call or provider request is not restored, and a power loss can lose unflushed history (no fsync). Children share the TUI process and may read files the main agent is editing; in-process cancellation cannot forcibly end an uncooperative tool. The process-wide [Context](#context) rule applies while an RQW-context owner exists. GPT Fast inheritance and overrides are defined once under [Settings](#settings).
  Coordinator text. Reason: these are boundaries of the in-process session design, not unimplemented promises.
  Carrier: `extensions/RQW-agent/index.ts`; details: [RQW-agent README](extensions/RQW-agent/README.md#wait-status-and-management). Since: `7a9f505`; restart persistence since `dd93a40`. Earlier wording: [DECISIONS-ARCHIVE.md](DECISIONS-ARCHIVE.md), A-0266.

- **Durable children and resume** `[D-AGENT-PERSIST]`. Owner quotes: `[D-PIPELINE-PAUSE-RESUME]`
  (`16-27-59:5087`, `5092`, `5103`). Taken by default (coordinator text, not an owner quote): a persisted caller stores each child's
  Pi JSONL in the adjacent `<parent.jsonl>.children/agent-N/`, nested children recursively; the parent
  branch carries versioned `rqw-agent-child` entries (id, generation, file, state, configuration, model, tools, thinking,
  Fast, title) and `rqw-agent-tool-intent` entries written through the public `tool_call` hook. Stop tombstones a mapping and
  restart creates a new history. `resume` builds a fresh `AgentSession` from the saved history and calls the public
  `agent.continue()` with no new message, under its own busy, abort and settlement fences; the cut-off assistant attempt is
  hidden by append-only context edits, and a tool call without a result gets an explicit interrupted/error result, never a
  replay. No post-run automatic retry is promised for a resumed run. Continuing a restored parent recovers its loaded,
  unfinished children; `/resume-agents` resumes the children only and their result wakes the main chat; merely opening an old
  session starts nothing, and children paused by hand are not restarted by the parent's continuation. Taken by default to protect
  the 2-hour pause, not an owner quote. A fork or clone copies the parent transcript but not its child files and takes none
  over: such a child is unavailable with a diagnostic, without blocking new starts, the main chat or other children.
  Recovery is fail-closed, taken by default as the safe choice (coordinator text, not an owner quote): a missing or empty child
  JSONL of an established or unknown history is a `recovery_error` of that child alone; a saved state of idle, run number 0 and no
  task (a task-less restart) may restore an empty session under the same id, with no task message; the saved task and configuration are provenance, never re-executed, and no
  history is rebuilt or inferred, so a start with a saved task whose history Pi had not flushed before a full Pi restart is not recoverable. Children
  created by the earlier in-memory build cannot be recovered retroactively; only children created after the updated extension
  loads are durable.
  Chosen over a global registry or a handoff file: the adjacent tree needs no shared state and lets RQW-session recognize it by name.
  Reason: the owner wants an agent resumed by its id after a Pi restart with its full history.
  Carrier: `extensions/RQW-agent/persistence.ts`, `index.ts`, `coordinator.ts`; contract: [RQW-agent README](extensions/RQW-agent/README.md#persistence-and-resume);
  proof: `test/extensions/RQW-agent/persistence.test.ts`, `resume.test.ts`. Since: `dd93a40`.

- **Explicit retry after a child request fails** `[D-AGENT-RESUME-ERROR]`. Owner: «Надо, чтобы ты мог самостоятельно агента, допустим, упавшего заретраить, если вдруг он по какой-то причине из-за сети или ещё из-за чего-то упадёт.»
  Source: session `2026-10-21T16-27-59-062Z_01a15f4a-7ad5-7377-81be-0baf3b6ffa33.jsonl`, line 6929, user entry `4dfc1788`.
  The caller can explicitly use `agent` action `resume` after the child's last network/provider request fails.
  It retries from the saved child history without a new task message, also after a Pi restart. No automatic retry loop is added;
  successful completion, active runs and cancellation-pending runs do not become resumable. `/resume-agents` and parent
  continuation keep their existing behavior and do not retry failed requests.
  Reason: the caller can recover a failed child without rebuilding its task or sending another message.
  Carrier: `extensions/RQW-agent/index.ts`; proof: `test/extensions/RQW-agent/resume.test.ts`;
  contract: [RQW-agent README](extensions/RQW-agent/README.md#persistence-and-resume).

- **Notification waits for children** `[D-AGENT-NOTIFY]`. Owner quotes: `[D-TOOLS-NOTIFY]` (`16-27-59:4876`, `16-27-59:4937`). Taken by default (coordinator text, not an owner quote): where the caller can
  receive notifications, `wait` on `agent` returns a `waiting` receipt at once with
  `terminate: true` and the result later wakes the caller once through the existing delivery broker.
  There is no explicit held-wait option (`[D-TOOLS-NO-BLOCKING-FLAG]`). A wait inside a codemode script stays blocking,
  as does an external root print/json host and any caller without a `notify` callback (an in-process child agent with the bridge
  is not affected by its SDK mode). A timeout or alert
  is one notification, not periodic polling, and no model request is made merely to wait. Owner messages reach the agent
  without cancelling accepted children. Same callback as `[D-TOOLS-NOTIFY]`. Reason: a waiting agent must not hold a call.
  Carrier: `extensions/RQW-agent/index.ts`, `coordinator.ts`, `descriptions/*.md`. Since: the final squash of branch `agent-async`.

## Review

- **Requirements-based test review** `[D-REVIEW-TEST-REQUIREMENTS]`. Owner R11 source: session
  `2026-10-21T16-27-59-062Z_01a15f4a-7ad5-7377-81be-0baf3b6ffa33.jsonl`, USER `3d0e39ae`, line 1568:
  «Мне надо, чтобы в этой ситуации reviewer закрывал такие моменты, что код проверок соответствует требованиям, соответствует тест-плану, acceptance критериям.»
  USER `f5193077`, line 1602: «Нет, я думаю, что в автотестах тесты сами не надо запускать, когда он review делает.»
  and «Я могу достать переписку. Я смогу достать код, но я не смогу достать коммит до и коммит после, скорее всего. Я хз.»
  USER `96dc3500`, line 1606: «Просто не надо запускать сами тесты, блядь.»
  The owner explicitly resumed R11 in the 2026-10-25 execution request; its earlier hold is no longer active.
  Decision: the optional `testreview` native skill collects supplied requirements, test plan, acceptance criteria
  and conversation references and starts the ordinary `requirements-test-reviewer` profile on Sol 6.1 low.
  It reads test code and directly relevant exercised code, checks requirement coverage and concrete false confidence,
  and reports missing primary evidence as incomplete. External transcripts include user and assistant turns;
  `include: ["user_messages"]` separately appends the caller's raw user messages. No test/code execution, mandatory
  commit pairs, new runtime, permissions or automatic review. The existing project `test-reviewer` and its mechanical
  integrity gate remain unchanged. Reason: test code is itself the deliverable, so repository check execution does
  not establish whether its assertions implement the agreed plan.
  Carriers: `extensions/RQW-review/profiles/requirements-test-reviewer.toml`,
  `extensions/RQW-review/skills/testreview/SKILL.md`, `extensions/RQW-review/index.ts`.

- **Codex reviewer port** `[D-REVIEW-PORT]`. `RQW-review` carries the owner's working Codex CLI reviewer over to Pi, adapted
  to this harness. The base is his existing cycle, not a newly invented workflow: the original Codex reviewer profiles
  (`agents/*.toml`) and the Main-side skills `subagents`, `blindreview` and `highreview` of his Codex CLI plugin
  `scope-focus`, whose `.codex-plugin/plugin.json` names the developer `A. Chukavin` and supplies no licence text or other
  attribution. The earlier reviewer flow, its dispute rules and its benchmark campaign are cancelled; their entries are
  in [DECISIONS-ARCHIVE.md](DECISIONS-ARCHIVE.md) (A-0248 to A-0256). Reviewer profiles use the ordinary RQW-agent tools and shared lifecycle.
  Owner (`16-27-59:5195`, `16-27-59:5210`, `16-27-59:5286`, `16-27-59:5291`):
  «этот малой на Sol 6.1 Low очень хорошо защищает агента от ошибок»
  «Мы отменяем текущий flow работы над reviewer и переобуваемся в новый прекрасный flow.»
  «давай мы пойдём от того, что мы возьмём текущего ревьюера, рабочего уже, пиздатого, и его немножко прокачаем, подтюним, оптимизируем. Не будем смотреть на старого ревьюера.»
  «Надо его перенести, адаптировав к нашему harness, потому что у них свой harness, у нас свой harness. Надо адаптацию сделать полную, чтобы по смыслу работало так же»
  Reason: the Codex reviewer already works in practice, and the old reviewer missed errors. Carriers: `extensions/RQW-review/profiles/*.toml`, `extensions/RQW-review/skills/**/SKILL.md`,
  `extensions/RQW-review/index.ts`, [RQW-review README](extensions/RQW-review/README.md), [PROCESS.md, Independent review](PROCESS.md#independent-review).
  The whole-cycle comparison with the original plugin is discarded by the owner, not queued: [BACKLOG.md](BACKLOG.md#codex-reviewer-comparison).
- **Reviewer prompt** `[D-REVIEW-PROMPT]`. `extensions/RQW-review/profiles/spotty.toml` and `bossy.toml` embed identical
  `developer_instructions`. The main system prompt and subagent reminder precede that role, as approved in
  `[D-AGENT-PROFILES]`; it is no longer a whole-system override.
  Three changes, all harness differences: 1. the allowed tools are the `read`, `grep` and `find` tools and read-only
  `bash` commands (Codex: "read-only inspection tools and commands"); 2. one sentence names the sections of the brief
  supplied by the task and agent caller-message inclusion, `<user_messages>`, `<agreement>`, `<object>`, `<criterion>` and `<rejected_earlier>`; 3. the note
  that ends a truncated `read` result, such as `Use offset=N to continue`, is not file content (Codex: "the reader's
  continuation line"). Codex `fork_turns` has no counterpart: every pass is a fresh session from zero
  (`[D-REVIEW-PROFILES]`). The prompt has no rule about running tests, for or against, and no measured claim of quality is made.
  Owner (`16-27-59:5210`, `16-27-59:5219`):
  «reviewer должен делать полное review и находить все расхождения, а не по одному.»
  «Reviewer должен находить всё говно и сразу выгребать его, чтобы main сразу всё почистил, чтобы это всё было быстро и производительно.»
  «Я бы хотел его минимально улучшить, минимально усилить и без замеров просто использовать его.»
  «Его промпт вообще никак не подвигает его к запуску тестов изначально. То, что ты придумал про запрет запуска тестов — это overengineering очевидный»
  Reason: the owner's reviewer works as written; the three changes only fit it to this harness.
  Carriers: `extensions/RQW-review/profiles/spotty.toml`, `bossy.toml`; the shared runtime appends their role
  without changing its text. No new review methodology or measured quality claim is introduced. Since: subagent-profiles.
- **Reviewers are ordinary profiles** `[D-REVIEW-PROFILES]`. `RQW-review` is a small resource provider, not a tool
  or runtime. `profiles/spotty.toml` defaults to bare `gpt-6.1-sol` with `model_reasoning_effort = "low"`;
  `profiles/bossy.toml` defaults to the same model with `"medium"`. RQW-agent resolves them to `openai-codex/gpt-6.1-sol`
  without provider fallback and appends their identical role to the main prompt and reminder.
  The extension offers both absolute paths on `rqw-agent:profiles` and returns `skills/reviewer`, `skills/blindreview`
  and `skills/highreview` through public `resources_discover`, not static `pi.skills`. The common skill is only the
  review section of the owner's `skills/subagents/SKILL.md`; wrappers select Spotty or Bossy.
  Every pass starts a fresh ordinary `agent` with `agent_type` and `include: ["user_messages"]`. Read-only is
  instruction only: no separate tool filter, git-state guard or sandbox. There is no separate reviewer runner,
  verdict delivery, Fast/cache implementation, review count producer or child-review offer. A verdict is an ordinary
  `agent#N` result, counted and rendered as an agent; lifecycle, tools, settings, cancellation, credentials, Fast,
  caching, persistence and exactly-once delivery are RQW-agent's existing contracts.
  Disabling RQW-review removes its offered profiles and skills, not user-owned profile files. Without RQW-agent
  there is no reviewer execution or fallback route. The common skill reports missing runtime/profile resources.
  Owner rename (`16-27-59:6489`, entry `96fcf727`), coordinator summary: the blind profile is Spotty (`spotty`);
  the high profile keeps its name.
  Owner approval and exact messages: `[D-AGENT-PROFILES]`. The Claude reviewer measurement is discarded by the
  owner, not scheduled (`16-27-59:6149`, entry `348f1995`); see [BACKLOG.md, Discarded](BACKLOG.md#claude-reviewer).
  Source of the existing reviewer text and skills, read-only external archive:
  `/Users/arkadijcukavin/Downloads/codex-subagents-full-pack (1).zip`.
  Reason: one profile mechanism rather than a parallel reviewer execution stack.
  Carriers: `extensions/RQW-review/index.ts`, `profiles/*.toml`, `skills/**/SKILL.md`, RQW-agent.
  Contract: [RQW-review README](extensions/RQW-review/README.md), [PROCESS.md](PROCESS.md#independent-review).
  Since: subagent-profiles.
- **Review cycle on Main's side** `[D-REVIEW-CYCLE]`. Carried over from the skill `subagents` of the Codex plugin; it
  lives in the native `reviewer` skill and its `blindreview` and `highreview` wrappers, so disabling RQW-review
  removes these discovered skills, and in
  [PROCESS.md, Independent review](PROCESS.md#independent-review).
  - When: the review runs only when the owner asks for a review or a checked result, or a procedure he approved requires
    it, such as the squash-merge rule of PROCESS; never on Main's own initiative or as an automatic step of other work.
    `blindreview` with `agent_type: "spotty"` unless the owner or that procedure asks for `highreview` with
    `agent_type: "bossy"`. Main keeps working meanwhile but leaves the reviewed files unchanged until the verdict.
  - Brief construction: [PROCESS.md, Independent review](PROCESS.md#independent-review) is the canonical
    development rule; the native [reviewer skill](extensions/RQW-review/skills/reviewer/SKILL.md) carries it at runtime.
    The replaced brief text is preserved verbatim in DECISIONS-ARCHIVE.md, A-0323.
  - `CLEAN` with complete `CHECKED:` and no `UNCHECKED:` passes: no extra pass for confidence, but every independent pass
    and its order that the invoking procedure requires stays.
  - `FINDINGS:` are the teammate's findings. Main finds each quote by searching for it. A finding whose two quotes stand
    verbatim in their sources is admitted; for an omission Main verifies the quoted requirement and the complete
    inspected file or section instead of demanding nonexistent text. Main fixes an admitted finding exactly to its
    REQUIRED OUTCOME and no further, and does not reject it, argue with it or put it to the owner. Main rejects a finding
    only when a quote is not verbatim, the allegedly missing content is present in the cited object, or a NOT AGREED
    element is covered by a verbatim quote of the agreement, and gives that reason with the quote.
  - All admitted fixes go in one batch. Then a fresh reviewer runs with the same level, object and criterion and every
    rejection so far in `rejected_earlier`, until `CLEAN`.
  - `UNCHECKED:` or missing `CHECKED:` evidence makes the check incomplete whatever the leading verdict is: resolve the
    missing sources or evidence, or retry malformed output; never record it as acceptance.
  - No verdict, an error or a reviewer that could not start: the check has not passed and no self-check replaces it.
    Main launches it once more on the unchanged object; if it fails again, Main tells the owner and waits.
  - When this review contract changes, validate it against known defective, corrected and missing-source examples before
    claiming improved detection. These checks are not extra rounds in ordinary task reviews. The tests check mechanics,
    such as a malformed verdict or a missing `CHECKED:`, and make no claim about detection quality.
  Owner (`16-27-59:5210`): «Reviewer должен находить всё говно и сразу выгребать его, чтобы main сразу всё почистил, чтобы это всё было быстро и производительно.»
  Reason: one complete pass, one batch of fixes and a fresh pass is the cycle the owner's reviewer already runs.
  Carriers: `extensions/RQW-review/skills/reviewer/SKILL.md`, `blindreview/SKILL.md`, `highreview/SKILL.md`,
  [PROCESS.md, Independent review](PROCESS.md#independent-review). Since: the reviewer port; invocation updated by subagent-profiles.

- **Verdict format** `[D-REVIEW-VERDICT]`. The reviewer's last message is `CLEAN` followed by `CHECKED:`, or `FINDINGS:` with
  numbered `FINDING n` blocks (REQUIREMENT, MISMATCH, EVIDENCE, REQUIRED OUTCOME, each once) followed by `CHECKED:` and
  `UNCHECKED:` sections when they apply; both reviewer profiles carry the exact format. The common skill treats
  `CLEAN` with complete `CHECKED:` and no `UNCHECKED:` as acceptance. Missing evidence, malformed output or any
  `UNCHECKED:` is incomplete; a failed run is no acceptance. The text
  stays as the reviewer wrote it, a preamble included. Structure cannot prove coverage: Main still assesses every required
  obligation against `CHECKED:`. The result is delivered through the ordinary `agent#N` lifecycle.
  Carriers: `extensions/RQW-review/profiles/*.toml`, `skills/reviewer/SKILL.md`, RQW-agent. Since: subagent-profiles.

## PCLI

- **Separate VS Code extension** `[D-PCLI-EXT]`. `pcli-vscode/` is the VS Code extension `arqawa.pcli` ("ARQAWA PCLI",
  win32-x64) that starts Pi like CCLI starts Codex. It is outside `extensions/`, has no `RQW-` prefix and is not in
  `pi.extensions`. Coordinator text (owner quote not found in the Pi sessions): "надо сделать extension, как Arkava CLI, такой же, только PCLI... учитывая все требования, все ограничения". Carrier: `pcli-vscode/package.json`, `AGENTS.md`.
  Since: `3b6d6c1`.
- **Inside VS Code only** `[D-PCLI-VDI]`. Everything runs inside VS Code as a subprocess of the extension host.
  Coordinator text (owner quote not found in the Pi sessions): "у нас нет админских прав, у нас нет wsl, и нам нельзя запускать ничего такого прямо на хосте, только внутри vs code, только как extension vs code, как субпроцесс extension VS code. только так". Carrier: `pcli-vscode/extension.js`. Since: `3b6d6c1`.
- **Pinned bundled Pi** `[D-PCLI-PIN]`. Pi 1.4.0 is bundled in the VSIX, with no runtime update. `vscode:prepublish`
  runs `pcli-vscode/fetch-pi.mjs`: it downloads `pi-windows-x64.zip` of release `earendil-works/pi` v1.4.0, checks the
  hard-coded SHA256 `0f7256ea8bdac3af20012b94fdc1252a31cc6dc0d2f9b9eb539555d22e3e321b` and extracts into
  `pcli-vscode/pi/` (git-ignored). A new Pi version needs new VERSION, URL and SHA256 there and a new VSIX; the root npm
  dependency does not change the bundled `pi.exe`. Coordinator text (owner quotes not found in the Pi sessions): "мы не будем автоматически обновлять PCLai. Как есть 1.3 версия, так и есть."; "1 да давай 2 да давай". The pin moved from
  1.3.0 to 1.4.0 with the package upgrade ([Scope](#scope)). Build observations:
  [decisions evidence](notes/decisions-evidence.md#pcli-bundle). Since: `3b6d6c1`.
- **Release binary, not npm** `[D-PCLI-BINARY]`. Pi from npm is a Node program and would run inside `Code.exe` with
  `ELECTRON_RUN_AS_NODE=1`, which leaks into every bash command and depends on VS Code's Node; `pi.exe` carries its own
  runtime, the path omp-vscode already uses on the VDI. Carrier: `pcli-vscode/fetch-pi.mjs`. Since: `3b6d6c1`.
- **Launch chain and proxy** `[D-PCLI-LAUNCH]`. Extension host -> `powershell.exe` -> Git Bash
  (`C:\Program Files\Git\bin\bash.exe --login -i -c`) -> `pi.exe`, terminal through VS Code's own `node-pty`. The proxy
  comes from the `Code.exe` environment and the settings `http.proxy` / `http.proxyStrictSSL` (false sets
  `NODE_TLS_REJECT_UNAUTHORIZED=0`) and is exported in the Git Bash command line, so profile scripts cannot override it;
  the line first unsets `http_proxy`, `https_proxy`, `all_proxy` and `no_proxy`, because Pi prefers lowercase names.
  `~/.pi/agent` is shared and not changed. Carrier: `pcli-vscode/extension.js`. Since: `3b6d6c1`.
- **No version check** `[D-PCLI-NOVERSION]`. The tab sets `PI_SKIP_VERSION_CHECK=1`: the version is pinned.
  Coordinator text (owner quote not found in the Pi sessions): "1 да давай 2 да давай". Carrier:
  `pcli-vscode/extension.js`. Since: `3b6d6c1`.
- **One command** `[D-PCLI-COMMAND]`. One command, `Pi CLI: New Tab`; login is `/login` inside Pi. my-pi is installed
  into that Pi with `INSTALL.md`; the extension does not install it. Carrier: `pcli-vscode/package.json`. Since: `3b6d6c1`.
- **No Marketplace description** `[D-PCLI-NODESC]`. No `description` field in `pcli-vscode/package.json`, no README, no
  LICENSE; `pcli.yml` asserts an empty VSIX description. Coordinator text (owner quote not found in the Pi sessions):
  "При публикации в маркетплейс там НЕ ДОЛЖНО БЫТЬ НИКАКОГО ОПИСАНИЯ". Since: `3b6d6c1`.
- **End-to-end proof** `[D-PCLI-E2E]`. `.github/workflows/pcli.yml` on `windows-latest` builds the VSIX, installs it into
  a real VS Code and runs `pcli-vscode/test/run.mjs` and `test/suite.cjs`: Pi answers through a local proxy
  `test/proxy.cjs` with a fake HTTPS model, with the proxy from the environment under a hostile Git Bash profile and from
  VS Code settings; strict TLS fails and `http.proxyStrictSSL: false` works; CONNECT with proxy credentials; paths with
  Cyrillic, spaces and an apostrophe; no `pi.exe` left after closing tabs, `/quit` or VS Code. Not covered: a real model
  call and the corporate VDI restrictions. Since: `3b6d6c1`.
- **Wheel scroll cause** `[D-PCLI-MOUSE-CAUSE]`. In PCLI the wheel scrolled the input history instead of the
  conversation. Cause in Pi 1.4.0: `TuiAltScreen.beforeTerminalStart` writes `?1049h` and the mouse enable
  `?1000h ?1002h ?1003h ?1004h ?1006h` (without `?1003h` under tmux, Zellij or screen) before `terminal.start` enables raw
  mode and Windows VT input; ConPTY loses that early write, so VS Code never learns the app wants the mouse and the wheel
  becomes arrow keys. The same start path runs after the external editor, a TUI mode switch and suspend/resume.
  Owner: «Еще знаешь, какая проблема? У нас есть наш PCLI для Windows VDI тачки. Там такая проблема, что не работает скроллинг. Когда я пытаюсь скроллить в терминале, у меня прокручиваются последние сообщения вместо того, чтобы скроллился чат. А когда я запустил коды в CLI своим extension, там скролл нормально работает. Посмотри эту проблему, пожалуйста.» (session `2026-10-21T12-13-54-289Z_01a15e61`, line 158)
  Source lines and upstream history: [decisions evidence](notes/decisions-evidence.md#pcli-mouse-sources). Since: `8f6251a`.
- **Wheel fix** `[D-PCLI-MOUSE-FIX]`. A my-pi extension that matters only where my-pi is installed in PCLI's Pi
  ("myIP" is the speech-to-text spelling of my-pi). Engineering choice: only on Windows and only in fullscreen, enable
  the mouse again after the terminal started and after every TUI restart, with exactly Pi's set (multiplexer variant
  included), keeping Pi's disable on stop. On `process.platform === "win32"` the factory wraps
  `TuiAltScreen.prototype.afterTerminalStart`, stock Pi's empty hook, and after it writes Pi's set when `mouseEnabled`.
  Pi's early write and `?1049h` stay; regular mode (`TuiMainScreen`) and print, JSON and RPC never use the class. The
  patch is process-wide: each factory run adds an owner token to the `Set` under `Symbol.for("rqw-mouse/state")`, its
  `session_shutdown` removes only that token, and the last owner leaves the prototype as Pi made it. `/reload`, `/new`
  and `/resume` renew it; switching the extension off and reloading removes it.
  Owner: «Теперь по нестабильному тесту 1А: myIP на VDI, исправление прокрутки делаю расширением myIP. Да, насчёт myIP в VDI: это только если myIP установлен. Если он не установлен, то поебать вообще.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 591)
  Carrier: `extensions/RQW-mouse/index.ts`, its own `pi.extensions` entry ([Isolation](#isolation)). Since: `8f6251a`.
- **Wheel fix limits** `[D-PCLI-MOUSE-LIMITS]`. It acts when Pi's terminal starts, so Pi must be restarted after
  installing or updating my-pi; `/reload` does not restart the TUI. my-pi must be installed in the Pi that PCLI runs
  (`INSTALL.md`). It brings the mouse commands to VS Code; the VDI's own wheel handling is not verified. The extension
  throws a load error when `TuiAltScreen.beforeTerminalStart` or the base `afterTerminalStart` hook is missing.
  Since: `8f6251a`.
- **Wheel fix proof** `[D-PCLI-MOUSE-PROOF]`. `test/extensions/RQW-mouse/mouse.test.ts` (in `npm test`, macOS and Windows
  CI): Pi's real `TuiAltScreen` on a recording terminal, Windows simulated through `process.platform` elsewhere; the
  write right after `terminal.start` equals Pi's earlier set for each multiplexer variant and repeats after every restart;
  Pi's disable runs on every stop; nothing is added with the mouse off, in regular mode or on non-Windows platforms;
  owner counting, `/reload`, a hook Pi defines on the class and a foreign wrapper; loading through Pi's resource loader
  with the same `TuiAltScreen` class. Capture: job `mouse` of `.github/workflows/pcli.yml` (`workflow_dispatch` or a
  push to branch `pcli`) runs `pcli-vscode/test/mouse.mjs` and `test/mouse-suite.cjs` in a real VS Code, starting the
  PCLI chain stock and with `-e extensions/RQW-mouse/index.ts`; expected `?1000h` count 0 stock and 1 with the extension.
  Measured run: [decisions evidence](notes/decisions-evidence.md#pcli-mouse-capture). Since: `8f6251a`.
- **Publishing** `[D-PCLI-PUBLISH]`. Skill `publish-pcli` (`.agents/skills/publish-pcli/SKILL.md`): `vsce publish
  --target win32-x64` from `pcli-vscode/` under publisher `arqawa`, `version` raised before each publish, only on a direct
  owner request. Since: `3b6d6c1`.

- **English UI text** `[D-PCLI-ENGLISH]`. PCLI user-visible text is English. The four messages in
  `pcli-vscode/extension.js` are `[pi exited, code N]`, `node-pty not found in VS Code: ...`,
  `Not found: <path>. Install Git for Windows.` and `Not found: <path>`. Russian code comments and Cyrillic
  test paths in `pcli-vscode/test/run.mjs` are not user-visible and stay.
  Owner: «Да переводить на англ то что ты спрашивал все переводить)»
  Source: `2026-10-21T16-27-59-062Z_01a15f4a-7ad5-7377-81be-0baf3b6ffa33.jsonl:4221` in the Pi USER session directory named in Provenance.
  Reason: the interface must be English; the owner approved translating the listed Russian messages.
  Carrier: `pcli-vscode/extension.js`; publication still requires a direct owner request. Since: `a55c859`.

## Anthropic subscription adapter

- **Direct provider quota** `[D-ANTHROPIC-QUOTA]`. Owner (`16-27-59:7462`, 2026-10-25):
  «Насчет лимитов — нет, это полная хуйня. Ты должен разобраться, как в Anthropic получать лимиты так же, как это делает Cloud Code. Может, даже reverse придётся, но меня не ебёт. Никаких зависимостей внешних. У нас на других рабочих компьютерах Cloud Code не стоит. Мы не должны от него зависеть вообще никак.

  Надо за реверс разобраться, как Cloud Code получает эти данные, и сделать такую же штуку в нашем Cloud Code провайдере».
  Reason: acquire subscription quota directly through our existing provider credentials on every workstation,
  without an installed/running Claude Code or its statusLine. The delegated implementation requirement keeps
  display/color decisions out, forbids auth writes and token-generating requests, and gives the later UI its own
  five-minute cadence. Carrier: `extensions/RQW-anthropic/quota.ts`, the public `pi.events`
  `rqw-anthropic:quota:v1` offer boundary and [quota protocol evidence](notes/anthropic-quota.md).
  The provider reads only its bound Pi credential store, caches successful percentage/reset windows, and sends
  nothing until a consumer explicitly refreshes. No new dependency, scheduler, option or setting. Primary
  Claude Code 2.1.310 source and a sanitized authorized read-only HTTP 200 establish the protocol; this is an
  undocumented client endpoint, not a public API guarantee.

- **Main 1h, children 5m** `[D-ANTHROPIC-TTL]`. Anthropic offers 5m and 1h, not 10m or 15m. The main OAuth default stays
  1h; the independent Agent extension owns its 5m request policy ([Agent](#agent)); the reviewer runs no Anthropic model ([Review](#review)). Its explicit
  `short` wins in `cache.ts` and `transport.ts`, so cache markers stay on without `ttl: "1h"`, with or without this
  adapter. No new config knobs or process env changes.
  Owner: «По поводу кэшей вопрос-ответ A: основному агенту час А под основным 5 минут ещё какие-то варианты есть? Может, 10 минут? Или это замеренная цифра? Если это замеренная цифра и 5 минут будет заебись в большинстве случаев, то пусть будет 5 минут. Если можно больше и это будет более эффективно, то можно 10 минут поставить или 15. Я не знаю.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 583)
  Reason: short review and resend gaps favour cheaper short writes. Evidence: [measurements](notes/prompt-cache-policy.md).
  Proof: package `test/prompt-cache.test.ts`. Since: `b91f832`.
- **OAuth 1h default** `[D-ANTHROPIC-OAUTH-TTL]`. OAuth subscription requests default to 1-hour prompt caching;
  explicit request retention and user-set `PI_CACHE_RETENTION` win. Engineering choice: request-local options before
  the SDK warmer starts, not a process-wide env write (which also changes OpenAI retention). `cache.ts` resolves Pi auth
  before the SDK stream and supplies `long` for OAuth only; `lifecycle.ts` binds and restores the wrapper for owning and
  shared-runtime child sessions; `transport.ts` covers direct provider calls. API keys and unrelated runtimes stay
  unchanged; warming policy lives in [Settings](#settings).
  Owner: «Почему ты не юзаешь какой-то часовой cash?» (session `2026-10-21T12-13-54-289Z_01a15e61`, line 275); «Это надо будет пофиксить тоже.» (session `2026-10-21T12-13-54-289Z_01a15e61`, line 281)
  Reference (TTL, timing, pricing, Pi's prospective warmer-cost limitation): `extensions/RQW-anthropic/README.md`,
  Prompt cache. Proof: `test/extensions/RQW-anthropic/cache.test.ts`. Since: `ebf7bc1`.
- **Isolated extension** `[D-ANTHROPIC-EXT]`. `extensions/RQW-anthropic/`, listed in `package.json`, owns transport and
  OAuth recovery only; provider visibility is [Providers](#providers). Disable and reload unregisters only its overlay and
  restores in-memory hooks; no node_modules edits or credential deletion. Coordinator text (owner quote C:3046, an omp
  session, not found in the Pi sessions): "они должны быть полностью изолированы, самодостаточны, чтобы мы могли включать и выключать, как feature флаги". Toggle and migration: `extensions/RQW-anthropic/README.md`. Since: `8a1f2ed`.
- **Login and omp wire** `[D-ANTHROPIC-WIRE]`. The overlay keeps Pi's catalog and parser, delegates Pi's PKCE
  browser/copy-code login, and uses omp's refresh endpoint and headers, CLI billing block, original system role and
  exact-body XXH64 checksum. MIT attribution: `THIRD-PARTY-NOTICES.md`; no installed fork code is copied. Subscription
  acceptance and billing, account rotation and all omp SDK headers are not claimed. Coordinator text (owner quotes C:3133,
  an omp session, not found in the Pi sessions): "чтобы он был такой же, как в OMP, чтобы у него был self-healing";
  "И чтобы можно было через него авторизоваться". Evidence and risks: `notes/anthropic-adapter.md`. Since: `071df1e`.
- **Bounded refresh and replay** `[D-ANTHROPIC-REFRESH]`. `auth.ts` refreshes under Pi's runtime credential-store lock,
  rechecks the rejected bearer, reuses a concurrent update and persists rotation before replay. One HTTP 401 replay, at
  most two transient refresh attempts and one explicit newer-version replay; no auth retry for 403/quota, no replay after
  streaming. Caller abort cancels waiting and inference, not persistence of a rotating token. Permanent errors give
  /login guidance without upstream token-response bodies. Inference uses the official HTTPS origin only and rejects
  redirects. No bootstrap identity or startup version probe; `PI_AI_CLAUDE_CODE_VERSION` can pin the CLI version.
  Since: `8a1f2ed`.
- **Old adapter replacement** `[D-ANTHROPIC-MIGRATION]`. `INSTALL.md` step 0.1 removes an installed
  `git:github.com/edxeth/pi-claude-auth` with official `pi remove` in its installed scope, then installs or updates my-pi;
  no confirmation needed. `auth.json` and unrelated packages and settings stay; old explicit `-e` arguments are omitted
  on the next launch. Another competing adapter must be switched off; mixed configurations are not supported
  (`registration.ts` rejects a competing overlay). Coordinator text (owner quote not found in the Pi sessions): "Просто старый адаптер выкидываешь, который есть уже, и ставишь наш адаптер". Carrier: `INSTALL.md`, `extensions/RQW-anthropic/`.
  Since: `9ef1519`.
- **Proof boundary** `[D-ANTHROPIC-PROOF]`. Adapter and package-integration tests use fake credentials, mock fetch,
  file-backed lock fixtures and both Pi library and CLI-bundle entrypoints; they do not prove live subscription
  acceptance, billing or actual Windows execution. The status of old Claude benchmark campaigns is recorded once in
  [Work policy](#work-policy). Independent review follows `PROCESS.md`. Evidence: `notes/anthropic-adapter.md`,
  `notes/anthropic-integration.md`. Since: `8a1f2ed`.
- **Header boundary, per-request version** `[D-ANTHROPIC-HEADERS]`. Engineering follow-up to four review findings:
  the adapter rejects subscription Authorization headers before delegation and keeps ordinary API-key gateway behavior
  (`auth-boundary.ts`, `transport.ts`). Each request records its sent version, also under concurrency, with one bounded
  replay when an effective newer version meets a rejection; a pinned `PI_AI_CLAUDE_CODE_VERSION` forbids adaptation
  (`wire.ts`, `transport.ts`). Proof: `test/extensions/RQW-anthropic/regressions.test.ts`. Since: `071df1e`.

## Models

- **Kimi Code models** `[D-MODELS-KIMI]`. The first four entries are `kimi-for-coding-highspeed`
  (Kimi K2.7 Code Highspeed), `kimi-for-coding` (Kimi K2.8 Preview), `k3.1-pro-highspeed`
  (Kimi K3.1 Pro Highspeed), `k3.1-pro` (Kimi K3.1 Pro), all on `kimi-coding`.
  The first has no selectable reasoning level: the chooser renders `high` only, without a thinking setter.
  The other three offer only `low`, `high`, `max`; none offers `off`. Opus medium remains the new-session default.
  Owner: «Добавь их в самый верх списка в таком порядке.» and «Выключенное рассуждение (off) не предлагай ни для одной из них.»
  (session `2026-10-21T16-27-59-062Z_01a15f4a`, 2026-10-25, Kimi task).
  Owner authorized the provider visibility and missing model registration:
  «да добавь в провайдеры и добавь модель кими к 3.1 и проресерч про нее инфу потому что другой агент нашел эту модель в провайдера и конфигах кимича»
  (same session, line 7039). `RQW-providers` adds only `kimi-coding` to `ALLOWED`.
  `RQW-models/kimi.ts` extends the built-in catalog through public `pi.registerProvider`, retaining built-in OAuth.
  Both K3.1 definitions use context `1048576`, output `131072`, text/image inputs and reasoning `low/high/max`.
  Source for every definition field, including compatibility, image preprocessing and cost: the exact two records
  `kimi-coding.models[2]` and `[3]` in the host's `~/.pi/agent/models-store.json`, inspected 2026-10-25.
  [Official model configuration](https://www.kimi.com/code/docs/en/kimi-code/models) confirms IDs, context,
  image/video capability, reasoning levels and OpenAI-compatible `https://api.kimi.com/coding/v1`.
  Pi exposes text/image input, not video. The `131072` output value is the cached client definition, not an independently
  documented server ceiling: neither that page nor the [release notes](https://www.kimi.com/code/docs/en/kimi-code/whats-new.html)
  specifies a maximum output. No installed Kimi CLI or exact local source definition was found.
  Carriers: `extensions/RQW-models/{index,picker,kimi}.ts`, `extensions/RQW-providers/index.ts`, their scoped tests.
- **Draft chooser** `[D-MODELS-CHOOSER]`. Shift+arrows open a model/effort draft chooser that performs one draft step
  before the first render; one transition is Shift+arrow then Enter. Plain and Shift arrows then share the same axes.
  Enter commits once; Esc closes with no setters or restoration. A draft model switch clamps effort to the nearest lower
  allowed level or the lowest. Dialog and key-repeat guards prevent stacked dialogs; session replacement, reload or
  shutdown cancels the draft. No settings, dependencies, request fences or aborts are added. Appearance: two compact
  terminal-native wheel columns, selected centre, muted neighbours, visible OK/Enter/Esc hints, supplied theme roles and
  thinking-level tokens; narrow rendering fits. Unchanged-model commits use only the thinking setter; changed-model
  commits use `pi.setModel` with a scoped synchronous pending-effort `model_select` handler, fallback and cleanup. Pi's
  setters are not atomic (README limit). The strict no-intermediate-request requirement was withdrawn by the coordinator
  as an overreach. `/rqw-models` and stock restrictions are unchanged.
  Owner: «Надо переделать picker модели effort таким образом, что когда я нажимаю Shift+стрелочку вверх, вниз или влево, вправо, у нас открывается визуальный интерфейс, в котором переключается модель визуально. Знаешь, как в iPhone, когда ты крутишь ползунки «минуты», «секунды», где-то открывается интерфейс, в котором предварительно меняется модель и effort, когда я нажимаю кнопочки, и там будет кнопочка «OK». Enter — это принять, а Escape — это отмена. Escape — закрыть интерфейс. И получится так, что когда я меняю интерфейс, меняю effort, он сразу не меняется, не применяется. Нет такого, что я пока переключаю модель, он запросы под разными моделями улетает. У меня префаер — мини-интерфейс, где я выбираю модель effort, нажимаю Enter, и оно применяется. Эта хуйня должна быть в стилистике нашего UI из тех задач, которые были. Следичку подгони сам. Потом, если что, если мне не понравится, мы её переделаем.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 3228)
  Clarification: «когда ты нажимаешь первый раз Shift и стрелочку, у тебя открывается интерфейс уже с новой, будущей моделью измененной, чтобы я не делал дополнительные клики.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 3238);
  «Если я нажимаю Shift+Влево или Shift+Вправо, то он сразу открывает пикер с измененным состоянием, чтобы мне нажать, а потом Enter. Нажать и Enter, если нужен один переход. А если несколько, то я нажал, довел до нужного состояния, нажал Enter.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 3238);
  «И это должно быть строго в концепте Terminal UI Pi, и при этом чтобы это было в цветовой гамме и в согласованности с нашим новым дизайном, который ты сейчас имитируешь. Решение остается за тобой конечное.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 3238)
  Carrier: `extensions/RQW-models/{index,picker}.ts`, `test/`, real Pi composition in `test/model-effort-picker.test.ts`.
  The effort colours of the footer are RQW-statusbar's (`[D-STATUSBAR-ACTIVITY]`). Since: `d0160cf`.
- **Startup availability** `[D-MODELS-STARTUP]`. Coordinator engineering choice, without its own owner quote: startup
  reads provider-scoped availability and uses the owning session's async-auth `setModel`. Before the startup choice
  `session_start` awaits Pi's provider-scoped `getAvailable(provider.id)` in parallel for the visible providers, sharing
  one 15 s deadline like Pi's model selector; on timeout or error the snapshot is used; without a choice nothing waits.
  Reason: Pi can discard a whole-runtime availability pass superseded by a background refresh, and `pi.setModel` checks
  that snapshot's configured-auth state first. Carrier: `extensions/RQW-models/index.ts`; `test/extensions/RQW-models/models.test.ts` gates a
  superseding pass deterministically. Since: `230e8d0`.
- **Independent module** `[D-MODELS-MODULE]`. `extensions/RQW-models/index.ts` imports only Pi and has its own
  `pi.extensions` entry; disable it in `pi config`, then `/reload`. It writes no settings and registers no tool; its
  instance-level masks are removed when it is off. Coordinator text (owner quotes C:3113, an omp session, not found in the
  Pi sessions): "Надо, чтобы они работали как в нашем OMP"; "Один мод будет статус бара, а второй мод будет Model Picker"; "То есть чисто модели Opus, Sonnet, GPT-6.1, GPT-6, Luna-6, Haiku". Since: `071df1e`.
- **GPT 5.6 Luna and Haiku order** `[D-MODELS-LUNA]`. Haiku stands above both Luna models; `openai-codex/gpt-5.6-luna` is
  a permanent list entry, kept from the reviewer measurements (no reviewer uses it now, see [Review](#review)); its low to max efforts are selectable,
  intersected with Pi support.
  Owner: «Надо подобрать сопостовимую модель на gpt, попробоуй 5.6 luna и более сильные модели типа medium ризонинг 6 и 6.1 sol, на время замеров добавь 5.6 luna в список моделей наших сразу после хайку и вообще хайку надо поставить над всеми в слабых моделях ь.е. порядок должен быть типа haiku 5.5, luna 5.6, luna 6» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 1167); «Да» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 1425)
  Carrier: `extensions/RQW-models/index.ts` (`FAMILIES`, `FAMILY_LEVELS`). Since: `7d6fdbf`.
- **Model order and availability** `[D-MODELS-ORDER]`. After the four Kimi entries in `[D-MODELS-KIMI]`, `FAMILIES`: `claude-opus-5-5`, `claude-sonnet-5-5`,
  `gpt-6.1-sol`, `gpt-6-sol`, `claude-haiku-5-5`, `gpt-5.6-luna`, `gpt-6-luna`, strongest first. `pickerModels` takes
  Pi's credential-aware availability including provider `filterModels`: the runtime's unmasked `getAvailableSnapshot`
  through its prototype while the listed-models masks are set, otherwise `ctx.modelRegistry.getAvailable()`. Absent,
  filtered and unauthenticated models are skipped. The draft resolves no credentials and makes no requests; commit uses
  Pi's authenticated setter. `familyOf` matches the same generation across provider paths, Claude dotted versions, dated
  aliases and Bedrock ids; nothing else is substituted. Since: `e6c21e2`.
- **One variant per family** `[D-MODELS-VARIANT]`. Engineering choice (coordinator brief C:3274): one available variant
  per family, preferring `anthropic` for Claude and `openai-codex` for GPT and the exact canonical id, then stable
  provider/id order; a proxy variant only when the preferred one is unavailable. Provider visibility is
  [Providers](#providers). Since: `071df1e`.
- **Shift+arrow keys** `[D-MODELS-KEYS]`. `registerShortcut` binds `shift+up` (stronger model), `shift+down` (weaker),
  `shift+right` (reasoning up), `shift+left` (reasoning down), as in omp (`model-arrows.js`, `reasoning-arrows.js`).
  Shift+Up moves to earlier, stronger entries; the stronger model direction agrees with the higher effort direction. The
  former Option/Alt+plus/minus layout and its aliases are removed. Pi 1.4.0 binds none of the four keys; terminals send
  CSI `1;2A`/`B`/`C`/`D` (Kitty also `1;2:1A`). The first match handles a press once. One guarded dialog owns the draft,
  so repeats queue no dialogs or live switches. Opening reads the live model from the latest `session_start` event
  context, refreshed on resume and reload, not a queued TUI snapshot. Movement stops at either end. Entry rule: from
  outside the list Shift+Up enters at the strongest available model and Shift+Down at the weakest.
  Owner: «Надо вернуть старое управление моделями: Shift + Вверх/Вниз будет смена модели, Shift + Вверх — к более сильным, Shift + Вниз — к более слабым. А Shift + Влево/Вправо — это будет смена ризенинга, так же, как и раньше это было в ОМП.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 2361)
  Carrier: `extensions/RQW-models/index.ts`. Proof: `test/extensions/RQW-models/models.test.ts` (key bytes through Pi's matcher, direction,
  limits). Since: `ac33dcc`.
- **`/rqw-models`** `[D-MODELS-COMMAND]`. The extension's authenticated listed-model picker via `ctx.ui.select`. Pi's
  built-in model shortcuts stay reserved and are emptied, not replaced; Shift+Tab and provider definitions stay stock. In
  print/JSON mode it does nothing; RPC can supply the standard select dialog. Since: `e6c21e2`.
- **Only listed models** `[D-MODELS-LISTED]`. Only models of the list (any provider variant matched by `familyOf`) can be
  selected or used anywhere, including CLI `pi --model`, restored sessions and `agent` subagent models.
  - Stock lists are empty: on every `session_start` RQW-models borrows the owning `AgentSession` in one synchronous
    `ctx.getContextUsage()` call (prototype swapped and restored in that call), then masks `getAvailableSnapshot()` and
    `session.scopedModels` to `[]`. `/model`, its autocomplete, Ctrl+L, Ctrl+P, `/scoped-models`, `/settings` default
    model, RPC `get_available_models`/`set_model`/`cycle_model` and post-login auto-selection find no model.
  - Selection outside the list is refused before mutation: `setModel` rejects with `<provider>/<id> is not in the RQW
    models list. Allowed: <listed IDs>.` and a warning; model, entries, settings and `model_select` stay unchanged.
  - On `session_start` an unlisted current model is replaced by authenticated Opus, else the strongest authenticated
    listed model, at medium or the startup/`/new` `--thinking`, with a warning. With no authenticated listed model the
    model stays and the warning says its requests are refused. The wait before this choice is `[D-MODELS-STARTUP]`.
  - Requests: the owning runtime's `prepareRequest` refuses chat requests for an unlisted model with `RQW-models refused
    the request: <the same text>`, covering in-process subagents; the reviewer model (GPT-6.1 Sol) is
    listed. Pi's own requests use the session's model; image and classifier models pass.
  - Masks call Pi's current prototype methods, so RQW-anthropic and RQW-context patches keep working; they are
    reference-counted and removed on `session_shutdown` or `session.dispose()`.
  - Limits: Ctrl+P still prints "Only one model available"; `/scoped-models` shows saved patterns as unavailable rows;   after `/login` Pi suggests `/model`; if the session cannot be borrowed RQW-models warns and stock lists stay. Owner: «Смотри, про выбор модели, где через стрелочки вверх, вниз, через плюс-минус мы меняем модели, меняем effort. Там меняются только модели из нашего списка. И вообще другие модели выбрать нельзя, только модели в этом списке. Дефолтный Model Picker работать не должен. Там должен быть пустой список моделей.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 335); «Да, делай» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 344) to the coordinator option "a) Закрыть и эти пути. Модель вне списка не выбирается нигде, Pi покажет предупреждение." The
  strongest-listed fallback without Opus auth is a coordinator choice derived from that rule. Carrier:
  `extensions/RQW-models/index.ts`. Pi mechanisms: [notes/models-omp.md](notes/models-omp.md). Since: `5e1d478`.
- **Opus medium at startup** `[D-MODELS-DEFAULT]`. Without explicit CLI model selection, `session_start` selects
  available Opus at `medium` on a fresh startup or `/new`; with no authenticated Opus it keeps Pi's initial model if
  listed. Startups with history or continuation/session flags, and `resume`, `fork`, `reload`, keep a listed current
  model and thinking. Explicit CLI `--model`/`--models` of listed models keep Pi's resolved model and thinking, including
  suffixes, scoped suffixes, `--thinking` precedence and settings effort; Pi's exported `parseArgs` recognizes them and
  no suffix is parsed again. Without an explicit model, `--thinking` applies through Pi's native clamping, else medium.
  CLI overrides apply to `/new` too; no defaults are persisted. An SDK host must pass reason `resume` for an empty
  restored session. Coordinator text (owner quote C:3113, an omp session, not found in the Pi sessions): "И базовая модель всегда при запуске — это Opus-Medium. Это от провайдера не зависит". CLI precedence and resumed-session
  preservation are coordinator choices (C:3123, C:3274). Proof: `test/extensions/RQW-models/models.test.ts`. Since: `071df1e`.
- **Harness effort lists** `[D-MODELS-EFFORT]`. `FAMILY_LEVELS` intersected with Pi's `getSupportedThinkingLevels`:
  Opus low, medium, high; Sonnet low, medium, high, xhigh; GPT-6.1 Sol, GPT-6 Sol, both Luna models and Haiku low,
  medium, high, xhigh, max. No minimal, no off. A model switch keeps the previous effort if allowed, else the nearest
  lower or the lowest; explicit off/minimal moves to the lowest allowed level on the next extension-driven selection. An
  unlisted model (current only while no listed model is authenticated) keeps Pi-supported levels minus off and minimal.
  Owner: «Нет, ты не понял: уровни effort будут не те, что в стоковом выборе Pi, а те, что в нашем MyOMPHarness были. Там они были перенастроены кастомно. Допустим, у Opus были low, medium, high, у Sonnet были low, medium, high, extra high. Такие же должны быть, только без no reasoning.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 134)
  Carrier: `extensions/RQW-models/index.ts`. Source evidence: [notes/models-omp.md](notes/models-omp.md). Since: `0def125`.
- **Model tests** `[D-MODELS-TESTS]`. `test/extensions/RQW-models/models.test.ts`, faux only: standalone loading and
  disabling, real SDK sessions, model/thinking changes, history restore and reload, no persisted defaults, CLI flags
  (also through Pi's CLI bundle), missing Anthropic auth, the listed-models rule, a provider `filterModels` dropping a
  family, a pending startup availability pass, a subagent-style session, rapid snapshot contexts and reasoning queued
  behind a switch. Key tests feed CSI `1;2A..D` and Kitty `1;2:1A..D` through Pi's matcher; the old Option-layout bytes
  are negative cases. `test/anthropic-models.test.ts` switches RQW-models and RQW-anthropic off in turn. This is parser
  testing, not manual terminal testing. CI runs on macOS and Windows (`tests.yml`); Linux is out of scope. Historical
  local reports: [decisions evidence](notes/decisions-evidence.md#models-reports). Since: `e6c21e2`.
- **CI auth fixture** `[D-MODELS-CI-FIXTURE]`. `test/extensions/RQW-models/models.test.ts` seeds `models.json` with
  `providers.openai-codex.apiKey: faux-only` before spawning Pi, so the no-Opus-auth fallback test has a deterministic
  initial model on Pi 1.4.0 (native-provider registration refreshes availability asynchronously while `findInitialModel`
  reads the synchronous snapshot). Fixture auth only, no production change. Investigation and numbers:
  [decisions evidence](notes/decisions-evidence.md#models-ci-fixture). Since: `071df1e`.

## Status bar

- **Pending provider-limit badge colors** `[D-STATUSBAR-LIMIT-COLORS]`. Owner (`16-27-59:7409`, entry
  `e65a800e`, 2026-10-25): «Codex будет золотого цвета, Kimi будет платинового цвета, а CloudCode будет бронзового цвета.»
  Definitive `CC` choice, owner (`16-27-59:9432`, entry `d7037e66`): «2 бронза».
  This answers the bronze/orange question in assistant entry `05b22f2b`, `16-27-59:9416`.
  Decision: `CC` bronze, Codex gold, Kimi platinum. Reason: distinguish provider-limit badges by color.
  Carrier: pending [PROVIDER-LIMITS](BACKLOG.md#provider-limits). The direct Anthropic quota provider is delivered
  ([D-ANTHROPIC-QUOTA](#anthropic-subscription-adapter)); statusbar badge implementation is NOT STARTED by this record.

- **Independent extension** `[D-STATUSBAR-EXT]`. `extensions/RQW-statusbar/` has its own `pi.extensions` entry and
  imports nothing from another extension folder. Coordinator text (owner quote C:3133, an omp session, not found in the
  Pi sessions): "Просто нужны элементы и расположение их отображения, и всё". Row contract and evidence:
  `notes/statusbar-omp.md`; no other omp UI is copied. Since: `0f356c4`.
- **Toggle** `[D-STATUSBAR-TOGGLE]`. On by default; `/statusbar [on|off]` toggles in the TUI, the bare command inverts.
  Off restores the stock editor (only when ours is installed) and footer and disposes polling and subscriptions. The
  choice is local to the loaded extension, not persisted. Print, JSON and RPC do no footer work. Model and thinking are
  read live from Pi. Since: `0f356c4`.
- **Context limit** `[D-STATUSBAR-CONTEXT]`. Context tokens and window come from Pi; the bar measures the effective
  compaction threshold from Pi's own reserve resolver, including a cap installed by RQW-context, and never changes it.
  Unknown post-compaction usage is `?/limit`, since zero would claim a known empty context. Since: `0f356c4`.
- **No invented data** `[D-STATUSBAR-SCOPE]`. omp data without a stock Pi API is not shown: modes, collaboration,
  streaming/recording and PR metadata. Running agent counts, including reviewer profiles, are shown, read from RQW-agent over `pi.events` (`[D-STATUSBAR-ACTIVITY]`). Colours are the extension's own ANSI and truecolour values, not
  stock theme roles. Limits and samples: `notes/statusbar-omp.md`. Since: `0f356c4`.
- **Activity chrome** `[D-STATUSBAR-ACTIVITY]`. The existing activity text and running counts occupy a separate
  line above the editor's top border, with one leading space and one empty line above and below.
  Idle removes all extension-added activity rows; only Pi's original widget spacer remains. The session title occupies the left of the top
  border between rules; the session ID remains at the right. The title is gold and gains the gold shimmer during
  compaction. The activity remains separate from Pi's native current-action row.
  Existing activity wording, count sources, branch marker and footer effort colours are unchanged.
  Owner: «Надо, чтобы заголовок сессии был там, где сейчас статус, в этой строке между чёрточкой разделения.»
  «А статус — чтобы он был отдельной строкой, как будто это сообщение в чате.»
  Source: `~/.pi/agent/sessions/--Users-arkadijcukavin-ai-project-my-pi--/2026-10-21T16-27-59-062Z_01a15f4a-7ad5-7377-81be-0baf3b6ffa33.jsonl`, USER entry at line 6378;
  verified by `scripts/owner-quotes.mjs`. Layout acceptance and spacing are in the task's included owner messages. Reason: the owner's requested title and status placement.
  Carrier: `extensions/RQW-statusbar/{index,editor,render}.ts`; contract: `notes/statusbar-omp.md`.
- **Accurate waiting categories** `[D-STATUSBAR-WAITS]`. After Main's full answer and run completion,
  keep real pending work visible, for example `Waiting for 2 agents, 1 background process`. While Main is active,
  preserve its existing thinking or tool text and agent suffix. RQW-agent counts an active logical assignment
  (`a.run`), pending sends or native activity once per agent, recursively. A native-idle child waiting for its
  jobs or children counts; a waiting parent and its active descendant each count. Completed undelivered results
  count zero, and genuine idle or AFK with no pending work removes the line.
  RQW-tools independently offers only Main's actual background jobs as `{ agents: 0, backgroundProcesses: number }`
  over the existing public `pi.events` v1 source protocol. Child jobs are not duplicated in that category.
  The consumer accepts optional `backgroundProcesses`, treating its absence in older v1 sources as zero.
  Reviewers remain ordinary agents, with no worker or separate review category. This authorizes only the statusbar
  portion of AGENT-STATES-UI, not agent lists or cards, and changes no visuals, timing, colours, settings or dependencies.
  Owner requirements and exact sources: [BACKLOG AGENT-STATES-UI](BACKLOG.md#agent-states-ui), owner entries
  `16-27-59:5085` (`04f64a5e`), `5087`, `6301` (`a8793e4c`) and `6305` (`217beed6`), in the session named in Provenance.
  Coordinator record: the current forwarded owner correction resumes only the statusbar portion of the hold at
  `6313` (`f148804a`); no new authenticated owner-session locator was supplied. No new verbatim quote is asserted here.
  Reason: native turn completion is not logical assignment completion; real waits must remain visible without
  retaining idle agents or spending model turns just to wait. Carriers: `extensions/RQW-agent/{index,counts}.ts`,
  `extensions/RQW-tools/{index,jobs,counts}.ts`, `extensions/RQW-statusbar/activity.ts`; protocol:
  [RQW-agent README](extensions/RQW-agent/README.md#contract-for-p6). Since: statusbar-wait-after-answer.
- **GPT Fast lightning** `[D-STATUSBAR-FAST]`. The main chat's GPT Fast state ([Settings](#settings), "GPT Fast") shows as
  a bright yellow lightning after the model name, before the thinking level, when it is on and the model's provider is
  `openai-codex`. While the agent works a shimmer runs over the bolt (bright yellow, paler yellow, white, back; 120 ms per
  step); idle it is static bright yellow. The timer runs only while the agent works and the lightning is shown. The glyph
  before the model name stays. Engineering choices: Nerd Font bolt `\uf0e7` (U+26A1 is two cells in pi-tui); own ANSI
  colours (bold 93, 38;5;220/226/229, 97), not a theme role. The state is queried from RQW-settings over `pi.events` at
  every render and redrawn on its change event; nothing is imported.
  Owner: «Надо, чтобы метка фаз была в виде молнии яркой Желательно которая ярко-желтая с бликом переливающимся. Можешь так сделать?» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 2158);
  «Нет, лучше значок молнии пририсовывать после имени модели между моделью и резонингом.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 2175) The shimmer while
  working and the steady yellow idle follow the coordinator description the owner accepted. Carrier:
  `extensions/RQW-statusbar/{render,index}.ts`. Proof: `test/fast-gpt.test.ts`. Since: `fa05edf`.
- **Compaction sheen** `[D-STATUSBAR-SHEEN]`. Gold shimmer runs over the session title in the top input border.
  Gold retains its doubled travel speed; silver timing follows `[D-STATUSBAR-ANIMATION]`. Neither has a slant. Silver has a bright
  three-cell peak; gold also has a bright three-cell peak. Both have wide, soft, monotone falloff between
  neighbouring letters; gold is the smoothest. No unrelated animation behavior changes.
  Owner: «Да, и во время compaction анимация должна идти поверх заголовка, поверх названия сессии.»
  «Надо серебряный сделать более плавным и золотой нужно сделать максимально плавным А пиковые цвета чтобы были на серебре в три символа, а на золоте в шесть-семь символов»
  «Надо, чтобы пиковые цвета были очень яркие, но при этом спуск вниз до базового цвета был довольно размазанным.»
  «Надо вообще блик ускорить в два раза по скорости или даже в два раза ровно ускорить его.»
  Source: the same local owner session as `[D-STATUSBAR-ACTIVITY]`, USER entries at lines 6399 and 6413;
  verified by `scripts/owner-quotes.mjs`. The current task explicitly confirms doubled speed for both shimmers and no slant. Reason: smoother highlights with the owner's peak widths.
  Gold correction, owner task request on 2026-10-25, source: current `statusbar-compaction-glint` task:
  "Replace this with ONE glint, matching the silver status animation's approach, travelling across the whole strip AND the `Compaction` label."
  "Use the final width clarification: THREE characters at the peak, not seven."
  "Keep the current animation speed exactly; the owner explicitly likes it."
  "Make the falloff very soft, distributed and smooth, with an expensive-looking continuous gradient."
  This replaces the earlier gold peak width and periodic motion, not silver or the existing layout and labels.
  Carrier: `extensions/RQW-statusbar/render.ts`; proof: deterministic statusbar render and animation tests.
- **Animation cadence** `[D-STATUSBAR-ANIMATION]`. Redraw at 30 nominal frames per second,
  using monotonic elapsed time and fractional positions for smooth motion. Silver activity text has exactly one
  glint appearing at the left, flying right at constant linear speed, fully clearing the right edge,
  then remaining absent for exactly 2500 ms before repeating. Flight duration is 1250 ms; the pause is twice the flight.
  Owner source: `statusbar-silver-1250-2500` task request, 2026-10-25:
  "ONLY change the silver glint's one-way left-to-right flight to 1250 ms and its subsequent fully absent pause to 2500 ms."
  The three-cell peak and soft silver gradient stay unchanged.
  Gold compaction keeps its single bouncing glint over each full strip and activity label at
  8.59375 cells/s. The lightning keeps its 120 ms colour step.
  Silver correction source: current `statusbar-silver-loop` task, owner steering on 2026-10-25:
  "the silver glint at the top must appear at the left, fly VERY FAST left-to-right at one constant linear speed, fully disappear after passing the right edge, then remain absent for exactly 2 seconds before the next flight."
  "The owner explicitly leaves the flight duration to our visual judgment; choose a genuinely fast duration and show deterministic timing/render evidence."
  This supersedes silver's earlier back-and-forth motion and retained speed, not gold or other UI.
  The title animates during compaction, not otherwise. Input text and effort colours do not animate.
  `STATUS_FRAME_MS = 80` and `FAST_STEP_MS = 120` remain unchanged; the shared redraw interval becomes `1000 / 30` ms.
  `ContextEditor` uses `embedWorkingStatus: true` and `setWorkingIndicator({ frames: [] })` while our editor
  is installed, restoring the pre-`081d914` suppression of Pi's native working row. Off, shutdown and another
  editor restore the default indicator. The layout is tool block, one blank, shimmer status, one blank, title border.
  Owner correction: «1а», supplied by Main in this task on 2026-10-25: hide the stock row as before the change.
  `activityRows` supplies status and trailing blank; Pi supplies the leading spacer. Idle returns `[]`.
  Owner: «Сделай анимацию блика 30фпс, 50 ту мач и сделай ее более плавной и что бы был 1 блик на статусе который катается туда сюда, а не бесконечное количество»
  Source: `~/.pi/agent/sessions/--Users-arkadijcukavin-ai-project-my-pi--/2026-10-21T16-27-59-062Z_01a15f4a-7ad5-7377-81be-0baf3b6ffa33.jsonl`, USER entry at line 6774,
  verified by `scripts/owner-quotes.mjs`. Colours, soft falloff, layout and static title stay unchanged; the later gold correction is recorded in `[D-STATUSBAR-SHEEN]`.
  Doubled-speed source: `[D-STATUSBAR-SHEEN]`.
  Carrier: `extensions/RQW-statusbar/{index,render}.ts`; historical cost measurements: `notes/statusbar-omp.md`.
- **Own git discovery** `[D-STATUSBAR-GIT]`. Git branch and counts use the extension's own repository discovery and
  asynchronous git refresh, not Pi's cached `getGitBranch()`, which caches absent metadata when a session starts outside
  git. Engineering choice. Carrier: `extensions/RQW-statusbar/{git,index}.ts`. Evidence: `notes/statusbar-omp.md`.
  Since: `6b9b0b9`.
- **Context bar as bottom border** `[D-STATUSBAR-BOTTOM]`. The context bar is the input editor's bottom border, not a
  separate footer row; the footer keeps the model and place rows. Mechanism: `ctx.ui.setEditorComponent` with a
  `CustomEditor` subclass (`ContextEditor`) that overrides `renderTopBorder` and `renderBottomBorder`; Pi carries over
  text, border colour, padding and app keys. The down-arrow `N more` hint comes first and the bar takes the rest. When
  another extension's editor is installed it is kept and the bar stays the first footer row; if one replaces ours, the
  footer shows the row again. Outside the TUI nothing is installed.
  Owner: «Я бы хотел, чтобы бар контекстного окна был вместо нижней чёрточки.» (session `2026-10-21T12-13-54-289Z_01a15e61`, line 136)
  Carrier: `extensions/RQW-statusbar/{editor,index}.ts`, `render.ts` `editorBorder`. Contract: `notes/statusbar-omp.md`.
  Since: `1a2adb2`.
- **Session ID in the top border** `[D-STATUSBAR-TOP]`. With our editor installed, the top border shows
  the gold session title at the left between rules and the full session ID at the right as ` <id> ──`.
  Activity is above the border, not embedded in it. The ID retains its existing source, spacing and whole-ID
  hiding behavior. Off or a foreign editor retains Pi's editor behavior. Current placement: `[D-STATUSBAR-ACTIVITY]`.
  Owner: «Можно добавить его в верхнюю часть там, где working крутится, хуйня. С левой стороны сделать также вставку id сессий с пробелами: идёт чёрточка, потом id, потом снова чёрточка. Прямо по левому краю.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 191);
  «Я бы так сделал, чтобы это было симметрично по левому краю именно, и чтобы между чёрточками и ID был какой-то пробел, хотя бы по одному, чтобы можно было нормально вырезать и вставить, скопировать и вставить.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 191)
  Correction: «По визуальному он должен стоять справа. Я ошибся: не с левого края, а с правого края. Слева working, справа ID сессии. Он прижат должен быть к правому краю, а ID к левому краю прижат. Если места нету, то он и не отображается, его просто не видно.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 203)
  Carrier: `extensions/RQW-statusbar/{editor,render,index}.ts`. Contract: `notes/statusbar-omp.md`. Since: `c6b642c`.
- **Tokens per second** `[D-STATUSBAR-RATE]`. `usage.output * 1000 / durationMs` per completed assistant message of the
  main session, `durationMs` being Pi's monotonic time from the request start. Skipped: missing or non-positive `output`
  or `durationMs`, `durationMs` under 500 ms, `stopReason` `aborted` or `error`. No chars/4 fallback, no live value while
  streaming; the last value holds until the next, nothing before the first, reset on session start, tree change and
  toggle. `usage.output` already includes reasoning tokens. Reason: neither Anthropic nor Codex returns a rate field.
  Owner: «Смотри, токены в секунду какую-то хуйню показывают. Надо как-то привести, чтобы токены в секунду очень хорошо и качественно работали. Надо разобраться, почему в ОМП таких ситуаций не бывает, а почему у нас токены в секунду показывают дичь какую-то. И по-хорошему, надо сделать так, чтобы токены в секунду были залайнены на те показатели, которые отдаёт провайдер, Anthropic либо Codex Legacy.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 464) The owner chose
  coordinator option a: "Делим точное число выходных токенов от провайдера на время ответа. Время Pi сам меряет точными часами от начала запроса. Ответы короче полсекунды не учитываем. Значение обновляется после каждого ответа."
  Carrier: `extensions/RQW-statusbar/{render,index}.ts` `RateMeter`. Contract: `notes/statusbar-omp.md`. Since: `2f5be5b`.

- **Session branch mark** `[D-STATUSBAR-BRANCH-MARK]`. The interface is English: off the original session
  branch, row 3 shows `⑂ fork #N`, such as `⑂ fork #2` or `⑂ fork #3`. The glyph, `label` colour role,
  two-space gap and hiding rules stay unchanged; only the wording after the glyph changes.
  Owner quotations in source order:
  Owner: «В интерфейсе надо поменять ветка два на branch two, как-нибудь её сделать типа BR2. У нас весь интерфейс должен быть английский. Пройдись по интерфейсу, найди, где есть русский язык, и дай мне список. Будем думать, как англицизировать всё дело.»
  Owner: «Насчет BR2 я имею в виду, что должен сам придумать пиздатую аббревиатуру, которая будет подходить к нашему дизайну и вписываться в него органично.»
  Owner: «Допустим, это может быть не BR2, а просто значок ветки и написано V2, V3 или branch V2 написано, V3, что-нибудь такое»
  Owner: «Мне нравится вариант Fork 2, только надо решетку сделать: fork #2, и все»
  Source: `2026-10-21T16-27-59-062Z_01a15f4a-7ad5-7377-81be-0baf3b6ffa33.jsonl`, USER entries at physical lines 4044, 4049 and 4090.
  Reason: use the owner's chosen English marker without changing its placement or rendering rules.
  Carrier: `placeRow` in `extensions/RQW-statusbar/render.ts`; proof: `test/extensions/RQW-statusbar/chrome.test.ts`,
  `test/extensions/RQW-statusbar/lifecycle.test.ts`; contract: `notes/statusbar-omp.md`. Since: `21179e1`.

## Anthropic package integration

- **Package integration** `[D-ANTHROPIC-PKG]`. Coordinator integration brief (C:3376), not an owner quotation:
  RQW-anthropic is the ninth of the fourteen `pi.extensions` entries; package fixtures use fake authenticated allowed
  providers, not a visibility bypass, and the dynamic isolation assertions are unchanged. `test/anthropic-models.test.ts`
  covers source order, unauthenticated startup, Opus medium with mock secrets, login visibility, the stock fallback with
  the adapter or RQW-models off, and RQW-anthropic and RQW-providers each off alone. Proof boundary:
  `[D-ANTHROPIC-PROOF]`. Notes: `notes/anthropic-integration.md`. Since: `071df1e`.

## Scroll

- **Escape jumps down** `[D-SCROLL-ESC]`. Escape in Pi's fullscreen view returns a scrolled-up transcript to the latest
  message, as in Codex; at the bottom Escape stays stock, Ctrl+End stays, an open transcript search takes the first
  Escape. Package behaviour for every my-pi user.
  Owner: «Да, я также бы хотел перенастроить хоткеи, чтобы когда я скролю, jump to last message было на Escape» (session `2026-10-21T12-13-54-289Z_01a15e61`, line 53);
  «Хотя бы должен быть какой-то адекватный хоткей, который будет перехватываться всеми браузерами нормально. И чтобы он не конфликтовал с другими хоткеями.» (session `2026-10-21T12-13-54-289Z_01a15e61`, line 77);
  answer to coordinator option 1a: «Сделай Escape просто, что когда я открыл вверх, я Escape нажимаю, как в кодексе. В кодексе ты когда scroll вверх делаешь, нажимаешь Escape, и он тебя возвращает в самый низ чата. Так же сделай» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 100)
  Since: `72873eb`.
- **Own extension** `[D-SCROLL-EXT]`. `extensions/RQW-scroll/index.ts`, its own `pi.extensions` entry, switched off alone
  ([INSTALL.md](INSTALL.md#switch-one-extension-off), [Isolation](#isolation)); the behaviour belongs to no existing
  extension. Since: `72873eb`.
- **Input listener** `[D-SCROLL-MECH]`. Engineering choice: binding `escape` to `tui.altScreen.bottom` is rejected
  because Pi's viewport would consume it even at the bottom. The extension adds `ctx.ui.onTerminalInput`; Pi's
  alt-screen listener runs first, so its own keys keep priority. It consumes Escape only when the renderer is
  `fullscreen`, `isFollowingOutput` is false and the focus is Pi's main editor (a `CustomEditor`, detected by its
  `actionHandlers` map) without an open autocomplete list, then calls `scrollToBottom()`. Otherwise Escape is untouched;
  inline, print, JSON and RPC are unchanged. The TUI is reached through a `belowEditor` widget factory that renders no
  line; key releases are not consumed. Since: `72873eb`.
- **Hint shows Esc** `[D-SCROLL-HINT]`. While Escape can jump, the fullscreen hint shows `Esc` with the configured bottom
  keys (default `Esc/Ctrl+End`). `index.ts` replaces the `getKeybindings`/`setKeybindings` registry with a display facade
  that decorates only `getKeys("tui.altScreen.bottom")`; matching and configuration delegate unchanged. Shutdown
  restores the prior registry if it still owns the slot.
  Owner: «Нашел баг: не Escape мы возвращаемся уже, а в надписи написано старый hotkey.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 727) Since: `8c29ff8`.
- **Limits** `[D-SCROLL-LIMITS]`. A custom editor not extending `CustomEditor` gets stock Escape. With search open, the
  first Escape closes search and the second jumps. The keybinding registry is process-global; the facade follows its
  owning interactive renderer. Since: `72873eb`.
- **Proof** `[D-SCROLL-TESTS]`. `test/extensions/RQW-scroll/scroll.test.ts` (in `npm test`) with Pi's real renderers and
  proxy, chat viewport, `CustomEditor`, `ExtensionSelectorComponent`, overlay and search, loaded by Pi's resource loader:
  scrolled up Escape jumps and is consumed, then interrupts; at the bottom it interrupts; Ctrl+End jumps; selector,
  overlay, autocomplete and search keep their Escape; inline mode, unloaded and after shutdown are stock; the hint lines
  and the unchanged registry are asserted. Local PTY probe: [decisions evidence](notes/decisions-evidence.md#scroll-pty-probe).
  Since: `72873eb`.

## Session commands

- **`/copy-session` and `/remove`** `[D-SESSION-COMMANDS]`. `/copy-session` copies the session ID with Pi's exported
  clipboard implementation; the name avoids Pi's built-in `/copy` (coordinator-specified spelling). `/remove` uses one
  `ctx.ui.select`, refuses without UI, and calls `ctx.newSession({ withSession })` before deletion so old writers and
  shutdown hooks finish. Contract: `extensions/RQW-session/README.md`.
  Owner: «И по-хорошему надо какую-нибудь команду вбить, типа COPY SESSION ID. И надо ещё добавить команду remove сессии, как в кодексе, чтобы можно было написать /remove и удалить полностью эту сессию со всей историей, со всей хуйнёй, которая с ней связана.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 191);
  «Просто надо сделать /copy session команду, чтобы я мог её просто скопировать в буфер обмена и всё.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 203)
  Carrier: `extensions/RQW-session/{index,artifacts}.ts`, its own `pi.extensions` entry. Since: `db5ab64`.
- **Confirmation dialog** `[D-SESSION-CONFIRM]`. `/remove` asks once with `["1. No", "2. Yes"]`; Pi 1.4.0's
  `ExtensionSelectorComponent` starts at index 0, so deletion needs Down then Enter. The deleted session is gone without a
  trash and a new empty session opens.
  Owner: «После remove сессия удаляется, но совсем, полностью без корзины, и сразу открывается новая пустая сессия, как ты предложил. Потом подтверждение удалению один раз. Просто на экране поднять визуально, как в кодексе открыть диалог с вопросом «да/нет?». Циферка один по дефолту — нет, по не дефолту — да. То есть циферка один — нет, циферка два — да. И мне, чтобы удалить, надо нажать стрелочку вниз и Enter. Это если у тебя есть SDK для того, чтобы такие диалоги открывать.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 203)
  Carrier: `extensions/RQW-session/index.ts`, README. Proof: `test/extensions/RQW-session/session.test.ts` drives the real component.
  Since: `db5ab64`.
- **Deletion scope** `[D-SESSION-SCOPE]`. Coordinator-approved scope, not an owner quotation: delete the current JSONL
  plus referenced artifact files not referenced by other sessions, keeping user forks and shared artifacts. Only
  Pi-generated basenames inside OS temp are deleted, never arbitrary `fullOutputPath` values; JSONL outside the agent
  directory is refused; no symlink escape, directories or unrelated files. Randomly named unreferenced temp files,
  including in-memory subagent and reviewer spills, stay for OS temp cleanup: no complete-erasure claim. Reason: no safe
  ownership map exists. Mechanism: README. Since: `db5ab64`.
- **Safe scan** `[D-SESSION-SCAN]`. `artifacts.ts` preflights other sessions before replacement, so discovery errors
  leave the current session active and name the file; malformed JSONL lines are tolerated and scanned conservatively in a
  streamed asynchronous scan; the final JSONL is read after shutdown. Rules and failure behaviour:
  `extensions/RQW-session/README.md`. Research notes: [decisions evidence](notes/decisions-evidence.md#session-research).
  Since: `db5ab64`.
- **Child session tree** `[D-SESSION-CHILDREN]`. Basis: `[D-SESSION-COMMANDS]` (`/remove` deletes the whole session with everything tied to it) and the
  coordinator text (`16-27-59:5090`) quoted in `[D-PIPELINE-PAUSE-RESUME]`: `/remove` removes the child sessions with their parent.
  Taken by default (coordinator text, not an owner quote): after the confirmed Yes, `/remove` also deletes the exact sibling
  `<session.jsonl>.children` tree, its nested descendants and regular sidecar files. RQW-session infers only that suffix and
  imports nothing from RQW-agent. A symlink, special entry or non-directory at the tree refuses removal before the session switch;
  descendant artifact references join the removal candidates, removed children do not count as sharing, and artifacts of surviving
  sessions stay. Descendants go before the parent JSONL, so a failure leaves the parent as marker. Reason: removal must not leave
  orphan child histories. Carrier: `extensions/RQW-session/artifacts.ts` (`childTree`), `index.ts`; proof: `test/extensions/RQW-session/session.test.ts`. Since: `dd93a40`.
- **Proof** `[D-SESSION-TESTS]`. `test/extensions/RQW-session/session.test.ts`: temp agent directories, a stub clipboard,
  refusal paths, artifact and fork preservation, path safety, a real Pi runtime replaced before its JSONL is deleted.
  Mechanics only, not VDI clipboard redirection, forensic erasure or remote deletion. Since: `db5ab64`.

## Send now

- **Enter sends queued steering** `[D-SENDNOW-ENTER]`. While the agent works, Enter with text queues steering as stock;
  Enter on an empty editor while steering is queued interrupts the turn and sends the queue at once; with nothing queued
  empty Enter does nothing; no other key changes (coordinator brief). Stock Pi 1.4.0 needs Escape then Enter.
  Owner: «А ещё надо, чтобы у нас работала, как в OMP, Oh My Pie, отправка: я пишу сообщение, оно стоит в очереди на стекинг, и чтобы я мог через Enter его насильно отправить. Я не разобрался, как в Pi это сделать.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 145);
  «Мне надо, чтобы в Py я мог нажать Enter и сообщение ушло, чтобы не нажимать ебучие Escape, Enter. Это какой-то рак мозга, мне кажется. Надо проверить, можем мы сделать это или нет. Если можем, надо сделать» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 184)
  Carrier: `extensions/RQW-send-now/index.ts`, its own `pi.extensions` entry ([Isolation](#isolation)); behaviour and
  limits: `extensions/RQW-send-now/README.md`. Since: `d1f8b16`.
- **Public API only** `[D-SENDNOW-API]`. Engineering choices: `ctx.ui.onTerminalInput`, `ctx.abort`, editor text,
  `pi.sendUserMessage`; no custom editor, since RQW-statusbar owns `setEditorComponent`. The key is Pi's
  `tui.input.submit`; only Pi's focused input editor triggers it. Steering is told from follow-ups by counting `input`
  events, because the public context reports only whether anything is queued; in-flight inputs and a run's starting
  prompt are accounted for, leftovers after the abort are sent or restored to the editor, and a follow-up-only queue is
  left to Pi. Since: `d1f8b16`.
- **Interrupted reply kept** `[D-SENDNOW-REPLAY]`. For the reply a force-send interrupts, a `context_with_system` handler
  replays its text as a finished reply, kept across resume and `/reload` by the custom entry `rqw-send-now`; thinking and
  unfinished tool calls are dropped. Reason: oh-my-pi keeps the aborted reply; Pi drops it. Since: `d1f8b16`.
- **Limits and proof** `[D-SENDNOW-LIMITS]`. Several queued messages go as one, joined by blank lines; images and custom
  messages in Pi's queue are dropped as with Escape; a steering input swallowed by another extension's `input` handler
  can leave the count stale until the queue empties. Proof: Pi's real `InteractiveMode` on a scripted terminal with a
  faux streaming model, `test/extensions/RQW-send-now/send-now.test.ts`, in `npm test` on macOS and Windows CI.
  Since: `d1f8b16`.

## Providers

- **Own extension** `[D-PROVIDERS-EXT]`. Provider hiding is its own extension, so it does not vanish when the Anthropic
  transport is off; switching either off alone is the [Isolation](#isolation) rule. Owner answer «7a» to the coordinator
  question "Скрытие лишних провайдеров. Сейчас его делает расширение Anthropic. Если его выключить, скрытие пропадёт. a) Вынести скрытие в отдельное расширение": «1a 2a 3a 4a 5a 6b 7a 8a ответы по транспорту» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 2394). Carrier:
  `extensions/RQW-providers/index.ts`, after RQW-anthropic in `pi.extensions`; RQW-codex follows it. Since: `2bf5eac`.
- **Visible providers** `[D-PROVIDERS-ALLOW]`. Only `anthropic`, legacy `openai-codex` and `kimi-coding` (see `[D-MODELS-KIMI]`) are visible in login, pickers,
  `--list-models` and scoped models (`ALLOWED`); Pi 1.4.0's `openai` ("Sign in with ChatGPT", `OPENAI_API_KEY`) stays hidden. Saved credentials stay; previously selected models and explicit SDK lookups are not erased; public `unregisterProvider` is not used because it restores builtins. The policy covers only a runtime with an owning session of this extension, so loading it alone or an unrelated runtime keeps Pi's lists. RQW-anthropic filters nothing; its `registration.ts` and `auth-boundary.ts` carry the conflict guard, credential-store binding and request auth boundary. Owner: «Смотри, в нашем Pi должен быть старый OpenAI кодекс и всё, блядь. Legacy, который через девайс. А новый OpenAI нахуй не нужен, блядь. Я не знаю, что там за глупость новый OpenAI. У нас должен быть вход именно такой же, как сейчас это работает в текущем OpenAI кодексе, и всё, больше никак.» (session `2026-10-21T16-27-59-062Z_01a15f4a`, line 134) Coordinator text (owner quotes C:3171, an omp session, not found in the Pi sessions): "Это именно отключить"; "Когда мы заходим в логин, там должны быть только кодекс, авторизация и авторизация через Anthropic, которую ты сейчас делаешь. И всё". Proof: `test/extensions/RQW-providers/providers.test.ts`. Since: `2bf5eac`.
- **Binding and order** `[D-PROVIDERS-BIND]`. Engineering choices: ownership comes from the patched
  `AgentSession._bindExtensionCore`, because Pi emits no event before `--list-models` and a bindingless `/reload` emits
  no `session_start`; liveness is read from Pi's extension API going stale; the patched `AgentSession.dispose` releases
  the disposed session's instances. Session lifecycle layers in RQW-providers, RQW-anthropic, RQW-settings and
  RQW-codex cooperate through self-contained copies of `rqw:method-chain/v1`: reuse reachable layers, remove only the
  departing owner's layers, preserve survivors and restore the exact stock descriptor after the last cooperating owner
  leaves. Reason: independent transport and visibility toggles must not leave stale lifecycle layers. Carriers: each
  extension's own lifecycle code; `test/providers-anthropic.test.ts`, `test/codex-providers.test.ts`. Manifest order
  remains RQW-providers 14 followed by RQW-codex 15. Limits for foreign non-cooperating wrappers:
  `extensions/RQW-providers/README.md`; research: `notes/anthropic-adapter.md`. Since: `2bf5eac`.

## Theme

- **Thinking greens** `[D-THEME-THINKING-GREENS]`. Owner request in the delegated task, 2026-10-25:
  > in the model/effort chooser's expanded dropdown, `low` should be based on the current `medium` green but twice as pale; `medium` should remain green in the same family as now but noticeably juicier/more saturated.
  Only `thinkingLow` and `thinkingMedium` change. Low is `#80ffc4`, the previous medium `#00ff88` mixed
  halfway toward white in RGB. Medium is `#00df77`, a deeper green at the same hue within RGB rounding.
  The old medium already had maximum HSL/HSV saturation, so richness is obtained by darkening, not by
  claiming a numerical saturation increase. High, xhigh, max, off and unrelated colours stay unchanged.
  Reason: distinguish the two greens without changing the chooser. Carrier: `extensions/RQW-theme/theme.json`;
  the native data-only theme and existing thinking-role rendering remain unchanged.

- **Card background colours** `[D-THEME-CARD-COLORS]`. The four card surfaces of `RQW-theme` are `toolPendingBg` `#222222` (running, dark grey), `toolSuccessBg` `#062b29` (finished, turquoise), `toolErrorBg` `#351c22` (failed, dark red) and `customMessageBg` `#192538` (agent answer, slate). Grey and red keep the owner's choice; turquoise and slate are the analogues of the old green and purple, shifted from green toward blue and tied to the cool text of the source layout. All four have equal OKLCH lightness of about 26 %. They are direct hex values, so no other token changes: `infoBg` keeps `panel`, `selectedBg` keeps `cardHi`, `userMessageBg` keeps `card`; the unused variable `coal` is removed.
  Owner, what he liked: «Мне нравится, что когда ты запускаешь карточки рабочие, у них есть цвета: зелёные — это какие-то команды, фиолетовые — ответы от агентов, серые — это запуски, красные — это отказы.» Source: `16-27-59:4251` (see Provenance above).
  Owner, keep grey and red, find analogues: «А когда запущено то, что было зелёное и фиолетовое, надо придумать им какие-то аналоги.» Source: `16-27-59:4544`.
  Owner, the choice: «По дизайню - бирюза сланец вибираю ответ C» Source: `16-27-59:4654`.
  Reason: option C of the comparison page gave the coolest pair with the least decoration; every text pair on the four cards meets WCAG AA 4.5:1 (minimum 4.56:1).
  Carrier: `extensions/RQW-theme/theme.json`, `test/extensions/RQW-theme/schema.test.ts` (`approved-surfaces-exact`), `extensions/RQW-theme/README.md`. The theme is registered in `package.json` `pi.themes` ([Native theme](#native-theme)); the owner selects it once through `/settings` -> Theme.

## Quality control

- **QA #13 cancellation and quality-focused tests** `[D-QA-13-CANCELED]`. Owner (`16-27-59:9432`, entry
  `d7037e66`, 2026-10-25): «Надо сделать максимально инженерно и просто в соотвествии с нашим манифестом, чтобы это ничего не ломало. Тесты не должны быть суперудушливыми, максимально перфекционистами, анально блокирующими и карающими. Тесты должны проверять качество, не более того.»
  This accepts `await canceled` instead of `assert.rejects` for [QA #13](https://github.com/ARQAWA/my-pi/issues/13),
  asked in assistant entry `05b22f2b`, `16-27-59:9416`. Reason: simple engineering and tests that check quality,
  not perfectionist blocking. Carrier: the existing test-lane QA #13 work; its agent has received the decision.
  This operational record changes no tests or QA issues and claims no QA fix or delivery.

The rules for Main and subagents are in [PROCESS.md](PROCESS.md#quality-control-loop); the design and its evidence are
in the approved proposal (not stored in this repository). The loop reads only public GitHub state.

- **Scheduled full regression** `[D-QA-SCHEDULE]`. Owner: «надо заебашить CI/CD, чтобы у нас тесты наши, полный regress запускался постоянно, каждые три-четыре часа.» and «Может быть, эти тесты запускаются не четыре часа, а раз в два часа, допустим.» Decision: `tests.yml` runs on `main` every 2 hours (cron `17 */2 * * *`, off the top of the hour because
  GitHub drops queued scheduled jobs at high load), `pcli.yml` daily at 03:43 UTC. Task branches get no scheduled
  reruns and nothing retries automatically: an unchanged head is not rerun
  ([Sufficient proof](PROCESS.md#sufficient-proof-without-idle-reruns)). Reason: `main` itself was never tested;
  repeated runs of the same SHA give a free failure rate and catch drift in floating inputs (`macos-latest`,
  `windows-latest`, Node 24, PortableGit). The repo is public, so standard runners bill nothing; the real cost is
  macOS slot contention. Carrier: `.github/workflows/tests.yml`, `.github/workflows/pcli.yml`.
  Since: `3bdac4f`.
- **Failure inbox** `[D-QA-INBOX]`. Owner: «нужно сделать какую-то систему алертинга, какую-то копилку, куда приходят эти падения, и ты проверяешь падения, их разбираешь потом и дорабатываешь в соответствии со всеми нашими требованиями» and «каждая ветка, каждый commit, каждый push в себе хранит историю именно каждой отдельной задачи, и ты в соответствии с ней сможешь всё это дело залайнить и пофиксить тесты». Decision: one GitHub issue per failure signature, label
  `qa-inbox`, written by `qa-inbox.yml` after every completed `main` run (schedule or dispatch) of `tests`, `pcli`
  and `codex-oracle`; every attempt of a run is read, so a manual rerun cannot hide the first failure. The bot owns the
  body and rewrites it in place, never comments, so updates notify nobody. An issue closes only with a `QA: #N` fix
  on `main` and max(6, ceil(3/p)) green scheduled runs after it; each pass also picks up failed `main` runs of the
  last 48 hours that no issue records, so a dropped pass heals; a signature that stopped without a fix closes only
  with a written explanation by Main. Reason: an issue per signature is the link target for `QA: #N`, dedupes one
  bug on several jobs, and keeps state without a server; closing by silence would hide flakes. Carrier:
  `scripts/qa-inbox.mjs`, `scripts/qa-state.mjs`, `.github/workflows/qa-inbox.yml`.
  Since: `3bdac4f`.
- **Public issues** `[D-QA-PUBLIC]`. Decision (engineering choice, from the proposal): the inbox lives as issues in the public repo.
  Reason: test logs and artifacts are already public, and tests use fake credentials and no network
  (`test/no-network.mjs`), so no secrets are expected in evidence. A private inbox would need a second repository.
  Since: `3bdac4f`.
- **Email digest, failures only** `[D-QA-DIGEST]`. Owner: «И мне пусть приходит на почту оповещение о том, что тесты упали, допустим, раз в сутки или два раза в сутки.» and «они будут запускаться, мне будут приходить отчеты о падениях, именно о падениях, а я буду тебе об этом сообщать сам.» Owner answers «1а 2а 3а (но нужна инструкция) 4а» to the questions
  1a "Адрес `chuark@gmail.com`, пароль приложения Gmail сохраняем в секреты репозитория." and 2a "В 09:30 и 21:30 по
  Москве." Decision: `qa-digest.yml` runs at 09:30 and 21:30 Moscow time (cron `30 6 * * *` and `30 18 * * *` UTC)
  and sends one mail through Gmail SMTP with `curl`, only when something failed in its window: a new or recurring
  inbox issue, a failed `main` run, or a failed `qa-inbox.yml` run. The window starts at the previous successful
  scheduled digest run (at most 48 hours back, 12 hours when there is none), so no failure falls between two mails.
  Nothing failed: no mail. Secrets:
  `QA_SMTP_USER`, `QA_SMTP_PASSWORD` (a Gmail app password), `QA_MAIL_TO`. Missing secrets fail the job loudly on
  every scheduled run. Reason: SMTP from the workflow does not depend on GitHub notification settings; the owner
  relays what he gets. Carrier: `scripts/qa-digest.mjs`, `.github/workflows/qa-digest.yml`. The owner's steps are in
  a separate instruction outside the repository.
  Since: `3bdac4f`.
- **GitHub's own Actions emails** `[D-QA-NOTIFICATIONS]`. Owner: «1а 2а 3а (но нужна инструкция) 4а», where 3a is "Ты переключаешь уведомления
  Actions на "только в GitHub", остаётся только наша сводка." Decision: the owner switches Settings, Notifications,
  Actions to "On GitHub" only. Reason: GitHub mails every completed scheduled run to the user who created the
  workflow, with no digest, up to 12 mails a day at a 2-hour cadence; the setting also covers his branch runs.
  Carrier: the owner's account setting, not a file; nothing in the repository can check it.
  Since: `3bdac4f`.
- **Red main does not block merges** `[D-QA-MERGE]`. Coordinator option 4a, accepted by the owner: "Слияния не блокируются, проверка перед слиянием только
  показывает открытые падения." Decision: `deliver-check` lists open `qa-inbox` issues and never fails on them;
  it does fail when a `QA: #N` line names an issue that is not in the inbox. Reason: a flaky or drifting `main` must
  not freeze unrelated work, while Main still sees what is open. Carrier: `scripts/deliver-check.mjs`.
  Since: `3bdac4f`.
- **Awareness through the shared watcher** `[D-QA-STATUS]`. Owner: «Новую задачу ставишь, и чтобы автоматически тебе приходило состояние, когда ты работаешь с бранчой, о том, что нужно проверить запуски CI/CD.» and «И ты сам тоже можешь проверять, если ты в процессе работы находишься, если ты сейчас онлайн. Это не должен быть постоянный, перманентно висящий процесс». Later owner answer (`16-27-59:5060`, entry `46a9e546`): «Окей, насчёт одного скрипта раз в минуту я согласен.» Decision: no timer or local cron; the watcher of [D-PIPELINE-CI-WATCHER] is started on demand and shared. `scripts/qa-status.mjs` (`npm run qa-status`, for subagents) and the dev-only, repo-local `.pi/extensions/qa-status/` read its file instead of making their own `gh` rounds; the extension shows a message on session start and on a changed red state, and `/qa` shows the full view. Main reads the status at task start, tells the owner in one line about a red scheduled `main` and triages it. Reason: the extension is useless outside this repository and must not ship in the package, so it is not an `RQW-*` extension and is not in `pi.extensions`; an unreadable or stale cache is reported as unavailable, never as green. Carrier: `.pi/extensions/qa-status/index.ts`, `scripts/qa-status.mjs`, `scripts/ci-watch.mjs`, [PROCESS.md](PROCESS.md#quality-control-loop).
  Since: `3bdac4f`.
- **Scoped test-review profile** `[D-QA-TEST-REVIEWER]`. Owner: «они должны быть на Sol 6.1 Low, должны работать супербыстро и суперчётко» and «без перфекционизма, без удушья, без жёсткой ёбки».
  Source: the owner's test/code-review prompt request in this repository session, 2026-10-24.
  Decision: use the project Codex TOML profile `test-reviewer` for read-only, bounded test review, inspecting every
  scoped line and reporting real detection gaps or regressions by severity, without invented requirements or nits.
  Reason: tests verify requirements, not a green badge; explicit scope keeps review focused.
  Carrier: `.pi/agents/test-reviewer.toml`; invocation and trigger: [PROCESS.md](PROCESS.md#quality-control-loop).
- **Test integrity** `[D-QA-TEST-INTEGRITY]`. Owner: «нужно именно обеспечивать качество, а не фальсифицировать работу, чтобы тесты были зелёные. Это супер критически важно, потому что эти тесты и вся наша работа — это всё обеспечение контроля качества.» and «Можно даже ревьюера поднимать, который перепроверяет тесты.» Decision: before any fix Main records a triage
  class (product bug, test bug, infra, drift) with evidence; a fixed list of weakening changes is forbidden without
  proof; a fix needs red-before/green-after in CI logs, and an intermittent one repeat runs with (1-p)^n < 0.05 (generic repeat harness `codemode-stress.yml`).
  A reviewer subagent with `agent_type: "test-reviewer"` checks only a test or workflow
  change that `deliver-check` mechanically detects as weakening a check (skip, todo, retry, raised timeout,
  continue-on-error, fewer assertions), not every QA fix ([D-PIPELINE-TEST-LANE]); the gate then requires the trailers
  `Test-change:` and `Test-review: agent#N CLEAN` (exact conditions: [PROCESS.md](PROCESS.md#quality-control-loop)). Reason: the aim is a working
  product, not a green badge; a weakened assertion turns a real failure into silence. Carrier: `PROCESS.md`,
  `.pi/agents/test-reviewer.toml`, `scripts/deliver-check.mjs`.
  Since: `3bdac4f`.
- **Daily Codex oracle** `[D-QA-CODEX-SCHEDULE]`. `.github/workflows/codex-oracle.yml` runs daily on `main` at
  `03:43 UTC` with the normal pinned oracle, capture integrity and native differential checks. Manual diagnostic
  inputs remain dispatch-only. `qa-state.mjs` and `qa-inbox.yml` accept the workflow name `codex-oracle`.
  Owner accepted the daily compatibility check with answer «1а 2а 3а (но нужна инструкция) 4а» (session
  `2026-10-21T16-27-59-062Z_01a15f4a`, USER `baecafb2`, physical JSONL line 4128).
  Reason: the pinned subscription protocol must remain checked after delivery; minute 43 avoids top-of-hour load.
  Since: `3bdac4f`.
- **Closed issue acknowledges a failed main run** `[D-QA-ACK]`. Source: Owner task message, 2026-10-23, qa-status
  acknowledgement defect:

  > Defect found by triage: after a Pi restart the qa-status extension reports two deliberate QA canary runs on main (39982873982, 39979775666) as new red, although their only failure is covered by qa-inbox issue #1, closed by hand with an explanation.
  >
  > Fix: in scripts/qa-status.mjs treat a failed main run as acknowledged INFO only when every failure signature of that run is an occurrence recorded in a closed qa-inbox issue (use the shared format in scripts/qa-state.mjs); a run with any other failure stays red. Do not special-case qa_canary.

  Before the fix, after a Pi restart `qa-status` reported the two canary runs as new red although their failure was in
  `qa-inbox` issue #1, closed by hand with an explanation. Decision: `qa-status` shows a failed
  scheduled or dispatched `main` run of `tests` or `pcli` (not `qa-inbox` or `qa-digest`) as `info` (text `acknowledged: every failure is in closed qa-inbox issue #N`) only when
  every failure signature of that run is an occurrence (run, attempt, job) of the same signature in a closed `qa-inbox`
  issue, and no open issue records it. The signatures come from the same code as the bot (`collectRunFailures` in
  `scripts/qa-inbox.mjs`: jobs of every attempt, TAP evidence, else the failed step), compared through the shared format
  of `scripts/qa-state.mjs`. Anything else stays red: another failure of the run, a capped or missing occurrence, an
  empty failure list, evidence that cannot be downloaded or read, a failed `gh` call, a run that no closed issue records.
  Expired or missing evidence is not a failure of the read: as in the bot, the failed step gives a job signature, and that
  signature is acknowledged only when a closed issue records it for the same run, attempt and job. No test name
  is special-cased. The gh reads that only GitHub can give (closed issues, jobs, artifacts, TAP evidence) happen once in
  `npm run ci-watch -- --refresh-inbox` (`scripts/qa-inbox-snapshot.mjs`), for the failed main runs found in the watcher file
  `status.json` and recorded by some closed issue, and the result is stored in `inbox.json`; `qa-status` itself never
  calls `gh`. A failed run that appears after the last refresh stays red until the next refresh. The extension memory is
  unchanged: acknowledgement lives in the snapshot, so a restart shows no red for acknowledged runs. Reason: a signature closed on purpose must not come back as new red at every
  restart, yet a run with one more unknown failure must not be hidden. Carrier: `scripts/qa-inbox-snapshot.mjs`,
  `scripts/qa-runs.mjs`, `scripts/ci-watch.mjs`, `scripts/qa-status.mjs`, `scripts/qa-inbox.mjs`,
  `test/qa-inbox-snapshot.test.ts`, `test/qa-status.test.ts`, `test/ci-watch.test.ts`. Since: the delivering commit of branch `qa-status-ack`.

## Codex subscription transport

Owner (verbatim, sessions `16-27-59:2346`, `16-27-59:2348`, `16-27-59:2353` in that order): «Нас вообще не интересует ничего, что касается API. Мы работаем только через подписку Codex и всё, что касается Codex и Mechanics Codex CLI, только это для нас имеет значение»; «Надо, чтобы наш Codex провайдер работал как в Codex CLI. Можешь сделать для этого extension, как мы делали для антропиков, который приводит, алайнит их к абсолютно идентичному поведению?»; «Да, получается, у нас будет полностью заменены два транспорта: один транспорт GPT, второй транспорт кодекса. И авторизация кодекса должна быть только по device ID и всё.»

Owner transport answers (verbatim, `16-27-59:2394`): «1a 2a 3a 4a 5a 6b 7a 8a ответы по транспорту». The agreed mapping is GPT via the Codex subscription: provider `openai-codex`, API identifier `openai-codex-responses`. Pi's separate `openai` provider is not another GPT transport to implement or a fallback. Anthropic remains owned by RQW-anthropic.

- **Reference** `[D-CODEX-REFERENCE]`. Pin Codex CLI stable 0.163.0, peeled commit `83086188ae0614bd882818ff1aa23f3194962012`; upgrade only manually with source review and renewed fixtures. Match the application protocol for equivalent inputs, not Rust TLS fingerprints or the entire Codex harness. Reason: a reproducible, honest parity target. Carriers: `extensions/RQW-codex/profile.ts`, source/oracle fixtures and `.github/workflows/codex-oracle.yml`.
- **Identity** `[D-CODEX-IDENTITY]`. `codex_cli_rs` / 0.163.0, actual host/terminal, truthful sanitized workspace/git/tool metadata, a new adapter-owned installation UUID. Never copy another tool's installation identity or fabricate sandbox, Guardian or attestation guarantees. Reason: the accepted exact-client identity includes actual metadata, not false capabilities. Carriers: `metadata.ts`, `wire.ts` in RQW-codex.
- **Login/migration** `[D-CODEX-LOGIN]`. New logins directly use device code, without browser selection, loopback callback, pasted-code alternative or browser fallback. Keep a valid existing `openai-codex` OAuth grant in its native slot, preserving unrelated fields. Never import `openai`, another provider's grant, `~/.codex` or API-key billing. Refresh/401 recovery use the native credential-store transaction and authenticated owner guard. Reason: only the Codex subscription is in scope, rotating grants must remain safe. Carriers: `auth.ts`, `auth-boundary.ts`, `lifecycle.ts`, `index.ts`.
- **Prewarm** `[D-CODEX-PREWARM]`. One native `generate:false` startup request and a native idle prewarm when the connection needs preparation; a healthy prepared socket skips it. No periodic cache keepalive or synthetic assistant inference. This explicitly supersedes the former first-real-message-only rule for this Codex mechanism only; RQW-settings still disables Pi's generic background warmer. Reason: accepted 4a. Coordinator/result-review clarification (verbatim): “Implement self-contained automatic idle prewarm once when session becomes idle and prepared connection needs preparation, using current full/compacted history via public lifecycle seams, not external host event.” Reason: accepted 4a requires a package producer, not merely an optional host API. Carriers: the RQW-codex controller's public session subscription (`agent_settled`, manual `compaction_end`) and one cancellable deferred idle check, the existing native transport/prepared-connection guard, and the optional RQW-prompt startup-projection service. No periodic polling or normal inference is scheduled; aborted runs skip, new busy work/disposal cancel automatic work, and the existing explicit host API remains optional. The native Codex exception does not enable Pi's generic cache warmer; `session-prefix.ts` preserves pending system-section update placement and current tool declarations, using Pi's public tool-state helpers and a minimal MIT pure prompt-builder port. An explicit internal forced-startup flag from the owning child factory selects Pi's forced projection; no force is guessed from a subagent kind or advertised as a backend capability. Known child prompts use the child's own normalized base options, not the parent root's projection handlers. Visible catalogs and historical declaration projections respect Pi's hidden-tool set, including compaction. The projection does not mutate the Pi transcript or invoke future user hooks.
- **Retries** `[D-CODEX-RETRIES]`. Own native HTTP, stream and finite reload→refresh recovery; connection-failed sampling reconnects without a count limit, 5 s to 60 s, cancelable. Suppress overlapping Pi retries for owned Codex failures only, not other providers. Reason: accepted 5a without multiplied budgets. Carriers: `retry.ts`, `errors.ts`, `transport.ts`, `lifecycle.ts`.
- **Simple compaction** `[D-CODEX-SIMPLE-COMPACTION]`. Owner (verbatim, user message `0b2802ec`, `2026-10-23T23:45:56.053Z`, physical JSONL line 5073 of `2026-10-21T16-27-59-062Z_01a15f4a-7ad5-7377-81be-0baf3b6ffa33.jsonl` in the owner's external Pi session directory): «Да простое сжатие делаем». It answered the coordinator's question at line 5067 of the same file (assistant message `a0ff37e5`, coordinator text, not an owner quotation) whether to do simple compaction for Codex now and to take the replacements of Pi internals apart as a separate task. Coordinator technical decision (option P), not an owner quotation:
  - Coordinator technical decision, not an owner quotation (mechanism correction; the owner quote above is unchanged): Pi runs its own compaction. Pi's own default summary generator produces the summary and Pi appends the normal `compaction` entry, the summary written by the same GPT model. The extension does not call `compact` itself and does not return a result from `session_before_compact`: that public event only prepares the auxiliary transport and provider payload callbacks for the summary request, and it never returns `cancel: true` for a server error. A failed summary is Pi's standard compaction error (`Compaction failed: ...` or the automatic variants), not an extension message. The public `session_compact` event resets the history and transport state. The summary request goes through the RQW-codex Codex transport and is routed per request, because Pi 1.4.0 gives each summary call a fresh routing session id (`dist/core/compaction/compaction.js:483`; `dist/core/agent-session.js:2209` passes none) and the former bound-session lookup refuses an unknown id (`registration.ts:200-209`).
  - No native `compaction_trigger`, opaque compaction item or checkpoint entry is produced while Pi has no public native compaction hook. The six replacements of `AgentSession` compaction methods (`compact`, `_runAutoCompaction`, `_exceedsCompactionThreshold`, `_checkCompaction`, `_compactBeforeNextAssistantResponse`, `getContextUsage`) are removed, not kept beside it. Native V2 request building and checkpoint code, if it stays in the tree, is non-running source: not registered, not run, not an active behavior and not evidence of compaction parity.
  - Pi's own threshold, compaction animation, chat summary entry and `session_compact` events apply unchanged. RQW-context still owns the trigger: W = min(contextWindow, 500000), R = round(W/10), threshold W−R, existing explicit reserve precedence.
  - Portability: the session keeps every original physical entry, but after a compaction the active context is Pi's summary plus the kept tail, for Codex and, with RQW-codex disabled or another provider, for every model. The full original history is no longer replayed to other providers; stock Pi behavior replaces the earlier retained-history promise.
  - Parity exception: Codex backend V2 compaction is not matched. The native fixture and oracle captures stay unchanged (ten provenance cases) and the oracle still runs the full native reference. The active adapter differential replays the transport and retry cases only (7); the three native compaction cases are no longer replayed against the adapter, and stock compaction is checked by `test/extensions/RQW-codex/standard-compaction.test.ts` and `test/extensions/RQW-codex/stock-compaction-history.test.ts` (see [Native differential checks](#native-differential-checks)).
  - Reason: Pi 1.4.0 has no public native compaction hook. A public result is only `{cancel?, compaction?}`, the interactive `compaction_end` handler requires a Pi `compaction` entry first in the context (`dist/modes/interactive/interactive-mode.js:2963-2966`, error `Completed compaction is missing from the session context`, which the former hook triggered), and Pi has no public way to take an effective wire token count: coordinator probes of 2026-10-24 show repeated compaction and a physical estimate of 64 109 tokens against a threshold of 18 000 after a native-style compaction (temporary logs `/tmp/codex-public-compaction-probe.log`, `/tmp/codex-option-p-probe.log`, outside the repository; a stock simulation with a fake summary transport, not an RQW-codex integration run). An upstream request for a public native compaction and context-accounting hook exists only as the unfiled draft `/Users/arkadijcukavin/ai-project/my-pi-evidence/codex-parity/PI-NATIVE-COMPACTION-ISSUE-DRAFT.md`.
  - Not claimed: RQW-codex is not fully on public Pi API. Lifecycle, auth and prompt seams still use private Pi internals; migrating them is the separate backlog task [CODEX-PUBLIC-INTERNALS](BACKLOG.md#codex-public-internals), not part of this decision.
  - Carriers under `extensions/RQW-codex/`: `session-compaction.ts` (the public `session_before_compact` handler that prepares the auxiliary transport and payload callbacks, and the `session_compact` handler that resets state; the summary is Pi's own), `registration.ts` (routing of Pi's summary request to the direct transport only during an active Pi compaction), `session.ts` (`afterPiCompaction`: drop prepared work and refresh the owned state when a new Pi compaction entry appears), `history.ts`, `session-history.ts` and `portable-history.ts` (native wire state retired at a persisted Pi compaction boundary), `README.md`; RQW-context stays the threshold owner. Supersedes `[D-CODEX-COMPACTION]` and `[D-CODEX-HISTORY]` (archived verbatim as A-0259 and A-0260 in `DECISIONS-ARCHIVE.md`), the compaction parts of the native differential paragraph (A-0261) and the former ledger row (A-0262).
- **Offline capabilities** `[D-CODEX-OFFLINE]`. Owner answer (verbatim) «1а 2б» (user message `92037bbf`, physical JSONL line 2414 of the same external session). Coordinator option 2b summary, not an owner quotation: use only the pinned model list, without server discovery requests. No `/models` discovery requests. Pin the 0.163.0 wire-capability records for our listed GPT models; unknown capability is a clear error, never guessed from a prefix. Pi/RQW model lists and picker stay authoritative. Reason: accepted 2b deliberately excludes this native startup network request. Carriers: `profile.ts`, `test/extensions/RQW-codex/fixtures/stable-models.json`.
- **Ownership/coexistence** `[D-CODEX-OWNERSHIP]`. Provider hiding lives in the independently switchable `extensions/RQW-providers`, not in Anthropic or Codex transport registration. RQW-providers remains extension 14; RQW-codex is extension 15 immediately after it in `pi.extensions`. RQW-settings alone owns `/fast-gpt`, default off, priority through final payload hooks; child inheritance/overrides, including reviewer profiles, remain in RQW-agent. Children share native root cache affinity but never socket continuation, sticky turn state or opaque history. Reason: accepted 7a and extension isolation. Carriers: RQW-codex registration/lifecycle, optional `rqw-codex:session-policy` event in child factories; existing Fast owners unchanged.

### macOS oracle fixture

Coordinator technical decision, not an owner quotation: adapt only the temporary harness fixture on `darwin`; retain the existing `listen(128)` and every native assertion and timeout. Reason: the macOS fixture's bound socket without `listen` kept connections pending instead of refusing them; the fixture-only lifecycle adaptation restores the intended refusal/recovery sequence. Proof: [one-shot native connect run 39951670171](https://github.com/ARQAWA/my-pi/actions/runs/39951670171). The previous English authorization wording came from coordinator instructions, not a verified user-role message.

The pinned retry fixture holds a bound socket without listening until recovery. On the CI macOS runner this stalls TCP connection establishment instead of producing the connection refusal the test needs. The [one-shot native connect evidence](https://github.com/ARQAWA/my-pi/actions/runs/39951670171) records both raw TCP and direct HTTP pending beyond 12 seconds while held, then `ConnectionRefused` with errno 61 immediately after release; the listening control succeeds. This establishes the socket-state cause behind the coordinator's fixture-only technical decision, not a subscription transport change or broader owner permission to modify native tests.

Only the temporary `core/tests/suite/retry_after.rs` copy on `darwin` is adapted. Its pinned preimage SHA-256 `2437e45336c5d3e811158aeb43963992860499cc1e9e66b939ad223d9e4d12af` and exact-once anchors are checked. Release the unavailable socket immediately after reading its address; at recovery create a fresh `TcpSocket`, bind that same address and retain the existing `listen(128)`. Native assertions, retry counts, delays and timeouts are unchanged. Other platforms and original source checkouts remain unchanged. Address reuse fails explicitly rather than choosing another port. Carriers: `extensions/RQW-codex/scripts/capture-oracle.mjs`, `test/extensions/RQW-codex/oracle-harness.test.ts`; `run.json` declares `adaptedFixtures` with identity, platform, reason, source/adapted hashes and the evidence URL, checked by `checkOutput`. Diagnostic success is not full oracle acceptance; the corrected case is verified inside the normal full oracle run on the final head.

### Native differential checks

Coordinator technical implementation, not an owner quotation: replay pinned native responses through the real RQW-codex extension in a Pi `AgentSession` and compare the adapter's ordered request projection with the native capture projection. Reason: native oracle success alone does not establish adapter parity. `test/extensions/RQW-codex/fixtures/native-differential.json` pins [normal oracle run 39956439677](https://github.com/ARQAWA/my-pi/actions/runs/39956439677), my-pi head `fe3e9ec554070811a76eb5403934b753825e67df`, with 10 cases: transport 4, retry 3, compaction 3. The shared projection checks transport/endpoint, turn state, request kind, turn grouping, retry-body identity and conversation replay; selected cases also compare content encoding. Since `[D-CODEX-SIMPLE-COMPACTION]` the fixture, the pin script and the oracle workflow are unchanged, and the oracle still runs the full native reference with all ten cases. The active adapter test `test/extensions/RQW-codex/native-differential.test.ts` replays the transport and retry cases only (7); the three compaction cases stay in the fixture as provenance of the native mechanism, which the adapter no longer runs, and are not replayed against it. The adapter's stock compaction is covered by `test/extensions/RQW-codex/standard-compaction.test.ts` and `test/extensions/RQW-codex/stock-compaction-history.test.ts`.

Carriers: `extensions/RQW-codex/scripts/pin-native-differential.mjs`, `test/extensions/RQW-codex/native-differential.mjs`, `test/extensions/RQW-codex/native-differential.test.ts` and the fixture above. Normal `.github/workflows/codex-oracle.yml` runs regenerate the fixture projection and reject drift in the case list, cited source digests, scripted stimuli, native request projections and selected encodings. Capture hashes retain baseline provenance; per-run UUIDs and timestamps are not required to match. Replay uses injected network seams and fake credentials. Source-backed `Retry-After` sleeps are compared with a deterministic clock rather than elapsed wall time; explicit fallback cases check upgrade order/count, and the drift contract includes all stable replay configuration fields. Actual WebSocket frame replay is not covered, nor is live subscription acceptance; the baseline native run is not a claim that the new differential checks have already passed CI.

### Codex exception ledger

| Not identical | Reason / boundary | Carrier |
| --- | --- | --- |
| RQW prompts, tools, codemode, context W/R and Pi UI/steering/delivery semantics | Explicitly retained by 2a and the 6b clarification; equivalent-input protocol parity is not identical model answers or the entire Codex harness | RQW-prompt/tools/context/agent/review and native codec |
| No native `GET /models` discovery | Explicit 2b; pinned offline capabilities, unknowns fail clearly, no picker expansion | RQW-codex profile and snapshot |
| Device-only login; browser/PKCE mode excluded | Explicit owner requirement and 8a; existing valid Codex grant retained | RQW-codex auth |
| Compaction method | Owner choice of simple compaction, `[D-CODEX-SIMPLE-COMPACTION]`: stock Pi summary compaction through the Codex transport; no native `compaction_trigger`, opaque window or retained-original-history replay, because Pi 1.4.0 has no public native compaction hook | RQW-codex compaction registration; stock Pi |
| Rust vs JS networking, TLS/ALPN/packet timing, transport-generated ordering and zstd library bytes | A TypeScript overlay is not a Rust networking implementation; compare decoded body plus documented application-level normalization, never claim packet indistinguishability | WS/SSE/compression connectors and oracle captures |
| Stronger cross-process credential-store locking | Preserve Pi's native transaction and rotation persistence; never write auth JSON directly | Auth boundary/lifecycle |
| Optional managed workspace discovery, Agent Identity, enterprise FedRAMP, signed attestation, private Guardian, memory/hosted-tool modes | Not the ordinary stable bearer profile; never advertise invented entitlements or silently route unsupported accounts | Auth/metadata validation; ordinary profile only |

Deterministic fixtures and fake-server tests prove mechanics, not live backend acceptance, identical answers, cache retention, quota billing, or zero-cost prewarm. Any remaining implementation/verification gap must be reported rather than silently added to this exception ledger as permission to narrow scope.

## Web search

The shipped independent `web` tool lives in `extensions/RQW-web/`; Contract: [RQW-web README](extensions/RQW-web/README.md). Research and ready-made alternatives: `/Users/arkadijcukavin/ai-project/my-pi-evidence/web-search/RESEARCH.md`. Superseded phase-1-only text is preserved in [the archive](DECISIONS-ARCHIVE.md#a-web-phase1--archived-2026-10-24--web-search-cli).

- **Own thin implementation** `[D-WEB-CLI]`. Owner (`16-27-59:4782`): «Надо посмотреть ее кишки, взять ее базу, облегчить ее.» Owner (`16-27-59:4888`): «Это будет просто CLI, которую агент будет вызывать из shell.» Owner (`16-27-59:4917`): «Делаем клон Codex, чтобы наш агент работал с этой хуйнёй так же, как с Codex.» The owner ordered a lightweight own base. Researched alternatives were not adopted: actively maintained MIT `pi-web-access` 0.44.0 has 9 direct dependencies, 208 lock entries and about 10.3 MB unpacked, many unrelated providers and features, and a different normal OpenAI search path; a separate Codex CLI duplicates the agent environment/auth; API-key Responses has different billing. Only batching, sourced answers, explicit errors and overflow continuation ideas are reused. Carrier: `extensions/RQW-web/`.
- **Tool interface** `[D-WEB-INTERFACE]`. Owner (`16-27-59:4917`): «Если для агента это будет тяжело, то сделай две команды. А если казуально, то оставь одну» One tool `web` takes nonempty `queries` OR `urls`, optional URL-only `focus`, `mode: cached|live|indexed` and `response_length: short|medium|long`. It returns concise summaries, supporting links, statuses and actual search model/thinking. Carrier: `extensions/RQW-web/tool.ts`, `description.md`.
- **Automatic model mapping** `[D-WEB-MAPPING]`. Owner (`16-27-59:4941`): «Да, всё именно так, как ты записал.» Owner (`16-27-59:4937`): «Давай так: для Haiku 5.5 будет Luna 5.6. Для Sonnet 5.5 будет Sol 6, а для Opus 5.5 будет Sol 6.1. Вот и всё.» Owner (`16-27-59:4945`): «Не как аргументы CLI, а на уровне функционала tooling всё это будет пробрасываться, форвардиться» The tool captures `ctx.model` and its own Pi API's `getThinkingLevel()` at each invocation, not the coordinator model; model arguments are absent. The model rule stays in [D-SCOPE-WEB-SEARCH-MODEL](#scope).

  | Calling model | Search model | Thinking |
  | --- | --- | --- |
  | Recognized `openai-codex` GPT | Same exact model | Same level |
  | `anthropic/claude-haiku-5-5` | `gpt-5.6-luna` | Same level |
  | `anthropic/claude-sonnet-5-5` | `gpt-6-sol` | Same level |
  | `anthropic/claude-opus-5-5` | `gpt-6.1-sol` | low -> low, medium -> high, high -> xhigh, above high -> max |
  | `kimi-coding/*`, including future caller models | `gpt-6.1-sol` | low -> low, high -> medium, max -> high |
  | Unknown or missing model, including unknown GPT slug | `gpt-6.1-sol` | low |

  Owner, current task session `web-kimi-sol-effort`, 2026-10-25: «Kimi `low` -> `openai-codex/gpt-6.1-sol` `low`.»
  «Kimi `high` -> `openai-codex/gpt-6.1-sol` `medium`.» «Kimi `max` -> `openai-codex/gpt-6.1-sol` `high`.»
  Reason: align Kimi caller reasoning with Sol 6.1 while retaining the existing web-only Codex subscription engine.
  Owner clarification, same task session: «the mapping is by PROVIDER, not a hardcoded list of four model IDs.»
  The mapping applies to every current or future `kimi-coding/*` caller; it changes neither the caller model nor session naming.

  Owner's fallback (`16-27-59:6331`, entry `e3aba5d4`): «если короче это модель не опознанная то всегда по дефолту 6.1 сол лоу юзать» Known callers with unsupported thinking fail explicitly; Claude `off` and `minimal` stay unmapped. Carrier: `extensions/RQW-web/core/model-map.ts`.
- **Engine** `[D-WEB-ENGINE]`. The existing Codex CLI 0.164.0 source research selected the Responses Lite path `web.run -> POST alpha/search -> function_call_output -> sourced answer`, not hosted-only `web_search`. Each target has an ephemeral web-only loop, no Pi AgentSession, stored history, provider registration, prewarm or compaction. Pure transport/auth code is a minimal local snapshot with original path and commit headers; no import reaches another extension. The snapshot retains the existing 0.163.0 transport pin. Reason: preserve the researched subscription mechanism while keeping RQW-web independently switchable. Carrier: `extensions/RQW-web/core/`, `vendor/`.
- **Read-only credentials** `[D-WEB-AUTH]`. The public `readStoredCredential` supplies only saved `openai-codex` OAuth. No auth writes, copied auth files, refresh, private ModelRuntime credentials or API-key/other-provider fallback. Missing, expiring or rejected login returns a hint to use Pi for refresh or `/login openai-codex`, then retry. Carrier: `extensions/RQW-web/core/credentials.ts`.
- **Defaults and bounds** `[D-WEB-DEFAULTS]`. The tool retains the existing search behavior: `cached`, `short`, three concurrent targets with the rest queued, target timeout 120000 ms, input-order results with independent errors. Normalized model-facing output is capped at 2000 lines or 48 KiB; overflow returns a full-result path and exact next line rather than another paid request. No raw reasoning, headers or secrets are written. Each target consumes subscription usage, with no requested GPT Fast. Carrier: `core/batch.ts`, `core/report.ts`, `core/truncate.ts`.
- **All agents, independent loading** `[D-WEB-ACCESS]`. Owner (`16-27-59:4917`): «Это будет инструмент, который будет доступен всем агентам, и воркеры будут типа нашей матрицы агентов и исполнителей, она никак не меняется.» Normal package loading registers `web`. RQW-agent receives the optional `rqw-search:subagent-web` offer on `pi.events` and registers against each child's own API, recursively. It needs neither RQW-tools nor RQW-codex enabled. Disabling RQW-web removes its main tool and offer; existing children retain their startup tools until restarted. Carrier: `package.json`, `extensions/RQW-web/index.ts`, `extensions/RQW-agent/index.ts`.
- **Cross-platform ordinary temporary files** `[D-WEB-TEMP-FILES]`. Owner (`16-27-59:6372`, entry `f7f8b0ad`, 2026-10-24): «Насчет этой хуйни, заморочки с файлами на разных пользователей — поебать вообще» and «Не надо никаких заебов. Надо просто, чтобы все работало стабильно, быстро, производительно и эффективно». Overflow uses ordinary OS temporary files on every platform, with no explicit POSIX modes, per-user privacy contract, NTFS ACL handling or privacy assertions. This overrides the former phase-1 private-file requirement and the proposed NTFS treatment. Windows tests exercise actual behavior without mode-bit assumptions. `.gitattributes` pins `web-native-tools.json` with `-text` because the exact source-provenance hash must survive Windows checkout conversion. Carrier: `core/truncate.ts`, `.gitattributes`, web tests.

- **Remove the terminal entry** `[D-WEB-REMOVE-CLI]`. Owner, current repository session, 2026-10-25: «эту хуйню удалить». The obsolete terminal command and its dedicated tests and dependency are removed; the shipped `web` tool replaces it. Full order and superseded decision: [archive](DECISIONS-ARCHIVE.md#a-web-cli-removed---archived-2026-10-25). Carrier: `extensions/RQW-web/`, `package.json`.

Since: web-search-tool.
