// Deterministic checks of the native compaction sender (compaction-wire.ts): envelope shape per Lite/tools-in-history
// case, one hook handoff through sendRaw, raw-event mapping and abort propagation. Fake sendRaw, real buildRequest.
// No network, no credentials.
import assert from "node:assert/strict";
import * as zlib from "node:zlib";
import { describe, it } from "node:test";
import { InMemoryCredentialStore, type Api, type Context, type Model, type Tool } from "@earendil-works/pi-ai";

import { createCompactionSender } from "../../../extensions/RQW-codex/compaction-wire.ts";
import { SocketError } from "../../../extensions/RQW-codex/websocket.ts";
import { CODEX_ENDPOINT } from "../../../extensions/RQW-codex/profile.ts";
import { CodexError } from "../../../extensions/RQW-codex/errors.ts";
import type { CodexIdentity } from "../../../extensions/RQW-codex/metadata.ts";
import { CodexThreadTransport, LocalRequestError, wireCapabilities, type SendRawOptions } from "../../../extensions/RQW-codex/transport.ts";
import type { WireModelInfo } from "../../../extensions/RQW-codex/wire.ts";

const STABLE: WireModelInfo = {
	slug: "gpt-test-sol",
	use_responses_lite: false,
	default_reasoning_level: "medium",
	supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }, { effort: "high" }],
	supports_reasoning_summary_parameter: true,
	default_reasoning_summary: "auto",
	support_verbosity: true,
	default_verbosity: "low",
	service_tiers: [{ id: "priority", name: "Fast", description: "fake" }],
	input_modalities: ["text", "image"],
	supports_reasoning_effort_updates: true,
};
const LITE: WireModelInfo = { ...STABLE, use_responses_lite: true };

const MODEL = {
	id: "gpt-test-sol",
	name: "fake",
	api: "openai-codex-responses",
	provider: "openai-codex",
	input: ["text", "image"],
	reasoning: true,
	thinkingLevelMap: {},
} as unknown as Model<Api>;

const IDENTITY = {
	installationId: "11111111-2222-4333-8444-555555555555",
	windowId: "11111111-2222-4333-8444-555555555555:0",
	rootSessionId: "root-session-1",
	threadId: "thread-1",
} as unknown as CodexIdentity;

/** Previous model of the same compaction: a Lite native record with its own slug, same endpoint and lineage. */
const FALLBACK_LITE: WireModelInfo = { ...LITE, slug: "gpt-test-luna" };
const FALLBACK_MODEL = { ...MODEL, id: "gpt-test-luna" } as unknown as Model<Api>;
const FALLBACK_IDENTITY = { ...IDENTITY, extra: { model: "gpt-test-luna", effort: "low" } } as unknown as CodexIdentity;

const BASH: Tool = { name: "bash", description: "run a command", parameters: { type: "object", properties: {} } } as unknown as Tool;
const CONTEXT: Context = { systemPrompt: "BASE PROMPT", messages: [], tools: [BASH] };

const HISTORY_USER = { type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] };
const HISTORY_TOOLS = { type: "additional_tools", id: "at_old", role: "developer", tools: [{ type: "namespace", name: "functions", tools: [] }] };
const TRIGGER = { type: "compaction_trigger" };

/** A fake sendRaw: records each call, runs the onPayload hook once like the real transport, then yields the script. */
function fakeTransport(script: Record<string, unknown>[] | ((call: SendRawOptions) => AsyncGenerator<Record<string, unknown>>)) {
	const calls: SendRawOptions[] = [];
	const hooks: { count: number } = { count: 0 };
	const transport = {
		sendRaw(args: SendRawOptions): AsyncIterable<Record<string, unknown>> {
			calls.push(args);
			const run = async function* () {
				const hook = args.options?.onPayload;
				if (hook) {
					hooks.count++;
					await hook(args.request as unknown as Record<string, unknown>, args.model);
				}
				if (typeof script === "function") {
					yield* script(args);
					return;
				}
				for (const event of script) yield event;
			};
			return run();
		},
	};
	return { transport, calls, hooks };
}

