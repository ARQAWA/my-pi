import assert from "node:assert/strict";
import { test } from "node:test";
import { DESCRIPTION } from "../../../extensions/RQW-agent/index.ts";

// The full static text of the Sonnet-style description; the profile catalogue is appended elsewhere.
const EXPECTED = [
	"Launch a new agent to handle complex, multi-step tasks.",
	"",
	"The agent tool launches subagents (in-process Pi sessions) that autonomously handle complex tasks. Each subagent has its own model and tools, and its own agent tool. By default its system prompt is yours plus the subagent reminder and your optional role; system replaces the whole prompt, and the reminder is still appended after it. The reminder tells the subagent that it runs under a parent agent and must not spawn additional subagents unless the user or its instructions request it; to allow that, say so in the task, role or system.",
	"",
	"Use action start with task to create a fresh subagent; it returns agent#N. The optional agent_type selects a named profile. Available agent_types and descriptions are listed at the end of this description.",
	"",
	"When to use:",
	"",
	"A fresh agent costs more than it looks. It knows of the work only what you give it, and you see only what it sends back; both handoffs drop detail, and neither of you can tell what the other missed. You can't watch it work; status peeks and progress notes show only glimpses. Its mistakes come back in the same confident register as its findings, and an agent handed your hypothesis tends to return it confirmed. Several at once spend tokens in a burst the user didn't ask for. Weigh those tokens against the accuracy they buy: the user pays for agents you did not need, and pays again for work you redo because you skipped one.",
	"",
	"Reach for this when you have independent work to run in parallel, when the user asks for a side quest that shouldn't block your main thread, or when answering would mean reading across several files: delegate that and you keep the conclusion, not the file dumps.",
	"",
	"Do the work yourself when it is a handful of tool calls or a lookup whose target you already know; don't delegate a check you could run inline. Delegate a review only when the user asks for a review or a checked result, or a skill asks for one; then give it the code, not your conclusion. Once you've delegated something, don't also run it yourself; do other work or wait for its result. When in doubt, don't spawn.",
	"",
	"When you do start one, brief it like the peer it is: state the goal and what you have already ruled out, point it at the files and docs worth reading instead of retyping them, and keep the scope explicit and narrow. Say what its one final message must contain. Everything it knows about the task comes from what you give it, so this brief is your first lever on every cost above; if you cannot write a clear one, you do not understand the task well enough to hand it off.",
	"",
	"- Give every start a short title (3-5 words).",
	"- Start independent agents in the same response.",
	"- Use action send with the agent's id to continue a started agent with its context intact; a new start begins fresh.",
	"",
	"Agents run in the background; where notifications work, you are notified when one completes, after you end your own turn. Do not use job wait or poll; use status only for a check you need; continue with other work or end your turn. Never fabricate or predict a pending agent's results; the notification is never something you write yourself; if the user asks before it arrives, say the result has not arrived yet. The user may not have opened the agent's report: relay what matters.",
	"",
	"Treat its result as finished work; don't redo its searches, reads or runs. When you hand its work to another agent or cite it, use source links or verbatim quotes, never a bare retelling, and cite only what you have seen in a source, opening just that spot if you have not. Check a claim only when it has no path and line, contradicts what you have seen, shows an obvious failure or misses a significant edge case, comes from a failed or incomplete run, or is a significant behavioral change no one has verified by a test or run; then check just that claim or send the same agent a short follow-up, and still run any check the user or a skill asks for.",
	"",
	"When blocked, estimate their remaining duration and set timeout_ms somewhat longer on each wait; 300000 is only the omitted default, not an interval or maximum.",
	"wait: ids (full IDs of your direct agents), optional timeout_ms, until first (default) or all, wake_on_alert (default true). By default returns a waiting receipt, ends this turn, and wakes you later with a child_wait notification. Children keep running while you receive owner messages. Nested codemode calls and external print/json hosts still hold the wait call. A new alert wakes without consuming a result; false waits for terminal delivery. until all waits until every selected target is terminal.",
	"status: ids, optional messages (5-10, default 8), depth (default 0); last trimmed messages, in-flight tool calls and structured alerts. Positive depth adds read-only descendant status; it grants no descendant control.",
	"start/restart: optional alert_after_ms, a positive safe integer, emits long_turn alerts for active turns after that duration; omitted means disabled, restart inherits the previous threshold. Alerts never stop work.",
	"Results arrive once, through wait or a later [agent#N] message; already-delivered results give a receipt.",
	"start: task, optional title (3-5 words), role, system (the whole system prompt, the subagent reminder is still appended), model (provider/id), thinking, tools; returns agent#N.",
	"start/restart: system_file or role_file loads exact UTF-8 text relative to the caller cwd instead of matching inline text; system and role choices are mutually exclusive. Restart inherits the file choice and re-reads it before replacing the child. Result details record prompt_file {kind, path (absolute), sha256 (file bytes)} beside delivery/run on push, and in results[].display on wait.",
	"include: [user_messages] on start/restart appends caller-session user-role text verbatim in a <user_messages> block after the task, from the caller's current branch; images and non-user messages are omitted. It is not inherited on restart.",
	"agent_type on start/restart selects a named Codex TOML profile from the catalogue below. Its developer_instructions are a role after the root prompt and reminder, not a sandbox. Profile model, effort and instructions are defaults; explicit model, thinking, role, role_file, system and system_file use ordinary API semantics. Unset fields use ordinary defaults. Profiles keep the same tools and recursive delegation as generic agents.",
	"send: id, task; reaches a running child after its current tool call, without aborting anything (a child parked in its own wait gets it after that call returns), or starts a new run with its history when idle; interrupt: true on send aborts a running child's turn and starts task as soon as it has stopped.",
	"resume: id; retry an interrupted request or one that ended in a provider error from saved history without adding a task message. Active or cancellation-pending children cannot be resumed. Successfully completed children stay idle. Child sessions survive Pi restarts with the same caller-local id.",
	"interrupt: id; requests cancellation, keeps history; inspect status while cancellation is pending. stop: id; closes it.",
	"restart: id, optional task, title and new role/system/model/thinking/tools; a fresh session; a selected agent_type is inherited and re-read unless changed.",
	"Defaults: your system prompt with the reminder, this session's model and thinking, all tools.",
	"By default children inherit GPT Fast; pass fast_gpt false when the user forbids Fast for subagents.",
].join("\n");

