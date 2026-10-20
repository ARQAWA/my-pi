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
- `INSTALL.md` is the install prompt: the user runs it inside an already installed Pi, and that Pi installs this
  package into itself with `pi install` and asks for `/reload` (user: «чтобы можно было его везде воссоздавать,
  воссобирать с нуля, просто промтом одним через install prompt»; «install.md — это про установку именно наших обвесов
  на уже установленный Pi. Я внутри Pi запускаю этот промпт»).
- The start was empty: both extensions were no-ops. The prompt is built first, everything else after it (user: «Старт
  должен быть пустой... сначала надо сделать промпт пиздатый, а потом всё остальное будем делать»).

## Prompt

- First step is only the prompt extension (user: «пока делаем только экстеншен который заменяет промпт систменый на
  наш»). `extensions/prompt/index.ts` sets `systemPromptOptions.customPrompt` in `before_agent_start` to
  `extensions/prompt/SYSTEM.md` plus the workstation, `<critical>`, environment and date blocks. Not
  `forceSystemPrompt`: Pi still appends project context, skills and `<cwd>` and records the prompt as sections.
- The text follows the concept in `notes/prompt-concept.md` and starts from the bench41 template, the only measured
  version on Pi (+10.2 / +6.2 / +1.9 quality points on gpt-6-sol low / gpt-6-sol medium / gpt-6.1-sol medium).
- The search wave method stays a `<search_method>` section of the prompt, since Pi's tools are stock and their
  descriptions are not ours; the `<critical>` verify line stays as in omp-lite. Both are the recommended options the
  user did not overrule.
- Added against bench41: one speed-block line to write a file longer than about 400 lines in parts (omp-lite carried it
  in its `write` description; bench35 lost a response to the output limit). Removed against bench41: the working
  directory from the date line, because Pi already appends `<cwd>`.
