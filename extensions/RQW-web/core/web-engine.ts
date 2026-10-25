// Adapted from extensions/RQW-codex/web-engine.ts at git commit a85b810e924010f35387045fc0cbbd9a1e7173cc.
import { randomUUID } from "node:crypto";
import type { Api, Model } from "@earendil-works/pi-ai";
import { resolveStoredCredential } from "../vendor/auth-boundary.ts";
import { AuthRecoveryError } from "../vendor/auth.ts";
import { CodexError, classifyEvent } from "../vendor/errors.ts";
import { newContextWindowId, type CodexIdentity } from "../vendor/metadata.ts";
import { CodexThreadTransport, wireCapabilities } from "../vendor/transport.ts";
import { additionalToolsItem, buildRequest, canonicalNativeTools, type WireItem } from "../vendor/wire.ts";
import { searchAlpha } from "./web-alpha.ts";
import { parseCommands, publicUrl, record, validateTarget, WEB_INSTRUCTIONS, WEB_TOOLS } from "./web-commands.ts";
import type { ResearchTargetOptions, TargetResult, WebSource, WebTransport } from "./web-types.ts";
export type { ResearchTargetOptions, TargetResult, WebTarget, WebMode, WebResponseLength } from "./web-types.ts";

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const FAILURES: Record<string, string> = {
	invalid_input: "Invalid web target, model, effort or limits.",
	invalid_commands: "The model requested an invalid or unsupported web command.",
	unsupported_tool: "Only completed web.run calls may be executed.",
	limit_exceeded: "The bounded web research budget was exhausted.",
	incomplete_response: "The model response did not complete.",
	no_web_evidence: "No successful web action for this target; a memory-only answer is not search.",
	no_sources: "The web answer did not include supporting page links.",
	empty_summary: "The web model returned no final summary.",
	wrong_url: "URL research must open the requested URL first.",
};

/** Race injected I/O as well as real transports, so cancellation never depends on a test seam cooperating. */
async function abortable<T>(operation: PromiseLike<T>, signal: AbortSignal): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const stop = () => reject(new DOMException("Web research aborted", "AbortError"));
		if (signal.aborted) { Promise.resolve(operation).catch(() => undefined); stop(); return; }
		signal.addEventListener("abort", stop, { once: true });
		Promise.resolve(operation).then(resolve, reject).finally(() => signal.removeEventListener("abort", stop));
	});
}

function boundedInteger(value: number, maximum = Number.MAX_SAFE_INTEGER): number {
	if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) throw new Error("invalid_input");
	return value;
}

