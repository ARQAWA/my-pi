// T10 lifecycle: on and off through Pi's package filter and /reload, nothing outside the TUI, nothing kept across a
// session switch. Real Pi sessions with only RQW-tool-ui, isolated temporary agent folders and settings, a scripted
// faux provider; no network, no real model, no owner settings.
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import * as pi from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { fakeTui } from "./transcript.ts";

const EXTENSION = fileURLToPath(new URL("../index.ts", import.meta.url));
const FOLDER = dirname(EXTENSION);
const NO_RESOURCES = { noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true };
const OFF = ["-extensions/RQW-tool-ui/index.ts"];

const tmp = mkdtempSync(join(tmpdir(), "rqw-tool-ui-life-"));
after(() => rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
before(() => pi.initTheme("dark", false));

// A temporary package holding only this extension, switched the way a user does it.
const pkg = join(tmp, "pkg");
cpSync(FOLDER, join(pkg, "extensions", "RQW-tool-ui"), { recursive: true, filter: (src) => !src.includes(`${FOLDER}${sep}test`) });
writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "tool-ui-fixture", private: true, pi: { extensions: ["./extensions/RQW-tool-ui/index.ts"] } }));

let n = 0;
function folders() {
	const cwd = join(tmp, `s${n++}`);
	const agentDir = join(cwd, "agent");
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(join(cwd, "a.txt"), "alpha\n");
	return { cwd, agentDir };
}
const settings = (agentDir: string, on: boolean, extra: object = {}) =>
	writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: [on ? pkg : { source: pkg, extensions: OFF }], extensions: [], ...extra }));

/** Each prompt: one read, then the answer. */
function scripted(name: string) {
	const faux = fauxProvider({ api: name, provider: name, models: [{ id: "m", contextWindow: 100_000, maxTokens: 1000 }] });
	let k = 0;
	faux.setResponses(Array.from({ length: 8 }, (_, i) => i % 2 === 0
		? () => fauxAssistantMessage([fauxToolCall("read", { path: "a.txt" }, { id: `r${k++}` })], { stopReason: "toolUse" })
		: () => fauxAssistantMessage("done")));
	return faux;
}

async function open(mode: "tui" | "rpc" | "json" | "print", o: { on?: boolean; paths?: string[] } = {}) {
	const { cwd, agentDir } = folders();
	settings(agentDir, o.on ?? true);
	const name = `faux-life-${n}`;
	const faux = scripted(name);
	const runtime = await pi.ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
	faux.provider.auth.apiKey = { name: "fake", resolve: async () => ({ auth: { apiKey: "fake-key" } }) };
	runtime.registerNativeProvider(faux.provider);
	await runtime.setRuntimeApiKey(name, "fake-key");
	const loader = new pi.DefaultResourceLoader({ cwd, agentDir, additionalExtensionPaths: o.paths ?? [], ...NO_RESOURCES });
	await loader.reload();
	const { session } = await pi.createAgentSession({ cwd, agentDir, model: faux.getModel("m"), thinkingLevel: "off", modelRuntime: runtime,
		resourceLoader: loader, sessionManager: pi.SessionManager.inMemory(cwd), settingsManager: pi.SettingsManager.create(cwd, agentDir) });
	const errors: string[] = [];
	await session.bindExtensions({ mode, onError: (e) => errors.push(`${e.event}: ${e.error}`) });
	return { cwd, agentDir, session, errors, loader };
}

async function close(s: pi.AgentSession) {
	try { await s.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }); } finally { s.dispose(); }
}

/** Every tool row of the session drawn as Pi's interactive mode draws it from history, with the renderers the session
 * resolves now (Pi rebuilds the transcript after `/reload`). */
function rows(s: pi.AgentSession, cwd: string, expanded = false): string[][] {
	const tui = fakeTui();
	const out: string[][] = [];
	const results = new Map<string, { content: never; isError: boolean; durationMs?: number }>();
	for (const msg of s.messages as { role: string; toolCallId?: string }[]) if (msg.role === "toolResult") results.set(msg.toolCallId!, msg as never);
	for (const msg of s.messages as { role: string; content: { type: string; id: string; name: string; arguments: unknown }[] }[]) {
		if (msg.role !== "assistant") continue;
		for (const c of msg.content.filter((b) => b.type === "toolCall")) {
			const base = () => pi.createReadToolDefinition(cwd);
			const row = new pi.ToolExecutionComponent(c.name, c.id, c.arguments, {}, s.extensionRunner.resolveToolRenderers(c.name, base), tui as never, cwd);
			row.setExpanded(expanded);
			const r = results.get(c.id);
			if (r) row.updateResult({ ...r, durationMs: 10 });
			out.push(row.render(80).map((l) => stripTerminalSequences(l).trimEnd()));
		}
	}
	return out;
}

/** The same rows as Pi draws them with the stock read renderers. */
function stockRows(s: pi.AgentSession, cwd: string, expanded = false): string[][] {
	const tui = fakeTui();
	return (s.messages as { role: string; content: { type: string; id: string; name: string; arguments: unknown }[] }[])
		.filter((m) => m.role === "assistant").flatMap((m) => m.content.filter((b) => b.type === "toolCall")).map((c) => {
			const row = new pi.ToolExecutionComponent(c.name, c.id, c.arguments, {}, pi.createReadToolDefinition(cwd), tui as never, cwd);
			row.setExpanded(expanded);
			const r = (s.messages as { role: string; toolCallId?: string }[]).find((m) => m.role === "toolResult" && m.toolCallId === c.id);
			if (r) row.updateResult({ ...(r as never as { content: never; isError: boolean }), durationMs: 10 });
			return row.render(80).map((l) => stripTerminalSequences(l).trimEnd());
		});
}

