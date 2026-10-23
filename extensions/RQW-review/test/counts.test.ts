// T16 review counts: RQW-review offers its own running reviews on pi.events, and its files import nothing from outside.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { setImmediate as nextLoop } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall, type SimpleStreamOptions, type TranscriptContext } from "@earendil-works/pi-ai";
import { createAgentSession, createEventBus, DefaultResourceLoader, type EventBus, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { COUNTS_OFFER, COUNTS_REQUEST, type CountsOffer, type CountsRequest, type CountsSource, createCountsProducer, type RunningCounts } from "../counts.ts";

const EXTENSION = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");
const ZERO: RunningCounts = { agents: 0, workers: 0, reviews: 0 };
const json = (counts: unknown) => JSON.stringify(counts);

async function until(check: () => boolean, label: string, ms = 5000) {
	const deadline = Date.now() + ms;
	while (!check()) {
		assert.ok(Date.now() < deadline, `timeout: ${label}`);
		await nextLoop();
	}
}

test("review-counts: running reviews are offered as reviews, and an ended source counts nothing", () => {
	const bus = createEventBus();
	const running = new Set<number>();
	const producer = createCountsProducer(() => ({ agents: 0, workers: 0, reviews: running.size }), bus);
	bus.on(COUNTS_REQUEST, (request) => producer.reply(request as CountsRequest));
	const offers: CountsOffer[] = [];
	bus.on(COUNTS_OFFER, (offer) => offers.push(offer as CountsOffer));
	producer.start();
	const [offer] = offers;
	const seen: unknown[] = [];
	offer.source.subscribe((counts) => seen.push(counts));
	running.add(1);
	producer.refresh();
	running.add(2);
	producer.refresh();
	assert.deepEqual(offer.source.snapshot(), { agents: 0, workers: 0, reviews: 2 });
	running.delete(1);
	running.delete(2);
	producer.refresh();
	assert.deepEqual(seen, [{ agents: 0, workers: 0, reviews: 1 }, { agents: 0, workers: 0, reviews: 2 }, { agents: 0, workers: 0, reviews: 0 }]);
	running.add(3);
	producer.stop();
	assert.deepEqual(offer.source.snapshot(), ZERO, "stopped: zero");
	assert.equal(seen.at(-1), null, "stopped: listeners get null");
	const replies: CountsSource[] = [];
	const request: CountsRequest = { version: 1, reply: (source: CountsSource) => replies.push(source) };
	bus.emit(COUNTS_REQUEST, request);
	assert.equal(replies.length, 0, "a stopped producer is not offered back");
});

test("review-ownership: the review producer imports nothing from another extension folder", async () => {
	for (const file of ["index.ts", "counts.ts"]) {
		const text = await readFile(join(import.meta.dirname, "..", file), "utf8");
		for (const match of text.matchAll(/from "(\.[^"]*)"/g)) {
			assert.ok(match[1].startsWith("./"), `${file} imports ${match[1]} outside its folder`);
		}
	}
});

// Only RQW-review is loaded. The reviewer is a gated faux anthropic model: each review holds until the test releases it.
let root: string;
let agentDir: string;
before(async () => {
	root = await mkdtemp(join(tmpdir(), "rqw-review-counts-"));
	agentDir = join(root, "agent");
	await mkdir(agentDir, { recursive: true });
});
after(async () => {
	await rm(root, { recursive: true, force: true });
});

