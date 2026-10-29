import assert from "node:assert/strict";
import { it } from "node:test";
import { stripVTControlCharacters as strip } from "node:util";
import { QuotaConsumer } from "../../../extensions/RQW-statusbar/quota.ts";
import { ICON, renderBar } from "../../../extensions/RQW-statusbar/render.ts";

const footer = (consumer: QuotaConsumer) => renderBar({ quotas: consumer.values, compactions: 0,
	place: { kind: "folder", text: "project" }, statuses: [] }, 400).slice(2).join(" ");
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const credential = () => ({ type: "oauth" as const, access: "fake-token", refresh: "unused", expires: 1e9, accountId: "fake-account" });
const codex = (used: number) => ({ rate_limit: {
	primary_window: { used_percent: 61, limit_window_seconds: 18000 },
	secondary_window: { used_percent: used, limit_window_seconds: 604800 },
}, additional_rate_limits: [{ limit_name: "other", rate_limit: {
	primary_window: { used_percent: 45, limit_window_seconds: 3600 },
} }] });

it("renders one remaining number per provider in light blue and pink-red and refreshes after five minutes", async (t) => {
	t.mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"], now: 0 });
	const consumer = new QuotaConsumer({ emit(_name, data) {
		(data as { offer(access: unknown): void }).offer({ async refresh() {
			return { windows: { five_hour: { remainingPercent: 72 }, seven_day: { remainingPercent: 39 } } };
		} });
	} }, "session", () => {}, {
		readCredential: credential,
		fetch: async (url, init) => {
			assert.equal(init?.method, "GET");
			assert.equal(init?.redirect, "error");
			const headers = new Headers(init?.headers);
			assert.equal(headers.get("Authorization"), "Bearer fake-token");
			const used = Date.now() === 0 ? 28 : 36;
			assert.equal(url, "https://chatgpt.com/backend-api/wham/usage");
			assert.equal(headers.get("ChatGPT-Account-Id"), "fake-account");
			return Response.json(codex(used));
		},
	});
	consumer.start();
	await flush();
	const row = renderBar({ quotas: consumer.values, compactions: 0,
		place: { kind: "folder", text: "project" }, statuses: [],
		git: { branch: "main", staged: 0, unstaged: 0, untracked: 0 } }, 100)[2];
	assert.equal(strip(row), ` ${ICON.folder} project` + " ".repeat(68) + `CX 72%  CC 39%  ${ICON.branch} main`);
	const wrapped = renderBar({ quotas: consumer.values, compactions: 0,
		place: { kind: "folder", text: "project" }, statuses: [],
		git: { branch: "main", staged: 0, unstaged: 0, untracked: 0 } }, 30).slice(2).map(strip);
	assert.deepEqual(wrapped, [` ${ICON.folder} project`, " ".repeat(8) + `CX 72%  CC 39%  ${ICON.branch} main`]);
	assert.ok(row.includes("\x1b[38;2;139;197;255mCX 72%\x1b[39m"));
	assert.ok(row.includes("\x1b[38;2;255;152;170mCC 39%\x1b[39m"));
	t.mock.timers.tick(299999);
	await flush();
	assert.ok(strip(footer(consumer)).includes("CX 72%"));
	t.mock.timers.tick(1);
	await flush();
	assert.ok(strip(footer(consumer)).includes("CX 64%"));
	const narrow = renderBar({ quotas: consumer.values, compactions: 0,
		place: { kind: "folder", text: "project" }, statuses: [],
		git: { branch: "long-branch-".repeat(10), staged: 0, unstaged: 0, untracked: 0 } }, 60).slice(2).map(strip).join(" ");
	for (const id of ["CX", "CC"]) assert.ok(narrow.includes(id));
	assert.ok(narrow.includes("CC 39%"));
	consumer.stop();
});

it("hides providers without stored login and leaves no quota separators", async (t) => {
	t.mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"], now: 0 });
	let loggedIn = false;
	const consumer = new QuotaConsumer({ emit() {} }, "session", () => {}, {
		readCredential: (provider) => loggedIn && provider === "openai-codex" ? credential() : undefined,
		fetch: async () => Response.json(codex(25)),
	});
	consumer.start();
	await flush();
	for (const git of [undefined, { branch: "main", staged: 0, unstaged: 0, untracked: 0 }]) {
		const state = { compactions: 0, place: { kind: "folder" as const, text: "project" }, statuses: [], git };
		assert.deepEqual(renderBar({ ...state, quotas: consumer.values }, 40), renderBar(state, 40));
	}
	loggedIn = true;
	await consumer.refresh();
	const row = strip(footer(consumer));
	assert.ok(row.includes("CX 75%"));
	assert.ok(!row.includes("CC"));
	loggedIn = false;
	await consumer.refresh();
	assert.ok(!strip(footer(consumer)).includes("CX"));
	consumer.stop();
});

it("shows ??? for expired, failed or unknown data without stale percentages", async (t) => {
	t.mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"], now: 0 });
	let mode = "valid";
	const consumer = new QuotaConsumer({ emit(_name, data) {
		(data as { offer(access: unknown): void }).offer({ async refresh() {
			return { windows: { seven_day: { remainingPercent: 57 } } };
		} });
	} }, "session", () => {}, {
		readCredential: () => ({ ...credential(), expires: mode === "expired" ? 0 : 1e9 }),
		fetch: async () => {
			if (mode === "failed") return new Response(null, { status: 401 });
			if (mode === "unknown") return Response.json({ unexpected: true });
			if (mode === "invalid") return Response.json(codex(null as unknown as number));
			return Response.json(codex(43));
		},
	});
	consumer.start();
	await flush();
	for (const value of ["expired", "valid", "failed", "unknown", "invalid"]) {
		mode = value;
		await consumer.refresh();
		const row = strip(footer(consumer));
		assert.ok(row.includes("CC 57%"));
		if (mode === "valid") {
			assert.ok(row.includes("CX 57%"));
		} else {
			assert.ok(row.includes("CX ???"));
			assert.ok(footer(consumer).includes("\x1b[38;2;139;197;255mCX ???\x1b[39m"));
		}
	}
	consumer.stop();
});

it("keeps completed providers visible and ignores a late stale success after a newer failure", async (t) => {
	t.mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"], now: 0 });
	let complete!: (value: { windows: { seven_day: { remainingPercent: number } } }) => void;
	const pending = new Promise<{ windows: { seven_day: { remainingPercent: number } } }>((resolve) => { complete = resolve; });
	let newer = false;
	let displayed = "";
	const consumer = new QuotaConsumer({ emit(_name, data) {
		(data as { offer(access: unknown): void }).offer({ async refresh() {
			if (newer) throw new Error("offline");
			return pending;
		} });
	} }, "session", () => { displayed = strip(footer(consumer)); }, {
		readCredential: credential,
		fetch: async () => Response.json(codex(58)),
	});
	consumer.start();
	await flush();
	assert.ok(displayed.includes("CX 42%"));
	newer = true;
	await consumer.refresh();
	complete({ windows: { seven_day: { remainingPercent: 81 } } });
	await flush();
	assert.ok(displayed.includes("CC ???"));
	assert.ok(!displayed.includes("81%"));
	consumer.stop();
});