/** compactBackend's body: normalized history plus one trailing compaction_trigger. Its tools/base fields are ignored. */
function compactorBody(input: unknown[], extra: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		model: "gpt-test-sol",
		input: [...input, TRIGGER],
		tools: [],
		parallel_tool_calls: false,
		tool_choice: "auto",
		store: false,
		stream: true,
		include: ["reasoning.encrypted_content"],
		...extra,
	};
}

async function drive(send: Awaited<ReturnType<typeof createCompactionSender>>, body: Record<string, unknown>, signal?: AbortSignal) {
	const stream = await send({ endpoint: CODEX_ENDPOINT, body, signal, attempt: 0 });
	const out: Record<string, unknown>[] = [];
	for await (const event of stream as AsyncIterable<Record<string, unknown>>) out.push(event);
	return out;
}

function sender(overrides: Partial<Parameters<typeof createCompactionSender>[0]> & { script?: Parameters<typeof fakeTransport>[0] } = {}) {
	const fake = fakeTransport(overrides.script ?? []);
	const send = createCompactionSender({
		transport: fake.transport,
		model: MODEL,
		context: CONTEXT,
		options: { onPayload: (body: unknown) => body as never } as never,
		identity: IDENTITY,
		capabilities: STABLE,
		toolsInHistory: false,
		...overrides,
	});
	return { send, ...fake };
}

const types = (input: unknown): string[] => (input as { type: string }[]).map((item) => item.type);

describe("native compaction envelope", () => {
	it("Lite with additional_tools already in history: no fresh tools, no base instructions, no top-level tools", async () => {
		const s = sender({
			capabilities: LITE,
			toolsInHistory: true,
			script: [{ type: "response.completed", response: { id: "r1", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } }],
		});
		await drive(s.send, compactorBody([HISTORY_TOOLS, HISTORY_USER]));
		const request = s.calls[0].request as unknown as Record<string, unknown>;
		assert.deepEqual(types(request.input), ["additional_tools", "message", "compaction_trigger"]);
		assert.equal((request.input as { id?: string }[])[0].id, "at_old");
		assert.equal("tools" in request, false);
		assert.equal(request.model, "gpt-test-sol");
		assert.equal(request.store, false);
		assert.equal(request.stream, true);
		assert.deepEqual(request.include, ["reasoning.encrypted_content"]);
		assert.equal(request.prompt_cache_key, IDENTITY.rootSessionId);
		assert.equal("endpoint" in request, false);
		assert.equal(s.calls[0].requestKind, "compaction");
	});

	it("Lite without tools in history: native additional_tools (at_) then developer base item (msg_), no top-level tools", async () => {
		const s = sender({ capabilities: LITE, toolsInHistory: false, script: [{ type: "response.completed", response: { id: "r1", usage: {} } }] });
		await drive(s.send, compactorBody([HISTORY_USER]));
		const request = s.calls[0].request as unknown as Record<string, unknown>;
		const input = request.input as { type: string; id?: string; role?: string }[];
		assert.deepEqual(types(input), ["additional_tools", "message", "message", "compaction_trigger"]);
		assert.match(input[0].id ?? "", /^at_/);
		assert.equal(input[1].role, "developer");
		assert.match(input[1].id ?? "", /^msg_/);
		assert.equal(input[2].role, "user");
		assert.equal("tools" in request, false);
	});

	it("standard model: developer base prefix (msg_) and current top-level function tools, no additional_tools", async () => {
		const s = sender({ script: [{ type: "response.completed", response: { id: "r1", usage: {} } }] });
		await drive(s.send, compactorBody([HISTORY_USER]));
		const request = s.calls[0].request as unknown as Record<string, unknown>;
		const input = request.input as { type: string; id?: string; role?: string }[];
		assert.deepEqual(types(input), ["message", "message", "compaction_trigger"]);
		assert.equal(input[0].role, "developer");
		assert.match(input[0].id ?? "", /^msg_/);
		assert.deepEqual(request.tools, [{ type: "function", name: "bash", description: "run a command", strict: false, parameters: BASH.parameters }]);
		assert.equal(request.parallel_tool_calls, true);
	});

	it("compactor reasoning, model and service tier are preserved when provided; the skeleton otherwise", async () => {
		const provided = sender({ script: [{ type: "response.completed", response: { id: "r1", usage: {} } }] });
		await drive(provided.send, compactorBody([HISTORY_USER], { reasoning: { effort: "high" }, service_tier: "priority" }));
		const withValues = provided.calls[0].request as unknown as Record<string, unknown>;
		assert.deepEqual(withValues.reasoning, { effort: "high" });
		assert.equal(withValues.service_tier, "priority");

		const skeleton = sender({ script: [{ type: "response.completed", response: { id: "r1", usage: {} } }] });
		await drive(skeleton.send, compactorBody([HISTORY_USER]));
		const defaults = skeleton.calls[0].request as unknown as Record<string, unknown>;
		assert.deepEqual(defaults.reasoning, { effort: "medium", summary: "auto" });
		assert.equal("service_tier" in defaults, false);
	});

	it("one hook handoff: sendRaw receives the caller options and runs onPayload once per send", async () => {
		const onPayload = () => undefined;
		const s = sender({ options: { onPayload } as never, script: [{ type: "response.completed", response: { id: "r1", usage: {} } }] });
		await drive(s.send, compactorBody([HISTORY_USER]));
		assert.equal(s.calls.length, 1);
		assert.equal(s.calls[0].options?.onPayload, onPayload);
		assert.equal(s.hooks.count, 1);
	});
});

