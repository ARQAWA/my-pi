// Offline-only CLI fixture. These providers never use credentials or a transport.
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	const main = fauxProvider({ provider: "review-cli", models: [{ id: "main" }] });
	const reviewer = fauxProvider({ provider: "anthropic", models: [
		{ id: "claude-haiku-5-5", reasoning: true },
		{ id: "claude-sonnet-5-5", reasoning: true },
	] });
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
		return fauxAssistantMessage(fauxText("CLEAN"));
	}]);
	pi.registerProvider(main.provider as any);
	pi.registerProvider(reviewer.provider as any);
}
