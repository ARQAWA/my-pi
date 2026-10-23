// RQW-tool-ui alone, loaded by Pi's own resource loader in isolated temporary agent folders. A scripted faux
// provider answers; no network, no real model, no owner settings.
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import * as pi from "@earendil-works/pi-coding-agent";

const EXTENSION = fileURLToPath(new URL("../index.ts", import.meta.url));
const FOLDER = dirname(EXTENSION);
const NO_RESOURCES = { noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true };

const tmp = mkdtempSync(join(tmpdir(), "rqw-tool-ui-load-"));
after(() => rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
let n = 0;
function fresh() {
	const cwd = join(tmp, `s${n++}`);
	const agentDir = join(cwd, "agent");
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(join(cwd, "f.txt"), "hello\n");
	return { cwd, agentDir };
}

async function load(o: { settings?: object; paths?: string[]; factories?: pi.InlineExtension[] } = {}) {
	const { cwd, agentDir } = fresh();
	writeFileSync(join(agentDir, "settings.json"), JSON.stringify(o.settings ?? { packages: [], extensions: [] }));
	const loader = new pi.DefaultResourceLoader({ cwd, agentDir, additionalExtensionPaths: o.paths ?? [EXTENSION], extensionFactories: o.factories, ...NO_RESOURCES });
	await loader.reload();
	return { cwd, agentDir, loader };
}

const own = (ext: pi.Extension) => ({ handlers: ext.handlers.size, tools: ext.tools.size, messageRenderers: ext.messageRenderers.size, commands: ext.commands.size,
	flags: ext.flags.size, shortcuts: ext.shortcuts.size, entryRenderers: ext.entryRenderers?.size ?? 0, markdown: ext.markdownTransformer === undefined, resolvers: ext.toolRenderers?.length ?? 0 });
const ONLY_ONE_RESOLVER = { handlers: 0, tools: 0, messageRenderers: 0, commands: 0, flags: 0, shortcuts: 0, entryRenderers: 0, markdown: true, resolvers: 1 };

function stockRenderers(cwd: string): Record<string, pi.ToolRenderers> {
	const defs = { read: pi.createReadToolDefinition(cwd), bash: pi.createBashToolDefinition(cwd), edit: pi.createEditToolDefinition(cwd),
		write: pi.createWriteToolDefinition(cwd), grep: pi.createGrepToolDefinition(cwd), find: pi.createFindToolDefinition(cwd), ls: pi.createLsToolDefinition(cwd) };
	return Object.fromEntries(Object.entries(defs).map(([name, d]) => [name, { renderShell: d.renderShell, renderCall: d.renderCall, renderResult: d.renderResult }]));
}

async function session(o: { cwd: string; agentDir: string; loader: pi.DefaultResourceLoader; mode: "tui" | "rpc" | "json" | "print" }) {
	const faux = fauxProvider({ api: "faux-tool-ui", provider: "faux-tool-ui", models: [{ id: "m", contextWindow: 100_000, maxTokens: 1000 }] });
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("read", { path: "f.txt" }, { id: "c0" }), fauxToolCall("bash", { command: "echo hi" }, { id: "c1" })], { stopReason: "toolUse" }),
		fauxAssistantMessage("done"),
	]);
	const runtime = await pi.ModelRuntime.create({ authPath: join(o.agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
	faux.provider.auth.apiKey = { name: "fake", resolve: async () => ({ auth: { apiKey: "fake-tool-ui-key" } }) };
	runtime.registerNativeProvider(faux.provider);
	await runtime.setRuntimeApiKey("faux-tool-ui", "fake-tool-ui-key");
	const { session } = await pi.createAgentSession({ cwd: o.cwd, agentDir: o.agentDir, model: faux.getModel("m"), thinkingLevel: "off", modelRuntime: runtime,
		resourceLoader: o.loader, sessionManager: pi.SessionManager.inMemory(o.cwd), settingsManager: pi.SettingsManager.inMemory({ retry: { enabled: false } }) });
	const errors: string[] = [];
	await session.bindExtensions({ mode: o.mode, onError: (e) => errors.push(`${e.event}: ${e.error}`) });
	return { session, errors };
}

async function close(s: pi.AgentSession) {
	try { await s.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }); } finally { s.dispose(); }
}

