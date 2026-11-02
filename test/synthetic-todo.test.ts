import assert from "node:assert/strict";
import { after, it } from "node:test";
import { call, isTask, keys, reportTimings, text, world } from "./synthetic/world.ts";

after(() => reportTimings(import.meta.filename));

it("ведёт список через скилл, сохраняет препятствие и закрывает работу", async (t) => {
	let w = await world(t);
	const first = w.model.hold(isTask("начинаю"));
	w.type("начинаю");
	w.press(keys.enter);
	await w.until(() => first.arrived, "первый запрос");
	const held = w.model.hold((request) => request.context.messages.some((message) =>
		message.role === "toolResult" && message.toolName === "todo"));
	w.model.script(call("todo", { items: [
		{ id: "1", text: "Подготовить выпуск", status: "active", steps: [
			{ text: "Проверить изменения", status: "active" },
			{ text: "Собрать пакет", status: "pending" },
		] },
		{ id: "2", text: "Опубликовать пакет", status: "pending" },
	] }), text("Жду разрешения на публикацию."));
	w.type("$todo подготовь выпуск");
	w.press(keys.enter);
	await w.until(() => w.session.getFollowUpMessages().length > 0, "скилл в очереди");
	first.reply(text("Начинаю."));
	await w.until(() => held.arrived, "результат todo");

	const result = held.request!.context.messages.find((message) => message.role === "toolResult" && message.toolName === "todo")!;
	assert.equal(result.role, "toolResult");
	assert.equal(result.isError, false);
	const screen = w.screen().join("\n");
	assert.match(screen, /Подготовить выпуск/);
	assert.match(screen, /Проверить изменения/);
	assert.match(screen, /Опубликовать пакет/);

	held.reply(call("todo", { items: [
		{ id: "1", status: "done" },
		{ id: "2", status: "blocked", note: "Жду разрешения владельца" },
	] }));
	await w.settle();
	w.see("Опубликовать пакет");
	w.see("Жду разрешения владельца");

	w = await w.restart();
	w.see("Опубликовать пакет");
	await w.submit("/todo");
	w.see("Подготовить выпуск");
	w.see("Проверить изменения");
	w.see("Жду разрешения владельца");
	w.press(keys.escape);
	await w.settle();

	w.model.script(call("todo", { items: [{ id: "2", status: "done" }] }), text("Выпуск готов."));
	await w.submit("разрешаю публикацию");
	w.see("Выпуск готов.");
	w.notSee("Жду разрешения владельца");
	assert.ok(!w.screen().some(line => line.includes("пункт 2 из 2")), "closed panel disappears");
	assert.deepEqual(w.model.unscripted, []);
	assert.deepEqual(w.networkAttempts, []);
	assert.deepEqual(w.processAttempts, []);
	assert.deepEqual(w.errors, []);
});
