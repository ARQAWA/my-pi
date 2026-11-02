import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { State } from "../../../extensions/RQW-todo/index.ts";
import { installTodoMode } from "../../../extensions/RQW-todo/mode.ts";

function fixture(initial: State = { items: [] }) {
	const handlers = new Map<string, Function>();
	let active = ["read", "todo"];
	let state = initial;
	let branch: any[] = [];
	const pi = {
		on(name: string, handler: Function) { handlers.set(name, handler); },
		getActiveTools() { return active; },
		setActiveTools(names: string[]) { active = names; },
		appendEntry(customType: string, data: unknown) { branch.push({ type: "custom", customType, data }); },
	} as unknown as ExtensionAPI;
	const mode = installTodoMode(pi, () => state);
	const emit = async (name: string, event: any = {}) => handlers.get(name)!(event, { sessionManager: { getBranch: () => branch } });
	return { emit, mode, active: () => active, setState: (value: State) => { state = value; }, branch: () => branch, setBranch: (value: any[]) => { branch = value; } };
}
const block = '<skill name="todo" location="/skills/todo/SKILL.md">\nDo work\n</skill>';
const start = (prompt: string) => ({ messageType: "user", prompt });
const settle = (outcome = "completed") => ({ outcome, entries: [{ type: "custom", customType: "existing" }], continue: false });

it("offers the skill and toggles the tool across sessions and branches", async () => {
	const f = fixture();
	const resources = await f.emit("resources_discover");
	assert.match(readFileSync(resources.skillPaths[0], "utf8"), /name: todo/);
	await f.emit("session_start");
	assert.deepEqual(f.active(), ["read"]);
	await f.emit("before_agent_start", start('text <skill name="todo">'));
	assert.deepEqual(f.active(), ["read"]);
	await f.emit("before_agent_start", start(`<skill name="other" location="/other">\nOther\n</skill>\n\n${block}\n\nwork`));
	assert.deepEqual(f.active(), ["read", "todo"]);
	const enabledBranch = [...f.branch()];
	f.mode.off();
	assert.deepEqual(f.active(), ["read"]);
	const disabledBranch = [...f.branch()];
	await f.emit("session_start");
	assert.deepEqual(f.active(), ["read"]);
	f.setBranch(enabledBranch);
	await f.emit("session_tree");
	assert.deepEqual(f.active(), ["read", "todo"]);
	f.setBranch(disabledBranch);
	await f.emit("session_tree");
	assert.deepEqual(f.active(), ["read"]);
	await f.emit("input", { source: "interactive", text: block });
	assert.deepEqual(f.active(), ["read", "todo"]);
	f.mode.off();
	await f.emit("input", { source: "interactive", text: "/skill:todo работа" });
	assert.deepEqual(f.active(), ["read", "todo"]);
	f.mode.off();
	await f.emit("input", { source: "interactive", text: `/skill:other ${block}\n\nработа` });
	assert.deepEqual(f.active(), ["read", "todo"]);
});

it("appends only open-list details to the request, without saving them", async () => {
	const f = fixture({ items: [
		{ id: "a", text: "Готово", status: "done", note: "секрет", steps: [{ text: "старый шаг", status: "done" }] },
		{ id: "b", text: "Работа", status: "active", steps: [{ text: "текущий шаг", status: "active" }, { text: "следующий шаг", status: "pending" }] },
		{ id: "c", text: "Ожидание", status: "blocked", note: "ждём ответ", steps: [{ text: "чужой шаг", status: "pending" }] },
		{ id: "d", text: "Отмена", status: "dropped", note: "причина" },
	] });
	await f.emit("session_start");
	await f.emit("before_agent_start", start(block));
	const messages = [{ role: "user", content: "работа", timestamp: 1 }];
	const output = await f.emit("context", { messages });
	assert.deepEqual(output.messages.slice(0, -1), messages);
	const text = output.messages.at(-1).content;
	for (const value of ["Работа", "Ожидание", "ждём ответ", "текущий шаг", "следующий шаг", "чужой шаг", "Завершено или отменено: 2"]) assert.ok(text.includes(value), value);
	for (const value of ["Готово", "Отмена", "секрет", "старый шаг", "причина"]) assert.ok(!text.includes(value), value);
	assert.equal(output.messages.at(-1).display, false);
	assert.deepEqual(f.branch(), [{ type: "custom", customType: "rqw-todo-mode", data: { enabled: true } }]);
	f.setState({ items: [{ id: "a", text: "Готово", status: "done" }] });
	assert.equal(await f.emit("context", { messages }), undefined);
	f.setState({ items: [{ id: "a", text: "Работа", status: "pending" }] });
	await f.emit("before_agent_start", start(block));
	assert.ok(await f.emit("context", { messages }));
	f.mode.off();
	assert.equal(await f.emit("context", { messages }), undefined);
});

