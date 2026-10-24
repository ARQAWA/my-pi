// `host.continuation` of registerReview: a caller driven by its own adapter (a child resumed on Pi's core agent) keeps its
// assignment pending while a review runs and gets the verdict through the adapter, with none of the native settlement
// hooks registered. Real Pi child session, faux providers, no RQW-agent; the test plays the adapter.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, it } from "node:test";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall, type TranscriptContext } from "@earendil-works/pi-ai";
import {
	createAgentSession,
	DefaultResourceLoader,
	createEventBus,
	type ExtensionAPI,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { registerReview, type ReviewHost } from "../index.ts";
import { CLEAN_VERDICT } from "./codex-wire.ts";

const childFaux = fauxProvider({ provider: "child", api: "review-cont-child", models: [{ id: "child" }] });
const reviewerFaux = fauxProvider({ provider: "openai-codex", api: "review-cont-reviewer", models: [{ id: "gpt-6.1-sol", reasoning: true }] });

let root: string;
let runtime: ModelRuntime;
before(async () => {
	root = await mkdtemp(join(tmpdir(), "rqw-review-cont-"));
	await mkdir(join(root, "agent"), { recursive: true });
	runtime = await ModelRuntime.create({ authPath: join(root, "agent", "auth.json"), modelsPath: null, refreshOnCreate: false });
	for (const faux of [childFaux, reviewerFaux]) runtime.registerNativeProvider(faux.provider);
});
after(async () => { await rm(root, { recursive: true, force: true }); });

async function until(check: () => boolean, what: string, ms = 5000) {
	const end = Date.now() + ms;
	while (!check()) {
		if (Date.now() > end) assert.fail(`timed out waiting for ${what}`);
		await new Promise((r) => setTimeout(r, 5));
	}
}

const NATIVE = ["agent_end", "agent_before_settle", "turn_start", "agent_settled"];
const reviewCall = (id: string, extra: Record<string, unknown> = {}) =>
	fauxToolCall("review", { level: "blind", object: "a.ts", criterion: "the rename", ...extra }, { id });

/** The adapter stand-in: logs every call, and the message `deliver` got. */
function adapter() {
	const log: string[] = [];
	const delivered: { customType: string; content: unknown; options?: unknown }[] = [];
	const releases: (() => void)[] = [];
	const continuation: NonNullable<ReviewHost["continuation"]> = {
		retain() {
			log.push("retain");
			let calls = 0;
			const release = () => { calls++; log.push("release"); };
			releases.push(release);
			return release;
		},
		deliver(message: any, options?: unknown) { log.push("deliver"); delivered.push({ ...message, options }); return Promise.resolve(); },
	};
	return { log, delivered, continuation, releases };
}

/** A child session with `review` registered under a continuation host; `hooks` lists the events its registration used. */
async function child(host: Omit<ReviewHost, "events" | "fast">, replies: Parameters<typeof childFaux.setResponses>[0], prime?: (sessions: SessionManager) => void) {
	const hooks: string[] = [];
	const events = createEventBus();
	childFaux.setResponses(replies);
	const settingsManager = SettingsManager.inMemory({ retry: { enabled: false } });
	const register = (sub: ExtensionAPI) => {
		const spy = new Proxy(sub, {
			get(target, key) {
				if (key === "on") return (name: string, handler: never) => { hooks.push(name); return target.on(name as never, handler); };
				const value = (target as any)[key];
				return typeof value === "function" ? value.bind(target) : value;
			},
		});
		registerReview(spy, { events, fast: () => false, ...host });
	};
	const loader = new DefaultResourceLoader({ cwd: root, agentDir: join(root, "agent"), settingsManager, noExtensions: true, noSkills: true,
		noPromptTemplates: true, noThemes: true, noContextFiles: true, extensionFactories: [register] });
	await loader.reload();
	const sessionManager = SessionManager.inMemory(root);
	prime?.(sessionManager);
	const { session } = await createAgentSession({ cwd: root, model: childFaux.getModel(), modelRuntime: runtime, resourceLoader: loader,
		tools: ["review"], sessionManager, settingsManager });
	return { session, hooks };
}

/** A reviewer that records its start and answers when released. */
function gatedReviewer(log: string[], answer = CLEAN_VERDICT) {
	const gates: (() => void)[] = [];
	reviewerFaux.setResponses(Array.from({ length: 4 }, () => async () => {
		log.push("reviewer");
		await new Promise<void>((r) => gates.push(r));
		return fauxAssistantMessage(fauxText(answer));
	}));
	return gates;
}

it("retain before the reviewer starts, one deliver of the verdict, then release; no native settlement hook is registered", async () => {
	const a = adapter();
	const gates = gatedReviewer(a.log);
	const { session, hooks } = await child({ continuation: a.continuation }, [
		fauxAssistantMessage(reviewCall("r1"), { stopReason: "toolUse" }),
		fauxAssistantMessage(fauxText("waiting")),
	]);
	try {
		await session.prompt("TASK");
		await until(() => gates.length === 1, "the reviewer request");
		assert.deepEqual(a.log, ["retain", "reviewer"], "pending is held from before the reviewer starts");
		gates[0]();
		await until(() => a.log.includes("release"), "the release");
		assert.deepEqual(a.log, ["retain", "reviewer", "deliver", "release"]);
		assert.equal(a.delivered.length, 1);
		assert.equal(a.delivered[0].customType, "review");
		assert.match(String(a.delivered[0].content), /^\[review#1\] CLEAN/);
		assert.equal(a.delivered[0].options, undefined, "the adapter decides whether and when to wake the caller");
		assert.ok(hooks.includes("session_start"), "the spy sees the registration");
		assert.deepEqual(hooks.filter((name) => NATIVE.includes(name)), []);
		assert.equal(session.messages.some((m) => m.role === "custom" && m.customType === "review"), false, "nothing reached the session by the native path");
	} finally { session.dispose(); }
});

it("a reviewer that fails still delivers once (the failure text) and releases", async () => {
	const a = adapter();
	reviewerFaux.setResponses([async () => { a.log.push("reviewer"); throw new Error("provider down"); }]);
	const { session } = await child({ continuation: a.continuation }, [
		fauxAssistantMessage(reviewCall("r1"), { stopReason: "toolUse" }),
		fauxAssistantMessage(fauxText("waiting")),
	]);
	try {
		await session.prompt("TASK");
		await until(() => a.log.includes("release"), "the release");
		assert.deepEqual(a.log, ["retain", "reviewer", "deliver", "release"]);
		assert.match(String(a.delivered[0].content), /^\[review#1\] .*Review failed/s);
	} finally { session.dispose(); }
});

it("the caller's lifetime ends the review: release without a verdict", async () => {
	const a = adapter();
	const controller = new AbortController();
	const gates = gatedReviewer(a.log);
	const { session } = await child({ continuation: a.continuation, signal: controller.signal }, [
		fauxAssistantMessage(reviewCall("r1"), { stopReason: "toolUse" }),
		fauxAssistantMessage(fauxText("waiting")),
	]);
	try {
		await session.prompt("TASK");
		await until(() => gates.length === 1, "the reviewer request");
		controller.abort();
		await until(() => a.log.includes("release"), "the release");
		await new Promise((r) => setTimeout(r, 50));
		assert.deepEqual(a.log, ["retain", "reviewer", "release"]);
		assert.equal(a.delivered.length, 0);
	} finally { session.dispose(); }
});

it("parallel reviews retain and release one each and deliver their own verdicts", async () => {
	const a = adapter();
	const gates = gatedReviewer(a.log);
	const { session } = await child({ continuation: a.continuation }, [
		fauxAssistantMessage([reviewCall("r1"), reviewCall("r2")], { stopReason: "toolUse" }),
		fauxAssistantMessage(fauxText("waiting")),
	]);
	try {
		await session.prompt("TASK");
		await until(() => gates.length === 2, "both reviewer requests");
		assert.equal(a.log.filter((x) => x === "retain").length, 2);
		assert.equal(a.log.includes("release"), false, "both still pending");
		gates[0]();
		await until(() => a.log.filter((x) => x === "release").length === 1, "the first release");
		assert.equal(a.delivered.length, 1);
		gates[1]();
		await until(() => a.log.filter((x) => x === "release").length === 2, "the second release");
		assert.deepEqual(a.delivered.map((d) => String(d.content).slice(0, 10)).sort(), ["[review#1]", "[review#2]"]);
	} finally { session.dispose(); }
});

it("a call refused before any job starts retains nothing", async () => {
	const a = adapter();
	// The caller's session already holds the highest review number: the next call is refused (id space exhausted).
	const { session } = await child({ continuation: a.continuation }, [
		fauxAssistantMessage(reviewCall("r1"), { stopReason: "toolUse" }),
		fauxAssistantMessage(fauxText("refused")),
	], (sessions) => void sessions.appendCustomEntry("review", { n: Number.MAX_SAFE_INTEGER }));
	try {
		await session.prompt("TASK");
		assert.deepEqual(a.log, []);
		const result = session.messages.find((m) => m.role === "toolResult");
		assert.equal((result as any)?.isError, true);
		assert.match(JSON.stringify((result as any)?.content), /Review id space exhausted/);
	} finally { session.dispose(); }
});
