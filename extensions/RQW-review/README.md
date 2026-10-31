# RQW-review

Offers native Codex TOML reviewer profiles and Agent Skills. It registers no tool or session runner.
Self-contained: no imports from other extensions. Requires RQW-agent to run a reviewer; no fallback.

| Skill | Level | `agent_type` | Default model | Default reasoning |
|---|---|---|---|---|
| `blindreview` | blind | `spotty` | `gpt-6.1-terra` | medium |
| `highreview` | high | `bossy` | `gpt-6.1-terra` | xhigh |

Both wrappers read `skills/reviewer/SKILL.md` for the common review procedure. Initial and changed-object passes
start a fresh ordinary `agent` with the selected `agent_type`, `role_file` set to the absolute package `REVIEWER.md`
path, `include: ["user_messages"]` and a task containing `<agreement>` when needed, `<object>`, `<criterion>` and
`<rejected_earlier>` when applicable. The explicit role file preserves the package review contract when a same-name
personal or project profile overrides the offered profile's instructions; model, effort and profile-discovery
precedence stay unchanged. Agent appends raw user messages in `<user_messages>` after the task; Main does not copy
them. A complete `CLEAN` needs concise concrete
`CHECKED:` evidence and no `UNCHECKED:`. Missing or malformed evidence is completed by `send` to the same reviewer,
which supplies evidence from retained inspection or marks the exact gap; a fresh reviewer is not started for format.

`REVIEWER.md` is the canonical reviewer role. `profiles/spotty.toml` and `profiles/bossy.toml` retain byte-identical
`developer_instructions` for direct profile use, while the common skill explicitly loads the file through `role_file`.
RQW-agent appends either form to the inherited main system prompt. Read-only behavior is an instruction, not a sandbox
or git guard; ordinary agent tools remain available. The profile supplies model and effort defaults, independent of
Main's model; explicit agent options can override these defaults.

The source is the owner's Codex plugin `scope-focus`, developer A. Chukavin, with no licence text supplied.
The common skill contains only its subagents skill's review section, with calls and user-message placement
adapted for Pi. Both profiles share the canonical reviewer role with the approved concise-evidence amendment;
actual mechanical placement and same-reviewer completion are specified by the common skill.

On `pi.events` channel `rqw-agent:profiles`, request `{ offer(paths: string[]): void }`, this extension offers
absolute paths to both TOML files. `resources_discover` returns absolute `skillPaths` for all three skills;
there is no static `pi.skills` entry. Disable RQW-review and reload to remove its offers and skills. With RQW-agent
disabled, the skills report that the required agent is unavailable rather than starting another kind of reviewer.

No live model quality measurement is claimed.

Tests: `test/extensions/RQW-review/profiles.test.ts`.