async function run(s: pi.AgentSession, text: string) {
	await s.prompt(text);
	await s.waitForIdle();
}

describe("RQW-tool-ui lifecycle", () => {
	it("filter-on-off-reload (Pi's package filter and /reload, isolated settings)", async () => {
		const { cwd, agentDir, session: s, errors } = await open("tui");
		try {
			const base = pi.createReadToolDefinition(cwd);
			assert.equal(s.extensionRunner.resolveToolRenderers("read", () => base)?.renderShell, "self", "on: this extension draws tool rows");
			settings(agentDir, false);
			await s.reload();
			assert.equal(s.extensionRunner.resolveToolRenderers("read", () => base), base, "off: Pi's own renderers, untouched");
			assert.equal(s.extensionRunner.resolveToolRenderers("mystery", () => undefined), undefined);
			settings(agentDir, true);
			await s.reload();
			assert.equal(s.extensionRunner.resolveToolRenderers("read", () => base)?.renderShell, "self", "on again after /reload");
			assert.deepEqual(errors, []);
		} finally { await close(s); }
	});

	it("stock-after-off (old and new calls)", async () => {
		const { cwd, agentDir, session: s, errors } = await open("tui");
		try {
			await run(s, "first");
			assert.deepEqual(rows(s, cwd), [["", " Read 1 file"]], "on: the summary line");
			settings(agentDir, false);
			await s.reload();
			assert.deepEqual(rows(s, cwd), stockRows(s, cwd), "off: the old call is stock");
			await run(s, "second");
			const after = rows(s, cwd);
			assert.equal(after.length, 2);
			assert.deepEqual(after, stockRows(s, cwd), "off: old and new calls are stock");
			assert.ok(after.every((r) => r.length > 2 && !r.some((l) => l.includes("Read 1 file"))));
			assert.deepEqual(rows(s, cwd, true), stockRows(s, cwd, true), "expanded too");
			assert.deepEqual(errors, []);
		} finally { await close(s); }
	});

	for (const mode of ["print", "json", "rpc"] as const) {
		it(`non-tui-nothing (${mode})`, async () => {
			const { cwd, session: s, errors } = await open(mode);
			try {
				await run(s, "go");
				// Pi resolves no renderers outside its TUI; even when asked, this extension keeps no state there.
				assert.deepEqual(rows(s, cwd), [[]], "no group state: nothing drawn");
				assert.deepEqual(errors, []);
			} finally { await close(s); }
		});
	}

	it("session-switch-cleanup", async () => {
		const { cwd, agentDir } = folders();
		settings(agentDir, true);
		const name = `faux-life-switch-${n}`;
		const faux = scripted(name);
		const modelRuntime = await pi.ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
		faux.provider.auth.apiKey = { name: "fake", resolve: async () => ({ auth: { apiKey: "fake-key" } }) };
		modelRuntime.registerNativeProvider(faux.provider);
		await modelRuntime.setRuntimeApiKey(name, "fake-key");
		const runtime = await pi.createAgentSessionRuntime(async ({ cwd, sessionManager, sessionStartEvent }) => {
			const services = await pi.createAgentSessionServices({ cwd, agentDir, modelRuntime, settingsManager: pi.SettingsManager.create(cwd, agentDir),
				resourceLoaderOptions: NO_RESOURCES });
			const created = await pi.createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model: faux.getModel("m"), thinkingLevel: "off" });
			return { ...created, services, diagnostics: services.diagnostics };
		}, { cwd, agentDir, sessionManager: pi.SessionManager.inMemory(cwd) });
		const errors: string[] = [];
		const bind = () => runtime.session.bindExtensions({ mode: "tui", onError: (e) => errors.push(`${e.event}: ${e.error}`) });
		try {
			await bind();
			const first = runtime.session;
			await run(first, "go");
			const tui = fakeTui();
			const oldRenderers = first.extensionRunner.resolveToolRenderers("read", () => pi.createReadToolDefinition(cwd));
			const oldCall = (first.messages.find((m) => m.role === "assistant") as { content: { type: string; id: string }[] }).content.find((c) => c.type === "toolCall")!;
			const oldRow = new pi.ToolExecutionComponent("read", oldCall.id, { path: "a.txt" }, {}, oldRenderers, tui as never, cwd);
			const draw = () => oldRow.render(80).map((l) => stripTerminalSequences(l).trimEnd());
			assert.deepEqual(draw(), ["", " Read 1 file"]);
			await runtime.newSession();
			await bind();
			assert.notEqual(runtime.session, first);
			oldRow.invalidate();
			assert.deepEqual(draw(), [], "the old session's state is gone");
			await run(runtime.session, "again");
			oldRow.invalidate();
			assert.deepEqual(draw(), [], "and is not rebuilt by the new session's events");
			assert.deepEqual(rows(runtime.session, cwd), [["", " Read 1 file"]], "the new session draws its own calls");
			assert.equal(tui.renders, 0, "the old row was never asked to redraw after the switch");
			assert.deepEqual(errors, []);
		} finally {
			await runtime.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
			await runtime.dispose();
		}
	});

	it("standalone-load (no other RQW extension)", async () => {
		const { cwd, session: s, errors, loader } = await open("tui");
		try {
			assert.deepEqual(loader.getExtensions().errors, []);
			assert.deepEqual(loader.getExtensions().extensions.map((e) => e.path), [join(pkg, "extensions", "RQW-tool-ui", "index.ts")]);
			await run(s, "go");
			assert.deepEqual(errors, []);
			assert.deepEqual(rows(s, cwd), [["", " Read 1 file"]]);
			assert.equal((s.messages.at(-1) as { stopReason?: string }).stopReason, "stop");
		} finally { await close(s); }
	});
});
