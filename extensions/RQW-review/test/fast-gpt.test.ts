// GPT Fast in RQW-review's reviewer sessions (they inherit the main chat's state when they start): real Pi sessions, the real openai-codex
// provider, only the network (globalThis.fetch) replaced, so the assertions read the request bodies
// that would go on the wire. RQW-settings is not loaded (this test loads only RQW-review); a stand-in answers on the
// parent's `pi.events` the query channel that RQW-settings answers in production.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import {
	createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type AgentSession, type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

import { codexAuth, installCodexWire } from "./codex-wire.ts";

const EXTENSION = join(import.meta.dirname, "..", "index.ts");
let root: string;
let counter = 0;
const codex = installCodexWire();
const { wire } = codex;

before(async () => { root = await mkdtemp(join(tmpdir(), "rqw-review-fast-")); });
after(async () => { codex.restore(); await rm(root, { recursive: true, force: true }); });

const until = async (check: () => boolean, what: string) => {
	// Failure watchdog only; a loaded Windows runner needs far more than a second per child round trip.
	const end = Date.now() + 60_000;
	while (!check()) {
		assert.ok(Date.now() < end, `timed out waiting for ${what}`);
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
};

/** A main session on a faux model of the given family; the reviewer is always the real openai-codex provider with fake credentials. */
async function open(family: "gpt" | "claude") {
	const dir = join(root, `w${counter++}`);
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, "auth.json"), JSON.stringify(codexAuth()));
	const runtime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
	await runtime.refresh({ allowNetwork: false });
	const main = fauxProvider({ provider: `fast-main-${counter}`, api: `fast-main-${counter}`, models: [{ id: `${family}-main`, reasoning: true }] });
	main.setResponses(Array.from({ length: 50 }, () => () => fauxAssistantMessage("main ok")));
	runtime.registerNativeProvider(main.provider);
	// The stand-in for RQW-settings' answer; `state.fast` is the main chat's /fast-gpt state.
	const state = { fast: true as boolean | undefined };
	const standIn = (pi: ExtensionAPI) => {
		if (state.fast !== undefined) pi.events.on("rqw-settings:fast-gpt-query", (query) => { (query as { fastGpt?: boolean }).fastGpt = state.fast; });
	};
	const loader = new DefaultResourceLoader({ cwd: dir, agentDir: dir, additionalExtensionPaths: [EXTENSION], extensionFactories: [standIn],
		noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
	await loader.reload();
	assert.deepEqual(loader.getExtensions().errors, []);
	const { session } = await createAgentSession({ cwd: dir, agentDir: dir, modelRuntime: runtime, model: main.getModel(`${family}-main`), thinkingLevel: "off",
		resourceLoader: loader, sessionManager: SessionManager.inMemory(dir),
		settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, transport: "sse" }) });
	await session.bindExtensions({ mode: "tui" });
	const review = async (extra: Record<string, unknown> = {}) => {
		const result = await session.getToolDefinition("review")!.execute("t", { level: "blind", object: "a.ts", criterion: "c", ...extra } as never,
			undefined, undefined, session.extensionRunner.createContext());
		return result.content.map((c) => (c.type === "text" ? c.text : "")).join("");
	};
	const verdicts = () => session.messages.filter((m) => m.role === "custom" && m.customType === "review").length;
	const close = async () => { await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }); session.dispose(); };
	return { state, review, verdicts, close, tool: () => session.getToolDefinition("review")! };
}

describe("GPT Fast, RQW-review reviewers", () => {
	it("the reviewer inherits the main chat state at its start (priority on, none off), whatever the main model family", async () => {
		wire.length = 0;
		const f = await open("gpt");
		try {
			await f.review();
			await until(() => f.verdicts() === 1, "first verdict");
			assert.deepEqual(wire.map(({ body }) => body.model), ["gpt-6.1-sol"]);
			assert.deepEqual(wire.map(({ body }) => body.service_tier), ["priority"]);
			f.state.fast = false;
			await f.review();
			await until(() => f.verdicts() === 2, "second verdict");
			assert.deepEqual(wire.map(({ body }) => body.service_tier), ["priority", undefined]);
			assert.deepEqual(wire.map(({ body }) => body.reasoning?.effort), ["low", "low"], "blind runs GPT-6.1-Sol low");
		} finally { await f.close(); }
		wire.length = 0;
		const claude = await open("claude");
		try {
			await claude.review();
			await until(() => claude.verdicts() === 1, "Claude verdict");
			assert.deepEqual(wire.map(({ body }) => body.model), ["gpt-6.1-sol"], "a Claude main still gets the GPT reviewer, never a Claude one");
			assert.deepEqual(wire.map(({ body }) => body.service_tier), ["priority"], "the Claude main chat's own Fast state is inherited too");
		} finally { await claude.close(); }
	});

	it("fast_gpt of the review tool overrides the inherited state for that reviewer; null inherits", async () => {
		wire.length = 0;
		const f = await open("gpt");
		try {
			let n = 0;
			const run = async (extra: Record<string, unknown>) => { const want = ++n; await f.review(extra); await until(() => f.verdicts() === want, `verdict ${want}`); };
			await run({ fast_gpt: false });
			await run({ fast_gpt: null });
			f.state.fast = false;
			await run({ fast_gpt: true });
			await run({ fast_gpt: null });
			await run({});
			assert.deepEqual(wire.map(({ body }) => body.service_tier), [undefined, "priority", "priority", undefined, undefined],
				"main on: forbidden none, null inherits; main off: forced priority, null and omitted inherit none");
		} finally { await f.close(); }
	});

	it("the review tool describes the inheritance and takes an optional boolean fast_gpt", async () => {
		const f = await open("gpt");
		try {
			const tool = f.tool();
			assert.match(tool.description, /By default a reviewer inherits GPT Fast; pass fast_gpt false when the user forbids Fast for subagents\.$/);
			assert.equal((tool.parameters as { properties: Record<string, { type: string }> }).properties.fast_gpt.type, "boolean");
			assert.ok(!((tool.parameters as { required?: string[] }).required ?? []).includes("fast_gpt"));
		} finally { await f.close(); }
	});

	it("without an answer on the channel (RQW-settings not loaded) the reviewer stays on the standard tier", async () => {
		wire.length = 0;
		const f = await open("gpt");
		f.state.fast = undefined;
		try {
			await f.review();
			await until(() => f.verdicts() === 1, "verdict");
			assert.deepEqual(wire.map(({ body }) => body.service_tier), [undefined]);
		} finally { await f.close(); }
	});
});
