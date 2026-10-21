// First-read regressions: never prime an observer through session.model. Real SDK and CLI bundle, faux/loopback only.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createAssistantMessageEventStream, createProvider, type AssistantMessage, type Model } from "@earendil-works/pi-ai";
import * as library from "@earendil-works/pi-coding-agent";
import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";

const bundle: typeof library = await import(new URL("./bundle/index.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href);
const ENTRIES: [string, typeof library][] = [["library", library], ["bundle", bundle]];
const EXTENSION = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");
const NO_RESOURCES = { noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true };
const CAPPED = { window: 500_000, reserve: 50_000 };
const STOCK = { window: 1_000_000, reserve: 16_384 };
let root: string;
let next = 0;

const httpState = { tokens: 1, caps: [] as number[], port: 0 };
const server = createServer((request, response) => {
	let raw = "";
	request.on("data", (chunk) => { raw += chunk; });
	request.on("end", () => {
		const body = JSON.parse(raw);
		httpState.caps.push(body.max_completion_tokens ?? body.max_tokens);
		const base = { id: "c1", object: "chat.completion.chunk", created: 0, model: "big" };
		response.writeHead(200, { "content-type": "text/event-stream" });
		for (const data of [
			{ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "ok" }, finish_reason: null }] },
			{ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
			{ ...base, choices: [], usage: { prompt_tokens: httpState.tokens, completion_tokens: 0, total_tokens: httpState.tokens } },
		]) response.write(`data: ${JSON.stringify(data)}\n\n`);
		response.end("data: [DONE]\n\n");
	});
});
before(async () => {
	root = await mkdtemp(join(tmpdir(), "rqw-context-state-"));
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	httpState.port = (server.address() as AddressInfo).port;
});
after(async () => {
	await new Promise<void>((resolve) => server.close(() => resolve()));
	await rm(root, { recursive: true, force: true });
});

async function open(pi: typeof library, owner = false, endpoint = false) {
	const cwd = join(root, String(next++));
	const agentDir = join(cwd, "agent");
	await mkdir(agentDir, { recursive: true });
	const select = (on: boolean) => writeFile(join(agentDir, "settings.json"), JSON.stringify({ extensions: on ? [EXTENSION] : [] }));
	await select(owner);
	const modelsPath = join(agentDir, "models.json");
	if (endpoint) await writeFile(modelsPath, JSON.stringify({ providers: { local: {
		baseUrl: `http://127.0.0.1:${httpState.port}/v1`, api: "openai-completions", apiKey: "fake-only",
		models: [{ id: "big", contextWindow: 1_000_000, maxTokens: 128_000 }],
	} } }));
	const runtime = await pi.ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: endpoint ? modelsPath : null, refreshOnCreate: false });
	const script = { next: [] as number[], requests: [] as { window: number; maxTokens?: number }[] };
	const reply = (model: Model<string>, _context: unknown, options?: { maxTokens?: number }) => {
		const stream = createAssistantMessageEventStream();
		const input = script.next.shift() ?? 0;
		script.requests.push({ window: model.contextWindow, maxTokens: options?.maxTokens });
		const message: AssistantMessage = {
			role: "assistant", content: [{ type: "text", text: input ? "ok" : "summary" }],
			api: model.api, provider: model.provider, model: model.id,
			usage: { input, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: input,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			stopReason: "stop", timestamp: Date.now(),
		};
		queueMicrotask(() => {
			stream.push({ type: "start", partial: message });
			stream.push({ type: "done", reason: "stop", message });
			stream.end(message);
		});
		return stream;
	};
	runtime.registerNativeProvider(createProvider({
		id: "state-test", auth: { apiKey: { name: "Fake", resolve: async () => ({ auth: {} }) } },
		models: [{ id: "big", name: "big", api: "state-test", provider: "state-test", baseUrl: "http://127.0.0.1:0",
			reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 1_000_000, maxTokens: 128_000 }],
		api: { stream: reply, streamSimple: reply },
	} as Parameters<typeof createProvider>[0]));
	await runtime.refresh({ allowNetwork: false });
	const declared = runtime.getModel(endpoint ? "local" : "state-test", "big")!;
	Object.freeze(declared);
	const resourceLoader = new pi.DefaultResourceLoader({ cwd, agentDir, ...NO_RESOURCES });
	await resourceLoader.reload();
	assert.deepEqual(resourceLoader.getExtensions().errors, []);
	const { session } = await pi.createAgentSession({
		cwd, agentDir, model: declared, thinkingLevel: "off", modelRuntime: runtime, resourceLoader,
		sessionManager: pi.SessionManager.inMemory(cwd),
		settingsManager: pi.SettingsManager.inMemory({ retry: { enabled: false }, compaction: { keepRecentTokens: 0 } }),
	});
	await session.bindExtensions({});
	return { session, declared, runtime, select, script };
}

