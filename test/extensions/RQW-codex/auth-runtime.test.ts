import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, type TestContext } from "node:test";
import * as pi from "@earendil-works/pi-coding-agent";

import { CODEX_AUTH_ORIGIN, CODEX_STREAM_CONTRACT, installRuntimeAuth } from "../../../extensions/RQW-codex/auth-runtime.ts";

// No model catalog network in these tests; every token is fake and every refresh is a stubbed fetch.
process.env.PI_OFFLINE = "1";

const NOW = Date.parse("2026-10-22T12:00:00Z");
const NOW_S = Math.floor(NOW / 1000);
const DAY = 24 * 60 * 60 * 1000;
const ACCOUNT = "acct-1";
const LAYER_INNER = Symbol.for("rqw-codex/inner");

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const jwt = (payload: Record<string, unknown>) => `${b64({ alg: "none" })}.${b64(payload)}.sig`;
/** A fake subscription access token; `exp` is seconds, omitted for the no-exp rule. */
const access = (tag: string, exp?: number) => jwt({ ...(exp === undefined ? {} : { exp }), tag, "https://api.openai.com/auth": { chatgpt_account_id: ACCOUNT } });
const digest = (token: string) => createHash("sha256").update(token).digest("hex").slice(0, 16);

type Seed = Record<string, unknown>;
const liveSeed = (): Seed => ({ type: "oauth", access: access("live", NOW_S + 3600), refresh: "RT-1", expires: NOW + 3_600_000, accountId: ACCOUNT, last_refresh: NOW - DAY });
const nearSeed = (): Seed => ({ type: "oauth", access: access("near", NOW_S + 60), refresh: "RT-1", expires: NOW + 3_600_000, accountId: ACCOUNT, last_refresh: NOW - DAY });

/** Fake clock for every test that touches a token: the real clock is not part of the expected behaviour. */
const clock = (t: TestContext) => t.mock.timers.enable({ apis: ["Date"], now: NOW });

/** A real Pi 1.4.0 ModelRuntime whose credentials live in a temp auth.json (no network, no models.json). */
async function runtimeWith(seed: Seed | undefined) {
	const dir = mkdtempSync(join(tmpdir(), "rqw-codex-auth-runtime-"));
	const authPath = join(dir, "auth.json");
	writeFileSync(authPath, JSON.stringify(seed ? { "openai-codex": seed } : {}));
	const runtime = await pi.ModelRuntime.create({ authPath, modelsPath: null, refreshOnCreate: false });
	return {
		runtime,
		model: runtime.getModels("openai-codex")[0] as pi.Model<never>,
		stored: () => JSON.parse(readFileSync(authPath, "utf8"))["openai-codex"] as Seed | undefined,
		cleanup: () => rmSync(dir, { recursive: true, force: true }),
	};
}

/** Stub the token endpoint. Each call returns the next fresh access token; the signals are recorded for inspection. */
function refreshFetch(t: TestContext, tokenFor: (call: number) => string = call => access(`fresh-${call}`, NOW_S + 3600)) {
	const signals: AbortSignal[] = [];
	t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
		if (init?.signal) signals.push(init.signal);
		return Response.json({ access_token: tokenFor(signals.length), refresh_token: "RT-2" });
	});
	return signals;
}

async function until(predicate: () => boolean) {
	for (let i = 0; i < 1000 && !predicate(); i++) await new Promise(resolve => setImmediate(resolve));
	assert.ok(predicate(), "condition reached");
}

/** Number of wrapper layers on an own property, counted through the recorded inner links; 0 when not own. */
function layers(target: object, name: string): number {
	let fn = Object.getOwnPropertyDescriptor(target, name)?.value as ((...args: unknown[]) => unknown) & Record<symbol, unknown> | undefined;
	let count = 0;
	for (; typeof fn === "function" && count < 32; count++) fn = fn[LAYER_INNER] as typeof fn;
	return count;
}

