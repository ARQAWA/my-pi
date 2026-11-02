import assert from "node:assert/strict";
import { it } from "node:test";
import type { AgentSession, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { bindSessionCache } from "../../../extensions/RQW-anthropic/cache.ts";
import { OVERLAY } from "../../../extensions/RQW-anthropic/registration.ts";
import { installRecoveryHooks } from "../../../extensions/RQW-anthropic/retry.ts";

it("preserves the captured SDK identity for summary routing and custom stream auth", async () => {
	const native = async () => ({});
	const custom = async () => ({});
	const overlay = Object.assign(() => {}, { [OVERLAY]: true });
	const gate = Promise.withResolvers<void>();
	let authCalls = 0;
	class Runtime {
		getRegisteredProviderConfig() { return { streamSimple: overlay }; }
		async getAuth(_model?: object) { authCalls++; return { auth: { apiKey: "oauth-token" }, env: { TEST: "value" }, source: "OAuth" }; }
		stream() {}
		streamSimple() {}
		prepareRequest() {}
	}
	class Session {
		agent = { streamFunction: native };
		modelRuntime = new Runtime();
		thinkingLevel = "low";
		_isRetryableError() {}
		_checkCompaction() {}
		navigateTree() {}
		summarizeForBugReport() {}
		async _runDefaultCompaction(model: object, signal?: AbortSignal) { return this._getSummarizationRequestAuth(model, signal); }
		async _getSummarizationRequestAuth(model: object, signal?: AbortSignal) {
			await gate.promise;
			if (signal?.aborted) throw new Error("aborted");
			const routed = { ...model, provider: "anthropic" };
			if (this.agent.streamFunction === native) return { model: routed, thinkingLevel: this.thinkingLevel };
			const auth = await this.modelRuntime.getAuth(routed);
			return { model: routed, apiKey: auth.auth.apiKey, env: auth.env, thinkingLevel: this.thinkingLevel };
		}
	}
	const releaseHooks = installRecoveryHooks(Runtime as unknown as typeof ModelRuntime, Session as unknown as typeof AgentSession);
	const session = new Session();
	const releaseCache = bindSessionCache(session as unknown as AgentSession);
	try {
		const abort = new AbortController();
		const pending = session._runDefaultCompaction({ virtual: true });
		const cancelled = session._runDefaultCompaction({ virtual: true }, abort.signal);
		abort.abort();
		session.thinkingLevel = "high";
		gate.resolve();
		assert.deepEqual(await pending, { model: { virtual: true, provider: "anthropic" }, thinkingLevel: "high", env: {} });
		await assert.rejects(cancelled, /aborted/);
		assert.equal(authCalls, 0);
		assert.notEqual(session.agent.streamFunction, native, "the shared agent is never mutated for summary auth");
		releaseCache();
		session.agent.streamFunction = custom;
		const releaseCustom = bindSessionCache(session as unknown as AgentSession);
		try {
			assert.deepEqual(await session._runDefaultCompaction({}), { model: { provider: "anthropic" }, apiKey: "oauth-token", env: { TEST: "value" }, thinkingLevel: "high" });
			assert.equal(authCalls, 1);
		} finally { releaseCustom(); }
	} finally { releaseCache(); releaseHooks(); }
});

it("sets OAuth retention before the captured stream and keeps explicit preferences", async () => {
	const previous = process.env.PI_CACHE_RETENTION;
	delete process.env.PI_CACHE_RETENTION;
	const calls: unknown[] = [];
	const original = async (_model: unknown, _context: unknown, options: unknown) => { calls.push(options); return {}; };
	const agent = { streamFunction: original };
	const overlay = Object.assign(() => {}, { [OVERLAY]: true });
	const session = { agent, modelRuntime: {
		getRegisteredProviderConfig: () => ({ streamSimple: overlay }),
		getAuth: async () => ({ auth: { apiKey: "sk-ant-oat-fake" }, env: { SCOPED: "yes" } }),
	} } as unknown as AgentSession;
	const release = bindSessionCache(session);
	const model = { provider: "anthropic", api: "anthropic-messages" } as never;
	try {
		await session.agent.streamFunction(model, {} as never, {});
		await session.agent.streamFunction(model, {} as never, { cacheRetention: "short" });
		await session.agent.streamFunction(model, {} as never, { env: { PI_CACHE_RETENTION: "short" } });
		assert.deepEqual(calls, [
			{ env: { SCOPED: "yes" }, cacheRetention: "long" },
			{ cacheRetention: "short" },
			{ env: { PI_CACHE_RETENTION: "short" } },
		]);
	} finally {
		release();
		if (previous === undefined) delete process.env.PI_CACHE_RETENTION; else process.env.PI_CACHE_RETENTION = previous;
	}
	assert.equal(agent.streamFunction, original);
});

it("leaves an incompatible cache stream untouched and warns", () => {
	const agent = Object.freeze({ streamFunction: () => undefined });
	const warnings: unknown[] = [];
	const warn = console.warn;
	console.warn = (...args) => { warnings.push(args); };
	try {
		bindSessionCache({ agent } as unknown as AgentSession)();
		assert.equal(warnings.length, 1);
	} finally { console.warn = warn; }
});
