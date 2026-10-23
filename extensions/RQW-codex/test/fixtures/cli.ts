// Test-only Pi extension for cli.test.ts. Loaded with -e into the real bundled Pi CLI, together with RQW-codex only.
// The owned Codex extension gets a refused WebSocket connector and a fake SSE postEvents: no network. Every owned
// request body is captured as one JSON line in RQW_CODEX_CLI_CAPTURE. Every before_provider_request call is captured
// as a safe shape only (generate flag and whether tool output is present), never the payload itself.
// RQW_CODEX_CLI_HOOK=priority also sets service_tier priority in that hook. Nothing here is loaded by the product.
import { appendFileSync } from "node:fs";
import * as zlib from "node:zlib";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { createCodexExtension } from "../../index.ts";
import { SocketError } from "../../websocket.ts";

const CAPTURE = process.env.RQW_CODEX_CLI_CAPTURE ?? "";
const READ_PATH = process.env.RQW_CODEX_CLI_READ_PATH ?? "";
const HOOK = process.env.RQW_CODEX_CLI_HOOK ?? "none";
const CALL_ID = "call_cli_1";

const completed = (id: string) => ({
	type: "response.completed",
	response: { id, status: "completed", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } },
});

/** Turn one: a native function_call for read(path) with the raw argument string. */
function callEvents(id: string, args: string) {
	const item = `fc_${CALL_ID}`;
	return [
		{ type: "response.created", response: { id } },
		{ type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: item, call_id: CALL_ID, name: "read", arguments: "", status: "in_progress" } },
		{ type: "response.function_call_arguments.delta", item_id: item, output_index: 0, delta: args },
		{ type: "response.function_call_arguments.done", item_id: item, output_index: 0, arguments: args },
		{ type: "response.output_item.done", output_index: 0, item: { type: "function_call", id: item, call_id: CALL_ID, name: "read", arguments: args, status: "completed" } },
		completed(id),
	];
}

/** Turn two: the final assistant text. */
function textEvents(id: string, text: string) {
	const item = `msg_${id}`;
	return [
		{ type: "response.created", response: { id } },
		{ type: "response.output_item.added", output_index: 0, item: { type: "message", id: item, role: "assistant", content: [], status: "in_progress" } },
		{ type: "response.output_text.delta", item_id: item, output_index: 0, content_index: 0, delta: text },
		{ type: "response.output_item.done", output_index: 0, item: { type: "message", id: item, role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] } },
		completed(id),
	];
}

/** Refused WebSocket upgrade: the native response head is reported, then the connect fails, so only SSE carries turns. */
const upgradeRefused = async (options: { onResponse: (response: { status: number; headers: object }) => void }): Promise<never> => {
	options.onResponse({ status: 426, headers: {} });
	throw new SocketError(426, {}, "upgrade required", "upgrade-rejected");
};

const throwingFetch = async (input: string): Promise<never> => {
	throw new Error(`fixture fetch blocked: ${input}`);
};

/** Fake SSE: the first request gets the read call, a request carrying function_call_output gets the final text. */
const postEvents = (options: { url: string; body: Uint8Array; onResponse: (response: { status: number; headers: object }) => void }) => {
	const body = JSON.parse(zlib.zstdDecompressSync(Buffer.from(options.body)).toString("utf8")) as { input: Array<{ type?: string }> };
	appendFileSync(CAPTURE, `${JSON.stringify({ kind: "post", url: options.url, body })}\n`);
	const answered = body.input.some((item) => item.type === "function_call_output");
	const events = answered ? textEvents("resp_cli_2", "CLI CODEX OK") : callEvents("resp_cli_1", JSON.stringify({ path: READ_PATH }));
	return (async function* () {
		options.onResponse({ status: 200, headers: {} });
		for (const value of events) yield { text: JSON.stringify(value), value };
	})();
};

export default function rqwCodexCliFixture(pi: ExtensionAPI): void {
	createCodexExtension({
		agentDir: process.env.PI_CODING_AGENT_DIR,
		dependencies: { connect: upgradeRefused as never, postEvents: postEvents as never, fetch: throwingFetch as never },
	})(pi);
	pi.on("before_provider_request", (event) => {
		const payload = event.payload as Record<string, unknown>;
		const input = Array.isArray(payload.input) ? (payload.input as Array<{ type?: string }>) : [];
		appendFileSync(CAPTURE, `${JSON.stringify({
			kind: "hook",
			generate: payload.generate === false ? false : null,
			hasToolOutput: input.some((item) => item.type === "function_call_output"),
		})}\n`);
		if (HOOK !== "priority") return undefined;
		return { ...payload, service_tier: "priority" };
	});
}
