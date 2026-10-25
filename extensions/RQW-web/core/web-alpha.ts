// Adapted from extensions/RQW-codex/web-alpha.ts at git commit a85b810e924010f35387045fc0cbbd9a1e7173cc.
import type { CredentialStore } from "@earendil-works/pi-ai";
import { recoverCredential, resolveStoredCredential } from "../vendor/auth-boundary.ts";
import { AuthRecoveryError, credentialIdentity, PROVIDER_ID, validateCredential } from "../vendor/auth.ts";
import { CodexError, classifyHttp, classifyTransport } from "../vendor/errors.ts";
import { mergeHeaders } from "../vendor/headers.ts";
import { asciiJson, CODEX_ORIGINATOR, CODEX_VERSION, HEADER_TURN_METADATA, localPlatform, turnMetadataPayload, userAgent, type CodexIdentity } from "../vendor/metadata.ts";
import { HttpRetryPolicy, sleepAbortable, type InjectedSleep } from "../vendor/retry.ts";

export const WEB_SEARCH_ENDPOINT = "https://chatgpt.com/backend-api/codex/alpha/search";

export interface AlphaRequest {
	id: string;
	model: string;
	input?: unknown;
	commands: Record<string, unknown>;
	settings: { external_web_access: boolean | "indexed" };
	max_output_tokens?: number;
}

export interface AlphaResponse {
	output: string;
	results?: unknown[];
	encrypted_output?: string;
}

