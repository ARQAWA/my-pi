import "./recovery-offline.mjs";
import assert from "node:assert/strict";
import { afterEach, it } from "node:test";
import { calculateCost } from "@earendil-works/pi-ai";
import { entries } from "./pi-entrypoints.ts";
import { setup, context, model, textEvents, finish, response } from "./recovery-fixtures.ts";
import { bindSessionCache, subscriptionCacheOptions } from "../../../extensions/RQW-anthropic/cache.ts";
import { OVERLAY } from "../../../extensions/RQW-anthropic/registration.ts";
import type { AgentSession } from "@earendil-works/pi-coding-agent";

const savedRetention = process.env.PI_CACHE_RETENTION;
delete process.env.PI_CACHE_RETENTION;
afterEach(() => {
	if (savedRetention === undefined) delete process.env.PI_CACHE_RETENTION;
	else process.env.PI_CACHE_RETENTION = savedRetention;
});

it("explicit request and scoped/process env preferences are never overwritten", () => {
	delete process.env.PI_CACHE_RETENTION;
	for (const cacheRetention of ["none", "short", "long"] as const) {
		const options = { cacheRetention };
		assert.equal(subscriptionCacheOptions(options), options);
	}
	for (const value of ["", "short", "long", "none"]) {
		const options = { env: { PI_CACHE_RETENTION: value } };
		assert.equal(subscriptionCacheOptions(options), options);
		process.env.PI_CACHE_RETENTION = value;
		assert.equal(subscriptionCacheOptions(undefined), undefined);
		delete process.env.PI_CACHE_RETENTION;
	}
	assert.equal(subscriptionCacheOptions(undefined)?.cacheRetention, "long");
});

it("other providers and unowned runtimes bypass auth resolution and preserve exact options", async () => {
	const seen: unknown[] = [];
	let enabled = true;
	const original = async (_model: unknown, _context: unknown, options: unknown) => { seen.push(options); return {}; };
	const session = { agent: { streamFunction: original }, modelRuntime: {
		getRegisteredProviderConfig: () => enabled ? { streamSimple: Object.assign(() => {}, { [OVERLAY]: true }) } : undefined,
		getAuth: () => { throw new Error("must not resolve unrelated auth"); },
	} };
	const restore = bindSessionCache(session as unknown as AgentSession);
	const options = { sessionId: "fake-session" };
	for (const provider of ["openai", "openai-codex"]) {
		await session.agent.streamFunction({ ...model, provider }, context, options);
	}
	enabled = false;
	await session.agent.streamFunction(model, context, options);
	assert.deepEqual(seen, [options, options, options]);
	assert.ok(seen.every(value => value === options));
	restore();
	assert.equal(session.agent.streamFunction, original);
});

it("Pi charges 1h writes at 2x input, including mixed cache tiers", () => {
	assert.deepEqual(model.promptCache, { short: 300, long: 3600 });
	assert.deepEqual(model.cost, { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 });
	const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 1000, cacheWrite1h: 600,
		totalTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
	assert.equal(calculateCost(model, usage).cacheWrite, (400 * 5 + 600 * 8) / 1_000_000);
});

