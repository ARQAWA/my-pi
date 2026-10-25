# RQW-review

Offers native Codex TOML reviewer profiles and Agent Skills. It registers no tool or session runner.
Self-contained: no imports from other extensions. Requires RQW-agent to run a reviewer; no fallback.

| Skill | Level | `agent_type` | Default model | Default reasoning |
|---|---|---|---|---|
| `blindreview` | blind | `spotty` | `gpt-6.1-sol` | low |
| `highreview` | high | `bossy` | `gpt-6.1-sol` | medium |

Both wrappers read `skills/reviewer/SKILL.md` for the common review procedure. Each pass starts a fresh ordinary
`agent` with the selected `agent_type`, `include: ["user_messages"]` and a task containing `<agreement>` when
needed, `<object>`, `<criterion>` and, from the second pass, `<rejected_earlier>`. Agent appends raw user messages
in `<user_messages>` after the task; Main does not copy them. A complete `CLEAN` needs `CHECKED:` and no `UNCHECKED:`.

`profiles/spotty.toml` and `profiles/bossy.toml` contain identical `developer_instructions`, appended as a role to
the inherited main system prompt by RQW-agent. Read-only behavior is an instruction, not a sandbox or git guard;
ordinary agent tools remain available. The profile supplies model and effort defaults, independent of Main's model;
explicit agent options can override these defaults.

The source is the owner's Codex plugin `scope-focus`, developer A. Chukavin, with no licence text supplied.
The common skill contains only its subagents skill's review section, with calls and user-message placement
adapted for Pi. Both profiles preserve the canonical REVIEWER.md text exactly, including its section-description
sentence; actual mechanical placement is specified by the common skill.

On `pi.events` channel `rqw-agent:profiles`, request `{ offer(paths: string[]): void }`, this extension offers
absolute paths to both TOML files. `resources_discover` returns absolute `skillPaths` for all three skills;
there is no static `pi.skills` entry. Disable RQW-review and reload to remove its offers and skills. With RQW-agent
disabled, the skills report that the required agent is unavailable rather than starting another kind of reviewer.

Claude reviewer measurement and comparison with the original plugin are discarded by the owner, not scheduled:
[BACKLOG.md, Discarded](../../BACKLOG.md#claude-reviewer),
[reviewer comparison](../../BACKLOG.md#codex-reviewer-comparison). No live model quality measurement is claimed.

Focused offline checks: `node --test test/extensions/RQW-review/profiles.test.ts`.
