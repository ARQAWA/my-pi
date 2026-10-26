import "./recovery-offline.mjs";
import assert from "node:assert/strict";
import { it } from "node:test";
import { InMemoryCredentialStore, type CredentialStore } from "@earendil-works/pi-ai";
import { createQuotaCache, fetchQuota, parseQuota, QUOTA_EVENT, QUOTA_URL, QUOTA_WINDOWS, QuotaError,
	type QuotaAccess } from "../../../extensions/RQW-anthropic/quota.ts";
import { ACCESS, credential, setup } from "./recovery-fixtures.ts";

const payload = { five_hour: { utilization: 12.5, resets_at: "2026-10-25T09:00:00Z" },
	seven_day: { utilization: 100, resets_at: "2026-10-31T00:00:00Z" } };
async function store() {
	const value = new InMemoryCredentialStore();
	await value.modify("anthropic", async () => credential);
	return value;
}
const fresh = () => new AbortController().signal;

it("quota constructs the current client GET exactly from the bound provider store without auth writes", async () => {
	const backing = await store();
	let reads = 0, calls = 0;
	const readonly: CredentialStore = {
		read(provider, options) { reads++; assert.equal(provider, "anthropic"); assert.ok(options?.signal); return backing.read(provider, options); },
		list: options => backing.list(options),
		modify: async () => { assert.fail("quota must not write auth"); },
		delete: async () => { assert.fail("quota must not delete auth"); },
	};
	const result = await fetchQuota(readonly, fresh(), async (input, init) => {
		calls++;
		assert.equal(input, QUOTA_URL);
		assert.equal(input, "https://api.anthropic.com/api/oauth/usage");
		assert.equal(init?.method, "GET");
		assert.equal(init?.body, undefined);
		assert.equal(init?.redirect, "error");
		assert.deepEqual(init?.headers, {
			Authorization: `Bearer ${ACCESS}`, "anthropic-beta": "oauth-2025-04-20",
			"Content-Type": "application/json", "User-Agent": "claude-cli/2.1.310 (external, cli)",
		});
		assert.equal(init?.signal?.aborted, false);
		return Response.json(payload);
	});
	assert.equal(reads, 1);
	assert.equal(calls, 1);
	assert.equal(typeof result.fetchedAt, "number");
	assert.deepEqual(result.windows, {
		five_hour: { utilization: 12.5, remainingPercent: 87.5, resetsAt: payload.five_hour.resets_at },
		seven_day: { utilization: 100, remainingPercent: 0, resetsAt: payload.seven_day.resets_at },
	});
	assert.deepEqual(await backing.read("anthropic"), credential);
});

it("quota parses every client window, nullable and absent fields, without inventing reset boundaries", () => {
	const nativeNames = ["five_hour", "seven_day", "seven_day_oauth_apps", "seven_day_opus", "seven_day_sonnet", "cinder_cove", "wattle_ember"];
	assert.deepEqual(QUOTA_WINDOWS, nativeNames);
	const input = Object.fromEntries(nativeNames.map(name => [name, { utilization: 0, resets_at: null }]));
	const expected = Object.fromEntries(nativeNames.map(name => [name, { utilization: 0, remainingPercent: 100, resetsAt: null }]));
	assert.deepEqual(parseQuota(input), expected);
	assert.deepEqual(parseQuota({ five_hour: null, seven_day: { utilization: null, resets_at: "server date" } }), {
		five_hour: null, seven_day: { utilization: null, remainingPercent: null, resetsAt: "server date" },
	});
	assert.deepEqual(parseQuota({ five_hour: { utilization: 103, resets_at: null }, unknown: { secret: "not exposed" } }), {
		five_hour: { utilization: 103, remainingPercent: 0, resetsAt: null },
	});
	assert.deepEqual(parseQuota({}), {});
	for (const bad of [null, [], "bad", { five_hour: {} }, { five_hour: { utilization: "12", resets_at: null } },
		{ seven_day: { utilization: NaN, resets_at: null } }, { five_hour: { utilization: 2, resets_at: 123 } }]) {
		assert.throws(() => parseQuota(bad), { name: "QuotaError", kind: "response" });
	}
});

