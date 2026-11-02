import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentSession } from "@earendil-works/pi-coding-agent";
import { installBtwCore } from "../extensions/RQW-btw/core.ts";
import { installContext } from "../extensions/RQW-suggestions/context.ts";
import { forkPayloads } from "../extensions/RQW-agent/fork-payload.ts";

const OWNER = Symbol.for("rqw:request-owner:v1");
const model: any = { provider: "anthropic", id: "test", api: "anthropic-messages", contextWindow: 100000 };
const message = (content: string): any => ({ role: "user", content, timestamp: 1 });

for (const enabled of [["btw", "suggestions", "agent"], ["agent", "suggestions", "btw"]]) for (const childFirst of [false, true]) {
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
		const suggestions = enabled.includes("suggestions") ? installContext(pi) : undefined;
		const payloads = enabled.includes("agent") ? forkPayloads() : undefined;
		const wrapChild = () => {
			const inner = runtime.streamSimple;
			runtime.streamSimple = (m: any, c: any, o: any) => inner(m, c, o.sessionId === "child"
				? { ...o, sessionId: "parent", [OWNER]: { sessionId: "child", kind: "request" } } : o);
		};
		if (childFirst) wrapChild();
		for (const name of enabled) {
			if (name === "btw") for (const fn of handlers.get("session_start") ?? []) fn({}, ctx);
			if (name === "suggestions") suggestions!.bind(ctx);
			if (name === "agent") payloads!.bind(ctx);
		}
		if (!childFirst) wrapChild();
		assert.equal(session.agent.streamFunction, streamFunction);
		const request = async (text: string, options: any = {}) => runtime.streamSimple(model, { messages: [message(text)] }, { sessionId: "parent", cacheRetention: "short", ...options }).result();
		let prepared = 0;
		await request("parent request", { onPreparedPayload: () => { prepared++; } });
		assert.equal(prepared, 1);
		const after = message("after parent");
		for (const fn of handlers.get("message_end") ?? []) fn({ message: after }, ctx);
		suggestions?.record(after);
		await warmer.models.streamSimple(model, { messages: [message("cache replay")] }, { sessionId: "parent", maxTokens: 1, cacheRetention: "short" }).result();
		await request("child request", { sessionId: "child" });
		assert.equal(calls[1].options[OWNER].kind, "cache-replay");
		assert.equal(calls[1].options.cacheRetention, "short");
		if (btw) assert.deepEqual(btw.mark(ctx)!.messages.map((m: any) => m.content), ["parent request", "after parent"]);
		if (suggestions) assert.deepEqual(suggestions.capture(ctx)!.shot!.messages.map((m: any) => m.content), ["parent request"]);
		if (suggestions) assert.equal(suggestions.capture(ctx)!.shot!.after[0], after);
		if (payloads) assert.equal(payloads.get()!.payload.text, "parent request");
		await request("one token is real", { maxTokens: 1 });
		if (btw) assert.equal(btw.mark(ctx)!.messages[0].content, "one token is real");
		if (suggestions) assert.equal(suggestions.capture(ctx)!.shot!.messages[0].content, "one token is real");
		if (payloads) assert.equal(payloads.get()!.payload.text, "one token is real");
		for (const fn of handlers.get("session_shutdown") ?? []) fn({}, ctx);
		suggestions?.release();
		payloads?.close();
		assert.equal(session.agent.streamFunction, streamFunction);
		assert.deepEqual(warnings, []);
	});
}

test("covered releases forward and reload without duplicating capture", async () => {
	const handlers = new Map<string, ((event: any, ctx: any) => void)[]>();
	const pi: any = { on(name: string, fn: any) { handlers.set(name, [...handlers.get(name) ?? [], fn]); }, events: { emit() {} },
		getThinkingLevel: () => "low", getActiveTools: () => [], getAllTools: () => [] };
	const original = (_m: any, c: any, o: any) => ({ result: async () => { await o?.onPayload?.({ text: c.messages[0].content }, model); } });
	const runtime = { stream: original, streamSimple: original };
	const warmer = { models: runtime };
	const manager = { getSessionId: () => "parent", getLeafId: () => null };
	const session: any = Object.create(AgentSession.prototype);
	Object.assign(session, { sessionManager: manager, _modelRuntime: runtime, _cacheWarmer: warmer, agent: { streamFunction: original } });
	const ctx: any = { sessionManager: manager, model, isIdle: () => session.isIdle, getSystemPrompt: () => "prompt", ui: { notify() {} } };
	const first = installContext(pi);
	const second = forkPayloads();
	first.bind(ctx);
	second.bind(ctx);
	first.release();
	first.bind(ctx);
	await runtime.streamSimple(model, { messages: [message("latest")] }, { sessionId: "parent" }).result();
	await warmer.models.streamSimple(model, { messages: [message("warm")] }, { sessionId: "parent" }).result();
	assert.equal(first.capture(ctx)!.shot!.messages[0].content, "latest");
	assert.equal(second.get()!.payload.text, "latest");
	second.close();
	first.release();
	assert.equal(session.agent.streamFunction, original);
	assert.equal(runtime.stream, original);
	assert.equal(runtime.streamSimple, original);
	assert.equal(warmer.models, runtime);
});

for (const order of [["btw", "agent", "suggestions"], ["suggestions", "btw", "agent"], ["agent", "suggestions", "btw"]]) {
	test(`capture handover restores streams and warmer after ${order.join(", ")}`, async () => {
		const handlers = new Map<string, ((event: any, ctx: any) => void)[]>();
		const pi: any = { on(name: string, fn: any) { handlers.set(name, [...handlers.get(name) ?? [], fn]); }, events: { emit() {} },
			getThinkingLevel: () => "low", getActiveTools: () => [], getAllTools: () => [] };
		const original = (_m: any, c: any, o: any) => ({ result: async () => { await o?.onPayload?.({ text: c.messages[0].content }, model); } });
		const runtime = { stream: original, streamSimple: original };
		const warmer = { models: runtime };
		const manager = { getSessionId: () => "parent", getLeafId: () => null };
		const session: any = Object.create(AgentSession.prototype);
		Object.assign(session, { sessionManager: manager, _modelRuntime: runtime, _cacheWarmer: warmer, agent: { streamFunction: original } });
		const ctx: any = { sessionManager: manager, model, isIdle: () => session.isIdle, getSystemPrompt: () => "prompt", ui: { notify() {} } };
		const btw = installBtwCore(pi);
		const suggestions = installContext(pi);
		const agent = forkPayloads();
		for (const fn of handlers.get("session_start") ?? []) fn({}, ctx);
		suggestions.bind(ctx);
		agent.bind(ctx);
		const close: Record<string, () => void> = {
			btw: () => { for (const fn of handlers.get("session_shutdown") ?? []) fn({}, ctx); },
			suggestions: () => suggestions.release(), agent: () => agent.close(),
		};
		const active = new Set(["btw", "suggestions", "agent"]);
		for (const name of order) {
			close[name]();
			active.delete(name);
			await runtime.streamSimple(model, { messages: [message(name)] }, { sessionId: "parent" }).result();
			if (active.has("btw")) assert.equal(btw.mark(ctx)!.messages[0].content, name);
			if (active.has("suggestions")) assert.equal(suggestions.capture(ctx)!.shot!.messages[0].content, name);
			if (active.has("agent")) assert.equal(agent.get()!.payload.text, name);
		}
		assert.equal(runtime.stream, original);
		assert.equal(runtime.streamSimple, original);
		assert.equal(warmer.models, runtime);
	});
}
