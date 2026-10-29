# RQW-codex-compat

Reads Codex configuration on Pi's public extension APIs. It never writes to `~/.codex`, `/etc/codex` or a project.
Pi sources are not edited; a part that needs a public Pi API that does not exist is listed as blocked below.

## Config view

- Codex home is `$CODEX_HOME`, else `~/.codex`. The admin folder `/etc/codex` is read for its `skills` root only.
- Layers, low to high: the user `config.toml`, then `.codex/config.toml` of trusted projects. Administrative and managed
  Codex config (`/etc/codex/config.toml`, `managed_config.toml`) is not supported.
- Trust comes from `projects.<path>.trust_level` in the user config. The lookup order is the directory, the project-layer root, then the main
  checkout of the git worktree. Pi's own project trust is not used.
- Two project roots, as in Codex. Project `.codex` layers and their trust use the root of the config loader: the nearest
  directory with a `project_root_markers` entry (default `.git`), where a `.git` directory without HEAD does not count.
  `.agents/skills` and `AGENTS.md` use the nearest directory with any existing marker. An empty list or no marker leaves
  only cwd.

## Skill roots

`resources_discover` offers these existing directories, in this order:

1. `.codex/skills` of each trusted project layer, nearest first.
2. `$CODEX_HOME/skills`, `~/.agents/skills`, `$CODEX_HOME/skills/.system`.
3. `/etc/codex/skills`.
4. `.agents/skills` of every directory from the project root to cwd (not trust gated, as in Codex).

A missing folder is skipped without error. With `skills.bundled.enabled = false` the `.system` root is not offered.

## Skill rules and catalog

The model-visible skill list (`systemPromptOptions.skills`, also for the idle prewarm projection on
`rqw-prompt:startup-projection`) follows the user config:

- `[[skills.config]]` entries with `path` or `name` and `enabled`. Rules apply in order, the later one wins; a repeated
  selector keeps its last position. Only the user layer holds rules, as in Codex. Disabled skills leave the catalog.
- `skills.bundled.enabled = false` removes system skills.
- `skills.include_instructions = false` removes the whole catalog.
- `skills.max_context_tokens` (capped at 10000), else 2% of the model's context window, limits the catalog with Codex's
  per-line budget: a line `- name: description (file: path)` costs `ceil(bytes / 4)` tokens with its newline.
  Descriptions shrink round-robin, then skills are omitted from the end. Without a configured limit and without a
  known window Codex's fallback of 8000 characters counts instead (a line and its newline cost their characters). Pi's
  own prompt text around the lines is not charged.

Skills disabled by a rule are also removed from the list RQW-skill-dollar uses, through the `pi.events` channel
`rqw-skill-dollar:filter` with `{ offer(filter) }`, so a `$name` mention cannot expand them.

## Instruction files

With `--no-context-files` or `-nc` (read once from the command line through Pi's public `parseArgs`) no instruction file is added;
with `--no-skills` or `-ns` no Codex skill root is offered, while `skills.config` rules still apply to the skills Pi loads.
`before_agent_start` (and the prewarm projection) replaces `systemPromptOptions.contextFiles` with, in this order:

1. The global Codex file: `$CODEX_HOME/AGENTS.override.md`, else `$CODEX_HOME/AGENTS.md`. An empty file is skipped.
   The text is trimmed.
2. Pi's personal file, the one Pi found in `getAgentDir()`. This keeps the owner's existing Pi rule (decision M150 in the
   approved design); no other Pi source is added, and Pi's own ancestor `AGENTS.md` and `CLAUDE.md` files are dropped.
3. Project files from the project root down to cwd. Each directory contributes its first existing file of
   `AGENTS.override.md`, `AGENTS.md`, then `project_doc_fallback_filenames` (bare file names only, path syntax is
   ignored). `CLAUDE.md` is not added unless the config names it. An empty file adds nothing.

Project files share one byte budget, `project_doc_max_bytes` (default 32768, `0` adds none). Bytes are cut first and
then decoded, so a split multibyte character becomes U+FFFD, as in Codex. An empty file spends no budget. Global and
personal files are outside the budget. A leading BOM stays in the text, as in Codex. A cut raises one warning per
session id, also after a reload. The same code builds the prompt and the
prewarm projection.

An explicit `trust_level = "untrusted"` for the active project skips step 3, like Codex; an unlisted project still loads.
The active project is the first entry found for cwd, then for the main checkout of its git worktree; an entry without a
trust level counts as the answer and loads the files.
`project_root_markers` and `project_doc_fallback_filenames` come from the effective Codex config.

## Compatibility matrix

The state is one of three words. Supported: works as in Codex. Ignored: Codex ignores it too, or it has no effect here.
Blocked: waits for a public Pi API and is not done.

| Area | State | Note |
| --- | --- | --- |
| Layers: skill roots, `/etc/codex/skills`, `$CODEX_HOME`, user config | supported | |
| Layers: project-layer root markers (`.codex` layers, their trust) | supported | a `.git` directory without HEAD does not count |
| Layers: `.agents/skills` and `AGENTS.md` root markers | supported | any existing marker counts, a `.git` directory without HEAD included |
| Layers: administrative and managed Codex config (`/etc/codex/config.toml`, `managed_config.toml`, `/etc/codex/agents`) | not supported | owner chose the lightest variant («1») to Main's proposal «чиню две мелочи. административные настройки помечаю в таблице «не поддерживается». тестовый набор агентов не трогаю» |
| Layers: hooks, exec policies and other project-local config keys | ignored | not read |
| Trust: `.codex` skills and `.codex` agent roles need `projects.*.trust_level` | supported | user config |
| Trust: `.agents/skills` | supported | loads without trust, as in Codex |
| Trust: explicit `untrusted` skips project `AGENTS.md` | supported | |
| Trust: Pi's own project trust | ignored | never used as Codex trust |
| Fields: `skills.config`, `skills.bundled.enabled` | supported | model catalog and `$` mentions: a disabled skill is not listed and not expanded |
| Fields: `skills.include_instructions`, `skills.max_context_tokens`, the 2% default and the 8000-character fallback | supported | model catalog only; `$` mentions are not limited |
| Fields: `AGENTS.md` order, fallback names, markers, byte budget | supported | |
| Fields: agent role model, effort, instructions, nicknames | supported | |
| Fields: `model_reasoning_summary`, `model_verbosity`, `personality`, `service_tier`, `features`, `skills` of a role | blocked | named `not applied` |
| Fields: `sandbox_mode` and other role keys | ignored | Codex roles ignore them |
| Fields: type of other Codex role keys | ignored | не проверяется (not validated): only the applied fields and the six unapplied overrides are type checked; owner's decision: «По кодексу выбираем 1й вариант», the lightest option, over copying the whole Codex schema (about 3 SP) |
| Agent roles: built-in `default` and `worker` | supported | user roles replace them |
| Agent roles: `explorer` | ignored | removed by the owner's earlier decision |
| Permissions: a child inherits its parent's real sandbox | blocked | Pi has no equal sandbox; removing tools is not one |
| Skills: `/skill:name` commands follow rules | blocked | Pi has no public way to change its command list |
| Skills: same-name selection by path and `skill://` links | blocked | Pi drops later same-name skills while loading and keeps its own command list; waits for a public API with command parity |
| Exception: Pi's agent directory outranks `$CODEX_HOME`, and at the same project directory `.pi` roles win over `.codex` roles; nearer project directories win over ancestors | ignored | agreed exception to exact parity, not a Codex rule |