describe("raw event mapping", () => {
	it("output_item.done is verbatim; response.completed carries id and normalized usage", async () => {
		const item = { type: "compaction", id: "cmp_1", encrypted_content: "ENC+/==raw" };
		const s = sender({
			script: [
				{ type: "response.created", response: { id: "r1" } },
				{ type: "response.output_item.done", item },
				{ type: "response.completed", response: { id: "r1", usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } } },
			],
		});
		const events = await drive(s.send, compactorBody([HISTORY_USER]));
		assert.equal(events.length, 2);
		assert.equal(events[0].type, "output_item_done");
		assert.equal(events[0].item, item);
		assert.equal(events[1].type, "completed");
		assert.equal(events[1].responseId, "r1");
		assert.equal((events[1].usage as { totalTokens: number }).totalTokens, 12);
	});

	it("response.failed maps to a typed failed event with safe message, retryable flag and usage; the stream ends", async () => {
		const s = sender({
			script: [
				{
					type: "response.failed",
					response: {
						id: "r2",
						usage: { input_tokens: 7, output_tokens: 1, total_tokens: 8 },
						error: { code: "rate_limit_exceeded", message: "secret server body" },
					},
				},
				{ type: "response.completed", response: { id: "r3", usage: {} } },
			],
		});
		const events = await drive(s.send, compactorBody([HISTORY_USER]));
		assert.equal(events.length, 1);
		assert.equal(events[0].type, "failed");
		assert.equal(events[0].retryable, true);
		assert.equal(String(events[0].message).includes("secret"), false);
		assert.equal((events[0].usage as { totalTokens: number }).totalTokens, 8);
	});

	it("context_length_exceeded failed is not retryable", async () => {
		const s = sender({
			script: [{ type: "response.failed", response: { error: { code: "context_length_exceeded", message: "long" } } }],
		});
		const events = await drive(s.send, compactorBody([HISTORY_USER]));
		assert.equal(events[0].type, "failed");
		assert.equal(events[0].retryable, false);
		assert.equal(events[0].usage, null);
	});

	it("error event maps to a typed error event with retryable flag", async () => {
		const s = sender({ script: [{ type: "error", error: { code: "server_is_overloaded", message: "busy" } }] });
		const events = await drive(s.send, compactorBody([HISTORY_USER]));
		assert.equal(events[0].type, "error");
		// No status on the wrapper: classifyEvent is null, so the transport's fallback stream class (retryable) applies.
		assert.equal(events[0].retryable, true);
	});

	it("response.incomplete keeps the typed reason and usage", async () => {
		const s = sender({
			script: [
				{
					type: "response.incomplete",
					response: { id: "r4", incomplete_details: { reason: "max_output_tokens" }, usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 } },
				},
			],
		});
		const events = await drive(s.send, compactorBody([HISTORY_USER]));
		assert.equal(events[0].type, "incomplete");
		assert.equal(events[0].reason, "max_output_tokens");
		assert.equal(events[0].responseId, "r4");
		assert.equal((events[0].usage as { totalTokens: number }).totalTokens, 8);
	});

	it("interrupted incomplete is passed on as reason interrupted with its response id", async () => {
		const s = sender({ script: [{ type: "response.incomplete", response: { id: "r5", incomplete_details: { reason: "interrupted" } } }] });
		const events = await drive(s.send, compactorBody([HISTORY_USER]));
		assert.equal(events[0].reason, "interrupted");
		assert.equal(events[0].responseId, "r5");
	});

	it("a raw stream that ends without a terminal event throws a retryable stream error", async () => {
		const s = sender({ script: [{ type: "response.output_item.done", item: { type: "message" } }] });
		await assert.rejects(drive(s.send, compactorBody([HISTORY_USER])), (error: unknown) => {
			assert.ok(error instanceof CodexError);
			assert.equal(error.kind, "stream");
			assert.equal(error.retryable, true);
			return true;
		});
	});
});

