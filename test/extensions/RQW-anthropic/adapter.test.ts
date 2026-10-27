import assert from "node:assert/strict";
import { it } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { InMemoryCredentialStore, normalizeContext, type OAuthCredential, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { recoverCredential, refreshCredential, TOKEN_URL } from "../../../extensions/RQW-anthropic/auth.ts";
import { createOverlay, subscriptionFetch } from "../../../extensions/RQW-anthropic/transport.ts";
import { billingBody, IDENTITY, versionState, xxh64 } from "../../../extensions/RQW-anthropic/wire.ts";

const ACCESS = "sk-ant-oat01-fake-old";
const NEXT = "sk-ant-oat01-fake-new";
const credential = { type: "oauth" as const, access: ACCESS, refresh: "fake-refresh", expires: 4_102_444_800_000 };
const raw = JSON.stringify({
	system: [{ type: "text", text: IDENTITY }, { type: "text", text: "Keep this instruction" }],
	messages: [{ role: "user", content: "Hello cch=00000; world" }],
});
const url = "https://api.anthropic.com/v1/messages";
type ClientOptions = SimpleStreamOptions & { client: Anthropic };
const base = builtinProviders().find(provider => provider.id === "anthropic")!;
const model = base.getModels()[0];
const context = { messages: [{ role: "user" as const, content: "fake prompt", timestamp: 1 }] };
const start = { type: "message_start", message: { id: "fake", model: model.id, usage: { input_tokens: 1, output_tokens: 0 } } };
const text = [start,
	{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
	{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "PARTIAL" } },
	{ type: "content_block_stop", index: 0 },
];
const finish = [{ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } }, { type: "message_stop" }];
const response = (events: unknown[]) => new Response(events.map(event => `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), {
	headers: { "content-type": "text/event-stream" },
});
const refreshed = () => Response.json({ access_token: NEXT, refresh_token: "fake-rotated", expires_in: 3600 });
async function store() {
	const value = new InMemoryCredentialStore();
	await value.modify("anthropic", async () => credential);
	return value;
}

it("adds a valid billing header without changing the request content", () => {
	const body = JSON.parse(billingBody(raw, "2.1.280", "session", "device"));
	assert.equal(body.system[1].text, IDENTITY);
	assert.equal(body.system[2].text, "Keep this instruction");
	assert.deepEqual(body.messages, JSON.parse(raw).messages);
	assert.deepEqual(JSON.parse(body.metadata.user_id), { device_id: "device", session_id: "session" });
	const digest = /cch=([0-9a-f]{5})/.exec(body.system[0].text)![1];
	body.system[0].text = body.system[0].text.replace(`cch=${digest}`, "cch=00000");
	assert.equal(digest, (xxh64(new TextEncoder().encode(JSON.stringify(body)), 0x4d659218e32a3268n) & 0xfffffn).toString(16).padStart(5, "0"));
});

it("refreshes a rejected saved bearer and replays the request", async () => {
	const credentials = await store();
	let inference = 0;
	let refreshes = 0;
	const transport: typeof fetch = async input => {
		if (String(input) === TOKEN_URL) { refreshes++; return refreshed(); }
		inference++;
		return inference === 1 ? new Response("expired", { status: 401 }) : new Response("ok");
	};
	const result = await subscriptionFetch(transport, credentials, versionState(), "session", "device")(url, {
		method: "POST", body: raw, headers: { authorization: `Bearer ${ACCESS}` },
	});
	assert.equal(await result.text(), "ok");
	assert.equal(inference, 2);
	assert.equal(refreshes, 1);
	assert.equal((await credentials.read("anthropic") as OAuthCredential | undefined)?.access, NEXT);
});

// Regression: 3b1fd18 kept fork version adoption independent and pinned versions fixed.
it("keeps adopted fork versions independent", () => {
	const source = versionState();
	const fork = source.fork();
	assert.equal(fork.adopt("claude_code_version_too_old: version 2.2.0 or newer is required"), true);
	assert.equal(fork.value, "2.2.0");
	assert.equal(source.value, "2.1.280");
	assert.equal(versionState("2.1.280").fork().adopt("claude_code_version_too_old: version 2.2.0 or newer is required"), false);
});

// Regression: ce0fa4d reused a proven rotation but rejected an unrelated saved login.
it("reuses only a proven credential rotation", async () => {
	const credentials = await store();
	const signal = new AbortController().signal;
	await credentials.modify("anthropic", async current => refreshCredential(current! as OAuthCredential, signal, async () => refreshed()));
	const noFetch: typeof fetch = async () => { throw new Error("unexpected network"); };
	assert.equal(await recoverCredential(credentials, ACCESS, signal, noFetch), NEXT);
	await credentials.modify("anthropic", async () => ({ ...credential, access: "sk-ant-oat01-other-login" }));
	await assert.rejects(recoverCredential(credentials, ACCESS, signal, noFetch), /Saved login changed/);
});

// Regression: a0b4f8d prevented a custom SDK client from bypassing protected OAuth transport.
it("keeps OAuth off a custom client while ordinary API-key clients stay native", async () => {
	let customCalls = 0;
	let protectedCalls = 0;
	const client = new Anthropic({ apiKey: null, authToken: ACCESS, baseURL: "https://gateway.invalid", fetch: async () => {
		customCalls++;
		return response([...text, ...finish]);
	} });
	const overlay = createOverlay(base, () => undefined, "device");
	const oauth = await overlay.streamSimple(model, normalizeContext(context), {
		apiKey: ACCESS, client, fetch: async () => { protectedCalls++; return response([...text, ...finish]); },
	} as ClientOptions).result();
	assert.equal(oauth.stopReason, "stop");
	assert.equal(customCalls, 0);
	assert.equal(protectedCalls, 1);
	const ordinary = await overlay.streamSimple(model, normalizeContext(context), { apiKey: "fake-key", client } as ClientOptions).result();
	assert.equal(ordinary.stopReason, "stop");
	assert.equal(customCalls, 1);
});

// Regression: 3e111b9 preserved partial output instead of replaying a damaged turn.
it("returns partial stream output with its terminal diagnostic", async () => {
	let calls = 0;
	const overlay = createOverlay(base, () => undefined, "device");
	const result = await overlay.streamSimple(model, normalizeContext(context), { apiKey: ACCESS, fetch: async () => {
		calls++;
		return response([...text, { type: "error", error: { type: "overloaded_error", message: "fake overload" } }]);
	} }).result();
	assert.equal(result.stopReason, "error");
	assert.deepEqual(result.content, [{ type: "text", text: "PARTIAL" }]);
	assert.ok(result.diagnostics?.some(item => item.type === "rqw_anthropic_partial_stream"));
	assert.equal(calls, 1);
});

// Regression: 2bfdc8b blocked effective OAuth headers before an unsupported delegate.
it("rejects OAuth in model headers on an unsupported origin", () => {
	const overlay = createOverlay(base, () => undefined, "device");
	assert.throws(() => overlay.streamSimple({ ...model, baseUrl: "https://untrusted.example", headers: { Authorization: `Bearer ${ACCESS}` } },
		normalizeContext(context), { apiKey: "fake-key", fetch: async () => { throw new Error("unexpected network"); } }), /OAuth Authorization headers/);
});
