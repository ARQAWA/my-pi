// The review tool inside real Pi sessions, no model. The main session loads the extension from its file the way Pi
// loads a package extension; two faux providers stand in for the main model and for the reviewer models
// (`openai-codex/gpt-6.1-sol`), and record every request they get.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { getEventListeners } from "node:events";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
import { buildBrief, CYCLE_PATH, DESCRIPTION, findingBlocks, kindOf, LEVELS, NEXT, rejectedEarlier, REVIEWER as PRODUCTION_REVIEWER, REVIEWER_TOOLS, reviewerTools, startedText, verdictMessage, verdictOf } from "../index.ts";
import { blockedGit } from "../git-guard.ts";

const kindOfMessage = (verdict: string) => verdictMessage(1, verdict, false).split("\n\n").at(-1);

/** The delivered message of review `n` for a verdict of each kind: the verdict verbatim, then the next step. */
const CLEAN_VERDICT = "CLEAN\nCHECKED:\n- a.ts: inspected against the requested criterion.";
const clean = (n = 1) => `[review#${n}] ${CLEAN_VERDICT}\n\n${NEXT.clean}`;
/** Missing coverage evidence or malformed findings get the incomplete paragraph. */
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
// Review selection is fixed even when the caller belongs to another provider.
const gptMainFaux = fauxProvider({ provider: "openai", models: [{ id: "gpt-main" }] });
const reviewerFaux = fauxProvider({ provider: "openai-codex", models: [{ id: "gpt-6.1-sol", reasoning: true }] });
const claudeFaux = fauxProvider({ provider: "anthropic", models: [{ id: "claude-sonnet-5-5", reasoning: true }] });

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
	const runtime = async (...reviewers: (typeof reviewerFaux)[]) => {
		const r = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
		r.registerNativeProvider(mainFaux.provider);
		r.registerNativeProvider(gptMainFaux.provider);
		for (const reviewer of reviewers) r.registerNativeProvider(reviewer.provider);
		return r;
	};
	full = await runtime(reviewerFaux, claudeFaux);
	// Claude credentials must not be used as a fallback for missing Codex auth.
	mainOnly = await runtime(claudeFaux);
	// Override the catalog so the required Codex model is absent.
	otherModels = await runtime(fauxProvider({ provider: "openai-codex", models: [{ id: "other" }] }));

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

describe("reviewer prompt and verdict contract", () => {
	it("pins the approved canonical reviewer prompt independently of the production loader", () => {
		assert.equal(createHash("sha256").update(REVIEWER).digest("hex"),
			"ee2803c95b6659a047e707053d07d586d02fbad86becfe54ae6b6599ba00e2bf");
	});

	it("loads REVIEWER.md byte for byte after CRLF normalization and trimEnd", () => {
		assert.equal(PRODUCTION_REVIEWER, REVIEWER_SOURCE.replace(/\r\n/g, "\n").trimEnd());
	});

	it("loads a CRLF checkout through the production loader as canonical LF", async () => {
		const dir = await mkdtemp(join(dirname(EXTENSION), ".crlf-test-"));
		try {
			for (const file of ["index.ts", "git-guard.ts", "fast-gpt.ts", "counts.ts"])
				await writeFile(join(dir, file), readFileSync(join(dirname(EXTENSION), file), "utf8"));
			await writeFile(join(dir, "REVIEWER.md"), REVIEWER_SOURCE.replace(/\n/g, "\r\n"));
			const loaded = await import(pathToFileURL(join(dir, "index.ts")).href);
			assert.equal(loaded.REVIEWER, REVIEWER);
			assert.ok(!loaded.REVIEWER.includes("\r"));
		} finally { await rm(dir, { recursive: true, force: true }); }
	});

	it("carries the pending-review caller instruction in both discovery and the started receipt", () => {
		for (const rule of [
			"Do not declare the task complete before this review's verdict is received and handled.",
			"If no other work remains, end this turn silently and wait for the automatic verdict notification; do not poll or take filler turns.",
			"Owner messages and interrupts remain allowed.",
			"A failed or incomplete verdict is not acceptance.",
		]) {
			assert.ok(DESCRIPTION.includes(rule), rule);
			assert.ok(startedText(1).includes(rule), rule);
		}
	});

	it("keeps the source cycle in the canonical skill and points every verdict to it", () => {
		const cycle = readFileSync(CYCLE_PATH, "utf8").replace(/\s+/g, " ");
		for (const next of Object.values(NEXT)) assert.ok(next.includes(CYCLE_PATH));
		assert.ok(DESCRIPTION.includes("/skill:blindreview or /skill:highreview"));
		const sections = ["<user_messages>", "<agreement>", "<object>", "<criterion>", "<rejected_earlier>"];
		const positions = sections.map(section => cycle.indexOf(section));
		assert.ok(positions.every((at, i) => at >= 0 && (i === 0 || at > positions[i - 1])));
		for (const rule of [
			"Use only when the user asks for review or a checked result, or an invoked skill requires it; never on your own initiative.",
			"blind uses Smarty (GPT-6.1-Sol low), high uses Bossy (GPT-6.1-Sol medium), only when requested.",
			"Keep working, but leave reviewed files unchanged until it arrives.",
			"Supply primary requirements, governing rules and evidence, not only your summary; use absolute paths for work in another directory.",
			"Do not impose file, search, tool-call or turn quotas.",
			"By default a reviewer inherits GPT Fast; pass fast_gpt false when the user forbids Fast for subagents.",
		]) assert.ok(DESCRIPTION.includes(rule), rule);
		for (const rule of [
			"complete CHECKED evidence and no UNCHECKED",
			"preserve every independent pass and its order required by the invoking procedure",
		]) assert.ok(cycle.includes(rule), rule);
		for (const rule of [
			"Find each quote by searching for it.",
			"for an omission, verify the quoted requirement and the complete inspected file or section",
			"Fix it exactly to its REQUIRED OUTCOME and no further",
			"do not reject it, argue with it or put it to the user",
			"Reject a finding only when a quote is not verbatim",
			"the allegedly missing content is present in the cited object",
			"a NOT AGREED element is covered by a verbatim quote of the agreement",
			"give that reason with the quote",
			"same level, object and criterion and every rejection so far in rejected_earlier, until CLEAN",
		]) assert.ok(cycle.includes(rule), rule);
		assert.ok(cycle.includes("incomplete regardless of its leading verdict"));
		assert.ok(cycle.includes("never record it as acceptance"));
		assert.ok(cycle.includes("Call review again once on the unchanged object; if it fails again, tell the user and wait."));
		assert.deepEqual(REVIEWER_TOOLS, ["read", "bash", "grep", "find"]);
	});
});

