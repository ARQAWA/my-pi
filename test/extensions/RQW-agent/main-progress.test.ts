import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, before, test } from "node:test";
import type { TestContext } from "node:test";
import { createFauxCore, fauxAssistantMessage as fauxAssistant, fauxToolCall, normalizeContext, type AssistantMessage } from "@earendil-works/pi-ai";
import { convertToLlm, createEventBus, generateSummary, SessionManager, type ExtensionAPI, type Theme } from "@earendil-works/pi-coding-agent";

const { prepareCompaction } = await import(new URL("core/compaction/compaction.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href);
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import agent from "../../../extensions/RQW-agent/index.ts";

let root: string;
const saved = { codex: process.env.CODEX_HOME, agent: process.env.PI_CODING_AGENT_DIR };
const tasks: Promise<unknown>[] = [];
const shutdowns: (() => void)[] = [];
before(() => {
	root = mkdtempSync(join(tmpdir(), "rqw-main-progress-world-"));
	process.env.CODEX_HOME = join(root, "codex");
	process.env.PI_CODING_AGENT_DIR = join(root, "agent");
	mkdirSync(join(root, "project", ".git"), { recursive: true });
});
afterEach(async () => { while (shutdowns.length) shutdowns.pop()!(); await settle(); });
after(() => {
	for (const [key, value] of [["CODEX_HOME", saved.codex], ["PI_CODING_AGENT_DIR", saved.agent]] as const) {
		if (value === undefined) delete process.env[key]; else process.env[key] = value;
	}
	rmSync(root, { recursive: true, force: true });
});

function fauxAssistantMessage(content: Parameters<typeof fauxAssistant>[0], options: Partial<AssistantMessage> = {}): AssistantMessage {
	return { ...fauxAssistant(content, { timestamp: 0 }), ...options };
}
const CARD = "rqw-main-progress-v1";
const COUNTER = "rqw-main-progress-counter-v1";
const summary = { paragraphs: [
	{ main: "нашёл причину потери уведомлений.", details: ["проверил загрузку истории после компактации."] },
	{ main: "проверяю восстановление после перезапуска.", details: ["осталось проверить поведение на windows."] },
] };
const report = (text = JSON.stringify(summary)) => fauxAssistantMessage(text);
const theme = {
	fg: (_role: string, text: string) => text,
	bg: (_role: string, text: string) => text,
	bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
} as Theme;
async function settle() {
	while (tasks.length) await Promise.all(tasks.splice(0));
	for (let i = 0; i < 8; i++) await Promise.resolve();
}

function host(options: { provider?: string; mode?: string; file?: string; replay?: boolean } = {}) {
	if (options.file && !options.replay) appendFileSync(options.file, JSON.stringify({ type: "session", version: 3, id: "main", cwd: join(root, "project"), timestamp: "2026-10-30T00:00:00.000Z" }) + "\n");
	const entries: any[] = options.replay ? readFileSync(options.file!, "utf8").trim().split("\n").filter(Boolean).map(row => JSON.parse(row)).filter(entry => entry.type !== "session") : [];
	const byId = new Map(entries.map(entry => [entry.id, entry]));
	const hooks = new Map<string, ((event: any, ctx: any) => unknown)[]>();
	const renderers = new Map<string, any>();
	const requests: any[] = [];
	const pending: ReturnType<typeof Promise.withResolvers<AssistantMessage>>[] = [];
	let serial = entries.length;
	let leaf = entries.at(-1);
	let messages = entries.filter(entry => entry.message?.role === "assistant" && entry.message.stopReason === "toolUse").length;
	let sessionId = "main";
	let controller = new AbortController();
	let failWrite = false;
	let oldestAllowed: string | undefined;
	const provider = options.provider ?? "anthropic";
	const model = { provider, id: "physical", api: provider === "anthropic" ? "anthropic-messages" : "openai-codex-responses", contextWindow: 200000, maxTokens: 8192 };
	const append = (data: any) => {
		const entry = { ...data, id: `entry-${++serial}`, parentId: leaf?.id ?? null, timestamp: "2026-10-30T00:00:00.000Z" };
		entries.push(entry); byId.set(entry.id, entry); leaf = entry;
		if (options.file) appendFileSync(options.file, JSON.stringify(entry) + "\n");
		return entry;
	};
	const noFullScan = () => { throw new Error("The main progress reader must not copy the whole branch"); };
	const ctx: any = {
		cwd: join(root, "project"), mode: options.mode ?? "tui", model, signal: controller.signal,
		isIdle: () => true,
		ui: { notify: () => { throw new Error("No progress error UI is permitted"); }, getEditorText: () => "черновик", theme },
		sessionManager: {
			getSessionId: () => sessionId,
			getLeafEntry: () => leaf,
			getEntry: (id: string) => {
				if (oldestAllowed && Number(id.slice(6)) < Number(oldestAllowed.slice(6))) throw new Error("Read beyond 65 complete steps");
				return byId.get(id);
			},
			getEntries: () => entries, // The shipped child runtime reads these at session_start.
			getBranch: noFullScan, buildSessionProjection: noFullScan,
		},
		modelRegistry: {
			find: (p: string, id: string) => p === provider && id === model.id ? model : undefined,
			streamSimple: (selected: any, context: any, requestOptions: any) => {
				requests.push({ model: selected, context, options: requestOptions });
				const reply = Promise.withResolvers<AssistantMessage>(); pending.push(reply);
				return { result: () => reply.promise };
			},
		},
	};
	const pi: any = {
		events: createEventBus(), registerCommand() {}, registerTool() {}, getThinkingLevel: () => "high",
		on(name: string, hook: any) { hooks.set(name, [...hooks.get(name) ?? [], hook]); },
		registerEntryRenderer: (name: string, renderer: any) => renderers.set(name, renderer),
		appendEntry: (customType: string, data: any) => {
			if (failWrite) throw new Error("disk full");
			append({ type: "custom", customType, data });
		},
		sendMessage: () => { throw new Error("Progress must never become a model message"); },
	};
	agent(pi as ExtensionAPI);
	const emit = (name: string, event: any = {}) => {
		for (const hook of hooks.get(name) ?? []) {
			const result = hook(event, ctx);
			if (result instanceof Promise) tasks.push(result);
		}
	};
	shutdowns.push(() => emit("session_shutdown"));
	const end = (message: any) => {
		emit("message_end", { message });
		return append({ type: "message", message }); // Pi persists only AFTER extension message_end hooks.
	};
	const step = (text?: string, count = 1, args: any = { path: "source.ts" }, reasoning: string | null = "high", toolName = "read") => {
		const n = ++messages;
		const calls = Array.from({ length: count }, (_value, i) => fauxToolCall(i === 0 ? toolName : "grep", args, { id: `call-${n}-${i}` }));
		const message = fauxAssistantMessage([...(text === undefined ? [] : [{ type: "text" as const, text }]), ...calls],
			{ provider, model: model.id, stopReason: "toolUse", timestamp: n, ...(reasoning === null ? {} : { thinkingLevel: reasoning as any }) });
		return { message, entry: end(message) };
	};
	const many = (n: number) => { for (let i = 0; i < n; i++) step(); };
	const cards = () => entries.filter(entry => entry.type === "custom" && entry.customType === CARD);
	const rows = (entry: any, width = 80) => renderers.get(CARD)(entry, { expanded: false }, theme)?.render(width) as string[];
	emit("session_start");
	return { ctx, pi, hooks, entries, requests, pending, append, emit, end, step, many, cards, rows, renderers,
		failWrite(value: boolean) { failWrite = value; },
		restrict(id: string) { oldestAllowed = id; },
		restart() { emit("session_start"); },
		switchSession() { sessionId = "another"; emit("session_start"); },
		navigate(id: string) { leaf = byId.get(id); emit("session_tree", { newLeafId: id }); },
		abort() { controller.abort(); controller = new AbortController(); ctx.signal = controller.signal; },
	};
}

function records(request: any): any[] { return JSON.parse(request.context.messages[0].content); }
function temp(t: TestContext): string {
	const root = mkdtempSync(join(tmpdir(), "rqw-main-progress-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	return join(root, "session.jsonl");
}

test("the shipped top-level registration offers the main entry renderer", () => {
	const renderers = new Map();
	agent({ on() {}, events: createEventBus(), registerEntryRenderer: (type: string, renderer: any) => renderers.set(type, renderer),
		registerCommand() {}, registerTool() {},
	} as unknown as ExtensionAPI);
	assert.equal(typeof renderers.get(CARD), "function");
});

test("50 message_end steps trigger before hanging tools; 65-step overlap includes the current running calls", async () => {
	const f = host();
	f.many(49); await settle(); assert.equal(f.requests.length, 0);
	f.step(); await settle(); assert.equal(f.requests.length, 1);
	assert.deepEqual(records(f.requests[0]).map(record => record.step), Array.from({ length: 50 }, (_v, i) => i + 1));
	assert.equal(records(f.requests[0]).at(-1).calls[0].status, "running");
	// No tool result, tool end or turn_end has been emitted.
	f.pending[0].resolve(report()); await settle();
	assert.equal(f.cards().length, 1);
	f.many(50); await settle();
	assert.deepEqual(records(f.requests[1]).map(record => record.step), Array.from({ length: 65 }, (_v, i) => i + 36));
	f.pending[1].resolve(report()); await settle();
	assert.equal(f.cards().length, 2);
	assert.deepEqual(f.cards().map(entry => [entry.data.firstStep, entry.data.lastStep]), [[1, 50], [36, 100]]);
});

test("only agent text resets silence; owner input, jobs, child notices, thinking and tool results do not", async () => {
	const f = host(); f.many(49);
	f.emit("input", { text: "новая просьба", source: "interactive" });
	f.end({ role: "user", content: "новая просьба", timestamp: 1 });
	f.end({ role: "custom", customType: "job", content: "[job] done", timestamp: 1 });
	f.end({ role: "custom", customType: "agent_progress", content: "child update", timestamp: 1 });
	f.emit("message_update", { message: fauxAssistantMessage([{ type: "thinking", thinking: "reasoning" }]), assistantMessageEvent: { type: "thinking_delta", delta: "reasoning" } });
	f.end({ role: "toolResult", toolCallId: "unrelated", toolName: "read", content: [{ type: "text", text: "result" }], timestamp: 1 });
	f.step("   ", 3); await settle();
	assert.equal(f.requests.length, 1); f.pending[0].resolve(report()); await settle();
	assert.equal(f.cards().length, 1);
	f.many(49);
	f.emit("message_update", { message: fauxAssistantMessage("проверяю границы."), assistantMessageEvent: { type: "text_delta", delta: "проверяю" } });
	f.step(); await settle(); assert.equal(f.requests.length, 1);
	f.many(49); await settle(); assert.equal(f.requests.length, 2);
	f.pending[1].resolve(report()); await settle(); assert.equal(f.cards().length, 2);
	f.many(49); f.step("промежуточный текст.", 2); f.many(49); await settle(); assert.equal(f.requests.length, 2);
	f.step(); await settle(); f.pending[2].resolve(report()); await settle(); assert.equal(f.cards().length, 3);
});

test("a reached report survives intermediate text, owner input, model selection and a final answer", async () => {
	const f = host(); f.many(50); await settle();
	f.end(fauxAssistantMessage("закончил проверку.", { provider: "anthropic", model: "physical" }));
	f.emit("agent_end", { messages: [] });
	f.emit("input", { text: "следующий вопрос" });
	f.emit("model_select", { model: { provider: "openai-codex", id: "other" } });
	f.ctx.model = { provider: "openai-codex", id: "other" };
	f.pending[0].resolve(report()); await settle();
	assert.equal(f.cards().length, 1);
	assert.equal(f.requests[0].options.signal.aborted, false);
	const finalAt = f.entries.findIndex(entry => entry.message?.content?.[0]?.text === "закончил проверку.");
	assert.ok(finalAt < f.entries.indexOf(f.cards()[0]));
	f.many(49); await settle(); assert.equal(f.requests.length, 1);
	f.step(); await settle(); f.pending[1].resolve(report()); await settle(); assert.equal(f.cards().length, 2);
});

test("tree navigation cancels abandoned summaries and restores the selected branch count and range", async () => {
	const f = host(); f.many(10);
	const fork = f.entries.at(-1).id;
	f.many(40); await settle(); assert.equal(f.requests.length, 1);
	f.navigate(fork);
	f.pending[0].resolve(report()); await settle();
	assert.equal(f.requests[0].options.signal.aborted, true);
	assert.equal(f.cards().length, 0, "an abandoned report must not land on the selected branch");
	f.many(39); await settle(); assert.equal(f.requests.length, 1);
	f.step(); await settle(); assert.equal(f.requests.length, 2);
	assert.deepEqual(records(f.requests[1]).map(record => record.step), Array.from({ length: 50 }, (_v, i) => i + 1));
	f.pending[1].resolve(report()); await settle();
	assert.deepEqual(f.cards().map(card => [card.data.firstStep, card.data.lastStep]), [[1, 50]]);
});

test("slow summaries remain independent and can arrive in reverse order", async () => {
	const f = host(); f.many(50); await settle();
	f.many(50); await settle(); assert.equal(f.requests.length, 2);
	f.pending[1].resolve(report()); await settle(); f.pending[0].resolve(report()); await settle();
	assert.deepEqual(f.cards().map(entry => entry.data.lastStep), [100, 50]);
	assert.ok(f.requests.every(request => !request.options.signal.aborted));
});

for (const stop of ["abort", "session", "shutdown"] as const) test(`${stop} alone cancels pending reports; a fresh series still works`, async () => {
	const f = host(); f.many(50); await settle();
	if (stop === "abort") f.abort();
	else if (stop === "session") f.switchSession();
	else f.emit("session_shutdown");
	f.pending[0].resolve(report()); await settle(); assert.equal(f.cards().length, 0);
	assert.equal(f.requests[0].options.signal.aborted, true);
	if (stop === "shutdown") f.restart();
	f.many(50); await settle(); f.pending[1].resolve(report()); await settle(); assert.equal(f.cards().length, 1);
});

for (const bad of ["network", "invalid JSON", "eight words", "two lowercase sentences", "control", "uppercase", "three paragraphs", "tool call", "disk"] as const) {
	test(`silent ${bad} failure retries only on the next reached threshold`, async () => {
		const f = host(); f.many(50); await settle();
		if (bad === "network") f.pending[0].reject(new Error("provider timeout"));
		else if (bad === "disk") { f.failWrite(true); f.pending[0].resolve(report()); }
		else if (bad === "tool call") f.pending[0].resolve(fauxAssistantMessage([fauxToolCall("write", { path: "forbidden" }, { id: "forbidden" })], { stopReason: "toolUse" }));
		else {
			let body: unknown = summary;
			if (bad === "eight words") body = { paragraphs: [{ main: "один два три четыре пять шесть семь восемь.", details: [] }] };
			if (bad === "two lowercase sentences") body = { paragraphs: [{ main: "нашёл причину. проверяю решение.", details: [] }] };
			if (bad === "control") body = { paragraphs: [{ main: "нашёл \x1bпричину.", details: [] }] };
			if (bad === "uppercase") body = { paragraphs: [{ main: "Нашёл причину.", details: [] }] };
			if (bad === "three paragraphs") body = { paragraphs: [...summary.paragraphs, summary.paragraphs[0]] };
			f.pending[0].resolve(report(bad === "invalid JSON" ? "not JSON" : JSON.stringify(body)));
		}
		await settle(); assert.equal(f.cards().length, 0); f.failWrite(false);
		f.many(49); await settle(); assert.equal(f.requests.length, 1);
		f.step(); await settle(); f.pending[1].resolve(report()); await settle();
		assert.equal(f.cards().length, 1); assert.equal(f.cards()[0].data.lastStep, 100);
	});
}

test("results are joined by call ID; large data stays bounded and unfinished work is running", async () => {
	const f = host();
	const toolName = (n: number) => n % 2 === 0 ? "read" : "grep";
	const path = (n: number) => `step-${n}:` + "x".repeat(200000);
	for (let i = 0; i < 49; i++) {
		const { message } = f.step(undefined, 1, { path: path(i + 1), nested: { long: "y".repeat(200000) } }, "high", toolName(i + 1));
		f.end({ role: "toolResult", toolCallId: message.content.find(part => part.type === "toolCall")!.id, toolName: toolName(i + 1),
			content: [{ type: "text", text: "z".repeat(200000) }], isError: i === 48, timestamp: 1,
			details: i === 47 ? { job: { state: "running" } } : undefined });
	}
	f.step(undefined, 80, { path: path(50) }, "high", toolName(50)); await settle();
	const request = f.requests[0];
	assert.ok(Buffer.byteLength(request.context.messages[0].content) <= 65536);
	const window = records(request); assert.equal(window.length, 50);
	assert.equal(window[0].calls[0].status, "success");
	assert.equal(window[47].calls[0].status, "running");
	assert.equal(window[48].calls[0].status, "error");
	assert.equal(window[49].calls[0].status, "running");
	assert.equal(window[49].omittedCalls, 76);
	f.pending[0].resolve(report()); await settle(); assert.equal(f.cards().length, 1);
	for (let i = 51; i < 100; i++) {
		const { message } = f.step(undefined, 4, { path: path(i) }, "high", toolName(i));
		for (const call of message.content) if (call.type === "toolCall") f.end({
			role: "toolResult", toolCallId: call.id, toolName: call.name,
			content: [{ type: "text", text: "z".repeat(200000) }], timestamp: 1,
		});
	}
	f.step(undefined, 80, { path: path(100) }, "high", toolName(100)); await settle();
	const second = f.requests[1];
	assert.ok(Buffer.byteLength(second.context.messages[0].content) <= 65536);
	assert.deepEqual(records(second).map(record => record.step), Array.from({ length: 65 }, (_v, i) => i + 36));
	for (const record of records(second)) {
		assert.ok(record.calls.length > 0, `step ${record.step} must retain its tool call`);
		for (const [index, call] of record.calls.entries()) {
			assert.equal(call.name, index === 0 ? toolName(record.step) : "grep");
			assert.ok(call.argsPreview.path.startsWith(`step-${record.step}:`), `step ${record.step} must retain its own argument excerpt`);
		}
		assert.equal(record.truncated, true);
	}
	assert.equal(records(second).at(-1).omittedCalls, 76);
	assert.equal(records(second).at(-1).calls[0].status, "running");
	f.pending[1].resolve(report()); await settle();
	assert.deepEqual(f.cards().at(-1).data.lastStep, 100);
});

test("JSONL replay and compaction keep the card out of main and compaction model messages", async t => {
	const file = temp(t); const f = host({ file });
	f.end({ role: "user", content: "original main prompt", timestamp: 0 });
	f.many(50); await settle(); f.pending[0].resolve(report()); await settle();
	assert.equal(f.cards().length, 1);
	const manager = SessionManager.open(file);
	assert.ok(manager.getBranch().some(entry => entry.type === "custom" && entry.customType === CARD));
	assert.ok(manager.getBranch().some(entry => entry.type === "custom" && entry.customType === COUNTER));
	const core = createFauxCore({ provider: "main-payload", models: [{ id: "model" }] });
	const model = core.getModel("model")!;
	const payloads: any[] = [];
	core.setResponses(Array.from({ length: 2 }, () => async (context: any) => {
		payloads.push(context); return fauxAssistantMessage("summary result");
	}));
	await core.streamSimple(model, normalizeContext({ messages: convertToLlm(manager.buildSessionContext().messages) })).result();
	// Use Pi's compaction selection and its actual serialization/conversion before the fake provider boundary.
	manager.appendMessage({ role: "user", content: "keep recent main turn", timestamp: 1 });
	const prepared = prepareCompaction(manager.getBranch(), { enabled: true, keepRecentTokens: 1, reserveTokens: 100 });
	assert.ok(prepared);
	await generateSummary([...prepared.messagesToSummarize, ...prepared.turnPrefixMessages], model, undefined,
		undefined, undefined, undefined, undefined, undefined, "off", core.streamSimple as any);
	assert.equal(payloads.length, 2);
	for (const payload of payloads) {
		const text = JSON.stringify(payload);
		assert.ok(text.includes("original main prompt"), "real main context reaches both provider inputs");
		for (const forbidden of [CARD, COUNTER, summary.paragraphs[0].main, "sourceToolCallId", "silentCount"]) {
			assert.ok(!text.includes(forbidden), `${forbidden} must stay outside model input`);
		}
	}
	const g = host({ file, replay: true });
	assert.equal(g.requests.length, 0);
	assert.deepEqual(g.cards()[0], f.cards()[0]);
	g.many(50); await settle(); g.pending[0].resolve(report()); await settle();
	assert.equal(g.cards().length, 2);
	assert.equal(g.cards()[1].data.lastStep, 100);
});

test("resume walks only parent links and does not replay the checkpoint source twice", async t => {
	const file = temp(t); const f = host({ file });
	f.many(149); await settle();
	for (const reply of f.pending) reply.resolve(report());
	await settle();
	const g = host({ file, replay: true });
	assert.equal(g.requests.length, 0);
	const oldest = g.entries.find(entry => entry.message?.content?.some((part: any) => part.id === "call-85-0"));
	g.restrict(oldest.id);
	g.restart(); // Will throw on full-copy APIs or any parent older than the complete 65-step window.
	g.step(); await settle();
	assert.equal(g.requests.length, 1);
	assert.deepEqual(records(g.requests[0]).map(record => record.step), Array.from({ length: 65 }, (_v, i) => i + 86));
	g.pending[0].resolve(report()); await settle();
	assert.equal(g.cards().at(-1).data.lastStep, 150);
	assert.equal(g.cards().length, 3);
});

test("a checkpoint without its persisted source does not advance the restored counter", async () => {
	const f = host(); f.many(49);
	f.append({ type: "custom", customType: COUNTER, data: { stepOrdinal: 50, silentCount: 50, sourceToolCallId: "not-written" } });
	f.restart(); f.step(); await settle();
	assert.equal(f.requests.length, 1);
	f.pending[0].resolve(report()); await settle(); assert.equal(f.cards()[0].data.lastStep, 50);
});

test("a sparse branch can reach the root without entry caps or history copies", async () => {
	const f = host();
	for (let i = 0; i < 10000; i++) f.append({ type: "custom", customType: "unrelated", data: {} });
	f.many(49); f.restart(); f.step(); await settle();
	assert.equal(records(f.requests[0]).length, 50);
	f.pending[0].resolve(report()); await settle(); assert.equal(f.cards().length, 1);
});

test("the native renderer has an English label, two bold Russian paragraphs and portable wrapping", async () => {
	const f = host(); f.many(50); await settle(); f.pending[0].resolve(report()); await settle();
	const entry = f.cards()[0];
	for (const width of [12, 40, 80]) {
		const rows = f.rows(entry, width);
		assert.ok(rows.every(row => visibleWidth(row) <= width));
		const text = stripTerminalSequences(rows.join("\n"));
		if (width === 80) {
			assert.ok(text.includes("Progress update")); assert.ok(text.includes("steps 1–50"));
			assert.ok(text.includes(summary.paragraphs[0].main)); assert.ok(text.includes(summary.paragraphs[1].main));
		}
		assert.equal((rows.join("\n").match(/\x1b\[1m/g) ?? []).length >= 2, true);
	}
	assert.deepEqual(f.renderers.get(CARD)(entry, { expanded: true }, theme).render(80), f.rows(entry));
	assert.equal(f.ctx.ui.getEditorText(), "черновик");
});

for (const provider of ["anthropic", "openai-codex"]) test(`${provider} summary uses a detached registry request and the physical effort`, async () => {
	const f = host({ provider }); f.many(49); f.step(undefined, 1, {}, "low"); await settle();
	const request = f.requests[0];
	assert.equal(request.model.provider, provider); assert.equal(request.model.id, "physical");
	assert.equal(request.options.reasoning, "low");
	assert.equal(request.options.sessionId, undefined); assert.equal(request.options.onPayload, undefined);
	assert.equal(request.context.tools, undefined);
	assert.equal(request.context.messages.length, 1);
	assert.ok(request.context.systemPrompt.includes("at most 65"));
	assert.ok(!request.context.systemPrompt.includes("original main prompt"));
	f.pending[0].resolve(report()); await settle(); assert.equal(f.cards().length, 1);
});

test("absent actual effort stays absent and a compacted context does not change a pending snapshot", async () => {
	const f = host(); f.many(49); f.step(undefined, 1, {}, null); await settle();
	assert.equal(f.requests[0].options.reasoning, undefined);
	const snapshot = JSON.stringify(f.requests[0].context);
	f.emit("session_compact"); f.append({ type: "compaction", firstKeptEntryId: f.entries.at(-1).id, summary: "new summary" });
	f.many(2); assert.equal(JSON.stringify(f.requests[0].context), snapshot);
	f.pending[0].resolve(report()); await settle(); assert.equal(f.cards().length, 1);
});

test("a smaller model window reduces excerpts without changing the 65-step range", async () => {
	const f = host(); f.ctx.model.contextWindow = 20000;
	f.many(50); await settle();
	const request = f.requests[0];
	const budget = request.model.contextWindow - request.model.maxTokens - Buffer.byteLength(request.context.systemPrompt) - 512;
	assert.ok(Buffer.byteLength(request.context.messages[0].content) <= budget);
	assert.equal(records(request).length, 50);
	f.pending[0].resolve(report()); await settle(); assert.equal(f.cards().length, 1);
	f.ctx.model.contextWindow = 100;
	f.many(50); await settle(); assert.equal(f.requests.length, 1);
	f.ctx.model.contextWindow = 200000;
	f.many(50); await settle(); f.pending[1].resolve(report()); await settle(); assert.equal(f.cards().length, 2);
});

test("resume preserves an assistant reset after a checkpoint without resetting for owner text", async t => {
	const file = temp(t); const f = host({ file }); f.many(99); await settle();
	for (const reply of f.pending) reply.resolve(report());
	await settle();
	f.end(fauxAssistantMessage("проверяю новый вариант."));
	f.end({ role: "user", content: "ещё одна просьба", timestamp: 0 });
	f.many(49);
	const g = host({ file, replay: true }); g.step(); await settle();
	assert.equal(g.requests.length, 1);
	g.pending[0].resolve(report()); await settle();
	assert.equal(g.cards().at(-1).data.lastStep, 149);
});

test("normal steps and rendering never walk the history between thresholds", async () => {
	const f = host(); let reads = 0;
	const get = f.ctx.sessionManager.getEntry;
	f.ctx.sessionManager.getEntry = (id: string) => { reads++; return get(id); };
	f.many(49); assert.equal(reads, 0);
	f.step(); await settle(); assert.ok(reads > 0);
	f.pending[0].resolve(report()); await settle();
	const atThreshold = reads;
	f.rows(f.cards()[0]); f.rows(f.cards()[0], 40);
	f.many(49); assert.equal(reads, atThreshold);
	assert.equal(f.cards().length, 1);
});

for (const mode of ["print", "json", "rpc"]) test(`${mode} mode has no automatic main progress request`, async () => {
	const f = host({ mode }); f.many(100); await settle(); assert.equal(f.requests.length, 0);
	const tui = host(); tui.many(50); await settle(); tui.pending[0].resolve(report()); await settle(); assert.equal(tui.cards().length, 1);
});
