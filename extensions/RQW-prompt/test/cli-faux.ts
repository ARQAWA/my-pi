import { fauxAssistantMessage, fauxProvider, getCurrentSystemPrompt, getCurrentTools } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	const faux = fauxProvider({ provider: "openai-codex", models: [{ id: "gpt-6.1-sol", reasoning: true }] });
	faux.provider.auth.apiKey = { name: "Faux only", resolve: async () => ({ auth: { apiKey: "faux-only" } }) };
	faux.setResponses([(context, _options, _state, model) => fauxAssistantMessage(JSON.stringify({
		prompt: getCurrentSystemPrompt(context.messages),
		tools: getCurrentTools(context.messages).map(tool => tool.name),
		model: `${model.provider}/${model.id}`,
		systemMessages: context.messages.filter(message => message.role === "system"),
	}))]);
	pi.registerProvider(faux.provider);
}