describe("abort and errors", () => {
	it("an abort reaches sendRaw as the signal and ends the request as AbortError", async () => {
		const controller = new AbortController();
		const s = sender({
			script: async function* (call: SendRawOptions) {
				yield { type: "response.created", response: { id: "r1" } };
				controller.abort();
				call.signal?.throwIfAborted();
			},
		});
		await assert.rejects(drive(s.send, compactorBody([HISTORY_USER]), controller.signal), { name: "AbortError" });
		assert.equal(s.calls[0].signal, controller.signal);
	});

	it("an already aborted signal throws before sendRaw is called", async () => {
		const controller = new AbortController();
		controller.abort();
		const s = sender();
		await assert.rejects(drive(s.send, compactorBody([HISTORY_USER]), controller.signal), { name: "AbortError" });
		assert.equal(s.calls.length, 0);
	});

	it("errors thrown by sendRaw propagate unchanged for the outer retry budget", async () => {
		const thrown = new CodexError({ kind: "connection_failed", connectionFailed: true, transport: true });
		const s = sender({
			script: async function* () {
				throw thrown;
			},
		});
		await assert.rejects(drive(s.send, compactorBody([HISTORY_USER])), (error: unknown) => error === thrown);
	});
});

// ---- real facade: compaction over a 426 upgrade, then a normal turn on the sticky SSE route -------------------------

function b64url(value: unknown): string {
	return Buffer.from(JSON.stringify(value)).toString("base64url");
}

async function realStore(): Promise<InMemoryCredentialStore> {
	const exp = Math.floor(Date.now() / 1000) + 3600;
	const access = `${b64url({ alg: "none" })}.${b64url({ exp, "https://api.openai.com/auth": { chatgpt_account_id: "acct_test_1" } })}.sig`;
	const store = new InMemoryCredentialStore();
	await store.modify("openai-codex", async () => ({ type: "oauth", access, refresh: "refresh-1", expires: exp * 1000, accountId: "acct_test_1" }) as never);
	return store;
}

/** Fake SSE POST: one scripted event list per request, in order. */
function sseFake(scripts: Record<string, unknown>[][]) {
	const calls: { body: Uint8Array; headers: Record<string, string> }[] = [];
	const fn = (options: { body: Uint8Array; headers: Record<string, string>; onResponse: (head: unknown) => void }) => {
		calls.push({ body: options.body, headers: options.headers });
		const events = scripts.shift();
		if (!events) throw new Error("unexpected SSE request");
		return (async function* () {
			options.onResponse({ status: 200, headers: {} });
			for (const value of events) yield { text: JSON.stringify(value), value };
		})();
	};
	return { fn: fn as never, calls };
}

