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
	for (const value of ["Готово", "Работа", "Ожидание", "ждём ответ", "Отмена", "текущий шаг", "следующий шаг"]) assert.ok(text.includes(value), value);
	for (const value of ["секрет", "старый шаг", "чужой шаг", "причина"]) assert.ok(!text.includes(value), value);
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
