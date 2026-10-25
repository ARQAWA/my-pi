import assert from "node:assert/strict";
import { test } from "node:test";
import { InMemoryCredentialStore, type Api, type Model } from "@earendil-works/pi-ai";
import { resolveStoredCredential, recoverCredential } from "../../../extensions/RQW-web/vendor/auth-boundary.ts";
import * as profile from "../../../extensions/RQW-web/vendor/profile.ts";
import { CodexThreadTransport, wireCapabilities } from "../../../extensions/RQW-web/vendor/transport.ts";
import { CodexError, classifyEvent, classifyHttp, classifyTransport } from "../../../extensions/RQW-web/vendor/errors.ts";
import { buildRequest, validateFinalRequest } from "../../../extensions/RQW-web/vendor/wire.ts";

const { CODEX_MODEL_SLUGS, codexModelCapabilities } = profile;
const identity = { installationId: "installation", rootSessionId: "thread", threadId: "thread", windowId: "thread:0" };

test("no native model profile or caller option can add Fast to the web request", () => {
	for (const id of CODEX_MODEL_SLUGS) {
		const model = { id, provider: "openai-codex", api: "openai-codex-responses", input: ["text"] } as Model<Api>;
		const capabilities = wireCapabilities(model);
		const body = buildRequest({ model, capabilities, identity, requestKind: "turn",
			options: { reasoningEffort: "medium", serviceTier: "priority" } as any,
			context: { systemPrompt: "Use web.run", tools: [], messages: [{ role: "user", content: "query", timestamp: 0 }] } });
		assert.equal(Object.hasOwn(body, "service_tier"), false, id);
		assert.equal(Object.hasOwn(body, "defaultServiceTier"), false, id);
		assert.equal(body.parallel_tool_calls, false);
		validateFinalRequest({ body: body as any, capabilities });
		assert.throws(() => validateFinalRequest({ body: { ...body, service_tier: "priority" }, capabilities }), /service_tier/);
		assert.equal(codexModelCapabilities(id).slug, id);
	}
});

test("expired, missing and rejected grants cannot cause auth writes or token endpoint requests", async (t) => {
	t.mock.method(globalThis, "fetch", async () => { assert.fail("no auth network"); });
	const signal = new AbortController().signal;
	for (const expired of [false, true]) {
		const store = new InMemoryCredentialStore();
		if (expired) {
			const payload = Buffer.from(JSON.stringify({ exp: 1 })).toString("base64url");
			await store.modify("openai-codex", async () => ({ type: "oauth", access: `e30.${payload}.fake`, refresh: "fake-refresh", expires: 1000, accountId: "owner" }));
		}
		store.modify = async () => { assert.fail("no auth writes"); };
		await assert.rejects(resolveStoredCredential(store, signal), /\/login openai-codex/);
	}
	const store = new InMemoryCredentialStore();
	await store.modify("openai-codex", async () => ({ type: "oauth", access: "fake-access", refresh: "fake-refresh", expires: Number.MAX_SAFE_INTEGER, accountId: "owner" }));
	store.modify = async () => { assert.fail("no auth writes"); };
	await assert.rejects(recoverCredential(store, { accountId: "owner", access: "fake-access" }, signal), /\/login openai-codex/);
});

test("the native snapshot exposes only web transport methods and needed profile fields", () => {
	assert.deepEqual(Object.getOwnPropertyNames(CodexThreadTransport.prototype).sort(), ["beginTurn", "constructor", "dispose", "endTurn", "sendRaw"]);
	assert.deepEqual(Object.keys(profile).sort(), ["CODEX_ENDPOINT", "CODEX_MODEL_SLUGS", "CODEX_PROVIDER", "CODEX_RETRY", "codexModelCapabilities"]);
	assert.deepEqual(Object.keys(profile.CODEX_RETRY).sort(), ["requestBaseDelayMs", "requestMaxRetries"]);
	for (const id of CODEX_MODEL_SLUGS) {
		assert.deepEqual(Object.keys(codexModelCapabilities(id)).sort(), [
			"defaultReasoningLevel", "defaultReasoningSummary", "defaultVerbosity", "slug", "supportVerbosity",
			"supportedReasoningLevels", "supportsReasoningSummaryParameter", "useResponsesLite",
		]);
	}
});

test("trimmed errors preserve native HTTP and stream classification without display bookkeeping", () => {
	for (const [status, kind] of [[400, "invalid_request"], [401, "unauthorized"], [429, "retry_limit"], [500, "internal_server_error"]] as const) {
		assert.equal(classifyHttp(status).kind, kind);
	}
	assert.equal(classifyTransport("connection").kind, "connection_failed");
	assert.equal(classifyTransport("policy").kind, "fatal");
	const error = classifyEvent({ type: "response.failed", response: { error: { code: "rate_limit_exceeded", message: "secret; try again in 3 seconds" } } }, 1000);
	assert.ok(error instanceof CodexError);
	assert.equal(error.kind, "rate_limit_exceeded");
	assert.equal(error.retryAt, 4000);
	assert.equal(error.message, "Rate limit exceeded.");
	assert.equal("withPartial" in error, false);
	assert.equal("usage" in error, false);
	const incomplete = classifyEvent({ type: "response.incomplete", response: { incomplete_details: { reason: "max_output_tokens" } } });
	assert.equal(incomplete?.kind, "response_incomplete");
	assert.equal(incomplete?.message, "Incomplete response returned, reason: max_output_tokens");
	assert.equal(classifyEvent({ type: "response.completed" }), null);
});