it("quota has no missing-credential or API-key fallback and cancellation precedes auth reads", async () => {
	let reads = 0, calls = 0;
	const backing = await store();
	const read = backing.read.bind(backing);
	backing.read = (...args) => { reads++; return read(...args); };
	const transport: typeof fetch = async () => { calls++; return Response.json(payload); };
	await assert.rejects(fetchQuota(backing, AbortSignal.abort(), transport), { name: "AbortError" });
	assert.equal(reads, 0);
	await assert.rejects(fetchQuota(undefined, fresh(), transport), { kind: "auth" });
	await backing.modify("anthropic", async () => ({ type: "api_key", key: "fake-key" }));
	await assert.rejects(fetchQuota(backing, fresh(), transport), { kind: "auth" });
	assert.equal(calls, 0);
});

it("quota reports status and Retry-After without retry, refresh, upstream bodies, or sensitive transport errors", async () => {
	const backing = await store();
	let calls = 0;
	for (const status of [401, 403, 429, 500, 302]) {
		await assert.rejects(fetchQuota(backing, fresh(), async () => {
			calls++;
			return new Response("sensitive upstream body", { status, headers: { "retry-after": "120" } });
		}), (error: unknown) => {
			assert.ok(error instanceof QuotaError);
			assert.equal(error.kind, "http");
			assert.equal(error.status, status);
			assert.equal(error.retryAfter, "120");
			assert.equal(error.message, `RQW-anthropic: quota http error, HTTP ${status}.`);
			return true;
		});
	}
	assert.equal(calls, 5);
	await assert.rejects(fetchQuota(backing, fresh(), async () => { throw new Error(`secret ${ACCESS}`); }),
		{ message: "RQW-anthropic: quota network error.", kind: "network" });
	await assert.rejects(fetchQuota(backing, fresh(), async () => new Response("sensitive invalid JSON")), { kind: "response" });
	assert.deepEqual(await backing.read("anthropic"), credential);
});

it("quota caller cancellation and the native five-second timeout abort only the quota fetch", async t => {
	const backing = await store();
	const timeout = new AbortController();
	t.mock.method(AbortSignal, "timeout", (ms: number) => { assert.equal(ms, 5_000); return timeout.signal; });
	for (const reason of ["caller", "timeout"] as const) {
		const caller = new AbortController();
		const begun = Promise.withResolvers<void>();
		const pending = fetchQuota(backing, caller.signal, async (_input, init) => {
			begun.resolve();
			return new Promise((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true }));
		});
		await begun.promise;
		if (reason === "caller") caller.abort();
		else timeout.abort(new DOMException("Quota deadline", "TimeoutError"));
		await assert.rejects(pending, { name: reason === "caller" ? "AbortError" : "TimeoutError" });
		assert.equal(caller.signal.aborted, reason === "caller");
	}
});

it("quota cache refresh is explicit, preserves last success on error, and cannot be mutated by consumers", async t => {
	const backing = await store();
	let calls = 0;
	t.mock.method(globalThis, "fetch", async () => { calls++; return calls === 2 ? new Response("no", { status: 429 }) : Response.json(payload); });
	const cache = createQuotaCache(() => backing);
	t.after(() => cache.dispose());
	assert.equal(cache.read(), undefined);
	assert.equal(calls, 0);
	const result = await cache.refresh();
	const original = structuredClone(result);
	result.windows.five_hour!.remainingPercent = 99;
	assert.deepEqual(cache.read(), original);
	cache.read()!.windows.five_hour!.resetsAt = "changed";
	assert.deepEqual(cache.read(), original);
	await assert.rejects(cache.refresh(), { kind: "http", status: 429 });
	assert.deepEqual(cache.read(), original);
	assert.equal(calls, 2);
	cache.dispose();
	assert.equal(cache.read(), undefined);
	await assert.rejects(cache.refresh(), { name: "AbortError" });
	assert.equal(calls, 2);
});

