import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, it } from "node:test";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";

const EXTENSION = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");
let root: string;
let runtime: ModelRuntime;
const faux = fauxProvider();
before(async () => {
	root = await mkdtemp(join(tmpdir(), "rqw-cache-default-"));
	runtime = await ModelRuntime.create({ authPath: join(root, "auth.json"), modelsPath: null, refreshOnCreate: false });
	runtime.registerNativeProvider(faux.provider);
});
after(async () => { await rm(root, { recursive: true, force: true }); });

async function open(enabled = true, cacheWarming?: "off" | "streaming" | "idle", fromFile = false, shared?: SettingsManager) {
	const manager = shared ?? (fromFile ? SettingsManager.create(root, root) :
		SettingsManager.inMemory(cacheWarming === undefined ? {} : { cacheWarming }));
	const loader = new DefaultResourceLoader({ cwd: root, agentDir: root, settingsManager: manager,
		additionalExtensionPaths: enabled ? [EXTENSION] : [], noExtensions: true,
		noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
	await loader.reload();
	assert.deepEqual(loader.getExtensions().errors, []);
	const { session } = await createAgentSession({ cwd: root, agentDir: root, modelRuntime: runtime,
		model: faux.getModel(), settingsManager: manager, resourceLoader: loader, sessionManager: SessionManager.inMemory(root) });
	return session;
}

// Use the real SDK stream boundary without settling the run: streaming mode must remain armed in the control.
async function request(session: Awaited<ReturnType<typeof open>>) {
	const model = { ...session.model!, promptCache: { short: 300, long: 3600 },
		cost: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 } };
	const stream = await session.agent.streamFunction(model, { messages: [{ role: "user", content: "hi", timestamp: 0 }] },
		{ sessionId: session.sessionId });
	const message = await stream.result();
	session.sessionManager.appendMessage({ ...message, usage: { ...message.usage, cacheRead: 100_000 } });
}

it("plugin policy off never arms on a real SDK request; settings and notices are unchanged", async t => {
	const session = await open();
	let requests = 0;
	faux.setResponses([() => { requests++; return fauxAssistantMessage("ok"); }]);
	t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.now() });
	try {
		assert.equal(session.settingsManager.getCacheWarmingMode(), "off", "applies even without SDK bindExtensions");
		assert.equal(session.settingsManager.getSettings().cacheWarming, undefined, "not an override or persisted value");
		assert.equal(session.settingsManager.getGlobalSettings().showCacheMissNotices, undefined);
		assert.equal(requests, 0, "no preflight request");
		await request(session);
		assert.deepEqual(session.cacheWarmingStatus, { state: "inactive", reason: "cache warming disabled" });
		t.mock.timers.tick(3_600_000);
		await Promise.resolve();
		assert.equal(requests, 1, "only the real request, no background replay");
	} finally { session.dispose(); t.mock.timers.reset(); }
});

for (const mode of ["off", "streaming", "idle"] as const) {
	it(`plugin ignores global ${mode}, including a later settings change`, async () => {
		const session = await open(true, mode);
		faux.setResponses([fauxAssistantMessage("ok")]);
		try {
			assert.equal(session.settingsManager.getCacheWarmingMode(), "off");
			await request(session);
			assert.deepEqual(session.cacheWarmingStatus, { state: "inactive", reason: "cache warming disabled" });
			session.setCacheWarmingMode("idle");
			assert.equal(session.settingsManager.getCacheWarmingMode(), "off");
		} finally { session.dispose(); }
	});
}

for (const mode of ["streaming", "idle"] as const) {
	it(`file ${mode} cannot enable warming; disable/reload restores the file's stock behavior without edits`, async () => {
		const file = join(root, "settings.json");
		const text = JSON.stringify({ cacheWarming: mode, showCacheMissNotices: false });
		await writeFile(file, text);
		const session = await open(true, undefined, true);
		try {
			assert.equal(session.settingsManager.getGlobalSettings().cacheWarming, mode);
			assert.equal(session.settingsManager.getCacheWarmingMode(), "off");
			faux.setResponses([fauxAssistantMessage("ok"), fauxAssistantMessage("ok")]);
			await request(session);
			assert.deepEqual(session.cacheWarmingStatus, { state: "inactive", reason: "cache warming disabled" });
			await session.bindExtensions({});
			session.resourceLoader.reload = async () => { session.resourceLoader.getExtensions().extensions.length = 0; };
			await session.reload();
			assert.equal(session.settingsManager.getCacheWarmingMode(), mode);
			await request(session);
			assert.equal(session.cacheWarmingStatus?.state, "scheduled");
			assert.equal(await readFile(file, "utf8"), text, "owner settings and notices are untouched");
		} finally { session.dispose(); await rm(file, { force: true }); }
	});
}

it("off and concurrent unowned sessions keep Pi's streaming default; dispose restores the exact getter", async () => {
	const a = await open();
	const b = await open();
	const stock = await open(false);
	const manager = a.settingsManager;
	try {
		assert.equal(stock.settingsManager.getCacheWarmingMode(), "streaming");
		a.dispose();
		assert.equal(manager.getCacheWarmingMode(), "streaming");
		assert.equal(Object.hasOwn(manager, "getCacheWarmingMode"), false);
		assert.equal(b.settingsManager.getCacheWarmingMode(), "off");
		faux.setResponses([fauxAssistantMessage("ok")]);
		await request(stock);
		assert.equal(stock.cacheWarmingStatus?.state, "scheduled", "stock control really arms");
	} finally { a.dispose(); b.dispose(); stock.dispose(); }
});

for (const order of ["first-then-second", "second-then-first"] as const) {
	it(`two sessions on one SettingsManager restore the exact getter when both are disposed (${order})`, async () => {
		const manager = SettingsManager.inMemory({});
		const a = await open(true, undefined, false, manager);
		const b = await open(true, undefined, false, manager);
		const [first, second] = order === "first-then-second" ? [a, b] : [b, a];
		try {
			assert.equal(manager.getCacheWarmingMode(), "off");
			first.dispose();
			assert.equal(manager.getCacheWarmingMode(), "off", "the remaining owner keeps the policy");
			second.dispose();
			assert.equal(manager.getCacheWarmingMode(), "streaming");
			assert.equal(Object.hasOwn(manager, "getCacheWarmingMode"), false);
		} finally { a.dispose(); b.dispose(); }
	});
}

it("disabling on reload restores Pi's default without writing a settings value", async () => {
	const session = await open();
	try {
		await session.bindExtensions({});
		session.resourceLoader.reload = async () => { session.resourceLoader.getExtensions().extensions.length = 0; };
		await session.reload();
		assert.equal(session.settingsManager.getCacheWarmingMode(), "streaming");
		assert.equal(session.settingsManager.getGlobalSettings().cacheWarming, undefined);
		faux.setResponses([fauxAssistantMessage("ok")]);
		await request(session);
		assert.equal(session.cacheWarmingStatus?.state, "scheduled");
	} finally { session.dispose(); }
});