const snapshot = (target: object, names: string[]) => Object.fromEntries(names.map(name => [name, Object.getOwnPropertyDescriptor(target, name)]));
const RUNTIME_NAMES = ["prepareRequest", "stream", "streamSimple"];

it("legacy stored expiry in the past with a live JWT: no refresh and nothing is written", async t => {
	clock(t);
	const seed = { ...liveSeed(), expires: NOW - 1000, last_refresh: NOW - 30 * DAY };
	const { runtime, model, stored, cleanup } = await runtimeWith(seed);
	try {
		const signals = refreshFetch(t);
		const before = JSON.stringify(stored());
		const release = installRuntimeAuth(runtime);
		try {
			const result = await runtime.getAuth(model);
			assert.equal(result?.auth.apiKey, seed.access);
			assert.equal(signals.length, 0);
			assert.equal(JSON.stringify(stored()), before);
		} finally { release(); }
	} finally { cleanup(); }
});

it("a JWT within five minutes refreshes exactly once, even with a future stored expiry and concurrent callers", async t => {
	clock(t);
	const { runtime, model, stored, cleanup } = await runtimeWith(nearSeed());
	try {
		const signals = refreshFetch(t);
		const release = installRuntimeAuth(runtime);
		try {
			const results = await Promise.all([runtime.getAuth(model), runtime.getAuth(model), runtime.getAuth(model)]);
			assert.equal(signals.length, 1);
			for (const result of results) assert.equal(result?.auth.apiKey, access("fresh-1", NOW_S + 3600));
			assert.equal(stored()?.access, access("fresh-1", NOW_S + 3600));
			assert.equal(stored()?.refresh, "RT-2");
		} finally { release(); }
	} finally { cleanup(); }
});

it("a token with no exp refreshes only after eight days of last_refresh, native rule", async t => {
	const noExp = (lastRefresh: number): Seed => ({ type: "oauth", access: access("noexp"), refresh: "RT-1", expires: NOW + DAY, accountId: ACCOUNT, last_refresh: lastRefresh });
	for (const [lastRefresh, refreshes] of [[NOW - 9 * DAY, 1], [NOW - 7 * DAY, 0]] as const) {
		clock(t);
		const { runtime, model, cleanup } = await runtimeWith(noExp(lastRefresh));
		try {
			const signals = refreshFetch(t);
			const release = installRuntimeAuth(runtime);
			try {
				await runtime.getAuth(model);
				assert.equal(signals.length, refreshes, `last_refresh ${(NOW - lastRefresh) / DAY} days old`);
			} finally { release(); }
		} finally { cleanup(); t.mock.timers.reset(); }
	}
});

it("an active refresh longer than Pi's 15 s deadline completes on a fake clock, with no timeout armed", async t => {
	clock(t);
	const { runtime, model, stored, cleanup } = await runtimeWith(nearSeed());
	try {
		const timeouts = t.mock.method(AbortSignal, "timeout");
		const gate = Promise.withResolvers<void>();
		const signals: AbortSignal[] = [];
		t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
			signals.push(init!.signal!);
			await gate.promise;
			return Response.json({ access_token: access("slow", NOW_S + 3600), refresh_token: "RT-2" });
		});
		const release = installRuntimeAuth(runtime);
		try {
			const pending = runtime.getAuth(model);
			await until(() => signals.length === 1);
			t.mock.timers.tick(20_000);
			assert.equal(signals[0]!.aborted, false, "the refresh is not cancelled after 15 simulated seconds");
			gate.resolve();
			const result = await pending;
			assert.equal(result?.auth.apiKey, access("slow", NOW_S + 3600));
			assert.equal(stored()?.access, access("slow", NOW_S + 3600));
			assert.equal(timeouts.mock.callCount(), 0, "no AbortSignal.timeout deadline was created");
		} finally { release(); }
	} finally { cleanup(); }
});

