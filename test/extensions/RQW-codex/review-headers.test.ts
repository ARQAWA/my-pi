// Admitted P1: lowercase chatgpt-account-id plus canonical ChatGPT-Account-ID (and configured lowercase authorization)
// must not survive as comma-joined duplicates on the final fetch-facing SSE headers.
// Real ModelRuntime + installRuntimeAuth, real Pi prepareRequest, real CodexThreadTransport and real sse.postEvents;
// only the network fetch is faked. Fake tokens and account IDs only; no network, no real credentials.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import * as pi from "@earendil-works/pi-coding-agent";
import type { Api, Context, Model } from "@earendil-works/pi-ai";

import { installRuntimeAuth } from "../../../extensions/RQW-codex/auth-runtime.ts";
import { mergeHeaders } from "../../../extensions/RQW-codex/headers.ts";
import { postEvents } from "../../../extensions/RQW-codex/sse.ts";
import { SocketError } from "../../../extensions/RQW-codex/websocket.ts";
import { CodexThreadTransport } from "../../../extensions/RQW-codex/transport.ts";

process.env.PI_OFFLINE = "1";

const ACCOUNT = "acct-fake-1";
const BEARER_TAG = "live";
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const jwt = (payload: Record<string, unknown>) => `${b64({ alg: "none" })}.${b64(payload)}.sig`;
const DAY_MS = 24 * 60 * 60 * 1000;

function liveAccess(): string {
	const exp = Math.floor(Date.now() / 1000) + 3600;
	return jwt({ exp, tag: BEARER_TAG, "https://api.openai.com/auth": { chatgpt_account_id: ACCOUNT } });
}

const IDENTITY = {
	installationId: "11111111-2222-4333-8444-555555555555",
	windowId: "11111111-2222-4333-8444-555555555555:0",
	rootSessionId: "root-session-1",
	threadId: "thread-1",
};

const USER: Context = { systemPrompt: "Be brief.", messages: [{ role: "user", content: "hello", timestamp: 1 }], tools: [] };

/** A real Pi 1.4.0 ModelRuntime whose subscription login lives in a temp auth.json. */
async function runtimeWithLogin() {
	const dir = mkdtempSync(join(tmpdir(), "rqw-codex-review-headers-"));
	const authPath = join(dir, "auth.json");
	const access = liveAccess();
	writeFileSync(authPath, JSON.stringify({
		"openai-codex": {
			type: "oauth",
			access,
			refresh: "RT-fake",
			expires: Date.now() + 3_600_000,
			accountId: ACCOUNT,
			last_refresh: Date.now() - DAY_MS,
		},
	}));
	const runtime = await pi.ModelRuntime.create({ authPath, modelsPath: null, refreshOnCreate: false });
	return { runtime, access, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Lower- and mixed-case spellings of the adapter-owned headers, plus harmless extras; all fake values. */
const CONFIGURED_OBSOLETE = {
	"chatgpt-account-id": "acct-malicious-lower",
	"Chatgpt-Account-Id": "acct-malicious-mixed",
	authorization: "Bearer sk-malicious-lower",
	AUTHORIZATION: "Bearer sk-malicious-upper",
	"x-extra-harmless": "keep-me",
};

/** Real SSE body: created, one assistant message, completed. */
function sseBody(): Response {
	const events = [
		{ type: "response.created", response: { id: "resp_h" } },
		{ type: "response.output_item.added", output_index: 0, item: { type: "message", id: "msg_h", role: "assistant", content: [], status: "in_progress" } },
		{ type: "response.output_text.delta", item_id: "msg_h", output_index: 0, content_index: 0, delta: "ok" },
		{ type: "response.output_item.done", output_index: 0, item: { type: "message", id: "msg_h", role: "assistant", status: "completed", content: [{ type: "output_text", text: "ok", annotations: [] }] } },
		{ type: "response.completed", response: { id: "resp_h", status: "completed", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } } },
	];
	const text = events.map(event => `data: ${JSON.stringify(event)}\n\n`).join("");
	return new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } });
}

/** Fake network only: the real postEvents runs and hands its final RequestInit to this fetch. */
function fakeFetchSeam() {
	const seen: Headers[] = [];
	const fetchFn = async (_url: string, init: RequestInit) => {
		seen.push(new Headers(init.headers));
		return sseBody();
	};
	const postEventsSeam = (options: Parameters<typeof postEvents>[0]) => postEvents({ ...options, fetch: fetchFn as never });
	return { seen, postEventsSeam };
}

/** Name-count of a header in the final Headers view: exactly one entry, with no comma-joined duplicate value. */
function assertSingle(headers: Headers, name: string, expected: string) {
	const entries = [...headers.entries()].filter(([key]) => key === name.toLowerCase());
	assert.equal(entries.length, 1, `one case-insensitive ${name} entry`);
	assert.equal(entries[0]![1], expected, `${name} is exactly the expected value`);
	assert.equal(headers.get(name), expected);
}