it("projects completed todo calls out of requests without changing saved history or call pairs", async () => {
	const first = { id: "same", text: "старый длинный пункт", status: "active", steps: [{ text: "старый длинный шаг", status: "active" }] };
	const second = { id: "same", text: "новый пункт", status: "active", steps: [{ text: "новый шаг", status: "active" }] };
	const f = fixture({ items: [first as any] });
	await f.emit("session_start");
	await f.emit("before_agent_start", start(block));
	const messages: any[] = [
		{ role: "assistant", content: [{ type: "text", text: "сохрани это" }, { type: "toolCall", id: "1", name: "todo", arguments: { items: [first] } }, { type: "toolCall", id: "other", name: "read", arguments: { path: "x" } }] },
		{ role: "toolResult", toolCallId: "1", toolName: "todo", content: [{ type: "text", text: "ok · старый длинный пункт" }], details: { items: [first] }, isError: false },
		{ role: "toolResult", toolCallId: "other", toolName: "read", content: [{ type: "text", text: "read result" }], isError: false },
		{ role: "assistant", content: [{ type: "toolCall", id: "2", name: "todo", arguments: { items: [{ id: "same", status: "done" }] } }] },
		{ role: "toolResult", toolCallId: "2", toolName: "todo", content: [{ type: "text", text: "ok" }], details: { items: [{ ...first, status: "done" }] }, isError: false },
	];
	const saved = structuredClone(messages);
	const partial = await f.emit("context", { messages: messages.slice(0, 3) });
	assert.match(JSON.stringify(partial.messages), /старый длинный шаг/);
	f.setState({ items: [{ ...first, status: "done" } as any] });
	const closed = await f.emit("context", { messages });
	assert.doesNotMatch(JSON.stringify(closed.messages), /старый длинный пункт|старый длинный шаг/);
	messages.push(
		{ role: "assistant", content: [{ type: "toolCall", id: "3", name: "todo", arguments: { new: true, items: [second] } }] },
		{ role: "toolResult", toolCallId: "3", toolName: "todo", content: [{ type: "text", text: "ok · новый пункт" }], details: { new: true, items: [second] }, isError: false },
	);
	f.setState({ items: [second as any] });
	const projected = await f.emit("context", { messages });
	const serialized = JSON.stringify(projected.messages);
	assert.doesNotMatch(serialized, /старый длинный пункт|старый длинный шаг/);
	assert.match(serialized, /same: новый пункт/);
	assert.match(serialized, /новый шаг/);
	for (const id of ["1", "2", "3", "other"]) {
		assert.equal(projected.messages.flatMap((m: any) => m.role === "assistant" ? m.content : []).filter((c: any) => c.type === "toolCall" && c.id === id).length, 1);
		assert.equal(projected.messages.filter((m: any) => m.role === "toolResult" && m.toolCallId === id).length, 1);
		const callIndex = projected.messages.findIndex((m: any) => m.role === "assistant" && m.content.some((c: any) => c.type === "toolCall" && c.id === id));
		const resultIndex = projected.messages.findIndex((m: any) => m.role === "toolResult" && m.toolCallId === id);
		assert.ok(callIndex < resultIndex);
	}
	assert.deepEqual(messages.slice(0, 5), saved);
	assert.deepEqual(projected.messages[0].content[0], messages[0].content[0]);
	assert.deepEqual(projected.messages[0].content[2], messages[0].content[2]);
	assert.deepEqual(projected.messages[2], messages[2]);
	f.mode.off();
	const disabled = await f.emit("context", { messages });
	assert.doesNotMatch(JSON.stringify(disabled.messages), /старый длинный пункт|старый длинный шаг/);
});

