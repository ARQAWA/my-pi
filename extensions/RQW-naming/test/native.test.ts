// Real Pi sessions (createAgentSession, SessionManager, ModelRuntime) with only this extension loaded. Credentials,
// settings and session files live in an OS-temp directory; providers are pi-ai faux providers, so nothing is networked.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import {
	type AgentSession, createAgentSession, DefaultResourceLoader, type ExtensionAPI, ModelRuntime, SessionManager, SettingsManager,
} from "@earendil-works/pi-coding-agent";

const EXTENSION = join(import.meta.dirname, "..", "index.ts");
const TEN = JSON.stringify(["Alpha plan", "Beta notes", "Gamma trip", "Delta bug", "Epsilon ideas", "Zeta test", "Eta docs", "Theta refactor", "Iota review", "Kappa ship"]);

let root: string;
let counter = 0;
const naming = { calls: 0, prompts: [] as string[] };
const infoEvents: (string | undefined)[] = [];
const recorder = (pi: ExtensionAPI) => { pi.on("session_info_changed", (event) => { infoEvents.push(event.name); }); };

async function until(check: () => boolean, what: string) {
	for (let i = 0; i < 2000; i++) {
		if (check()) return;
		await new Promise((resolve) => setImmediate(resolve));
	}
	assert.fail(`timed out waiting for ${what}`);
}

before(async () => {
	root = await mkdtemp(join(tmpdir(), "rqw-naming-native-"));
});
after(async () => {
	await rm(root, { recursive: true, force: true });
});

async function open(sessionFile?: string) {
	const dir = join(root, `case-${counter++}`);
	const agent = join(dir, "agent");
	const cwd = join(dir, "project");
	const sessions = join(dir, "sessions");
	await mkdir(agent, { recursive: true });
	await mkdir(cwd, { recursive: true });
	await writeFile(join(agent, "auth.json"), "{}");
	const runtime = await ModelRuntime.create({ authPath: join(agent, "auth.json"), modelsPath: null, modelsStorePath: join(agent, "models-cache.json"), refreshOnCreate: false });
	await runtime.refresh({ allowNetwork: false });

	// Authenticated naming provider: anthropic/claude-haiku-5-5. Generation gets ten names; selection picks index 3.
	const namer = fauxProvider({ provider: "anthropic", api: "rqw-naming-faux", models: [{ id: "claude-haiku-5-5", reasoning: true }] });
	namer.provider.auth.apiKey = { name: "Faux", resolve: async () => ({ auth: { apiKey: "faux-only" } }) };
	namer.setResponses(Array.from({ length: 50 }, () => (context) => {
		naming.calls++;
		const text = JSON.stringify(context);
		naming.prompts.push(text);
		return fauxAssistantMessage(text.includes("Candidates:") ? "3" : TEN);
	}));
	runtime.registerNativeProvider(namer.provider);

	const main = fauxProvider({ provider: "main-faux", api: "rqw-main-faux", models: [{ id: "m", reasoning: true }] });
	main.setResponses(Array.from({ length: 50 }, () => fauxAssistantMessage("main ok")));
	runtime.registerNativeProvider(main.provider);

	const loader = new DefaultResourceLoader({ cwd, agentDir: agent, additionalExtensionPaths: [EXTENSION], extensionFactories: [recorder],
		noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
	await loader.reload();
	assert.deepEqual(loader.getExtensions().errors, []);

	const manager = sessionFile ? SessionManager.open(sessionFile, sessions) : SessionManager.create(cwd, sessions);
	const { session } = await createAgentSession({ cwd, agentDir: agent, modelRuntime: runtime, model: main.getModel("m"), thinkingLevel: "low",
		resourceLoader: loader, sessionManager: manager,
		settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, transport: "sse" }) });
	await session.bindExtensions({ mode: "tui" });
	return { session: session as AgentSession, sessions, cwd, close: () => session.dispose() };
}

describe("native automatic naming and persistence", () => {
	it("names the session after the first user prompt, persists it, and reopens with the name", async () => {
		const h = await open();
		try {
			const before = naming.calls;
			await h.session.prompt("Plan a trip to Lisbon");
			await until(() => h.session.sessionManager.getSessionName() === "Delta bug", "automatic name");
			assert.ok(infoEvents.includes("Delta bug"), "session_info_changed fired for the automatic write");
			assert.equal(naming.calls - before, 2);
			assert.match(naming.prompts[before], /Plan a trip to Lisbon/);
			const file = h.session.sessionManager.getSessionFile()!;
			assert.equal(SessionManager.open(file, h.sessions).getSessionName(), "Delta bug");
			const listed = await SessionManager.list(h.cwd, h.sessions);
			assert.equal(listed.find((s) => s.path === file)?.name, "Delta bug");
		} finally { h.close(); }
	});

	it("reopening the persisted session does not generate a name again", async () => {
		const first = await open();
		await first.session.prompt("Hello again");
		await until(() => first.session.sessionManager.getSessionName() === "Delta bug", "name before reopen");
		const file = first.session.sessionManager.getSessionFile()!;
		first.close();
		const before = naming.calls;
		const reopened = await open(file);
		try {
			assert.equal(reopened.session.sessionManager.getSessionName(), "Delta bug");
			await new Promise((r) => setImmediate(r));
			assert.equal(naming.calls, before);
		} finally { reopened.close(); }
	});

	it("a native /name is stock: it emits session_info_changed and stays until the next trigger", async () => {
		const h = await open();
		try {
			h.session.setSessionName("Manual name");
			assert.equal(h.session.sessionManager.getSessionName(), "Manual name");
			await until(() => infoEvents.includes("Manual name"), "native name notification");
			await new Promise((r) => setImmediate(r));
			assert.equal(h.session.sessionManager.getSessionName(), "Manual name");
		} finally { h.close(); }
	});
});
