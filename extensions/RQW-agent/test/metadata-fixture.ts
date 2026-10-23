// Worker runs for the metadata and count tests: a faux anthropic provider answers code_writer and shell_runner.
// No Pi method is mocked: the provider is registered through the runtime, and its credential is an isolated fake key
// set with setRuntimeApiKey (in memory, never the owner's auth). Every reply is scripted, else "done".
import { fauxProvider, type AssistantMessage, type SimpleStreamOptions, type TranscriptContext } from "@earendil-works/pi-ai";
import { answer, type fixture } from "./audit-fixture.ts";

export type WorkerReply = AssistantMessage | ((context: TranscriptContext, options?: SimpleStreamOptions) => Promise<AssistantMessage>);

/** Registers the faux anthropic worker model, gives it a fake runtime key, and returns the queue of scripted worker replies. */
export async function withWorkers(f: Awaited<ReturnType<typeof fixture>>): Promise<WorkerReply[]> {
	const replies: WorkerReply[] = [];
	const faux = fauxProvider({ provider: "anthropic", api: "rqw-agent-worker-faux", models: [{ id: "claude-haiku-5-5", reasoning: true }] });
	faux.setResponses(Array.from({ length: 30 }, () => async (context: TranscriptContext, options?: SimpleStreamOptions) => {
		const next = replies.shift();
		return typeof next === "function" ? await next(context, options) : next ?? answer("done");
	}));
	f.runtime.registerNativeProvider(faux.provider);
	await f.runtime.setRuntimeApiKey("anthropic", "fake-metadata-key");
	await f.runtime.getAvailable();
	return replies;
}