it("keeps todo validation errors visible and open work available when todo is disabled", async () => {
	const f = fixture({ items: [{ id: "open", text: "Открытая задача", status: "active", steps: [{ text: "Открытый шаг", status: "pending" }] }] });
	await f.emit("session_start");
	await f.emit("before_agent_start", start(block));
	const messages = [
		{ role: "assistant", content: [{ type: "toolCall", id: "ok", name: "todo", arguments: { items: [{ id: "open", text: "Открытая задача" }] } }, { type: "toolCall", id: "error", name: "todo", arguments: { items: [{ id: "open", status: "blocked" }] } }] },
		{ role: "toolResult", toolCallId: "ok", toolName: "todo", content: [{ type: "text", text: "ok" }], isError: false },
		{ role: "toolResult", toolCallId: "error", toolName: "todo", content: [{ type: "text", text: "A note with a reason is required for blocked or dropped items." }], isError: true },
	];
	const enabled = await f.emit("context", { messages });
	assert.match(JSON.stringify(enabled.messages), /A note with a reason is required/);
	f.mode.off();
	const disabled = await f.emit("context", { messages });
	assert.match(JSON.stringify(disabled.messages), /open: Открытая задача/);
	assert.match(JSON.stringify(disabled.messages), /Открытый шаг/);
	assert.match(JSON.stringify(disabled.messages), /A note with a reason is required/);
});

it("keeps all errors from the latest batch even when another call succeeds", async () => {
	const f = fixture();
	await f.emit("session_start");
	await f.emit("before_agent_start", start(block));
	const messages = [
		{ role: "assistant", content: [
			{ type: "toolCall", id: "e1", name: "todo", arguments: { items: [{ id: "one" }] } },
			{ type: "toolCall", id: "e2", name: "todo", arguments: { items: [{ id: "two" }] } },
			{ type: "toolCall", id: "ok", name: "todo", arguments: { items: [] } },
		] },
		{ role: "toolResult", toolCallId: "e1", toolName: "todo", content: [{ type: "text", text: "first error" }], isError: true },
		{ role: "toolResult", toolCallId: "e2", toolName: "todo", content: [{ type: "text", text: "second error" }], isError: true },
		{ role: "toolResult", toolCallId: "ok", toolName: "todo", content: [{ type: "text", text: "ok" }], isError: false },
	];
	const output = await f.emit("context", { messages });
	const text = JSON.stringify(output.messages);
	for (const value of ["first error", "second error", '"one"', '"two"']) assert.ok(text.includes(value), value);
});

it("removes closed items from failed calls in a batch that closes the list", async () => {
	const f = fixture({ items: [{ id: "old", text: "закрытый пункт", status: "done", steps: [{ text: "закрытый шаг", status: "done" }] }] });
	await f.emit("session_start");
	await f.emit("before_agent_start", start(block));
	const messages = [
		{ role: "assistant", content: [
			{ type: "toolCall", id: "error", name: "todo", arguments: { items: [{ id: "old", text: "закрытый пункт", steps: [{ text: "закрытый шаг", status: "done" }] }] }, argumentsError: "bad input\n\nReceived arguments:\nзакрытый пункт" },
			{ type: "toolCall", id: "ok", name: "todo", arguments: { items: [{ id: "old", status: "done" }] } },
		] },
		{ role: "toolResult", toolCallId: "error", toolName: "todo", content: [{ type: "text", text: "validation error\n\nReceived arguments:\nзакрытый пункт и закрытый шаг" }], isError: true },
		{ role: "toolResult", toolCallId: "ok", toolName: "todo", content: [{ type: "text", text: "ok" }], isError: false },
	];
	const output = await f.emit("context", { messages });
	const text = JSON.stringify(output.messages);
	assert.match(text, /validation error/);
	assert.doesNotMatch(text, /закрытый пункт|закрытый шаг/);
});

