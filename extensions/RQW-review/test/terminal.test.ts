// Pending-review adaptation in Pi's real InteractiveMode, with controlled faux providers and no model calls.
// This checks wiring and async mechanics only: the review rule reaches the model in the tool declaration and in the
// start receipt, and a main model that obeys it (ends silently) is neither polled nor blocked. It does not prove that
// a real model follows the rule. Esc/abort while a verdict waits is covered by review.test.ts
// ("TUI Esc while a verdict waits ...", "RPC abort while a verdict waits ...").
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, it } from "node:test";
import { setImmediate as nextLoop } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import {
	type AgentSessionRuntime,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	initTheme,
	InteractiveMode,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { DESCRIPTION, startedText } from "../index.ts";

const EXTENSION = join(dirname(dirname(fileURLToPath(import.meta.url))), "index.ts");

/** The approved caller rule, verbatim; the production text must carry exactly this sentence group. */
const RULE =
	"Do not declare the task complete before this review's verdict is received and handled. " +
	"If no other work remains, end this turn silently and wait for the automatic verdict notification; " +
	"do not poll or take filler turns. Owner messages and interrupts remain allowed. " +
	"A failed or incomplete verdict is not acceptance.";

class Terminal {
	onInput?: (data: string) => void;
	start(onInput: (data: string) => void) { this.onInput = onInput; }
	stop() {}
	async drainInput() {}
	write() {}
	get columns() { return 100; }
	get rows() { return 40; }
	get kittyProtocolActive() { return false; }
	moveBy() {} hideCursor() {} showCursor() {} clearLine() {} clearFromCursor() {} clearScreen() {}
	setTitle() {} setProgress() {} setProgramStatus() {}
}

let root: string;
let agentDir: string;
before(() => {
	root = mkdtempSync(join(tmpdir(), "review-terminal-"));
	agentDir = join(root, "agent");
	mkdirSync(agentDir);
	process.env.PI_CODING_AGENT_DIR = agentDir;
	process.env.PI_OFFLINE = "1";
	process.env.PI_SKIP_VERSION_CHECK = "1";
	initTheme("dark", false);
});
after(() => rmSync(root, { recursive: true, force: true }));

type Declared = { name: string; description: string };
type Request = { tools: Declared[]; text: string };

/** Pi 1.4 declares tools in system messages: `toolsAdded` adds, `toolsRemoved` drops. */
function declaredTools(messages: { role: string; toolsAdded?: Declared[]; toolsRemoved?: { name: string }[] }[]): Declared[] {
	const declared = new Map<string, Declared>();
	for (const message of messages) {
		if (message.role !== "system") continue;
		for (const tool of message.toolsAdded ?? []) declared.set(tool.name, tool);
		for (const ref of message.toolsRemoved ?? []) declared.delete(ref.name);
	}
	return [...declared.values()];
}

it("pending review: the rule reaches the model, a silent main stays idle, owner input and the verdict still work", { timeout: 30000 }, async () => {
	const main = fauxProvider({ provider: "terminal-parity", models: [{ id: "main" }] });
	const reviewer = fauxProvider({ provider: "openai-codex", models: [{ id: "gpt-6.1-sol", reasoning: true }] });
	for (const provider of [main, reviewer]) provider.provider.auth.apiKey = { name: "Fake", resolve: async () => ({ auth: { apiKey: "fake" } }) };

	const reviewerStarted = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	reviewer.setResponses([async () => {
		reviewerStarted.resolve();
		await release.promise;
		return fauxAssistantMessage(fauxText("CLEAN\nCHECKED:\n- terminal fixture requirement fulfilled."));
	}]);

	// What each main request carried: its declared tools and the text of its whole transcript.
	const requests: Request[] = [];
	const verdictSeen = Promise.withResolvers<void>();
	main.setResponses(Array.from({ length: 6 }, () => (context: { messages: Parameters<typeof declaredTools>[0] }) => {
		// Without system messages, so the tool declaration cannot stand in for the receipt.
		const text = JSON.stringify(context.messages.filter((message) => message.role !== "system"));
		requests.push({ tools: declaredTools(context.messages), text });
		const n = requests.length;
		if (n === 1) {
			return fauxAssistantMessage(
				fauxToolCall("review", { level: "blind", object: "fixture", criterion: "fixture", fast_gpt: false }, { id: "review-start" }),
				{ stopReason: "toolUse" },
			);
		}
		// Obeying the rule: nothing else to do, so end silently and wait for the notification.
		if (n === 2) return fauxAssistantMessage([]);
		if (text.includes("[review#1]")) {
			verdictSeen.resolve();
			return fauxAssistantMessage(fauxText("VERDICT_HANDLED"));
		}
		return fauxAssistantMessage(fauxText("OWNER_MESSAGE_HANDLED"));
	}));

	const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
	modelRuntime.registerNativeProvider(main.provider);
	modelRuntime.registerNativeProvider(reviewer.provider);
	let runtime: AgentSessionRuntime | undefined;
	let mode: InteractiveMode | undefined;
	try {
		runtime = await createAgentSessionRuntime(async ({ cwd, sessionManager, sessionStartEvent }) => {
			const services = await createAgentSessionServices({
				cwd,
				agentDir,
				modelRuntime,
				settingsManager: SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false }, cacheWarming: "off", quietStartup: true }),
				resourceLoaderOptions: { additionalExtensionPaths: [EXTENSION], noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true },
			});
			const created = await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model: main.getModel(), thinkingLevel: "off" });
			return { ...created, services, diagnostics: services.diagnostics };
		}, { cwd: root, agentDir, sessionManager: SessionManager.inMemory(root) });
		mode = new InteractiveMode(runtime, { terminal: new Terminal() as never });
		await mode.init();
		const session = runtime.session;

		// Main requests the review, receives the receipt and ends silently while the reviewer is gated.
		await session.prompt("Review this fixture.");
		await reviewerStarted.promise;
		assert.equal(session.isIdle, true, "a silent main turn leaves the session idle with the review pending");
		assert.equal(requests.length, 2, "tool call, then the one turn that saw the receipt");
		assert.equal(session.getLastAssistantText() ?? "", "", "the main model ended silently");

		// The description in the real tool declaration, and the actual receipt in the next request.
		const declared = requests[0].tools.find((tool) => tool.name === "review");
		assert.ok(declared, "the review tool is declared to the model");
		assert.equal(declared.description, DESCRIPTION);
		assert.ok(declared.description.includes(RULE), "the declaration carries the pending-review rule");
		assert.ok(requests[1].text.includes(JSON.stringify(startedText(1)).slice(1, -1)), "the receipt text is in the second request");
		assert.ok(requests[1].text.includes(JSON.stringify(RULE).slice(1, -1)), "the receipt carries the pending-review rule");

		// Idle with a pending review costs no further requests.
		for (let i = 0; i < 5; i++) await nextLoop();
		assert.equal(requests.length, 2, "no polling or filler turn while the review is pending");

		// Owner messages stay allowed while the reviewer is gated.
		await session.prompt("Owner steering while review is pending");
		assert.equal(session.getLastAssistantText(), "OWNER_MESSAGE_HANDLED");
		assert.equal(requests.length, 3);
		assert.ok(!requests[2].text.includes("[review#1]"), "the verdict is not delivered before release");

		// Release: exactly one verdict and exactly one main turn, without owner input.
		release.resolve();
		await verdictSeen.promise;
		await session.waitForIdle();
		const verdicts = session.messages.filter((message) => message.role === "custom" && message.customType === "review");
		assert.equal(verdicts.length, 1, "the verdict is delivered once");
		assert.equal(requests.length, 4, "the verdict wakes exactly one main turn");
		assert.equal(session.getLastAssistantText(), "VERDICT_HANDLED");
		for (let i = 0; i < 5; i++) await nextLoop();
		assert.equal(requests.length, 4, "no extra turn after the verdict was handled");
	} finally {
		release.resolve();
		if (runtime && !runtime.session.isIdle) await runtime.session.abort();
		mode?.stop();
		await runtime?.dispose();
	}
});
