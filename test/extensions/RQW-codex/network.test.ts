import assert from "node:assert/strict";
import { it } from "node:test";
import { postEvents } from "../../../extensions/RQW-codex/sse.ts";

it("SSE posts the body and yields parsed events", async () => {
	const body = new TextEncoder().encode('{"model":"m","input":[]}');
	let request: { url: string; init: RequestInit } | undefined;
	const chunks = [
		'data: {"type":"response.cre',
		'ated"}\r\n\r\n',
		'data: {"type":"response.output_text.delta","delta":"hi"}\n\n',
		'data: {"type":"response.completed","response":{"id":"r1"}}\n\n',
	];
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
			controller.close();
		},
	});
	const events = postEvents({
		url: "https://chatgpt.com/backend-api/codex/responses",
		headers: {},
		body,
		signal: new AbortController().signal,
		onResponse: () => undefined,
		fetch: (async (url: string, init: RequestInit) => {
			request = { url, init };
			return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
		}) as never,
	});
	const types: string[] = [];
	for await (const event of events) types.push(event.value.type as string);
	assert.deepEqual(types, ["response.created", "response.output_text.delta", "response.completed"]);
	assert.equal(request?.init.method, "POST");
	assert.equal(request?.init.body, body);
});