it("Models, runtime.getAuth and prepareRequest share one policy and one provenance origin", async t => {
	clock(t);
	const { runtime, model, cleanup } = await runtimeWith(nearSeed());
	try {
		const signals = refreshFetch(t);
		const release = installRuntimeAuth(runtime);
		try {
			const fresh = access("fresh-1", NOW_S + 3600);
			const direct = await runtime.models.getAuth(model);
			const outer = await runtime.getAuth(model);
			const prepared = await runtime.prepareRequest(model, {});
			assert.equal(signals.length, 1, "one refresh across all three paths");
			assert.equal(direct?.auth.apiKey, fresh);
			assert.equal(outer?.auth.apiKey, fresh);
			assert.equal(prepared.options.apiKey, fresh);
			assert.equal(direct?.auth.headers?.["chatgpt-account-id"], ACCOUNT);
			assert.equal(direct?.source, "OAuth");
			assert.deepEqual(prepared.options[CODEX_AUTH_ORIGIN], { provider: "openai-codex", accountId: ACCOUNT, accessRevision: digest(fresh), source: "resolved-bearer" });
		} finally { release(); }
	} finally { cleanup(); }
});

it("Pi's own resolver never runs for openai-codex; other providers stay on the stock path", async t => {
	clock(t);
	const { runtime, model, cleanup } = await runtimeWith(liveSeed());
	try {
		const stockGetAuth = runtime.models.getAuth;
		const spy = t.mock.fn(function (this: unknown, ...args: unknown[]) { return (stockGetAuth as (...a: unknown[]) => unknown).apply(this, args); });
		(runtime.models as unknown as { getAuth: unknown }).getAuth = spy;
		const spyDescriptor = Object.getOwnPropertyDescriptor(runtime.models, "getAuth");
		const release = installRuntimeAuth(runtime);
		try {
			await runtime.getAuth(model);
			assert.equal(spy.mock.callCount(), 0, "codex never reaches the stock Models.getAuth");
			const anthropic = await runtime.getAuth("anthropic", { apiKey: "sk-ant-fake" });
			assert.equal(spy.mock.callCount(), 1);
			assert.equal(anthropic?.auth.apiKey, "sk-ant-fake");
		} finally { release(); }
		assert.deepEqual(Object.getOwnPropertyDescriptor(runtime.models, "getAuth"), spyDescriptor);
	} finally { cleanup(); }
});

it("an explicit key, env OPENAI_API_KEY, an API-key credential or a foreign origin cannot bypass the subscription login", async t => {
	clock(t);
	const { runtime, model, cleanup } = await runtimeWith(liveSeed());
	try {
		const release = installRuntimeAuth(runtime);
		try {
			await assert.rejects(runtime.getAuth(model, { apiKey: "sk-explicit" }), /explicit API key cannot replace/);
			await assert.rejects(runtime.prepareRequest(model, { apiKey: "sk-explicit" }), /explicit API key cannot replace/);
			// The ambient OPENAI_API_KEY is never a bearer or a billing fallback: the stored login still answers.
			const withEnv = await runtime.getAuth(model, { env: { OPENAI_API_KEY: "sk-env" } });
			assert.equal(withEnv?.auth.apiKey, access("live", NOW_S + 3600));
			await assert.rejects(runtime.getAuth({ ...model, baseUrl: "https://evil.example/backend-api" } as never), /subscription tokens may only be sent/);
			// The exact resolved bearer is the one explicit key that is accepted.
			const same = await runtime.getAuth(model, { apiKey: access("live", NOW_S + 3600) });
			assert.equal(same?.auth.apiKey, access("live", NOW_S + 3600));
		} finally { release(); }
	} finally { cleanup(); }

	const apiKeyOnly = await runtimeWith({ type: "api_key", key: "sk-stored" });
	try {
		const release = installRuntimeAuth(apiKeyOnly.runtime);
		try {
			await assert.rejects(apiKeyOnly.runtime.getAuth(apiKeyOnly.model), /No saved openai-codex login/);
		} finally { release(); }
	} finally { apiKeyOnly.cleanup(); }
});

