import "./recovery-offline.mjs";
import assert from "node:assert/strict";
import { it } from "node:test";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { TOKEN_URL } from "../auth.ts";
import { entries } from "./pi-entrypoints.ts";
import { ACCESS, NEXT, model, setup, refreshed, within, start, textEvents, finish, response, type RecoveryFixture } from "./recovery-fixtures.ts";

// Native completeSummarization awaits result() inside retryAssistantCall; partial summary text is internal.
// _getSummarizationRequestAuth forwards resolved OAuth as apiKey/env before the runtime resolves it again.
const settings = { retry: { enabled: true, maxRetries: 1, baseDelayMs: 1 }, compaction: { keepRecentTokens: 32 } };
const overloaded = { type: "error", error: { type: "overloaded_error", message: "Overloaded fixture" } };
function seed(active: RecoveryFixture) {
	const assistant: AssistantMessage = { role: "assistant", api: model.api, provider: model.provider, model: model.id,
		content: [{ type: "text", text: "Old answer" }], stopReason: "stop", timestamp: 2,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
	const messages = [{ role: "user" as const, content: "Old request ".repeat(40), timestamp: 1 }, assistant,
		{ role: "user" as const, content: "Retained request ".repeat(80), timestamp: 3 }];
	const ids = messages.map(message => active.session.sessionManager.appendMessage(message));
	active.session.agent.state.messages = messages;
	return ids[0];
}

for (const [label, entry] of entries) {
	for (const kind of ["compact", "bug report", "branch"] as const) {
		it(`${label} actual ${kind}: native OAuth handoff recovers HTTP 401 once`, async () => {
			const active = await setup(settings, entry), root = seed(active), previous = globalThis.fetch;
			const sent: string[] = [];
			let refreshes = 0, retries = 0;
			active.session.subscribe(event => { if (event.type === "summarization_retry_scheduled") retries++; });
			try {
				globalThis.fetch = async (input, init) => {
					if (String(input) === TOKEN_URL) { refreshes++; return refreshed(); }
					const bearer = new Headers(init?.headers).get("authorization")!; sent.push(bearer);
					return bearer === `Bearer ${ACCESS}` ? new Response("expired", { status: 401 }) : response([...textEvents, ...finish]);
				};
				await within(kind === "compact" ? active.session.compact() : kind === "bug report" ? active.session.summarizeForBugReport({}) :
					active.session.navigateTree(root, { summarize: true }), 5000);
				assert.deepEqual(sent, [ACCESS, NEXT].map(token => `Bearer ${token}`));
				assert.equal(refreshes, 1); assert.equal(retries, 0);
				assert.equal((await active.store.read("anthropic"))?.access, NEXT);
			} finally { globalThis.fetch = previous; active.session.dispose(); }
		});
	}

	it(`${label}: internal partial summary keeps stock transient retry and publishes only the finished summary`, async () => {
		const callbacks = Object.getOwnPropertyDescriptor(entry.AgentSession.prototype, "_summarizationRetryCallbacks");
		for (const overlay of [false, true]) {
			const active = await setup(settings, entry); seed(active);
			if (!overlay) active.runtime.unregisterProvider("anthropic");
			const previous = globalThis.fetch;
			let calls = 0, visibleDeltas = 0;
			const progress: string[] = [];
			active.session.subscribe(event => {
				if (event.type === "message_update") visibleDeltas++;
				if (event.type.startsWith("summarization_retry_")) progress.push(event.type);
			});
			try {
				assert.deepEqual(Object.getOwnPropertyDescriptor(entry.AgentSession.prototype, "_summarizationRetryCallbacks"), callbacks);
				globalThis.fetch = async () => ++calls === 1 ? response([...textEvents, overloaded]) : response([
					start, { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
					{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "FINISHED SUMMARY" } },
					{ type: "content_block_stop", index: 0 }, ...finish]);
				const result = await within(active.session.compact(), 5000);
				assert.equal(calls, 2); assert.equal(visibleDeltas, 0);
				assert.ok(result.summary.includes("FINISHED SUMMARY")); assert.ok(!result.summary.includes("PARTIAL"));
				assert.deepEqual(progress, ["summarization_retry_scheduled", "summarization_retry_attempt_start", "summarization_retry_finished"]);
				const compactions = active.session.sessionManager.getEntries().filter(item => item.type === "compaction");
				assert.equal(compactions.length, 1);
				assert.equal(compactions[0].summary, result.summary);
			} finally { globalThis.fetch = previous; active.session.dispose(); }
		}
	});
}
