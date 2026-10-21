// The review tool inside real Pi sessions, no model. The main session loads the extension from its file the way Pi
// loads a package extension; two faux providers stand in for the main model and for the reviewer models
// (`anthropic/claude-haiku-5-5`, `anthropic/claude-sonnet-5-5`), and record every request they get.
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { createHash } from "node:crypto";
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
	createGrepToolDefinition,
	DefaultResourceLoader,
	ModelRuntime,
	type SessionEntry,
	SessionManager,
	SettingsManager,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { buildBrief, DESCRIPTION, NEXT, reviewerTools, startedText, verdictMessage } from "../index.ts";

/** The delivered message of review `n` for a verdict of each kind: the verdict verbatim, then the next step. */
const clean = (n = 1) => `[review#${n}] CLEAN\n\n${NEXT.clean}`;
const found = (verdict: string, n = 1) => `[review#${n}] ${verdict}\n\n${NEXT.findings}`;
const failedWith = (reason: string) => `[review#1] Review failed: ${reason}\n\n${NEXT.failed}`;

const EXTENSION = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");
const REVIEWER_SOURCE = readFileSync(join(dirname(EXTENSION), "REVIEWER.md"), "utf8").replace(/\r\n/g, "\n");
const REVIEWER = REVIEWER_SOURCE.trimEnd();

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
async function openMain(
	runtime: ModelRuntime,
	args: Record<string, unknown>,
	withExtension = true,
	// Pi's default for an SDK session is "print", where the main run waits for its reviews.
	mode: "tui" | "rpc" | "print" | "json" = "tui",
	// Other extensions, loaded after this one.
	extra: string[] = [],
): Promise<Main> {
	const dir = join(root, `w${counter++}`);
	await mkdir(dir, { recursive: true });
	const resourceLoader = new DefaultResourceLoader({
		cwd: dir,
		agentDir,
		additionalExtensionPaths: withExtension ? [EXTENSION, ...extra] : extra,
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

describe("measured reviewer prompt contract", () => {
	it("loads a CRLF checkout through the production loader as canonical LF", async () => {
		const dir = await mkdtemp(join(dirname(EXTENSION), ".crlf-test-"));
		try {
			await writeFile(join(dir, "index.ts"), readFileSync(EXTENSION, "utf8"));
			const crlf = REVIEWER_SOURCE.replace(/\n/g, "\r\n");
			assert.equal(createHash("sha256").update(crlf).digest("hex"),
				"894a2e229dd7a718c932d50276506b82842fa224f21c9489c945da8d47a915bf");
			await writeFile(join(dir, "REVIEWER.md"), crlf);
			const loaded = await import(pathToFileURL(join(dir, "index.ts")).href);
			assert.equal(loaded.REVIEWER, REVIEWER);
			assert.ok(!loaded.REVIEWER.includes("\r"));
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("loads the exact GPT v3 candidate and keeps criterion-only checks in scope", () => {
		assert.equal(createHash("sha256").update(REVIEWER_SOURCE).digest("hex"),
			"a9cc1a3fac50fe32b6911e5bb8bf152caecad9947e2d36d162696eed5db3117a");
		assert.ok(REVIEWER.includes("Review independently: Main's verdict is not evidence."));
		assert.ok(REVIEWER.includes("including custom criteria beyond the agreement"));
		assert.ok(REVIEWER.includes("do not report what it excludes or leaves to another pass"));
		assert.ok(REVIEWER.includes("the agreement or criterion with its source"));
		assert.ok(REVIEWER.includes("REQUIREMENT: <verbatim quote of the agreement or criterion with its source"));
		assert.ok(DESCRIPTION.includes("criterion, including checks beyond the agreement and exclusions"));
		assert.ok(DESCRIPTION.length <= 500);
	});
	it("preserves stock read constraints and the exact clean verdict contract", () => {
		assert.ok(REVIEWER.includes("Omit offset and limit on initial reads"));
		assert.ok(REVIEWER.includes("`read` returns the file text without line numbers"));
		assert.ok(REVIEWER.includes("Never give or work out line numbers"));
		assert.ok(REVIEWER.includes("Reply with the result of the review as your last message"));
		assert.ok(REVIEWER.includes("With no findings, return exactly `CLEAN`"));
		assert.ok(!REVIEWER.includes("yield"));
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
		const findings = "FINDINGS:\nFINDING 1\nREQUIREMENT: x";
		assert.equal(verdictMessage(3, findings, false), `[review#3] ${findings}\n\n${NEXT.findings}`);
		assert.equal(verdictMessage(4, "Review failed: provider error", true), `[review#4] Review failed: provider error\n\n${NEXT.failed}`);
	});
});

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
			assert.equal(review.description, DESCRIPTION);
			assert.ok(review.description.includes("works with you as one team for the user's agreement"), "the teammate sentence");
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
			assert.ok(!r.system.includes("RQW-prompt/SYSTEM.md"), "no main prompt reference");
			assert.ok(r.text.includes(`<rejected_earlier>\n${args.rejected}\n</rejected_earlier>`));

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
		const main = await openMain(full, { level: "high", object: "a.ts", criterion: "c", agreement: "", rejected: "" });
		try {
			await main.session.prompt(SECOND);
			const turn = await within(main.verdictTurn, 5000, "verdict turn");
			await main.session.waitForIdle();
			assert.equal(requests.length, 1);
			assert.equal(requests[0].model, "claude-sonnet-5-5");
			assert.equal(requests[0].reasoning, "low");
			assert.ok(!requests[0].text.includes("<agreement>") && !requests[0].text.includes("<rejected_earlier>"));
			assert.ok(requests[0].text.includes("<criterion>\nc\n</criterion>"), "criterion survives without agreement");
			assert.equal(turn, found(findings));
			for (const rule of [
				"Find each quote by searching for it.",
				"fix it exactly to its REQUIRED OUTCOME and no further; do not reject it, argue with it or put it to the user.",
				"Reject a finding only when a quote is not verbatim",
				"Fix all admitted findings in one batch",
				"every rejection so far in `rejected`, until CLEAN.",
			])
				assert.ok(turn.endsWith(NEXT.findings) && NEXT.findings.includes(rule), rule);
		} finally {
			main.session.dispose();
		}
	});

	const failures: [string, () => ModelRuntime, string][] = [
		["a missing reviewer model", () => otherModels, failedWith("model anthropic/claude-haiku-5-5 is not available")],
		[
			"missing credentials",
			() => mainOnly,
			failedWith("no credentials for anthropic (model anthropic/claude-haiku-5-5)"),
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
			assert.deepEqual(delivered(main.session).sort(), [found("R1", 1), found("R2", 2)]);
			for (const v of [found("R1", 1), found("R2", 2)]) assert.equal(requests[2].filter((t) => t === v).length, 1, v);
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
			assert.equal(await within(main.verdictTurn, 5000, "verdict turn"), found(FILE));
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
		assert.equal(authSignal?.aborted, true);
		assert.equal(messages.length, 1);
		assert.match(String(messages[0].content), /Review failed: no verdict within 10 minutes/);
		assert.equal(sessionStage, false);
		auth.resolve({});
		await nextLoop();
		assert.equal(sessionStage, false, "late auth cannot create a child");
		assert.equal(messages.length, 1);
	});

	it("arbitrary malformed output receives actionable findings instructions", () => {
		for (const v of ["UNCHECKED:\n- a.ts unreadable", "I could not finish", "FINDINGS:"]) {
			assert.ok(verdictMessage(1, v, false).endsWith(NEXT.findings));
		}
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

	it("custom scopes, exclusions, rejections, and exact text survive the real API", async () => {
		const request = "Review only completeness.\n  Preserve trailing spaces  \n<criterion>literal tag</criterion>";
		const args = { ...ARGS, criterion: "Require custom safety checks outside the agreement; exclude formatting.", agreement: "Accepted proposal: use only stock tools.", rejected: "Earlier finding rejected: exact user quote says keep legacy mode." };
		const reviews = scriptReviewer(() => fauxAssistantMessage(fauxText("CLEAN")));
		const main = await openMain(full, args, true, "print");
		try {
			await main.session.prompt(request);
			assert.equal(reviews.length, 1);
			assert.ok(reviews[0].text.includes(`<message n="1">\n${request}\n</message>`));
			for (const [tag, value] of [["criterion", args.criterion], ["agreement", args.agreement], ["rejected_earlier", args.rejected]]) {
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
				assert.equal(options?.signal, undefined, "native Pi 1.3 prompt preflight has no abort signal");
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
				if (finish !== "shutdown") assert.equal(delivered(main.session)[0], failedWith("no verdict within 10 minutes"));
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
			assert.deepEqual(delivered(main.session), [failedWith("no verdict within 10 minutes")]);
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
				assert.deepEqual(delivered(main.session).sort(), [found("R1", 1), found("R2", 2)]);
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
				...[-1, 1.5, "999", undefined].map(n => ({ ...base, type: "custom", customType: "review", data: { n } })),
			] as unknown as SessionEntry[];
			const persisted: unknown[] = [];
			reviewExtension({
				on: (n: string, h: (event: never, ctx: never) => unknown) => handlers.set(n, h),
				registerTool: (d: ToolDefinition) => { definition = d; },
				appendEntry: (customType: string, data: unknown) => persisted.push({ customType, data }),
				sendMessage: () => {},
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
		} as unknown as ExtensionAPI);
		let scheduled = false;
		const ctx = { mode: "print", signal: new AbortController().signal, isIdle: () => false,
			sessionManager: { getEntries: () => [], getBranch: () => [] },
			modelRegistry: { find: () => reviewerFaux.getModel("claude-haiku-5-5"), hasConfiguredAuth: () => true, runtime: full },
			get cwd() {
				if (!scheduled) {
					scheduled = true;
					queueMicrotask(() => t.mock.timers.tick(TIMEOUT_MS));
				}
				return root;
			},
		} as unknown as ExtensionContext;
		handlers.get("session_start")!({} as never, ctx as never);
		try {
			t.mock.timers.enable({ apis: ["setTimeout"] });
			await definition!.execute("create", ARGS as never, undefined, undefined, ctx);
			await handlers.get("agent_end")!({} as never, ctx as never);
			t.mock.timers.reset();
			await nextLoop();
			assert.equal(disposed, 1);
			assert.equal(reviews.length, 0);
			assert.equal(messages.length, 1);
			assert.equal(messages[0].content, failedWith("no verdict within 10 minutes"));
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
