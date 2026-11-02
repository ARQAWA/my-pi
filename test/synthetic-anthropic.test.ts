// RQW-anthropic in the synthetic world, wire mode: the real Pi, the real extension and its real transport. Only the outside is
// faked: `fetch` answers the routes of api.anthropic.com, so a request goes through signing, 401 recovery and the retry hints.
import assert from "node:assert/strict";
import { after, it, type TestContext } from "node:test";
import type { CredentialStore, OAuthCredential } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { reportTimings, world, type WorldOptions } from "./synthetic/world.ts";

after(() => reportTimings(import.meta.filename));

const OLD = "sk-ant-oat01-fake-old";
const NEXT = "sk-ant-oat01-fake-new";
const MESSAGES = "https://api.anthropic.com/v1/messages";
const TOKEN = "https://api.anthropic.com/v1/oauth/token";
const SONNET: WorldOptions = { model: "anthropic/claude-sonnet-5-5", thinking: "medium" };

const stockStream = Object.getOwnPropertyDescriptor(ModelRuntime.prototype, "streamSimple")!;

/**
 * The world answers model requests from its script. Wire mode needs Pi's own request path instead, so the world's
 * replacement of `ModelRuntime.prototype.streamSimple` is ignored and the extension wraps the stock method, as in the product.
 */
async function wireWorld(t: TestContext, options: WorldOptions) {
	const prototype = ModelRuntime.prototype;
	const giveBack = () => { Object.defineProperty(prototype, "streamSimple", stockStream); };
	Object.defineProperty(prototype, "streamSimple", { configurable: true, get: () => stockStream.value, set: giveBack });
	t.after(giveBack);
	const w = await world(t, options);
	t.after(giveBack);
	// The saved login must look like a subscription token, or the SDK would send it as an API key.
	await credentials(w).modify("anthropic", async () => ({ type: "oauth", access: OLD, refresh: "fake-refresh", expires: 4_102_444_800_000 }) as never);
	return w;
}

/** The world's in-memory login store; Pi keeps it private. */
const credentials = (w: { session: { modelRuntime: unknown } }) => (w.session.modelRuntime as { credentials: CredentialStore }).credentials;

const sse = (events: Record<string, unknown>[]) => new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), {
	headers: { "content-type": "text/event-stream" },
});

const answer = (content: string) => sse([
	{ type: "message_start", message: { id: "fake", model: "claude", usage: { input_tokens: 1, output_tokens: 0 } } },
	{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
	{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: content } },
	{ type: "content_block_stop", index: 0 },
	{ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } },
	{ type: "message_stop" },
]);

const rejection = (status: number, type: string, headers: Record<string, string>) =>
	Response.json({ type: "error", error: { type, message: "fake" } }, { status, headers });

interface Sent {
	headers: Headers;
	body: unknown;
}

let installed: unknown;

/** The routes of api.anthropic.com. Each inference request takes the next answer; session naming has an answer of its own. */
function routes() {
	const answers: (() => Response)[] = [];
	const inference: Sent[] = [];
	const refreshes: unknown[] = [];
	const stray: string[] = [];
	installed = globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input instanceof Request ? input.url : input);
		const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
		if (url === TOKEN) {
			refreshes.push(body);
			return Response.json({ access_token: NEXT, refresh_token: "fake-rotated", expires_in: 3600 });
		}
		if (url.startsWith(MESSAGES)) {
			if (JSON.stringify(body).includes("You name chat sessions.")) return answer('["Greeting"]');
			inference.push({ headers: new Headers(init?.headers), body });
			const next = answers.shift();
			if (next) return next();
		}
		stray.push(url);
		throw new Error(`synthetic anthropic: no route for ${url}`);
	}) as typeof fetch;
	return { answers, inference, refreshes, stray };
}

after(() => {
	assert.notEqual(globalThis.fetch, installed, "the fake routes are given back");
	assert.equal(Object.getOwnPropertyDescriptor(ModelRuntime.prototype, "streamSimple")?.value, stockStream.value, "Pi's own request path is given back");
});

const lastAssistant = (w: Awaited<ReturnType<typeof wireWorld>>) =>
	w.jsonl().filter((entry) => entry.type === "message" && entry.message.role === "assistant").at(-1).message;

it("a 429 the server marks final shows the no-retry warning and is not sent again", async (t) => {
	const w = await wireWorld(t, SONNET);
	const wire = routes();
	wire.answers.push(() => rejection(429, "rate_limit_error", { "x-should-retry": "false" }));
	await w.submit("hi");
	w.see("anthropic: no retry");
	assert.equal(wire.inference.length, 1);
	const message = lastAssistant(w);
	assert.equal(message.stopReason, "error");
	assert.equal(message.diagnostics.find((item: { type: string }) => item.type === "rqw_anthropic_http").details.status, 429);
	// The warning leaves the footer by itself after three seconds of the fake clock.
	await w.tick(3000);
	w.notSee("anthropic: no retry");
	assert.deepEqual([wire.stray, w.networkAttempts, w.processAttempts], [[], [], []]);
});

it("an expired token is refreshed once and the request goes again with the new one", async (t) => {
	const w = await wireWorld(t, SONNET);
	const wire = routes();
	wire.answers.push(() => new Response("expired", { status: 401 }), () => answer("hello again"));
	await w.submit("hi");
	w.see("hello again");
	assert.equal(wire.refreshes.length, 1);
	assert.deepEqual(wire.inference.map((sent) => sent.headers.get("authorization")), [`Bearer ${OLD}`, `Bearer ${NEXT}`]);
	assert.match(wire.inference[1].headers.get("user-agent")!, /^claude-cli\//);
	const saved = await credentials(w).read("anthropic") as OAuthCredential;
	assert.equal(saved.access, NEXT);
	assert.equal(lastAssistant(w).stopReason, "stop");
	assert.deepEqual([wire.stray, w.networkAttempts, w.processAttempts], [[], [], []]);
});
