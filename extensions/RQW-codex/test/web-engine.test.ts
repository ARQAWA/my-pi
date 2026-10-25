import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { zstdDecompressSync } from "node:zlib";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { AUTH_REFRESH_MESSAGE, researchTarget } from "../web-engine.ts";
import { parseCommands, WEB_TOOLS } from "../web-commands.ts";
import type { ResearchTargetOptions, WebTransport } from "../web-types.ts";
import type { SendRawOptions } from "../transport.ts";

const call = (commands: unknown, id = "call-1", extra = {}) => ({ type: "function_call", namespace: "web", name: "run", call_id: id, arguments: JSON.stringify(commands), status: "completed", ...extra });
const search = { search_query: [{ q: "Pi documentation" }] };
const citation = { type: "url_citation", url: "https://example.com/page", title: "Source", start_index: 0, end_index: 7, future: { kept: true } };
const message = (text = "Verified [fact](https://example.com/page).", annotations: unknown[] = [citation]) => ({ type: "message", role: "assistant", content: [{ type: "output_text", text, annotations }], status: "completed" });
const events = (...items: unknown[]) => [...items.map((item, output_index) => ({ type: "response.output_item.done", item, output_index })), { type: "response.completed", response: { id: "resp-1", status: "completed" } }];

async function setup(scripts = [events(call(search)), events(message())]) {
	const store = new InMemoryCredentialStore();
	await store.modify("openai-codex", async () => ({ type: "oauth", access: "fake-access", refresh: "fake-refresh", expires: Number.MAX_SAFE_INTEGER, accountId: "fake-owner" }));
	const requests: SendRawOptions[] = [];
	const alpha: Record<string, unknown>[] = [];
	const counts = { begin: 0, end: 0, dispose: 0 };
	let onSend: ((index: number) => void) | undefined;
	const transport: WebTransport = {
		beginTurn: () => { counts.begin++; }, endTurn: () => { counts.end++; }, dispose: () => { counts.dispose++; },
		async *sendRaw(args) {
			requests.push(structuredClone({ ...args, signal: undefined }));
			onSend?.(requests.length);
			for (const event of scripts.shift() ?? []) yield event;
		},
	};
	const options: ResearchTargetOptions = {
		target: { kind: "query", value: "Pi documentation" }, model: "gpt-6-luna", effort: "medium", credentialStore: store,
		network: { createTransport: () => transport, fetch: (async (_url, init) => {
			alpha.push(JSON.parse(init?.body as string));
			return Response.json({ output: "Source content", results: [{ future: { opaque: [1, null, "value"] } }], encrypted_output: "never-return" });
		}) as typeof fetch },
	};
	return { options, requests, alpha, counts, store, transport, onSend: (fn: typeof onSend) => { onSend = fn; } };
}

