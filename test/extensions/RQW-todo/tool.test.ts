import assert from "node:assert/strict";
import { it } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { validateToolArguments } from "@earendil-works/pi-ai";
import todo from "../../../extensions/RQW-todo/index.ts";

it("updates several items atomically and restores the last state of the current branch", async () => {
	const handlers: Record<string, Function[]> = {};
	let tool: any;
	let active = ["todo"];
	const savedEntries: unknown[] = [];
	todo({
		events: { on: () => {} },
		on: (name: string, handler: Function) => { (handlers[name] ??= []).push(handler); },
		registerTool: (value: unknown) => { tool = value; }, registerCommand: () => {},
		getActiveTools: () => active, setActiveTools: (names: string[]) => { active = names; },
		appendEntry: (customType: string, data: unknown) => { savedEntries.push({ type: "custom", customType, data }); },
	} as unknown as ExtensionAPI);
	const schema = JSON.parse(JSON.stringify(tool.parameters));
	assert.deepEqual(schema.properties.items.items.properties.status.enum, ["pending", "active", "done", "dropped", "blocked"]);
	assert.deepEqual(schema.properties.items.items.properties.steps.items.properties.status.enum, ["pending", "active", "done"]);
	const parse = (args: unknown) => validateToolArguments(tool, { type: "toolCall", id: "id", name: "todo", arguments: args } as any);
	assert.deepEqual(parse({ items: [{ id: "a", status: null }], new: "true" }), { items: [{ id: "a" }], new: true });
	assert.deepEqual(parse({ items: { id: "a" } }), { items: [{ id: "a" }] });
	assert.throws(() => parse({ items: [{ id: "a", status: "invalid" }] }), /Validation failed/);
	let visible = false;
	const ctx = { hasUI: true, ui: { setWidget: (_name: string, value: unknown) => { visible = !!value; } }, sessionManager: { getBranch: () => savedEntries } }; 
	for (const handler of handlers.session_start) await handler({}, ctx);
	const run = (params: unknown) => tool.execute("id", params, undefined, undefined, ctx);
	const first = await run({ items: [{ id: "a", text: "Первый", status: "active", steps: [{ text: "Шаг", status: "active" }] }, { id: "b", text: "Второй" }] });
	assert.equal(first.details.items.length, 2);
	assert.equal(first.details.items[1].status, "pending");
	await assert.rejects(run({ items: [{ id: "a", status: "done" }, { id: "b", status: "blocked" }] }), /reason|note/i);
	await assert.rejects(run({ items: [{ id: "b", status: "dropped" }] }), /reason|note/i);
	await assert.rejects(run({ new: true, items: [] }), /open/i);
	const steps = [{ text: "Новый шаг", status: "pending" }];
	const replaced = await run({ items: [{ id: "a", steps }] });
	assert.deepEqual(replaced.details.items[0].steps, steps);
	const second = await run({ items: [{ id: "a", status: "done" }, { id: "b", status: "blocked", note: "Ждёт ответа" }] });
	assert.equal(second.details.items[0].status, "done");
	assert.equal(second.details.items[1].status, "blocked");
	const branch = [{ type: "message", message: { role: "toolResult", toolName: "todo", details: first.details } }, { type: "message", message: { role: "toolResult", toolName: "todo", details: second.details } }];
	for (const handler of handlers.session_tree) await handler({}, { sessionManager: { getBranch: () => branch.slice(0, 1) } });
	const restored = await run({ items: [{ id: "b", status: "dropped", note: "Отменено" }] });
	assert.equal(restored.details.items[0].status, "active");
	assert.equal(restored.details.items[1].status, "dropped");
	await run({ items: [{ id: "a", status: "done" }] });
	const next = await run({ new: true, items: [{ id: "c", text: "Новая работа" }] });
	assert.deepEqual(next.details.items.map((item: any) => item.id), ["c"]);
	await handlers.before_agent_start[0]({ messageType: "user", prompt: '<skill name="todo" location="/todo">\nbody\n</skill>' }, ctx);
	assert.ok(active.includes("todo"));
	assert.equal(visible, true);
	await run({ off: true });
	assert.ok(!active.includes("todo"));
	assert.equal(visible, false);
	await handlers.before_agent_start[0]({ messageType: "user", prompt: '<skill name="todo" location="/todo">\nbody\n</skill>' }, ctx);
	assert.equal(visible, true);
	await run({ off: true });
	active = ["todo"];
	for (const handler of handlers.session_start) await handler({}, ctx);
	assert.ok(!active.includes("todo"));
});