describe("compaction over the real facade after a 426", () => {
	it("426 then SSE: compaction_trigger sent once, onPayload once, the next normal stream stays on SSE", async () => {
		const model = { ...MODEL, id: "gpt-6-luna", cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } } as unknown as Model<Api>;
		let connects = 0;
		const connect = async () => {
			connects++;
			throw new SocketError(426, {}, "upgrade required", "upgrade-rejected");
		};
		const completed = (id: string) => ({ type: "response.completed", response: { id, status: "completed", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } } });
		const sse = sseFake([
			[{ type: "response.created", response: { id: "resp_cmp" } }, { type: "response.output_item.done", output_index: 0, item: { type: "compaction", id: "cmp_1", encrypted_content: "enc" } }, completed("resp_cmp")],
			[{ type: "response.created", response: { id: "resp_turn" } }, { type: "response.output_item.added", output_index: 0, item: { type: "message", id: "msg_turn", role: "assistant", content: [], status: "in_progress" } }, { type: "response.output_text.delta", item_id: "msg_turn", output_index: 0, content_index: 0, delta: "ok" }, { type: "response.output_item.done", output_index: 0, item: { type: "message", id: "msg_turn", role: "assistant", status: "completed", content: [{ type: "output_text", text: "ok", annotations: [] }] } }, completed("resp_turn")],
		]);
		const timing = { now: () => 1_000_000 };
		const transport = new CodexThreadTransport({
			identity: IDENTITY,
			store: await realStore(),
			dependencies: { clock: timing, random: () => 0.5, sleep: async () => undefined, connect: connect as never, postEvents: sse.fn },
		});
		let hooks = 0;
		const send = createCompactionSender({
			transport,
			model,
			context: CONTEXT,
			options: { onPayload: () => { hooks++; } } as never,
			identity: IDENTITY,
			capabilities: wireCapabilities(model),
			toolsInHistory: false,
		});
		const events = await drive(send, compactorBody([HISTORY_USER], { model: "gpt-6-luna" }));
		assert.equal(events.at(-1)?.type, "completed");
		assert.equal(connects, 1);
		assert.equal(hooks, 1);
		assert.equal(sse.calls.length, 1);
		assert.equal(transport.transport, "sse");
		const body = JSON.parse(zlib.zstdDecompressSync(Buffer.from(sse.calls[0].body)).toString("utf8")) as { input: { type: string }[]; client_metadata: Record<string, string> };
		assert.equal(body.input.filter((item) => item.type === "compaction_trigger").length, 1);
		assert.equal(body.input.at(-1)?.type, "compaction_trigger");
		assert.equal(body.client_metadata.guardian_credits_requested, "true");

		const turn = [];
		for await (const event of transport.stream(model, { systemPrompt: "Be brief.", messages: [{ role: "user", content: "next", timestamp: 2 }], tools: [] } as Context)) turn.push(event);
		assert.equal(turn.at(-1)?.type, "done");
		assert.equal(connects, 1, "no WebSocket attempt after the sticky SSE fallback");
		assert.equal(sse.calls.length, 2);
	});
});

