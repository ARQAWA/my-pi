# my-pi: decisions

Every accepted decision, with its reason and the file that carries it.

## Scope

- my-pi is built on stock Pi 1.3.0 with its own tools (`read`, `bash`, `edit`, `write`); the interface and the omp-lite
  tools are dropped (user: «Давай полностью отбросим все UI припоны и оставим только чистую механику и промпты»,
  «Так же мы можем отбросить тулинг»).
- Reason: bench41 (`~/Documents/ChatGPT/my-omp-harness/bench/bench41.csv`, T01-T07, 3 runs): the omp-lite prompt alone
  raised stock Pi by 10.2 quality points on gpt-6-sol low, 6.2 on gpt-6-sol medium and 1.9 on gpt-6.1-sol medium;
  omp-lite beat that only on low (+3.5) and was lower and slower on both medium configs.
- The harness is assembled step by step, starting with the prompt (user: «здесь будем собирать по шагам эту обвязку.
  Начнём с промта»).

## Prompt

- The prompt replaces Pi's default prefix through `systemPromptOptions.customPrompt` in `before_agent_start`
  (`extensions/prompt.ts`), not through `forceSystemPrompt`: Pi still appends project context, skills and cwd, and
  records the prompt as transcript sections.
