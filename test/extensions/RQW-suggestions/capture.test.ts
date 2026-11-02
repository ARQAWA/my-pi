import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentSession } from "@earendil-works/pi-coding-agent";
import { installContext } from "../../../extensions/RQW-suggestions/context.ts";

const OWNER = Symbol.for("rqw:request-owner:v1");
const model: any = { provider: "anthropic", id: "test", api: "anthropic-messages", contextWindow: 100000 };
const message = (content: string): any => ({ role: "user", content, timestamp: 1 });

for (const enabled of [["suggestions"]]) for (const childFirst of [false, true]) {
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
		const suggestions = enabled.includes("suggestions") ? installContext(pi) : undefined;
		const wrapChild = () => {
			const inner = runtime.streamSimple;
			runtime.streamSimple = (m: any, c: any, o: any) => inner(m, c, o.sessionId === "child"
				? { ...o, sessionId: "parent", [OWNER]: { sessionId: "child", kind: "request" } } : o);
		};
		if (childFirst) wrapChild();
		for (const name of enabled) {
			if (name === "suggestions") suggestions!.bind(ctx);
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
		if (suggestions) assert.deepEqual(suggestions.capture(ctx)!.shot!.messages.map((m: any) => m.content), ["parent request"]);
		if (suggestions) assert.equal(suggestions.capture(ctx)!.shot!.after[0], after);
		await request("one token is real", { maxTokens: 1 });
		if (suggestions) assert.equal(suggestions.capture(ctx)!.shot!.messages[0].content, "one token is real");
		for (const fn of handlers.get("session_shutdown") ?? []) fn({}, ctx);
		suggestions?.release();
		assert.equal(session.agent.streamFunction, streamFunction);
		assert.deepEqual(warnings, []);
	});
}

test("incompatible runtime warns and leaves the agent and warmer unchanged", () => {
	const warnings: string[] = [];
	const manager = { getSessionId: () => "main" };
	const warmer = { models: {} };
	const session: any = Object.create(AgentSession.prototype);
	const streamFunction = () => {};
	Object.assign(session, { sessionManager: manager, _modelRuntime: { stream: streamFunction }, _cacheWarmer: warmer, agent: { streamFunction } });
	const ctx: any = { sessionManager: manager, isIdle: () => session.isIdle, ui: { notify: (s: string) => warnings.push(s) } };
	const capture = installContext({} as any);
	capture.bind(ctx);
	assert.match(warnings[0], /incompatible Pi runtime/);
	assert.equal(session.agent.streamFunction, streamFunction);
	assert.equal(session._cacheWarmer, warmer);
});
