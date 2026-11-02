import assert from "node:assert/strict";
import { after, it } from "node:test";
import { call, isTask, keys, reply, reportTimings, text, world } from "./synthetic/world.ts";

after(() => reportTimings(import.meta.filename));

it("сохраняет неуспешную новую задачу после создания списка", async (t) => {
	const w = await world(t);
	w.model.script(reply(
		call("todo", { new: true, items: [{ id: "one", text: "Первый пункт", status: "blocked", note: "Жду" }] }, "new-list"),
		call("todo", { items: [{ id: "two", text: "Неудачный пункт", status: "blocked", steps: [{ text: "Важный шаг", status: "pending" }] }] }, "failed-item"),
	), text("Ожидаю."));
	await w.submit("$todo начни список");
	const request = w.requests.at(-1)!.context.messages;
	const error = request.find(message => message.role === "toolResult" && message.toolCallId === "failed-item");
	assert.equal(error?.role, "toolResult");
	assert.equal(error.isError, true);
	const transcript = JSON.stringify(request);
	assert.match(transcript, /Неудачный пункт/);
	assert.match(transcript, /Важный шаг/);
	assert.deepEqual(w.model.unscripted, []);
	assert.deepEqual(w.errors, []);
});

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
	const partial = JSON.stringify(w.requests.at(-1)!.context.messages);
	assert.doesNotMatch(partial, /Подготовить выпуск|Проверить изменения|Собрать пакет/);
	assert.match(partial, /Опубликовать пакет|Жду разрешения владельца/);

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
	assert.ok(!w.screen().some(line => line.includes("item 2 of 2")), "closed panel disappears");
	w.model.script(call("todo", { new: true, items: [{ id: "1", text: "Новая работа", status: "blocked", note: "Новая причина", steps: [{ text: "Новый шаг", status: "pending" }] }] }), text("Новый список."));
	await w.submit("начни новую работу");
	const request = w.requests.at(-1)!.context.messages;
	const requestText = JSON.stringify(request);
	assert.doesNotMatch(requestText, /Проверить изменения|Собрать пакет|Подготовить выпуск|Опубликовать пакет/);
	assert.match(requestText, /Новая работа/);
	assert.match(requestText, /Новый шаг/);
	const calls = new Set<string>();
	for (const message of request) {
		if (message.role === "assistant") {
			for (const part of message.content) if (part.type === "toolCall") calls.add(part.id);
		} else if (message.role === "toolResult") {
			assert.ok(calls.has(message.toolCallId));
		}
	}
	w = await w.restart();
	await w.submit("/todo");
	w.see("Подготовить выпуск");
	w.see("Проверить изменения");
	w.see("Новая работа");
	w.see("Новый шаг");
	w.press(keys.escape);
	await w.settle();
	assert.deepEqual(w.model.unscripted, []);
	assert.deepEqual(w.networkAttempts, []);
	assert.deepEqual(w.processAttempts, []);
	assert.deepEqual(w.errors, []);
});
