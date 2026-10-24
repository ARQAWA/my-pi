import type { CredentialStore } from "@earendil-works/pi-ai";
import type { TransportDependencies, TransportOptions, SendRawOptions } from "./transport.ts";

export type WebMode = "cached" | "live" | "indexed";
export type WebResponseLength = "short" | "medium" | "long";
export type WebTarget = { kind: "query" | "url"; value: string; focus?: string };
export type WebCommands = {
	search_query?: { q: string; recency?: number; domains?: string[] }[];
	open?: { ref_id: string; lineno?: number }[];
	click?: { ref_id: string; id: number }[];
	find?: { ref_id: string; pattern: string }[];
	response_length?: WebResponseLength;
};

export interface WebTransport {
	beginTurn(info?: { turnId?: string }): void;
	endTurn(): void;
	dispose(): void;
	sendRaw(options: SendRawOptions): AsyncIterable<Record<string, unknown>>;
}

export interface ResearchTargetOptions {
	target: WebTarget;
	/** Exact already-mapped Codex slug and native effort, not caller-model routing. */
	model: string;
	effort: string;
	credentialStore: CredentialStore;
	mode?: WebMode;
	responseLength?: WebResponseLength;
	signal?: AbortSignal;
	timeoutMs?: number;
	maxRounds?: number;
	maxWebCalls?: number;
	maxBytes?: number;
	network?: {
		fetch?: typeof fetch;
		transportDependencies?: TransportDependencies;
		createTransport?: (options: TransportOptions) => WebTransport;
	};
}

export interface WebSource { url: string; title?: string }
export interface TargetResult {
	target: WebTarget;
	model: string;
	effort: string;
	mode: WebMode;
	responseLength: WebResponseLength;
	status: "ok" | "error";
	summary: string;
	sources: WebSource[];
	/** Opaque annotations and native actions are kept without closing their provider schemas. */
	citations: unknown[];
	actions: unknown[];
	results: unknown[];
	error?: { code: string; message: string };
}