function markdownUrls(text: string): string[] {
	const urls: string[] = [];
	for (const match of text.matchAll(/\]\(\s*(<?https?:\/\/)/g)) {
		const start = match.index + match[0].length - match[1].length;
		const angled = text[start] === "<";
		const urlStart = start + (angled ? 1 : 0);
		let cursor = urlStart;
		let depth = 0;
		for (; cursor < text.length; cursor++) {
			const char = text[cursor];
			if (char === "\\" && cursor + 1 < text.length) { cursor++; continue; }
			if (angled) {
				if (char === ">" || char === "\n") break;
				continue;
			}
			if (/\s|[<>]/.test(char)) break;
			if (char === "(") depth++;
			if (char === ")") {
				if (depth === 0) break;
				depth--;
			}
		}
		if (depth !== 0 || (angled && text[cursor] !== ">")) continue;
		const tail = text.slice(cursor + (angled ? 1 : 0));
		if (!/^(?:\s+(?:"[^"\r\n]*"|'[^'\r\n]*'|\([^\)\r\n]*\)))?\s*\)/.test(tail)) continue;
		urls.push(text.slice(urlStart, cursor).replace(/\\([\\()])/g, "$1"));
	}
	return urls;
}

function sourceLinks(summary: string, citations: unknown[]): WebSource[] {
	const sources = new Map<string, WebSource>();
	for (const item of citations) {
		if (!record(item) || item.type !== "url_citation" || typeof item.url !== "string") continue;
		const url = publicUrl(item.url);
		if (url) sources.set(url, { url, ...(typeof item.title === "string" ? { title: item.title } : {}) });
	}
	// Links are model-provided URLs, never guesses from opaque turn... references.
	for (const destination of markdownUrls(summary)) {
		const url = publicUrl(destination);
		if (url && !sources.has(url)) sources.set(url, { url });
	}
	return [...sources.values()];
}

function normalizeSummary(items: WireItem[], result: TargetResult): void {
	const texts: string[] = [];
	for (const item of items) {
		if (item.type !== "message" || item.role !== "assistant" || !Array.isArray(item.content)) continue;
		for (const part of item.content) {
			if (!record(part) || part.type !== "output_text") continue;
			if (typeof part.text === "string") texts.push(part.text);
		}
	}
	result.summary = texts.join("\n").trim();
	result.sources = sourceLinks(result.summary, result.citations);
}

/** A read-only caller cannot refresh the saved login, so a plain repeat fails the same way; say what to do first. */
export const AUTH_REFRESH_MESSAGE = "The saved Codex login is missing, expired or rejected and cannot be refreshed here. Refresh it with Pi: use Pi or run /login openai-codex, then repeat the command. Repeating it now will fail the same way.";

function safeFailure(error: unknown, signal: AbortSignal, timedOut: boolean): TargetResult["error"] {
	if (signal.aborted) return { code: timedOut ? "timeout" : "aborted", message: timedOut ? "Web research timed out." : "Web research was aborted." };
	if (error instanceof AuthRecoveryError) return { code: "authentication_failed", message: AUTH_REFRESH_MESSAGE };
	if (error instanceof CodexError) return { code: error.kind, message: error.message };
	const code = error instanceof Error && Object.hasOwn(FAILURES, error.message) ? error.message : "request_failed";
	return { code, message: FAILURES[code] ?? "Web research request failed. No credentials or upstream error body were included." };
}

/** One ephemeral native Lite web-only loop. No session, disk writes, model routing or result rendering. */
export async function researchTarget(options: ResearchTargetOptions): Promise<TargetResult> {
	const result: TargetResult = {
		target: options.target, model: options.model, effort: options.effort,
		mode: options.mode ?? "cached", responseLength: options.responseLength ?? "short",
		status: "error", summary: "", sources: [], citations: [], actions: [], results: [],
	};
	const controller = new AbortController();
	const cancel = () => controller.abort();
	let timer: ReturnType<typeof setTimeout> | undefined;
	let timedOut = false;
	let transport: WebTransport | undefined;
	try {
		validateTarget(options.target);
		if (!["cached", "live", "indexed"].includes(result.mode) || !["short", "medium", "long"].includes(result.responseLength)) throw new Error("invalid_input");
		const timeout = boundedInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 2_147_483_647);
		const maxRounds = boundedInteger(options.maxRounds ?? 8);
		const maxWebCalls = boundedInteger(options.maxWebCalls ?? 16);
		const maxBytes = boundedInteger(options.maxBytes ?? DEFAULT_MAX_BYTES);
		let bytes = 0;
		const budget = (value: unknown) => {
			bytes += Buffer.byteLength(JSON.stringify(value));
			if (bytes > maxBytes) throw new Error("limit_exceeded");
		};
		budget(options.target);
		if (options.signal?.aborted) controller.abort();
		else options.signal?.addEventListener("abort", cancel, { once: true });
		controller.signal.throwIfAborted();
		timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
		const model = { id: options.model, provider: "openai-codex", api: "openai-codex-responses", input: ["text"] } as Model<Api>;
		let request;
		const threadId = randomUUID();
		const identity: CodexIdentity = {
			installationId: randomUUID(), rootSessionId: threadId, threadId,
			windowId: `${threadId}:0`, contextWindowId: newContextWindowId(),
			turnId: randomUUID(), turnStartedAtUnixMs: Date.now(), authProfile: "subscription",
		};
		try {
			const capabilities = wireCapabilities(model);
			if (!capabilities.use_responses_lite || !options.effort) throw new Error("invalid_input");
			request = buildRequest({ model, capabilities, identity, requestKind: "turn",
				options: { reasoningEffort: options.effort, reasoningSummary: "none" },
				context: { systemPrompt: WEB_INSTRUCTIONS, tools: [], messages: [{ role: "user", timestamp: Date.now(), content: JSON.stringify({ ...options.target, response_length: result.responseLength }) }] },
			});
		} catch { throw new Error("invalid_input"); }
		request.input.unshift(additionalToolsItem(threadId, canonicalNativeTools(WEB_TOOLS)));
		const { accountId } = await abortable(resolveStoredCredential(options.credentialStore, controller.signal), controller.signal);
		transport = (options.network?.createTransport ?? (args => new CodexThreadTransport(args)))({
			identity, store: options.credentialStore,
			dependencies: { ...options.network?.transportDependencies, ...(options.network?.fetch ? { fetch: options.network.fetch } : {}) },
		});
		transport.beginTurn({ turnId: identity.turnId });
		const executed = new Set<string>();
		let targetAction = false;
		for (let round = 0; round < maxRounds; round++) {
			controller.signal.throwIfAborted();
			if (Buffer.byteLength(JSON.stringify(request)) > maxBytes) throw new Error("limit_exceeded");
			const items = new Map<number, WireItem>();
			let completed = false;
			const stream = transport.sendRaw({ request, model, requestKind: "turn", signal: controller.signal, options: { preparedOwner: accountId } });
			const iterator = stream[Symbol.asyncIterator]();
			for (;;) {
				const next = await abortable(iterator.next(), controller.signal);
				if (next.done) break;
				const event = next.value;
				budget(event);
				const failure = classifyEvent(event);
				if (failure) throw failure;
				if (event.type === "response.output_item.done" && record(event.item) && typeof event.item.type === "string") {
					items.set(typeof event.output_index === "number" ? event.output_index : items.size, structuredClone(event.item) as WireItem);
				}
				if (event.type === "response.completed") {
					completed = true;
					if (record(event.response) && Array.isArray(event.response.output)) {
						items.clear();
						event.response.output.forEach((item, index) => {
							if (!record(item) || typeof item.type !== "string") throw new Error("incomplete_response");
							items.set(index, structuredClone(item) as WireItem);
						});
					}
				}
			}
			if (!completed) throw new Error("incomplete_response");
			const outputs = [...items].sort(([a], [b]) => a - b).map(([, item]) => item);
			const calls = outputs.filter(item => item.type === "function_call" || item.type === "custom_tool_call");
			for (const item of outputs) {
				if (item.type === "web_search_call") result.actions.push(structuredClone(item));
				if (item.type === "message" && Array.isArray(item.content)) {
					for (const part of item.content) if (record(part) && Array.isArray(part.annotations)) result.citations.push(...structuredClone(part.annotations));
				}
			}
			if (calls.length === 0) {
				if (!targetAction) throw new Error("no_web_evidence");
				normalizeSummary(outputs, result);
				if (!result.summary) throw new Error("empty_summary");
				if (!result.sources.length) throw new Error("no_sources");
				result.status = "ok";
				return result;
			}
			// Replay the exact native items, including opaque reasoning, only inside this task.
			request.input.push(...outputs);
			for (const call of calls) {
				if (call.type !== "function_call" || call.namespace !== "web" || call.name !== "run" || (call.status !== undefined && call.status !== "completed") || typeof call.call_id !== "string" || !call.call_id || typeof call.arguments !== "string") throw new Error("unsupported_tool");
				if (executed.has(call.call_id) || executed.size >= maxWebCalls) throw new Error("limit_exceeded");
				const commands = parseCommands(call.arguments, result.responseLength);
				if (options.target.kind === "url" && executed.size === 0 && publicUrl(commands.open?.[0]?.ref_id ?? "") !== publicUrl(options.target.value)) throw new Error("wrong_url");
				executed.add(call.call_id);
				const alpha = await abortable(searchAlpha({ id: threadId, model: options.model,
					input: [{ type: "message", role: "user", content: [{ type: "input_text", text: JSON.stringify(options.target) }] }], commands,
					settings: { external_web_access: result.mode === "indexed" ? "indexed" : result.mode === "live" },
				}, { credentialStore: options.credentialStore, identity, signal: controller.signal, ownerAccountId: accountId, fetch: options.network?.fetch, sleep: options.network?.transportDependencies?.sleep, maxBytes: Math.max(1, maxBytes - bytes) }), controller.signal);
				budget(alpha);
				if (alpha.output.trim()) {
					if (options.target.kind === "query" && commands.search_query?.length) targetAction = true;
					if (options.target.kind === "url" && commands.open?.some(item => publicUrl(item.ref_id) === publicUrl(options.target.value))) targetAction = true;
				}
				result.actions.push({ type: "web.run", callId: call.call_id, commands: structuredClone(commands) });
				if (alpha.results) result.results.push(...structuredClone(alpha.results));
				request.input.push({ type: "function_call_output", call_id: call.call_id, output: [{ type: "input_text", text: alpha.output }] });
			}
		}
		throw new Error("limit_exceeded");
	} catch (error) {
		result.error = safeFailure(error, controller.signal, timedOut);
		result.summary = "";
		return result;
	} finally {
		if (timer !== undefined) clearTimeout(timer);
		options.signal?.removeEventListener("abort", cancel);
		try { transport?.endTurn(); } finally { transport?.dispose(); }
	}
}
