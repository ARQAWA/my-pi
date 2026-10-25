// Adapted from extensions/RQW-codex/test/web-alpha.test.ts at git commit a85b810e924010f35387045fc0cbbd9a1e7173cc.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Credential, CredentialStore } from "@earendil-works/pi-ai";
import { CodexError } from "../vendor/errors.ts";
import { asciiJson, CODEX_ORIGINATOR, CODEX_VERSION, HEADER_TURN_METADATA, localPlatform, turnMetadataPayload, userAgent, type CodexIdentity } from "../vendor/metadata.ts";
import { searchAlpha, WEB_SEARCH_ENDPOINT, type AlphaRequest } from "../core/web-alpha.ts";

const SECRET = "fake-secret-never-include-in-errors";
const grant = (accountId = "owner", access = "fake-access"): Credential => ({
	type: "oauth", accountId, access, refresh: "fake-refresh", expires: Number.MAX_SAFE_INTEGER,
});
class MemoryStore implements CredentialStore {
	value: Credential | undefined = grant();
	reads = 0;
	modifies = 0;
	onRead?: (count: number) => void;
	async read() { this.reads++; this.onRead?.(this.reads); return this.value; }
	async list() { return []; }
	async delete() { this.value = undefined; }
	async modify(_provider: string, fn: (value: Credential | undefined) => Promise<Credential | undefined>) {
		this.modifies++;
		const next = await fn(this.value);
		if (next !== undefined) this.value = next;
		return this.value;
	}
}
const identity: CodexIdentity = { installationId: "installation", windowId: "thread:0", rootSessionId: "session", threadId: "thread", turnId: "turn" };
const request = (): AlphaRequest => ({ id: "session", model: "gpt-6.1-sol", commands: { search_query: [{ q: "test" }] }, settings: { external_web_access: false } });
type Network = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;
function setup(network: Network) {
	return { credentialStore: new MemoryStore(), identity, signal: new AbortController().signal, fetch: network as typeof fetch, sleep: async () => undefined };
}
function safeError(error: unknown): boolean {
	assert.ok(error instanceof Error);
	assert.equal(String(error.stack).includes(SECRET), false);
	assert.equal(JSON.stringify(error).includes(SECRET), false);
	assert.equal("cause" in error, false);
	return true;
}

