import assert from "node:assert/strict";
import { it } from "node:test";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { createQuotaCache, fetchQuota } from "../../../extensions/RQW-anthropic/quota.ts";

const ACCESS = "sk-ant-oat01-fake-quota";
const credential = { type: "oauth" as const, access: ACCESS, refresh: "fake-refresh", expires: 4_102_444_800_000 };
const payload = {
	five_hour: { utilization: 12.5, resets_at: "2026-10-25T09:00:00Z" },
	seven_day: { utilization: 100, resets_at: "2026-10-31T00:00:00Z" },
};
async function store() {
	const value = new InMemoryCredentialStore();
	await value.modify("anthropic", async () => credential);
	return value;
}

it("returns normalized quota windows from a fake network", async () => {
	const credentials = await store();
	const result = await fetchQuota(credentials, new AbortController().signal, async () => Response.json(payload));
	assert.deepEqual(result.windows, {
		five_hour: { utilization: 12.5, remainingPercent: 87.5, resetsAt: payload.five_hour.resets_at },
		seven_day: { utilization: 100, remainingPercent: 0, resetsAt: payload.seven_day.resets_at },
	});
	assert.deepEqual(await credentials.read("anthropic"), credential);
});

it("caches an explicit quota refresh and clears it on disposal", async t => {
	const credentials = await store();
	t.mock.method(globalThis, "fetch", async () => Response.json(payload));
	const cache = createQuotaCache(() => credentials);
	t.after(() => cache.dispose());
	assert.equal(cache.read(), undefined);
	const result = await cache.refresh();
	assert.deepEqual(cache.read(), result);
	cache.dispose();
	assert.equal(cache.read(), undefined);
});

// Regression: c75512c kept an earlier success when a newer refresh failed.
it("keeps an earlier successful refresh after a newer failure", async t => {
	const credentials = await store();
	const requests: { resolve(value: Response): void }[] = [];
	const bothStarted = Promise.withResolvers<void>();
	t.mock.method(globalThis, "fetch", () => new Promise<Response>(resolve => {
		requests.push({ resolve });
		if (requests.length === 2) bothStarted.resolve();
	}));
	const cache = createQuotaCache(() => credentials);
	t.after(() => cache.dispose());
	const first = cache.refresh();
	const second = cache.refresh();
	await bothStarted.promise;
	requests[1].resolve(new Response("no", { status: 429 }));
	await assert.rejects(second, { status: 429 });
	requests[0].resolve(Response.json(payload));
	const result = await first;
	assert.deepEqual(cache.read(), result);
});
