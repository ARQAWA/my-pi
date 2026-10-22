import type { Api, Model } from "@earendil-works/pi-ai";
import type { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";

export type WorkerRole = "code_writer" | "shell_runner";

// Measured per model/role: notes/workers-bench.md, B4; decision: DECISIONS.md, Workers.
export const WORKER_REASONING = {
	"anthropic/claude-haiku-5-5": { code_writer: "low", shell_runner: "low" },
	"openai-codex/gpt-6-luna": { code_writer: "low", shell_runner: "medium" },
} as const;

export type WorkerModel = {
	model: Model<Api>;
	thinking: (typeof WORKER_REASONING)[keyof typeof WORKER_REASONING][WorkerRole];
};

type Registry = Pick<ModelRegistry, "find" | "hasConfiguredAuth">;

/** Use the caller's registry and credential runtime, just like agent's resolveConfig. */
export async function pickWorkerModel(registry: Registry, role: WorkerRole): Promise<WorkerModel | string> {
	// Pi 1.3.0's facade keeps the shared runtime in a field private only to TypeScript.
	const runtime = (registry as unknown as { runtime: ModelRuntime }).runtime;
	for (const key of Object.keys(WORKER_REASONING) as (keyof typeof WORKER_REASONING)[]) {
		const slash = key.indexOf("/");
		const model = registry.find(key.slice(0, slash), key.slice(slash + 1));
		if (!model) continue;
		// A configured-auth snapshot can lag behind a provider registration/OAuth refresh.
		let authenticated = registry.hasConfiguredAuth(model);
		if (!authenticated) {
			try { authenticated = await runtime.checkAuth(model.provider); }
			catch { continue; } // A broken provider must not disable the other subscription.
		}
		if (authenticated) return { model, thinking: WORKER_REASONING[key][role] };
	}
	return "No credentials for worker providers: anthropic (claude-haiku-5-5) or openai-codex (gpt-6-luna).";
}
