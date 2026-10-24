// Offline openai-codex wire for the real-provider tests: the real Pi provider runs, only the network is replaced.
// Pi's "auto" transport tries a WebSocket first, so a fake socket and a fake fetch both record each request body.
import zlib from "node:zlib";

/** The reviewer's complete clean verdict: a nonempty CHECKED section and no UNCHECKED. */
export const CLEAN_VERDICT = "CLEAN\nCHECKED:\n- criterion (source) fulfilled (object)";

export const jwt = ["e30", Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acct" } })).toString("base64url"), "sig"].join(".");
/** The auth.json content that makes the openai-codex provider available with fake credentials. */
export const codexAuth = () => ({ "openai-codex": { type: "oauth", access: jwt, refresh: "r", expires: Date.now() + 3_600_000 } });

const sse = (events: object[]) => events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
const eventsOf = (text: string): object[] => text.split("\n\n").filter(Boolean).map((block) => JSON.parse(block.slice(block.indexOf("data: ") + 6)));

export function codexAnswer(text: string): string {
	const message = { type: "message", id: "m1", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] };
	return sse([
		{ type: "response.output_item.added", item: { ...message, status: "in_progress", content: [] } },
		{ type: "response.content_part.added", part: { type: "output_text", text: "", annotations: [] } },
		{ type: "response.output_text.delta", delta: text },
		{ type: "response.output_item.done", item: message },
		{ type: "response.completed", response: { id: "r", status: "completed", output: [message], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
	]);
}

export type WireRequest = { url: string; body: Record<string, any> };

/** Replaces `fetch` and `WebSocket`; every request body lands in `wire`. Call `restore` in `after`. */
export function installCodexWire(reply: (body: Record<string, any>) => string = () => codexAnswer(CLEAN_VERDICT)) {
	const wire: WireRequest[] = [];
	const realFetch = globalThis.fetch;
	const realWebSocket = globalThis.WebSocket;
	class FakeWebSocket extends EventTarget {
		readyState = 0;
		url: string;
		constructor(url: string, _options?: unknown) {
			super();
			this.url = url;
			queueMicrotask(() => { this.readyState = 1; this.dispatchEvent(new Event("open")); });
		}
		send(data: string) {
			const { type: _type, ...body } = JSON.parse(data);
			wire.push({ url: this.url, body });
			queueMicrotask(() => { for (const event of eventsOf(reply(body))) this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(event) })); });
		}
		close() { this.readyState = 3; }
	}
	globalThis.WebSocket = FakeWebSocket as never;
	globalThis.fetch = async (input, init) => {
		const raw = new Headers(init?.headers).get("content-encoding") === "zstd"
			? zlib.zstdDecompressSync(init!.body as Uint8Array).toString() : String(init?.body);
		const body = JSON.parse(raw);
		wire.push({ url: String(input), body });
		return new Response(reply(body), { headers: { "content-type": "text/event-stream" } });
	};
	return { wire, restore() { globalThis.fetch = realFetch; globalThis.WebSocket = realWebSocket; } };
}