it("does not confuse reused ids across a successful new list", async () => {
	const f = fixture({ items: [{ id: "same", text: "новая задача", status: "active" }] });
	await f.emit("session_start");
	await f.emit("before_agent_start", start(block));
	const messages = [
		{ role: "assistant", content: [
			{ type: "toolCall", id: "error", name: "todo", arguments: { items: [{ id: "same", text: "старый пункт", steps: [{ text: "старый шаг", status: "done" }] }] } },
			{ type: "toolCall", id: "new", name: "todo", arguments: { new: true, items: [{ id: "same", text: "новая задача" }] } },
		] },
		{ role: "toolResult", toolCallId: "error", toolName: "todo", content: [{ type: "text", text: "validation error" }], isError: true },
		{ role: "toolResult", toolCallId: "new", toolName: "todo", content: [{ type: "text", text: "ok" }], details: { new: true, items: [{ id: "same", text: "новая задача", status: "active" }] }, isError: false },
	];
	const text = JSON.stringify((await f.emit("context", { messages })).messages);
	assert.match(text, /новая задача|validation error/);
	assert.doesNotMatch(text, /старый пункт|старый шаг/);
});

it("keeps failed new items after starting a list in the same batch", async () => {
	const f = fixture({ items: [{ id: "one", text: "новая работа", status: "active" }] });
	await f.emit("session_start");
	await f.emit("before_agent_start", start(block));
	const messages = [
		{ role: "assistant", content: [
			{ type: "toolCall", id: "new", name: "todo", arguments: { new: true, items: [{ id: "one", text: "новая работа" }] } },
			{ type: "toolCall", id: "error", name: "todo", arguments: { items: [{ id: "two", text: "ещё одна работа", steps: [{ text: "важный шаг", status: "pending" }] }] } },
		] },
		{ role: "toolResult", toolCallId: "new", toolName: "todo", content: [{ type: "text", text: "ok" }], details: { new: true, items: [{ id: "one", text: "новая работа", status: "active" }] }, isError: false },
		{ role: "toolResult", toolCallId: "error", toolName: "todo", content: [{ type: "text", text: "validation error" }], isError: true },
	];
	const text = JSON.stringify((await f.emit("context", { messages })).messages);
	for (const value of ["ещё одна работа", "важный шаг", "validation error"]) assert.ok(text.includes(value), value);
});

it("keeps a failed new list that reuses a closed item id", async () => {
	const f = fixture({ items: [{ id: "same", text: "старое", status: "done" }] });
	await f.emit("session_start");
	await f.emit("before_agent_start", start(block));
	const messages = [
		{ role: "assistant", content: [{ type: "toolCall", id: "error", name: "todo", arguments: { new: true, items: [{ id: "same", text: "новая задача", status: "blocked", steps: [{ text: "новый шаг", status: "pending" }] }] } }] },
		{ role: "toolResult", toolCallId: "error", toolName: "todo", content: [{ type: "text", text: "validation error" }], isError: true },
	];
	const text = JSON.stringify((await f.emit("context", { messages })).messages);
	for (const value of ["новая задача", "новый шаг", "validation error"]) assert.ok(text.includes(value), value);
});

it("keeps malformed arguments for a new open item when no list is closed", async () => {
	const f = fixture();
	await f.emit("session_start");
	await f.emit("before_agent_start", start(block));
	const raw = 'bad JSON\n\nReceived arguments:\n{"items":[{"text":"новый пункт"';
	const messages = [
		{ role: "assistant", content: [{ type: "toolCall", id: "error", name: "todo", arguments: {}, argumentsError: raw }] },
		{ role: "toolResult", toolCallId: "error", toolName: "todo", content: [{ type: "text", text: raw }], isError: true },
	];
	const text = JSON.stringify((await f.emit("context", { messages })).messages);
	assert.match(text, /новый пункт/);
});

