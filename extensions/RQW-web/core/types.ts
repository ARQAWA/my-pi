import type { TargetResult, WebMode, WebResponseLength, WebTarget, WebSource } from "./web-types.ts";

export type { TargetResult, WebMode, WebResponseLength, WebTarget, WebSource };

/** The exact search-loop model and effort chosen from the caller's model and thinking. */
export interface SearchPlan {
	model: string;
	effort: string;
}

export interface RunOptions {
	targets: WebTarget[];
	mode: WebMode;
	responseLength: WebResponseLength;
	search: SearchPlan;
}

/** One unit of work handed to the engine. The runner owns credentials, transport and cleanup. */
export interface TargetRun extends SearchPlan {
	target: WebTarget;
	mode: WebMode;
	responseLength: WebResponseLength;
	timeoutMs: number;
	signal: AbortSignal;
}

export type TargetRunner = (run: TargetRun) => Promise<TargetResult>;

/** A bad command line or an unsupported caller model: exit code 2, nothing is sent. */
export class UsageError extends Error {}
