import assert from "node:assert/strict";
import { it } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { visibleWidth } from "@earendil-works/pi-tui";
import { createTodoPanel } from "../../../extensions/RQW-todo/panel.ts";
import type { State } from "../../../extensions/RQW-todo/index.ts";

function host() {
	const widgets = new Map<string, { render(width: number): string[]; invalidate(): void }>();
	let paints = 0;
	let renders = 0;
	const theme = { fg: (role: string, text: string) => { paints++; return `\x1b[${role === "warning" ? 33 : 37}m${text}\x1b[0m`; } };
	const ctx = { ui: { setWidget(key: string, factory: any, options?: { placement: string }) {
		widgets.delete(key);
		if (factory) {
			assert.equal(options?.placement, "aboveEditor");
			widgets.set(key, factory({}, theme));
		}
		renders++;
	} } };
	return { ctx: ctx as never, widgets, get paints() { return paints; }, get renders() { return renders; } };
}

const clean = (rows: string[]) => rows.map(stripVTControlCharacters);
const current = (h: ReturnType<typeof host>) => [...h.widgets.values()].at(-1)!;

it("shows the active item, its real step and the next open item", () => {
	const h = host();
	const panel = createTodoPanel();
	const state: State = { items: [
		{ id: "done", text: "Готово", status: "done" },
		{ id: "a", text: "Панель", status: "active", steps: [
			{ text: "Начато", status: "done" }, { text: "Рисую", status: "active" }, { text: "Проверяю", status: "pending" },
		] },
		{ id: "next", text: "Тесты", status: "pending" },
		{ id: "blocked", text: "Выпуск", status: "blocked", note: "Жду ответа" },
	] };
	panel.update(h.ctx, state);
	const rows = current(h).render(60);
	assert.equal(rows.length, 3);
	assert.match(clean(rows)[0], /^▸ Панель\s+step 2 of 3 · item 2 of 4$/);
	assert.match(clean(rows)[1], /^\s+▸ Рисую$/);
	assert.equal(clean(rows)[2], "○ Тесты");
	panel.update(h.ctx, { items: [state.items[1], state.items[3]] });
	const blockedRows = current(h).render(60);
	assert.equal(blockedRows.length, 3);
	assert.equal(clean(blockedRows)[2], "! Выпуск · Жду ответа");
	assert.match(blockedRows[2], /\x1b\[33m/);
});

it("follows the focus, prioritizes blocked without active and removes a closed list immediately", () => {
	const h = host();
	const panel = createTodoPanel();
	const pending: State = { items: [
		{ id: "done", text: "Старое", status: "done" },
		{ id: "first", text: "Первое", status: "pending" },
		{ id: "next", text: "Второе", status: "pending" },
		{ id: "last", text: "Третье", status: "pending" },
	] };
	panel.update(h.ctx, pending);
	const pendingRows = clean(current(h).render(40));
	assert.match(pendingRows[0], /^▸ Первое\s+item 2 of 4$/);
	assert.deepEqual(pendingRows.slice(1), ["○ Второе", "○ Третье"]);
	const blocked: State = { items: [pending.items[0], { id: "b", text: "Жду", status: "blocked", note: "Ответ" }, pending.items[2], pending.items[3]] };
	panel.update(h.ctx, blocked);
	const rows = current(h).render(40);
	assert.match(clean(rows)[0], /^! Жду · Ответ\s+item 2 of 4$/);
	assert.match(rows[0], /\x1b\[33m/);
	assert.equal(clean(rows)[1], "○ Второе");
	const before = h.renders;
	panel.update(h.ctx, { items: [{ id: "a", text: "Готово", status: "done" }, { id: "b", text: "Отмена", status: "dropped" }] });
	assert.equal(h.widgets.size, 0);
	assert.equal(h.renders, before + 1);
});

it("caches by width and state, reinserts last, and clips terminal text", () => {
	const h = host();
	const panel = createTodoPanel();
	const state: State = { items: [{ id: "a", text: "Длинная строка\nс управляющим символом", status: "active" }] };
	panel.update(h.ctx, state);
	const first = current(h).render(12);
	const paints = h.paints;
	assert.deepEqual(current(h).render(12), first);
	assert.equal(h.paints, paints);
	current(h).render(20);
	assert.ok(h.paints > paints);
	const afterWidth = h.paints;
	h.widgets.set("activity", { render: () => [], invalidate() {} });
	panel.update(h.ctx, state);
	assert.deepEqual([...h.widgets.keys()].at(-1), "rqw-todo-panel");
	current(h).render(20);
	assert.equal(h.paints, afterWidth);
	const changed: State = { items: [{ id: "a", text: "Новое", status: "active" }] };
	const before = h.renders;
	panel.update(h.ctx, changed);
	assert.equal(h.renders, before + 1);
	assert.match(clean(current(h).render(20))[0], /Новое/);
	assert.ok(h.paints > afterWidth);
	for (const width of [0, 1, 8]) {
		const rows = clean(current(h).render(width));
		assert.equal(rows.length, 3);
		assert.ok(rows.every(row => !/[\r\n]/.test(row) && visibleWidth(row) <= width));
	}
	current(h).invalidate();
	const beforeInvalidation = h.paints;
	current(h).render(8);
	assert.ok(h.paints > beforeInvalidation);
});

it("leaves unused rows empty when no open items follow the focus", () => {
	const h = host();
	const panel = createTodoPanel();
	panel.update(h.ctx, { items: [
		{ id: "blocked", text: "Выпуск", status: "blocked", note: "Ответ" },
		{ id: "active", text: "Работа", status: "active" },
	] });
	const rows = clean(current(h).render(50));
	assert.match(rows[0], /^▸ Работа\s+item 2 of 2$/);
	assert.equal(rows[1], "");
	assert.equal(rows[2], "");
	panel.update(h.ctx, { items: [{ id: "a", text: "Один", status: "pending", steps: [{ text: "Готово", status: "done" }] }] });
	const single = clean(current(h).render(50));
	assert.match(single[0], /^▸ Один\s+item 1 of 1$/);
	assert.deepEqual(single.slice(1), ["", ""]);
});