async function shutdown(session: AgentSession) {
	try { await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }); }
	finally { session.dispose(); }
}

type LoopAgent = AgentSession["agent"] & { createLoopConfig(): { model: Model<string> } };
const READERS: [string, (session: AgentSession) => Model<string>][] = [
	["session.state.model", (session) => session.state.model],
	["session.agent.state.model", (session) => session.agent.state.model],
	["native createLoopConfig", (session) => (session.agent as LoopAgent).createLoopConfig().model],
];

function values(session: AgentSession, read: (session: AgentSession) => Model<string>) {
	const model = read(session);
	return { window: model.contextWindow, reserve: session.settingsManager.getCompactionSettings(model).reserveTokens };
}

async function prompt(session: AgentSession, text: string) {
	const starts: string[] = [];
	const ends: Extract<AgentSessionEvent, { type: "compaction_end" }>[] = [];
	const unsubscribe = session.subscribe((event) => {
		if (event.type === "compaction_start") starts.push(event.reason);
		if (event.type === "compaction_end") ends.push(event);
	});
	try { await session.prompt(text); await session.waitForIdle(); }
	finally { unsubscribe(); }
	return { starts, ends };
}

for (const [entry, pi] of ENTRIES) {
	describe(`${entry}: context state first-read regressions`, () => {
		for (const [label, read] of READERS) {
			it(`${label} first after owner arrival, off and re-enable; setModel(current) restores the exact original`, async () => {
				const observer = await open(pi);
				const owner = await open(pi, true);
				const sessions = [observer.session, owner.session];
				try {
					// No read of this observer, not even session.model, has happened since the owner arrived.
					assert.deepEqual(values(observer.session, read), CAPPED);
					const capped = read(observer.session);
					await observer.session.setModel(capped);
					assert.equal(read(observer.session), capped);
					assert.equal(observer.declared.contextWindow, 1_000_000, "a retained declared MODEL remains unchanged by design");
					assert.equal(observer.runtime.getModel("state-test", "big"), observer.declared);
					await owner.select(false);
					await owner.session.reload();
					assert.deepEqual(values(observer.session, read), STOCK);
					assert.equal(read(observer.session), observer.declared);
					const gap = await open(pi);
					sessions.push(gap.session);
					await owner.select(true);
					await owner.session.reload();
					assert.deepEqual(values(gap.session, read), CAPPED, "first read of a state created during off");
					assert.equal(read(observer.session), capped);
					await gap.session.setModel(read(gap.session));
					await shutdown(owner.session);
					assert.equal(read(observer.session), observer.declared);
					assert.equal(read(gap.session), gap.declared);
					assert.deepEqual(values(gap.session, read), STOCK);
				} finally { for (const session of sessions) await shutdown(session); }
			});

			it(`${label} first after a direct public state.model replacement to 2M`, async () => {
				const observer = await open(pi);
				const owner = await open(pi, true);
				try {
					const replacement = Object.freeze({ ...observer.declared, contextWindow: 2_000_000 });
					observer.session.state.model = replacement;
					assert.deepEqual(values(observer.session, read), CAPPED);
					const capped = read(observer.session);
					await observer.session.setModel(capped);
					assert.equal(read(observer.session), capped);
					await owner.select(false);
					await owner.session.reload();
					assert.equal(read(observer.session), replacement);
					assert.deepEqual(values(observer.session, read), { window: 2_000_000, reserve: 16_384 });
					observer.session.agent.state.model = capped;
					assert.equal(read(observer.session), replacement, "retained capped copies unwrap even while off");
					await owner.select(true);
					await owner.session.reload();
					assert.equal(read(observer.session), capped);
					assert.equal(replacement.contextWindow, 2_000_000);
					assert.equal(observer.declared.contextWindow, 1_000_000);
				} finally { await shutdown(owner.session); await shutdown(observer.session); }
			});
		}


		it("native guards reject unsupported shapes before either native hook changes; off remains stock", async () => {
			const owner = await open(pi, true);
			type Build = { _buildRuntime(this: { agent: unknown }): unknown };
			const build = (pi.AgentSession.prototype as unknown as Build)._buildRuntime;
			try {
				for (const broken of ["state", "createLoopConfig", "model", "extensible"]) {
					class OtherAgent {
						_state = { model: owner.declared };
						get state() { return this._state; }
						createLoopConfig() { return { model: this._state.model }; }
					}
					const agent = new OtherAgent();
					if (broken === "state" || broken === "createLoopConfig") Reflect.deleteProperty(OtherAgent.prototype, broken);
					if (broken === "model") Object.defineProperty(agent._state, "model", { configurable: false });
					if (broken === "extensible") Object.preventExtensions(OtherAgent.prototype);
					const before = Object.getOwnPropertyDescriptors(OtherAgent.prototype);
					assert.throws(() => build.call({ agent }), /native Agent.state\/createLoopConfig shape differs from Pi 1.3.0/);
					assert.deepEqual(Object.getOwnPropertyDescriptors(OtherAgent.prototype), before);
				}
				await owner.select(false);
				await owner.session.reload();
				// No owner: even a non-native host agent must pass directly to Pi's original build hook.
				const host = { agent: {} };
				const original = (pi.AgentSession.prototype as unknown as Record<symbol, (...args: unknown[]) => unknown>)[Symbol.for("rqw-context/_buildRuntime")];
				let nativeError: unknown;
				let wrappedError: unknown;
				try { original.call(host); } catch (error) { nativeError = error; }
				try { build.call(host); } catch (error) { wrappedError = error; }
				assert.ok(nativeError instanceof Error && wrappedError instanceof Error);
				assert.equal(wrappedError.message, nativeError.message);
			} finally { await shutdown(owner.session); }
		});

		it("actual threshold and overflow paths on old observers after owner arrival and off/re-enable", async () => {
			const owner = await open(pi);
			try {
				for (const phase of ["arrival", "off", "re-enable"]) {
					// Observers exist before each ownership transition; neither is reloaded or primed by a model read.
					const threshold = await open(pi);
					const overflow = await open(pi);
					try {
						const on = phase !== "off";
						await owner.select(on);
						await owner.session.reload();
						for (const fixture of [threshold, overflow]) {
							fixture.script.next = [1_000];
							assert.deepEqual((await prompt(fixture.session, "seed")).starts, []);
							fixture.script.requests = [];
						}
						threshold.script.next = [450_001];
						const compacted = await prompt(threshold.session, "threshold");
						assert.deepEqual(compacted.starts, on ? ["threshold"] : [], phase);
						overflow.script.next = [500_001];
						const recovered = await prompt(overflow.session, "overflow");
						assert.deepEqual(recovered.starts, on ? ["overflow"] : [], phase);
						for (const result of [compacted, recovered]) {
							for (const end of result.ends) { assert.ok(end.result); assert.equal(end.errorMessage, undefined); assert.equal(end.willRetry, false); }
						}
						for (const fixture of [threshold, overflow]) {
							assert.deepEqual(fixture.script.requests.map((request) => request.window), on ? [500_000, 500_000, 500_000] : [1_000_000]);
							assert.deepEqual(fixture.script.requests.slice(1).map((request) => request.maxTokens), on ? [40_000, 25_000] : []);
							assert.equal(fixture.session.getContextUsage()?.contextWindow, on ? 500_000 : 1_000_000);
						}
					} finally { await shutdown(threshold.session); await shutdown(overflow.session); }
				}
			} finally { await shutdown(owner.session); }
		});

		it("actual output-cap path on an old observer at owner arrival, off and re-enable", async () => {
			const observer = await open(pi, false, true);
			observer.session.settingsManager.setCompactionEnabled(false);
			const owner = await open(pi);
			try {
				for (const on of [true, false, true]) {
					await owner.select(on);
					await owner.session.reload();
					httpState.tokens = 480_000;
					assert.deepEqual((await prompt(observer.session, "seed")).starts, []);
					httpState.caps = [];
					assert.deepEqual((await prompt(observer.session, "next")).starts, []);
					assert.equal(httpState.caps.length, 1);
					if (on) assert.ok(httpState.caps[0] >= 15_890 && httpState.caps[0] <= 15_904, `capped output ${httpState.caps[0]}`);
					else assert.equal(httpState.caps[0], 128_000);
					assert.equal(observer.session.getContextUsage()?.contextWindow, on ? 500_000 : 1_000_000);
				}
			} finally { await shutdown(owner.session); await shutdown(observer.session); }
		});
	});
}
