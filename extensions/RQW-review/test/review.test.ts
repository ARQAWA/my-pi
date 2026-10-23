// The review tool inside real Pi sessions, no model. The main session loads the extension from its file the way Pi
// loads a package extension; two faux providers stand in for the main model and for the reviewer models
// (`anthropic/claude-haiku-5-5`, `anthropic/claude-sonnet-5-5`), and record every request they get.
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { after, before, describe, it } from "node:test";
import { setImmediate as nextLoop } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
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
import { validateToolArguments } from "@earendil-works/pi-ai/utils/validation";
import {
	AgentSession,
	createAgentSession,
	createEventBus,
	createGrepToolDefinition,
	DefaultResourceLoader,
	ModelRuntime,
	type SessionEntry,
	SessionManager,
	SettingsManager,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { buildBrief, candidates, DESCRIPTION, disputes, familyOf, findingBlocks, LEVELS, NEXT, refusals, REVIEWER_TOOLS, reviewerTools, settle, startedText, verdictMessage, verdictOf } from "../index.ts";
import { blockedGit } from "../git-guard.ts";

const kindOfMessage = (verdict: string) => verdictMessage(1, verdict, false).split("\n\n").at(-1);

/** The delivered message of review `n` for a verdict of each kind: the verdict verbatim, then the next step. */
const clean = (n = 1) => `[review#${n}] CLEAN\n\n${NEXT.clean}`;
/** A reply that is neither CLEAN nor a complete FINDINGS verdict is incomplete and gets the incomplete paragraph. */
const other = (verdict: string, n = 1) => `[review#${n}] ${verdict}\n\n${NEXT.incomplete}`;
/** Four filled required fields of one finding, the smallest complete block body. */
const FIELDS = (tag = "x") => `REQUIREMENT: ${tag}\nMISMATCH: y\nEVIDENCE: z (a.ts)\nREQUIRED OUTCOME: w`;
const failedWith = (reason: string) => `[review#1] Review failed: ${reason}\n\n${NEXT.failed}`;

const EXTENSION = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");
const REVIEWER_SOURCE = readFileSync(join(dirname(EXTENSION), "REVIEWER.md"), "utf8").replace(/\r\n/g, "\n");
const REVIEWER = REVIEWER_SOURCE.trimEnd();

type Factory = (context: TranscriptContext, options: SimpleStreamOptions | undefined) => AssistantMessage | Promise<AssistantMessage>;
type Request = { model: string; reasoning?: string; system: string; tools: string[]; text: string; messages: number };
type Declared = { name: string; description: string; parameters: Record<string, unknown> };

const mainFaux = fauxProvider({ provider: "main", models: [{ id: "main" }] });
// A main agent of the GPT family, and the GPT reviewers (`openai-codex/gpt-5.6-luna`).
const gptMainFaux = fauxProvider({ provider: "openai", models: [{ id: "gpt-main" }] });
const gptReviewerFaux = fauxProvider({ provider: "openai-codex", models: [{ id: "gpt-5.6-luna", reasoning: true }] });
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
let gptMainBoth: ModelRuntime;
let gptMainClaudeOnly: ModelRuntime;
let unknownMainGptOnly: ModelRuntime;

before(async () => {
	root = await mkdtemp(join(tmpdir(), "rqw-review-"));
	agentDir = join(root, "agent");
	await mkdir(agentDir, { recursive: true });
	const runtime = async (...reviewers: (typeof reviewerFaux)[]) => {
		const r = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
		r.registerNativeProvider(mainFaux.provider);
		r.registerNativeProvider(gptMainFaux.provider);
		for (const reviewer of reviewers) r.registerNativeProvider(reviewer.provider);
		return r;
	};
	full = await runtime(reviewerFaux);
	gptMainBoth = await runtime(reviewerFaux, gptReviewerFaux);
	// The catalog lists openai-codex too, but no credentials are configured for it.
	gptMainClaudeOnly = await runtime(reviewerFaux);
	unknownMainGptOnly = await runtime(gptReviewerFaux);
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
function scriptReviewer(answer: Factory, faux: typeof reviewerFaux = reviewerFaux): Request[] {
	const requests: Request[] = [];
	const step = (context: TranscriptContext, options: SimpleStreamOptions | undefined, _state: unknown, model: Model<string>) => {
		const users = context.messages.filter((m) => m.role === "user");
		requests.push({
			model: model.id,
			reasoning: options?.reasoning,
			system: systemText(context),
			tools: declaredTools(context).map((t) => t.name).sort(),
			text: textOf(users.at(-1)?.content),
			messages: context.messages.filter((m) => m.role !== "system").length,
		});
		return answer(context, options);
	};
	faux.setResponses(Array.from({ length: 5 }, () => step));
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
async function openMain(
	runtime: ModelRuntime,
	args: Record<string, unknown>,
	withExtension = true,
	// Pi's default for an SDK session is "print", where the main run waits for its reviews.
	mode: "tui" | "rpc" | "print" | "json" = "tui",
	// Other extensions, loaded after this one.
	extra: string[] = [],
	before: string[] = [],
	mainProvider: typeof mainFaux = mainFaux,
): Promise<Main> {
	const dir = join(root, `w${counter++}`);
	await mkdir(dir, { recursive: true });
	const resourceLoader = new DefaultResourceLoader({
		cwd: dir,
		agentDir,
		additionalExtensionPaths: withExtension ? [...before, EXTENSION, ...extra] : [...before, ...extra],
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
		model: mainProvider.getModel(),
		thinkingLevel: "off",
		modelRuntime: runtime,
		resourceLoader,
		sessionManager: SessionManager.inMemory(dir),
		settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }),
	});
	await session.bindExtensions({ mode });

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
	mainProvider.setResponses(Array.from({ length: 10 }, () => step));
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

describe("measured reviewer prompt contract", () => {
	it("loads a CRLF checkout through the production loader as canonical LF", async () => {
		const dir = await mkdtemp(join(dirname(EXTENSION), ".crlf-test-"));
		try {
			await writeFile(join(dir, "index.ts"), readFileSync(EXTENSION, "utf8"));
			await writeFile(join(dir, "git-guard.ts"), readFileSync(join(dirname(EXTENSION), "git-guard.ts"), "utf8"));
			await writeFile(join(dir, "fast-gpt.ts"), readFileSync(join(dirname(EXTENSION), "fast-gpt.ts"), "utf8"));
			await writeFile(join(dir, "counts.ts"), readFileSync(join(dirname(EXTENSION), "counts.ts"), "utf8"));
			const crlf = REVIEWER_SOURCE.replace(/\n/g, "\r\n");
			assert.equal(createHash("sha256").update(crlf).digest("hex"),
				"dd7eb761e6ac52d35f7b2e0dfa0a9c3d0d7c1f7a89567c9a22ddd59c3185a476");
			await writeFile(join(dir, "REVIEWER.md"), crlf);
			const loaded = await import(pathToFileURL(join(dir, "index.ts")).href);
			assert.equal(loaded.REVIEWER, REVIEWER);
			assert.ok(!loaded.REVIEWER.includes("\r"));
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("loads the deep reviewer prompt byte for byte, with the dispute rules and criterion-only checks in scope", () => {
		assert.equal(createHash("sha256").update(REVIEWER_SOURCE).digest("hex"),
			"68664f5cafa8a79f1cb6b29c822ab2cf934a83b1fbe11e5e99c537f274e66542");
		assert.ok(REVIEWER.startsWith("You are a blind reviewer on Main's team"));
		assert.ok(!REVIEWER.includes("Repeat a rejected finding only when"), "the quote-equals-admitted rule is gone");
		assert.ok(REVIEWER.includes("Answer every dispute with status `open` on its merits"));
		assert.ok(REVIEWER.includes("RULING is `DECIDED` when the user's own words, quoted verbatim in REQUIREMENT") && REVIEWER.includes("RULING is `UNDECIDED` when the user's words do not state it"));
		assert.ok(REVIEWER.includes("A rebuttal shows this only when its quote, read with the user's messages and the agreement, rules the finding out"), "strict withdrawal test");
		assert.ok(REVIEWER.includes("A withdrawal is silent: never write that a dispute is withdrawn"), "silent withdrawal");
		assert.ok(REVIEWER.includes("Test: if you would have to invent the number or rule to write the REQUIRED OUTCOME from the user's words alone, the ruling is `UNDECIDED`."));
		assert.ok(!REVIEWER.includes("or REQUIREMENT would be `NOT AGREED`"), "no NOT AGREED clause in the UNDECIDED test");
		assert.ok(REVIEWER.includes("Exception to the two rulings and the test: an addition the user never asked for (an extra feature, output, option or file) that Main defends only as useful or harmless is a finding with REQUIREMENT `NOT AGREED` and RULING `DECIDED`; Main removes it without asking the user."),
			"an unagreed addition that Main defends is DECIDED, Main removes it");
		assert.ok(REVIEWER.includes("If it shows it, leave the finding out; that withdraws it."));
		assert.ok(REVIEWER.includes("that it demands what the agreement does not ask for or changes a settled decision"), "outside the agreement: withdrawn");
		assert.ok(REVIEWER.includes("or Main made a choice of its own that differs from what the user said"), "Main's own choice: the user decides");
		assert.ok(REVIEWER.includes("DISPUTE: <id of the disputed finding you repeat"));
		assert.ok(REVIEWER.includes("Review independently: Main's verdict is not evidence."));
		assert.ok(REVIEWER.includes("including custom criteria beyond the agreement"));
		assert.ok(REVIEWER.includes("do not report what it excludes or leaves to another pass"));
		assert.ok(REVIEWER.includes("the agreement or criterion with its source"));
		assert.ok(REVIEWER.includes("REQUIREMENT: <verbatim quote of the agreement or criterion with its source"));
		assert.ok(DESCRIPTION.includes("criterion, including checks beyond the agreement and exclusions"));
		assert.ok(!DESCRIPTION.includes("read-only"), "no stale read-only claim");
		assert.ok(DESCRIPTION.length <= 600);
		assert.ok(DESCRIPTION.endsWith("By default a reviewer inherits GPT Fast; pass fast_gpt false when the user forbids Fast for subagents."));
	});
	it("keeps the deep read constraints, the run-result prohibition and the exact clean verdict contract", () => {
		assert.ok(REVIEWER.includes("Start by reading whole every path the brief names, the diff included."));
		assert.ok(REVIEWER.includes("`read` returns the file text without line numbers"));
		assert.ok(REVIEWER.includes("Never give or work out line numbers"));
		assert.ok(REVIEWER.includes("Never edit files or change git state, and never run the delivered result itself (for autotest work, not the autotests)."));
		assert.ok(REVIEWER.includes("Reply with the result of the review as your last message"));
		assert.ok(REVIEWER.includes("With no findings, return exactly `CLEAN`"));
		assert.ok(!REVIEWER.includes("Omit offset and limit on initial reads"), "the non-deep prompt is gone");
		assert.ok(!REVIEWER.includes("yield"));
	});
	it("pins the explicit deadline and the four reviewer tools", () => {
		assert.equal(TIMEOUT_MS, 30 * 60 * 1000);
		assert.deepEqual(REVIEWER_TOOLS, ["read", "bash", "grep", "find"]);
	});
});

describe("verdict classification", () => {
	it("passes only exact CLEAN after trimming surrounding whitespace", () => {
		for (const verdict of ["CLEAN", " \nCLEAN\t "]) {
			assert.equal(verdictMessage(1, verdict, false), `[review#1] ${verdict}\n\n${NEXT.clean}`);
		}
	});
	it("treats CLEAN with UNCHECKED or FINDINGS as incomplete, preserving the verdict", () => {
		for (const verdict of ["CLEAN\nUNCHECKED:\n- source.ts could not read", "CLEAN\nFINDINGS:\nFINDING 1", "CLEAN extra text"]) {
			assert.equal(verdictMessage(2, verdict, false), `[review#2] ${verdict}\n\n${NEXT.incomplete}`);
			assert.ok(!verdictMessage(2, verdict, false).includes(NEXT.findings));
		}
	});
	it("keeps ordinary findings and provider failures on their own paths", () => {
		const findings = `FINDINGS:\nFINDING 1\n${FIELDS()}`;
		assert.equal(verdictMessage(3, findings, false), `[review#3] ${findings}\n\n${NEXT.findings}`);
		const withUnchecked = `${findings}\nUNCHECKED:\n- a.ts - unreadable`;
		assert.equal(verdictMessage(3, withUnchecked, false), `[review#3] ${withUnchecked}\n\n${NEXT.findings}`);
		assert.equal(verdictMessage(4, "Review failed: provider error", true), `[review#4] Review failed: provider error\n\n${NEXT.failed}`);
	});
});

describe("review tool", () => {
	it("reviewer requests never arm a warmer, independently of the main settings", async t => {
		const sessions: AgentSession[] = [];
		const original = (AgentSession.prototype as any)._bindExtensionCore;
		t.mock.method(AgentSession.prototype as any, "_bindExtensionCore", function(this: AgentSession, ...args: unknown[]) {
			sessions.push(this);
			return original.apply(this, args);
		});
		const g = gate("CLEAN");
		let count = 0;
		const reviews = scriptReviewer((_c, options) => ++count === 1 ? g.reply(options?.signal) : fauxAssistantMessage("ok"));
		const main = await openMain(full, { level: "blind", object: "a.ts", criterion: "c" });
		try {
			main.session.setCacheWarmingMode("idle");
			await main.session.prompt(SECOND);
			await until(() => reviews.length === 1, "reviewer request");
			const child = sessions.find(s => s !== main.session)!;
			assert.equal(child.settingsManager.getGlobalSettings().cacheWarming, "off");
			await (await child.agent.streamFunction({ ...child.model!, promptCache: { short: 300 } },
				{ messages: [{ role: "user", content: "cache probe", timestamp: 0 }] }, { sessionId: child.sessionId })).result();
			assert.deepEqual(child.cacheWarmingStatus, { state: "inactive", reason: "cache warming disabled" });
		} finally {
			g.release();
			await within(main.verdictTurn, 5000, "verdict");
			await main.session.waitForIdle();
			main.session.dispose();
		}
	});
	it("is registered with a short description and a strict-mode schema", async () => {
		scriptReviewer(() => fauxAssistantMessage(fauxText("CLEAN")));
		const main = await openMain(full, { level: "blind", object: "a.ts", criterion: "c" });
		try {
			await main.session.prompt("hello");
			const review = main.tools.find((t) => t.name === "review");
			assert.ok(review, "the main model sees a review tool");
			assert.ok(review.description.length <= 600, `description is ${review.description.length} characters`);
			assert.match(review.description, /\[review#N\]/);
			assert.equal(review.description, DESCRIPTION);
			assert.ok(review.description.includes("works with you as one team for the user's agreement"), "the teammate sentence");
			const strict = makeStrictJsonSchema(structuredClone(review.parameters) as never);
			assert.deepEqual(Object.keys((strict as { properties: object }).properties).sort(), [
				"agreement",
				"criterion",
				"fast_gpt",
				"level",
				"object",
				"rebuttals",
			]);
			const rebuttal = (strict as { properties: { rebuttals: { anyOf: { items: { required: string[] } }[] } } }).properties.rebuttals.anyOf[0].items;
			assert.deepEqual(rebuttal.required.sort(), ["explanation", "finding", "quote", "source"]);
			assert.ok(review.description.includes("You may rebut a finding once, with proof; the next reviewer's answer is final."));
			assert.deepEqual((review.parameters as { required: string[] }).required.sort(), ["criterion", "level", "object"]);
		} finally {
			main.session.dispose();
		}
	});

	it("blind: Haiku medium, REVIEWER.md as the prompt, read/bash/grep/find only, the user's words verbatim, verdict as a follow-up", async () => {
		const requests = scriptReviewer(() => fauxAssistantMessage(fauxText("CLEAN")));
		const args = {
			level: "blind",
			object: "a.ts; stage pre-completion",
			criterion: "Everything agreed is done.",
			agreement: "Proposal accepted: keep the old name as an alias.",
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
			assert.deepEqual(r.tools, ["bash", "find", "grep", "read"]);

			assert.ok(r.text.includes(`<message n="1">\n${FIRST}\n</message>`), "first user message verbatim");
			assert.ok(r.text.includes(`<message n="2">\n${SECOND}\n</message>`), "second user message verbatim");
			assert.ok(r.text.indexOf(FIRST) < r.text.indexOf(SECOND), "in order");
			assert.ok(!r.text.includes("waiting") && !r.text.includes("\nok\n"), "no assistant text");
			assert.ok(r.text.includes(`<agreement>\n${args.agreement}\n</agreement>`));
			assert.ok(r.text.includes(`<object>\n${args.object}\n</object>`));
			assert.ok(r.text.includes(`<criterion>\n${args.criterion}\n</criterion>`));
			assert.ok(!r.system.includes("RQW-prompt/SYSTEM.md"), "no main prompt reference");
			assert.ok(!r.text.includes("<disputes>"), "no disputes section without a rebuttal");

			assert.equal(turn, clean(), "the verdict started a main turn");
			const delivered = reviewMessages(main.session);
			assert.equal(delivered.length, 1);
			assert.equal(delivered[0]?.content, clean());
			assert.ok(clean().endsWith("\n\nThe check passed; run no further pass for confidence."), "the CLEAN paragraph");
			assert.equal(delivered[0]?.display, true);
			assert.deepEqual(
				{ ...(delivered[0]?.details as Record<string, unknown>), seconds: 0 },
				{ n: 1, level: "blind", model: "anthropic/claude-haiku-5-5", thinking: "medium", seconds: 0 },
			);
			const result = main.session.messages.find((m) => m.role === "toolResult" && m.toolName === "review");
			assert.equal(result?.role === "toolResult" ? textOf(result.content) : "", startedText(1));
			assert.equal(startedText(1), "review#1 started. Keep working, but leave the reviewed files unchanged until its verdict.");
		} finally {
			main.session.dispose();
		}
	});

	it("high: Sonnet low; empty optional fields are left out; the verdict text is passed through", async () => {
		const findings = "FINDINGS:\nFINDING 1\nREQUIREMENT: x\nMISMATCH: y\nEVIDENCE: z (a.ts)\nREQUIRED OUTCOME: w";
		const requests = scriptReviewer(() => fauxAssistantMessage(fauxText(findings)));
		const main = await openMain(full, { level: "high", object: "a.ts", criterion: "c", agreement: "", rebuttals: [] });
		try {
			await main.session.prompt(SECOND);
			const turn = await within(main.verdictTurn, 5000, "verdict turn");
			await main.session.waitForIdle();
			assert.equal(requests.length, 1);
			assert.equal(requests[0].model, "claude-sonnet-5-5");
			assert.equal(requests[0].reasoning, "low");
			assert.ok(!requests[0].text.includes("<agreement>") && !requests[0].text.includes("<disputes>"));
			assert.ok(requests[0].text.includes("<criterion>\nc\n</criterion>"), "criterion survives without agreement");
			assert.equal(turn, `[review#1] ${findings}\n\nFinding ids: FINDING 1 = 1.1.\n\n${NEXT.findings}`);
			for (const rule of [
				"Find each quote by searching for it.",
				"Fix each new finding exactly to its REQUIRED OUTCOME and no further, unless you can prove the reviewer misunderstood",
				"rebut it once in `rebuttals` with its id, an exact quote from a file or from the user's messages, that source, and why the finding is wrong.",
				"Without such proof, fix it.",
				"But a finding that rests on a value, rule or choice the user never gave is not yours to settle: put it to the user and follow the user's decision; do not fix it with another choice of your own.",
				"Fix all the others in one batch, then call `review` again with the same level, object and criterion and your new rebuttals, until CLEAN.",
				"A finding that demands what the agreement does not ask for, or changes a settled decision, is such a misreading: rebut it with the quote of the agreement.",
				"Earlier disputes go to the next reviewer by themselves; its answer on each is final.",
			])
				assert.ok(turn.endsWith(NEXT.findings) && NEXT.findings.includes(rule), rule);
			for (const gone of ["do not reject it, argue with it or put it to the user", "`rejected`"]) assert.ok(!NEXT.findings.includes(gone), gone);
		} finally {
			main.session.dispose();
		}
	});

	it("the family table: Claude main uses Haiku and Sonnet, GPT main uses GPT-5.6-Luna, anything else starts with Claude", () => {
		assert.deepEqual(LEVELS.claude, {
			blind: { provider: "anthropic", model: "claude-haiku-5-5", thinking: "medium" },
			high: { provider: "anthropic", model: "claude-sonnet-5-5", thinking: "low" },
		});
		assert.deepEqual(LEVELS.gpt, {
			blind: { provider: "openai-codex", model: "gpt-5.6-luna", thinking: "medium" },
			high: { provider: "openai-codex", model: "gpt-5.6-luna", thinking: "high" },
		});
		for (const [model, family] of [
			[{ provider: "anthropic", id: "claude-opus-5-5" }, "claude"],
			[{ provider: "openrouter", id: "claude-sonnet-5-5" }, "claude"],
			[{ provider: "openai-codex", id: "gpt-6.1-sol" }, "gpt"],
			[{ provider: "openai", id: "gpt-6-sol" }, "gpt"],
			[{ provider: "github-copilot", id: "gpt-5.5" }, "gpt"],
			[{ provider: "google", id: "gemini-3" }, undefined],
			[undefined, undefined],
		] as const) assert.equal(familyOf(model), family, JSON.stringify(model));
		assert.deepEqual(candidates("blind", { provider: "anthropic", id: "claude-opus-5-5" }), [LEVELS.claude.blind, LEVELS.gpt.blind]);
		assert.deepEqual(candidates("high", { provider: "openai-codex", id: "gpt-6.1-sol" }), [LEVELS.gpt.high, LEVELS.claude.high]);
		assert.deepEqual(candidates("high", undefined), [LEVELS.claude.high, LEVELS.gpt.high]);
	});

	for (const [level, thinking] of [["blind", "medium"], ["high", "high"]] as const) {
		it(`GPT main, ${level}: GPT-5.6-Luna ${thinking}`, async () => {
			const requests = scriptReviewer(() => fauxAssistantMessage(fauxText("CLEAN")), gptReviewerFaux);
			const claudeRequests = scriptReviewer(() => fauxAssistantMessage(fauxText("CLEAN")));
			const main = await openMain(gptMainBoth, { level, object: "a.ts", criterion: "c" }, true, "tui", [], [], gptMainFaux);
			try {
				await main.session.prompt(SECOND);
				const turn = await within(main.verdictTurn, 5000, "verdict turn");
				await main.session.waitForIdle();
				assert.equal(turn, clean());
				assert.equal(claudeRequests.length, 0, "no Claude reviewer");
				assert.equal(requests.length, 1);
				assert.equal(requests[0].model, "gpt-5.6-luna");
				assert.equal(requests[0].reasoning, thinking);
				assert.ok(requests[0].system.startsWith(REVIEWER), "the same REVIEWER.md");
				assert.deepEqual(requests[0].tools, ["bash", "find", "grep", "read"]);
				assert.deepEqual(
					{ ...(reviewMessages(main.session)[0]?.details as Record<string, unknown>), seconds: 0 },
					{ n: 1, level, model: "openai-codex/gpt-5.6-luna", thinking, seconds: 0 },
				);
			} finally {
				main.session.dispose();
			}
		});
	}

	it("GPT main without GPT credentials falls back to the Claude reviewer of the level", async () => {
		const requests = scriptReviewer(() => fauxAssistantMessage(fauxText("CLEAN")));
		const main = await openMain(gptMainClaudeOnly, { level: "high", object: "a.ts", criterion: "c" }, true, "tui", [], [], gptMainFaux);
		try {
			await main.session.prompt(SECOND);
			const turn = await within(main.verdictTurn, 5000, "verdict turn");
			await main.session.waitForIdle();
			assert.equal(turn, clean());
			assert.deepEqual(requests.map((r) => [r.model, r.reasoning]), [["claude-sonnet-5-5", "low"]]);
			assert.deepEqual(
				{ ...(reviewMessages(main.session)[0]?.details as Record<string, unknown>), seconds: 0 },
				{ n: 1, level: "high", model: "anthropic/claude-sonnet-5-5", thinking: "low", seconds: 0 },
			);
		} finally {
			main.session.dispose();
		}
	});

	it("a main agent of neither family without Anthropic credentials falls back to the GPT reviewer", async () => {
		const requests = scriptReviewer(() => fauxAssistantMessage(fauxText("CLEAN")), gptReviewerFaux);
		const main = await openMain(unknownMainGptOnly, { level: "blind", object: "a.ts", criterion: "c" });
		try {
			await main.session.prompt(SECOND);
			const turn = await within(main.verdictTurn, 5000, "verdict turn");
			await main.session.waitForIdle();
			assert.equal(turn, clean());
			assert.deepEqual(requests.map((r) => [r.model, r.reasoning]), [["gpt-5.6-luna", "medium"]]);
		} finally {
			main.session.dispose();
		}
	});

	it("prose before the first line that is exactly FINDINGS: is dropped from the verdict and finding ids are assigned", async () => {
		const body = "FINDINGS:\nFINDING 1\nREQUIREMENT: x\nMISMATCH: y\nEVIDENCE: z (a.ts)\nREQUIRED OUTCOME: w";
		const requests = scriptReviewer(() => fauxAssistantMessage(fauxText(`Dispute 1.1 holds, so I leave it out.\n${body}`)));
		const main = await openMain(full, { level: "blind", object: "a.ts", criterion: "c" });
		try {
			await main.session.prompt(SECOND);
			const turn = await within(main.verdictTurn, 5000, "verdict turn");
			await main.session.waitForIdle();
			assert.equal(requests.length, 1);
			assert.equal(turn, `[review#1] ${body}\n\nFinding ids: FINDING 1 = 1.1.\n\n${NEXT.findings}`);
		} finally {
			main.session.dispose();
		}
	});

	it("verdictOf starts at a line that is exactly FINDINGS: and touches nothing else", () => {
		const body = `FINDINGS:\nFINDING 1\n${FIELDS()}`;
		assert.equal(verdictOf(`remark\n${body}`), body);
		assert.equal(verdictOf(`remark\r\nmore\r\n${body.replace(/\n/g, "\r\n")}\r\n`), body.replace(/\n/g, "\r\n"));
		assert.equal(verdictOf(`  \n${body}\n`), body, "plain surrounding whitespace");
		assert.equal(verdictOf("CLEAN"), "CLEAN");
		assert.equal(verdictOf("remark\nCLEAN"), "remark\nCLEAN", "prose before CLEAN stays incomplete");
		assert.equal(verdictOf("I think FINDINGS: none"), "I think FINDINGS: none", "not a line of its own");
		assert.equal(verdictOf("remark\n  FINDINGS: x\nmore"), "remark\n  FINDINGS: x\nmore", "the line must be exactly FINDINGS:");
		assert.equal(verdictOf("CLEAN\nFINDINGS:\nFINDING 1"), "CLEAN\nFINDINGS:\nFINDING 1", "a CLEAN start is not rewritten");
		assert.equal(kindOfMessage(verdictOf(`remark\n${body}`)), NEXT.findings);
	});

	const failures: [string, () => ModelRuntime, string][] = [
		[
			"a missing reviewer model, with the other family unavailable too",
			() => otherModels,
			failedWith("model anthropic/claude-haiku-5-5 is not available; no credentials for openai-codex (model openai-codex/gpt-5.6-luna)"),
		],
		[
			"missing credentials for both families",
			() => mainOnly,
			failedWith("no credentials for anthropic (model anthropic/claude-haiku-5-5); no credentials for openai-codex (model openai-codex/gpt-5.6-luna)"),
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
				assert.ok(
					turn.endsWith("\n\nThe check has not passed, and no self-check replaces it. Call `review` again once on the unchanged object; if it fails again, tell the user and wait."),
					"the failure paragraph",
				);
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
			assert.match(turn, /^\[review#1\] Review failed: .*bad schema\n\n/);
			assert.ok(turn.endsWith(`\n\n${NEXT.failed}`), "a failed request gets the failure paragraph, not the findings one");
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

type Reply = AssistantMessage | ((signal?: AbortSignal) => Promise<AssistantMessage>);

/** The main model takes `replies` in order, then answers "ok"; returns the texts of every request, one list each. */
function scriptMain(replies: Reply[]): string[][] {
	const requests: string[][] = [];
	const step = (context: TranscriptContext, options: SimpleStreamOptions | undefined) => {
		requests.push(context.messages.filter((m) => m.role !== "system").map((m) => textOf("content" in m ? m.content : "")));
		const reply = replies.shift();
		if (!reply) return fauxAssistantMessage(fauxText("ok"));
		return typeof reply === "function" ? reply(options?.signal) : reply;
	};
	mainFaux.setResponses(Array.from({ length: 20 }, () => step));
	return requests;
}

/** A reply that waits until `release()` or an abort. */
function gate(text: string) {
	let release = () => {};
	const reply = (signal?: AbortSignal) => {
		const { promise, resolve } = Promise.withResolvers<AssistantMessage>();
		release = () => resolve(fauxAssistantMessage(fauxText(text)));
		signal?.addEventListener("abort", () => resolve(fauxAssistantMessage(fauxText(text))));
		return promise;
	};
	return { reply, release: () => release() };
}

// Reviews and deliveries run inside Pi with no promise exposed to the test, so the test polls for their visible
// result; `tick` gives a message that must not come a chance to arrive before the check.
async function until(check: () => boolean, what: string, ms = 5000) {
	const end = Date.now() + ms;
	while (!check()) {
		if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
		await new Promise((r) => setTimeout(r, 5));
	}
}
const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

const ARGS = { level: "blind", object: "a.ts", criterion: "c" };
// A second extension with a slow async agent_before_settle handler, held by the test through `globalThis.__slowSettle`.
const SLOW_SETTLE = join(dirname(fileURLToPath(import.meta.url)), "slow-settle.ts");
const callReview = () => fauxAssistantMessage(fauxToolCall("review", ARGS, { id: "r1" }), { stopReason: "toolUse" });
const delivered = (session: AgentSession) => reviewMessages(session).map((m) => m?.content);
const lastText = (session: AgentSession) => {
	const last = session.messages.at(-1);
	return last?.role === "assistant" ? textOf(last.content) : `(${last?.role})`;
};

describe("delivery", () => {
	for (const mode of ["print", "json"] as const) {
		it(`${mode} mode: the main run waits for a running review and its verdict continues that run`, async () => {
			const reviewer = gate("CLEAN");
			const reviews = scriptReviewer((_context, options) => reviewer.reply(options?.signal));
			const main = await openMain(full, ARGS, true, mode);
			const requests = scriptMain([callReview(), fauxAssistantMessage(fauxText("started")), fauxAssistantMessage(fauxText("done"))]);
			try {
				let settled = false;
				const run = main.session.prompt("Review it").then(() => {
					settled = true;
				});
				await until(() => reviews.length === 1 && requests.length === 2, "the review request");
				await tick();
				assert.equal(settled, false, "the main run waits for the review");
				reviewer.release();
				await within(run, 5000, "the main run");
				assert.deepEqual(delivered(main.session), [clean()]);
				assert.equal(requests.length, 3, "one more request, in the same run");
				assert.equal(requests[2].filter((t) => t === clean()).length, 1);
				assert.equal(lastText(main.session), "done");
			} finally {
				main.session.dispose();
			}
		});
	}

	/** The main agent calls review, then streams a reply held by `mainGate` while the verdict arrives. */
	async function verdictWhileBusy(mode: "tui" | "rpc") {
		const reviews = scriptReviewer(() => fauxAssistantMessage(fauxText("CLEAN")));
		const main = await openMain(full, ARGS, true, mode);
		const mainGate = gate("main busy");
		const requests = scriptMain([callReview(), mainGate.reply]);
		const run = main.session.prompt("Review it");
		await until(() => reviews.length === 1 && requests.length === 2, "main busy, review answered");
		// The reviewer session ends and the verdict is sent within a few event-loop turns.
		await tick(200);
		return { main, mainGate, requests, run };
	}

	/** After an abort: the verdict is in the session once, no run starts for it, the next prompt carries it once. */
	async function checkKeptAfterAbort(main: Main, requests: string[][]) {
		await tick(200);
		assert.deepEqual(delivered(main.session), [clean()], "the verdict is in the session");
		assert.equal(requests.length, 2, "no run starts after the abort");
		assert.equal(main.session.agent.hasQueuedMessages(), false, "nothing left in the queue");
		await main.session.prompt("next");
		await tick();
		assert.equal(requests.length, 3, "one request for the next prompt");
		assert.equal(requests[2].filter((t) => t === clean()).length, 1, "the model sees it once");
		assert.deepEqual(delivered(main.session), [clean()]);
	}

	it("a verdict that arrives while the main agent streams continues its run once", async () => {
		const { main, mainGate, requests, run } = await verdictWhileBusy("tui");
		try {
			assert.deepEqual(delivered(main.session), [], "held until the turn ends");
			mainGate.release();
			await within(run, 5000, "the main run");
			await tick();
			assert.deepEqual(delivered(main.session), [clean()]);
			assert.equal(requests.length, 3);
			assert.equal(requests[2].filter((t) => t === clean()).length, 1);
		} finally {
			main.session.dispose();
		}
	});

	it("two verdicts while another extension's slow agent_before_settle runs after ours get one main turn", async () => {
		const slow = ((globalThis as { __slowSettle?: { enabled: boolean; entered: boolean; release: () => void } }).__slowSettle ??= {
			enabled: false,
			entered: false,
			release: () => {},
		});
		slow.enabled = true;
		slow.entered = false;
		const gates = [gate("R1"), gate("R2")];
		const reviews = scriptReviewer((_context, options) => {
			const g = gates[reviews.length - 1];
			return g.reply(options?.signal);
		});
		const main = await openMain(full, ARGS, true, "tui", [SLOW_SETTLE]);
		const requests = scriptMain([
			fauxAssistantMessage([fauxToolCall("review", ARGS, { id: "r1" }), fauxToolCall("review", ARGS, { id: "r2" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage(fauxText("started both")),
		]);
		try {
			const run = main.session.prompt("Review it");
			await until(() => slow.entered && reviews.length === 2, "the main run in the slow handler");
			for (const g of gates) g.release();
			// The reviewer sessions end and the verdicts are sent while the slow handler still runs.
			await tick(200);
			slow.enabled = false;
			slow.release();
			await within(run, 5000, "the main run");
			await until(() => requests.length === 3, "the turn for the verdicts");
			await tick(300);
			await main.session.waitForIdle();
			assert.equal(requests.length, 3, "the prompt, the tool turn and one turn for both verdicts");
			assert.deepEqual(delivered(main.session).sort(), [other("R1", 1), other("R2", 2)]);
			for (const v of [other("R1", 1), other("R2", 2)]) assert.equal(requests[2].filter((t) => t === v).length, 1, v);
			assert.equal(lastText(main.session), "ok");
		} finally {
			slow.enabled = false;
			main.session.dispose();
		}
	});

	it("TUI Esc while a verdict waits: the verdict is kept, no run starts, the next prompt carries it", async () => {
		const { main, requests, run } = await verdictWhileBusy("tui");
		try {
			// What Esc does: restoreQueuedMessagesToEditor({ abort: true }) clears the queue, then aborts.
			main.session.clearQueue();
			await main.session.abort();
			await within(run, 5000, "the main run");
			await checkKeptAfterAbort(main, requests);
		} finally {
			main.session.dispose();
		}
	});

	it("RPC abort while a verdict waits: the verdict is kept, no run starts, the next prompt carries it", async () => {
		const { main, requests, run } = await verdictWhileBusy("rpc");
		try {
			await main.session.abort(); // RPC "abort"
			await within(run, 5000, "the main run");
			await checkKeptAfterAbort(main, requests);
		} finally {
			main.session.dispose();
		}
	});
});

describe("reviewer grep and find", () => {
	const FILE = "a.ts:1: const foo = 1;";

	/** Arguments through the definition's prepareArguments and Pi's validation, then the stock execute. */
	async function run(definition: ToolDefinition, args: Record<string, unknown>, cwd: string): Promise<string> {
		const prepared = definition.prepareArguments ? definition.prepareArguments(args) : args;
		const valid = validateToolArguments(definition as never, { type: "toolCall", id: "t", name: definition.name, arguments: prepared as never });
		const result = await definition.execute("t", valid as never, undefined, undefined, { cwd } as never);
		return textOf(result.content);
	}

	it('optional arguments "null", "undefined" and blank count as not given', async () => {
		const dir = join(root, `g${counter++}`);
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, "a.ts"), "const foo = 1;\n");
		const stockGrep = createGrepToolDefinition(dir) as unknown as ToolDefinition;
		assert.equal(await run(stockGrep, { pattern: "foo", glob: "null" }, dir), "No matches found", "the stock grep fails silently");
		const [grep, find] = reviewerTools(dir);
		assert.deepEqual([grep.name, find.name], ["grep", "find"]);
		for (const empty of ["null", "undefined", "", "  "]) {
			assert.equal(await run(grep, { pattern: "foo", glob: empty }, dir), FILE, `grep glob ${JSON.stringify(empty)}`);
			assert.equal(await run(grep, { pattern: "foo", path: empty }, dir), FILE, `grep path ${JSON.stringify(empty)}`);
			assert.equal(await run(find, { pattern: "*.ts", path: empty, limit: empty }, dir), "a.ts", `find ${JSON.stringify(empty)}`);
		}
		assert.equal(await run(grep, { pattern: "foo", glob: "*.ts" }, dir), FILE, "a real glob still applies");
		assert.equal(await run(grep, { pattern: "foo", glob: "*.py" }, dir), "No matches found");
	});

	it('the reviewer session gets them: grep with glob "null" finds the match', async () => {
		scriptReviewer((context) => {
			const last = context.messages.at(-1);
			if (last?.role === "toolResult") return fauxAssistantMessage(fauxText(textOf(last.content)));
			return fauxAssistantMessage(fauxToolCall("grep", { pattern: "foo", glob: "null" }, { id: "g1" }), { stopReason: "toolUse" });
		});
		const main = await openMain(full, ARGS);
		try {
			await writeFile(join(main.dir, "a.ts"), "const foo = 1;\n");
			await main.session.prompt(SECOND);
			assert.equal(await within(main.verdictTurn, 5000, "verdict turn"), other(FILE));
			await main.session.waitForIdle();
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

import reviewExtension, { TIMEOUT_MS } from "../index.ts";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

describe("runtime regressions and controls", () => {
	it("a length-truncated CLEAN fails instead of passing", async () => {
		scriptReviewer(() => fauxAssistantMessage(fauxText("CLEAN"), { stopReason: "length" }));
		const main = await openMain(full, ARGS, true, "print");
		try {
			await main.session.prompt(SECOND);
			assert.deepEqual(delivered(main.session), [failedWith("the reviewer did not complete normally (length)")]);
		} finally { main.session.dispose(); }
	});

	for (const mode of ["tui", "rpc"] as const) {
		it(`${mode} verdict finishing after abort stays saved until the next user run`, async () => {
			const reviewer = gate("CLEAN");
			const reviews = scriptReviewer((_c, o) => reviewer.reply(o?.signal));
			const main = await openMain(full, ARGS, true, mode);
			const busy = gate("main busy");
			const requests = scriptMain([callReview(), busy.reply]);
			try {
				const run = main.session.prompt(SECOND);
				await until(() => reviews.length === 1 && requests.length === 2, "both requests");
				if (mode === "tui") main.session.clearQueue();
				await main.session.abort();
				await run;
				assert.equal(requests.length, 2);
				reviewer.release();
				await until(() => delivered(main.session).length === 1, "saved verdict after abort");
				await nextLoop();
				assert.equal(requests.length, 2, "no turn starts without new user input");
				assert.deepEqual(delivered(main.session), [clean()]);
				assert.equal(main.session.agent.hasQueuedMessages(), false);
				await main.session.prompt("next");
				assert.equal(requests.length, 3);
				assert.equal(requests[2].filter(t => t === clean()).length, 1);
				assert.deepEqual(delivered(main.session), [clean()]);
			} finally { main.session.dispose(); }
		});
	}

	for (const mode of ["print", "json"] as const) {
		it(`${mode} abort interrupts agent_end waiting without stopping or losing the reviewer`, async () => {
			const reviewer = gate("CLEAN");
			const reviews = scriptReviewer((_c, o) => reviewer.reply(o?.signal));
			const main = await openMain(full, ARGS, true, mode);
			const requests = scriptMain([callReview(), fauxAssistantMessage(fauxText("started"))]);
			try {
				const run = main.session.prompt(SECOND);
				await until(() => reviews.length === 1 && requests.length === 2, "reviewer and final main response");
				await nextLoop();
				let stopped = false;
				const abort = main.session.abort().then(() => { stopped = true; });
				await within(Promise.all([run, abort]), 1000, "abort without releasing reviewer");
				assert.equal(stopped, true);
				assert.equal(requests.length, 2);
				assert.deepEqual(delivered(main.session), []);
				reviewer.release();
				await until(() => delivered(main.session).length === 1, "late verdict");
				await nextLoop();
				assert.deepEqual(delivered(main.session), [clean()]);
				assert.equal(requests.length, 2, "no continuation after abort");
				await main.session.prompt("next");
				assert.equal(requests.length, 3);
				assert.equal(requests[2].filter(t => t === clean()).length, 1);
			} finally { main.session.dispose(); }
		});
	}

	it("deadline bounds an auth check that ignores its signal and blocks late session creation", async (t) => {
		type Handler = (event: never, ctx: never) => unknown;
		const handlers = new Map<string, Handler>();
		let definition: ToolDefinition | undefined;
		const messages: { content: unknown }[] = [];
		const entries: unknown[] = [];
		const pi = {
			on: (n: string, h: Handler) => handlers.set(n, h),
			registerTool: (d: ToolDefinition) => { definition = d; },
			sendMessage: (m: { content: unknown }) => messages.push(m),
			appendEntry: (customType: string, data: unknown) => entries.push({ type: "custom", customType, data }),
			events: createEventBus(),
		} as unknown as ExtensionAPI;
		reviewExtension(pi);
		const auth = Promise.withResolvers<unknown>();
		let authSignal: AbortSignal | undefined;
		let sessionStage = false;
		const ctx = { mode: "print", isIdle: () => false, signal: new AbortController().signal,
			sessionManager: { getEntries: () => entries, getBranch: () => [] },
			modelRegistry: { find: () => reviewerFaux.getModel("claude-haiku-5-5"), hasConfiguredAuth: () => false,
				runtime: { checkAuth: (_provider: string, options: { signal: AbortSignal }) => {
					authSignal = options.signal;
					return auth.promise;
				} } },
			get cwd() { sessionStage = true; return root; },
		} as unknown as ExtensionContext;
		handlers.get("session_start")!({} as never, ctx as never);
		t.mock.timers.enable({ apis: ["setTimeout"] });
		await definition!.execute("deadline", ARGS as never, undefined, undefined, ctx as never);
		assert.deepEqual(entries, [{ type: "custom", customType: "review", data: { n: 1 } }], "ID persisted before auth completes");
		const boundary = Promise.resolve(handlers.get("agent_end")!({} as never, ctx as never));
		t.mock.timers.tick(TIMEOUT_MS);
		t.mock.timers.reset();
		await within(boundary, 1000, "deadline despite pending auth");
		handlers.get("agent_before_settle")!({} as never, ctx as never);
		assert.equal(authSignal?.aborted, true);
		assert.equal(messages.length, 1);
		assert.match(String(messages[0].content), /Review failed: no verdict within 30 minutes/);
		assert.equal(sessionStage, false);
		auth.resolve({});
		await nextLoop();
		assert.equal(sessionStage, false, "late auth cannot create a child");
		assert.equal(messages.length, 1);
	});

	it("arbitrary malformed output is incomplete, never findings", () => {
		for (const v of ["UNCHECKED:\n- a.ts unreadable", "I could not finish", "FINDINGS:"]) {
			assert.ok(verdictMessage(1, v, false).endsWith(NEXT.incomplete), v);
		}
	});

	it("structure: an empty or partial finding block, a header with text, prose before CLEAN and stray text are incomplete and settle nothing", () => {
		const full = `FINDINGS:\nFINDING 1\n${FIELDS()}`;
		const bad: [string, string][] = [
			["an empty block after FINDINGS:", "FINDINGS:\nFINDING 1"],
			["a block with one field", "FINDINGS:\nFINDING 1\nREQUIREMENT: x"],
			["a block with an empty required field", `FINDINGS:\nFINDING 1\n${FIELDS().replace("MISMATCH: y", "MISMATCH:")}`],
			["one complete and one empty block", `${full}\nFINDING 2\nREQUIREMENT: x\nMISMATCH: y`],
			["text on the FINDINGS: header line", `FINDINGS: ${FIELDS().replace(/\n/g, " ")}`],
			["text on the header line, then blocks", `FINDINGS: see below\nFINDING 1\n${FIELDS()}`],
			["stray text between the header and the first block", `FINDINGS:\nsee below\nFINDING 1\n${FIELDS()}`],
			["prose before CLEAN", "remark\nCLEAN"],
			["lowercase header", `findings:\nFINDING 1\n${FIELDS()}`],
		];
		const state = disputes([
			{ id: "x", parentId: null, timestamp: "", type: "custom", customType: "review", data: { n: 1, findings: [{ id: "1.1", text: "A" }] } },
			{ id: "y", parentId: null, timestamp: "", type: "custom", customType: "review", data: { n: 2, rebuttals: [{ finding: "1.1", quote: "q", source: "user", explanation: "e" }] } },
		] as unknown as SessionEntry[]);
		for (const [what, verdict] of bad) {
			assert.equal(findingBlocks(verdict), undefined, what);
			assert.equal(verdictMessage(3, verdict, false), `[review#3] ${verdict}\n\n${NEXT.incomplete}`, what);
			const s = settle(3, verdict, false, state, ["1.1"]);
			assert.deepEqual([s.findings, s.rulings, s.notes], [[], [], ""], `${what}: nothing resolved, no empty finding, the open dispute stays open`);
		}
		assert.equal(findingBlocks(full)?.length, 1);
		assert.equal(verdictMessage(3, full, false), `[review#3] ${full}\n\n${NEXT.findings}`);
	});

	it("every call starts with no reviewer history", async () => {
		const requests = scriptReviewer(() => fauxAssistantMessage(fauxText("CLEAN")));
		const main = await openMain(full, ARGS, true, "print");
		scriptMain([fauxAssistantMessage([fauxToolCall("review", ARGS, { id: "r1" }), fauxToolCall("review", { ...ARGS, level: "high" }, { id: "r2" })], { stopReason: "toolUse" })]);
		try {
			await main.session.prompt(SECOND);
			assert.equal(requests.length, 2);
			assert.deepEqual(requests.map(r => r.model).sort(), ["claude-haiku-5-5", "claude-sonnet-5-5"]);
			assert.ok(requests.every(r => !r.text.includes("[review#")));
			assert.equal(delivered(main.session).length, 2);
		} finally { main.session.dispose(); }
	});
});

describe("nested caller and scope transport", () => {
	it("reload preserves an issued nested review id even without a verdict", async () => {
		const reviewer = gate("CLEAN");
		const reviews = scriptReviewer((_c, o) => reviewer.reply(o?.signal));
		const relay = join(dirname(fileURLToPath(import.meta.url)), "relay.ts");
		const main = await openMain(full, ARGS, true, "tui", [relay]);
		const requests = scriptMain([fauxAssistantMessage(fauxToolCall("relay", ARGS, { id: "outer" }), { stopReason: "toolUse" })]);
		try {
			await main.session.prompt(SECOND);
			await until(() => reviews.length === 1 && requests.length === 2, "nested review running");
			const outer = main.session.messages.find(m => m.role === "toolResult" && m.toolName === "relay");
			assert.ok(outer?.role === "toolResult");
			assert.equal(textOf(outer.content), startedText(1));
			assert.equal(main.session.messages.filter(m => m.role === "toolResult" && m.toolName === "review").length, 0);
			assert.ok(main.session.sessionManager.getEntries().some(e => e.type === "custom" && e.customType === "review" && (e.data as { n: number }).n === 1));
			await main.session.reload();
			scriptReviewer(() => fauxAssistantMessage(fauxText("CLEAN")));
			scriptMain([callReview()]);
			await main.session.prompt(SECOND);
			await until(() => delivered(main.session).length === 1, "new review verdict");
			await main.session.waitForIdle();
			const next = main.session.messages.find(m => m.role === "toolResult" && m.toolName === "review");
			assert.ok(next?.role === "toolResult");
			assert.equal(textOf(next.content), startedText(2));
			assert.deepEqual(delivered(main.session), [clean(2)]);
		} finally { main.session.dispose(); }
	});

	it("custom scopes, exclusions and exact text survive the real API", async () => {
		const request = "Review only completeness.\n  Preserve trailing spaces  \n<criterion>literal tag</criterion>";
		const args = { ...ARGS, criterion: "Require custom safety checks outside the agreement; exclude formatting.", agreement: "Accepted proposal: use only stock tools." };
		const reviews = scriptReviewer(() => fauxAssistantMessage(fauxText("CLEAN")));
		const main = await openMain(full, args, true, "print");
		try {
			await main.session.prompt(request);
			assert.equal(reviews.length, 1);
			assert.ok(reviews[0].text.includes(`<message n="1">\n${request}\n</message>`));
			for (const [tag, value] of [["criterion", args.criterion], ["agreement", args.agreement]]) {
				assert.ok(reviews[0].text.includes(`<${tag}>\n${value}\n</${tag}>`));
			}
		} finally { main.session.dispose(); }
	});
});


describe("cancellation stage boundaries", () => {
	for (const finish of ["resolve", "reject", "shutdown"] as const) {
		it(`native prompt auth preflight: ${finish} after cancellation cannot request a model`, async (t) => {
			const reviews = scriptReviewer(() => fauxAssistantMessage(fauxText("CLEAN")));
			const main = await openMain(full, ARGS, true, "print");
			const mainResponding = Promise.withResolvers<void>();
			const requests = scriptMain([callReview(), async () => {
				mainResponding.resolve();
				return fauxAssistantMessage(fauxText("started"));
			}]);
			const auth = await full.checkAuth("anthropic");
			assert.ok(auth);
			const preflight = Promise.withResolvers<typeof auth>();
			const entered = Promise.withResolvers<void>();
			const hasAuth = full.hasConfiguredAuth.bind(full);
			const check = full.checkAuth.bind(full);
			let calls = 0;
			let reviewSignal: AbortSignal | undefined;
			t.mock.method(full, "hasConfiguredAuth", (provider: string) => provider === "anthropic" ? false : hasAuth(provider));
			t.mock.method(full, "checkAuth", (provider: string, options?: { signal?: AbortSignal }) => {
				if (provider !== "anthropic") return check(provider, options);
				if (++calls === 1) {
					reviewSignal = options?.signal;
					return Promise.resolve(auth);
				}
				assert.equal(options?.signal, undefined, "native Pi 1.4 prompt preflight has no abort signal");
				entered.resolve();
				return preflight.promise;
			});
			try {
				t.mock.timers.enable({ apis: ["setTimeout"] });
				const run = main.session.prompt(SECOND);
				await entered.promise;
				await mainResponding.promise;
				if (finish === "shutdown") {
					await main.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
				} else t.mock.timers.tick(TIMEOUT_MS);
				t.mock.timers.reset();
				await within(run, 1000, "main finishes while prompt preflight remains pending");
				assert.equal(reviewSignal?.aborted, true);
				assert.equal(getEventListeners(reviewSignal!, "abort").length, 0, "review listeners removed");
				assert.equal(reviews.length, 0);
				assert.equal(delivered(main.session).length, finish === "shutdown" ? 0 : 1);
				if (finish !== "shutdown") assert.equal(delivered(main.session)[0], failedWith("no verdict within 30 minutes"));
				if (finish === "reject") preflight.reject(new Error("late auth rejection"));
				else preflight.resolve(auth);
				await nextLoop();
				assert.equal(reviews.length, 0, "abandoned preflight never reaches the provider");
				assert.equal(requests.length, finish === "shutdown" ? 2 : 3);
				assert.equal(delivered(main.session).length, finish === "shutdown" ? 0 : 1);
			} finally {
				t.mock.timers.reset();
				preflight.resolve(auth);
				main.session.dispose();
			}
		});
	}

	it("deadline bounds a provider ignoring abort and observes its late rejection", async (t) => {
		const response = Promise.withResolvers<AssistantMessage>();
		const started = Promise.withResolvers<void>();
		let signal: AbortSignal | undefined;
		scriptReviewer((_c, options) => {
			signal = options?.signal;
			started.resolve();
			return response.promise;
		});
		const main = await openMain(full, ARGS, true, "print");
		try {
			t.mock.timers.enable({ apis: ["setTimeout"] });
			const run = main.session.prompt(SECOND);
			await started.promise;
			t.mock.timers.tick(TIMEOUT_MS);
			t.mock.timers.reset();
			await within(run, 1000, "deadline despite ignoring provider");
			assert.equal(signal?.aborted, true);
			assert.deepEqual(delivered(main.session), [failedWith("no verdict within 30 minutes")]);
			response.reject(new Error("late provider rejection"));
			await nextLoop();
			assert.equal(delivered(main.session).length, 1);
		} finally {
			t.mock.timers.reset();
			response.resolve(fauxAssistantMessage(fauxText("CLEAN")));
			main.session.dispose();
		}
	});

	for (const mode of ["print", "json", "tui", "rpc"] as const) {
		it(`${mode}: two reviews completing after abort are saved once and next run re-enables delivery`, async () => {
			const gates = [gate("R1"), gate("R2")];
			const reviews = scriptReviewer((_c, options) => gates[reviews.length - 1].reply(options?.signal));
			const main = await openMain(full, ARGS, true, mode);
			const busy = gate("busy");
			const requests = scriptMain([
				fauxAssistantMessage([fauxToolCall("review", ARGS, { id: "r1" }), fauxToolCall("review", ARGS, { id: "r2" })], { stopReason: "toolUse" }),
				busy.reply,
			]);
			try {
				const run = main.session.prompt(SECOND);
				await until(() => reviews.length === 2 && requests.length === 2, "both reviews and busy main");
				await within(main.session.abort(), 1000, "abort without reviews");
				await run;
				for (const g of gates) g.release();
				await until(() => delivered(main.session).length === 2, "both saved verdicts");
				await nextLoop();
				assert.equal(requests.length, 2);
				assert.equal(main.session.agent.hasQueuedMessages(), false);
				assert.deepEqual(delivered(main.session).sort(), [other("R1", 1), other("R2", 2)]);
				await main.session.prompt("next");
				assert.equal(requests.length, 3);
				for (const v of delivered(main.session)) assert.equal(requests[2].filter(t => t === v).length, 1);
				// A new run has cleared the abort latch: an idle verdict starts its normal turn again.
				scriptReviewer(() => fauxAssistantMessage(fauxText("CLEAN")));
				scriptMain([callReview()]);
				await main.session.prompt(SECOND);
				await until(() => delivered(main.session).length === 3, "post-resume review");
				await main.session.waitForIdle();
				assert.equal(delivered(main.session)[2], clean(3));
				assert.equal(lastText(main.session), "ok");
			} finally { main.session.dispose(); }
		});
	}
});

describe("delivery during an earlier agent_start handler", () => {
	for (const mode of ["tui", "rpc", "print", "json"] as const) {
		for (const abortNew of [false, true]) {
			it(`${mode}: late verdicts during a new ${abortNew ? "aborted" : "non-aborted"} run held before review's agent_start`, async (t) => {
				const slow = { enabled: false, entered: false, release: () => {} };
				const shared = globalThis as typeof globalThis & { __reviewSlowStart?: typeof slow };
				shared.__reviewSlowStart = slow;
				const gates = [gate("R1"), gate("R2")];
				const reviews = scriptReviewer((_c, options) => gates[reviews.length - 1].reply(options?.signal));
				const fixture = join(dirname(fileURLToPath(import.meta.url)), "slow-start.ts");
				const main = await openMain(full, ARGS, true, mode, [], [fixture]);
				const busy = gate("busy");
				const requests = scriptMain([
					fauxAssistantMessage([fauxToolCall("review", ARGS, { id: "r1" }), fauxToolCall("review", ARGS, { id: "r2" })], { stopReason: "toolUse" }),
					busy.reply,
					fauxAssistantMessage(fauxText("new prompt answer")),
					fauxAssistantMessage(fauxText("both verdicts answered")),
				]);
				const sent: { content: unknown; triggerTurn?: boolean }[] = [];
				const send = main.session.sendCustomMessage;
				t.mock.method(main.session, "sendCustomMessage", function (this: AgentSession, ...args: Parameters<typeof send>) {
					if (args[0].customType === "review") sent.push({ content: args[0].content, triggerTurn: args[1]?.triggerTurn });
					return send.apply(this, args);
				});
				const settled: boolean[] = [];
				const unsubscribe = main.session.subscribe(event => {
					if (event.type === "agent_settled") settled.push(event.aborted);
				});
				let next: Promise<void> | undefined;
				try {
					const run = main.session.prompt(SECOND);
					await until(() => reviews.length === 2 && requests.length === 2, "both held reviews and busy main");
					if (mode === "tui") main.session.clearQueue();
					await within(main.session.abort(), 1000, "initial abort without finishing reviews");
					await run;
					assert.deepEqual(settled, [true]);

					slow.enabled = true;
					next = main.session.prompt("new user prompt");
					await until(() => slow.entered, "earlier agent_start handler");
					assert.equal(main.session.isIdle, false, "new run is already busy before review's agent_start");
					const abort = abortNew ? main.session.abort() : undefined;
					for (const g of gates) g.release();
					await until(() => sent.length === 2, "both verdicts sent while agent_start is held");
					assert.deepEqual(sent.map(m => m.triggerTurn), [false, false]);
					assert.deepEqual(delivered(main.session), [], "Pi holds both messages until the turn or run ends");
					assert.equal(requests.length, 2, "no request escapes the held hook");
					assert.equal(main.session.agent.hasQueuedMessages(), false);
					slow.enabled = false;
					slow.release();
					await within(Promise.all([next, abort]), 5000, "new run settles");
					await nextLoop();
					assert.deepEqual(settled, [true, abortNew], "native agent_settled reports the current run's abort");
					assert.deepEqual(delivered(main.session).sort(), [other("R1", 1), other("R2", 2)]);
					assert.equal(main.session.agent.hasQueuedMessages(), false);
					if (abortNew) {
						assert.equal(requests.length, 2, "current abort saves both verdicts without any automatic request");
						await main.session.prompt("resume after current abort");
						assert.equal(requests.length, 3, "only the user resumes the session");
					} else {
						assert.equal(requests.length, 4, "one new-prompt request and exactly one answering continuation");
						for (const v of delivered(main.session)) assert.equal(requests[2].filter(text => text === v).length, 0);
						assert.equal(lastText(main.session), "both verdicts answered");
					}
					for (const v of delivered(main.session)) assert.equal(requests.at(-1)!.filter(text => text === v).length, 1);
				} finally {
					slow.enabled = false;
					slow.release();
					for (const g of gates) g.release();
					await main.session.abort();
					await next;
					unsubscribe();
					main.session.dispose();
					delete shared.__reviewSlowStart;
				}
			});
		}
	}
});

describe("persisted review numbers", () => {
	for (const source of ["custom", "tool", "verdict"] as const) {
		it(`recovers ${source} history without scanning arbitrary tool text or exposing custom entries to Main`, async () => {
			const handlers = new Map<string, (event: never, ctx: never) => unknown>();
			let definition: ToolDefinition | undefined;
			const base = { id: "x", parentId: null, timestamp: "" };
			const history = source === "custom"
				? { ...base, type: "custom", customType: "review", data: { n: 7 } }
				: source === "tool"
					? { ...base, type: "message", message: { role: "toolResult", toolName: "review", content: startedText(7) } }
					: { ...base, type: "custom_message", customType: "review", content: clean(7) };
			const entries = [history,
				{ ...base, type: "message", message: { role: "toolResult", toolName: "relay", content: startedText(999) } },
				...[-1, 0, 1.5, "999", undefined, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map(n => ({ ...base, type: "custom", customType: "review", data: { n } })),
				...["quoted review#999", "[review#0] CLEAN", "[review#9007199254740992] CLEAN", `[review#${"9".repeat(400)}] CLEAN`, "[review#5] quotes review#999"].map(content => ({ ...base, type: "custom_message", customType: "review", content })),
				...["Error validating review: args review#999", "review#999 startedOops", "review#0 started.", "review#9007199254740992 started."].map(text => ({ ...base, type: "message", message: { role: "toolResult", toolName: "review", content: [{ type: "text", text }] } })),
			] as unknown as SessionEntry[];
			const persisted: unknown[] = [];
			reviewExtension({
				on: (n: string, h: (event: never, ctx: never) => unknown) => handlers.set(n, h),
				registerTool: (d: ToolDefinition) => { definition = d; },
				appendEntry: (customType: string, data: unknown) => persisted.push({ customType, data }),
				sendMessage: () => {},
				events: createEventBus(),
			} as unknown as ExtensionAPI);
			const ctx = { cwd: root, isIdle: () => true, sessionManager: { getEntries: () => entries, getBranch: () => [] },
				modelRegistry: { find: () => undefined } } as unknown as ExtensionContext;
			handlers.get("session_start")!({} as never, ctx as never);
			const result = await definition!.execute("r", ARGS as never, undefined, undefined, ctx);
			assert.equal(textOf(result.content), startedText(8));
			assert.deepEqual(persisted, [{ customType: "review", data: { n: 8 } }]);
			await nextLoop();
		});
	}
});


describe("native creation and wait cleanup", () => {
	it("disposes a session created across the deadline without prompting it", async (t) => {
		const handlers = new Map<string, (event: never, ctx: never) => unknown>();
		let definition: ToolDefinition | undefined;
		const messages: { content: unknown }[] = [];
		const reviews = scriptReviewer(() => fauxAssistantMessage(fauxText("CLEAN")));
		const dispose = AgentSession.prototype.dispose;
		let disposed = 0;
		t.mock.method(AgentSession.prototype, "dispose", function (this: AgentSession) {
			disposed++;
			return dispose.call(this);
		});
		reviewExtension({
			on: (n: string, h: (event: never, ctx: never) => unknown) => handlers.set(n, h),
			registerTool: (d: ToolDefinition) => { definition = d; },
			appendEntry: () => {},
			sendMessage: (m: { content: unknown }) => messages.push(m),
			events: { emit: () => {}, on: () => () => {} },
			getSettings: () => ({}),
			getActiveTools: () => [],
		} as unknown as ExtensionAPI);
		// The deadline fires as the session is being created (its in-memory manager is built just before the call), after
		// the loader has reloaded: the session materializes after the deadline and must be disposed without a prompt.
		const inMemory = SessionManager.inMemory;
		t.mock.method(SessionManager, "inMemory", (...args: Parameters<typeof SessionManager.inMemory>) => {
			t.mock.timers.tick(TIMEOUT_MS);
			return inMemory.apply(SessionManager, args);
		});
		const ctx = { mode: "print", cwd: root, signal: new AbortController().signal, isIdle: () => false,
			sessionManager: { getEntries: () => [], getBranch: () => [] },
			modelRegistry: { find: () => reviewerFaux.getModel("claude-haiku-5-5"), hasConfiguredAuth: () => true, runtime: full },
		} as unknown as ExtensionContext;
		handlers.get("session_start")!({} as never, ctx as never);
		try {
			t.mock.timers.enable({ apis: ["setTimeout"] });
			await definition!.execute("create", ARGS as never, undefined, undefined, ctx);
			await handlers.get("agent_end")!({} as never, ctx as never);
			handlers.get("agent_before_settle")!({} as never, ctx as never);
			t.mock.timers.reset();
			await nextLoop();
			assert.equal(disposed, 1);
			assert.equal(reviews.length, 0);
			assert.equal(messages.length, 1);
			assert.equal(messages[0].content, failedWith("no verdict within 30 minutes"));
		} finally { t.mock.timers.reset(); }
	});

	for (const abort of [false, true]) {
		it(`native agent_end signal removes its wait listener after ${abort ? "abort" : "normal delivery"}`, async () => {
			const observed: { active?: AbortSignal; end?: AbortSignal; boundary?: AbortSignal } = {};
			(globalThis as any).__reviewLifecycle = observed;
			const reviewer = gate("CLEAN");
			const reviews = scriptReviewer((_c, options) => reviewer.reply(options?.signal));
			const lifecycle = join(dirname(fileURLToPath(import.meta.url)), "lifecycle.ts");
			const main = await openMain(full, ARGS, true, "print", [lifecycle]);
			const requests = scriptMain([callReview(), fauxAssistantMessage(fauxText("started"))]);
			try {
				const run = main.session.prompt(SECOND);
				await until(() => reviews.length === 1 && requests.length === 2 && !!observed.active && getEventListeners(observed.active, "abort").length > 0, "native wait listener");
				assert.equal(observed.active?.aborted, false);
				if (abort) await within(main.session.abort(), 1000, "abort native wait");
				else reviewer.release();
				await within(run, 1000, "settlement");
				assert.equal(observed.end, observed.active);
				assert.equal(observed.end?.aborted, abort);
				assert.equal(getEventListeners(observed.end!, "abort").length, 0);
				assert.equal(observed.boundary, undefined, "before_settle has no active native signal");
				if (abort) {
					reviewer.release();
					await until(() => delivered(main.session).length === 1, "saved late verdict");
				}
			} finally {
				reviewer.release();
				main.session.dispose();
				delete (globalThis as any).__reviewLifecycle;
			}
		});
	}
});

describe("settlement phase delivery", () => {
	for (const mode of ["tui", "rpc", "print", "json"] as const) {
		for (const stage of ["end", "before", "after", "settled", "end-idle", "before-idle", "mixed"] as const) {
			for (const aborted of stage === "mixed" ? [false] : stage === "end-idle" ? [true] : [true, false]) {
				it(`${mode}: two verdicts at ${stage}, ${aborted ? "abort never wakes" : "normal batch continues"}`, async () => {
					const hold = { enabled: true, entered: false, side: stage === "after" ? "after" : "before",
						event: stage.startsWith("end") ? "agent_end" : stage === "settled" ? "agent_settled" : "agent_before_settle", release: () => {} };
					(globalThis as any).__reviewPhase = hold;
					const here = dirname(fileURLToPath(import.meta.url));
					const main = await openMain(full, ARGS, true, mode, [join(here, "phase-after.ts")], [join(here, "phase-before.ts")]);
					const gates = [gate("R1"), gate("R2"), gate("R3")];
					const reviews = scriptReviewer((_c, options) => gates[reviews.length - 1].reply(options?.signal));
					const busy = gate("BUSY");
					const streamAbort = stage === "settled" && aborted;
					const requests = scriptMain(streamAbort || stage === "mixed" ? [busy.reply] : []);
					const call = () => main.session.getToolDefinition("review")!.execute("phase", ARGS as never, undefined, undefined, main.session.extensionRunner.createContext());
					let run: Promise<void> | undefined, abort: Promise<void> | undefined;
					try {
						if (streamAbort) { await call(); await call(); }
						else if (stage === "mixed") await call();
						run = main.session.prompt("GO");
						if (streamAbort) {
							await until(() => requests.length === 1, "held main stream");
							if (mode === "tui") main.session.clearQueue();
							abort = main.session.abort();
						}
						if (stage === "mixed") {
							await until(() => requests.length === 1 && reviews.length === 1, "first verdict during main stream");
							gates[0].release();
							await tick();
							busy.release();
						}
						await until(() => hold.entered, "earlier lifecycle hook");
						assert.equal(main.session.isIdle, stage === "settled", "SDK flips idle before settled handlers");
						if (!streamAbort) {
							if (stage !== "mixed") await call();
							await call();
							if (aborted) abort = main.session.abort();
						}
						if (stage.endsWith("-idle")) {
							const release = hold.release;
							hold.entered = false; hold.event = "agent_settled"; hold.enabled = true;
							release();
							await until(() => hold.entered, "earlier settled after late abort");
							assert.equal(main.session.isIdle, true);
						}
						await until(() => reviews.length === 2, "both reviewer streams");
						gates[0].release(); gates[1].release();
						await tick();
						assert.equal(requests.length, 1, "no main request escapes held lifecycle");
						hold.release();
						await within(Promise.all([run, abort]), 5000, "settle both results");
						await until(() => delivered(main.session).length === 2, "both verdicts persisted");
						await main.session.waitForIdle();
						await tick();
						const results = [other("R1", 1), other("R2", 2)];
						assert.deepEqual(delivered(main.session).sort(), results);
						assert.equal(requests.length, aborted ? 1 : 2, "abort stays stopped; normal settlement gets one batch turn");
						assert.equal(main.session.agent.hasQueuedMessages(), false);
						if (aborted) await main.session.prompt("USER_RESUMES");
						for (const result of results) assert.equal(requests.at(-1)!.filter(text => text === result).length, 1);
						await call();
						await until(() => reviews.length === 3, "ordinary idle review");
						gates[2].release();
						await until(() => requests.length === 3, "ordinary idle wakeup");
						await main.session.waitForIdle();
						assert.equal(requests[2].filter(text => text === other("R3", 3)).length, 1);
					} finally {
						hold.enabled = false; hold.release();
						for (const g of gates) g.release();
						busy.release();
						await main.session.abort();
						await Promise.all([run, abort]);
						main.session.dispose();
						delete (globalThis as any).__reviewPhase;
					}
				});
			}
		}
	}
});

describe("review number safety", () => {
	it("native invalid-argument errors quoting huge ids cannot poison reload rounds", async () => {
		const huge = "9".repeat(400);
		const invalid = { ...ARGS, object: { quoted: `review#${huge}` } };
		const reviews = scriptReviewer(() => fauxAssistantMessage(fauxText("CLEAN")));
		const main = await openMain(full, ARGS, true, "print");
		scriptMain([fauxAssistantMessage(fauxToolCall("review", invalid, { id: "bad" }), { stopReason: "toolUse" })]);
		try {
			await main.session.prompt("INVALID_ARGS");
			const error = main.session.messages.find(m => m.role === "toolResult" && m.toolName === "review");
			assert.ok(error?.role === "toolResult" && error.isError);
			assert.ok(textOf(error.content).includes(`review#${huge}`), "native validation quotes the actual invalid arguments");
			assert.equal(reviews.length, 0);
			for (const n of [1, 2]) {
				await main.session.reload();
				scriptMain([callReview()]);
				await main.session.prompt("VALID_ARGS");
				const result = main.session.messages.findLast(m => m.role === "toolResult" && m.toolName === "review");
				assert.ok(result?.role === "toolResult" && !result.isError);
				assert.equal(textOf(result.content), startedText(n));
				assert.equal(delivered(main.session).at(-1), clean(n));
			}
			assert.equal(reviews.length, 2);
			const ids = main.session.sessionManager.getEntries().flatMap(e => e.type === "custom" && e.customType === "review" ? [(e.data as { n: number }).n] : []);
			assert.deepEqual(ids, [1, 2]);
		} finally { main.session.dispose(); }
	});

	for (const source of ["custom", "tool", "verdict"] as const) {
		it(`caps exhausted ${source} ids without allocating or starting work`, async () => {
			let definition: ToolDefinition | undefined;
			const handlers = new Map<string, (event: never, ctx: never) => unknown>();
			const persisted: unknown[] = [];
			const max = Number.MAX_SAFE_INTEGER;
			const entries = [source === "custom" ? { type: "custom", customType: "review", data: { n: max - 1 } }
				: source === "tool" ? { type: "message", message: { role: "toolResult", toolName: "review", content: startedText(max - 1) } }
				: { type: "custom_message", customType: "review", content: clean(max - 1) }] as unknown as SessionEntry[];
			reviewExtension({
				on: (n: string, h: (event: never, ctx: never) => unknown) => handlers.set(n, h),
				registerTool: (d: ToolDefinition) => { definition = d; },
				appendEntry: (_type: string, data: unknown) => persisted.push(data), sendMessage: () => {},
				events: createEventBus(),
			} as unknown as ExtensionAPI);
			let lookups = 0;
			const ctx = { cwd: root, isIdle: () => true, sessionManager: { getEntries: () => entries, getBranch: () => [] },
				modelRegistry: { find: () => { lookups++; return undefined; } } } as unknown as ExtensionContext;
			handlers.get("session_start")!({} as never, ctx as never);
			const result = await definition!.execute("last", ARGS as never, undefined, undefined, ctx);
			assert.equal(textOf(result.content), startedText(max));
			assert.deepEqual(persisted, [{ n: max }]);
			await assert.rejects(() => definition!.execute("exhausted", ARGS as never, undefined, undefined, ctx), /Review id space exhausted/);
			assert.equal(lookups, 2, "the one allowed start looked up both families; exhaustion starts no job");
			assert.deepEqual(persisted, [{ n: max }]);
			await nextLoop();
		});
	}
});

describe("disputes: one finding, one rebuttal, one final answer", () => {
	const USER = "Rename `foo` to `bar` in a.ts. Keep `foo` exported as an alias.";
	const BODY = 'REQUIREMENT: "Rename `foo` to `bar`" (user message 1)\nMISMATCH: a.ts still declares foo.\nEVIDENCE: "export const foo = bar;" (a.ts)\nREQUIRED OUTCOME: a.ts declares no foo.';
	const FIRST_FINDING = `FINDINGS:\nFINDING 1\n${BODY}`;
	const REBUTTAL = { finding: "1.1", quote: "Keep `foo` exported as an alias.", source: "user", explanation: "The user asked to keep foo as an alias of bar." };
	const upheld = (ruling?: string) =>
		`FINDINGS:\nFINDING 1\nDISPUTE: 1.1\n${BODY}${ruling ? `\nRULING: ${ruling}` : ""}\nANSWER: The alias must not be a declaration.`;

	type Pass = { result: string; isError: boolean; request?: Request; message?: string };
	/** One main turn that calls `review` with `args`; the reviewer answers `answer`. Print mode waits for the verdict. */
	async function pass(main: Main, args: Record<string, unknown>, answer: () => AssistantMessage): Promise<Pass> {
		const requests = scriptReviewer(answer);
		const before = delivered(main.session).length;
		scriptMain([fauxAssistantMessage(fauxToolCall("review", args, { id: `p${counter++}` }), { stopReason: "toolUse" })]);
		await main.session.prompt("Review it");
		await main.session.waitForIdle();
		const result = main.session.messages.findLast((m) => m.role === "toolResult" && m.toolName === "review");
		assert.ok(result?.role === "toolResult");
		assert.ok(requests.length <= 1);
		const now = delivered(main.session);
		assert.ok(now.length - before <= 1);
		return { result: textOf(result.content), isError: !!result.isError, request: requests[0], message: now.length > before ? String(now.at(-1)) : undefined };
	}
	const say = (text: string) => () => fauxAssistantMessage(fauxText(text));
	const reviewData = (main: Main) =>
		main.session.sessionManager.getEntries().flatMap((e) => (e.type === "custom" && e.customType === "review" ? [e.data] : []));

	async function opened(): Promise<Main> {
		scriptMain([]);
		const main = await openMain(full, ARGS, true, "print");
		await writeFile(join(main.dir, "a.ts"), "export const bar = 1;\nexport const foo = bar;\n");
		await main.session.prompt(USER);
		return main;
	}

	it("a rebuttal with verbatim quotes goes to a fresh reviewer, which withdraws the finding", async () => {
		const main = await opened();
		try {
			const first = await pass(main, ARGS, say(FIRST_FINDING));
			assert.equal(first.message, `[review#1] ${FIRST_FINDING}\n\nFinding ids: FINDING 1 = 1.1.\n\n${NEXT.findings}`);

			const second = await pass(main, { ...ARGS, rebuttals: [REBUTTAL] }, say("CLEAN"));
			assert.equal(second.result, startedText(2));
			const r = second.request!;
			assert.equal(r.messages, 1, "a fresh reviewer session: the brief is its only message");
			assert.ok(!r.text.includes("[review#"), "no earlier verdict text");
			assert.ok(r.text.includes(
				`<disputes>\n<dispute finding="1.1" status="open">\n<finding>\n${BODY}\n</finding>\n<rebuttal>\nQUOTE: ${REBUTTAL.quote}\nSOURCE: user\nEXPLANATION: ${REBUTTAL.explanation}\n</rebuttal>\n</dispute>\n</disputes>`,
			), r.text);
			assert.equal(second.message, `[review#2] CLEAN\n\n${NEXT.withdrawn} 1.1.\n\n${NEXT.clean}`);

			// The withdrawn dispute stays in the brief so a fresh reviewer does not raise it again.
			const third = await pass(main, ARGS, say("CLEAN"));
			assert.ok(third.request!.text.includes('<dispute finding="1.1" status="withdrawn">'));
			assert.equal(third.message, clean(3));
			const again = await pass(main, { ...ARGS, rebuttals: [REBUTTAL] }, say("CLEAN"));
			assert.ok(again.isError && again.result.includes("finding 1.1 was already withdrawn in review#2"), again.result);
			assert.equal(again.request, undefined);
			assert.deepEqual(reviewData(main), [
				{ n: 1 },
				{ n: 1, findings: [{ id: "1.1", text: BODY }] },
				{ n: 2, rebuttals: [REBUTTAL] },
				{ n: 2, rulings: [{ finding: "1.1", ruling: "withdrawn" }] },
				{ n: 3 },
			]);
		} finally { main.session.dispose(); }
	});

	for (const [ruling, next, refusal] of [
		["DECIDED", NEXT.decided, "on the user's decision, and that answer is final: fix it to its REQUIRED OUTCOME."],
		["UNDECIDED", NEXT.undecided, "on a point the user has not decided, and that answer is final: put the dispute to the user and follow the user's decision."],
	] as const) {
		it(`upheld ${ruling}: the next step is ${ruling === "DECIDED" ? "to fix" : "to ask the user"}, and a second rebuttal is refused`, async () => {
			const main = await opened();
			try {
				await pass(main, ARGS, say(FIRST_FINDING));
				const second = await pass(main, { ...ARGS, rebuttals: [REBUTTAL] }, say(upheld(ruling)));
				assert.equal(second.message, `[review#2] ${upheld(ruling)}\n\nFinding ids: FINDING 1 = 1.1.\n${next} 1.1.\n\n${NEXT.findings}`);
				assert.ok(ruling === "DECIDED" ? next.includes("fix each to its REQUIRED OUTCOME") : next.includes("put each dispute to the user"));

				const twice = await pass(main, { ...ARGS, rebuttals: [{ ...REBUTTAL, explanation: "Another argument." }] }, say("CLEAN"));
				assert.ok(twice.isError, twice.result);
				assert.ok(twice.result.includes(`Review not started. Refused: finding 1.1 was upheld in review#2 ${refusal}`), twice.result);
				assert.equal(twice.request, undefined, "no reviewer runs");
				assert.equal(twice.message, undefined);

				// The next pass sees the whole dispute: the finding, the rebuttal and the final answer.
				const third = await pass(main, ARGS, say(upheld(ruling)));
				assert.equal(third.result, startedText(3), "the refused call took no number");
				assert.ok(third.request!.text.includes(`<dispute finding="1.1" status="upheld" ruling="${ruling}">\n<finding>\n${BODY}\n</finding>\n<rebuttal>\nQUOTE: ${REBUTTAL.quote}`));
				assert.ok(third.request!.text.includes("<answer>\nThe alias must not be a declaration.\n</answer>\n</dispute>"));
				assert.equal(third.message, `[review#3] ${upheld(ruling)}\n\nFinding ids: FINDING 1 = 1.1.\n${next} 1.1.\n\n${NEXT.findings}`);
				assert.deepEqual(reviewData(main).filter((d) => "rulings" in (d as object)), [
					{ n: 2, rulings: [{ finding: "1.1", ruling: ruling.toLowerCase(), answer: "The alias must not be a declaration." }] },
				]);
			} finally { main.session.dispose(); }
		});
	}

	it("refuses rebuttals without proof, with a quote missing from its source, or for an unknown finding", async () => {
		const main = await opened();
		try {
			await pass(main, ARGS, say(FIRST_FINDING));
			const cases: [Record<string, unknown>, string][] = [
				[{ ...REBUTTAL, quote: "" }, "the rebuttal of 1.1 has no proof: it needs a quote, its source and an explanation. Without proof, fix the finding."],
				[{ ...REBUTTAL, explanation: " " }, "has no proof"],
				[{ ...REBUTTAL, quote: "Keep foo forever." }, `the quote of the rebuttal of 1.1 is not in "user"; quote it exactly, or fix the finding.`],
				[{ ...REBUTTAL, quote: "export const foo = baz;", source: "a.ts" }, `is not in "a.ts"`],
				[{ ...REBUTTAL, quote: "x", source: "missing.ts" }, `"missing.ts", is not a readable file`],
				[{ ...REBUTTAL, finding: "9.9" }, `no finding "9.9" in this session`],
			];
			for (const [rebuttal, reason] of cases) {
				const refused = await pass(main, { ...ARGS, rebuttals: [rebuttal] }, say("CLEAN"));
				assert.ok(refused.isError && refused.result.includes(reason), `${reason}: ${refused.result}`);
				assert.equal(refused.request, undefined);
			}
			const twice = await pass(main, { ...ARGS, rebuttals: [REBUTTAL, REBUTTAL] }, say("CLEAN"));
			assert.ok(twice.isError && twice.result.includes("finding 1.1 is rebutted twice in this call"), twice.result);
			// A file quote counts, whitespace runs aside.
			const ok = await pass(main, { ...ARGS, rebuttals: [{ ...REBUTTAL, quote: "export  const foo =\nbar;", source: "a.ts" }] }, say("CLEAN"));
			assert.equal(ok.result, startedText(2));
			assert.equal(ok.message, `[review#2] CLEAN\n\n${NEXT.withdrawn} 1.1.\n\n${NEXT.clean}`);
			assert.equal(reviewData(main).filter((d) => "n" in (d as object) && Object.keys(d as object).length === 1).length, 1, "refused calls persisted nothing");
		} finally { main.session.dispose(); }
	});

	it("two parallel rebuttals of one finding: exactly one is accepted and one reviewer runs", async () => {
		const main = await opened();
		try {
			await pass(main, ARGS, say(FIRST_FINDING));
			const requests = scriptReviewer(() => fauxAssistantMessage(fauxText("CLEAN")));
			const call = (id: string) => fauxToolCall("review", { ...ARGS, rebuttals: [REBUTTAL] }, { id });
			scriptMain([fauxAssistantMessage([call("par1"), call("par2")], { stopReason: "toolUse" })]);
			await main.session.prompt("Review it twice");
			await main.session.waitForIdle();
			const results = main.session.messages.filter((m) => m.role === "toolResult" && m.toolName === "review" && (m.toolCallId === "par1" || m.toolCallId === "par2"));
			assert.equal(results.length, 2);
			const accepted = results.filter((m) => m.role === "toolResult" && !m.isError);
			const refused = results.filter((m) => m.role === "toolResult" && m.isError);
			assert.equal(accepted.length, 1, "exactly one call is accepted");
			assert.equal(refused.length, 1, "the other is refused");
			assert.ok(refused[0].role === "toolResult" && textOf(refused[0].content).includes("finding 1.1 was already rebutted with review#2"), JSON.stringify(refused[0]));
			assert.equal(requests.length, 1, "one reviewer runs");
			assert.equal(reviewData(main).filter((d) => "rebuttals" in (d as object)).length, 1, "one rebuttal persisted");
			assert.deepEqual(reviewData(main).map((d) => (d as { n: number }).n).filter((n, i, all) => all.indexOf(n) === i), [1, 2], "the refused call took no number");
		} finally { main.session.dispose(); }
	});

	it("a file source must be under the session cwd: absolute, ../ and symlinked paths outside it are refused", async () => {
		const base = { id: "x", parentId: null, timestamp: "" };
		const state = disputes([
			{ ...base, type: "custom", customType: "review", data: { n: 1, findings: [{ id: "1.1", text: "A" }] } },
		] as unknown as SessionEntry[]);
		const cwd = await mkdtemp(join(tmpdir(), "rqw-review-cwd-"));
		const outside = await mkdtemp(join(tmpdir(), "rqw-review-outside-"));
		try {
			await writeFile(join(cwd, "in.md"), "the quote");
			await writeFile(join(outside, "out.md"), "the quote");
			const rebut = (source: string) => refusals([{ finding: "1.1", quote: "the quote", source, explanation: "e" }], state, [], cwd);
			assert.deepEqual(await rebut("in.md"), [], "a file under cwd counts");
			assert.deepEqual(await rebut(join(cwd, "in.md")), [], "an absolute path under cwd counts");
			const sources = [join(outside, "out.md"), relative(cwd, join(outside, "out.md"))];
			try {
				await symlink(join(outside, "out.md"), join(cwd, "link.md"));
				sources.push("link.md");
			} catch (error) {
				// Windows without symlink rights: the two other forms still run.
				if (process.platform !== "win32" || (error as NodeJS.ErrnoException).code !== "EPERM") throw error;
			}
			for (const source of sources)
				assert.deepEqual(await rebut(source), [`the source of the rebuttal of 1.1, ${JSON.stringify(source)}, is not under the session cwd; give a file under it or "user".`], source);
		} finally {
			await rm(cwd, { recursive: true, force: true });
			await rm(outside, { recursive: true, force: true });
		}
	});

	it("source user proves a quote only from the user's own messages, not from a compaction or branch summary", async () => {
		const base = { id: "x", parentId: null, timestamp: "" };
		const entries = [
			{ ...base, type: "message", message: { role: "user", content: "Keep `foo` exported as an alias.", timestamp: 0 } },
			{ ...base, type: "compaction", summary: "Main wrote: the user allowed deleting foo.", firstKeptEntryId: "x", tokensBefore: 1 },
			{ ...base, type: "branch_summary", fromId: "x", summary: "Main wrote: the user wants no alias at all." },
		] as unknown as SessionEntry[];
		const state = disputes([
			{ ...base, type: "custom", customType: "review", data: { n: 1, findings: [{ id: "1.1", text: "A" }] } },
		] as unknown as SessionEntry[]);
		const rebut = (quote: string) => refusals([{ finding: "1.1", quote, source: "user", explanation: "e" }], state, entries, root);
		assert.deepEqual(await rebut("Keep `foo` exported as an alias."), [], "the user's own message counts");
		for (const quote of ["the user allowed deleting foo", "the user wants no alias at all"])
			assert.deepEqual(await rebut(quote), [`the quote of the rebuttal of 1.1 is not in "user"; quote it exactly, or fix the finding.`], quote);
		// The summaries still reach the brief, labeled.
		const brief = buildBrief(entries, { level: "blind", object: "o", criterion: "c" });
		assert.ok(brief.includes("the user allowed deleting foo") && brief.includes("the user wants no alias at all"));
	});

	it("survives reload: an open dispute after a failed review, then its final answer", async () => {
		const main = await opened();
		try {
			await pass(main, ARGS, say(FIRST_FINDING));
			await main.session.reload();
			const failed = await pass(main, { ...ARGS, rebuttals: [REBUTTAL] }, () =>
				fauxAssistantMessage(fauxText("CLEAN"), { stopReason: "length" }));
			assert.equal(failed.message, `[review#2] Review failed: the reviewer did not complete normally (length)\n\n${NEXT.failed}`);
			await main.session.reload();
			const again = await pass(main, { ...ARGS, rebuttals: [REBUTTAL] }, say("CLEAN"));
			assert.ok(again.isError && again.result.includes("finding 1.1 was already rebutted with review#2; that dispute goes to the next review by itself"), again.result);
			// Incomplete output does not answer it either.
			const incomplete = await pass(main, ARGS, say("CLEAN\nUNCHECKED:\n- a.ts - unreadable"));
			assert.ok(incomplete.request!.text.includes('<dispute finding="1.1" status="open">'));
			assert.equal(incomplete.message, `[review#3] CLEAN\nUNCHECKED:\n- a.ts - unreadable\n\n${NEXT.incomplete}`);
			await main.session.reload();
			const answered = await pass(main, ARGS, say(upheld("UNDECIDED")));
			assert.ok(answered.request!.text.includes('<dispute finding="1.1" status="open">'));
			assert.ok(answered.message!.includes(`${NEXT.undecided} 1.1.`));
			await main.session.reload();
			const refused = await pass(main, { ...ARGS, rebuttals: [REBUTTAL] }, say("CLEAN"));
			assert.ok(refused.isError && refused.result.includes("finding 1.1 was upheld in review#4 on a point the user has not decided"), refused.result);
		} finally { main.session.dispose(); }
	});
});

describe("dispute mechanics", () => {
	const base = { id: "x", parentId: null, timestamp: "" };
	const entry = (data: unknown) => ({ ...base, type: "custom", customType: "review", data }) as unknown as SessionEntry;
	const rebuttal = (finding: string) => ({ finding, quote: "q", source: "user", explanation: "e" });
	const state = disputes([
		entry({ n: 1 }),
		entry({ n: 1, findings: [{ id: "1.1", text: "A" }, { id: "1.2", text: "B" }, { id: "1.3", text: "C" }] }),
		entry({ n: 2, rebuttals: [rebuttal("1.1"), rebuttal("1.2")] }),
		entry({ n: 2, findings: "junk", rulings: [{ finding: "1.3", ruling: "withdrawn" }, { finding: "1.1", ruling: "bogus" }] }),
	]);

	it("rebuilds findings and rebuttals and ignores malformed or unrebutted rulings", () => {
		assert.deepEqual([...state.keys()], ["1.1", "1.2", "1.3"]);
		assert.equal(state.get("1.1")!.rebuttal?.review, 2);
		assert.equal(state.get("1.1")!.ruling, undefined);
		assert.equal(state.get("1.3")!.ruling, undefined, "a ruling needs a rebuttal");
	});

	it("exact CLEAN withdraws the open disputes it carried; incomplete, failed and malformed answer nothing", () => {
		assert.deepEqual(settle(3, " CLEAN\n", false, state, ["1.1", "1.2"]).rulings,
			[{ finding: "1.1", ruling: "withdrawn" }, { finding: "1.2", ruling: "withdrawn" }]);
		assert.deepEqual(settle(3, "CLEAN", false, state, ["1.1"]).rulings, [{ finding: "1.1", ruling: "withdrawn" }], "only what its brief carried");
		for (const [verdict, failed] of [["CLEAN\nUNCHECKED:\n- a", false], ["Review failed: x", true], ["I could not finish", false], ["FINDINGS:", false]] as const) {
			const s = settle(3, verdict, failed, state, ["1.1", "1.2"]);
			assert.deepEqual([s.findings, s.rulings, s.notes], [[], [], ""], verdict);
			assert.equal(verdictMessage(3, verdict, failed, s.notes), `[review#3] ${verdict}\n\n${NEXT[failed ? "failed" : "incomplete"]}`);
		}
	});

	it("keeps stable ids: new findings by position, repeated disputes by DISPUTE; a missing RULING goes to the user", () => {
		const verdict = `FINDINGS:\nFINDING 1\n${FIELDS("r")}\nFINDING 2\nDISPUTE: 1.2\n${FIELDS("B")}\nANSWER: no\nFINDING 3\nDISPUTE: 7.7\n${FIELDS("z")}\nUNCHECKED:\n- f - g`;
		const s = settle(3, verdict, false, state, ["1.1", "1.2"]);
		assert.deepEqual(s.findings, [{ id: "3.1", text: FIELDS("r") }, { id: "3.3", text: `DISPUTE: 7.7\n${FIELDS("z")}` }]);
		assert.deepEqual(s.rulings, [{ finding: "1.2", ruling: "undecided", answer: "no" }, { finding: "1.1", ruling: "withdrawn" }]);
		assert.equal(s.notes, `Finding ids: FINDING 1 = 3.1, FINDING 2 = 1.2, FINDING 3 = 3.3.\n${NEXT.withdrawn} 1.1.\n${NEXT.undecided} 1.2.`);
	});

	it("parses dispute fields and ignores the UNCHECKED section", () => {
		const tail = "MISMATCH: y\nEVIDENCE: z (a.ts)\nREQUIRED OUTCOME: w";
		assert.deepEqual(findingBlocks(`FINDINGS:\nFINDING 1\nDISPUTE: 2.1.\nREQUIREMENT: a\nmore\n${tail}\nRULING: decided, the user said so\nANSWER: x\ny\nUNCHECKED:\n- p - q`), [
			{ header: "FINDING 1", text: `DISPUTE: 2.1.\nREQUIREMENT: a\nmore\n${tail}\nRULING: decided, the user said so\nANSWER: x\ny`, dispute: "2.1", ruling: "decided", answer: "x\ny" },
		]);
		assert.equal(findingBlocks("CLEAN"), undefined);
	});
});

// The reviewer's own bash: the stock tool in its cwd, with the git guard on every call, stock or offered.
describe("reviewer bash guard and offered tools", () => {
	const PROBE = "__reviewerOfferProbe";
	// Read a file unique to Main's directory instead of comparing Windows short/long or case-variant cwd spellings.
	const ECHO_CWD = `node -e "process.stdout.write(require('node:fs').readFileSync('review-cwd-marker.txt', 'utf8'))"`;
	const DENIED = "git commit -m forbidden";
	const ALLOWED = "git status --short";
	type Probe = { factories: { cwd: string; getter: string; value: unknown; label?: string }[]; executed: string[]; prepared: unknown[]; jobEvents?: string[] };

	/** A main-session extension that answers the offer with sentinel stock definitions of all six tools. */
	const OFFER = `import { createBashToolDefinition, createEditToolDefinition, createFindToolDefinition, createGrepToolDefinition, createReadToolDefinition, createWriteToolDefinition } from "@earendil-works/pi-coding-agent";
const probe = () => globalThis["${PROBE}"];
export default function (pi) {
	pi.events.on("rqw-tools:subagent-tools", (request) => {
		request.offer((cwd, settings, _nested, options) => {
			probe().factories.push({ cwd, getter: typeof settings, value: typeof settings === "function" ? settings() : undefined, label: options?.label });
			return [createReadToolDefinition, createBashToolDefinition, createEditToolDefinition, createWriteToolDefinition, createGrepToolDefinition, createFindToolDefinition].map((make) => {
				const stock = make(cwd);
				const prepare = stock.name === "grep" || stock.name === "find" ? { prepareArguments: (input) => { probe().prepared.push(input); return stock.prepareArguments ? stock.prepareArguments(input) : input; } } : {};
				return { ...stock, ...prepare, description: "SENTINEL " + stock.name, execute: (...args) => { probe().executed.push(stock.name); return stock.execute(...args); } };
			}).concat([{
				// RQW-tools' job tool carries the jobs of this session (abortAll, dispose).
				name: "job", label: "job", description: "SENTINEL job", parameters: { type: "object", properties: {} },
				execute: async () => ({ content: [{ type: "text", text: "{}" }], details: {} }),
				jobs: { abortAll: () => (probe().jobEvents ??= []).push("abortAll"), dispose: () => (probe().jobEvents ??= []).push("dispose") },
			}]);
		});
	});
}
`;

	/** One main session whose reviewer runs three bash calls, then answers CLEAN; returns what the reviewer saw. */
	async function guardedRun(withOffer: boolean) {
		const fixture = withOffer ? await mkdtemp(join(dirname(EXTENSION), ".offer-test-")) : undefined;
		const results: { name: string; isError: boolean; text: string }[] = [];
		let declared: Declared[] = [];
		const commands = [ECHO_CWD, DENIED, ALLOWED];
		let step = 0;
		const requests = scriptReviewer((context) => {
			if (step === 0) declared = declaredTools(context);
			const last = context.messages.at(-1);
			if (last?.role === "toolResult") results.push({ name: last.toolName, isError: last.isError, text: textOf(last.content) });
			if (step < commands.length) {
				const command = commands[step++];
				return fauxAssistantMessage(fauxToolCall("bash", { command, timeout: 30 }, { id: `b${step}` }), { stopReason: "toolUse" });
			}
			return fauxAssistantMessage(fauxText("CLEAN"));
		});
		const probe: Probe = { factories: [], executed: [], prepared: [] };
		(globalThis as Record<string, unknown>)[PROBE] = probe;
		try {
			if (fixture) await writeFile(join(fixture, "index.ts"), OFFER);
			const main = await openMain(full, ARGS, true, "print", fixture ? [join(fixture, "index.ts")] : []);
			try {
				await writeFile(join(main.dir, "review-cwd-marker.txt"), main.dir);
				await main.session.prompt(SECOND);
				await within(main.verdictTurn, 5000, "verdict turn");
				await main.session.waitForIdle();
				return { dir: main.dir, requests, declared, results, probe };
			} finally {
				main.session.dispose();
			}
		} finally {
			delete (globalThis as Record<string, unknown>)[PROBE];
			if (fixture) await rm(fixture, { recursive: true, force: true });
		}
	}

	for (const withOffer of [false, true]) {
		it(`${withOffer ? "offered" : "stock"} reviewer: four tools (plus job when offered), bash in its cwd, git guard on every bash call`, async () => {
			const run = await guardedRun(withOffer);
			assert.equal(run.requests.length, 4);
			const names = withOffer ? ["bash", "find", "grep", "job", "read"] : ["bash", "find", "grep", "read"];
			assert.deepEqual(run.requests[0].tools, names);
			assert.deepEqual(run.declared.map((t) => t.name).sort(), names);
			assert.equal(run.declared.find((t) => t.name === "bash")?.description.startsWith("SENTINEL bash"), withOffer);

			assert.equal(run.results.length, 3);
			assert.equal(run.results[0].name, "bash");
			assert.equal(run.results[0].isError, false);
			assert.equal(run.results[0].text.trim(), run.dir, "bash reads the marker in Main's cwd");

			assert.equal(run.results[1].name, "bash");
			assert.equal(run.results[1].isError, true);
			assert.equal(run.results[1].text, blockedGit(DENIED), "the exact blockedGit reason");
			assert.ok(blockedGit(DENIED));

			assert.doesNotMatch(run.results[2].text, /Workers may not/, "read-only git is not blocked");
			assert.equal(blockedGit(ALLOWED), undefined);

			if (withOffer) {
				assert.equal(run.probe.factories.length, 1, "one fresh factory for the child");
				assert.equal(run.probe.factories[0].cwd, run.dir, "factory receives the main cwd");
				assert.equal(run.probe.factories[0].getter, "function", "factory receives a settings getter");
				assert.equal(typeof run.probe.factories[0].value, "object");
				assert.equal(run.probe.factories[0].label, "review", "the reviewer's own session label for RQW-tools notes");
				assert.deepEqual(run.probe.executed, ["bash", "bash"], "offered execute reached for allowed bash only, never for the blocked git");
				assert.deepEqual(run.probe.jobEvents, ["dispose"], "the reviewer's jobs end with the review");
			} else {
				assert.deepEqual(run.probe.factories, [], "no offer: stock tools");
				assert.deepEqual(run.probe.executed, []);
			}
		});
	}

	it("offered reviewer: an abort of the review aborts its background jobs, and the end of the review disposes them", async () => {
		const fixture = await mkdtemp(join(dirname(EXTENSION), ".offer-test-"));
		const started = Promise.withResolvers<void>();
		const aborted = Promise.withResolvers<void>();
		scriptReviewer((_context, options) => {
			started.resolve();
			const answer = Promise.withResolvers<AssistantMessage>();
			options?.signal?.addEventListener("abort", () => {
				aborted.resolve();
				answer.resolve(fauxAssistantMessage(fauxText("late")));
			});
			return answer.promise;
		});
		const probe: Probe = { factories: [], executed: [], prepared: [] };
		(globalThis as Record<string, unknown>)[PROBE] = probe;
		try {
			await writeFile(join(fixture, "index.ts"), OFFER);
			const main = await openMain(full, ARGS, true, "print", [join(fixture, "index.ts")]);
			try {
				// Print mode holds the prompt until the verdict: start it, abort the review from outside.
				const run = main.session.prompt(SECOND).catch(() => {});
				await within(started.promise, 5000, "reviewer request");
				await main.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
				await within(aborted.promise, 5000, "reviewer abort");
				await until(() => (probe.jobEvents ?? []).includes("dispose"), "jobs disposed");
				await within(run, 5000, "main run ends");
				assert.deepEqual(probe.jobEvents, ["abortAll", "dispose"]);
			} finally {
				main.session.dispose();
			}
		} finally {
			delete (globalThis as Record<string, unknown>)[PROBE];
			await rm(fixture, { recursive: true, force: true });
		}
	});

	it("offered grep and find: optional null, blank and undefined arguments are dropped before the offered prepare, and the session runs them", async () => {
		const fixture = await mkdtemp(join(dirname(EXTENSION), ".offer-test-"));
		const results: { name: string; isError: boolean; text: string }[] = [];
		const calls = [
			fauxToolCall("grep", { pattern: "foo", glob: "null", path: "  " }, { id: "g1" }),
			fauxToolCall("find", { pattern: "*.ts", path: "null", limit: "undefined" }, { id: "f1" }),
		];
		let step = 0;
		const requests = scriptReviewer((context) => {
			const last = context.messages.at(-1);
			if (last?.role === "toolResult") results.push({ name: last.toolName, isError: last.isError, text: textOf(last.content) });
			if (step < calls.length) return fauxAssistantMessage(calls[step++], { stopReason: "toolUse" });
			return fauxAssistantMessage(fauxText("CLEAN"));
		});
		const probe: Probe = { factories: [], executed: [], prepared: [] };
		(globalThis as Record<string, unknown>)[PROBE] = probe;
		try {
			await writeFile(join(fixture, "index.ts"), OFFER);
			const main = await openMain(full, ARGS, true, "print", [join(fixture, "index.ts")]);
			try {
				await writeFile(join(main.dir, "a.ts"), "const foo = 1;\n");
				await main.session.prompt(SECOND);
				assert.equal(await within(main.verdictTurn, 5000, "verdict turn"), clean());
				await main.session.waitForIdle();
				assert.equal(requests.length, 3);
				assert.equal(results.length, 2);
				assert.equal(results[0].name, "grep");
				assert.equal(results[0].isError, false);
				assert.ok(results[0].text.includes("a.ts") && results[0].text.includes("const foo = 1"), results[0].text);
				assert.equal(results[1].name, "find");
				assert.equal(results[1].isError, false);
				assert.ok(results[1].text.includes("a.ts"), results[1].text);
				assert.deepEqual(probe.prepared, [{ pattern: "foo" }, { pattern: "*.ts" }], "the offered prepare ran for each call with only the required pattern");
				assert.deepEqual(probe.executed, ["grep", "find"], "execute used the offered definitions");
				assert.equal(probe.factories.length, 1);
			} finally {
				main.session.dispose();
			}
		} finally {
			delete (globalThis as Record<string, unknown>)[PROBE];
			await rm(fixture, { recursive: true, force: true });
		}
	});
});
