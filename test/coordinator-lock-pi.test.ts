// Real in-process Pi sessions: the exclusive coordinator lock across Pi's own lifecycle. `session.reload()` (what
// /reload does) shuts the old extension runtime down with reason "reload" and builds a new one; the lock stays.
// A session whose repository lock is held by another live pid is a direct agent. Faux provider, no network.
import "./no-network.mjs";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, it } from "node:test";

const { fauxAssistantMessage, fauxProvider } = await import("@earendil-works/pi-ai");
const { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } = await import("@earendil-works/pi-coding-agent");

const SKIP = process.platform === "darwin" ? false : "the coordinator lock is macOS only; elsewhere the guard has no lock";

const ROOT = join(import.meta.dirname, "..");
const TMP = realpathSync(mkdtempSync(join(tmpdir(), "coordinator-lock-pi-")));
after(() => rmSync(TMP, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
const agentDir = join(TMP, "agent");
mkdirSync(agentDir, { recursive: true });

const copy = (from: string, to: string) => {
	mkdirSync(join(to, ".."), { recursive: true });
	writeFileSync(to, readFileSync(from));
};
const GUARD = join(ROOT, ".pi", "extensions", "coordinator-guard");

// A repository fixture: `.git` folder, the guard three levels below the root, the files it reads.
function fixture(name: string) {
	const cwd = join(TMP, name);
	mkdirSync(join(cwd, ".git"), { recursive: true });
	for (const file of readdirSync(GUARD)) copy(join(GUARD, file), join(cwd, ".pi", "extensions", "coordinator-guard", file));
	copy(join(ROOT, "scripts", "owner-quotes.mjs"), join(cwd, "scripts", "owner-quotes.mjs"));
	copy(join(ROOT, "PROCESS.md"), join(cwd, "PROCESS.md"));
	return { cwd, lock: join(cwd, ".git", "coordinator.lock") };
}

async function open(cwd: string, sent: string[]) {
	const faux = fauxProvider({ api: "faux-lock", provider: "openai-codex", models: [{ id: "gpt-6.1-sol", contextWindow: 200_000, maxTokens: 1000 }] });
	faux.setResponses([(context) => { sent.push(JSON.stringify(context)); return fauxAssistantMessage("ok"); }]);
	const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
	faux.provider.auth.apiKey = { name: "Fake key", resolve: async () => ({ auth: { apiKey: "fake-key" } }) };
	modelRuntime.registerNativeProvider(faux.provider);
	await modelRuntime.setRuntimeApiKey("openai-codex", "fake-key");
	const resourceLoader = new DefaultResourceLoader({ cwd, agentDir, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
	await resourceLoader.reload({ resolveProjectTrust: async () => true });
	assert.deepEqual(resourceLoader.getExtensions().errors, []);
	const { session } = await createAgentSession({
		cwd, agentDir, model: faux.getModel("gpt-6.1-sol"), thinkingLevel: "off", modelRuntime, resourceLoader,
		sessionManager: SessionManager.inMemory(cwd), settingsManager: SettingsManager.inMemory({ retry: { enabled: false } }),
	});
	const errors: string[] = [];
	await session.bindExtensions({ mode: "rpc", onError: (e) => errors.push(`${e.event}: ${e.error}`) });
	return { session, errors };
}

it("first session takes the lock, /reload keeps it with a fresh runtime, quit releases it", { skip: SKIP }, async () => {
	const { cwd, lock } = fixture("first");
	const sent: string[] = [];
	const { session, errors } = await open(cwd, sent);
	try {
		const first = JSON.parse(readFileSync(lock, "utf8"));
		assert.equal(first.pid, process.pid);
		assert.equal(first.sessionId, session.sessionManager.getSessionId());

		const runnerBefore = session.extensionRunner;
		await session.reload();
		assert.notEqual(session.extensionRunner, runnerBefore, "reload built a new extension runtime");
		assert.deepEqual(JSON.parse(readFileSync(lock, "utf8")), first, "the lock survived the reload");

		await session.prompt("hello");
		assert.match(sent[0], /<coordinator_rules>/, "the reloaded guard still enforces");
		assert.doesNotMatch(sent[0], /coordinator_note/);
		assert.deepEqual(errors, []);
	} finally {
		await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		session.dispose();
	}
	assert.equal(existsSync(lock), false, "quit released the lock");
});

it("a session whose repository lock is held by another live pid is a direct agent, also after /reload", { skip: SKIP }, async () => {
	const { cwd, lock } = fixture("second");
	const held = JSON.stringify({ pid: process.ppid, sessionId: "other" });
	writeFileSync(lock, held);
	const sent: string[] = [];
	const { session, errors } = await open(cwd, sent);
	try {
		await session.reload();
		await session.prompt("hello");
		assert.doesNotMatch(sent[0], /<coordinator_rules>/);
		assert.match(sent[0], /<coordinator_note>/);
		assert.match(sent[0], /normal direct agent/);
		assert.equal(readFileSync(lock, "utf8"), held, "the holder's lock is untouched");
		assert.deepEqual(errors, []);
	} finally {
		await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		session.dispose();
	}
	assert.equal(readFileSync(lock, "utf8"), held, "a direct session's quit leaves the lock");
});