test("description is exactly the specified static text", () => {
	assert.equal(DESCRIPTION, EXPECTED);
});

test("description carries the Sonnet-style guidance with our tool names", () => {
	for (const fragment of [
		"Launch a new agent to handle complex, multi-step tasks.\n",
		"When to use:\n\nA fresh agent costs more than it looks.",
		"Do the work yourself when it is a handful of tool calls or a lookup whose target you already know;",
		"When in doubt, don't spawn.",
		"When you do start one, brief it like the peer it is:",
		"- Start independent agents in the same response.",
		"Never fabricate or predict a pending agent's results;",
		"Treat its result as finished work; don't redo its searches, reads or runs.",
		"use source links or verbatim quotes, never a bare retelling",
	]) assert.ok(DESCRIPTION.includes(fragment), fragment);
});

test("description drops the replaced Cursor wording", () => {
	for (const fragment of [
		"autonomously.",
		"you should NOT use the agent tool",
		"ClientError",
		"When NOT to use the agent tool:",
		"The subagent's outputs should generally be trusted",
		"Avoid delegating the full query",
		"Don't mention this to the user.",
	]) assert.ok(!DESCRIPTION.includes(fragment), fragment);
});

test("description has no foreign tool names and keeps our mechanics", () => {
	for (const word of ["Subagent", "ReadFile", "Glob", "AwaitShell", "subagent_type", "run_in_background", "cloud", "self-fork", "generalPurpose", "Use it for complex multi-step work"])
		assert.ok(!DESCRIPTION.includes(word), word);
	for (const word of ["agent#N", "action start", "action send", "agent_type", "the reminder is still appended"]) assert.ok(DESCRIPTION.includes(word), word);
});