it("stream and streamSimple tag their contract, preserve unknown options and attach origin before payload hooks", async t => {
	clock(t);
	const { runtime, model, cleanup } = await runtimeWith(liveSeed());
	try {
		const seen: { options: Record<PropertyKey, unknown> }[] = [];
		// Pi conflates the two paths: a registered streamSimple also serves runtime.stream. Only the symbol tells them apart.
		const capture = (_model: unknown, _context: unknown, options: Record<PropertyKey, unknown>) => {
			seen.push({ options });
			throw new Error("captured before the wire");
		};
		runtime.registerProvider("openai-codex", { api: "openai-codex-responses", streamSimple: capture } as never);
		const release = installRuntimeAuth(runtime);
		try {
			const fetchStub = async () => { throw new Error("never sent"); };
			const onPayload = () => undefined;
			const extra = { fetch: fetchStub, unknownOption: { nested: true }, env: { FOO: "bar" }, headers: { "x-test": "1" }, onPayload, sessionId: "s1", reasoning: "low" };
			const context = { messages: [] };
			await runtime.stream(model, context as never, extra as never).result().catch(() => undefined);
			await runtime.streamSimple(model, context as never, extra as never).result().catch(() => undefined);
			assert.equal(seen.length, 2);
			assert.equal(seen[0]!.options[CODEX_STREAM_CONTRACT], "native");
			assert.equal(seen[1]!.options[CODEX_STREAM_CONTRACT], "simple");
			for (const { options } of seen) {
				assert.equal(options.fetch, fetchStub);
				assert.equal(options.unknownOption, extra.unknownOption);
				assert.equal(options.onPayload, onPayload);
				assert.equal((options.env as Record<string, string>).FOO, "bar");
				assert.equal(options.sessionId, "s1");
				assert.equal(options.reasoning, "low");
				assert.equal((options.headers as Record<string, string>)["x-test"], "1");
				assert.equal(options.apiKey, access("live", NOW_S + 3600));
				assert.deepEqual(options[CODEX_AUTH_ORIGIN], { provider: "openai-codex", accountId: ACCOUNT, accessRevision: digest(access("live", NOW_S + 3600)), source: "resolved-bearer" });
			}
			assert.equal(Object.getOwnPropertySymbols(extra).length, 0, "the caller's options object is not mutated");
		} finally { release(); }
	} finally { cleanup(); }
});

it("two owners of one runtime release in either order; the last release restores the exact descriptors", async t => {
	clock(t);
	for (const order of ["ab", "ba"] as const) {
		const { runtime, model, cleanup } = await runtimeWith(liveSeed());
		try {
			const before = snapshot(runtime, RUNTIME_NAMES);
			const beforeModels = snapshot(runtime.models, ["getAuth"]);
			const a = installRuntimeAuth(runtime);
			const b = installRuntimeAuth(runtime);
			const [first, second] = order === "ab" ? [a, b] : [b, a];
			first();
			first();
			await assert.rejects(runtime.getAuth(model, { apiKey: "sk-explicit" }), /explicit API key/, `${order}: still wrapped after the first release`);
			second();
			assert.deepEqual(snapshot(runtime, RUNTIME_NAMES), before, `${order}: runtime descriptors restored`);
			assert.deepEqual(snapshot(runtime.models, ["getAuth"]), beforeModels, `${order}: models.getAuth restored`);
			// Stock Pi again: the stored bearer, with no rejection from our boundary.
			const after = await runtime.getAuth(model, { apiKey: "sk-explicit" });
			assert.equal(after?.auth.apiKey, access("live", NOW_S + 3600), `${order}: stock resolver after the last release`);
		} finally { cleanup(); }
	}
});