it("recovers open items from malformed arguments after a list closes", async () => {
	const f = fixture({ items: [{ id: "old", text: "старый пункт", status: "done" }] });
	await f.emit("session_start");
	await f.emit("before_agent_start", start(block));
	const raw = 'bad JSON\n\nReceived arguments:\n{"items":[{"id":"old","text":"старый пункт"},{"id":"new","text":"новый пункт"';
	const messages = [
		{ role: "assistant", content: [{ type: "toolCall", id: "error", name: "todo", arguments: {}, argumentsError: raw }] },
		{ role: "toolResult", toolCallId: "error", toolName: "todo", content: [{ type: "text", text: raw }], isError: true },
	];
	const text = JSON.stringify((await f.emit("context", { messages })).messages);
	assert.match(text, /новый пункт/);
	assert.doesNotMatch(text, /старый пункт/);
});

it("filters old-list items from malformed arguments in a later list", async () => {
	const f = fixture({ items: [{ id: "current", text: "текущая работа", status: "active" }] });
	await f.emit("session_start");
	await f.emit("before_agent_start", start(block));
	const raw = 'bad JSON\n\nReceived arguments:\n{"items":[{"id":"old","steps":[{"text":"старый шаг","status":"done"}]},{"id":"current","text":"текущая работа"';
	const messages = [
		{ role: "assistant", content: [{ type: "toolCall", id: "old-call", name: "todo", arguments: {} }] },
		{ role: "toolResult", toolCallId: "old-call", toolName: "todo", content: [{ type: "text", text: "ok" }], details: { items: [{ id: "old", text: "старый пункт", status: "done", steps: [{ text: "старый шаг", status: "done" }] }] }, isError: false },
		{ role: "assistant", content: [{ type: "toolCall", id: "error", name: "todo", arguments: {}, argumentsError: raw }] },
		{ role: "toolResult", toolCallId: "error", toolName: "todo", content: [{ type: "text", text: raw }], isError: true },
	];
	const text = JSON.stringify((await f.emit("context", { messages })).messages);
	assert.match(text, /текущая работа/);
	assert.doesNotMatch(text, /старый пункт|старый шаг/);
});

it("keeps failed attempts to reopen closed items but shortens closed updates", async () => {
	const f = fixture({ items: [{ id: "old", text: "старый пункт", status: "done" }] });
	await f.emit("session_start");
	await f.emit("before_agent_start", start(block));
	for (const status of ["pending", "active", "blocked", "done", "dropped"]) {
		const messages = [
			{ role: "assistant", content: [{ type: "toolCall", id: "error", name: "todo", arguments: { items: [{ id: "old", status, steps: [{ text: "новый шаг", status: "pending" }] }] } }] },
			{ role: "toolResult", toolCallId: "error", toolName: "todo", content: [{ type: "text", text: "validation error" }], isError: true },
		];
		const output = (await f.emit("context", { messages })).messages;
		const text = JSON.stringify(output);
		assert.match(text, /validation error/);
		if (status === "pending" || status === "active" || status === "blocked") {
			assert.deepEqual(output[0].content[0].arguments, { items: [{ id: "old", status, steps: [{ text: "новый шаг", status: "pending" }] }] });
		} else assert.doesNotMatch(text, /новый шаг/);
	}
});

it("keeps a failed update to a reopened item", async () => {
	const f = fixture({ items: [{ id: "same", text: "задача", status: "active" }] });
	await f.emit("session_start");
	await f.emit("before_agent_start", start(block));
	const messages = [
		{ role: "assistant", content: [{ type: "toolCall", id: "old", name: "todo", arguments: {} }] },
		{ role: "toolResult", toolCallId: "old", toolName: "todo", content: [{ type: "text", text: "ok" }], details: { items: [{ id: "same", text: "задача", status: "done" }] }, isError: false },
		{ role: "assistant", content: [{ type: "toolCall", id: "error", name: "todo", arguments: { items: [{ id: "same", text: "задача", steps: [{ text: "новый шаг", status: "pending" }] }] } }] },
		{ role: "toolResult", toolCallId: "error", toolName: "todo", content: [{ type: "text", text: "validation error" }], isError: true },
	];
	assert.match(JSON.stringify((await f.emit("context", { messages })).messages), /новый шаг/);
});