it("mergeHeaders: mixed-case duplicates inside the first source are collapsed, the last spelling wins", () => {
	const merged = mergeHeaders({ "chatgpt-account-id": "a", "ChatGPT-Account-ID": "b", "x-keep": "V" }, undefined, { "CHATGPT-ACCOUNT-ID": "c" });
	assert.deepEqual(merged, { "x-keep": "V", "CHATGPT-ACCOUNT-ID": "c" });
});

it("mergeHeaders: overrides replace every casing variant and keep unrelated values untouched", () => {
	const base = { Authorization: "Bearer old", "x-Mixed-Value": "MiXeD" };
	const merged = mergeHeaders(base, { authorization: "Bearer new" });
	assert.deepEqual(merged, { "x-Mixed-Value": "MiXeD", authorization: "Bearer new" });
	assert.deepEqual(base, { Authorization: "Bearer old", "x-Mixed-Value": "MiXeD" }, "sources are not mutated");
	assert.deepEqual(mergeHeaders(undefined, undefined), {});
});

it("mergeHeaders: __proto__ stays an ordinary own key and never changes the prototype", () => {
	const hostile = JSON.parse("{\"__proto__\":\"x\",\"Authorization\":\"Bearer old\"}") as Record<string, string>;
	const merged = mergeHeaders(hostile, { authorization: "Bearer new" });
	assert.equal(Object.getPrototypeOf(merged), Object.prototype);
	assert.equal(Object.getOwnPropertyDescriptor(merged, "__proto__")?.value, "x");
	assert.equal(({} as Record<string, unknown>).polluted, undefined);
	assert.deepEqual(Object.keys(merged), ["__proto__", "authorization"]);
	assert.equal(merged.authorization, "Bearer new");
});

it("getAuth: configured lower/mixed-case account and authorization cannot survive beside the canonical adapter values", async () => {
	const { runtime, access, cleanup } = await runtimeWithLogin();
	try {
		const release = installRuntimeAuth(runtime);
		try {
			const model = { ...runtime.getModels("openai-codex")[0], headers: { ...CONFIGURED_OBSOLETE } } as unknown as Model<never>;
			const result = await runtime.getAuth(model);
			const headers = result?.auth.headers ?? {};
			const keys = Object.keys(headers).map(key => key.toLowerCase());
			assert.equal(keys.filter(key => key === "chatgpt-account-id").length, 1, "one account key in the auth result");
			assert.equal(keys.filter(key => key === "authorization").length, 1, "one authorization key in the auth result");
			assert.equal(headers["chatgpt-account-id"], ACCOUNT);
			assert.equal(headers.Authorization, `Bearer ${access}`);
			assert.equal(headers["x-extra-harmless"], "keep-me", "harmless configured header preserved");
			assert.equal(result?.auth.apiKey, access);
		} finally { release(); }
	} finally { cleanup(); }
});

it("SSE final fetch headers: one account and one bearer under real Pi preparation and the real postEvents", async () => {
	const { runtime, access, cleanup } = await runtimeWithLogin();
	try {
		const release = installRuntimeAuth(runtime);
		try {
			const model = { ...runtime.getModels("openai-codex")[0], headers: { ...CONFIGURED_OBSOLETE } } as unknown as Model<Api>;
			const prepared = await runtime.prepareRequest(model as never, {});
			const seam = fakeFetchSeam();
			const timing = { clock: { now: () => Date.now() }, random: () => 0.5, sleep: async () => {} };
			const transport = new CodexThreadTransport({
				identity: IDENTITY,
				store: (runtime as unknown as { credentials: never }).credentials,
				dependencies: {
					...timing,
					connect: (async () => { throw new SocketError(426, {}, "upgrade required", "upgrade-rejected"); }) as never,
					postEvents: seam.postEventsSeam as never,
				},
			});
			const events: { type: string }[] = [];
			for await (const event of transport.stream(model, USER, prepared.options as never) as AsyncIterable<{ type: string }>) events.push(event);
			assert.equal(seam.seen.length, 1, "one fetch reached the seam");
			const fetched = seam.seen[0]!;
			assertSingle(fetched, "ChatGPT-Account-ID", ACCOUNT);
			assertSingle(fetched, "Authorization", `Bearer ${access}`);
			assert.ok(!fetched.get("authorization")?.includes(","), "bearer is not comma-joined");
			assert.ok(!fetched.get("chatgpt-account-id")?.includes(","), "account is not comma-joined");
			assert.equal(fetched.get("x-extra-harmless"), "keep-me");
			assert.equal(fetched.get("authorization")?.includes("sk-malicious"), false);
			assert.equal(fetched.get("chatgpt-account-id")?.includes("malicious"), false);
		} finally { release(); }
	} finally { cleanup(); }
});
