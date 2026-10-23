// Real Pi sessions and in-process faux providers. No transport or saved credentials.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate } from "node:timers/promises";
import { fauxAssistantMessage as answer, fauxProvider, type AssistantMessage, type TranscriptContext, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type EventBus } from "@earendil-works/pi-coding-agent";

export { answer };
export async function tick(turns = 20) { for (let i = 0; i < turns; i++) await setImmediate(); }
export async function until(check: () => boolean, label: string, ms = 5000) {
	const deadline = Date.now() + ms;
	while (!check()) {
		assert.ok(Date.now() < deadline, `timeout: ${label}`);
		await setImmediate();
	}
}
type Reply = AssistantMessage | ((context: TranscriptContext, options?: SimpleStreamOptions) => Promise<AssistantMessage>);
export function gate(text = "CHILD") {
	const waiting = Promise.withResolvers<AssistantMessage>();
	let entered = false, aborted = false;
	return {
		reply: async (_context: TranscriptContext, options?: SimpleStreamOptions) => {
			entered = true;
			options?.signal?.addEventListener("abort", () => { aborted = true; waiting.resolve(answer(text)); }, { once: true });
			return waiting.promise;
		},
		release: () => waiting.resolve(answer(text)), entered: () => entered, aborted: () => aborted,
	};
}
let serial = 0;
export async function fixture(mode: "tui" | "rpc" | "print" | "json" = "tui", authHold?: Promise<void>, before: string[] = [], after: string[] = []) {
	const root = await mkdtemp(join(tmpdir(), "rqw-agent-audit-"));
	const agentDir = join(root, "home");
	await mkdir(agentDir);
	const id = serial++;
	const main = fauxProvider({ provider: `audit-main-${id}`, api: `audit-main-${id}`, models: [{ id: "m", reasoning: true }] });
	const sub = fauxProvider({ provider: `audit-sub-${id}`, api: `audit-sub-${id}`, models: [{ id: "s", reasoning: true }] });
	let authEntered = 0;
	if (authHold) sub.provider.auth.apiKey!.resolve = async () => { authEntered++; await authHold; return { auth: {} }; };
	const runtime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
	runtime.registerNativeProvider(main.provider);
	runtime.registerNativeProvider(sub.provider);
	const requests = { main: [] as TranscriptContext[], sub: [] as TranscriptContext[] };
	function frames(faux: typeof sub, target: TranscriptContext[]) {
		const replies: Reply[] = [];
		faux.setResponses(Array.from({ length: 500 }, () => async (context: TranscriptContext, options?: SimpleStreamOptions) => {
			target.push(structuredClone(context));
			const step = replies.shift();
			return typeof step === "function" ? await step(context, options) : step ?? answer("OK");
		}));
		return replies;
	}
	const mainReplies = frames(main, requests.main), subReplies = frames(sub, requests.sub);
	// Fixture observer: a public inline factory that keeps the pi.events of this loader for fault injection.
	const observed: { events?: EventBus } = {};
	const loader = new DefaultResourceLoader({ cwd: root, agentDir,
		additionalExtensionPaths: [...before, join(import.meta.dirname, "../index.ts"), ...after],
		extensionFactories: [pi => { observed.events = pi.events; }],
		noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
	await loader.reload();
	assert.deepEqual(loader.getExtensions().errors, []);
	const { session } = await createAgentSession({ cwd: root, agentDir, modelRuntime: runtime, model: main.getModel("m"),
		thinkingLevel: "low", resourceLoader: loader, sessionManager: SessionManager.inMemory(root),
		settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }) });
	const errors: string[] = [];
	await session.bindExtensions({ mode, onError: e => errors.push(`${e.event}: ${e.error}`) });
	const call = async (params: Record<string, unknown>, signal?: AbortSignal, ctx = session.extensionRunner.createContext()) => {
		const result = await session.getToolDefinition("agent")!.execute("audit", params, signal, undefined, ctx);
		return result.content.map(c => c.type === "text" ? c.text : "").join("");
	};
	const params = (task = "FIRST") => ({ action: "start", system: "EXACT", task, tools: [], model: `${sub.provider.id}/s` });
	const start = (task = "FIRST", signal?: AbortSignal) => call(params(task), signal);
	const delivered = () => session.messages.flatMap(m => m.role === "custom" && m.customType === "agent" && typeof m.content === "string" ? [m.content] : []);
	const cleanup = async () => {
		await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		session.dispose();
		await tick();
		await rm(root, { recursive: true, force: true });
	};
	// Fault injection at the actual optional-tools factory boundary, not a replacement SDK.
	const captured = observed.events;
	assert.ok(captured, "fixture observer captured pi.events");
	const bus = {
		on(channel: string, handler: (request: { offer(factory: () => never[]): void }) => void): () => void {
			return captured.on(channel, data => handler(data as { offer(factory: () => never[]): void }));
		},
		emit(channel: string, data: unknown) { captured.emit(channel, data); },
	};
	return { root, session, runtime, sub, main, requests, mainReplies, subReplies, call, params, start, delivered, cleanup, errors, bus, authEntered: () => authEntered };
}
export function texts(context: TranscriptContext) {
	return context.messages.filter(m => m.role !== "system").flatMap(m => typeof m.content === "string" ? [m.content] : m.content.filter(c => c.type === "text").map(c => c.text));
}
