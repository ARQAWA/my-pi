import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentSession } from "@earendil-works/pi-coding-agent";
import { installBtwCore } from "../../../extensions/RQW-btw/core.ts";

const OWNER = Symbol.for("rqw:request-owner:v1");
const model: any = { provider: "anthropic", id: "test", api: "anthropic-messages", contextWindow: 100000 };
const message = (content: string): any => ({ role: "user", content, timestamp: 1 });

for (const enabled of [["btw"]]) for (const childFirst of [false, true]) {
	test(`capture ignores cache replay and child wire identity: ${enabled.join(", ")}, child ${childFirst ? "inside" : "outside"}`, async () => {
		const handlers = new Map<string, ((event: any, ctx: any) => void)[]>();
		const warnings: string[] = [];
		const pi: any = {
			on(name: string, fn: any) { handlers.set(name, [...handlers.get(name) ?? [], fn]); },
			events: { emit() {} }, getThinkingLevel: () => "low", getActiveTools: () => [], getAllTools: () => [],
		};
		const calls: any[] = [];
		const original = (_model: any, context: any, options: any) => ({ result: async () => {
			calls.push({ context, options });
			const payload = { text: context.messages[0].content };
			await options?.onPayload?.(payload, model);
			options?.onPreparedPayload?.(payload);
			return payload;
		} });
		const runtime = { stream: original, streamSimple: original };
		const warmer = { models: runtime };
		const manager = { getSessionId: () => "parent", getLeafId: () => null, buildSessionProjection: () => ({ messages: [] }) };
		const session: any = Object.create(AgentSession.prototype);
		const streamFunction = (m: any, c: any, o: any) => runtime.streamSimple(m, c, o);
		Object.assign(session, { sessionManager: manager, _modelRuntime: runtime, _cacheWarmer: warmer, agent: { streamFunction } });
		const ctx: any = { sessionManager: manager, model, isIdle: () => session.isIdle, getSystemPrompt: () => "prompt", ui: { notify: (s: string) => warnings.push(s) } };
		const btw = enabled.includes("btw") ? installBtwCore(pi) : undefined;
		const wrapChild = () => {
			const inner = runtime.streamSimple;
			runtime.streamSimple = (m: any, c: any, o: any) => inner(m, c, o.sessionId === "child"
				? { ...o, sessionId: "parent", [OWNER]: { sessionId: "child", kind: "request" } } : o);
		};
		if (childFirst) wrapChild();
		for (const name of enabled) {
			if (name === "btw") for (const fn of handlers.get("session_start") ?? []) fn({}, ctx);
		}
		if (!childFirst) wrapChild();
		assert.equal(session.agent.streamFunction, streamFunction);
		const request = async (text: string, options: any = {}) => runtime.streamSimple(model, { messages: [message(text)] }, { sessionId: "parent", cacheRetention: "short", ...options }).result();
		let prepared = 0;
		await request("parent request", { onPreparedPayload: () => { prepared++; } });
		assert.equal(prepared, 1);
		const after = message("after parent");
		for (const fn of handlers.get("message_end") ?? []) fn({ message: after }, ctx);
		await warmer.models.streamSimple(model, { messages: [message("cache replay")] }, { sessionId: "parent", maxTokens: 1, cacheRetention: "short" }).result();
		await request("child request", { sessionId: "child" });
		assert.equal(calls[1].options[OWNER].kind, "cache-replay");
		assert.equal(calls[1].options.cacheRetention, "short");
		if (btw) assert.deepEqual(btw.mark(ctx)!.messages.map((m: any) => m.content), ["parent request", "after parent"]);
		await request("one token is real", { maxTokens: 1 });
		if (btw) assert.equal(btw.mark(ctx)!.messages[0].content, "one token is real");
		for (const fn of handlers.get("session_shutdown") ?? []) fn({}, ctx);
		assert.equal(session.agent.streamFunction, streamFunction);
		assert.deepEqual(warnings, []);
	});
}

test("virtual runtime re-entry captures once and preserves the after messages", async () => {
	const handlers = new Map<string, ((event: any, ctx: any) => void)[]>();
	const pi: any = { on(name: string, fn: any) { handlers.set(name, [...handlers.get(name) ?? [], fn]); }, events: { emit() {} },
		getThinkingLevel: () => "low", getActiveTools: () => [], getAllTools: () => [] };
	let resolveRoute!: () => void;
	const route = new Promise<void>(resolve => { resolveRoute = resolve; });
	const runtime: any = { stream: () => {}, streamSimple(m: any, c: any, o: any) {
		return { result: async () => {
			if (m.id === "virtual") { await route; return runtime.streamSimple(model, c, { ...o }).result(); }
			return {};
		} };
	} };
	const manager = { getSessionId: () => "parent", getLeafId: () => null };
	const session: any = Object.create(AgentSession.prototype);
	Object.assign(session, { sessionManager: manager, _modelRuntime: runtime, _cacheWarmer: { models: runtime }, agent: { streamFunction() {} } });
	const ctx: any = { sessionManager: manager, model: { ...model, id: "virtual" }, isIdle: () => session.isIdle, getSystemPrompt: () => "prompt", ui: { notify() {} } };
	const capture = installBtwCore(pi);
	for (const fn of handlers.get("session_start") ?? []) fn({}, ctx);
	const pending = runtime.streamSimple(ctx.model, { messages: [message("before")] }, { sessionId: "parent" }).result();
	for (const fn of handlers.get("message_end") ?? []) fn({ message: message("after") }, ctx);
	resolveRoute();
	await pending;
	assert.deepEqual(capture.mark(ctx)!.messages.map((m: any) => m.content), ["before", "after"]);
	for (const fn of handlers.get("session_shutdown") ?? []) fn({}, ctx);
});
