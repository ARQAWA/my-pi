// The review tool inside real Pi sessions, no model. The main session loads the extension from its file the way Pi
// loads a package extension; two faux providers stand in for the main model and for the reviewer models
// (`anthropic/claude-haiku-5-5`, `anthropic/claude-sonnet-5-5`), and record every request they get.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
	type AssistantMessage,
	fauxAssistantMessage,
	fauxProvider,
	fauxText,
	fauxToolCall,
	getSystemMessageText,
	type Model,
	type SimpleStreamOptions,
	type TranscriptContext,
} from "@earendil-works/pi-ai";
import { makeStrictJsonSchema } from "@earendil-works/pi-ai/api/constrained-sampling";
import {
	type AgentSession,
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	type SessionEntry,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { buildBrief } from "../index.ts";

const EXTENSION = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");
const REVIEWER = readFileSync(join(dirname(EXTENSION), "REVIEWER.md"), "utf8").trimEnd();

type Factory = (context: TranscriptContext, options: SimpleStreamOptions | undefined) => AssistantMessage | Promise<AssistantMessage>;
type Request = { model: string; reasoning?: string; system: string; tools: string[]; text: string };
type Declared = { name: string; description: string; parameters: Record<string, unknown> };

const mainFaux = fauxProvider({ provider: "main", models: [{ id: "main" }] });
const reviewerFaux = fauxProvider({
	provider: "anthropic",
	models: [
		{ id: "claude-haiku-5-5", reasoning: true },
		{ id: "claude-sonnet-5-5", reasoning: true },
	],
});

let root: string;
let agentDir: string;
let counter = 0;
let full: ModelRuntime;
let mainOnly: ModelRuntime;
let otherModels: ModelRuntime;

before(async () => {
	root = await mkdtemp(join(tmpdir(), "rqw-review-"));
	agentDir = join(root, "agent");
	await mkdir(agentDir, { recursive: true });
	const runtime = async (reviewer?: typeof reviewerFaux) => {
		const r = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
		r.registerNativeProvider(mainFaux.provider);
		if (reviewer) r.registerNativeProvider(reviewer.provider);
		return r;
	};
	full = await runtime(reviewerFaux);
	// Pi's own catalog still lists the anthropic models, but no credentials are configured for them.
	mainOnly = await runtime();
	// An anthropic provider that has no model of that name.
	otherModels = await runtime(fauxProvider({ provider: "anthropic", models: [{ id: "claude-other" }] }));
});

after(async () => {
	await rm(root, { recursive: true, force: true });
});

const textOf = (content: unknown): string =>
	typeof content === "string"
		? content
		: Array.isArray(content)
			? content.map((c) => (c && typeof c === "object" && "text" in c ? String(c.text) : "")).join("\n")
			: "";

/** The tools a request declares, replayed from its system messages. */
function declaredTools(context: TranscriptContext): Declared[] {
	const declared = new Map<string, Declared>();
	for (const message of context.messages) {
		if (message.role !== "system") continue;
		for (const tool of message.toolsAdded ?? []) {
			declared.set(tool.name, { name: tool.name, description: tool.description, parameters: tool.parameters as Record<string, unknown> });
		}
		for (const ref of message.toolsRemoved ?? []) declared.delete(ref.name);
	}
	return [...declared.values()];
}

function systemText(context: TranscriptContext): string {
	const system = context.messages.find((m) => m.role === "system");
	return system ? getSystemMessageText(system) : "";
}

/** Every reviewer request is answered by `answer` and recorded. */
function scriptReviewer(answer: Factory): Request[] {
	const requests: Request[] = [];
	const step = (context: TranscriptContext, options: SimpleStreamOptions | undefined, _state: unknown, model: Model<string>) => {
		const users = context.messages.filter((m) => m.role === "user");
		requests.push({
			model: model.id,
			reasoning: options?.reasoning,
			system: systemText(context),
			tools: declaredTools(context).map((t) => t.name).sort(),
			text: textOf(users.at(-1)?.content),
		});
		return answer(context, options);
	};
	reviewerFaux.setResponses(Array.from({ length: 5 }, () => step));
	return requests;
}

type Main = {
	session: AgentSession;
	dir: string;
	/** Tools the main model saw in its first request. */
	tools: Declared[];
	/** Resolves with the text of the main request that carried the first `[review#` message. */
	verdictTurn: Promise<string>;
};

/**
 * A main session with the extension. Its model answers each prompt in `prompts` with text, except the last one, which
 * it answers with one call of `review` with `args`; a later request that carries a `[review#` message ends with "done".
 */
async function openMain(runtime: ModelRuntime, args: Record<string, unknown>, withExtension = true): Promise<Main> {
	const dir = join(root, `w${counter++}`);
	await mkdir(dir, { recursive: true });
	const resourceLoader = new DefaultResourceLoader({
		cwd: dir,
		agentDir,
		additionalExtensionPaths: withExtension ? [EXTENSION] : [],
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
	});
	await resourceLoader.reload();
	assert.deepEqual(resourceLoader.getExtensions().errors, [], "extension load errors");
	const { session } = await createAgentSession({
		cwd: dir,
		agentDir,
		model: mainFaux.getModel(),
		thinkingLevel: "off",
		modelRuntime: runtime,
		resourceLoader,
		sessionManager: SessionManager.inMemory(dir),
		settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }),
	});
	await session.bindExtensions({});

	const main: Main = { session, dir, tools: [], verdictTurn: Promise.resolve("") };
	const verdict = Promise.withResolvers<string>();
	main.verdictTurn = verdict.promise;
	let reviewCalled = false;
	const step = (context: TranscriptContext) => {
		if (main.tools.length === 0) main.tools = declaredTools(context);
		const last = context.messages.at(-1);
		const lastText = last?.role === "user" ? textOf(last.content) : "";
		if (lastText.includes("[review#")) {
			verdict.resolve(lastText);
			return fauxAssistantMessage(fauxText("done"));
		}
		if (last?.role === "user" && lastText.startsWith("Review")) {
			if (!reviewCalled) {
				reviewCalled = true;
				return fauxAssistantMessage(fauxToolCall("review", args, { id: "r1" }), { stopReason: "toolUse" });
			}
		}
		return fauxAssistantMessage(fauxText(last?.role === "toolResult" ? "waiting" : "ok"));
	};
	mainFaux.setResponses(Array.from({ length: 10 }, () => step));
	return main;
}

