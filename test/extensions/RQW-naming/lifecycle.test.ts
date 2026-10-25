import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type AssistantMessage, fauxAssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import extension from "../../../extensions/RQW-naming/index.ts";

/** Public-surface mock: a handler map, recorded setSessionName calls and synchronous session_info_changed echoes. */
type Handler = (event: any, ctx: any) => unknown;

const TEN = JSON.stringify(["Alpha plan", "Beta notes", "Gamma trip", "Delta bug", "Epsilon ideas", "Zeta test", "Eta docs", "Theta refactor", "Iota review", "Kappa ship"]);
const WARNING = "Automatic session naming failed; the previous session name is kept.";

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => { resolve = r; });
	return { promise, resolve };
}

/** Each streamSimple call takes the next scripted entry: a reply text, an error, or a deferred held by the test. */
type Step = string | AssistantMessage | Promise<AssistantMessage>;

function fakeRegistry(steps: Step[]) {
	const calls: { prompt: string; signal: AbortSignal; reasoning: unknown; model: string }[] = [];
	const registry = {
		getAvailableOfType: async (_type: string, provider?: string) =>
			provider === "kimi-coding" ? [{ id: "kimi-for-coding", provider: "kimi-coding", reasoning: true }] : [],
		streamSimple: (model: any, context: any, options: any) => {
			const text = context.messages.map((m: any) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n");
			calls.push({ prompt: text, signal: options.signal, reasoning: options.reasoning, model: model.id });
			const step = steps.shift();
			const result = step === undefined ? Promise.reject(new Error("script exhausted"))
				: typeof step === "string" ? Promise.resolve(fauxAssistantMessage(step))
					: step instanceof Promise ? step : Promise.resolve(step);
			return { result: () => result };
		},
	};
	return { registry, calls, steps };
}

function mockPi() {
	const handlers = new Map<string, Handler[]>();
	const commands = new Map<string, { handler: (args: string, ctx: any) => Promise<void> }>();
	const writes: string[] = [];
	let sessionName: string | undefined;
		const pi = {
		on: (event: string, handler: Handler) => { handlers.set(event, [...(handlers.get(event) ?? []), handler]); return () => {}; },
		registerCommand: (name: string, cmd: any) => { commands.set(name, cmd); },
		setSessionName: (name: string) => {
			writes.push(name);
			sessionName = name;
			emit("session_info_changed", { type: "session_info_changed", name });
		},
		getSessionName: () => sessionName,
	} as unknown as ExtensionAPI;
	extension(pi);
	function emit(event: string, payload: any, ctx?: any) {
		for (const handler of handlers.get(event) ?? []) handler(payload, ctx ?? session.ctx);
	}
	const session = {
		id: "s1",
		entries: [] as any[],
		messages: [] as any[],
		notes: [] as { message: string; type: string }[],
		ctx: undefined as any,
	};
	session.ctx = makeCtx(session);
	return {
		session, writes, commands,
		get sessionName() { return sessionName; },
		set sessionName(v: string | undefined) { sessionName = v; },
		emit: (event: string, payload: any = {}) => emit(event, { type: event, ...payload }),
		handlers, makeCtx: () => makeCtx(session), registry: undefined as any,
		setRegistry(r: any) { session.ctx.modelRegistry = r; },
	};
}

function makeCtx(session: { id: string; entries: any[]; messages: any[]; notes: any[] }) {
	return {
		hasUI: true,
		sessionManager: {
			getSessionId: () => session.id,
			getEntries: () => session.entries,
			buildSessionProjection: () => ({ entries: [], messages: session.messages, thinkingLevel: "off", model: null }),
		},
		ui: { notify: (message: string, type: string) => session.notes.push({ message, type }) },
		modelRegistry: undefined,
	} as any;
}

/** Wait for a condition using only promise turns; bounded so a broken test fails instead of hanging. */
async function until(check: () => boolean, what: string) {
	for (let i = 0; i < 2000; i++) {
		if (check()) return;
		await new Promise((resolve) => setImmediate(resolve));
	}
	assert.fail(`timed out waiting for ${what}`);
}

const user = (text: string) => ({ role: "user", content: text, timestamp: 1 });

function setup(steps: Step[]) {
	const p = mockPi();
	const reg = fakeRegistry(steps);
	p.setRegistry(reg.registry);
	return { p, reg };
}

describe("first user message", () => {
	it("starts generation once for the first user message and never again", async () => {
		const { p, reg } = setup([TEN, "0"]);
		p.emit("session_start", { reason: "startup" });
		// Pi emits message_end before persisting the user message.
		p.emit("message_end", { message: user("FIRST-USER-CONTEXT") });
		await until(() => p.writes.length === 1, "first name");
		assert.deepEqual(p.writes, ["Alpha plan"]);
		assert.match(reg.calls[0].prompt, /FIRST-USER-CONTEXT/);
		p.emit("message_end", { message: user("second") });
		await new Promise((r) => setImmediate(r));
		assert.equal(reg.calls.length, 2);
	});

	it("does not start generation on reload or resume when a user message already exists", async () => {
		const { p, reg } = setup([TEN, "0"]);
		p.session.entries = [{ type: "message", message: user("old") }];
		p.emit("session_start", { reason: "resume" });
		p.emit("message_end", { message: user("new") });
		await new Promise((r) => setImmediate(r));
		assert.equal(reg.calls.length, 0);
		assert.deepEqual(p.writes, []);
	});

	it("ignores non-user message_end events", async () => {
		const { p, reg } = setup([]);
		p.emit("session_start", { reason: "startup" });
		p.emit("message_end", { message: { role: "assistant", content: [] } });
		await new Promise((r) => setImmediate(r));
		assert.equal(reg.calls.length, 0);
	});
});

describe("compaction and rename-gen", () => {
	it("triggers on every successful session_compact with the full post-compaction context", async () => {
		const { p, reg } = setup([TEN, "0", TEN, "1"]);
		p.emit("session_start", { reason: "startup" });
		p.session.messages = [
			{ role: "compactionSummary", summary: "COMPACT-SUMMARY", tokensBefore: 100, timestamp: 1 },
			user("KEPT-ONE"), user("KEPT-TWO"),
			{ role: "toolResult", toolCallId: "t1", toolName: "read", content: [{ type: "text", text: "x".repeat(20000) + "FULL-TOOL-TAIL" }], isError: false, timestamp: 1 },
		];
		p.emit("session_compact", { compactionEntry: {}, reason: "manual", fromExtension: false, willRetry: false });
		await until(() => p.writes.length === 1, "first compaction name");
		p.session.messages = [user("LATER-THREE")];
		p.emit("session_compact", { compactionEntry: {}, reason: "threshold", fromExtension: false, willRetry: false });
		await until(() => p.writes.length === 2, "second compaction name");
		assert.match(reg.calls[0].prompt, /COMPACT-SUMMARY/);
		assert.match(reg.calls[0].prompt, /FULL-TOOL-TAIL/);
		assert.match(reg.calls[0].prompt, /KEPT-ONE/);
		assert.match(reg.calls[0].prompt, /KEPT-TWO/);
		assert.match(reg.calls[2].prompt, /LATER-THREE/);
		assert.doesNotMatch(reg.calls[2].prompt, /KEPT-ONE/);
	});

	it("rename-gen runs the same pipeline and returns undefined at once", async () => {
		const { p, reg } = setup([TEN, "2"]);
		p.session.messages = [user("ctx")];
		const cmd = p.commands.get("rename-gen")!;
		const result = await cmd.handler("", p.session.ctx);
		assert.equal(result, undefined);
		await until(() => p.writes.length === 1, "rename-gen name");
		assert.deepEqual(p.writes, ["Gamma trip"]);
		assert.equal(reg.calls.length, 2);
	});

	it("rename-gen exhausts four failing attempts including invalid length, warns once and keeps the previous name", async () => {
		const invalidLength = JSON.stringify(Array(10).fill("x".repeat(33)));
		const { p, reg } = setup([
			fauxAssistantMessage("", { stopReason: "error" }),
			invalidLength,
			"not json",
			fauxAssistantMessage("", { stopReason: "error" }),
		]);
		p.sessionName = "previous";
		p.session.messages = [user("rename context")];
		await p.commands.get("rename-gen")!.handler("", p.session.ctx);
		await until(() => p.session.notes.length === 1, "rename-gen final warning");
		assert.equal(reg.calls.length, 4);
		assert.equal(reg.steps.length, 0);
		assert.deepEqual(p.session.notes, [{ message: WARNING, type: "warning" }]);
		assert.deepEqual(p.writes, []);
		assert.equal(p.sessionName, "previous");
	});

	it("registers only rename-gen as a command", () => {
		const { p } = setup([]);
		assert.deepEqual([...p.commands.keys()], ["rename-gen"]);
	});

	it("returns from the trigger immediately while the provider is still pending", async () => {
		const held = deferred<AssistantMessage>();
		const { p } = setup([held.promise]);
		p.session.messages = [user("ctx")];
		const returned = p.handlers.get("session_compact")![0]({ type: "session_compact" }, p.session.ctx);
		assert.equal(returned, undefined);
		assert.deepEqual(p.writes, []);
		held.resolve(fauxAssistantMessage(TEN));
	});
});

describe("cancellation and stale writes", () => {
	it("a newer trigger aborts the older run; only the newer result is written", async () => {
		const older = deferred<AssistantMessage>();
		const { p, reg } = setup([older.promise, TEN, "0"]);
		p.session.messages = [user("a")];
		p.emit("session_compact", {});
		await until(() => reg.calls.length === 1, "first attempt started");
		const firstSignal = reg.calls[0].signal;
		p.emit("session_compact", {});
		assert.equal(firstSignal.aborted, true);
		older.resolve(fauxAssistantMessage(TEN));
		await until(() => p.writes.length === 1, "newer name");
		assert.deepEqual(p.writes, ["Alpha plan"]);
	});

	it("session_start aborts the in-flight run without writing or warning", async () => {
		const held = deferred<AssistantMessage>();
		const { p, reg } = setup([held.promise]);
		p.session.messages = [user("a")];
		p.emit("session_compact", {});
		await until(() => reg.calls.length === 1, "attempt started");
		p.emit("session_start", { reason: "resume" });
		assert.equal(reg.calls[0].signal.aborted, true);
		held.resolve(fauxAssistantMessage(TEN));
		await new Promise((r) => setImmediate(r));
		await new Promise((r) => setImmediate(r));
		assert.deepEqual(p.writes, []);
		assert.deepEqual(p.session.notes, []);
	});

	it("session_shutdown aborts the in-flight run", async () => {
		const held = deferred<AssistantMessage>();
		const { p, reg } = setup([held.promise]);
		p.session.messages = [user("a")];
		p.emit("session_compact", {});
		await until(() => reg.calls.length === 1, "attempt started");
		p.emit("session_shutdown", { reason: "quit" });
		assert.equal(reg.calls[0].signal.aborted, true);
		held.resolve(fauxAssistantMessage("[]"));
		await new Promise((r) => setImmediate(r));
		assert.deepEqual(p.writes, []);
		assert.deepEqual(p.session.notes, []);
	});

	it("a session switch (different session id) suppresses the write and the warning", async () => {
		const held = deferred<AssistantMessage>();
		const { p } = setup([held.promise]);
		p.session.messages = [user("a")];
		p.emit("session_compact", {});
		p.session.id = "other-session";
		held.resolve(fauxAssistantMessage(TEN));
		await new Promise((r) => setImmediate(r));
		await new Promise((r) => setImmediate(r));
		assert.deepEqual(p.writes, []);
	});

	it("own setSessionName echo does not cancel its own run", async () => {
		const { p, reg } = setup([TEN, "0"]);
		p.session.messages = [user("a")];
		p.emit("session_compact", {});
		await until(() => p.writes.length === 1, "own write");
		assert.equal(reg.calls[1].signal.aborted, false);
	});

	it("a manual name cancels pending generation and stays until the next trigger", async () => {
		const held = deferred<AssistantMessage>();
		const { p, reg } = setup([held.promise, TEN, "1"]);
		p.session.messages = [user("a")];
		p.emit("session_compact", {});
		await until(() => reg.calls.length === 1, "attempt started");
		p.sessionName = "manual";
		p.emit("session_info_changed", { name: "manual" });
		assert.equal(reg.calls[0].signal.aborted, true);
		held.resolve(fauxAssistantMessage(TEN));
		await new Promise((r) => setImmediate(r));
		assert.deepEqual(p.writes, []);
		assert.equal(p.sessionName, "manual");
		p.emit("session_compact", {});
		await until(() => p.writes.length === 1, "next trigger overwrite");
		assert.deepEqual(p.writes, ["Beta notes"]);
	});
});

describe("retries and failure", () => {
	it("makes the initial attempt plus three retries, then one fixed warning and keeps the old name", async () => {
		const { p, reg } = setup([
			fauxAssistantMessage("", { stopReason: "error", errorMessage: "secret-key-123" }),
			"not json", "[]", fauxAssistantMessage("", { stopReason: "error", errorMessage: "boom" }),
		]);
		p.sessionName = "previous";
		p.session.messages = [user("a")];
		p.emit("session_compact", {});
		await until(() => p.session.notes.length === 1, "warning");
		assert.equal(reg.calls.length, 4);
		assert.deepEqual(p.session.notes, [{ message: WARNING, type: "warning" }]);
		assert.deepEqual(p.writes, []);
		assert.equal(p.sessionName, "previous");
		assert.doesNotMatch(p.session.notes[0].message, /secret|boom/);
	});

	it("succeeds on the last retry", async () => {
		const { p, reg } = setup(["not json", "not json", "not json", TEN, "0"]);
		p.session.messages = [user("a")];
		p.emit("session_compact", {});
		await until(() => p.writes.length === 1, "last-retry name");
		assert.equal(reg.calls.length, 5);
		assert.deepEqual(p.writes, ["Alpha plan"]);
		assert.deepEqual(p.session.notes, []);
	});

	it("an attempt with only invalid candidates consumes the attempt", async () => {
		const bad = JSON.stringify(Array(10).fill("one two three four five"));
		const { p, reg } = setup([bad, TEN, "0"]);
		p.session.messages = [user("a")];
		p.emit("session_compact", {});
		await until(() => p.writes.length === 1, "name after invalid attempt");
		assert.equal(reg.calls.length, 3);
		assert.deepEqual(p.writes, ["Alpha plan"]);
	});

	it("no warning is shown when the session has been replaced before the final failure", async () => {
		const { p } = setup(["not json", "not json", "not json", "not json"]);
		p.session.messages = [user("a")];
		p.emit("session_compact", {});
		p.session.id = "replaced";
		for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
		assert.deepEqual(p.session.notes, []);
	});
});
