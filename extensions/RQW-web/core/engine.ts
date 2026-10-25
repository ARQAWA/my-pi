// Adapted from cli/web/engine.ts at git a85b810e924010f35387045fc0cbbd9a1e7173cc.
import { researchTarget } from "./web-engine.ts";
import { createReadOnlyCredentialStore } from "./credentials.ts";
import type { TargetRunner } from "./types.ts";

/** The real runner: the native search engine with the read-only saved login. Loaded only when a search is made. */
export function createEngineRunner(authPath?: string): TargetRunner {
	const credentialStore = createReadOnlyCredentialStore(authPath);
	return run => researchTarget({
		target: run.target,
		model: run.model,
		effort: run.effort,
		mode: run.mode,
		responseLength: run.responseLength,
		timeoutMs: run.timeoutMs,
		signal: run.signal,
		credentialStore,
	});
}
