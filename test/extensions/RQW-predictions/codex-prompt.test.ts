import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Credential } from "@earendil-works/pi-ai";
import { createPromptSource, PredictionAuthError, PREDICTION_CONFIG_URL, PREDICTION_PROMPT_TTL_MS } from "../../../extensions/RQW-predictions/codex-prompt.ts";

const START = 1_000_000;

function token(accountId: string, userId = "user-1"): string {
	const claim = { "https://api.openai.com/auth": { chatgpt_account_id: accountId, chatgpt_user_id: userId } };
	return ["h", Buffer.from(JSON.stringify(claim)).toString("base64url"), "s"].join(".");
}

function login(accountId = "acc-1", expires = START + 3_600_000): Credential {
	return { type: "oauth", access: token(accountId), refresh: "r", expires, accountId } as Credential;
}

function config(version: string, prompt = `prompt ${version}`): Response {
	return new Response(JSON.stringify({ prompt, prompt_version: version, is_enabled: true }), { status: 200 });
}

interface Call {
	url: string;
	method?: string;
	headers: Record<string, string>;
	signal: AbortSignal;
}

function setup(respond: (call: Call, number: number) => Response | Promise<Response> = (_c, n) => config(`v${n}`)) {
	const clock = { now: START };
	const state = { credential: login() as Credential | undefined };
	const calls: Call[] = [];
	const fakeFetch = (async (url: string, init: { method?: string; headers: Record<string, string>; signal: AbortSignal }) => {
		const call = { url, method: init.method, headers: init.headers, signal: init.signal };
		calls.push(call);
		return await respond(call, calls.length);
	}) as unknown as typeof fetch;
	const source = createPromptSource({ fetch: fakeFetch, now: () => clock.now, readCredential: () => state.credential });
	return { source, clock, state, calls };
}