/** `promise`, or a failure naming `what` when it does not settle in time (a guard only; passing runs never wait). */
async function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
	const guard = Promise.withResolvers<never>();
	const timer = setTimeout(() => guard.reject(new Error(`timeout: ${what}`)), ms);
	try {
		return await Promise.race([promise, guard.promise]);
	} finally {
		clearTimeout(timer);
	}
}

const reviewMessages = (session: AgentSession) =>
	session.messages.filter((m) => m.role === "custom" && m.customType === "review").map((m) => (m.role === "custom" ? m : undefined));

const FIRST = "Rename `foo` to `bar` in a.ts.\n  Keep «quotes», <tags> and trailing spaces  \nexactly.";
const SECOND = "Review it, please: blind.";

describe("review tool", () => {
	it("is registered with a short description and a strict-mode schema", async () => {
		scriptReviewer(() => fauxAssistantMessage(fauxText("CLEAN")));
		const main = await openMain(full, { level: "blind", object: "a.ts", criterion: "c" });
		try {
			await main.session.prompt("hello");
			const review = main.tools.find((t) => t.name === "review");
			assert.ok(review, "the main model sees a review tool");
			assert.ok(review.description.length <= 500, `description is ${review.description.length} characters`);
			assert.match(review.description, /\[review#N\]/);
			const strict = makeStrictJsonSchema(structuredClone(review.parameters) as never);
			assert.deepEqual(Object.keys((strict as { properties: object }).properties).sort(), [
				"agreement",
				"criterion",
				"level",
				"object",
				"rejected",
			]);
			assert.deepEqual((review.parameters as { required: string[] }).required.sort(), ["criterion", "level", "object"]);
		} finally {
			main.session.dispose();
		}
	});

	it("blind: Haiku medium, REVIEWER.md as the prompt, read/grep/find only, the user's words verbatim, verdict as a follow-up", async () => {
		const requests = scriptReviewer(() => fauxAssistantMessage(fauxText("CLEAN")));
		const args = {
			level: "blind",
			object: "a.ts; stage pre-completion",
			criterion: "Everything agreed is done.",
			agreement: "Proposal accepted: keep the old name as an alias.",
			rejected: "FINDING 2: rejected, «Keep» covers it.",
		};
		const main = await openMain(full, args);
		try {
			await main.session.prompt(FIRST);
			await main.session.prompt(SECOND);
			const turn = await within(main.verdictTurn, 5000, "verdict turn");
			await main.session.waitForIdle();

			assert.equal(requests.length, 1);
			const [r] = requests;
			assert.equal(r.model, "claude-haiku-5-5");
			assert.equal(r.reasoning, "medium");
			assert.ok(r.system.startsWith(REVIEWER), "the prompt starts with REVIEWER.md");
			assert.match(r.system.slice(REVIEWER.length), /^\n\n<cwd>\n[^\n]+\n<\/cwd>$/, "only Pi's <cwd> block follows it");
			assert.deepEqual(r.tools, ["find", "grep", "read"]);

			assert.ok(r.text.includes(`<message n="1">\n${FIRST}\n</message>`), "first user message verbatim");
			assert.ok(r.text.includes(`<message n="2">\n${SECOND}\n</message>`), "second user message verbatim");
			assert.ok(r.text.indexOf(FIRST) < r.text.indexOf(SECOND), "in order");
			assert.ok(!r.text.includes("waiting") && !r.text.includes("\nok\n"), "no assistant text");
			assert.ok(r.text.includes(`<agreement>\n${args.agreement}\n</agreement>`));
			assert.ok(r.text.includes(`<object>\n${args.object}\n</object>`));
			assert.ok(r.text.includes(`<criterion>\n${args.criterion}\n</criterion>`));
			assert.ok(r.text.includes(`<rejected_earlier>\n${args.rejected}\n</rejected_earlier>`));

			assert.equal(turn, "[review#1] CLEAN", "the verdict started a main turn");
			const delivered = reviewMessages(main.session);
			assert.equal(delivered.length, 1);
			assert.equal(delivered[0]?.content, "[review#1] CLEAN");
			assert.equal(delivered[0]?.display, true);
			assert.deepEqual(
				{ ...(delivered[0]?.details as Record<string, unknown>), seconds: 0 },
				{ n: 1, level: "blind", model: "anthropic/claude-haiku-5-5", thinking: "medium", seconds: 0 },
			);
			const result = main.session.messages.find((m) => m.role === "toolResult" && m.toolName === "review");
			assert.equal(result?.role === "toolResult" ? textOf(result.content) : "", "review#1 started");
		} finally {
			main.session.dispose();
		}
	});

	it("high: Sonnet low; empty optional fields are left out; the verdict text is passed through", async () => {
		const findings = "FINDINGS:\nFINDING 1\nREQUIREMENT: x\nMISMATCH: y\nEVIDENCE: z (a.ts)\nREQUIRED OUTCOME: w";
		const requests = scriptReviewer(() => fauxAssistantMessage(fauxText(findings)));
		const main = await openMain(full, { level: "high", object: "a.ts", criterion: "c", agreement: "", rejected: "" });
		try {
			await main.session.prompt(SECOND);
			const turn = await within(main.verdictTurn, 5000, "verdict turn");
			await main.session.waitForIdle();
			assert.equal(requests.length, 1);
			assert.equal(requests[0].model, "claude-sonnet-5-5");
			assert.equal(requests[0].reasoning, "low");
			assert.ok(!requests[0].text.includes("<agreement>") && !requests[0].text.includes("<rejected_earlier>"));
			assert.equal(turn, `[review#1] ${findings}`);
		} finally {
			main.session.dispose();
		}
	});

	const failures: [string, () => ModelRuntime, string][] = [
		["a missing reviewer model", () => otherModels, "[review#1] Review failed: model anthropic/claude-haiku-5-5 is not available"],
		[
			"missing credentials",
			() => mainOnly,
			"[review#1] Review failed: no credentials for anthropic (model anthropic/claude-haiku-5-5)",
		],
	];
	for (const [what, runtime, expected] of failures) {
		it(`${what} gives a failure message and no reviewer request`, async () => {
			const requests = scriptReviewer(() => fauxAssistantMessage(fauxText("CLEAN")));
			const main = await openMain(runtime(), { level: "blind", object: "a.ts", criterion: "c" });
			try {
				await main.session.prompt(SECOND);
				const turn = await within(main.verdictTurn, 5000, "verdict turn");
				await main.session.waitForIdle();
				assert.equal(turn, expected);
				assert.equal(requests.length, 0);
			} finally {
				main.session.dispose();
			}
		});
	}

	it("a failed reviewer request gives a failure message with the provider's error", async () => {
		scriptReviewer(() => fauxAssistantMessage(fauxText(""), { stopReason: "error", errorMessage: "invalid_request_error: bad schema" }));
		const main = await openMain(full, { level: "blind", object: "a.ts", criterion: "c" });
		try {
			await main.session.prompt(SECOND);
			const turn = await within(main.verdictTurn, 5000, "verdict turn");
			await main.session.waitForIdle();
			assert.match(turn, /^\[review#1\] Review failed: .*bad schema/);
		} finally {
			main.session.dispose();
		}
	});

	it("session_shutdown aborts a running review and delivers nothing", async () => {
		const aborted = Promise.withResolvers<void>();
		const started = Promise.withResolvers<void>();
		scriptReviewer((_context, options) => {
			started.resolve();
			// Hang until the reviewer session is aborted.
			const answer = Promise.withResolvers<AssistantMessage>();
			options?.signal?.addEventListener("abort", () => {
				aborted.resolve();
				answer.resolve(fauxAssistantMessage(fauxText("late")));
			});
			return answer.promise;
		});
		const main = await openMain(full, { level: "blind", object: "a.ts", criterion: "c" });
		try {
			await main.session.prompt(SECOND);
			await within(started.promise, 5000, "reviewer request");
			await main.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
			await within(aborted.promise, 5000, "reviewer abort");
			// A delivery would follow the abort within a few event-loop turns; absence has no event to await.
			await new Promise((resolve) => setTimeout(resolve, 100));
			assert.equal(reviewMessages(main.session).length, 0);
		} finally {
			main.session.dispose();
		}
	});

	it("without the extension the main model has no review tool", async () => {
		const main = await openMain(full, {}, false);
		try {
			await main.session.prompt("hello");
			assert.equal(main.tools.find((t) => t.name === "review"), undefined);
		} finally {
			main.session.dispose();
		}
	});
});

describe("brief", () => {
	it("labels compaction and branch summaries and numbers only the user's messages", async () => {
		const base = { id: "x", parentId: null, timestamp: "" };
		const entries = [
			{ ...base, type: "message", message: { role: "user", content: "one", timestamp: 0 } },
			{ ...base, type: "message", message: { role: "assistant", content: [{ type: "text", text: "proposal" }] } },
			{ ...base, type: "compaction", summary: "S", firstKeptEntryId: "x", tokensBefore: 1 },
			{ ...base, type: "branch_summary", fromId: "x", summary: "B" },
			{ ...base, type: "message", message: { role: "user", content: [{ type: "text", text: "two" }, { type: "image" }], timestamp: 0 } },
		] as unknown as SessionEntry[];
		const brief = buildBrief(entries, { level: "blind", object: "o", criterion: "c" });
		assert.equal(
			brief,
			[
				"<user_messages>",
				'<message n="1">\none\n</message>',
				"",
				`<compaction_summary note="written by the main model when it compacted the context, not the user's words">\nS\n</compaction_summary>`,
				"",
				`<branch_summary note="written by the main model for an abandoned branch, not the user's words">\nB\n</branch_summary>`,
				"",
				'<message n="2">\ntwo\n[image]\n</message>',
				"</user_messages>",
				"",
				"<object>\no\n</object>",
				"",
				"<criterion>\nc\n</criterion>",
			].join("\n"),
		);
	});
});
