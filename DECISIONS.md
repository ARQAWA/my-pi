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
- `INSTALL.md` is the install prompt: one prompt to an agent rebuilds the working Pi anywhere from scratch (user: «чтобы
  можно было его везде воссоздавать, воссобирать с нуля, просто промтом одним через install prompt»).
- The start is empty: both extensions are no-ops. The prompt is built first, everything else after it (user: «Старт
  должен быть пустой... сначала надо сделать промпт пиздатый, а потом всё остальное будем делать»).
