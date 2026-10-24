// The reviewer profiles on the wire: real Pi sessions, the real openai-codex provider, only the network replaced.
// Both levels are GPT-6.1-Sol whatever the main model is, and a missing Codex login is a failed review, not a fallback.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";

import { LEVELS } from "../index.ts";
import { codexAuth, installCodexWire } from "./codex-wire.ts";

const EXTENSION = join(import.meta.dirname, "..", "index.ts");
let root: string;
let counter = 0;
const codex = installCodexWire();
const { wire } = codex;

before(async () => { root = await mkdtemp(join(tmpdir(), "rqw-review-levels-")); });
after(async () => { codex.restore(); await rm(root, { recursive: true, force: true }); });

const until = async (check: () => boolean, what: string) => {
	const end = Date.now() + 60_000;
	while (!check()) {
		assert.ok(Date.now() < end, `timed out waiting for ${what}`);
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
};

/** A main session on a faux Claude-named model, with the given credentials in auth.json. */
async function open(auth: Record<string, unknown>) {
	const dir = join(root, `w${counter++}`);
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, "auth.json"), JSON.stringify(auth));
	const runtime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
	await runtime.refresh({ allowNetwork: false });
	const main = fauxProvider({ provider: `levels-main-${counter}`, api: `levels-main-${counter}`, models: [{ id: "claude-main", reasoning: true }] });
	main.setResponses(Array.from({ length: 10 }, () => () => fauxAssistantMessage("main ok")));
	runtime.registerNativeProvider(main.provider);
	const loader = new DefaultResourceLoader({ cwd: dir, agentDir: dir, additionalExtensionPaths: [EXTENSION], noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
	await loader.reload();
	assert.deepEqual(loader.getExtensions().errors, []);
	const { session } = await createAgentSession({ cwd: dir, agentDir: dir, modelRuntime: runtime, model: main.getModel("claude-main"), thinkingLevel: "off",
		resourceLoader: loader, sessionManager: SessionManager.inMemory(dir),
		settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, transport: "sse" }) });
	await session.bindExtensions({ mode: "tui" });
	const review = (level: string) => session.getToolDefinition("review")!.execute("t", { level, object: "a.ts", criterion: "c" } as never,
		undefined, undefined, session.extensionRunner.createContext());
	const verdicts = () => session.messages.flatMap((m) => (m.role === "custom" && m.customType === "review" && typeof m.content === "string" ? [m.content] : []));
	const close = async () => { await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }); session.dispose(); };
	return { review, verdicts, close };
}

describe("RQW-review: reviewer levels", () => {
	it("LEVELS are GPT-6.1-Sol on openai-codex: blind low, high medium", () => {
		assert.deepEqual(LEVELS, {
			blind: { provider: "openai-codex", model: "gpt-6.1-sol", thinking: "low" },
			high: { provider: "openai-codex", model: "gpt-6.1-sol", thinking: "medium" },
		});
	});

	it("blind and high send the same model with low and medium effort, and end with the complete clean verdict", async () => {
		wire.length = 0;
		const f = await open(codexAuth());
		try {
			await f.review("blind");
			await until(() => f.verdicts().length === 1, "the blind verdict");
			await f.review("high");
			await until(() => f.verdicts().length === 2, "the high verdict");
			assert.deepEqual(wire.map(({ body }) => body.model), ["gpt-6.1-sol", "gpt-6.1-sol"]);
			assert.deepEqual(wire.map(({ body }) => body.reasoning?.effort), ["low", "medium"]);
			for (const verdict of f.verdicts()) assert.match(verdict, /^\[review#\d\] CLEAN\nCHECKED:\n- criterion \(source\) fulfilled \(object\)/);
		} finally { await f.close(); }
	});

	it("with no Codex login the review fails and no other provider is tried, even with an Anthropic login", async () => {
		wire.length = 0;
		const f = await open({ anthropic: { type: "api_key", key: "sk-ant-api03-fake" } });
		try {
			await f.review("blind");
			await until(() => f.verdicts().length === 1, "the failed verdict");
			assert.match(f.verdicts()[0], /^\[review#1\] Review failed: /);
			assert.equal(wire.length, 0, "nothing reached any provider");
		} finally { await f.close(); }
	});
});