it("Anthropic and other providers keep the very same options object; the contract is never attached to them", async t => {
	clock(t);
	const { runtime, cleanup } = await runtimeWith(liveSeed());
	try {
		const received: unknown[] = [];
		const stockStreamSimple = t.mock.fn((_model: unknown, _context: unknown, options: unknown) => { received.push(options); return undefined; });
		(runtime as unknown as { streamSimple: unknown }).streamSimple = stockStreamSimple;
		const release = installRuntimeAuth(runtime);
		try {
			const anthropic = runtime.getModels("anthropic")[0]!;
			const options = { apiKey: "sk-ant-fake", foo: 1 };
			runtime.streamSimple(anthropic, { messages: [] } as never, options as never);
			assert.equal(received[0], options, "the same object reaches the stock path");
			assert.deepEqual(Object.getOwnPropertySymbols(options), []);
		} finally { release(); }
		assert.equal((runtime as unknown as { streamSimple: unknown }).streamSimple, stockStreamSimple);
	} finally { cleanup(); }
});

it("a competing layer above ours: release keeps it, reinstall reuses the inert layer, and the chain does not grow", async t => {
	clock(t);
	const { runtime, model, cleanup } = await runtimeWith(liveSeed());
	try {
		assert.equal(layers(runtime, "prepareRequest"), 0);
		for (let reload = 0; reload < 4; reload++) {
			const release = installRuntimeAuth(runtime);
			const ours = Object.getOwnPropertyDescriptor(runtime, "prepareRequest")!.value as (...args: unknown[]) => unknown;
			let competitorCalls = 0;
			const competitor = function (this: unknown, ...args: unknown[]) { competitorCalls++; return ours.apply(this, args); };
			Object.defineProperty(competitor, LAYER_INNER, { value: ours });
			Object.defineProperty(runtime, "prepareRequest", { value: competitor, writable: true, configurable: true, enumerable: false });
			release();
			assert.equal(runtime.prepareRequest, competitor, "the competitor is not clobbered");
			assert.equal(layers(runtime, "prepareRequest"), 3, "competitor, our inert layer, stock");
			// Inert: codex prepares through the stock path, with no origin attached.
			const prepared = await runtime.prepareRequest(model, {});
			assert.equal(prepared.options[CODEX_AUTH_ORIGIN], undefined);
			assert.equal(competitorCalls, 1);
			// The competitor is removed again; our inert layer is top.
			Object.defineProperty(runtime, "prepareRequest", { value: ours, writable: true, configurable: true, enumerable: false });
			assert.equal(layers(runtime, "prepareRequest"), 2, "our inert layer on top, stock below");
		}
		// One last owner with nothing above: its release removes the own property, back to the exact stock.
		const last = installRuntimeAuth(runtime);
		last();
		assert.equal(Object.getOwnPropertyDescriptor(runtime, "prepareRequest"), undefined);
	} finally { cleanup(); }
});

it("a simulated Anthropic overlay above ours: both coexist, and our release leaves the overlay in place", async t => {
	clock(t);
	const { runtime, model, cleanup } = await runtimeWith(liveSeed());
	try {
		const received: { provider: string; options: Record<PropertyKey, unknown> }[] = [];
		const stockStreamSimple = t.mock.fn((m: { provider: string }, _context: unknown, options: Record<PropertyKey, unknown>) => { received.push({ provider: m.provider, options }); return undefined; });
		(runtime as unknown as { streamSimple: unknown }).streamSimple = stockStreamSimple;
		const release = installRuntimeAuth(runtime);
		const ours = (runtime as unknown as { streamSimple: (...a: unknown[]) => unknown }).streamSimple;
		// Simulated Anthropic overlay: it forwards every call to the layer below it, as RQW-anthropic does for its own models.
		const overlay = function (this: unknown, m: unknown, context: unknown, options: unknown) { return ours.call(this, m, context, options); };
		Object.defineProperty(runtime, "streamSimple", { value: overlay, writable: true, configurable: true, enumerable: false });
		const anthropic = runtime.getModels("anthropic")[0]!;
		const anthropicOptions = { apiKey: "sk-ant-fake" };
		runtime.streamSimple(anthropic, { messages: [] } as never, anthropicOptions as never);
		runtime.streamSimple(model, { messages: [] } as never, { unknown: 1 } as never);
		assert.equal(received[0]!.provider, "anthropic");
		assert.equal(received[0]!.options, anthropicOptions, "Anthropic gets the same object, untagged");
		assert.equal(received[1]!.provider, "openai-codex");
		assert.equal(received[1]!.options[CODEX_STREAM_CONTRACT], "simple");
		release();
		assert.equal((runtime as unknown as { streamSimple: unknown }).streamSimple, overlay, "our release leaves the overlay in place");
		runtime.streamSimple(model, { messages: [] } as never, { unknown: 2 } as never);
		assert.equal(received[2]!.options[CODEX_STREAM_CONTRACT], undefined, "our layer is inert after release");
		Object.defineProperty(runtime, "streamSimple", { value: stockStreamSimple, writable: true, configurable: true, enumerable: false });
	} finally { cleanup(); }
});