for (const [label, entry] of entries) {
	it(`${label}: OAuth payload and real SDK warmer agree on 1h; children inherit it; disable restores stock`, async t => {
		delete process.env.PI_CACHE_RETENTION;
		const active = await setup({ cacheWarming: "streaming", retry: { enabled: false } }, entry);
		const fetch = globalThis.fetch;
		const captures: Record<string, any>[] = [];
		globalThis.fetch = async (_input, init) => {
			captures.push(JSON.parse(String(init?.body)));
			return response([...textEvents, ...finish]);
		};
		t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.now() });
		try {
			// Keep the SDK stream open from the caller's perspective, so streaming warming remains scheduled.
			const stream = await active.session.agent.streamFunction(active.session.model!, context,
				{ sessionId: active.session.sessionId });
			const result = await stream.result();
			active.session.sessionManager.appendMessage({ ...result, usage: { ...result.usage, cacheRead: 100_000 } });
			const warmer = active.session as unknown as { _cacheWarmer: { status: { nextWarmAt: number }; cancel(): void } };
			assert.equal(warmer._cacheWarmer.status.nextWarmAt - Date.now(), 54 * 60_000);
			const controls = JSON.stringify(captures[0]);
			assert.ok(controls.includes('"ttl":"1h"'));
			t.mock.timers.tick(270_000);
			await Promise.resolve();
			assert.equal(captures.length, 1, "no warm request after 4m30s");
			warmer._cacheWarmer.cancel();

			for (const role of ["generic", "reviewer"]) {
				const dir = process.env.PI_CODING_AGENT_DIR!;
				const loader = new entry.DefaultResourceLoader({ cwd: dir, agentDir: dir, noExtensions: true,
					noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
				await loader.reload();
				const { session: child } = await entry.createAgentSession({ cwd: dir, agentDir: dir, resourceLoader: loader,
					modelRuntime: active.runtime, model: active.session.model, sessionManager: entry.SessionManager.inMemory(dir),
					settingsManager: entry.SettingsManager.inMemory({ cacheWarming: "streaming" }),
					...(role === "reviewer" ? { tools: ["read", "grep", "find"] } : {}) });
				try {
					await (await child.agent.streamFunction(child.model!, context, { sessionId: child.sessionId })).result();
					assert.ok(JSON.stringify(captures.at(-1)).includes('"ttl":"1h"'));
					child.sessionManager.appendMessage({ ...result, usage: { ...result.usage, cacheRead: 100_000 } });
					assert.equal((child as unknown as typeof warmer)._cacheWarmer.status.nextWarmAt - Date.now(), 54 * 60_000);
				} finally { child.dispose(); }
			}

			for (const options of [{ cacheRetention: "short" as const }, { env: { PI_CACHE_RETENTION: "short" } }, { apiKey: "fake-api-key" }]) {
				await (await active.session.agent.streamFunction(active.session.model!, context,
					{ ...options, sessionId: active.session.sessionId })).result();
				assert.ok(!JSON.stringify(captures.at(-1)).includes('"ttl":"1h"'));
				assert.equal(warmer._cacheWarmer.status.nextWarmAt - Date.now(), 270_000);
				warmer._cacheWarmer.cancel();
			}
			for (const retention of ["short", "long", "none", ""]) {
				process.env.PI_CACHE_RETENTION = retention;
				await (await active.session.agent.streamFunction(active.session.model!, context,
					{ sessionId: active.session.sessionId })).result();
				assert.equal(JSON.stringify(captures.at(-1)).includes('"ttl":"1h"'), retention === "long");
				assert.equal(warmer._cacheWarmer.status.nextWarmAt - Date.now(), retention === "long" ? 54 * 60_000 : 270_000);
				warmer._cacheWarmer.cancel();
			}
			delete process.env.PI_CACHE_RETENTION;
			await (await active.session.agent.streamFunction(active.session.model!, context,
				{ sessionId: active.session.sessionId, cacheRetention: "none" })).result();
			assert.equal(warmer._cacheWarmer.status.nextWarmAt, undefined);
			await active.runtime.completeSimple(active.session.model!, context, { cacheRetention: "none" });
			assert.ok(!JSON.stringify(captures.at(-1)).includes('"cache_control"'));
			await active.runtime.completeSimple(active.session.model!, context);
			assert.ok(JSON.stringify(captures.at(-1)).includes('"ttl":"1h"'), "direct SDK transport default");

			active.session.resourceLoader.reload = async () => { active.session.resourceLoader.getExtensions().extensions.length = 0; };
			await active.session.reload();
			await (await active.session.agent.streamFunction(active.session.model!, context,
				{ sessionId: active.session.sessionId })).result();
			assert.ok(!JSON.stringify(captures.at(-1)).includes('"ttl":"1h"'));
			assert.equal(warmer._cacheWarmer.status.nextWarmAt - Date.now(), 270_000);
			assert.equal(process.env.PI_CACHE_RETENTION, undefined);
		} finally {
			active.session.dispose();
			t.mock.timers.reset();
			globalThis.fetch = fetch;
		}
	});
}