describe("declared fallback route", () => {
	const fallbackOptions = { onPayload: () => undefined } as never;
	const fallback = { model: FALLBACK_MODEL, options: fallbackOptions, identity: FALLBACK_IDENTITY, capabilities: FALLBACK_LITE };
	const ok = [{ type: "response.completed", response: { id: "r1", usage: {} } }];

	it("fallback slug is selected by exact body.model: its own model, options and identity; Lite prefix shape", async () => {
		const s = sender({ fallback, toolsInHistory: false, script: ok });
		await drive(s.send, compactorBody([HISTORY_USER], { model: "gpt-test-luna" }));
		assert.equal(s.calls.length, 1);
		assert.equal(s.calls[0].model, FALLBACK_MODEL);
		assert.equal(s.calls[0].options, fallbackOptions);
		assert.deepEqual(s.calls[0].identity, FALLBACK_IDENTITY);
		assert.equal(s.calls[0].requestKind, "compaction");
		const request = s.calls[0].request as unknown as Record<string, unknown>;
		assert.equal(request.model, "gpt-test-luna");
		assert.deepEqual(types(request.input), ["additional_tools", "message", "message", "compaction_trigger"]);
		assert.match((request.input as { id?: string }[])[0].id ?? "", /^at_/);
		assert.equal("tools" in request, false);
		assert.equal(s.hooks.count, 1);
	});

	it("fallback Lite with additional_tools already in history: no fresh prefix", async () => {
		const s = sender({ fallback, toolsInHistory: true, script: ok });
		await drive(s.send, compactorBody([HISTORY_TOOLS, HISTORY_USER], { model: "gpt-test-luna" }));
		const request = s.calls[0].request as unknown as Record<string, unknown>;
		assert.equal(s.calls[0].model, FALLBACK_MODEL);
		assert.deepEqual(types(request.input), ["additional_tools", "message", "compaction_trigger"]);
		assert.equal((request.input as { id?: string }[])[0].id, "at_old");
	});

	it("standard fallback keeps the developer base prefix and top-level tools", async () => {
		const standard = { ...fallback, model: { ...FALLBACK_MODEL }, capabilities: { ...STABLE, slug: "gpt-test-luna" } };
		const s = sender({ fallback: standard, toolsInHistory: false, script: ok });
		await drive(s.send, compactorBody([HISTORY_USER], { model: "gpt-test-luna" }));
		const request = s.calls[0].request as unknown as Record<string, unknown>;
		assert.equal(s.calls[0].model.id, "gpt-test-luna");
		assert.deepEqual(types(request.input), ["message", "message", "compaction_trigger"]);
		assert.ok(Array.isArray(request.tools));
	});

	it("primary is still selected when a fallback is declared", async () => {
		const s = sender({ fallback, script: ok });
		await drive(s.send, compactorBody([HISTORY_USER]));
		assert.equal(s.calls[0].model, MODEL);
		assert.equal(s.calls[0].identity, IDENTITY);
		assert.equal((s.calls[0].request as unknown as Record<string, unknown>).model, "gpt-test-sol");
	});

	it("a fallback with the same slug as the primary never overrides the primary", async () => {
		const same = { ...fallback, model: { ...MODEL }, identity: { ...IDENTITY, extra: { model: "other" } } as unknown as CodexIdentity, capabilities: STABLE };
		const primaryOptions = { onPayload: () => undefined } as never;
		const s = sender({ fallback: same, options: primaryOptions, script: ok });
		await drive(s.send, compactorBody([HISTORY_USER]));
		assert.equal(s.calls[0].identity, IDENTITY);
		assert.equal(s.calls[0].options, primaryOptions);
	});

	it("an unknown slug throws LocalRequestError before sendRaw", async () => {
		const s = sender({ fallback, script: ok });
		await assert.rejects(drive(s.send, compactorBody([HISTORY_USER], { model: "gpt-unknown" })), (error: unknown) => error instanceof LocalRequestError);
		assert.equal(s.calls.length, 0);
		assert.equal(s.hooks.count, 0);
	});

	it("a missing body.model throws LocalRequestError before sendRaw", async () => {
		const s = sender({ fallback, script: ok });
		const body = compactorBody([HISTORY_USER]);
		delete body.model;
		await assert.rejects(drive(s.send, body), (error: unknown) => error instanceof LocalRequestError);
		assert.equal(s.calls.length, 0);
	});
});

describe("native compaction identity", () => {
	it("forwards the request-scoped identity to sendRaw unchanged", async () => {
		const scoped = { ...IDENTITY, turnId: "turn_cmp", turnStartedAtUnixMs: 1234 } as unknown as CodexIdentity;
		const s = sender({
			identity: scoped,
			script: [{ type: "response.completed", response: { id: "r1", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } }],
		});
		await drive(s.send, compactorBody([HISTORY_USER]));
		assert.deepEqual(s.calls[0].identity, scoped);
	});
});