it("an incompatible runtime fails before any patch, and a second store for the same runtime is refused", async t => {
	clock(t);
	const store = { read: async () => undefined, modify: async () => undefined };
	const fake = { models: { getAuth() { return undefined; } }, prepareRequest() { return undefined; }, stream() { return undefined; } };
	const before = { models: Object.getOwnPropertyDescriptors(fake.models), top: Object.getOwnPropertyDescriptors(fake) };
	assert.throws(() => installRuntimeAuth(fake as never, store as never), /incompatible Pi auth seams/);
	assert.deepEqual({ models: Object.getOwnPropertyDescriptors(fake.models), top: Object.getOwnPropertyDescriptors(fake) }, before);

	const { runtime, cleanup } = await runtimeWith(liveSeed());
	try {
		const release = installRuntimeAuth(runtime);
		assert.throws(() => installRuntimeAuth(runtime, store as never), /another credential store/);
		release();
	} finally { cleanup(); }
});

it("an installer predicate that reports no owned registration keeps every codex call on the stock path", async t => {
	clock(t);
	const { runtime, model, cleanup } = await runtimeWith(liveSeed());
	try {
		const stockGetAuth = runtime.models.getAuth;
		const spy = t.mock.fn(function (this: unknown, ...args: unknown[]) { return (stockGetAuth as (...a: unknown[]) => unknown).apply(this, args); });
		(runtime.models as unknown as { getAuth: unknown }).getAuth = spy;
		const release = installRuntimeAuth(runtime, undefined, () => false);
		try {
			await runtime.getAuth(model, { apiKey: "sk-explicit" }).catch(() => undefined);
			assert.equal(spy.mock.callCount(), 1, "the stock resolver answers: the boundary is off");
			const prepared = await runtime.prepareRequest(model, {}).catch(() => undefined);
			assert.equal(prepared?.options[CODEX_AUTH_ORIGIN], undefined);
		} finally { release(); }
	} finally { cleanup(); }
});

it("another API sharing the openai-codex provider stays stock: no auth boundary, no origin, no stream contract", async t => {
	clock(t);
	const { runtime, cleanup } = await runtimeWith(liveSeed());
	try {
		const stockGetAuth = runtime.models.getAuth;
		const spy = t.mock.fn(function (this: unknown, ...args: unknown[]) { return (stockGetAuth as (...a: unknown[]) => unknown).apply(this, args); });
		(runtime.models as unknown as { getAuth: unknown }).getAuth = spy;
		const seen: Record<PropertyKey, unknown>[] = [];
		const stockStreamSimple = t.mock.fn((_model: unknown, _context: unknown, options: Record<PropertyKey, unknown>) => { seen.push(options); return undefined; });
		(runtime as unknown as { streamSimple: unknown }).streamSimple = stockStreamSimple;
		const release = installRuntimeAuth(runtime);
		try {
			const faux = { provider: "openai-codex", api: "faux-iso", id: "classifier", baseUrl: "https://chatgpt.com/backend-api" } as never;
			await runtime.getAuth(faux, { apiKey: "sk-explicit" });
			assert.equal(spy.mock.callCount(), 1, "a foreign API model reaches the stock Models.getAuth");
			const options = { apiKey: "sk-explicit" };
			runtime.streamSimple(faux, { messages: [] } as never, options as never);
			assert.equal(seen[0], options, "the same options object reaches the stock path");
			assert.deepEqual(Object.getOwnPropertySymbols(options), []);
		} finally { release(); }
	} finally { cleanup(); }
});