describe("rqw-web native web", () => {
describe("alpha/search JSON adapter", () => {
	it("sends native JSON to the fixed official endpoint with safe search headers and opaque results", async () => {
		const results = [{ future: { nested: [null, 4, { extra: "kept" }] } }, "opaque", false];
		const body = { ...request(), input: [{ type: "message", content: "context" }], max_output_tokens: 123 };
		const options = setup(async (url, init) => {
			assert.equal(url, "https://chatgpt.com/backend-api/codex/alpha/search");
			assert.equal(url, WEB_SEARCH_ENDPOINT);
			assert.equal(init?.method, "POST");
			assert.equal(init?.redirect, "error");
			assert.equal(init?.signal, options.signal);
			assert.deepEqual(JSON.parse(init?.body as string), body);
			const headers = new Headers(init?.headers);
			assert.equal(headers.get("authorization"), "Bearer fake-access");
			assert.equal(headers.get("chatgpt-account-id"), "owner");
			assert.equal(headers.get("content-type"), "application/json");
			assert.equal(headers.get("accept"), "application/json");
			assert.equal(headers.get("originator"), CODEX_ORIGINATOR);
			assert.equal(headers.get("version"), CODEX_VERSION);
			assert.equal(headers.get("user-agent"), userAgent(localPlatform()));
			assert.equal(headers.get(HEADER_TURN_METADATA), asciiJson(turnMetadataPayload(identity, "turn")));
			for (const name of ["cookie", "session-id", "thread-id", "openai-beta", "x-codex-window-id"]) assert.equal(headers.has(name), false);
			assert.equal(options.credentialStore.reads, 2);
			return Response.json({ output: "found", results, encrypted_output: "opaque-cipher" });
		});
		assert.deepEqual(await searchAlpha(body, { ...options, ownerAccountId: "owner" }), { output: "found", results, encrypted_output: "opaque-cipher" });
	});

	it("keeps absent results distinct from an empty list and accepts native access modes", async () => {
		for (const mode of [true, false, "indexed"] as const) {
			for (const response of [{ output: "" }, { output: "", results: [] }]) {
				const body = request();
				body.settings.external_web_access = mode;
				assert.deepEqual(await searchAlpha(body, setup(async () => Response.json(response))), response);
			}
		}
	});

	it("refuses malformed or lossy request JSON before auth or network", async () => {
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		const invalid = [null, {}, { ...request(), id: "" }, { ...request(), model: 4 }, { ...request(), commands: [] },
			{ ...request(), settings: { external_web_access: "live" } }, { ...request(), max_output_tokens: -1 },
			{ ...request(), max_output_tokens: 1.5 }, { ...request(), input: cyclic }, { ...request(), input: BigInt(1) },
			{ ...request(), input: NaN }, { ...request(), input: new Date() }, { ...request(), commands: { bad: undefined } },
			{ ...request(), commands: { toJSON() { throw new Error(SECRET); } } }];
		for (const body of invalid) {
			const options = setup(async () => { assert.fail("must not send"); });
			await assert.rejects(searchAlpha(body as AlphaRequest, options), error => {
				safeError(error);
				assert.match((error as Error).message, /invalid alpha\/search request/);
				return true;
			});
			assert.equal(options.credentialStore.reads, 0);
		}
	});

	it("rejects malformed JSON and response shapes without exposing the body or retrying", async () => {
		for (const text of ["", SECRET, "null", "[]", "{}",  '{"output":4}', '{"output":"ok","results":{}}', '{"output":"ok","encrypted_output":null}']) {
			let calls = 0;
			await assert.rejects(searchAlpha(request(), setup(async () => { calls++; return new Response(text); })), safeError);
			assert.equal(calls, 1);
		}
	});

	it("validates the byte budget before reading credentials", async () => {
		for (const maxBytes of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
			const options = setup(async () => { assert.fail("must not send"); });
			await assert.rejects(searchAlpha(request(), { ...options, maxBytes }), /maxBytes must be a positive safe integer/);
			assert.equal(options.credentialStore.reads, 0);
		}
	});

	it("cancels an oversized stream before reading it fully without leaking or retrying", async () => {
		for (const maxBytes of [16, undefined]) {
			let cancelled = 0;
			let calls = 0;
			const options = setup(async () => {
				calls++;
				return new Response(new ReadableStream({
					start(controller) {
						controller.enqueue(Buffer.from(SECRET));
						controller.enqueue(new Uint8Array(2 * 1024 * 1024));
					},
					cancel() { cancelled++; },
				}));
			});
			await assert.rejects(searchAlpha(request(), { ...options, maxBytes }), error => {
				safeError(error);
				assert.equal((error as Error).message, "RQW-codex: alpha/search response exceeds byte limit.");
				return true;
			});
			assert.equal(cancelled, 1);
			assert.equal(calls, 1);
		}
	});

	it("counts bytes and decodes UTF-8 split between chunks at the exact cap", async () => {
		const output = "\u00e9";
		const bytes = Buffer.from(JSON.stringify({ output }));
		const split = bytes.indexOf(0xc3) + 1;
		const options = setup(async () => new Response(new ReadableStream({
			start(controller) {
				controller.enqueue(bytes.subarray(0, split));
				controller.enqueue(bytes.subarray(split));
				controller.close();
			},
		})));
		assert.deepEqual(await searchAlpha(request(), { ...options, maxBytes: bytes.byteLength }), { output });
		await assert.rejects(searchAlpha(request(), { ...options, maxBytes: bytes.byteLength - 1 }), /exceeds byte limit/);
		await assert.rejects(searchAlpha(request(), setup(async () => new Response(null))), /invalid alpha\/search response/);
	});

	it("cancels a pending reader promptly on abort", async () => {
		const controller = new AbortController();
		let cancelled = 0;
		let reading!: () => void;
		const started = new Promise<void>(resolve => { reading = resolve; });
		const options = setup(async () => new Response(new ReadableStream({
			pull() { reading(); },
			cancel() { cancelled++; },
		})));
		const pending = searchAlpha(request(), { ...options, signal: controller.signal });
		await started;
		controller.abort();
		await assert.rejects(pending, (error: Error) => error.name === "AbortError");
		assert.equal(cancelled, 1);
	});

	it("retries 500 with exactly the prepared bytes even when the caller mutates the request", async () => {
		const body = request();
		const sent: string[] = [];
		const options = setup(async (_url, init) => {
			sent.push(init?.body as string);
			body.commands = { different: true };
			return sent.length === 1 ? new Response(SECRET, { status: 500 }) : Response.json({ output: "ok" });
		});
		assert.deepEqual(await searchAlpha(body, options), { output: "ok" });
		assert.equal(sent.length, 2);
		assert.equal(sent[0], sent[1]);
		assert.equal(options.credentialStore.reads, 3);
	});

	it("bounds HTTP and transport retries to five sends", async () => {
		for (const failure of ["http", "network", "body"] as const) {
			let calls = 0;
			let sleeps = 0;
			const options = setup(async () => {
				calls++;
				if (failure === "network") throw new Error(SECRET);
				if (failure === "body") return new Response(new ReadableStream({ start(controller) { controller.error(new Error(SECRET)); } }));
				return new Response(SECRET, { status: 500, headers: { "x-request-id": SECRET } });
			});
			options.sleep = async () => { sleeps++; };
			await assert.rejects(searchAlpha(request(), options), safeError);
			assert.equal(calls, 5);
			assert.equal(sleeps, 4);
			assert.equal(options.credentialStore.reads, 6);
		}
	});

	it("does not retry 429 or leak server error details", async () => {
		let calls = 0;
		const options = setup(async () => {
			calls++;
			return Response.json({ error: { message: SECRET, plan_type: SECRET } }, { status: 429, headers: { "retry-after": "0", "x-request-id": SECRET } });
		});
		await assert.rejects(searchAlpha(request(), options), error => { safeError(error); assert.equal((error as CodexError).status, 429); return true; });
		assert.equal(calls, 1);
	});

	it("reloads only a changed same-owner grant after 401, preserving bytes without refreshing or writing", async () => {
		const sent: string[] = [];
		const bearers: (string | null)[] = [];
		const options = setup(async (url, init) => {
			assert.equal(init?.redirect, "error");
			assert.equal(url, WEB_SEARCH_ENDPOINT);
			sent.push(init?.body as string);
			bearers.push(new Headers(init?.headers).get("authorization"));
			options.credentialStore.value = grant("owner", "fake-access-new");
			return new Response(SECRET, { status: 401 });
		});
		await assert.rejects(searchAlpha(request(), options), error => { safeError(error); assert.match((error as Error).message, /\/login openai-codex/); return true; });
		assert.equal(options.credentialStore.modifies, 0);
		assert.equal(sent.length, 2);
		assert.equal(new Set(sent).size, 1);
		assert.deepEqual(bearers, ["Bearer fake-access", "Bearer fake-access-new"]);
		assert.equal(options.credentialStore.value?.type === "oauth" && options.credentialStore.value.refresh, "fake-refresh");
	});

	it("keeps the login hint when a read-only store rejects recovery without fallback writes", async () => {
		let calls = 0;
		const options = setup(async () => { calls++; return new Response(null, { status: 401 }); });
		options.credentialStore.modify = async () => { throw new Error(SECRET); };
		await assert.rejects(searchAlpha(request(), options), error => {
			safeError(error);
			assert.match((error as Error).message, /\/login openai-codex/);
			return true;
		});
		assert.equal(calls, 1);
		assert.equal(options.credentialStore.modifies, 0);
		assert.equal(options.credentialStore.value?.type === "oauth" && options.credentialStore.value.access, "fake-access");
	});

	it("refuses an explicit different owner before sending", async () => {
		await assert.rejects(searchAlpha(request(), { ...setup(async () => { assert.fail("must not send"); }), ownerAccountId: "other" }), /authentication failed/);
	});

	it("rechecks the saved owner before the first send and after every HTTP retry", async () => {
		for (const changeAt of [2, 3]) {
			let calls = 0;
			const options = setup(async () => { calls++; return new Response(null, { status: 500 }); });
			options.credentialStore.onRead = count => { if (count === changeAt) options.credentialStore.value = grant("other"); };
			await assert.rejects(searchAlpha(request(), options), /authentication failed/);
			assert.equal(calls, changeAt - 2);
		}
	});

	it("refuses an owner switch during auth recovery without refreshing or sending again", async () => {
		let calls = 0;
		const options = setup(async () => {
			calls++;
			options.credentialStore.value = grant("other");
			return new Response(null, { status: 401 });
		});
		await assert.rejects(searchAlpha(request(), options), /another account/);
		assert.equal(calls, 1);
	});

	it("sanitizes credential read errors", async () => {
		for (const failAt of [1, 2]) {
			const options = setup(async () => { assert.fail("must not send"); });
			options.credentialStore.onRead = count => { if (count === failAt) throw new Error(SECRET); };
			await assert.rejects(searchAlpha(request(), options), safeError);
		}
	});

	it("honors abort before auth, during fetch, during body reading and retry sleep", async () => {
		for (const phase of ["before", "fetch", "body", "sleep"] as const) {
			const controller = new AbortController();
			let calls = 0;
			const options = setup(async () => {
				calls++;
				if (phase === "fetch") { controller.abort(); throw new Error(SECRET); }
				if (phase === "body") return new Response(new ReadableStream({ start(stream) { controller.abort(); stream.error(new Error(SECRET)); } }));
				return new Response(null, { status: 500 });
			});
			options.signal = controller.signal;
			options.sleep = async () => { controller.abort(); };
			if (phase === "before") controller.abort();
			await assert.rejects(searchAlpha(request(), options), (error: Error) => error.name === "AbortError");
			assert.equal(calls, phase === "before" ? 0 : 1);
		}
	});

	it("forbids redirects and never sends bearer credentials to the redirect target", async () => {
		let calls = 0;
		const options = setup(async (url, init) => {
			calls++;
			assert.equal(url, WEB_SEARCH_ENDPOINT);
			assert.equal(init?.redirect, "error");
			return new Response(SECRET, { status: 302, headers: { location: `https://example.invalid/${SECRET}` } });
		});
		await assert.rejects(searchAlpha(request(), options), safeError);
		assert.equal(calls, 1);
	});
});

});
