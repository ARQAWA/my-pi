// The review tool inside real Pi sessions, no model. The main session loads the extension from its file the way Pi
// loads a package extension; two faux providers stand in for the main model and for the reviewer models
// (`anthropic/claude-haiku-5-5`, `anthropic/claude-sonnet-5-5`), and record every request they get.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
import { validateToolArguments } from "@earendil-works/pi-ai/utils/validation";
import {
	type AgentSession,
	createAgentSession,
	createGrepToolDefinition,
	DefaultResourceLoader,
	ModelRuntime,
	type SessionEntry,
	SessionManager,
	SettingsManager,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { buildBrief, reviewerTools } from "../index.ts";

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
				assert.deepEqual(delivered(main.session), ["[review#1] CLEAN"]);
				assert.equal(requests.length, 3, "one more request, in the same run");
				assert.equal(requests[2].filter((t) => t === "[review#1] CLEAN").length, 1);
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
		assert.deepEqual(delivered(main.session), ["[review#1] CLEAN"], "the verdict is in the session");
		assert.equal(requests.length, 2, "no run starts after the abort");
		assert.equal(main.session.agent.hasQueuedMessages(), false, "nothing left in the queue");
		await main.session.prompt("next");
		await tick();
		assert.equal(requests.length, 3, "one request for the next prompt");
		assert.equal(requests[2].filter((t) => t === "[review#1] CLEAN").length, 1, "the model sees it once");
		assert.deepEqual(delivered(main.session), ["[review#1] CLEAN"]);
	}

	it("a verdict that arrives while the main agent streams continues its run once", async () => {
		const { main, mainGate, requests, run } = await verdictWhileBusy("tui");
		try {
			assert.deepEqual(delivered(main.session), [], "held until the turn ends");
			mainGate.release();
			await within(run, 5000, "the main run");
			await tick();
			assert.deepEqual(delivered(main.session), ["[review#1] CLEAN"]);
			assert.equal(requests.length, 3);
			assert.equal(requests[2].filter((t) => t === "[review#1] CLEAN").length, 1);
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
			assert.deepEqual(delivered(main.session).sort(), ["[review#1] R1", "[review#2] R2"]);
			for (const v of ["[review#1] R1", "[review#2] R2"]) assert.equal(requests[2].filter((t) => t === v).length, 1, v);
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
			assert.equal(await within(main.verdictTurn, 5000, "verdict turn"), `[review#1] ${FILE}`);
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
