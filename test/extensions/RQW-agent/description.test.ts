import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createEventBus, SessionManager } from "@earendil-works/pi-coding-agent";
import { registerSessionRuntime } from "../../../extensions/RQW-agent/index.ts";

// The adapted Codex 0.165.0 text; the profile catalogue is appended elsewhere.
const EXPECTED = [
	"Tool for spawning and managing sub-agents.",
	"Spawns an agent to work on the specified task with action start. It returns the agent id agent#N.",
	"The spawned agent will have the base tools or the `tools` subset, job and web when they are offered, codemode and tool_search when you have them, and always the ability to spawn its own subagents.",
	"Its final answer will be provided to you when it finishes.",
	"Note that the spawned agent gets no surrounding context beyond its task, which may cause the agent to lack the context it needs to complete its task; `include: [\"user_messages\"]` adds your user's messages.",
	"Do not use job wait or poll; use status only for a check you need; continue with other work or end your turn. Never fabricate or predict a pending agent's results; the notification is never something you write yourself; if the user asks before it arrives, say the result has not arrived yet. The user may not have opened the agent's report: relay what matters.",
	"Treat its result as finished work; don't redo its searches, reads or runs. When you hand its work to another agent or cite it, use source links or verbatim quotes, never a bare retelling, and cite only what you have seen in a source, opening just that spot if you have not. Check a claim only when it has no path and line, contradicts what you have seen, shows an obvious failure or misses a significant edge case, comes from a failed or incomplete run, or is a significant behavioral change no one has verified by a test or run; then check just that claim or send the same agent a short follow-up, and still run any check the user or a skill asks for.",
	"",
	"All agents share the same directory. In detail:",
	"- All agents have access to the same container and filesystem as you.",
	"- All agents use the same current working directory.",
	"- As a result, edits made by one agent are immediately visible to all other agents.",
	"",
	"Only set `model` or `thinking` when explicitly requested by the user, applicable `AGENTS.md` instructions, or skill instructions.",
	"",
	"Any earlier instruction enabling proactive multi-agent delegation no longer applies. Do not spawn sub-agents unless the user, your task, role or system prompt, or applicable AGENTS.md/skill instructions explicitly ask for sub-agents, delegation, or parallel agent work.",
	"",
	"send: Send a follow-up task to an existing agent and trigger a turn if it is idle. If the target is already running, deliver the task after its current tool call completes.",
	"wait: Wait for agents to reach a final status. Completed statuses may include the agent's final message. Returns no results when timed out. Where notifications work, wait returns a waiting receipt at once, ends this turn and wakes you later with a child_wait notification; each result arrives once, through wait or a later [agent#N] message. Nested codemode calls and external print/json hosts still hold the wait call.",
	"interrupt: Interrupt an agent's current turn, if any, and return its previous status. The agent remains available for messages and follow-up tasks. Cancellation can stay pending; inspect it with status.",
	"status: List the status of the listed direct agents: last trimmed messages, in-flight tool calls and structured alerts. Positive depth adds read-only descendant status; it grants no descendant control.",
	"stop: Close an agent and any open descendants when they are no longer needed. Completed agents remain open and keep their history until closed. Don't keep agents open for too long if they are not needed anymore.",
	"resume: Resume a previously interrupted or failed agent by id so it retries its last request from saved history, without a new message. Child sessions survive Pi restarts with the same caller-local id.",
	"start/restart: system_file or role_file loads exact UTF-8 text relative to the caller cwd instead of matching inline text; system and role choices are mutually exclusive. Restart inherits the file choice and re-reads it before replacing the child. Result details record prompt_file {kind, path (absolute), sha256 (file bytes)} beside delivery/run on push, and in results[].display on wait.",
	"include: [user_messages] on start/restart appends caller-session user-role text verbatim in a <user_messages> block after the task, from the caller's current branch; images and non-user messages are omitted. It is not inherited on restart.",
	"agent_type on start/restart selects a named Codex TOML profile from the catalogue below. Its developer_instructions are a role after the root prompt and reminder, not a sandbox. Profile model, effort and instructions are defaults; explicit model, thinking, role, role_file, system and system_file use ordinary API semantics. Unset fields use ordinary defaults. Profiles keep the same tools and recursive delegation as generic agents.",
	"restart: id, optional task, title and new role/system/model/thinking/tools; a fresh session; a selected agent_type is inherited and re-read unless changed.",
	"Defaults: your system prompt with the reminder, this session's thinking, all tools.",
	"By default children inherit GPT Fast; pass fast_gpt false when the user forbids Fast for subagents.",
].join("\n");

test("registered description is exactly the adapted Codex text", async t => {
	const root = await mkdtemp(join(tmpdir(), "rqw-agent-description-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const hooks = new Map<string, ((event: any, ctx: any) => unknown)[]>();
	const events = createEventBus();
	let description = "";
	const pi: any = {
		events,
		on: (name: string, hook: any) => hooks.set(name, [...hooks.get(name) ?? [], hook]),
		registerTool: (tool: any) => { description = tool.description; },
		getThinkingLevel: () => "off",
	};
	const runtime = registerSessionRuntime(pi, events);
	t.after(() => runtime.close());
	assert.equal(description, EXPECTED);

	const ctx = { cwd: root, sessionManager: SessionManager.inMemory(root) };
	for (const hook of hooks.get("session_start") ?? []) await hook({}, ctx);
	const [staticText] = description.split("\n\nAvailable roles:\n");
	assert.equal(staticText, EXPECTED);
});