// Regression: RQW-models masks the instance prepareRequest and calls the prototype's native prepareRequest directly,
// which skips this runtime's prepareRequest wrapper. The provenance must still reach the prepared options through env.
function maskLikeRqwModels(runtime: pi.ModelRuntime): () => void {
	const prototype = Object.getPrototypeOf(runtime) as pi.ModelRuntime;
	const mask = async function (this: pi.ModelRuntime, ...args: Parameters<pi.ModelRuntime["prepareRequest"]>) {
		return prototype.prepareRequest.apply(this, args);
	};
	Object.defineProperty(runtime, "prepareRequest", { value: mask, writable: true, configurable: true, enumerable: false });
	return () => Reflect.deleteProperty(runtime, "prepareRequest");
}

it("native prototype prepareRequest reached past our wrapper still carries the origin in options.env, not on the wire", async t => {
	clock(t);
	const { runtime, model, cleanup } = await runtimeWith(liveSeed());
	try {
		const release = installRuntimeAuth(runtime);
		const unmask = maskLikeRqwModels(runtime);
		try {
			const prepared = await runtime.prepareRequest(model, {});
			assert.equal(prepared.options.apiKey, access("live", NOW_S + 3600));
			assert.equal(prepared.options[CODEX_AUTH_ORIGIN], undefined, "the wrapper was bypassed: no top-level origin");
			const scoped = (prepared.options.env as Record<PropertyKey, unknown>)[CODEX_AUTH_ORIGIN];
			assert.deepEqual(scoped, { provider: "openai-codex", accountId: ACCOUNT, accessRevision: digest(access("live", NOW_S + 3600)), source: "resolved-bearer" });
			assert.deepEqual(Object.getOwnPropertySymbols(prepared.headers ?? {}), [], "no provenance in headers");
			assert.equal(Object.getOwnPropertyDescriptor(prepared.options.env as object, CODEX_AUTH_ORIGIN)?.enumerable, true);
		} finally { unmask(); release(); }
	} finally { cleanup(); }
});

it("two runtimes keep their own provenance; a caller-forged key or origin from the other runtime is refused", async t => {
	clock(t);
	const first = await runtimeWith(liveSeed());
	const second = await runtimeWith({ ...liveSeed(), access: access("other", NOW_S + 3600) });
	try {
		const releaseFirst = installRuntimeAuth(first.runtime);
		const releaseSecond = installRuntimeAuth(second.runtime);
		try {
			const a = await first.runtime.prepareRequest(first.model, {});
			const b = await second.runtime.prepareRequest(second.model, {});
			const originA = (a.options.env as Record<PropertyKey, unknown>)[CODEX_AUTH_ORIGIN] as { accessRevision: string };
			const originB = (b.options.env as Record<PropertyKey, unknown>)[CODEX_AUTH_ORIGIN] as { accessRevision: string };
			assert.equal(originA.accessRevision, digest(access("live", NOW_S + 3600)));
			assert.equal(originB.accessRevision, digest(access("other", NOW_S + 3600)));
			await assert.rejects(second.runtime.prepareRequest(second.model, { apiKey: access("live", NOW_S + 3600) }), /explicit API key cannot replace/);
			await assert.rejects(second.runtime.prepareRequest(second.model, { apiKey: access("live", NOW_S + 3600), env: { [CODEX_AUTH_ORIGIN]: originA } as never }), /explicit API key cannot replace/);
		} finally { releaseSecond(); releaseFirst(); }
	} finally { first.cleanup(); second.cleanup(); }
});
