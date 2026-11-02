import assert from "node:assert/strict";
import { it } from "node:test";
import { createCoordinatorGuard } from "../.pi/extensions/coordinator-guard/index.ts";
import { firstUserText } from "./synthetic/model.ts";
import { call, isTask, text, world } from "./synthetic/world.ts";

it("lets a child keep a list without a skill and reminds once", async (t) => {
	let widgets = 0;
	let restoreWidget = () => {};
	t.after(() => restoreWidget());
	const probe = { name: "child-widget-probe", factory: (pi: any) => {
		pi.events.on("rqw-agent:subagent-extension-factories", (request: any) => request.offer((child: any) => {
			child.on("session_start", (_event: unknown, ctx: any) => {
				const ui = ctx.ui;
				const original = ui.setWidget;
				ui.setWidget = (...args: unknown[]) => { widgets++; return original.apply(ui, args); };
				restoreWidget = () => { ui.setWidget = original; };
			});
		}));
	} };
	const w = await world(t, { beforeExtensions: [probe] });
	w.model.when(isTask("keep your list"), call("todo", { items: [{ id: "one", text: "Child work", status: "active" }] }, "child-todo"));
	const held = w.model.hold(request => request.context.messages.some(message => message.role === "toolResult" && message.toolCallId === "child-todo"));
	w.model.script(call("agent", { action: "start", task: "keep your list" }), text("started"), text("done"), text("received"));
	await w.submit("start child");
	await w.until(() => held.arrived, "child todo result");
	const result = held.request!.context.messages.find(message => message.role === "toolResult" && message.toolCallId === "child-todo");
	assert.equal(result?.role === "toolResult" && result.isError, false);
	assert.match(JSON.stringify(held.request!.context.messages), /Текущий список дел:.*Child work/);
	held.reply(text("working"));
	await w.until(() => w.requests.some(request => JSON.stringify(request.context.messages).includes("Остались открытые пункты")), "child reminder");
	await w.until(() => w.requests.some(request => request.context.messages.some(message => message.role === "user" && JSON.stringify(message.content).includes("results"))), "child result delivered");
	await w.settle();
	assert.equal(w.requests.filter(request => JSON.stringify(request.context.messages).includes("Остались открытые пункты")).length, 1);
	assert.deepEqual(w.model.unscripted, []);
	assert.deepEqual(w.networkAttempts, []);
	assert.deepEqual(w.errors, []);
	assert.equal(widgets, 0);
	restoreWidget();
	await w.dispose();
	assert.deepEqual(w.patched(), []);
});

it("keeps todo available to nested children when the coordinator is disabled", async (t) => {
	const key = Symbol.for("my-pi.coordinator-guard.shared");
	const globals = globalThis as Record<symbol, unknown>;
	const saved = globals[key];
	globals[key] = { role: "coordinator" };
	t.after(() => { if (saved === undefined) delete globals[key]; else globals[key] = saved; });
	const guard = { name: "coordinator-guard", factory: createCoordinatorGuard({ root: "/not-a-git-repository", processFile: new URL("../PROCESS.md", import.meta.url).pathname, randomInt: () => 1 }) };
	const w = await world(t, { beforeExtensions: [guard] });
	await w.session.extensionRunner!.emitInput("/skill:todo work", undefined, "interactive");
	assert.ok(!w.session.extensionRunner!.getActiveTools().includes("todo"));
	w.model.when(request => firstUserText(request).startsWith("outer task"), call("agent", { action: "start", task: "nested task" }, "nested-agent"));
	w.model.when(isTask("nested task"), call("todo", { items: [{ id: "a", text: "Nested work", status: "blocked", note: "waiting" }] }, "nested-todo"));
	const held = w.model.hold(request => request.context.messages.some(message => message.role === "toolResult" && message.toolCallId === "nested-todo"));
	w.model.script(call("agent", { action: "start", model: "code", task: "outer task" }), text("started"), text("outer waiting"), text("nested done"), text("outer done"), text("received"));
	await w.submit("start worker");
	await w.until(() => held.arrived, "nested todo result");
	const result = held.request!.context.messages.find(message => message.role === "toolResult" && message.toolCallId === "nested-todo");
	assert.equal(result?.role === "toolResult" && result.isError, false);
	assert.match(JSON.stringify(held.request!.context.messages), /Текущий список дел:.*Nested work/);
	held.reply(text("nested done"));
	await w.until(() => w.requests.some(request => request.context.messages.some(message => message.role === "user" && JSON.stringify(message.content).includes("results"))), "result delivered");
	await w.settle();
	assert.deepEqual(w.networkAttempts, []);
	assert.deepEqual(w.errors, []);
	await w.dispose();
	assert.deepEqual(w.patched(), []);
});
