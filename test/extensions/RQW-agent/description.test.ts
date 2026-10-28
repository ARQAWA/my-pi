import assert from "node:assert/strict";
import { test } from "node:test";
import { DESCRIPTION } from "../../../extensions/RQW-agent/index.ts";

// The full static text from the agent-description spec, section 1.1; the profile catalogue is appended elsewhere.
const EXPECTED = [
	"Launch a new agent to handle complex, multi-step tasks autonomously.",
	"",
	"The agent tool launches subagents (in-process Pi sessions) that autonomously handle complex tasks. Each subagent has its own model and tools, and its own agent tool. By default its system prompt is yours plus the subagent reminder and your optional role; system replaces the whole prompt, and the reminder is still appended after it. The reminder tells the subagent that it runs under a parent agent and must not spawn additional subagents unless the user or its instructions request it; to allow that, say so in the task, role or system.",
	"",
	"Use action start with task to create a fresh subagent; it returns agent#N. The optional agent_type selects a named profile. Available agent_types and descriptions are listed at the end of this description.",
	"",
	"If the query is a narrow or specific question, you should NOT use the agent tool and instead address the query directly using the other tools available to you.",
	"",
	"Examples:",
	"- user: \"Where is the ClientError class defined?\" assistant: [Uses grep directly - this is a needle query for a specific class]",
	"- user: \"Run this query using my database API\" assistant: [Calls the MCP directly - this is not a broad exploration task]",
	"- user: \"What is the codebase structure?\" assistant: [Uses the agent tool with action=\"start\"]",
	"",
	"If it is possible to explore different areas of the codebase in parallel, you should launch multiple agents concurrently.",
	"",
	"When NOT to use the agent tool:",
	"- Simple, single or few-step tasks that can be performed by a single agent (using parallel or sequential tool calls) -- just call the tools directly instead.",
	"- For example:",
	"  - If you want to read a specific file path, use the read or find tool instead of the agent tool, to find the match more quickly",
	"  - If you are searching for code within a specific file or set of 2-3 files, use the read tool instead of the agent tool, to find the match more quickly",
	"  - If you are searching for a specific class definition like \"class Foo\", use the find tool instead, to find the match more quickly",
	"",
	"Usage notes:",
	"- Always include a short title (3-5 words) summarizing what the agent will do",
	"- Launch multiple agents concurrently whenever possible, to maximize performance; to do that, use a single message with multiple tool uses.",
	"- When the agent is done, it will return a single message back to you. Specify exactly what information the agent should return back in its final response to you.",
	"- Agents can be continued with action send by passing the agent ID from a previous start. This sends a follow-up message after the agent has completed, preserving existing context. If the agent is still running, the message is delivered after its current tool call and nothing is aborted, unless interrupt is true; interrupt true aborts the running turn and starts the new task as soon as it has stopped. Set interrupt to true only when the user explicitly wants to interrupt the running agent. When NOT sending a follow-up, each start creates a fresh agent and you should provide a detailed task description with all necessary context.",
	"- A subagent does not have access to the user's message or prior assistant steps unless you pass them: include [user_messages] on start or restart appends the caller's user-role text verbatim after the task; images and assistant steps are never passed. Therefore, you should provide a highly detailed task description with all necessary context for the agent to perform its task autonomously.",
	"- The subagent's outputs should generally be trusted",
	"- Clearly tell the subagent which tasks you want it to perform, since it is not aware of the user's intent or your prior assistant steps (tool calls, thinking, or messages).",
	"- If the subagent description mentions that it should be used proactively, then you should try your best to use it without the user having to ask for it first. Use your judgement.",
	"- If the user specifies that they want you to run subagents \"in parallel\", you MUST send a single message with multiple agent tool use content blocks. For example, if you need to launch both a code-reviewer subagent and a test-runner subagent in parallel, send a single message with both tool calls.",
	"- Avoid delegating the full query to the agent tool and returning the result. In these cases, you should address the query using the other tools available to you.",
	"",
	"When an agent runs in the background, you will be automatically notified when it completes after you end your own turn - do NOT use job wait, poll, or proactively check on its progress. Continue with other work or end your turn instead. Don't mention this to the user.",
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

test("description carries Cursor's guidance verbatim with our tool names", () => {
	for (const fragment of [
		"Launch a new agent to handle complex, multi-step tasks autonomously.",
		"If the query is a narrow or specific question, you should NOT use the agent tool and instead address the query directly using the other tools available to you.",
		"user: \"Where is the ClientError class defined?\" assistant: [Uses grep directly - this is a needle query for a specific class]",
		"When NOT to use the agent tool:\n- Simple, single or few-step tasks that can be performed by a single agent (using parallel or sequential tool calls) -- just call the tools directly instead.\n- For example:\n  - If you want to read a specific file path, use the read or find tool instead of the agent tool, to find the match more quickly\n  - If you are searching for code within a specific file or set of 2-3 files, use the read tool instead of the agent tool, to find the match more quickly\n  - If you are searching for a specific class definition like \"class Foo\", use the find tool instead, to find the match more quickly",
		"The subagent's outputs should generally be trusted",
		"Avoid delegating the full query to the agent tool and returning the result.",
		"Don't mention this to the user.",
	]) assert.ok(DESCRIPTION.includes(fragment), fragment);
});

test("description has no Cursor-only names or removed advice and keeps our mechanics", () => {
	for (const word of ["Subagent", "ReadFile", "Glob", "AwaitShell", "subagent_type", "run_in_background", "cloud", "self-fork", "generalPurpose", "Use it for complex multi-step work"])
		assert.ok(!DESCRIPTION.includes(word), word);
	for (const word of ["agent#N", "action start", "action send", "agent_type", "the reminder is still appended"]) assert.ok(DESCRIPTION.includes(word), word);
});