describe("verdict classification", () => {
	it("requires nonempty CHECKED evidence for CLEAN, including CRLF output", () => {
		for (const verdict of [CLEAN_VERDICT, ` \n${CLEAN_VERDICT}\t `, CLEAN_VERDICT.replace(/\n/g, "\r\n"), "CLEAN\nCHECKED: a.ts inspected against criterion."])
			assert.equal(verdictMessage(1, verdict, false), `[review#1] ${verdict}\n\n${NEXT.clean}`);
		for (const verdict of ["CLEAN", " \nCLEAN\t ", "CLEAN\nCHECKED:", "CLEAN\nCHECKED:\n  ", "CLEAN extra text", "CLEAN\nFINDINGS:\nFINDING 1", `${CLEAN_VERDICT}\nUNCHECKED:\n- source unreadable`, `${CLEAN_VERDICT}\n  UNCHECKED: source unreadable`, `${CLEAN_VERDICT}\nCHECKED: duplicate`, `${CLEAN_VERDICT}\nFINDING 1\n${FIELDS()}`]) {
			assert.equal(kindOf(verdict, false), "incomplete", verdict);
			assert.equal(verdictMessage(2, verdict, false), other(verdict, 2));
		}
	});
	it("UNCHECKED overrides even structurally complete findings; provider failures remain failed", () => {
		const findings = `FINDINGS:\nFINDING 1\n${FIELDS()}`;
		assert.equal(verdictMessage(3, findings, false), `[review#3] ${findings}\n\n${NEXT.findings}`);
		const unchecked = `${findings}\nUNCHECKED:\n- a.ts unreadable`;
		assert.equal(verdictMessage(3, unchecked, false), other(unchecked, 3));
		assert.equal(kindOf(CLEAN_VERDICT, true), "failed");
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
		const g = gate(CLEAN_VERDICT);
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
	it("is registered with the source-contract description and a strict-mode schema", async () => {
		scriptReviewer(() => fauxAssistantMessage(fauxText(CLEAN_VERDICT)));
		const main = await openMain(full, { level: "blind", object: "a.ts", criterion: "c" });
		try {
			await main.session.prompt("hello");
			const review = main.tools.find((t) => t.name === "review");
			assert.ok(review, "the main model sees a review tool");
			assert.match(review.description, /\[review#N\]/);
			assert.equal(review.description, DESCRIPTION);
			assert.equal((review.parameters as { properties: { criterion: { description: string } } }).properties.criterion.description,
				"What this check confirms and which deliverable must fulfill each obligation; an exclusion cannot silently waive a governing requirement of this pass.");
			assert.ok(review.description.includes("separate read-only model on your team"), "the teammate sentence");
			const strict = makeStrictJsonSchema(structuredClone(review.parameters) as never);
			assert.deepEqual(Object.keys((strict as { properties: object }).properties).sort(), [
				"agreement",
				"criterion",
				"fast_gpt",
				"level",
				"object",
				"rejected_earlier",
			]);
			const rejection = (strict as { properties: { rejected_earlier: { anyOf: { items: { required: string[] } }[] } } }).properties.rejected_earlier.anyOf[0].items;
			assert.deepEqual(rejection.required.sort(), ["finding", "reason"]);

			assert.deepEqual((review.parameters as { required: string[] }).required.sort(), ["criterion", "level", "object"]);
		} finally {
			main.session.dispose();
		}
	});

	it("blind: Sol low, REVIEWER.md as the prompt, read/bash/grep/find only, the user's words verbatim, verdict as a follow-up", async () => {
		const requests = scriptReviewer(() => fauxAssistantMessage(fauxText(CLEAN_VERDICT)));
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
			assert.equal(r.model, "gpt-6.1-sol");
			assert.equal(r.reasoning, "low");
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
			assert.ok(!r.text.includes("<rejected_earlier>"), "no rejected history when none supplied");

			assert.equal(turn, clean(), "the verdict started a main turn");
			const delivered = reviewMessages(main.session);
			assert.equal(delivered.length, 1);
			assert.equal(delivered[0]?.content, clean());
			assert.ok(clean().endsWith(`\n\n${NEXT.clean}`), "the CLEAN paragraph");
			assert.equal(delivered[0]?.display, true);
			assert.deepEqual(
				{ ...(delivered[0]?.details as Record<string, unknown>), seconds: 0 },
				{ n: 1, level: "blind", model: "openai-codex/gpt-6.1-sol", thinking: "low", seconds: 0 },
			);
			const result = main.session.messages.find((m) => m.role === "toolResult" && m.toolName === "review");
			assert.equal(result?.role === "toolResult" ? textOf(result.content) : "", startedText(1));
			assert.equal(startedText(1),
				"review#1 started. Keep working, but leave the reviewed files unchanged until its verdict. " +
				"Do not declare the task complete before this review's verdict is received and handled. " +
				"If no other work remains, end this turn silently and wait for the automatic verdict notification; " +
				"do not poll or take filler turns. Owner messages and interrupts remain allowed. " +
				"A failed or incomplete verdict is not acceptance.");
		} finally {
			main.session.dispose();
		}
	});

	it("high: Sol medium; empty optional fields are omitted and findings pass through", async () => {
		const findings = `FINDINGS:\nFINDING 1\n${FIELDS()}`;
		const requests = scriptReviewer(() => fauxAssistantMessage(fauxText(findings)));
		const main = await openMain(full, { level: "high", object: "a.ts", criterion: "c", agreement: "", rejected_earlier: [] });
		try {
			await main.session.prompt(SECOND);
			const turn = await within(main.verdictTurn, 5000, "verdict turn");
			await main.session.waitForIdle();
			assert.equal(requests.length, 1);
			assert.equal(requests[0].model, "gpt-6.1-sol");
			assert.equal(requests[0].reasoning, "medium");
			assert.ok(!requests[0].text.includes("<agreement>") && !requests[0].text.includes("<rejected_earlier>"));
			assert.ok(requests[0].text.includes("<criterion>\nc\n</criterion>"));
			assert.equal(turn, `[review#1] ${findings}\n\n${NEXT.findings}`);
		} finally { main.session.dispose(); }
	});

	it("pins both profiles independently of the caller", () => {
		assert.deepEqual(LEVELS, {
			blind: { provider: "openai-codex", model: "gpt-6.1-sol", thinking: "low" },
			high: { provider: "openai-codex", model: "gpt-6.1-sol", thinking: "medium" },
		});
	});

	for (const [caller, provider] of [["GPT", gptMainFaux], ["Claude", claudeFaux]] as const) {
		for (const [level, thinking] of [["blind", "low"], ["high", "medium"]] as const) {
			it(`${caller} caller, ${level}: fixed Codex reviewer with ${thinking} reasoning`, async () => {
				const requests = scriptReviewer(() => fauxAssistantMessage(fauxText(CLEAN_VERDICT)));
				const main = await openMain(full, { level, object: "a.ts", criterion: "c" }, true, "print", [], [], provider);
				try {
					await main.session.prompt(SECOND);
					assert.deepEqual(requests.map(r => [r.model, r.reasoning]), [["gpt-6.1-sol", thinking]]);
					assert.equal(requests[0].messages, 1);
					assert.deepEqual({ ...(reviewMessages(main.session)[0]?.details as Record<string, unknown>), seconds: 0 },
						{ n: 1, level, model: "openai-codex/gpt-6.1-sol", thinking, seconds: 0 });
					assert.deepEqual(delivered(main.session), [clean()]);
				} finally { main.session.dispose(); }
			});
		}
	}

	it("preserves a preamble instead of salvaging a FINDINGS verdict", async () => {
		const verdict = `Preamble.\nFINDINGS:\nFINDING 1\n${FIELDS()}`;
		const requests = scriptReviewer(() => fauxAssistantMessage(fauxText(verdict)));
		const main = await openMain(full, { level: "blind", object: "a.ts", criterion: "c" }, true, "print");
		try {
			await main.session.prompt(SECOND);
			assert.equal(requests.length, 1);
			assert.deepEqual(delivered(main.session), [other(verdict)]);
		} finally { main.session.dispose(); }
	});

	it("verdictOf trims only outer whitespace without salvaging malformed output", () => {
		const body = `FINDINGS:\nFINDING 1\n${FIELDS()}`;
		for (const text of [body, `remark\n${body}`, `remark\r\n${body.replace(/\n/g, "\r\n")}`, "CLEAN", "remark\nCLEAN", "I think FINDINGS: none", "CLEAN\nFINDINGS:\nFINDING 1"])
			assert.equal(verdictOf(`  \n${text}\t `), text);
		assert.equal(kindOfMessage(verdictOf(`remark\n${body}`)), NEXT.incomplete);
	});

	for (const [what, runtime, expected] of [
		["missing Codex model", () => otherModels, "model openai-codex/gpt-6.1-sol is not available"],
		["missing Codex credentials despite available Claude credentials", () => mainOnly, "no credentials for openai-codex (model openai-codex/gpt-6.1-sol); review requires Codex credentials, no fallback"],
	] as const) {
		it(`${what}: explicit failure with no fallback request`, async () => {
			const requests = scriptReviewer(() => fauxAssistantMessage(fauxText(CLEAN_VERDICT)));
			const claudeRequests = scriptReviewer(() => fauxAssistantMessage(fauxText(CLEAN_VERDICT)), claudeFaux);
			const main = await openMain(runtime(), { level: "blind", object: "a.ts", criterion: "c" }, true, "print");
			try {
				await main.session.prompt(SECOND);
				assert.deepEqual(delivered(main.session), [failedWith(expected)]);
				assert.equal(requests.length, 0);
				assert.equal(claudeRequests.length, 0);
			} finally { main.session.dispose(); }
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
			const reviewer = gate(CLEAN_VERDICT);
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
		const reviews = scriptReviewer(() => fauxAssistantMessage(fauxText(CLEAN_VERDICT)));
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

import reviewExtension, { registerReview } from "../index.ts";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

describe("runtime regressions and controls", () => {
	it("a length-truncated CLEAN fails instead of passing", async () => {
		scriptReviewer(() => fauxAssistantMessage(fauxText(CLEAN_VERDICT), { stopReason: "length" }));
		const main = await openMain(full, ARGS, true, "print");
		try {
			await main.session.prompt(SECOND);
			assert.deepEqual(delivered(main.session), [failedWith("the reviewer did not complete normally (length)")]);
		} finally { main.session.dispose(); }
	});

	for (const mode of ["tui", "rpc"] as const) {
		it(`${mode} verdict finishing after abort stays saved until the next user run`, async () => {
			const reviewer = gate(CLEAN_VERDICT);
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
			const reviewer = gate(CLEAN_VERDICT);
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

	for (const finish of ["resolve", "reject"] as const) {
		it(`host shutdown bounds an auth check ignoring cancellation, including late ${finish}`, async () => {
			type Handler = (event: never, ctx: never) => unknown;
			const handlers = new Map<string, Handler>();
			let definition: ToolDefinition | undefined;
			const messages: { content: unknown }[] = [];
			const entries: unknown[] = [];
			const events = createEventBus();
			const lifetime = new AbortController();
			const pi = {
				on: (n: string, h: Handler) => handlers.set(n, h),
				registerTool: (d: ToolDefinition) => { definition = d; },
				sendMessage: (m: { content: unknown }) => messages.push(m),
				appendEntry: (customType: string, data: unknown) => entries.push({ type: "custom", customType, data }),
				events,
			} as unknown as ExtensionAPI;
			registerReview(pi, { events, fast: () => false, signal: lifetime.signal });
			const auth = Promise.withResolvers<unknown>();
			let authSignal: AbortSignal | undefined;
			let sessionStage = false;
			const ctx = { mode: "print", isIdle: () => false, signal: new AbortController().signal,
				sessionManager: { getEntries: () => entries, getBranch: () => [] },
				modelRegistry: { find: () => reviewerFaux.getModel("gpt-6.1-sol"), hasConfiguredAuth: () => false,
					runtime: { checkAuth: (_provider: string, options: { signal: AbortSignal }) => {
						authSignal = options.signal;
						return auth.promise;
					} } },
				get cwd() { sessionStage = true; return root; },
			} as unknown as ExtensionContext;
			await definition!.execute("auth", ARGS as never, undefined, undefined, ctx as never);
			assert.deepEqual(entries, [{ type: "custom", customType: "review", data: { n: 1 } }], "ID persisted before auth completes");
			const boundary = Promise.resolve(handlers.get("agent_end")!({} as never, ctx as never));
			lifetime.abort();
			await within(boundary, 1000, "host shutdown despite pending auth");
			assert.equal(authSignal?.aborted, true);
			assert.equal(getEventListeners(authSignal!, "abort").length, 0, "auth wait listener removed");
			assert.equal(getEventListeners(lifetime.signal, "abort").length, 0, "host lifetime listener removed");
			assert.deepEqual(messages, [], "shutdown delivers no verdict");
			assert.equal(sessionStage, false);
			if (finish === "reject") auth.reject(new Error("late auth rejection"));
			else auth.resolve({});
			await nextLoop();
			assert.equal(sessionStage, false, "late auth cannot create a child");
			assert.deepEqual(messages, []);
		});
	}

	it("has no deadline at the former 30-minute boundary and finishes CLEAN when released", async (t) => {
		const response = Promise.withResolvers<AssistantMessage>();
		const started = Promise.withResolvers<void>();
		let signal: AbortSignal | undefined;
		const requests = scriptReviewer((_context, options) => {
			signal = options?.signal;
			started.resolve();
			return response.promise;
		});
		const main = await openMain(full, ARGS, true, "print");
		let run: Promise<void> | undefined;
		let settled = false;
		try {
			t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
			run = main.session.prompt(SECOND).then(() => { settled = true; });
			await started.promise;
			assert.equal(signal?.aborted, false);
			t.mock.timers.tick(30 * 60 * 1000);
			await nextLoop();
			assert.equal(signal?.aborted, false, "elapsed time does not cancel the reviewer");
			assert.equal(settled, false, "the caller still waits for its reviewer");
			assert.deepEqual(delivered(main.session), []);
			assert.equal(requests.length, 1);
			t.mock.timers.reset();
			response.resolve(fauxAssistantMessage(fauxText(CLEAN_VERDICT)));
			await within(run, 1000, "released reviewer finishes");
			assert.deepEqual(delivered(main.session), [clean()]);
			assert.equal(requests.length, 1, "no replacement reviewer or retry");
		} finally {
			t.mock.timers.reset();
			response.resolve(fauxAssistantMessage(fauxText(CLEAN_VERDICT)));
			await run;
			main.session.dispose();
		}
	});

	it("arbitrary malformed output is incomplete, never findings", () => {
		for (const v of ["UNCHECKED:\n- a.ts unreadable", "I could not finish", "FINDINGS:"]) {
			assert.ok(verdictMessage(1, v, false).endsWith(NEXT.incomplete), v);
		}
	});

	it("structure: empty or partial finding blocks, malformed headers, preambles and stray text are incomplete", () => {
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


		for (const [what, verdict] of bad) {
			assert.equal(findingBlocks(verdict), undefined, what);
			assert.equal(verdictMessage(3, verdict, false), `[review#3] ${verdict}\n\n${NEXT.incomplete}`, what);
		}
		assert.equal(findingBlocks(full)?.length, 1);
		assert.equal(verdictMessage(3, full, false), `[review#3] ${full}\n\n${NEXT.findings}`);
	});

	it("every call starts with no reviewer history", async () => {
		const requests = scriptReviewer(() => fauxAssistantMessage(fauxText(CLEAN_VERDICT)));
		const main = await openMain(full, ARGS, true, "print");
		scriptMain([fauxAssistantMessage([fauxToolCall("review", ARGS, { id: "r1" }), fauxToolCall("review", { ...ARGS, level: "high" }, { id: "r2" })], { stopReason: "toolUse" })]);
		try {
			await main.session.prompt(SECOND);
			assert.equal(requests.length, 2);
			assert.deepEqual(requests.map(r => [r.model, r.reasoning]).sort(), [["gpt-6.1-sol", "low"], ["gpt-6.1-sol", "medium"]]);
			assert.ok(requests.every(r => r.messages === 1), "the brief is the only message of each fresh session");
			assert.ok(requests.every(r => !r.text.includes("[review#")));
			assert.equal(delivered(main.session).length, 2);
		} finally { main.session.dispose(); }
	});
});

describe("nested caller and scope transport", () => {
	it("reload preserves an issued nested review id even without a verdict", async () => {
		const reviewer = gate(CLEAN_VERDICT);
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
			scriptReviewer(() => fauxAssistantMessage(fauxText(CLEAN_VERDICT)));
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
		const reviews = scriptReviewer(() => fauxAssistantMessage(fauxText(CLEAN_VERDICT)));
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
	for (const finish of ["resolve", "reject"] as const) {
		it(`native prompt auth preflight: late ${finish} after session shutdown cannot request a model`, async (t) => {
			const reviews = scriptReviewer(() => fauxAssistantMessage(fauxText(CLEAN_VERDICT)));
			const main = await openMain(full, ARGS, true, "print");
			const mainResponding = Promise.withResolvers<void>();
			const requests = scriptMain([callReview(), async () => {
				mainResponding.resolve();
				return fauxAssistantMessage(fauxText("started"));
			}]);
			const auth = await full.checkAuth("openai-codex");
			assert.ok(auth);
			const preflight = Promise.withResolvers<typeof auth>();
			const entered = Promise.withResolvers<void>();
			const hasAuth = full.hasConfiguredAuth.bind(full);
			const check = full.checkAuth.bind(full);
			let calls = 0;
			let reviewSignal: AbortSignal | undefined;
			t.mock.method(full, "hasConfiguredAuth", (provider: string) => provider === "openai-codex" ? false : hasAuth(provider));
			t.mock.method(full, "checkAuth", (provider: string, options?: { signal?: AbortSignal }) => {
				if (provider !== "openai-codex") return check(provider, options);
				if (++calls === 1) {
					reviewSignal = options?.signal;
					return Promise.resolve(auth);
				}
				assert.equal(options?.signal, undefined, "native Pi 1.4 prompt preflight has no abort signal");
				entered.resolve();
				return preflight.promise;
			});
			try {
				const run = main.session.prompt(SECOND);
				await entered.promise;
				await mainResponding.promise;
				await main.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
				await within(run, 1000, "main finishes while prompt preflight remains pending");
				assert.equal(reviewSignal?.aborted, true);
				assert.equal(getEventListeners(reviewSignal!, "abort").length, 0, "review listeners removed");
				assert.equal(reviews.length, 0);
				assert.deepEqual(delivered(main.session), []);
				if (finish === "reject") preflight.reject(new Error("late auth rejection"));
				else preflight.resolve(auth);
				await nextLoop();
				assert.equal(reviews.length, 0, "abandoned preflight never reaches the provider");
				assert.equal(requests.length, 2, "shutdown starts no verdict turn");
				assert.deepEqual(delivered(main.session), []);
			} finally {
				preflight.resolve(auth);
				main.session.dispose();
			}
		});
	}

	it("session shutdown releases a provider ignoring abort and observes its late rejection", async () => {
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
			const run = main.session.prompt(SECOND);
			await started.promise;
			await main.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
			await within(run, 1000, "shutdown despite ignoring provider");
			assert.equal(signal?.aborted, true);
			assert.deepEqual(delivered(main.session), []);
			response.reject(new Error("late provider rejection"));
			await nextLoop();
			assert.deepEqual(delivered(main.session), []);
		} finally {
			response.resolve(fauxAssistantMessage(fauxText(CLEAN_VERDICT)));
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
				scriptReviewer(() => fauxAssistantMessage(fauxText(CLEAN_VERDICT)));
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
	it("disposes a session created across session shutdown without prompting it", async (t) => {
		const handlers = new Map<string, (event: never, ctx: never) => unknown>();
		let definition: ToolDefinition | undefined;
		const messages: { content: unknown }[] = [];
		const reviews = scriptReviewer(() => fauxAssistantMessage(fauxText(CLEAN_VERDICT)));
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
		// Shutdown lands after loader reload, just before createAgentSession starts.
		const inMemory = SessionManager.inMemory;
		t.mock.method(SessionManager, "inMemory", (...args: Parameters<typeof SessionManager.inMemory>) => {
			handlers.get("session_shutdown")!({} as never, {} as never);
			return inMemory.apply(SessionManager, args);
		});
		const ctx = { mode: "print", cwd: root, signal: new AbortController().signal, isIdle: () => false,
			sessionManager: { getSessionId: () => "shutdown-parent", getEntries: () => [], getBranch: () => [] },
			modelRegistry: { find: () => reviewerFaux.getModel("gpt-6.1-sol"), hasConfiguredAuth: () => true, runtime: full },
		} as unknown as ExtensionContext;
		handlers.get("session_start")!({} as never, ctx as never);
		await definition!.execute("create", ARGS as never, undefined, undefined, ctx);
		await handlers.get("agent_end")!({} as never, ctx as never);
		await nextLoop();
		assert.equal(disposed, 1);
		assert.equal(reviews.length, 0);
		assert.deepEqual(messages, [], "no verdict is delivered to a closed caller");
	});

	it("disposes a created session whose system prompt getter throws once, without prompting or masking the refusal", async (t) => {
		const handlers = new Map<string, (event: never, ctx: never) => unknown>();
		let definition: ToolDefinition | undefined;
		const messages: { content: unknown }[] = [];
		const reviews = scriptReviewer(() => fauxAssistantMessage(fauxText(CLEAN_VERDICT)));
		const dispose = AgentSession.prototype.dispose;
		let disposed = 0;
		t.mock.method(AgentSession.prototype, "dispose", function (this: AgentSession) {
			disposed++;
			return dispose.call(this);
		});
		t.mock.getter(AgentSession.prototype, "systemPrompt", () => { throw new Error("prompt getter boom"); });
		reviewExtension({
			on: (n: string, h: (event: never, ctx: never) => unknown) => handlers.set(n, h),
			registerTool: (d: ToolDefinition) => { definition = d; },
			appendEntry: () => {},
			sendMessage: (m: { content: unknown }) => messages.push(m),
			events: { emit: () => {}, on: () => () => {} },
			getSettings: () => ({}),
			getActiveTools: () => [],
		} as unknown as ExtensionAPI);
		const ctx = { mode: "print", cwd: root, signal: new AbortController().signal, isIdle: () => false,
			sessionManager: { getSessionId: () => "prompt-getter-parent", getEntries: () => [], getBranch: () => [] },
			modelRegistry: { find: () => reviewerFaux.getModel("gpt-6.1-sol"), hasConfiguredAuth: () => true, runtime: full },
		} as unknown as ExtensionContext;
		handlers.get("session_start")!({} as never, ctx as never);
		await definition!.execute("prompt-getter", ARGS as never, undefined, undefined, ctx);
		await handlers.get("agent_end")!({} as never, ctx as never);
		handlers.get("agent_before_settle")!({} as never, ctx as never);
		await nextLoop();
		assert.equal(disposed, 1);
		assert.equal(reviews.length, 0);
		assert.equal(messages.length, 1);
		assert.equal(messages[0].content, failedWith("prompt getter boom"));
	});

	for (const abort of [false, true]) {
		it(`native agent_end signal removes its wait listener after ${abort ? "abort" : "normal delivery"}`, async () => {
			const observed: { active?: AbortSignal; end?: AbortSignal; boundary?: AbortSignal } = {};
			(globalThis as any).__reviewLifecycle = observed;
			const reviewer = gate(CLEAN_VERDICT);
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
		const reviews = scriptReviewer(() => fauxAssistantMessage(fauxText(CLEAN_VERDICT)));
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
			assert.equal(lookups, 1, "the one allowed start looked up only Codex; exhaustion starts no job");
			assert.deepEqual(persisted, [{ n: max }]);
			await nextLoop();
		});
	}
});

describe("rejection history", () => {
	const base = { id: "x", parentId: null, timestamp: "" };
	const entry = (data: unknown, customType = "review") => ({ ...base, type: "custom", customType, data }) as unknown as SessionEntry;
	const first = { finding: "The alias must be deleted.", reason: 'The agreement says "Keep foo as an alias".' };
	const anotherReason = { ...first, reason: 'The object already has "export const foo = bar;".' };
	const second = { finding: "Missing export.", reason: 'The object has "export const bar = 1;".' };
	const params = { level: "blind" as const, object: "a.ts", criterion: "c" };
	const scoped = (rejected_earlier: unknown, overrides = {}) => entry({ n: 1, ...params, rejected_earlier, ...overrides });

	it("merges rounds and current reasons in order, deduplicating only exact finding/reason pairs", () => {
		const entries = [scoped([first]), scoped([first, anotherReason]), scoped([second])];
		assert.deepEqual(rejectedEarlier(entries, { ...params, rejected_earlier: [first, second, anotherReason] }), [first, anotherReason, second]);
		assert.deepEqual(rejectedEarlier(entries, params), [first, anotherReason, second]);
		assert.deepEqual(rejectedEarlier([], { ...params, rejected_earlier: [first, first, anotherReason] }), [first, anotherReason]);
	});

	it("never imports a different level, object, criterion, entry kind or legacy dispute state", () => {
		const unrelated = [
			scoped([first], { level: "high" }), scoped([first], { object: "b.ts" }), scoped([first], { criterion: "different" }),
			entry({ ...params, rejected_earlier: [first] }, "another-extension"),
			{ ...base, type: "custom_message", customType: "review", data: { ...params, rejected_earlier: [first] }, content: "irrelevant" } as unknown as SessionEntry,
			entry({ n: 1, findings: [{ id: "1.1", text: "obsolete" }], rebuttals: [{ finding: "1.1" }], rulings: [] }),
		];
		assert.deepEqual(rejectedEarlier(unrelated, params), []);
		assert.deepEqual(rejectedEarlier([...unrelated, scoped([second])], params), [second]);
	});

	it("ignores malformed persisted items and treats null optional arguments as absent", () => {
		const entries = [entry(undefined), scoped(null), scoped("bad"), scoped([null, {}, { finding: 1, reason: "r" }, { finding: "f", reason: 1 }, first])];
		assert.deepEqual(rejectedEarlier(entries, { ...params, rejected_earlier: null }), [first]);
		assert.deepEqual(rejectedEarlier([], { ...params, rejected_earlier: null }), []);
		assert.equal(buildBrief([], { ...params, agreement: null, rejected_earlier: null }),
			"<user_messages>\n\n</user_messages>\n\n<object>\na.ts\n</object>\n\n<criterion>\nc\n</criterion>");
		for (const agreement of ["", " \n "])
			assert.equal(buildBrief([], { ...params, agreement }), buildBrief([], params));
	});

	it("buildBrief uses exactly user_messages, agreement, object, criterion, rejected_earlier source order", () => {
		const user = "Review this.\n  Keep spaces  ";
		const entries = [{ ...base, type: "message", message: { role: "user", content: user, timestamp: 0 } } as SessionEntry, scoped([first])];
		const brief = buildBrief(entries, { ...params, agreement: "Accepted proposal verbatim.  ", rejected_earlier: [anotherReason] });
		assert.equal(brief, [
			`<user_messages>\n<message n="1">\n${user}\n</message>\n</user_messages>`,
			"<agreement>\nAccepted proposal verbatim.  \n</agreement>",
			"<object>\na.ts\n</object>", "<criterion>\nc\n</criterion>",
			`<rejected_earlier>\nFINDING:\n${first.finding}\nREASON:\n${first.reason}\n\nFINDING:\n${anotherReason.finding}\nREASON:\n${anotherReason.reason}\n</rejected_earlier>`,
		].join("\n\n"));
	});

	type Pass = { result: string; request: Request; message: string };
	async function pass(main: Main, args: Record<string, unknown>, verdict = CLEAN_VERDICT, failed = false): Promise<Pass> {
		const requests = scriptReviewer(() => fauxAssistantMessage(fauxText(verdict), failed ? { stopReason: "length" } : undefined));
		const before = delivered(main.session).length;
		scriptMain([fauxAssistantMessage(fauxToolCall("review", args, { id: `p${counter++}` }), { stopReason: "toolUse" })]);
		await main.session.prompt("Review it");
		await main.session.waitForIdle();
		const result = main.session.messages.findLast(m => m.role === "toolResult" && m.toolName === "review");
		assert.ok(result?.role === "toolResult" && !result.isError);
		assert.equal(requests.length, 1);
		assert.equal(requests[0].messages, 1, "every pass is a fresh reviewer session with only its brief");
		assert.ok(!requests[0].text.includes("[review#"), "earlier verdicts are not reviewer history");
		assert.equal(delivered(main.session).length, before + 1);
		return { result: textOf(result.content), request: requests[0], message: String(delivered(main.session).at(-1)) };
	}
	const reviewData = (main: Main) => main.session.sessionManager.getEntries()
		.flatMap(e => e.type === "custom" && e.customType === "review" ? [e.data] : []);

	it("carries every rejection through multiple rounds and reload, retaining several reasons for one finding", async () => {
		const main = await openMain(full, params, true, "print");
		const findings = `FINDINGS:\nFINDING 1\n${FIELDS()}`;
		try {
			const initial = await pass(main, params, findings);
			assert.equal(initial.message, `[review#1] ${findings}\n\n${NEXT.findings}`);
			assert.ok(!initial.request.text.includes("<rejected_earlier>"));
			assert.deepEqual(reviewData(main), [{ n: 1 }], "no finding ids or verdict state persisted");
			const rejected = await pass(main, { ...params, rejected_earlier: [first] });
			assert.equal(rejected.result, startedText(2));
			assert.equal(rejected.message, clean(2));
			assert.ok(rejected.request.text.includes(`FINDING:\n${first.finding}\nREASON:\n${first.reason}`));
			await main.session.reload();
			const more = await pass(main, { ...params, rejected_earlier: [first, anotherReason, second] }, findings);
			assert.equal(more.result, startedText(3));
			assert.equal(more.request.text.split(first.reason).length - 1, 1, "exact duplicates are omitted");
			for (const item of [first, anotherReason, second]) assert.ok(more.request.text.includes(`FINDING:\n${item.finding}\nREASON:\n${item.reason}`));
			await main.session.reload();
			const carried = await pass(main, params);
			assert.equal(carried.result, startedText(4));
			assert.equal(carried.message, clean(4));
			assert.equal(carried.request.text.slice(carried.request.text.indexOf("<rejected_earlier>")), more.request.text.slice(more.request.text.indexOf("<rejected_earlier>")));
			assert.deepEqual(reviewData(main), [
				{ n: 1 },
				{ n: 2, ...params, rejected_earlier: [first] },
				{ n: 3, ...params, rejected_earlier: [first, anotherReason, second] },
				{ n: 4, ...params, rejected_earlier: [first, anotherReason, second] },
			]);
		} finally { main.session.dispose(); }
	});

	it("does not bleed across unrelated objects, criteria or levels, but preserves the original scope", async () => {
		const main = await openMain(full, params, true, "print");
		try {
			await pass(main, { ...params, rejected_earlier: [first] });
			for (const changed of [{ object: "b.ts" }, { criterion: "different" }, { level: "high" }]) {
				const unrelated = await pass(main, { ...params, ...changed });
				assert.ok(!unrelated.request.text.includes("<rejected_earlier>"));
				assert.ok(!unrelated.request.text.includes(first.finding));
			}
			await main.session.reload();
			const resumed = await pass(main, params);
			assert.equal(resumed.result, startedText(5));
			assert.ok(resumed.request.text.includes(first.reason));
			assert.deepEqual(reviewData(main).slice(1, 4), [{ n: 2 }, { n: 3 }, { n: 4 }]);
		} finally { main.session.dispose(); }
	});

	it("keeps rejection history after failed and incomplete reviews without a final-ruling state", async () => {
		const main = await openMain(full, params, true, "print");
		try {
			const failed = await pass(main, { ...params, rejected_earlier: [first] }, CLEAN_VERDICT, true);
			assert.equal(failed.message, failedWith("the reviewer did not complete normally (length)"));
			await main.session.reload();
			const incomplete = await pass(main, params, "CLEAN\nUNCHECKED:\n- a.ts unreadable");
			assert.equal(incomplete.message, other("CLEAN\nUNCHECKED:\n- a.ts unreadable", 2));
			assert.ok(incomplete.request.text.includes(first.reason));
			await main.session.reload();
			const again = await pass(main, { ...params, rejected_earlier: [first, anotherReason] });
			assert.equal(again.message, clean(3));
			assert.deepEqual(reviewData(main), [
				{ n: 1, ...params, rejected_earlier: [first] },
				{ n: 2, ...params, rejected_earlier: [first] },
				{ n: 3, ...params, rejected_earlier: [first, anotherReason] },
			]);
		} finally { main.session.dispose(); }
	});

	it("parallel independent reviews both run without obsolete single-rebuttal locks", async () => {
		const main = await openMain(full, params, true, "print");
		const requests = scriptReviewer(() => fauxAssistantMessage(fauxText(CLEAN_VERDICT)));
		scriptMain([fauxAssistantMessage([
			fauxToolCall("review", { ...params, rejected_earlier: [first] }, { id: "par1" }),
			fauxToolCall("review", { ...params, object: "b.ts", rejected_earlier: [second] }, { id: "par2" }),
		], { stopReason: "toolUse" })]);
		try {
			await main.session.prompt("Review both");
			assert.equal(requests.length, 2);
			assert.ok(requests.every(r => r.messages === 1));
			const a = requests.find(r => r.text.includes("<object>\na.ts\n</object>"))!;
			const b = requests.find(r => r.text.includes("<object>\nb.ts\n</object>"))!;
			assert.ok(a.text.includes(first.reason) && !a.text.includes(second.reason));
			assert.ok(b.text.includes(second.reason) && !b.text.includes(first.reason));
			assert.deepEqual(delivered(main.session).sort(), [clean(1), clean(2)]);
			assert.deepEqual(reviewData(main), [
				{ n: 1, ...params, rejected_earlier: [first] },
				{ n: 2, ...params, object: "b.ts", rejected_earlier: [second] },
			]);
		} finally { main.session.dispose(); }
	});
});

describe("finding block boundaries", () => {
	for (const field of ["REQUIREMENT", "MISMATCH", "EVIDENCE", "REQUIRED OUTCOME"]) {
		for (const position of ["immediately repeated", "after complete block"] as const) {
			it(`${field}: rejects an unquoted duplicate ${position} before verification`, () => {
				const lines = FIELDS().replace("REQUIRED OUTCOME: w", "REQUIRED OUTCOME: Restore foo.").split("\n");
				const duplicate = `${field}: ${field === "REQUIRED OUTCOME" ? "Remove foo." : "conflicting value"}`;
				const at = position === "immediately repeated" ? lines.findIndex(line => line.startsWith(`${field}:`)) + 1 : lines.length;
				lines.splice(at, 0, duplicate);
				const verdict = `FINDINGS:\nFINDING 1\n${lines.join("\n")}\nCHECKED: source.ts inspected`;
				assert.equal(findingBlocks(verdict), undefined);
				assert.equal(kindOf(verdict, false), "incomplete");
				assert.equal(verdictMessage(1, verdict, false), other(verdict));
			});
		}
	}
	it("literal evidence fallback cannot accept a duplicate actual outcome", () => {
		const verdict = 'FINDINGS:\nFINDING 1\nREQUIREMENT: Preserve foo.\nMISMATCH: Foo is missing.\nEVIDENCE: echo "$HOME\nREQUIRED OUTCOME: Restore foo.\nREQUIRED OUTCOME: Remove foo.\nCHECKED: source.ts inspected';
		assert.equal(findingBlocks(verdict), undefined);
		assert.equal(kindOf(verdict, false), "incomplete");
		assert.equal(verdictMessage(1, verdict, false), other(verdict));
	});
	it("a duplicate detected before a later unmatched evidence quote cannot be rehabilitated by fallback", () => {
		const verdict = 'FINDINGS:\nFINDING 1\nREQUIREMENT: Preserve foo.\nREQUIREMENT: Remove foo.\nMISMATCH: Foo is missing.\nEVIDENCE: echo "$HOME\nREQUIRED OUTCOME: Restore foo.\nCHECKED: source.ts inspected';
		assert.equal(findingBlocks(verdict), undefined);
		assert.equal(kindOf(verdict, false), "incomplete");
		assert.equal(verdictMessage(1, verdict, false), other(verdict));
	});
	it("stops before CHECKED or UNCHECKED so evidence is not part of the last finding", () => {
		const body = FIELDS();
		for (const section of ["CHECKED", "UNCHECKED"]) {
			for (const evidence of ["\n- inspected file", " inspected file"]) {
				const verdict = `FINDINGS:\nFINDING 1\n${body}\n${section}:${evidence}\nFINDING 99\nnot a finding`;
				assert.deepEqual(findingBlocks(verdict), [{ header: "FINDING 1", text: body }]);
				assert.equal(kindOf(verdict, false), section === "CHECKED" ? "findings" : "incomplete");
			}
		}
		assert.equal(findingBlocks("CLEAN"), undefined);
	});
	it("preserves uppercase headings quoted inside multiline EVIDENCE", () => {
		const body = 'REQUIREMENT: "Keep diagnostic notes" (agreement)\nMISMATCH: the diagnostic notes differ.\nEVIDENCE: source.txt contains:\n```text\nNOTE: keep the first line\nTODO: keep the next line\nWARNING: preserve this literal warning\n```\nREQUIRED OUTCOME: restore the agreed diagnostic notes.';
		const verdict = `FINDINGS:\nFINDING 1\n${body}\nCHECKED: source.txt inspected`;
		assert.deepEqual(findingBlocks(verdict), [{ header: "FINDING 1", text: body }]);
		assert.equal(kindOf(verdict, false), "findings");
		assert.equal(verdictMessage(1, verdict, false), `[review#1] ${verdict}\n\n${NEXT.findings}`);
	});
	const quotedTemplate = [
		"FINDINGS:",
		"FINDING 1",
		"REQUIREMENT: <verbatim quote of the agreement, governing rule or criterion with its source, or NOT AGREED for an addition>",
		"MISMATCH: <what the object does instead>",
		"EVIDENCE: <verbatim object quote, or the complete inspected file/section for an omission> (<file path>)",
		"REQUIRED OUTCOME: <what must be true after the fix>",
		"CHECKED: this is a literal source heading, not verification evidence",
		"UNCHECKED: this is a literal source heading, not an unavailable source",
		"FINDING 2",
		"NOTE: preserve the template",
		"TODO: preserve this source text",
		"WARNING: preserve this source text too",
	].join("\n");
	it("unmatched literal quote characters in raw regex evidence do not swallow actual fields", () => {
		for (const regex of ['/["\']/;', '/["]/;', "/[']/;"]) {
			const body = `REQUIREMENT: Preserve the pattern.\nMISMATCH: The pattern differs.\nEVIDENCE: const RE = ${regex}\nREQUIRED OUTCOME: Restore the agreed pattern.`;
			const verdict = `FINDINGS:\nFINDING 1\n${body}\nUNCHECKED: source.ts - not readable`;
			assert.deepEqual(findingBlocks(verdict), [{ header: "FINDING 1", text: body }], regex);
			assert.equal(kindOf(verdict, false), "incomplete", regex);
			assert.equal(verdictMessage(1, verdict, false), other(verdict), regex);
		}
	});
	it("unmatched evidence delimiters cannot pair across actual outcome or verification fields", () => {
		for (const [evidence, outcome, checked] of [
			['echo "$HOME', 'Use "x" as agreed.', 'source.ts: "anchor" inspected'],
			["echo '$HOME", "Use 'x' as agreed.", "source.ts: 'anchor' inspected"],
			["echo `$HOME", "Use the agreed value.", "`source.ts`: `anchor` inspected"],
		] as const) {
			const body = `REQUIREMENT: Preserve the command.\nMISMATCH: The command differs.\nEVIDENCE: ${evidence}\nREQUIRED OUTCOME: ${outcome}`;
			const verdict = `FINDINGS:\nFINDING 1\n${body}\nCHECKED: ${checked}`;
			assert.deepEqual(findingBlocks(verdict), [{ header: "FINDING 1", text: body }], evidence);
			assert.equal(kindOf(verdict, false), "findings", evidence);
			const unchecked = `${verdict}\nUNCHECKED: missing.ts - not readable`;
			assert.deepEqual(findingBlocks(unchecked), [{ header: "FINDING 1", text: body }], evidence);
			assert.equal(kindOf(unchecked, false), "incomplete", evidence);
			assert.equal(verdictMessage(1, unchecked, false), other(unchecked), evidence);
		}
	});
	it("an inner fence with an info string does not close the outer evidence fence", () => {
		const body = `REQUIREMENT: Preserve the template.\nMISMATCH: The template differs.\nEVIDENCE: \`\`\`text\n\`\`\`ts\n${quotedTemplate}\n\`\`\` (source.md)\nREQUIRED OUTCOME: Restore the agreed template.`;
		const verdict = `FINDINGS:\nFINDING 1\n${body}\nCHECKED: source.md inspected`;
		assert.deepEqual(findingBlocks(verdict), [{ header: "FINDING 1", text: body }]);
		assert.equal(kindOf(verdict, false), "findings");
		assert.equal(kindOf(`${verdict}\nUNCHECKED: other.md - not readable`, false), "incomplete");
	});
	it("paired inline triple-backtick spans in a field do not swallow following actual fields", () => {
		const fields = ["REQUIREMENT", "MISMATCH", "EVIDENCE", "REQUIRED OUTCOME"];
		for (const inlineField of fields) {
			const body = fields.map(field => `${field}: ${field === inlineField ? "```code```" : "plain text"}`).join("\n");
			const verdict = `FINDINGS:\nFINDING 1\n${body}\nCHECKED: source.ts inspected`;
			assert.deepEqual(findingBlocks(verdict), [{ header: "FINDING 1", text: body }], inlineField);
			assert.equal(kindOf(verdict, false), "findings", inlineField);
			assert.equal(kindOf(`${verdict}\nUNCHECKED: missing.ts - not readable`, false), "incomplete", inlineField);
		}
	});
	for (const [name, open, close] of [
		["backtick fence", "```text", "```"],
		["tilde fence", "~~~text", "~~~"],
		["ordinary double quote", '"', '"'],
		["ordinary single quote", "'", "'"],
	] as const) {
		const body = `REQUIREMENT: Preserve the reviewer template.\nMISMATCH: The template differs from the agreement.\nEVIDENCE: ${open}\n${quotedTemplate}\n${close} (source.md)\nREQUIRED OUTCOME: Restore the agreed template.`;
		it(`${name}: preserves the full reviewer template quoted in EVIDENCE`, () => {
			const verdict = `FINDINGS:\nFINDING 1\n${body}\nCHECKED: source.md inspected`;
			assert.deepEqual(findingBlocks(verdict), [{ header: "FINDING 1", text: body }]);
			assert.equal(kindOf(verdict, false), "findings", "quoted UNCHECKED is not a verification section");
			assert.equal(verdictMessage(1, verdict, false), `[review#1] ${verdict}\n\n${NEXT.findings}`);
		});
		it(`${name}: genuine trailing UNCHECKED is incomplete with or without prior CHECKED`, () => {
			for (const checked of ["", "\nCHECKED: source.md inspected"]) {
				const verdict = `FINDINGS:\nFINDING 1\n${body}${checked}\nUNCHECKED: missing.md - not readable`;
				assert.deepEqual(findingBlocks(verdict), [{ header: "FINDING 1", text: body }]);
				assert.equal(kindOf(verdict, false), "incomplete");
				assert.equal(verdictMessage(1, verdict, false), other(verdict));
			}
		});
		it(`${name}: separates multiple actual findings without splitting quoted headings`, () => {
			const verdict = `FINDINGS:\nFINDING 1\n${body}\nFINDING 2\n${FIELDS("second real finding")}\nCHECKED:\n- source.md inspected`;
			assert.deepEqual(findingBlocks(verdict), [
				{ header: "FINDING 1", text: body }, { header: "FINDING 2", text: FIELDS("second real finding") },
			]);
			assert.equal(kindOf(verdict, false), "findings");
		});
	}
	it("literal fallback preserves two findings when an unmatched command quote reaches the next requirement", () => {
		const first = 'REQUIREMENT: Preserve the command.\nMISMATCH: The command differs.\nEVIDENCE: echo "$HOME\nREQUIRED OUTCOME: Restore the agreed command.';
		const second = 'REQUIREMENT: Use "x" as agreed.\nMISMATCH: The value differs.\nEVIDENCE: value.ts has y.\nREQUIRED OUTCOME: Restore x.';
		const verdict = `FINDINGS:\nFINDING 1\n${first}\nFINDING 2\n${second}\nCHECKED: command.sh and value.ts inspected`;
		assert.deepEqual(findingBlocks(verdict), [
			{ header: "FINDING 1", text: first }, { header: "FINDING 2", text: second },
		]);
		assert.equal(kindOf(verdict, false), "findings");
		assert.equal(kindOf(`${verdict}\nUNCHECKED: missing.ts - not readable`, false), "incomplete");
	});
	it("literal fallback rejects an actual duplicate in the same two-finding input", () => {
		const first = 'REQUIREMENT: Preserve the command.\nMISMATCH: The command differs.\nEVIDENCE: echo "$HOME\nREQUIRED OUTCOME: Restore the agreed command.';
		const second = 'REQUIREMENT: Use "x" as agreed.\nMISMATCH: The value differs.\nEVIDENCE: value.ts has y.\nREQUIRED OUTCOME: Restore x.\nREQUIRED OUTCOME: Remove x.';
		const verdict = `FINDINGS:\nFINDING 1\n${first}\nFINDING 2\n${second}\nCHECKED: command.sh and value.ts inspected`;
		assert.equal(findingBlocks(verdict), undefined);
		assert.equal(kindOf(verdict, false), "incomplete");
		assert.equal(verdictMessage(1, verdict, false), other(verdict));
	});
	it("parses several complete findings followed by genuine verification sections", () => {
		const verdict = `FINDINGS:\nFINDING 1\n${FIELDS("a")}\nFINDING 2\n${FIELDS("b")}\nCHECKED:\n- a.ts`;
		assert.deepEqual(findingBlocks(verdict), [
			{ header: "FINDING 1", text: FIELDS("a") }, { header: "FINDING 2", text: FIELDS("b") },
		]);
		assert.equal(kindOf(verdict, false), "findings");
		assert.equal(kindOf(`${verdict}\nUNCHECKED:\n- b.ts - unreadable`, false), "incomplete");
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
			return fauxAssistantMessage(fauxText(CLEAN_VERDICT));
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
			return fauxAssistantMessage(fauxText(CLEAN_VERDICT));
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
