import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentSession } from "@earendil-works/pi-coding-agent";
import { forkPayloads } from "../../../extensions/RQW-agent/fork-payload.ts";

const OWNER = Symbol.for("rqw:request-owner:v1");
const model: any = { provider: "anthropic", id: "test", api: "anthropic-messages", contextWindow: 100000 };
const message = (content: string): any => ({ role: "user", content, timestamp: 1 });

for (const enabled of [["agent"]]) for (const childFirst of [false, true]) {
	test(`capture ignores cache replay and child wire identity: ${enabled.join(", ")}, child ${childFirst ? "inside" : "outside"}`, async () => {
		const warnings: string[] = [];
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
		const payloads = enabled.includes("agent") ? forkPayloads() : undefined;
		const wrapChild = () => {
			const inner = runtime.streamSimple;
			runtime.streamSimple = (m: any, c: any, o: any) => inner(m, c, o.sessionId === "child"
				? { ...o, sessionId: "parent", [OWNER]: { sessionId: "child", kind: "request" } } : o);
		};
		if (childFirst) wrapChild();
		for (const name of enabled) {
			if (name === "agent") payloads!.bind(ctx);
		}
		if (!childFirst) wrapChild();
		assert.equal(session.agent.streamFunction, streamFunction);
		const request = async (text: string, options: any = {}) => runtime.streamSimple(model, { messages: [message(text)] }, { sessionId: "parent", cacheRetention: "short", ...options }).result();
		let prepared = 0;
		await request("parent request", { onPreparedPayload: () => { prepared++; } });
		assert.equal(prepared, 1);
		await warmer.models.streamSimple(model, { messages: [message("cache replay")] }, { sessionId: "parent", maxTokens: 1, cacheRetention: "short" }).result();
		await request("child request", { sessionId: "child" });
		assert.equal(calls[1].options[OWNER].kind, "cache-replay");
		assert.equal(calls[1].options.cacheRetention, "short");
		if (payloads) assert.equal(payloads.get()!.payload.text, "parent request");
		await request("one token is real", { maxTokens: 1 });
		if (payloads) assert.equal(payloads.get()!.payload.text, "one token is real");
		payloads?.close();
		assert.equal(session.agent.streamFunction, streamFunction);
		assert.deepEqual(warnings, []);
	});
}
