# my-pi: decisions archive

Append-only record of superseded and obsolete entries removed from [DECISIONS.md](DECISIONS.md). Current rules are
in `DECISIONS.md`; this file is only for checking history. Each block is the text exactly as it was in
`DECISIONS.md` at `30952e6`, with `> ` added at the start of each line. Do not edit a block after it is added.

## A-0001 · archived 2026-10-23 · Work policy · Old development worker models (Sonnet medium/high/xhigh, Opus low only)

Status: SUPERSEDED by `[D-WORK-MODELS]` (DECISIONS.md#work-policy).
Introduced: `8f2ea64`. Superseded: `57fa3ff`. Archived by: the coordinator-guard change.
Verbatim text as it was in DECISIONS.md at `30952e6`, lines 19-21:

> - (Superseded, see the current rule below.) Development workers, including subagents, were authorized to use
>   Sonnet medium/high/xhigh, Opus low only and GPT-6.1-Sol low/medium/high. This is development routing only, not a product model configuration or permission to add other
>   GPT models. Product review `LEVELS` remain Haiku 5.5 medium / Sonnet 5.5 low.

## A-0002 · archived 2026-10-23 · Work policy · Claude limit: Sonnet only, Opus low and medium removed

Status: SUPERSEDED by `[D-WORK-MODELS]` (DECISIONS.md#work-policy).
Introduced: `47868b0`. Superseded: `57fa3ff`. Archived by: the coordinator-guard change.
Verbatim text as it was in DECISIONS.md at `30952e6`, lines 22-24:

> - Owner: «Что-то подписка Cloud Code жёстко высаживается, поэтому давай пока уберём из работы саб-агентов Opus Low и Opus Medium. Давай оставим Sonnet Medium, Sonnet High, Sonnet Extra High. Для сложных задач будет Sonnet Extra High либо Opus Low. Opus Medium убираем вообще пока. Окей. Это надо скорректировать, отразить и сразу в работу внедрить»
>   Reason: the Claude subscription limit is running out; the restriction is temporary ("for now"). The balance rule
>   between Anthropic and GPT stays. Superseded by the next entry.

## A-0003 · archived 2026-10-23 · Work policy · Development worker models and parallel limit (Opus low or Sol low for ordinary work)

Status: SUPERSEDED by `[D-WORK-MODELS]` (DECISIONS.md#work-policy) and `[D-WORK-PARALLEL]` for the parallel limit.
Introduced: `57fa3ff`. Superseded: `0179c98` (model assignment; the parallel limit continues as `[D-WORK-PARALLEL]`). Archived by: the coordinator-guard change.
Verbatim text as it was in DECISIONS.md at `30952e6`, lines 25-39:

Note: the first five quotes are paragraphs of one owner message (session file `2026-10-21T16-27-59-062Z_01a15f4a-7ad5-7377-81be-0baf3b6ffa33.jsonl`, line 2462); the sixth is the whole message at line 2464.

> - Development worker models and parallel limit. The parallel limit below is current; the model assignment is
>   superseded by the next entry. Owner, in order:
>   «ТАк вот все верно там написано давай не выдумывай хуйню»
>   «Одновременно до 10 первого уровня, вложенные похуй»
>   «модели - Соннет хай, и опус лоу / 6-1 лоу и медиум»
>   «опус и 6-1 лоу для обычной работы, для сложной хай соннет и медиум 6-1»
>   «вот так хочу переделать эту часть»
>   «блять не для сложных сделай опус медиум все таки»
>   Rule at that time (model assignment superseded by the next entry): ordinary work uses Opus 5.5 low or GPT-6.1-Sol low;
>   complex work uses Sonnet 5.5 high, Opus 5.5 medium or GPT-6.1-Sol medium; no other models or levels for
>   development workers. Current: at most 10 first-level subagents (started
>   by the coordinator) run in parallel; nested subagents do not count; a ceiling, not a quota. The even
>   Anthropic/GPT balance stays. Product review `LEVELS` are unchanged.
>   Reason: owner decision. The limit is carried by [PROCESS.md, Isolated parallel execution](PROCESS.md#isolated-parallel-execution)
>   and `AGENTS.md`.

## A-0004 · archived 2026-10-23 · Work policy · Development worker models, 2026-10-23 rule (simple Sonnet high, complex Opus medium)

Status: SUPERSEDED by `[D-WORK-MODELS]` (DECISIONS.md#work-policy).
Introduced: `0179c98`. Superseded: the coordinator-guard change. Archived by: the coordinator-guard change.
Verbatim text as it was in DECISIONS.md at `30952e6`, lines 40-46:

Note: the quote is not byte-exact. The owner's whole message (same session file, line 2487) reads «сложная работу опус медиум простая работа сонет хай».

> - Development worker models, current rule, correcting the previous entry. Owner (verbatim, after the quotes above):
>   «сложная работа опус медиум простая работа сонет хай»
>   Coordinator interpretation (the owner may correct it): Claude side, simple work is Sonnet 5.5 high and complex work
>   is Opus 5.5 medium; GPT side unchanged, simple is GPT-6.1-Sol low and complex is GPT-6.1-Sol medium. Opus low,
>   Sonnet medium/xhigh and Sol high are not allowed for development workers; no other models or levels. The limit of 10
>   first-level subagents and the even Anthropic/GPT balance stay. Product review `LEVELS` are unchanged.
>   Reason: owner decision. Carried by [PROCESS.md, Worker models](PROCESS.md#worker-models) (the table).