it("quota late refresh cannot overwrite a newer result, and disposal aborts pending refresh", async t => {
	const backing = await store();
	const requests: { resolve(value: Response): void }[] = [];
	const began = [Promise.withResolvers<void>(), Promise.withResolvers<void>(), Promise.withResolvers<void>()];
	t.mock.method(globalThis, "fetch", (_input: unknown, init: RequestInit) => new Promise<Response>((resolve, reject) => {
		requests.push({ resolve });
		init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
		began[requests.length - 1].resolve();
	}));
	const cache = createQuotaCache(() => backing);
	const first = cache.refresh(); await began[0].promise;
	const second = cache.refresh(); await began[1].promise;
	requests[1].resolve(Response.json({ seven_day: { utilization: 20, resets_at: null } }));
	const latest = await second;
	requests[0].resolve(Response.json(payload));
	await first;
	assert.deepEqual(cache.read(), latest);
	const third = cache.refresh(); await began[2].promise;
	cache.dispose();
	await assert.rejects(third, { name: "AbortError" });
	assert.equal(cache.read(), undefined);
});

it("quota event cache keeps the latest success across newer failures and cancellation", async t => {
	let transport: typeof fetch = async () => { throw new Error("unexpected quota request"); };
	t.mock.method(globalThis, "fetch", (input: unknown, init?: RequestInit) => transport(input as URL | RequestInfo, init));
	const accessForNewSession = async () => {
		const active = await setup();
		t.after(() => active.session.dispose());
		let access: QuotaAccess | undefined;
		(active.session.resourceLoader as any).eventBus.emit(QUOTA_EVENT, {
			sessionId: active.session.sessionId,
			offer(value: QuotaAccess) { access = value; },
		});
		return access!;
	};

	// Failure-only and sequential controls must not manufacture or erase a snapshot.
	transport = async () => new Response("no", { status: 429 });
	const failed = await accessForNewSession();
	assert.equal(failed.read(), undefined);
	await assert.rejects(failed.refresh(), { kind: "http", status: 429 });
	assert.equal(failed.read(), undefined);

	let calls = 0;
	transport = async () => ++calls === 1 ? Response.json(payload) : new Response("no", { status: 429 });
	const sequential = await accessForNewSession();
	const successful = await sequential.refresh();
	await assert.rejects(sequential.refresh(), { kind: "http", status: 429 });
	assert.deepEqual(sequential.read(), successful);

	for (const failure of ["http", "abort"] as const) {
		for (const olderCompletesFirst of [true, false]) {
			const requests: { resolve(value: Response): void }[] = [];
			const began = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
			transport = (_input, init) => new Promise<Response>((resolve, reject) => {
				requests.push({ resolve });
				init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true });
				began[requests.length - 1].resolve();
			});
			const access = await accessForNewSession();
			const first = access.refresh();
			await began[0].promise;
			const cancellation = new AbortController();
			const second = access.refresh(failure === "abort" ? cancellation.signal : undefined);
			const secondRejected = assert.rejects(second,
				failure === "abort" ? { name: "AbortError" } : { kind: "http", status: 429 });
			await began[1].promise;
			const failSecond = () => {
				if (failure === "abort") cancellation.abort();
				else requests[1].resolve(new Response("no", { status: 429 }));
			};
			if (olderCompletesFirst) {
				requests[0].resolve(Response.json(payload));
				const expected = await first;
				failSecond();
				await secondRejected;
				assert.deepEqual(access.read(), expected);
			} else {
				failSecond();
				await secondRejected;
				requests[0].resolve(Response.json(payload));
				const expected = await first;
				assert.deepEqual(access.read(), expected);
			}
		}
	}
});

it("the isolated Anthropic extension offers quota only for its bound session and releases it on SDK dispose", async t => {
	let calls = 0;
	t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json(payload); });
	const active = await setup();
	t.after(() => active.session.dispose());
	const bus = (active.session.resourceLoader as any).eventBus;
	const offer = (sessionId: string) => {
		let access: QuotaAccess | undefined;
		bus.emit(QUOTA_EVENT, { sessionId, offer(value: QuotaAccess) { access = value; } });
		return access;
	};
	assert.equal(calls, 0, "loading and binding the provider sends nothing");
	assert.equal(offer("another-session"), undefined);
	const access = offer(active.session.sessionId)!;
	assert.equal(typeof access.refresh, "function");
	assert.equal(access.read(), undefined);
	assert.equal(calls, 0, "requesting the API is not a refresh");
	assert.deepEqual((await access.refresh()).windows, parseQuota(payload));
	assert.equal(calls, 1);
	active.session.dispose();
	assert.equal(offer(active.session.sessionId), undefined);
	assert.equal(access.read(), undefined);
	await assert.rejects(access.refresh(), { name: "AbortError" });
	assert.equal(calls, 1);
});
