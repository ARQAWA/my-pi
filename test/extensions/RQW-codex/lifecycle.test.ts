import assert from "node:assert/strict";
import { it } from "node:test";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";
import { bindSession } from "../../../extensions/RQW-codex/lifecycle.ts";
import { CODEX_RETRY_OWNED_DIAGNOSTIC } from "../../../extensions/RQW-codex/retry.ts";

it("regression: owned summary failures reject before Pi retries them", async () => {
	let listener: (event: { type: string }) => void = () => undefined;
	const message = { role: "assistant", stopReason: "error", provider: "openai-codex", api: "openai-codex-responses", errorMessage: "exhausted", diagnostics: [{ type: CODEX_RETRY_OWNED_DIAGNOSTIC }] };
	const session = {
		sessionId: "root",
		agent: { streamFunction: async () => ({ result: async () => message }) },
		subscribe(fn: typeof listener) { listener = fn; return () => undefined; },
		dispose() {},
		_isRetryableError() { return true; },
	} as unknown as AgentSession;
	const release = bindSession(session, { beginRun() {}, endRun() {}, release() {} });
	listener({ type: "compaction_start" });
	assert.equal((session as any)._isRetryableError(message), false);
	const model = { provider: "openai-codex", api: "openai-codex-responses" } as Model<Api>;
	const stream = await session.agent.streamFunction(model, { messages: [{ role: "user", content: "Summarize" }] } as never, { cacheRetention: "none", sessionId: "summary" } as never);
	await assert.rejects(stream.result(), /Summarization failed: exhausted/);
	release();
});
