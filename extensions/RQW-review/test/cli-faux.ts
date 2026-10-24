// Offline-only CLI fixture. These providers never use credentials or a transport.
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { CLEAN_VERDICT } from "./codex-wire.ts";

export default function (pi: ExtensionAPI) {
	const main = fauxProvider({ provider: "review-cli", models: [{ id: "main" }] });
	const reviewer = fauxProvider({ provider: "openai-codex", models: [{ id: "gpt-6.1-sol", reasoning: true }] });
	const mainReplied = Promise.withResolvers<void>();
	main.setResponses([
		fauxAssistantMessage(fauxToolCall("review", { level: "blind", object: "fixture", criterion: "c" }, { id: "r1" }), { stopReason: "toolUse" }),
		() => {
			mainReplied.resolve();
			return fauxAssistantMessage(fauxText("started"));
		},
		(context) => {
			const text = JSON.stringify(context.messages);
			if (!text.includes("[review#1] CLEAN")) throw new Error("missing review verdict");
			return fauxAssistantMessage(fauxText("VERDICT_RECEIVED"));
		},
	]);
	reviewer.setResponses([async () => {
		await mainReplied.promise;
		return fauxAssistantMessage(fauxText(CLEAN_VERDICT));
	}]);
	pi.registerProvider(main.provider as any);
	pi.registerProvider(reviewer.provider as any);
}
