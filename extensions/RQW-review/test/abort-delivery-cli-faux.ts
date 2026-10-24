// Earlier public lifecycle hook reproduces the native abort-to-idle window without SDK patches.
import assert from "node:assert/strict";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage as answer, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";

export default function (pi: ExtensionAPI) {
	const release = Promise.withResolvers<void>();
	const busy = Promise.withResolvers<void>();
	const main = fauxProvider({ provider: "review-abort-delivery-cli", models: [{ id: "main" }] });
	const reviewer = fauxProvider({ provider: "openai-codex", models: [{ id: "gpt-6.1-sol", reasoning: true }] });
	let mainCount = 0, reviewCount = 0;
	const args = { level: "blind", object: "fixture", criterion: "c" };
	main.setResponses(Array.from({ length: 20 }, () => async (context, options) => {
		process.stderr.write(`AUDIT_MAIN_REQUEST:${++mainCount}\n`);
		if (mainCount === 1) return answer([fauxToolCall("review", args, { id: "one" }), fauxToolCall("review", args, { id: "two" })], { stopReason: "toolUse" });
		if (mainCount === 2) {
			process.stderr.write("AUDIT_MAIN_BUSY\n");
			options?.signal?.addEventListener("abort", () => busy.resolve(), { once: true });
			await busy.promise;
			return answer("ABORTED_BUSY");
		}
		const body = JSON.stringify(context.messages);
		assert.ok(body.includes("[review#1] R1") && body.includes("[review#2] R2"));
		return answer("VERDICTS_RECEIVED");
	}));
	reviewer.setResponses(Array.from({ length: 2 }, () => async () => {
		const n = ++reviewCount;
		await release.promise;
		return answer(`R${n}`);
	}));
	pi.registerProvider(main.provider);
	pi.registerProvider(reviewer.provider);
	pi.on("agent_settled", async event => {
		if (!event.aborted) return;
		release.resolve();
		for (let n = 0; n < 100; n++) await new Promise<void>(resolve => setImmediate(resolve));
	});
}
