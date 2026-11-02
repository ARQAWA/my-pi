import assert from "node:assert/strict";
import { it } from "node:test";
import type { AgentSession, ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";
import { bindSession, suppressSummaryRetries } from "../../../extensions/RQW-codex/lifecycle.ts";
import { CODEX_RETRY_OWNED_DIAGNOSTIC } from "../../../extensions/RQW-codex/retry.ts";

const model = { provider: "openai-codex", api: "openai-codex-responses" } as Model<Api>;
type Request = { cacheRetention?: string; sessionId: string };
/** Pi's summary entry points; each sends its request through the shared runtime, as Pi 1.5 does. */
const summaryMethods = (runtime: object, context: unknown, request: Request) => {
	const send = () => (runtime as unknown as ModelRuntime).streamSimple(model, context as never, request as never).result();
	return { _runDefaultCompaction: send, navigateTree: send, summarizeForBugReport: send };
};

it("suppresses only owned summary retries without changing the agent stream", async () => {
	let listener: (event: { type: string }) => void = () => undefined;
	const message = { role: "assistant", stopReason: "error", provider: "openai-codex", api: "openai-codex-responses", errorMessage: "exhausted", diagnostics: [{ type: CODEX_RETRY_OWNED_DIAGNOSTIC }] };
	const runtime = { streamSimple: () => ({ result: async () => message }) };
	const agent = { streamFunction: () => undefined };
	const agentStream = agent.streamFunction;
	const original = runtime.streamSimple;
	const context = { messages: [{ role: "user", content: "Summarize" }] };
	const session = {
		sessionId: "root", agent, modelRuntime: runtime,
		subscribe(fn: typeof listener) { listener = fn; return () => undefined; },
		dispose() {}, _isRetryableError() { return true; },
		...summaryMethods(runtime, context, { cacheRetention: "none", sessionId: "summary" }),
	} as unknown as AgentSession;
	const release = bindSession(session, {});
	try {
		listener({ type: "compaction_start" });
		assert.equal(session.agent.streamFunction, agentStream);
		assert.equal((session as any)._isRetryableError(message), false);
		for (const name of ["_runDefaultCompaction", "navigateTree", "summarizeForBugReport"]) {
			await assert.rejects((session as any)[name](), /Summarization failed: exhausted/);
		}
		const stream = (runtime as unknown as ModelRuntime).streamSimple;
		assert.equal(await stream.call(runtime, model, context as never, { cacheRetention: "none", sessionId: "root" }).result(), message);
		listener({ type: "compaction_end" });
		assert.equal(runtime.streamSimple, original);
	} finally { release(); }
});

it("shares a runtime hook across sessions and restores it after both release", async () => {
	const owned = { role: "assistant", stopReason: "error", provider: "openai-codex", api: "openai-codex-responses", errorMessage: "exhausted", diagnostics: [{ type: CODEX_RETRY_OWNED_DIAGNOSTIC }] };
	const plain = { ...owned, diagnostics: [] };
	let message = owned;
	const runtime = { streamSimple: () => ({ result: async () => message }) };
	const original = runtime.streamSimple;
	const context = { messages: [{ role: "user", content: "# Conversation\ntext" }] };
	const summary = { cacheRetention: "none", sessionId: "summary" };
	const a = { modelRuntime: runtime, sessionId: "a", ...summaryMethods(runtime, context, summary) } as unknown as AgentSession;
	const b = { modelRuntime: runtime, sessionId: "b", ...summaryMethods(runtime, context, summary) } as unknown as AgentSession;
	const releaseA = suppressSummaryRetries(a);
	const releaseAgain = suppressSummaryRetries(a);
	const releaseB = suppressSummaryRetries(b);
	const call = (id: string) => (runtime as unknown as ModelRuntime).streamSimple(model, context as never, { cacheRetention: "none", sessionId: id }).result();
	try {
		assert.equal(await call("a"), owned);
		assert.equal(await call("b"), owned);
		// Another session's ordinary request on the shared runtime is not a summary, whatever its retention.
		assert.equal(await call("unbound"), owned);
		await assert.rejects((a as any)._runDefaultCompaction(), /Turn prefix summarization failed: exhausted/);
		await assert.rejects((b as any)._runDefaultCompaction(), /Turn prefix summarization failed: exhausted/);
		message = plain;
		assert.equal(await (a as any)._runDefaultCompaction(), plain);
		message = owned;
		releaseA();
		await assert.rejects((a as any)._runDefaultCompaction(), /Turn prefix summarization failed: exhausted/, "a second binding of the same session still holds");
		releaseAgain();
		assert.equal(await (a as any)._runDefaultCompaction(), owned, "a released session's summary keeps Pi's behavior");
		await assert.rejects((b as any)._runDefaultCompaction(), /Turn prefix summarization failed: exhausted/);
		assert.notEqual(runtime.streamSimple, original);
	} finally { releaseA(); releaseAgain(); releaseB(); }
	assert.equal(runtime.streamSimple, original);
});

it("hands over after another runtime wrapper takes the top layer", async () => {
	const message = { role: "assistant", stopReason: "error", provider: "openai-codex", api: "openai-codex-responses", errorMessage: "exhausted", diagnostics: [{ type: CODEX_RETRY_OWNED_DIAGNOSTIC }] };
	const runtime = { streamSimple: () => ({ result: async () => message }) };
	const context = { messages: [{ role: "user", content: "Summarize" }] };
	const session = { modelRuntime: runtime, sessionId: "root", ...summaryMethods(runtime, context, { cacheRetention: "none", sessionId: "summary" }) } as unknown as AgentSession;
	const first = suppressSummaryRetries(session);
	const inner = runtime.streamSimple;
	const competitor = (...args: []) => inner(...args);
	runtime.streamSimple = competitor;
	first();
	const next = suppressSummaryRetries(session);
	try {
		await assert.rejects((session as any)._runDefaultCompaction(), /Summarization failed: exhausted/);
	} finally { next(); }
	assert.equal(runtime.streamSimple, competitor);
});

it("restores the stock runtime stream past a released capture layer below the summary layer", () => {
	const LAYER = Symbol.for("rqw:request-stream-layer:v1");
	const stock = () => ({ result: async () => undefined });
	const runtime: { streamSimple: (...args: unknown[]) => unknown } = { streamSimple: stock };
	// A capture extension's layer below, already released while the summary layer covers it.
	const capture = (...args: unknown[]) => stock(...(args as []));
	Object.defineProperty(capture, LAYER, { value: { active: false, descriptor: Object.getOwnPropertyDescriptor(runtime, "streamSimple") } });
	runtime.streamSimple = capture;
	const session = { modelRuntime: runtime, sessionId: "root", ...summaryMethods(runtime, {}, { sessionId: "summary" }) } as unknown as AgentSession;
	const release = suppressSummaryRetries(session);
	assert.notEqual(runtime.streamSimple, capture);
	release();
	assert.equal(runtime.streamSimple, stock);
});

it("overlapping guards of one session share one set of method wrappers and restore them in either order", async () => {
	const owned = { role: "assistant", stopReason: "error", provider: "openai-codex", api: "openai-codex-responses", errorMessage: "exhausted", diagnostics: [{ type: CODEX_RETRY_OWNED_DIAGNOSTIC }] };
	for (const firstOut of [0, 1]) {
		const runtime = { streamSimple: () => ({ result: async () => owned }) };
		const methods = summaryMethods(runtime, { messages: [] }, { cacheRetention: "none", sessionId: "summary" });
		const session = { modelRuntime: runtime, sessionId: "root", ...methods } as unknown as AgentSession;
		const guards = [suppressSummaryRetries(session)];
		const wrapper = (session as any)._runDefaultCompaction;
		guards.push(suppressSummaryRetries(session));
		assert.equal((session as any)._runDefaultCompaction, wrapper, "the second guard adds no wrapper");
		guards[firstOut]();
		await assert.rejects((session as any)._runDefaultCompaction(), /Summarization failed: exhausted/);
		guards[1 - firstOut]();
		assert.equal((session as any)._runDefaultCompaction, methods._runDefaultCompaction);
		assert.equal((session as any).navigateTree, methods.navigateTree);
	}
});

it("a wrapper covered by another layer is reused, not stacked, by the next guard", async () => {
	const owned = { role: "assistant", stopReason: "error", provider: "openai-codex", api: "openai-codex-responses", errorMessage: "exhausted", diagnostics: [{ type: CODEX_RETRY_OWNED_DIAGNOSTIC }] };
	const runtime = { streamSimple: () => ({ result: async () => owned }) };
	const session = { modelRuntime: runtime, sessionId: "root", ...summaryMethods(runtime, { messages: [] }, { cacheRetention: "none", sessionId: "summary" }) } as unknown as AgentSession;
	let calls = 0;
	suppressSummaryRetries(session)();
	const first = suppressSummaryRetries(session);
	const ours = (session as any)._runDefaultCompaction;
	const foreign = function(this: unknown, ...args: unknown[]) { calls++; return ours.apply(this, args); };
	(session as any)._runDefaultCompaction = foreign;
	first();
	assert.equal((session as any)._runDefaultCompaction, foreign);
	assert.equal(await (session as any)._runDefaultCompaction(), owned, "a released covered wrapper passes through");
	const next = suppressSummaryRetries(session);
	try {
		assert.equal((session as any)._runDefaultCompaction, foreign, "no new wrapper on top");
		await assert.rejects((session as any)._runDefaultCompaction(), /Summarization failed: exhausted/);
		assert.equal(calls, 2);
	} finally { next(); }
});

it("keeps every method stock when a summary method cannot be redefined", () => {
	const runtime = { streamSimple: () => ({ result: async () => undefined }) };
	const stream = runtime.streamSimple;
	const methods = summaryMethods(runtime, {}, { sessionId: "summary" });
	const session = { modelRuntime: runtime, sessionId: "root", ...methods } as Record<string, unknown>;
	Object.defineProperty(session, "summarizeForBugReport", { value: methods.summarizeForBugReport, configurable: false });
	const warnings: unknown[] = [];
	const warn = console.warn;
	console.warn = (...args) => { warnings.push(args); };
	try {
		suppressSummaryRetries(session as unknown as AgentSession)();
	} finally { console.warn = warn; }
	assert.equal(warnings.length, 1);
	assert.equal(runtime.streamSimple, stream);
	assert.equal(session._runDefaultCompaction, methods._runDefaultCompaction);
	assert.equal(session.navigateTree, methods.navigateTree);
});

it("keeps stock behavior when the runtime seam cannot be patched", () => {
	const runtime = Object.freeze({ streamSimple: () => ({ result: async () => undefined }) });
	const warnings: unknown[] = [];
	const warn = console.warn;
	console.warn = (...args) => { warnings.push(args); };
	try {
		const release = suppressSummaryRetries({ modelRuntime: runtime, ...summaryMethods(runtime, {}, { sessionId: "summary" }) } as unknown as AgentSession);
		release();
		assert.equal(warnings.length, 1);
	} finally { console.warn = warn; }
});
