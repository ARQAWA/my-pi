// Deterministic activity diagnostics: a minimal session adapter captures the listener and replays synthetic Pi events.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { Activity, headTail } from "../activity.ts";

type Snap = {
	state: string;
	activity: string | null;
	current_tools: Record<string, unknown>[];
	current_tools_total: number;
	last_tool: Record<string, unknown> | null;
	repetition_hint: Record<string, unknown> | null;
	retry: Record<string, unknown> | null;
	tokens: {
		session: Record<string, number>;
		run: Record<string, number> | null;
		in_flight_usage: Record<string, number> | null;
	};
	usage_complete: boolean;
	messages?: Record<string, unknown>[];
	messages_omitted?: number;
};

const usage = (input: number, output: number, total = input + output) => ({
	input,
	output,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: total,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

class FakeSession {
	listeners = new Set<(event: AgentSessionEvent) => void>();
	messages: Record<string, unknown>[] = [];
	isStreaming = false;
	model = { provider: "anthropic", id: "claude-test" };
	stats = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
	subscribe(listener: (event: AgentSessionEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	getSessionStats() {
		return { tokens: this.stats };
	}
	emit(event: Record<string, unknown>): void {
		for (const listener of this.listeners) listener(event as unknown as AgentSessionEvent);
	}
}

function setup() {
	const session = new FakeSession();
	const activity = new Activity(session as unknown as AgentSession);
	const snap = (messages?: number) => activity.snapshot(messages) as Snap;
	return { session, activity, snap };
}

// Assistant partial message, as Pi's message_update and toolcall_* events carry it.
const partial = (content: unknown[], extra: Record<string, unknown> = {}) => ({
	role: "assistant",
	content,
	timestamp: 1000,
	provider: "anthropic",
	model: "claude-test",
	usage: usage(0, 0, 0),
	stopReason: "toolUse",
	...extra,
});
const toolBlock = (id: string, name: string, args: Record<string, unknown> = {}) => ({
	type: "toolCall",
	id,
	name,
	arguments: args,
});

test("headTail keeps head and tail within the limit and never splits a surrogate pair", () => {
	const preview = headTail("a".repeat(500) + "END", 100);
	assert.equal(preview.text.length, 100);
	assert.equal(preview.truncated, true);
	assert.equal(preview.length, 503);
	assert.ok(preview.text.endsWith("END"));
	assert.equal(headTail("short", 100).text, "short");
	const pair = headTail("x".repeat(49) + "\ud83d\ude00" + "y".repeat(50), 100);
	assert.ok(!/[\ud800-\udbff]$/.test(pair.text));
});

test("partial invalid UTF-8 tool args: bytes counted incrementally, split surrogate pair counted once", () => {
	const { session, activity, snap } = setup();
	const message = partial([toolBlock("call-1", "write")]);
	// A 4-byte emoji split across two deltas, then a lone trailing high surrogate; the JSON never completes.
	const chunks = ['{"path":"a', "\ud83d", "\ude00", '","content":"', "\ud83d"];
	session.emit({ type: "agent_start" });
	session.emit({ type: "message_start", message });
	session.emit({
		type: "message_update",
		message,
		assistantMessageEvent: { type: "toolcall_start", contentIndex: 0, partial: message },
	});
	for (const delta of chunks)
		session.emit({
			type: "message_update",
			message,
			assistantMessageEvent: { type: "toolcall_delta", contentIndex: 0, delta, partial: message },
		});

	const s = snap();
	assert.equal(s.state, "streaming_tool_call");
	assert.equal(s.activity, "model");
	assert.equal(s.current_tools.length, 1);
	const tool = s.current_tools[0];
	assert.equal(tool.kind, "argument_stream");
	assert.equal(tool.tool_call_id, "call-1");
	assert.equal(tool.name, "write");
	// 10 bytes + 4 (valid pair) + 13 bytes + 3 (lone surrogate counts as the 3-byte replacement character).
	const expectedBytes = Buffer.byteLength('{"path":"a', "utf8") + 4 + Buffer.byteLength('","content":"', "utf8") + 3;
	assert.equal(tool.argument_stream_bytes, expectedBytes);
	assert.equal(tool.parsed_arguments_bytes, null);
	assert.equal(tool.ended, false);
	assert.ok(String(tool.args_tail).endsWith('","content":"\ud83d'));

	// The provider completes the call with an argument error: parsed bytes now exist and the stream has ended.
	session.emit({
		type: "message_update",
		message,
		assistantMessageEvent: {
			type: "toolcall_end",
			contentIndex: 0,
			partial: message,
			toolCall: { type: "toolCall", id: "call-1", name: "write", arguments: {}, argumentsError: "invalid JSON" },
		},
	});
	const ended = snap().current_tools[0];
	assert.equal(ended.ended, true);
	assert.equal(ended.parsed_arguments_bytes, Buffer.byteLength("{}", "utf8"));
	assert.equal(ended.arguments_error, "invalid JSON");
	assert.equal(snap().state, "running");
	activity.close();
});

test("parallel tools: concurrent calls keep ids and parents, last tool is the most recent end", () => {
	const { session, activity, snap } = setup();
	session.emit({ type: "agent_start" });
	session.emit({ type: "tool_execution_start", toolCallId: "t1", toolName: "bash", args: { command: "sleep 1" } });
	session.emit({
		type: "tool_execution_start",
		toolCallId: "t2",
		toolName: "read",
		args: { path: "a.txt" },
		parentToolCallId: "p1",
	});
	let s = snap();
	assert.equal(s.state, "running_tool");
	assert.equal(s.activity, null);
	assert.equal(s.current_tools_total, 2);
	const byId = new Map(s.current_tools.map(t => [t.tool_call_id, t]));
	assert.equal(byId.get("t1")?.parent_tool_call_id, null);
	assert.equal(byId.get("t2")?.parent_tool_call_id, "p1");
	assert.equal(byId.get("t2")?.args_preview, '{"path":"a.txt"}');

	session.emit({ type: "tool_execution_end", toolCallId: "t2", toolName: "read", result: "", isError: false, durationMs: 5 });
	s = snap();
	assert.equal(s.current_tools_total, 1);
	assert.equal(s.current_tools[0].tool_call_id, "t1");
	assert.equal(s.last_tool?.tool_call_id, "t2");
	assert.equal(s.last_tool?.parent_tool_call_id, "p1");
	assert.equal(s.last_tool?.duration_ms, 5);
	assert.equal(s.state, "running_tool");

	session.emit({ type: "tool_execution_end", toolCallId: "t1", toolName: "bash", result: "", isError: true });
	s = snap();
	assert.equal(s.state, "running");
	assert.equal(s.current_tools_total, 0);
	assert.equal(s.last_tool?.is_error, true);
	activity.close();
});

test("message trimming: last N in order, 1200-character head and tail, 12000 per ID budget", () => {
	const { session, activity, snap } = setup();
	for (let i = 0; i < 20; i++) {
		const body = `#${i}-` + "x".repeat(3000) + `-end${i}`;
		session.messages.push({ role: "user", content: body, timestamp: 1000 + i });
	}
	const five = snap(5);
	assert.equal(five.messages?.length, 5);
	assert.equal(five.messages_omitted, 15);
	assert.deepEqual(
		five.messages?.map(m => String(m.text).slice(0, 3)),
		["#15", "#16", "#17", "#18", "#19"],
	);
	for (const m of five.messages ?? []) {
		assert.equal(m.text_truncated, true);
		assert.equal(String(m.text).length, 1200);
		assert.ok(String(m.text).endsWith("-end19") || String(m.text).includes("-end"));
	}
	assert.equal(five.messages?.[4].text_length, "#19-".length + 3000 + "-end19".length);

	// Twelve 1200-character previews: the budget keeps the newest ten (12000 characters) and reports two omitted.
	const budget = snap(12);
	assert.equal(budget.messages?.length, 10);
	assert.equal(budget.messages_omitted, 10);
	activity.close();
});

test("messages omitted: no peek key in the snapshot", () => {
	const { activity, snap } = setup();
	assert.equal("messages" in snap(), false);
	activity.close();
});

test("no thinking leakage: history and live thinking show only a count", () => {
	const { session, activity, snap } = setup();
	session.messages.push({
		role: "assistant",
		content: [
			{ type: "thinking", thinking: "SECRET-HISTORY" },
			{ type: "text", text: "visible answer" },
		],
		timestamp: 5,
		stopReason: "stop",
	});
	const live = partial([], { timestamp: 9, stopReason: "stop" });
	session.emit({ type: "agent_start" });
	session.emit({ type: "message_start", message: live });
	session.emit({
		type: "message_update",
		message: live,
		assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "SECRET-LIVE", partial: live },
	});
	assert.equal(snap().activity, "thinking");
	live.content = [{ type: "thinking", thinking: "SECRET-LIVE" }, { type: "text", text: "hello" }];
	session.emit({
		type: "message_update",
		message: live,
		assistantMessageEvent: { type: "text_delta", contentIndex: 1, delta: "hello", partial: live },
	});
	const s = snap(10);
	assert.equal(s.activity, "model");
	const text = JSON.stringify(s);
	assert.equal(text.includes("SECRET"), false);
	const history = s.messages?.[0] as { thinking?: { chars: number }; text?: string };
	assert.deepEqual(history.thinking, { blocks: 1, chars: "SECRET-HISTORY".length, redacted_blocks: 0 });
	assert.equal(history.text, "visible answer");
	const last = s.messages?.[s.messages.length - 1] as { live?: boolean; text?: string };
	assert.equal(last.live, true);
	assert.equal(last.text, "hello");
	activity.close();
});

test("usage: unknown before settle, run delta from session stats, live usage cleared at message end, retry shown", () => {
	const { session, activity, snap } = setup();
	session.stats = { input: 100, output: 0, cacheRead: 0, cacheWrite: 0, total: 100 };
	activity.startRun();
	session.stats = { input: 150, output: 10, cacheRead: 0, cacheWrite: 0, total: 160 };
	let s = snap();
	assert.equal(s.tokens.session.input, 150);
	assert.equal(s.tokens.run?.input, 50);
	assert.equal(s.tokens.in_flight_usage, null);
	assert.equal(s.usage_complete, false);

	const live = partial([], { timestamp: 20 });
	session.emit({ type: "agent_start" });
	session.emit({ type: "message_start", message: live });
	session.emit({
		type: "message_update",
		message: { ...live, usage: usage(7, 3) },
		assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "x", partial: live },
	});
	s = snap();
	assert.equal(s.tokens.in_flight_usage?.input, 7);
	assert.equal(s.tokens.in_flight_usage?.output, 3);
	session.emit({ type: "message_end", message: live });
	assert.equal(snap().tokens.in_flight_usage, null);
	assert.equal(snap().usage_complete, false);

	session.emit({ type: "agent_settled", aborted: false });
	assert.equal(snap().usage_complete, true);
	activity.endRun("done");
	s = snap();
	assert.equal(s.tokens.run?.input, 50);
	assert.equal(s.outcome, "done");
	assert.equal(s.state, "idle");

	session.emit({ type: "agent_start" });
	session.emit({ type: "auto_retry_start", attempt: 2, maxAttempts: 3, delayMs: 4000, errorMessage: "overloaded" });
	s = snap();
	assert.equal(s.state, "running");
	assert.equal(s.activity, "retry");
	assert.equal(s.retry?.attempt, 2);
	assert.equal(s.retry?.max_attempts, 3);
	session.emit({ type: "auto_retry_end", success: true, attempt: 2 });
	assert.equal(snap().retry, null);
	activity.close();
});

test("repetition hint: three identical completed calls among the last ten are reported as suspicion", () => {
	const { session, activity, snap } = setup();
	for (let i = 0; i < 3; i++) {
		session.emit({ type: "tool_execution_start", toolCallId: `r${i}`, toolName: "read", args: { path: "a" } });
		session.emit({ type: "tool_execution_end", toolCallId: `r${i}`, toolName: "read", result: "", isError: false });
	}
	const hint = snap().repetition_hint as { completed_repeats: { tool: string; count: number }[] };
	assert.deepEqual(hint.completed_repeats.map(c => [c.tool, c.count]), [["read", 3]]);
	activity.close();
});

test("native idle after agent_settled stays idle while the run is still logically active (children pending)", () => {
	const { session, activity, snap } = setup();
	activity.startRun();
	assert.equal(snap().state, "running");
	assert.equal(snap().activity, "preflight");
	session.emit({ type: "agent_start" });
	assert.equal(snap().activity, "model");
	session.emit({ type: "agent_settled", aborted: false });
	const s = snap();
	assert.equal(s.run_active, true);
	assert.equal(s.state, "idle");
	assert.equal(s.activity, null);
	activity.endRun("completed");
	assert.equal(snap().state, "idle");
	activity.close();
});

test("preflight applies only before the first agent_start of a run", () => {
	const { session, activity, snap } = setup();
	activity.startRun();
	session.emit({ type: "agent_start" });
	session.emit({ type: "agent_settled", aborted: false });
	activity.startRun();
	assert.equal(snap().activity, "preflight");
	activity.endRun("done");
	assert.equal(snap().activity, null);
	assert.equal(snap().state, "idle");
	activity.close();
});

test("execution: argument bytes, bounded last update with image metadata, kept on the last tool", () => {
	const { session, activity, snap } = setup();
	const args = { path: "a.txt", note: "é" };
	const argBytes = Buffer.byteLength(JSON.stringify(args), "utf8");
	session.emit({ type: "tool_execution_start", toolCallId: "x1", toolName: "read", args });
	session.emit({
		type: "tool_execution_update",
		toolCallId: "x1",
		toolName: "read",
		partialResult: {
			content: [
				{ type: "text", text: "L".repeat(500) + "END" },
				{ type: "image", data: "AAAA", mimeType: "image/png" },
			],
		},
	});
	const tool = snap().current_tools[0];
	assert.equal(tool.kind, "execution");
	assert.equal(tool.args_bytes, argBytes);
	assert.equal(String(tool.last_update_preview).length, 200);
	assert.equal(tool.last_update_truncated, true);
	assert.deepEqual(tool.last_update_images, [{ mime_type: "image/png", approx_bytes: 3 }]);

	session.emit({ type: "tool_execution_end", toolCallId: "x1", toolName: "read", result: "", isError: false });
	const last = snap().last_tool as Record<string, unknown>;
	assert.equal(last.args_bytes, argBytes);
	assert.equal(last.args_preview, JSON.stringify(args));
	assert.equal(last.last_update_truncated, true);
	assert.deepEqual(last.last_update_images, [{ mime_type: "image/png", approx_bytes: 3 }]);
	activity.close();
});

test("provider initial arguments captured once, separate from streamed bytes; ID assigned after start is picked up", () => {
	const { session, activity, snap } = setup();
	const seeded = partial([toolBlock("", "", { path: "seed" })]);
	session.emit({ type: "agent_start" });
	session.emit({ type: "message_start", message: seeded });
	session.emit({
		type: "message_update",
		message: seeded,
		assistantMessageEvent: { type: "toolcall_start", contentIndex: 0, partial: seeded },
	});
	let tool = snap().current_tools[0];
	assert.equal(tool.initial_arguments_preview, '{"path":"seed"}');
	assert.equal(tool.initial_arguments_bytes, Buffer.byteLength('{"path":"seed"}', "utf8"));
	assert.equal(tool.argument_stream_bytes, 0);

	const named = partial([toolBlock("late-id", "edit", { path: "seed" })]);
	session.emit({
		type: "message_update",
		message: named,
		assistantMessageEvent: { type: "toolcall_delta", contentIndex: 0, delta: '"x', partial: named },
	});
	tool = snap().current_tools[0];
	assert.equal(tool.tool_call_id, "late-id");
	assert.equal(tool.name, "edit");
	assert.equal(tool.argument_stream_bytes, 2);
	assert.equal(tool.initial_arguments_preview, '{"path":"seed"}');
	activity.close();
});

test("checkpoint: argument growth since the wait, zero baseline for streams that started after it", () => {
	const { session, activity, snap } = setup();
	const a = partial([toolBlock("ca", "write")]);
	session.emit({ type: "agent_start" });
	session.emit({ type: "message_start", message: a });
	session.emit({ type: "message_update", message: a, assistantMessageEvent: { type: "toolcall_start", contentIndex: 0, partial: a } });
	session.emit({ type: "message_update", message: a, assistantMessageEvent: { type: "toolcall_delta", contentIndex: 0, delta: "abcdefghij", partial: a } });
	const cp = activity.checkpoint();
	assert.deepEqual([...cp.values()], [10]);

	session.emit({ type: "message_update", message: a, assistantMessageEvent: { type: "toolcall_delta", contentIndex: 0, delta: "12345", partial: a } });
	const b = partial([toolBlock("", ""), toolBlock("cb", "read")]);
	session.emit({ type: "message_update", message: b, assistantMessageEvent: { type: "toolcall_start", contentIndex: 1, partial: b } });
	session.emit({ type: "message_update", message: b, assistantMessageEvent: { type: "toolcall_delta", contentIndex: 1, delta: "abc", partial: b } });

	const withCp = activity.snapshot(undefined, cp) as Snap & { current_tools: Record<string, unknown>[] };
	const byId = new Map(withCp.current_tools.map(t => [t.tool_call_id, t]));
	assert.equal(byId.get("ca")?.argument_growth_since_wait_bytes, 5);
	assert.equal(byId.get("cb")?.argument_growth_since_wait_bytes, 3);
	assert.equal(byId.get("cb")?.argument_stream_bytes, 3);

	const plain = snap().current_tools.find(t => t.tool_call_id === "ca");
	assert.equal("argument_growth_since_wait_bytes" in (plain ?? {}), false);
	activity.close();
});

test("checkpoint: unknown-ID stream tracked after its ID is assigned; reset and index reuse give the new stream all its bytes", () => {
	const { session, activity, snap } = setup();
	const a = partial([toolBlock("", "")]);
	session.emit({ type: "agent_start" });
	session.emit({ type: "message_start", message: a });
	session.emit({ type: "message_update", message: a, assistantMessageEvent: { type: "toolcall_start", contentIndex: 0, partial: a } });
	session.emit({ type: "message_update", message: a, assistantMessageEvent: { type: "toolcall_delta", contentIndex: 0, delta: "x".repeat(50), partial: a } });
	const cp = activity.checkpoint();

	const named = partial([toolBlock("late", "write")]);
	session.emit({ type: "message_update", message: named, assistantMessageEvent: { type: "toolcall_delta", contentIndex: 0, delta: "yyy", partial: named } });
	let tool = activity.snapshot(undefined, cp) as Snap & { current_tools: Record<string, unknown>[] };
	assert.equal(tool.current_tools[0].tool_call_id, "late");
	assert.equal(tool.current_tools[0].argument_growth_since_wait_bytes, 3);

	// A new assistant message resets the streams; its unknown-ID stream reuses content index 0.
	const b = partial([toolBlock("", "")]);
	session.emit({ type: "message_end", message: named });
	session.emit({ type: "message_start", message: b });
	session.emit({ type: "message_update", message: b, assistantMessageEvent: { type: "toolcall_start", contentIndex: 0, partial: b } });
	session.emit({ type: "message_update", message: b, assistantMessageEvent: { type: "toolcall_delta", contentIndex: 0, delta: "zz", partial: b } });
	tool = activity.snapshot(undefined, cp) as Snap & { current_tools: Record<string, unknown>[] };
	assert.equal(tool.current_tools.length, 1);
	assert.equal(tool.current_tools[0].argument_stream_bytes, 2);
	assert.equal(tool.current_tools[0].argument_growth_since_wait_bytes, 2);
	activity.close();
});

test("peek merges old service marks with newer history by actual message timestamps", t => {
	const { session, activity, snap } = setup();
	t.mock.method(Date, "now", () => 100);
	session.messages.push({ role: "user", content: "task", timestamp: 90 });
	session.emit({ type: "auto_retry_start", attempt: 1, maxAttempts: 3, delayMs: 100, errorMessage: "retry" });
	session.messages.push({ role: "toolResult", content: [{ type: "text", text: "tool done" }], timestamp: 110 });
	session.messages.push({ role: "assistant", content: [{ type: "text", text: "done" }], timestamp: 120 });
	assert.deepEqual(snap(5).messages?.map(m => m.role), ["user", "service", "toolResult", "assistant"]);
	assert.deepEqual(snap(2).messages?.map(m => m.text), ["tool done", "done"]);
	activity.close();
});

test("service marks: last ten retry marks with trimmed error, role and timestamp, merged into the peek", () => {
	const { session, activity, snap } = setup();
	session.messages.push({ role: "user", content: "first", timestamp: 1 });
	for (let i = 1; i <= 12; i++)
		session.emit({
			type: "auto_retry_start",
			attempt: i,
			maxAttempts: 12,
			delayMs: 100,
			errorMessage: "e".repeat(500),
		});
	const s = snap(20);
	const marks = (s.messages ?? []).filter(m => m.role === "service");
	assert.equal(marks.length, 10);
	assert.deepEqual(marks.map(m => m.attempt), [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
	assert.equal(marks[0].kind, "retry");
	assert.equal(String(marks[0].error).length, 300);
	assert.equal(marks[0].error_truncated, true);
	assert.equal(typeof marks[0].at, "string");
	// The history entry (timestamp 1) is older than every mark, so it sorts first and is kept only if it fits.
	assert.equal(s.messages?.[0].role, "user");
	activity.close();
});

test("message budget includes tool-call previews: text first, calls share the rest, omitted calls counted", () => {
	const { session, activity, snap } = setup();
	session.messages.push({
		role: "assistant",
		content: [
			{ type: "text", text: "t".repeat(1100) },
			{ type: "toolCall", id: "big1", name: "write", arguments: { content: "q".repeat(5000) } },
			{ type: "toolCall", id: "big2", name: "write", arguments: { content: "r".repeat(5000) } },
		],
		timestamp: 3,
		stopReason: "toolUse",
	});
	const m = snap(1).messages?.[0] as Record<string, unknown>;
	assert.equal(m.text_length, 1100);
	assert.equal(m.text_truncated, false);
	const calls = m.tool_calls as Record<string, unknown>[];
	assert.equal(calls.length, 1);
	assert.equal(calls[0].tool_call_id, "big1");
	assert.equal(String(calls[0].args_preview).length, 100);
	assert.equal(calls[0].args_truncated, true);
	assert.ok(Number(calls[0].args_length) > 5000);
	assert.equal(m.tool_calls_omitted, 1);
	activity.close();
});

test("unfinished live message is listed beside a history entry with the same timestamp; completed live is cleared", () => {
	const { session, activity, snap } = setup();
	session.messages.push({ role: "assistant", content: [{ type: "text", text: "old" }], timestamp: 9 });
	const live = partial([{ type: "text", text: "new" }], { timestamp: 9 });
	session.emit({ type: "agent_start" });
	session.emit({ type: "message_start", message: live });
	session.emit({ type: "message_update", message: live, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "new", partial: live } });
	let msgs = snap(10).messages ?? [];
	assert.equal(msgs.length, 2);
	assert.equal(msgs.filter(m => m.live === true).length, 1);
	session.emit({ type: "message_end", message: live });
	msgs = snap(10).messages ?? [];
	assert.equal(msgs.length, 1);
	assert.equal(msgs[0].live, false);
	activity.close();
});

test("peek entries for live streams and executions carry timestamps", () => {
	const { session, activity, snap } = setup();
	const a = partial([toolBlock("ts1", "write")]);
	session.emit({ type: "agent_start" });
	session.emit({ type: "message_start", message: a });
	session.emit({ type: "message_update", message: a, assistantMessageEvent: { type: "toolcall_start", contentIndex: 0, partial: a } });
	session.emit({ type: "tool_execution_start", toolCallId: "ex1", toolName: "bash", args: { command: "ls" } });
	const msgs = snap(5).messages ?? [];
	const stream = msgs.find(m => m.kind === "tool_call_stream");
	const exec = msgs.find(m => m.kind === "tool_execution");
	assert.equal(typeof stream?.at, "string");
	assert.equal(typeof exec?.at, "string");
	activity.close();
});

test("agent_end clears native busy while the logical run stays open; retry and compaction keep running until settled", () => {
	const { session, activity, snap } = setup();
	activity.startRun();
	session.emit({ type: "agent_start" });
	assert.equal(snap().state, "running");
	session.emit({ type: "agent_end", messages: [] });
	let s = snap();
	assert.equal(s.run_active, true);
	assert.equal(s.state, "idle");
	assert.equal(s.usage_complete, false);
	session.emit({ type: "auto_retry_start", attempt: 1, maxAttempts: 2, delayMs: 10, errorMessage: "overloaded" });
	s = snap();
	assert.equal(s.state, "running");
	assert.equal(s.activity, "retry");
	session.emit({ type: "auto_retry_end", success: true, attempt: 1 });
	session.emit({ type: "compaction_start", reason: "threshold" });
	s = snap();
	assert.equal(s.state, "running");
	assert.equal(s.activity, "compaction");
	session.emit({ type: "compaction_end" });
	s = snap();
	assert.equal(s.state, "idle");
	assert.equal(s.usage_complete, false);
	session.emit({ type: "agent_settled", aborted: false });
	s = snap();
	assert.equal(s.run_active, true);
	assert.equal(s.state, "idle");
	assert.equal(s.usage_complete, true);
	activity.close();
});

test("close: the session listener is released and no further events are captured", () => {
	const { session, activity, snap } = setup();
	assert.equal(session.listeners.size, 1);
	activity.close();
	assert.equal(session.listeners.size, 0);
	session.emit({ type: "tool_execution_start", toolCallId: "late", toolName: "bash", args: {} });
	assert.equal(snap().current_tools_total, 0);
});