test("review-session-counts: a running review counts from its job start until its verdict, and ends at shutdown", async () => {
	const main = fauxProvider({ provider: "main", models: [{ id: "main" }] });
	const reviewer = fauxProvider({ provider: "anthropic", models: [{ id: "claude-haiku-5-5", reasoning: true }, { id: "claude-sonnet-5-5", reasoning: true }] });
	const reviewerGates: { entered: boolean; release: () => void }[] = [];
	const gatedReviewer = (context: TranscriptContext, options?: SimpleStreamOptions) => {
		const gate = { entered: false, release: () => {} };
		const released = Promise.withResolvers<void>();
		gate.release = () => released.resolve();
		reviewerGates.push(gate);
		gate.entered = true;
		options?.signal?.addEventListener("abort", () => released.resolve(), { once: true });
		return released.promise.then(() => fauxAssistantMessage(fauxText("CLEAN")));
	};
	reviewer.setResponses(Array.from({ length: 4 }, () => gatedReviewer));
	main.setResponses([
		fauxAssistantMessage(fauxToolCall("review", { level: "blind", object: "fixture", criterion: "c" }, { id: "r1" }), { stopReason: "toolUse" }),
		fauxAssistantMessage(fauxText("started one")),
		// The verdict starts one main turn of its own.
		fauxAssistantMessage(fauxText("SAW_VERDICT")),
		fauxAssistantMessage(fauxToolCall("review", { level: "blind", object: "fixture", criterion: "c" }, { id: "r2" }), { stopReason: "toolUse" }),
		fauxAssistantMessage(fauxText("started two")),
		...Array.from({ length: 6 }, () => fauxAssistantMessage(fauxText("OK"))),
	]);
	const dir = join(root, "session");
	await mkdir(dir, { recursive: true });
	const runtime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
	runtime.registerNativeProvider(main.provider);
	runtime.registerNativeProvider(reviewer.provider);
	await runtime.setRuntimeApiKey("anthropic", "fake-review-counts-key");
	await runtime.getAvailable();
	// Public observer: an inline factory keeps the pi.events the loader gives its extensions.
	const observed: { events?: EventBus } = {};
	const loader = new DefaultResourceLoader({ cwd: dir, agentDir, additionalExtensionPaths: [EXTENSION], extensionFactories: [pi => { observed.events = pi.events; }], noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
	await loader.reload();
	assert.deepEqual(loader.getExtensions().errors, []);
	const { session } = await createAgentSession({ cwd: dir, agentDir, model: main.getModel(), thinkingLevel: "off", modelRuntime: runtime, resourceLoader: loader,
		sessionManager: SessionManager.inMemory(dir), settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }) });
	const errors: string[] = [];
	await session.bindExtensions({ mode: "tui", onError: (e) => errors.push(`${e.event}: ${e.error}`) });
	const bus = observed.events;
	assert.ok(bus, "the observer captured pi.events");
	const sources: CountsSource[] = [];
	bus.emit(COUNTS_REQUEST, { version: 1, reply: (source: CountsSource) => sources.push(source) });
	assert.equal(sources.length, 1, "the review session offers exactly one source");
	const [source] = sources;
	assert.deepEqual(source.snapshot(), ZERO);
	const seen: (RunningCounts | null)[] = [];
	source.subscribe((counts) => seen.push(counts));
	const verdicts = (text: string) => session.messages.some(m => m.role === "custom" && typeof m.content === "string" && m.content.startsWith(text));

	try {
		await session.prompt("GO");
		await until(() => reviewerGates.length === 1, "the first reviewer started");
		assert.deepEqual(source.snapshot(), { agents: 0, workers: 0, reviews: 1 }, "running from the job start");
		reviewerGates[0].release();
		await until(() => json(source.snapshot()) === json(ZERO), "the first review ended");
		await until(() => verdicts("[review#1] CLEAN"), "the first verdict delivered");
		await session.waitForIdle();
		assert.deepEqual(seen, [{ agents: 0, workers: 0, reviews: 1 }, ZERO], "start, then end at the verdict");

		await session.prompt("AGAIN");
		await until(() => reviewerGates.length === 2, "the second reviewer started");
		assert.deepEqual(source.snapshot(), { agents: 0, workers: 0, reviews: 1 });
		assert.deepEqual(errors, []);
	} finally {
		// Shutdown ends the second review's job: the source gives null and counts nothing.
		await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		reviewerGates.forEach(gate => gate.release());
		session.dispose();
		await nextLoop();
	}
	assert.deepEqual(seen.at(-1), null, "shutdown ends the source");
	assert.deepEqual(source.snapshot(), ZERO);
});