describe("RQW-tool-ui scaffold", () => {
	it("load-default-delegates", async () => {
		const { cwd, loader } = await load();
		assert.deepEqual(loader.getExtensions().errors, []);
		const ext = loader.getExtensions().extensions.find((e) => e.path === EXTENSION)!;
		assert.deepEqual(own(ext), ONLY_ONE_RESOLVER, "one resolver, nothing else registered");
		const [resolver] = ext.toolRenderers!;
		const stock = stockRenderers(cwd);
		const cases: [string, pi.ToolRenderers | undefined][] = [...Object.entries(stock), ["codemode", { renderShell: "self" }], ["agent", {}],
			["unknown_tool", undefined], ["", undefined], ["read", undefined]];
		for (const [name, renderers] of cases) {
			let calls = 0;
			const next = () => { calls++; return renderers; };
			const out = resolver(name, next);
			assert.equal(out, renderers, `${name}: the very object next() returned`);
			assert.deepEqual(out, next(), `${name}: deep-equal to next()`);
			assert.equal(calls, 2, `${name}: next() asked once by the resolver`);
		}
		// The same through Pi's resolver chain.
		const { session: s } = await session({ ...fresh(), loader, mode: "rpc" });
		try {
			for (const [name, renderers] of cases) assert.equal(s.extensionRunner.resolveToolRenderers(name, () => renderers), renderers, name);
		} finally { await close(s); }
	});

	it("filtered-off-no-registration", async () => {
		// A temporary package holding only this extension, switched the way a user does it.
		const pkg = join(tmp, "pkg");
		cpSync(FOLDER, join(pkg, "extensions", "RQW-tool-ui"), { recursive: true, filter: (src) => !src.includes(`${FOLDER}${sep}test`) });
		writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "tool-ui-fixture", private: true, pi: { extensions: ["./extensions/RQW-tool-ui/index.ts"] } }));
		const inPkg = (l: pi.DefaultResourceLoader) => l.getExtensions().extensions.filter((e) => e.path.startsWith(pkg));
		const on = await load({ paths: [], settings: { packages: [pkg] } });
		assert.deepEqual(on.loader.getExtensions().errors, []);
		assert.deepEqual(inPkg(on.loader).map(own), [ONLY_ONE_RESOLVER], "on: the package registers its resolver");
		const off = await load({ paths: [], settings: { packages: [{ source: pkg, extensions: ["-extensions/RQW-tool-ui/index.ts"] }] } });
		assert.deepEqual(off.loader.getExtensions().errors, []);
		assert.deepEqual(inPkg(off.loader), [], "off: nothing of the extension is loaded");
		assert.deepEqual(off.loader.getExtensions().extensions.flatMap((e) => e.toolRenderers ?? []), [], "off: no resolver at all");
	});

	for (const mode of ["print", "json", "rpc"] as const) {
		it(`non-tui-no-components (${mode})`, async () => {
			// A probe resolver sees every resolution of tool renderers, whichever order the resolvers run in.
			let resolutions = 0;
			const probe: pi.InlineExtension = { name: "probe", factory: (api) => api.registerToolRenderer((_name, next) => { resolutions++; return next(); }) };
			const { cwd, agentDir, loader } = await load({ factories: [probe] });
			assert.deepEqual(loader.getExtensions().errors, []);
			const { session: s, errors } = await session({ cwd, agentDir, loader, mode });
			try {
				const ends: string[] = [];
				s.subscribe((e) => { if (e.type === "tool_execution_end") ends.push(`${e.toolName}:${e.isError ? "error" : "ok"}`); });
				await s.prompt("go");
				await s.waitForIdle();
				assert.deepEqual(ends.sort(), ["bash:ok", "read:ok"], "the turn ran its tool calls");
				assert.deepEqual(errors, []);
				assert.equal(resolutions, 0, "no renderer was resolved, so no component was created");
				const ext = loader.getExtensions().extensions.find((e) => e.path === EXTENSION)!;
				assert.deepEqual(own(ext), ONLY_ONE_RESOLVER, "no handlers, statuses, commands or subscriptions");
				s.extensionRunner.resolveToolRenderers("read", () => undefined);
				assert.equal(resolutions, 1, "the probe does see a resolution");
			} finally { await close(s); }
		});
	}

	it("standalone-load: without any other RQW extension, no errors", async () => {
		const { cwd, agentDir, loader } = await load();
		assert.deepEqual(loader.getExtensions().errors, []);
		assert.deepEqual(loader.getExtensions().extensions.map((e) => e.path), [EXTENSION]);
		const { session: s, errors } = await session({ cwd, agentDir, loader, mode: "rpc" });
		try {
			await s.prompt("go");
			await s.waitForIdle();
			assert.deepEqual(errors, []);
			assert.equal((s.messages.at(-1) as { stopReason?: string }).stopReason, "stop");
		} finally { await close(s); }
	});
});