interface SearchOptions {
	credentialStore: CredentialStore;
	identity: CodexIdentity;
	signal: AbortSignal;
	ownerAccountId?: string;
	fetch?: typeof fetch;
	sleep?: InjectedSleep;
	maxBytes?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Reject values JSON.stringify would silently drop, coerce or replace through toJSON.
function requireJson(value: unknown, ancestors = new Set<object>()): void {
	if (value === null || typeof value === "string" || typeof value === "boolean") return;
	if (typeof value === "number" && Number.isFinite(value)) return;
	if (typeof value !== "object" || ancestors.has(value)) throw new Error();
	if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error();
	ancestors.add(value);
	if (Array.isArray(value)) {
		for (const item of value) requireJson(item, ancestors);
	} else {
		for (const item of Object.values(value)) requireJson(item, ancestors);
	}
	ancestors.delete(value);
}

function prepare(request: AlphaRequest): string {
	try {
		if (!isRecord(request) || typeof request.id !== "string" || !request.id.trim() || typeof request.model !== "string" || !request.model.trim()
			|| !isRecord(request.commands) || !isRecord(request.settings)
			|| ![true, false, "indexed"].includes(request.settings.external_web_access)
			|| (request.max_output_tokens !== undefined && (!Number.isSafeInteger(request.max_output_tokens) || request.max_output_tokens < 0))) throw new Error();
		const body = {
			id: request.id, model: request.model,
			...(request.input === undefined ? {} : { input: request.input }),
			commands: request.commands, settings: request.settings,
			...(request.max_output_tokens === undefined ? {} : { max_output_tokens: request.max_output_tokens }),
		};
		requireJson(body);
		return JSON.stringify(body);
	} catch {
		throw new Error("RQW-codex: invalid alpha/search request.");
	}
}

async function verifyOwner(options: SearchOptions, accountId: string): Promise<void> {
	try {
		const stored = await options.credentialStore.read(PROVIDER_ID, { signal: options.signal });
		if (credentialIdentity(validateCredential(stored)) !== accountId) throw new AuthRecoveryError();
	} catch {
		options.signal.throwIfAborted();
		throw new AuthRecoveryError();
	}
	options.signal.throwIfAborted();
}

async function readBody(response: Response, maxBytes: number, signal: AbortSignal): Promise<string> {
	if (!response.body) return "";
	const reader = response.body.getReader();
	const chunks: Buffer[] = [];
	let bytes = 0;
	let exceeded = false;
	let complete = false;
	const cancel = () => { void reader.cancel().catch(() => undefined); };
	signal.addEventListener("abort", cancel, { once: true });
	try {
		for (;;) {
			signal.throwIfAborted();
			const { done, value } = await reader.read();
			signal.throwIfAborted();
			if (done) break;
			if (value.byteLength > maxBytes - bytes) {
				exceeded = true;
				throw new Error();
			}
			bytes += value.byteLength;
			chunks.push(Buffer.from(value));
		}
		complete = true;
		return Buffer.concat(chunks, bytes).toString("utf8");
	} catch {
		signal.throwIfAborted();
		if (exceeded) throw new Error("RQW-codex: alpha/search response exceeds byte limit.");
		throw classifyTransport("response_stream");
	} finally {
		signal.removeEventListener("abort", cancel);
		if (!complete) cancel();
		reader.releaseLock();
	}
}

async function send(body: string, headers: Record<string, string>, options: SearchOptions, maxBytes: number): Promise<AlphaResponse> {
	let response: Response;
	try {
		response = await (options.fetch ?? globalThis.fetch)(WEB_SEARCH_ENDPOINT, {
			method: "POST", redirect: "error", headers, body, signal: options.signal,
		});
	} catch {
		options.signal.throwIfAborted();
		throw classifyTransport("network");
	}
	if (options.signal.aborted) {
		void response.body?.cancel().catch(() => undefined);
		options.signal.throwIfAborted();
	}
	if (!response.ok || response.redirected) {
		await response.body?.cancel().catch(() => undefined);
		// Do not retain upstream bodies or arbitrary diagnostic headers on the error.
		if (response.redirected) throw classifyTransport("policy");
		throw classifyHttp(response.status, { "retry-after": response.headers.get("retry-after") });
	}
	const text = await readBody(response, maxBytes, options.signal);
	options.signal.throwIfAborted();
	try {
		const value: unknown = JSON.parse(text);
		if (!isRecord(value) || typeof value.output !== "string"
			|| (value.results !== undefined && !Array.isArray(value.results))
			|| (value.encrypted_output !== undefined && typeof value.encrypted_output !== "string")) throw new Error();
		return {
			output: value.output,
			...(value.results === undefined ? {} : { results: value.results }),
			...(value.encrypted_output === undefined ? {} : { encrypted_output: value.encrypted_output }),
		};
	} catch {
		throw new Error("RQW-codex: invalid alpha/search response.");
	}
}

export async function searchAlpha(request: AlphaRequest, options: SearchOptions): Promise<AlphaResponse> {
	options.signal.throwIfAborted();
	const maxBytes = options.maxBytes === undefined ? 2 * 1024 * 1024 : options.maxBytes;
	if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error("RQW-codex: maxBytes must be a positive safe integer.");
	const body = prepare(request);
	let defaults: Record<string, string>;
	try {
		defaults = {
			"content-type": "application/json", accept: "application/json",
			originator: CODEX_ORIGINATOR, version: CODEX_VERSION,
			"User-Agent": userAgent(localPlatform()),
			[HEADER_TURN_METADATA]: asciiJson(turnMetadataPayload(options.identity, "turn")),
		};
		new Headers(defaults);
	} catch {
		throw new Error("RQW-codex: invalid alpha/search metadata.");
	}
	const resolved = await resolveStoredCredential(options.credentialStore, options.signal);
	const accountId = resolved.accountId;
	if (options.ownerAccountId !== undefined && options.ownerAccountId !== accountId) throw new AuthRecoveryError();
	let credential = resolved.credential;
	let reloaded = false;
	const http = new HttpRetryPolicy();
	for (;;) {
		const headers = mergeHeaders(defaults, { Authorization: `Bearer ${credential.access}`, "ChatGPT-Account-ID": accountId });
		try { new Headers(headers); } catch { throw new AuthRecoveryError(); }
		await verifyOwner(options, accountId);
		try {
			return await send(body, headers, options, maxBytes);
		} catch (error) {
			options.signal.throwIfAborted();
			if (!(error instanceof CodexError)) throw error;
			if (error.kind === "unauthorized") {
				if (reloaded) throw new AuthRecoveryError();
				reloaded = true;
				credential = await recoverCredential(options.credentialStore, { accountId, access: credential.access }, options.signal);
				continue;
			}
			const retry = http.next(error);
			if (!retry.retry) throw error;
			await sleepAbortable(retry.delayMs, options.signal, options.sleep);
		}
	}
}
