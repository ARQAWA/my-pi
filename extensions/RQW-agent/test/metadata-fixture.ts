// Faux ordinary agents for metadata, count and root integration tests. No network or saved credentials.
import { fauxProvider, type AssistantMessage, type SimpleStreamOptions, type TranscriptContext } from "@earendil-works/pi-ai";
import { answer, type fixture } from "./audit-fixture.ts";

export type AgentReply = AssistantMessage | ((context: TranscriptContext, options?: SimpleStreamOptions) => Promise<AssistantMessage>);

/** Registers a separate faux agent provider and returns its scripted replies. Start with model anthropic/metadata-agent. */
export async function withAgents(f: Awaited<ReturnType<typeof fixture>>): Promise<AgentReply[]> {
	const replies: AgentReply[] = [];
	const faux = fauxProvider({ provider: "anthropic", api: "rqw-agent-metadata-faux", models: [{ id: "metadata-agent", reasoning: true }] });
	faux.setResponses(Array.from({ length: 30 }, () => async (context: TranscriptContext, options?: SimpleStreamOptions) => {
		const next = replies.shift();
		return typeof next === "function" ? await next(context, options) : next ?? answer("done");
	}));
	f.runtime.registerNativeProvider(faux.provider);
	await f.runtime.setRuntimeApiKey("anthropic", "fake-metadata-key");
	await f.runtime.getAvailable();
	return replies;
}