describe("codex prediction prompt source", () => {
	it("reads the production endpoint with the saved login as read-only bearer", async () => {
		const { source, calls, state } = setup();
		const result = await source.get();
		assert.deepEqual(result, { prompt: "prompt v1", promptVersion: "v1" });
		assert.equal(calls.length, 1);
		assert.equal(calls[0].method, "GET");
		assert.equal(calls[0].url, PREDICTION_CONFIG_URL);
		assert.equal(calls[0].url, "https://chatgpt.com/backend-api/wham/predictions/config");
		assert.equal(calls[0].headers.Authorization, `Bearer ${(state.credential as { access: string }).access}`);
		assert.equal(calls[0].headers["ChatGPT-Account-ID"], "acc-1");
	});

	it("serves the cache at 299999 ms without a GET", async () => {
		const { source, clock, calls } = setup();
		await source.get();
		clock.now += PREDICTION_PROMPT_TTL_MS - 1;
		assert.equal((await source.get())?.promptVersion, "v1");
		assert.equal(calls.length, 1);
	});

	it("refreshes once at 300000 ms and returns the new prompt_version", async () => {
		const { source, clock, calls } = setup();
		await source.get();
		clock.now += PREDICTION_PROMPT_TTL_MS;
		assert.deepEqual(await source.get(), { prompt: "prompt v2", promptVersion: "v2" });
		assert.equal(calls.length, 2);
		assert.equal((await source.get())?.promptVersion, "v2");
		assert.equal(calls.length, 2);
	});

	it("shares one GET between concurrent reads", async () => {
		const releases: Array<(response: Response) => void> = [];
		const { source, calls } = setup(() => new Promise<Response>((resolve) => { releases.push(resolve); }));
		const reads = [source.get(), source.get(), source.get()];
		await new Promise((resolve) => setImmediate(resolve));
		for (const release of releases) release(config("v1"));
		const results = await Promise.all(reads);
		assert.equal(calls.length, 1);
		assert.deepEqual(results.map((r) => r?.promptVersion), ["v1", "v1", "v1"]);
	});

	it("caches null for 300000 ms after an HTTP error", async () => {
		const { source, clock, calls } = setup((_c, n) => (n === 1 ? new Response("no", { status: 500 }) : config("v2")));
		assert.equal(await source.get(), null);
		clock.now += PREDICTION_PROMPT_TTL_MS - 1;
		assert.equal(await source.get(), null);
		assert.equal(calls.length, 1);
		clock.now += 1;
		assert.equal((await source.get())?.promptVersion, "v2");
	});

	for (const [name, body] of [
		["not JSON", "<html>"],
		["a missing prompt", JSON.stringify({ prompt_version: "v1" })],
		["an empty prompt", JSON.stringify({ prompt: "  ", prompt_version: "v1" })],
		["a missing prompt_version", JSON.stringify({ prompt: "p" })],
		["a non-string prompt_version", JSON.stringify({ prompt: "p", prompt_version: 3 })],
	] as const) {
		it(`caches null for ${name}`, async () => {
			const { source, calls } = setup(() => new Response(body, { status: 200 }));
			assert.equal(await source.get(), null);
			assert.equal(await source.get(), null);
			assert.equal(calls.length, 1);
		});
	}

	it("caches null when the network call itself fails", async () => {
		const { source, calls } = setup(() => { throw new TypeError("fetch failed"); });
		assert.equal(await source.get(), null);
		assert.equal(await source.get(), null);
		assert.equal(calls.length, 1);
	});

	it("never replaces an expired prompt with the old one when the refresh fails", async () => {
		const { source, clock } = setup((_c, n) => (n === 1 ? config("v1") : new Response("no", { status: 503 })));
		await source.get();
		clock.now += PREDICTION_PROMPT_TTL_MS;
		assert.equal(await source.get(), null);
	});

	it("does not call the endpoint without a saved oauth login", async () => {
		const { source, state, calls } = setup();
		state.credential = undefined;
		await assert.rejects(source.get(), PredictionAuthError);
		state.credential = { type: "api_key", key: "k" } as unknown as Credential;
		await assert.rejects(source.get(), PredictionAuthError);
		state.credential = login("acc-1", START);
		await assert.rejects(source.get(), PredictionAuthError);
		assert.equal(calls.length, 0);
	});

	it("rejects a stored account id that disagrees with the token claim", async () => {
		const { source, state, calls } = setup();
		state.credential = { ...(login("acc-1") as object), accountId: "acc-2" } as Credential;
		await assert.rejects(source.get(), PredictionAuthError);
		assert.equal(calls.length, 0);
	});

	it("aborts the GET when the only caller aborts, caches nothing and then fetches again", async () => {
		let seen: AbortSignal | undefined;
		const { source, calls } = setup((call, n) => {
			if (n > 1) return config("v2");
			seen = call.signal;
			return new Promise<Response>((_resolve, reject) => call.signal.addEventListener("abort", () => reject(call.signal.reason)));
		});
		const controller = new AbortController();
		const read = source.get(controller.signal);
		await new Promise((resolve) => setImmediate(resolve));
		controller.abort();
		await assert.rejects(read, (error: Error) => error.name === "AbortError");
		assert.equal(seen?.aborted, true);
		assert.equal((await source.get())?.promptVersion, "v2");
		assert.equal(calls.length, 2);
	});

	it("keeps the shared GET alive while another caller still waits", async () => {
		let release: (response: Response) => void = () => {};
		const { source, calls } = setup(() => new Promise<Response>((resolve) => { release = resolve; }));
		const first = new AbortController();
		const aborted = source.get(first.signal);
		const kept = source.get();
		await new Promise((resolve) => setImmediate(resolve));
		first.abort();
		await assert.rejects(aborted, (error: Error) => error.name === "AbortError");
		assert.equal(calls[0].signal.aborted, false);
		release(config("v1"));
		assert.equal((await kept)?.promptVersion, "v1");
	});

	it("drops the result and caches nothing when the account changed during the GET", async () => {
		let release: (response: Response) => void = () => {};
		const { source, state, calls } = setup((_c, n) => (n === 1 ? new Promise<Response>((resolve) => { release = resolve; }) : config("v2")));
		const read = source.get();
		await new Promise((resolve) => setImmediate(resolve));
		state.credential = login("acc-2");
		release(config("v1"));
		await assert.rejects(read, PredictionAuthError);
		state.credential = login("acc-1");
		assert.equal((await source.get())?.promptVersion, "v2");
		assert.equal(calls.length, 2);
	});

	it("keeps one entry per account and reuses the first account's fresh entry after switching back", async () => {
		const { source, state, calls } = setup();
		await source.get();
		state.credential = login("acc-2");
		assert.equal((await source.get())?.promptVersion, "v2");
		state.credential = login("acc-1");
		assert.equal((await source.get())?.promptVersion, "v1");
		assert.equal(calls.length, 2);
	});

	it("clear drops the cache and a running load result", async () => {
		let release: (response: Response) => void = () => {};
		const { source, calls } = setup((_c, n) => (n === 1 ? new Promise<Response>((resolve) => { release = resolve; }) : config(`v${n}`)));
		const running = source.get();
		await new Promise((resolve) => setImmediate(resolve));
		source.clear();
		release(config("v1"));
		await assert.rejects(running);
		assert.equal((await source.get())?.promptVersion, "v2");
		source.clear();
		assert.equal((await source.get())?.promptVersion, "v3");
		assert.equal(calls.length, 3);
	});
});