it("filters a past item when a new list reuses its id", async () => {
	const f = fixture({ items: [{ id: "same", text: "новая работа", status: "active" }] });
	await f.emit("session_start");
	await f.emit("before_agent_start", start(block));
	const messages = [
		{ role: "assistant", content: [{ type: "toolCall", id: "old", name: "todo", arguments: {} }] },
		{ role: "toolResult", toolCallId: "old", toolName: "todo", content: [{ type: "text", text: "ok" }], details: { items: [{ id: "same", text: "старый пункт", status: "done", steps: [{ text: "старый шаг", status: "done" }] }] }, isError: false },
		{ role: "assistant", content: [{ type: "toolCall", id: "error", name: "todo", arguments: { items: [{ id: "same", steps: [{ text: "старый шаг", status: "done" }, { text: "новый шаг", status: "pending" }] }] } }] },
		{ role: "toolResult", toolCallId: "error", toolName: "todo", content: [{ type: "text", text: "validation error" }], isError: true },
	];
	const text = JSON.stringify((await f.emit("context", { messages })).messages);
	assert.match(text, /новая работа/);
	assert.match(text, /новый шаг/);
	assert.match(text, /старый шаг/);
});

it("keeps a failed rename of a reopened item", async () => {
	const f = fixture({ items: [{ id: "same", text: "новое", status: "active" }] });
	await f.emit("session_start");
	await f.emit("before_agent_start", start(block));
	const messages = [
		{ role: "assistant", content: [{ type: "toolCall", id: "old", name: "todo", arguments: {} }] },
		{ role: "toolResult", toolCallId: "old", toolName: "todo", content: [{ type: "text", text: "ok" }], details: { items: [{ id: "same", text: "старое", status: "done" }] }, isError: false },
		{ role: "assistant", content: [{ type: "toolCall", id: "error", name: "todo", arguments: { items: [{ id: "same", text: "старое", steps: [{ text: "новый шаг", status: "pending" }] }] } }] },
		{ role: "toolResult", toolCallId: "error", toolName: "todo", content: [{ type: "text", text: "validation error" }], isError: true },
	];
	const output = (await f.emit("context", { messages })).messages;
	assert.deepEqual(output[2].content[0].arguments, { items: [{ id: "same", text: "старое", steps: [{ text: "новый шаг", status: "pending" }] }] });
});

it("reminds once per user message only for actionable work and completed turns", async () => {
	const f = fixture({ items: [{ id: "a", text: "Работа", status: "pending" }, { id: "b", text: "Ждём", status: "blocked", note: "нет ответа" }] });
	await f.emit("session_start");
	await f.emit("before_agent_start", start(block));
	assert.equal(await f.emit("agent_before_settle", settle("aborted")), undefined);
	assert.equal(await f.emit("agent_before_settle", settle("error")), undefined);
	const result = await f.emit("agent_before_settle", settle());
	assert.equal(result.continue, true);
	assert.equal(result.entries[0].customType, "existing");
	assert.equal(result.entries[1].display, false);
	assert.match(result.entries[1].content, /Работа/);
	assert.equal(await f.emit("agent_before_settle", settle()), undefined);
	await f.emit("before_agent_start", { messageType: "custom", message: {} });
	assert.equal(await f.emit("agent_before_settle", settle()), undefined);
	await f.emit("message_start", { message: { role: "user", content: "продолжай" } });
	assert.equal((await f.emit("agent_before_settle", settle())).continue, true);
	await f.emit("before_agent_start", start("следующая задача"));
	f.setState({ items: [{ id: "b", text: "Ждём", status: "blocked", note: "нет ответа" }] });
	assert.equal(await f.emit("agent_before_settle", settle()), undefined);
	f.setState({ items: [{ id: "a", text: "Работа", status: "active" }] });
	f.mode.off();
	assert.equal(await f.emit("agent_before_settle", settle()), undefined);
});