describe("rqw-web shared native mechanism", () => {
test("native Lite prefix, exact raw replay, sourced summary and opaque annotations/results", async () => {
	const reasoning = { type: "reasoning", id: "reason-1", encrypted_content: "cipher-only-in-memory", future: 42 };
	const webCall = call(search);
	const s = await setup([events(reasoning, webCall), events(message())]);
	const result = await researchTarget(s.options);
	assert.equal(result.status, "ok");
	assert.equal(result.summary, "Verified [fact](https://example.com/page).");
	assert.deepEqual(result.citations, [citation]);
	assert.deepEqual(result.sources, [{ url: citation.url, title: "Source" }]);
	assert.deepEqual(result.results, [{ future: { opaque: [1, null, "value"] } }]);
	assert.deepEqual(result.actions, [{ type: "web.run", callId: "call-1", commands: { ...search, response_length: "short" } }]);
	assert.equal(JSON.stringify(result).includes("cipher-only-in-memory"), false);
	assert.equal(JSON.stringify(result).includes("never-return"), false);
	assert.equal(s.requests.length, 2);
	const [first, second] = s.requests.map(entry => entry.request);
	assert.equal(first.tools, undefined);
	assert.equal(first.input[0].type, "additional_tools");
	const namespace = (first.input[0].tools as any[])[0];
	assert.equal(namespace.type, "namespace");
	assert.equal(namespace.name, "web");
	assert.equal(namespace.tools[0].name, "run");
	assert.equal(namespace.tools[0].strict, false);
	assert.deepEqual(first.input[0].tools, WEB_TOOLS);
	assert.equal(first.input[1].role, "developer");
	assert.equal(first.parallel_tool_calls, false);
	assert.equal(first.store, false);
	assert.equal(first.service_tier, undefined);
	assert.deepEqual(first.reasoning, { effort: "medium", context: "all_turns" });
	assert.deepEqual(second.input.slice(first.input.length), [reasoning, webCall, { type: "function_call_output", call_id: "call-1", output: [{ type: "input_text", text: "Source content" }] }]);
	assert.deepEqual(s.alpha[0].settings, { external_web_access: false });
	assert.equal("reasoning" in s.alpha[0], false);
	assert.equal("service_tier" in s.alpha[0], false);
	assert.equal(s.requests[0].options?.preparedOwner, "fake-owner");
	assert.deepEqual(s.counts, { begin: 1, end: 1, dispose: 1 });
});

test("all three native access modes, requested detail and exact URL open", async () => {
	for (const [mode, external] of [["cached", false], ["live", true], ["indexed", "indexed"]] as const) {
		const url = "https://example.com/page";
		const s = await setup([events(call({ open: [{ ref_id: url }] })), events(message())]);
		const result = await researchTarget({ ...s.options, mode, responseLength: "long", target: { kind: "url", value: url, focus: "Verify details" } });
		assert.equal(result.status, "ok");
		assert.deepEqual(s.alpha[0].settings, { external_web_access: external });
		assert.deepEqual(s.alpha[0].commands, { open: [{ ref_id: url }], response_length: "long" });
	}
});

test("memory-only and unrelated URL work cannot succeed", async () => {
	const s = await setup([events(message())]);
	assert.equal((await researchTarget(s.options)).error?.code, "no_web_evidence");
	assert.equal(s.alpha.length, 0);
	const url = await setup();
	assert.equal((await researchTarget({ ...url.options, target: { kind: "url", value: "https://example.com/page" } })).error?.code, "wrong_url");
	assert.equal(url.alpha.length, 0);
	assert.equal(url.counts.dispose, 1);
});

test("empty alpha output, empty summary and unsourced final answer fail honestly", async () => {
	const emptyAlpha = await setup();
	emptyAlpha.options.network!.fetch = (async () => Response.json({ output: "" })) as typeof fetch;
	assert.equal((await researchTarget(emptyAlpha.options)).error?.code, "no_web_evidence");
	for (const [text, code] of [["", "empty_summary"], ["No supporting link.", "no_sources"]]) {
		const s = await setup([events(call(search)), events(message(text, []))]);
		const result = await researchTarget(s.options);
		assert.equal(result.error?.code, code);
		assert.equal(result.summary, "");
	}
});

test("completed calls only, permitted namespace only, valid arguments only", async () => {
	for (const bad of [call(search, "x", { namespace: "functions" }), call(search, "x", { status: "in_progress" }), call(search, "x", { type: "custom_tool_call" }), call(search, "x", { name: "bash" }), call({ fetch: [{ url: "https://example.com" }] }), ...["image_query", "screenshot", "finance", "weather", "sports", "time"].map(name => call({ ...search, [name]: [{}] }))]) {
		const s = await setup([events(bad)]);
		const result = await researchTarget(s.options);
		assert.equal(result.status, "error");
		assert.equal(s.alpha.length, 0);
		assert.equal(s.counts.dispose, 1);
	}
	const added = await setup([[{ type: "response.output_item.added", item: call(search), output_index: 0 }, { type: "response.completed" }]]);
	assert.equal((await researchTarget(added.options)).error?.code, "no_web_evidence");
});

test("native command validation rejects malformed fields without widening web capabilities", () => {
	for (const input of [null, {}, [], { search_query: [] }, { search_query: [{ q: "" }] }, { open: [{ ref_id: "x", lineno: -1 }] }, { click: [{ ref_id: "x", id: 1.5 }] }, { find: [{ ref_id: "x" }] }, { open: [{ ref_id: "x", num_lines: 5 }] }, { response_length: "huge", ...search }, { search_query: Array.from({ length: 5 }, () => ({ q: "q" })) }]) assert.throws(() => parseCommands(JSON.stringify(input), "short"), /invalid_commands/);
	assert.throws(() => parseCommands("{", "short"), /invalid_commands/);
	assert.deepEqual(parseCommands(JSON.stringify({ search_query: [{ q: "q", recency: 0, domains: ["example.com"] }], click: [{ ref_id: "r", id: 2 }], find: [{ ref_id: "r", pattern: "p" }] }), "medium").response_length, "medium");
});

test("native per-call response length overrides the CLI default for four queries", async () => {
	const search_query = Array.from({ length: 4 }, (_, index) => ({ q: `query ${index}` }));
	for (const response_length of ["medium", "long"] as const) {
		const commands = { search_query, response_length };
		assert.deepEqual(parseCommands(JSON.stringify(commands), "short"), commands);
		const s = await setup([events(call(commands)), events(message())]);
		const result = await researchTarget(s.options);
		assert.equal(result.status, "ok");
		assert.equal(result.responseLength, "short");
		assert.deepEqual(s.alpha[0].commands, commands);
	}
	for (const commands of [{ search_query }, { search_query, response_length: "short" }]) assert.throws(() => parseCommands(JSON.stringify(commands), "short"), /invalid_commands/);
	assert.deepEqual(parseCommands(JSON.stringify({ ...search, response_length: "short" }), "long").response_length, "short");
});

test("Markdown destinations preserve balanced, escaped and angle-bracket parentheses", async () => {
	for (const [text, url] of [
		["[Pi](https://en.wikipedia.org/wiki/Pi_(letter))", "https://en.wikipedia.org/wiki/Pi_(letter)"],
		["[Nested](https://example.com/a_(b_(c)))", "https://example.com/a_(b_(c))"],
		[String.raw`[Escaped](https://example.com/a_\(b\))`, "https://example.com/a_(b)"],
		["[Angle](<https://example.com/a_(b)> \"Source title\")", "https://example.com/a_(b)"],
		["[Angle](<https://example.com/a_(>)", "https://example.com/a_("],
		["[Titled](https://en.wikipedia.org/wiki/Pi_(letter) \"Pi article\")", "https://en.wikipedia.org/wiki/Pi_(letter)"],
	]) {
		const s = await setup([events(call(search)), events(message(text, []))]);
		const result = await researchTarget(s.options);
		assert.equal(result.status, "ok", text);
		assert.deepEqual(result.sources, [{ url }], text);
	}
	const adjacent = await setup([events(call(search)), events(message("[One](https://example.com/a_(b))[Two](https://example.com/c_(d))", []))]);
	assert.deepEqual((await researchTarget(adjacent.options)).sources, [{ url: "https://example.com/a_(b)" }, { url: "https://example.com/c_(d)" }]);
});

test("loop, call and byte budgets stop repeated research and dispose", async () => {
	for (const override of [{ maxRounds: 1 }, { maxWebCalls: 1 }]) {
		const s = await setup([events(call(search)), events(call(search, "call-2"))]);
		assert.equal((await researchTarget({ ...s.options, ...override })).error?.code, "limit_exceeded");
		assert.equal(s.counts.dispose, 1);
	}
	const duplicate = await setup([events(call(search)), events(call(search))]);
	assert.equal((await researchTarget(duplicate.options)).error?.code, "limit_exceeded");
	const oversized = await setup();
	assert.equal((await researchTarget({ ...oversized.options, maxBytes: 20 })).error?.code, "limit_exceeded");
	assert.equal(oversized.requests.length, 0);
});

test("invalid target/model/effort fail before auth or network", async () => {
	for (const override of [{ model: "unknown-model" }, { effort: "off" }, { timeoutMs: 0 }, { target: { kind: "url", value: "file:///tmp/x" } }, { target: { kind: "query", value: " " } }]) {
		const s = await setup();
		let reads = 0;
		s.options.credentialStore = { ...s.store, read: async () => { reads++; throw new Error("do not read"); } } as any;
		assert.equal((await researchTarget({ ...s.options, ...override } as ResearchTargetOptions)).error?.code, "invalid_input");
		assert.equal(reads, 0);
		assert.equal(s.requests.length, 0);
	}
});

test("abort before start and while streaming, timeout and cleanup", async () => {
	const before = await setup();
	const controller = new AbortController(); controller.abort("fake-secret");
	assert.equal((await researchTarget({ ...before.options, signal: controller.signal })).error?.code, "aborted");
	assert.equal(before.requests.length, 0);
	for (const timeout of [false, true]) {
		const s = await setup();
		const abort = new AbortController();
		s.transport.sendRaw = async function* () {
			if (!timeout) abort.abort("fake-secret");
			await new Promise(() => undefined);
		};
		const result = await researchTarget({ ...s.options, signal: abort.signal, timeoutMs: 10 });
		assert.equal(result.error?.code, timeout ? "timeout" : "aborted");
		assert.equal(JSON.stringify(result).includes("fake-secret"), false);
		assert.equal(s.counts.dispose, 1);
	}
});

test("abort during alpha and owner changes do not produce a successful result", async () => {
	const s = await setup();
	const controller = new AbortController();
	s.options.network!.fetch = (async () => { controller.abort(); return new Promise(() => undefined); }) as typeof fetch;
	assert.equal((await researchTarget({ ...s.options, signal: controller.signal })).error?.code, "aborted");
	assert.equal(s.counts.dispose, 1);
	const owner = await setup();
	owner.onSend(() => { void owner.store.modify("openai-codex", async current => ({ ...current, accountId: "another-owner" }) as any); });
	assert.equal((await researchTarget(owner.options)).error?.code, "authentication_failed");
	assert.equal(owner.alpha.length, 0);
});

test("raw completed response output fallback, Unicode and unknown citations survive", async () => {
	const raw = message("Документ: [страница](https://example.com/путь).", [{ type: "future_citation", data: { unicode: "текст" } }]);
	const s = await setup([events(call(search)), [{ type: "response.completed", response: { output: [raw] } }]]);
	const result = await researchTarget(s.options);
	assert.equal(result.status, "ok");
	assert.equal(result.summary, raw.content[0].text);
	assert.deepEqual(result.citations, raw.content[0].annotations);
	assert.deepEqual(result.sources, [{ url: "https://example.com/%D0%BF%D1%83%D1%82%D1%8C" }]);
});

test("actual CodexThreadTransport SSE seam uses native replay without Fast or installation file access", async () => {
	const s = await setup();
	delete s.options.network!.createTransport;
	const sent: any[] = [];
	const scripts = [events(call(search)), events(message())];
	s.options.network!.transportDependencies = {
		postEvents: ((args: any) => {
			sent.push({ body: JSON.parse(zstdDecompressSync(args.body).toString()), headers: args.headers });
			return (async function* () { args.onResponse({ status: 200, headers: {} }); for (const value of scripts.shift() ?? []) yield { text: JSON.stringify(value), value }; })();
		}) as any,
	};
	// An injected 426 follows the real typed native fallback path.
	const { SocketError } = await import("../websocket.ts");
	s.options.network!.transportDependencies.connect = async () => { throw new SocketError(426, {}, "upgrade", "upgrade-rejected"); };
	const result = await researchTarget(s.options);
	assert.equal(result.status, "ok", JSON.stringify(result.error));
	assert.equal(sent.length, 2);
	for (const entry of sent) {
		assert.equal(entry.body.service_tier, undefined);
		assert.equal(new Headers(entry.headers).has("service_tier"), false);
		assert.equal(entry.body.store, false);
		assert.equal(entry.body.input[0].type, "additional_tools");
	}
});

test("a missing, expired or rejected saved login gives the refresh-in-Pi hint, not a blind retry, and leaks nothing", async () => {
	const SECRET = "fake-secret-body";
	const readOnly = (store: InMemoryCredentialStore): InMemoryCredentialStore => {
		store.modify = (async () => { throw new Error(SECRET); }) as typeof store.modify;
		return store;
	};
	const expired = async () => {
		const s = await setup();
		const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
		const access = `${part({ alg: "none" })}.${part({ exp: 1_000 })}.fake`;
		await s.store.modify("openai-codex", async () => ({ type: "oauth", access, refresh: "fake-refresh", expires: 1_000_000, accountId: "fake-owner" }));
		readOnly(s.store);
		return s;
	};
	const rejected = async () => {
		const s = await setup();
		readOnly(s.store);
		s.options.network!.fetch = (async () => new Response(SECRET, { status: 401 })) as typeof fetch;
		return s;
	};
	const missing = async () => {
		const s = await setup();
		s.options.credentialStore = new InMemoryCredentialStore();
		return s;
	};
	for (const make of [missing, expired, rejected]) {
		const s = await make();
		const result = await researchTarget(s.options);
		assert.equal(result.status, "error");
		assert.equal(result.error?.code, "authentication_failed");
		assert.equal(result.error?.message, AUTH_REFRESH_MESSAGE);
		assert.match(result.error!.message, /use Pi or run \/login openai-codex, then repeat the command/);
		assert.doesNotMatch(result.error!.message, /could not be recovered|Retry;/);
		assert.equal(JSON.stringify(result).includes(SECRET), false);
		assert.equal(JSON.stringify(result).includes("fake-refresh"), false);
	}
});

});
