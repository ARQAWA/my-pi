import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { createAgentSession, createEventBus, DefaultResourceLoader, type ExtensionAPI, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import context from "../../../extensions/RQW-context/index.ts";

export const WINDOW = 4_000;
const isSummary = (context: any) => JSON.stringify(context).includes("context summarization assistant");
type Summary = { context: any; aborted: boolean; resolve(text: string): void; reject(error: Error): void };

/**
 * A real Pi session with RQW-context and a scripted faux model; only Pi's model and runtime are faked.
 * `say(p)` adds a user turn of about p of the window. Summary requests answer `SUMMARY n` at once, or wait for
 * `release()` while `hold` is set; with `stubborn` an aborted request stays pending until released. `next` scripts the
 * following conversation answers, default "ok". Waiting is event driven: `until(done)` re-checks after every summary
 * request and every status event, so no test counts turns or polls.
 */
export async function harness(settings: Record<string, unknown> = {}, extension?: (pi: ExtensionAPI) => void) {
	const core = createFauxCore({ provider: "faux", models: ["m", "m2"].map((id) => ({ id, contextWindow: WINDOW, maxTokens: 1_000 })) });
	const model = core.getModel("m")!;
	const summaries: Summary[] = [];
	const next: any[] = [];
	const control = { hold: false, fail: false, stubborn: false };
	const waiters = new Set<() => void>();
	const changed = () => { for (const check of [...waiters]) check(); };
	const until = (done: () => boolean) => done() ? Promise.resolve() : new Promise<void>((resolve) => {
		const check = () => { if (done()) { waiters.delete(check); resolve(); } };
		waiters.add(check);
	});
	const answer = async (context: any, options: any) => {
		if (!isSummary(context)) { const step = next.shift(); return typeof step === "function" ? step() : step ?? fauxAssistantMessage("ok"); }
		const text = await new Promise<string>((resolve, reject) => {
			const summary: Summary = { context, aborted: false, resolve, reject };
			summaries.push(summary);
			options?.signal?.addEventListener("abort", () => { summary.aborted = true; if (!control.stubborn) reject(new Error("aborted")); });
			if (control.fail) reject(new Error("summary failed"));
			else if (!control.hold) resolve(`SUMMARY ${summaries.length}`);
			changed();
		});
		return fauxAssistantMessage(text);
	};
	core.setResponses(Array.from({ length: 100 }, () => answer));
	const modelRuntime: any = {
		getModel: () => model, getPhysicalModel: () => model, hasConfiguredAuth: () => true, getAuth: async () => ({ apiKey: "k" }),
		checkAuth: async () => ({}), isUsingOAuth: () => false, getAvailableSnapshot: () => [model], getRegisteredProviderIds: () => [],
		// Without a session id faux usage is the plain prompt size, with no simulated cache split.
		streamSimple: (m: any, c: any, o: any) => core.streamSimple(m, c, { ...o, sessionId: undefined }), getProviderHeaders: () => undefined,
	};
	const events = createEventBus();
	const status: unknown[] = [];
	events.on("rqw-context:background-compaction", (data) => { status.push(data); changed(); });
	const compacts: any[] = [];
	const settingsManager = SettingsManager.inMemory({ compaction: { enabled: true, keepRecentTokens: 600, ...settings }, retry: { enabled: false } } as never);
	const resourceLoader = new DefaultResourceLoader({
		cwd: process.cwd(), agentDir: process.cwd(), settingsManager, eventBus: events,
		noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
		systemPromptOverride: () => "system",
		extensionFactories: [context, (pi: ExtensionAPI) => {
			pi.on("session_compact", (event) => { compacts.push(event); });
			extension?.(pi);
		}],
	} as never);
	await resourceLoader.reload();
	const { session } = await createAgentSession({
		cwd: process.cwd(), modelRuntime, model: model as never, resourceLoader, settingsManager,
		sessionManager: SessionManager.inMemory(process.cwd()), tools: [],
	});
	await session.bindExtensions({});
	return {
		session, status, compacts, summaries, next, control, until, other: core.getModel("m2")!,
		manager: session.sessionManager,
		say: (percent: number, text = "") => session.prompt(text + "x".repeat(Math.round(WINDOW * percent * 4))),
		release: (text: string) => summaries.at(-1)!.resolve(text),
		/** Waits until `count` summary requests arrived. */
		async summary(count: number) {
			await until(() => summaries.length >= count);
			return summaries[count - 1];
		},
		/** Waits until no background request is running: its end is reported on the status channel after its result is stored. */
		quiet: () => until(() => !(status.at(-1) as { active?: boolean } | undefined)?.active),
		compactions: () => session.sessionManager.getBranch().filter((entry) => entry.type === "compaction") as any[],
		percent: () => (session.getContextUsage()?.tokens ?? 0) / WINDOW,
	};
}
