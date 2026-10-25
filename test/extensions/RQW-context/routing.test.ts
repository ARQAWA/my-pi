// Real Pi 1.4.0 library and CLI runtime, native routing/compaction, only synthetic providers and fake auth.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createProvider, createAssistantMessageEventStream, type AssistantMessage, type Model } from "@earendil-works/pi-ai";
import * as library from "@earendil-works/pi-coding-agent";
import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";

// Use the actual native options builder rather than duplicating its context/output formula.
const { buildBaseOptions } = await import(new URL("./api/simple-options.js", import.meta.resolve("@earendil-works/pi-ai")).href);
const bundle: typeof library = await import(new URL("./bundle/index.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href);
const ENTRIES: [string, typeof library][] = [["library", library], ["bundle", bundle]];
const EXTENSION = join(dirname(fileURLToPath(import.meta.url)), "../../../extensions/RQW-context", "index.ts");
const NO_RESOURCES = { noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true };
let root: string;
let counter = 0;
before(async () => { root = await mkdtemp(join(tmpdir(), "rqw-context-routing-")); });
after(async () => { await rm(root, { recursive: true, force: true }); });

type Reply = number | { input: number; stopReason: "length" | "stop" | "toolUse"; output?: number;
	toolCall?: { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> } };
type Request = { id: string; window: number; supplied?: number; maxTokens: number; input: number; reasoning?: string };
type RouteRequest = Parameters<Parameters<library.ModelRuntime["registerVirtualModel"]>[0]["route"]>[0];
type Script = {
	tag: string; next: Reply[]; requests: Request[]; routes: RouteRequest[];
	target: string; summaryTarget?: string; routeGate?: (request: RouteRequest) => Promise<void>;
	beforeCompact?: (settings: { reserveTokens: number }) => Promise<void>;
};
type Host = { runtime: library.ModelRuntime; scripts: Script[] };

async function host(pi: typeof library): Promise<Host> {
	const dir = join(root, `runtime-${counter++}`);
	await mkdir(dir);
	const scripts: Script[] = [];
	const reply = (model: Model<string>, context: unknown, options?: { maxTokens?: number; reasoning?: string }) => {
		const script = scripts.find((s) => JSON.stringify(context).includes(s.tag));
		assert.ok(script, "request belongs to one fixture, including summaries");
		const entry = script.next.shift() ?? 0;
		const { input, stopReason = "stop", output = 0, toolCall } = typeof entry === "number" ? { input: entry } : entry;
		const base = buildBaseOptions(model, context, options);
		script.requests.push({ id: model.id, window: model.contextWindow, supplied: options?.maxTokens,
			maxTokens: base.maxTokens, input, reasoning: options?.reasoning });
		const message: AssistantMessage = {
			role: "assistant", content: toolCall ? [toolCall] : [{ type: "text", text: `${script.tag} ok` }],
			api: model.api, provider: model.provider, model: model.id,
			usage: { input, output, cacheRead: 0, cacheWrite: 0, totalTokens: input + output,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			stopReason, timestamp: Date.now(),
		};
		const stream = createAssistantMessageEventStream();
		queueMicrotask(() => {
			stream.push({ type: "start", partial: message });
			stream.push({ type: "done", reason: stopReason, message }); stream.end(message);
		});
		return stream;
	};
	const runtime = await pi.ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
	runtime.registerNativeProvider(createProvider({
		id: "routing-test", auth: { apiKey: { name: "Fake", resolve: async () => ({ auth: { apiKey: "synthetic-only" } }) } },
		models: [["small", 272_000], ["big", 1_000_000]].map(([id, contextWindow]) => ({
			id, name: id, provider: "routing-test", api: "routing-test", baseUrl: "http://127.0.0.1:0",
			reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow, maxTokens: 128_000,
		})), api: { stream: reply, streamSimple: reply },
	} as Parameters<typeof createProvider>[0]));
	await runtime.refresh({ allowNetwork: false });
	for (const id of ["small", "big"]) Object.freeze(runtime.getModel("routing-test", id)!);
	return { runtime, scripts };
}

type Open = { owner?: boolean; window?: number; target?: string; settings?: object; manager?: library.SettingsManager; host?: Host; intercept?: "cancel" | "custom" };
async function open(pi: typeof library, options: Open = {}) {
	const shared = options.host ?? await host(pi);
	const { runtime, scripts } = shared;
	const dir = join(root, `session-${counter++}`);
	await mkdir(dir);
	const script: Script = { tag: `<fixture:${counter}>`, next: [], requests: [], routes: [], target: options.target ?? "big" };
	scripts.push(script);
	const preparations: number[] = [];
	const loader = new pi.DefaultResourceLoader({ cwd: dir, agentDir: dir, ...NO_RESOURCES,
		additionalExtensionPaths: options.owner === false ? [] : [EXTENSION],
		extensionFactories: [(api) => {
			api.on("session_before_compact", async (event) => {
				preparations.push(event.preparation.settings.reserveTokens);
				await script.beforeCompact?.(event.preparation.settings);
				if (options.intercept === "cancel") return { cancel: true };
				if (options.intercept === "custom") return { compaction: {
					summary: "extension summary", firstKeptEntryId: event.preparation.firstKeptEntryId,
					tokensBefore: event.preparation.tokensBefore,
				} };
			});
			api.registerVirtualModel({
			provider: "routing", id: "auto", name: "Auto", thinkingLevels: ["off", "low", "high"],
			...(options.window === undefined ? {} : { contextWindow: options.window }),
			async route(request) {
				const current = scripts.find((s) => JSON.stringify(request.messages).includes(s.tag)) ?? script;
				current.routes.push(request);
				const id = request.reason === "direct" ? current.summaryTarget ?? current.target : current.target;
				await current.routeGate?.(request);
				// Native resolveModel must canonicalize this misleading copy before the physical cap is applied.
				return { model: { ...runtime.getModel("routing-test", id)!, contextWindow: 17 },
					thinkingLevel: "high", state: { count: ((request.state as { count: number } | undefined)?.count ?? 0) + 1 } };
			},
		}); }],
	});
	await loader.reload();
	assert.deepEqual(loader.getExtensions().errors, []);
	const { session } = await pi.createAgentSession({ cwd: dir, agentDir: dir, modelRuntime: runtime,
		model: runtime.getModel("routing-test", "small")!, thinkingLevel: "low", resourceLoader: loader,
		sessionManager: pi.SessionManager.inMemory(dir),
		settingsManager: options.manager ?? pi.SettingsManager.inMemory({ retry: { enabled: false },
			compaction: { keepRecentTokens: 0 }, ...options.settings }),
	});
	await session.bindExtensions({});
	const selection = runtime.getModel("routing", "auto")!;
	await session.setModel(selection);
	session.setThinkingLevel("low");
	const starts: string[] = [];
	const ends: Extract<AgentSessionEvent, { type: "compaction_end" }>[] = [];
	session.subscribe((event) => {
		if (event.type === "compaction_start") starts.push(event.reason);
		if (event.type === "compaction_end") ends.push(event);
	});
	return { session, runtime, script, selection, starts, ends, preparations, shared,
		async prompt(reply: Reply, text = "go") {
			script.next = [reply]; starts.length = 0; ends.length = 0;
			await session.prompt(`${script.tag} ${text}`); await session.waitForIdle();
			const last = session.messages.at(-1) as AssistantMessage;
			assert.equal(last.stopReason, "stop");
			return [...starts];
		},
		async close() { await shutdown(session); },
	};
}
async function shutdown(session: AgentSession) {
	try { await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }); }
	finally { session.dispose(); }
}

type Internal = {
	_exceedsCompactionThreshold(model: unknown, projection: unknown): boolean;
	_modelForMessage(message: AssistantMessage): Model<string> | undefined;
	_runAutoCompaction(reason: string, retry: boolean): Promise<boolean>;
	_checkCompaction(message: AssistantMessage): Promise<boolean>;
};

for (const [entry, pi] of ENTRIES) {
	describe(`${entry}: physical rules after native routing`, () => {
		it("unsupported routed hooks fail atomically before acquiring ownership", async () => {
			for (const [proto, name] of [
				[pi.ModelRuntime.prototype, "getPhysicalModel"],
				[pi.SettingsManager.prototype, "getCompactionSettings"],
				[pi.AgentSession.prototype, "_buildRuntime"],
				...["_exceedsCompactionThreshold", "_checkCompaction", "_runAutoCompaction", "compact",
					"_modelForMessage", "_limitsModel"].map((name) => [pi.AgentSession.prototype, name]),
			] as [object, string][]) for (const shape of ["missing", "readonly"]) {
				const before = [pi.SettingsManager.prototype.getCompactionSettings,
					(pi.AgentSession.prototype as unknown as Record<string, unknown>)._buildRuntime,
					pi.ModelRuntime.prototype.getPhysicalModel];
				const descriptor = Object.getOwnPropertyDescriptor(proto, name)!;
				if (shape === "missing") Reflect.deleteProperty(proto, name);
				else Object.defineProperty(proto, name, { ...descriptor, writable: false });
				try {
					const dir = join(root, `guard-${counter++}`); await mkdir(dir);
					const loader = new pi.DefaultResourceLoader({ cwd: dir, agentDir: dir, ...NO_RESOURCES,
						additionalExtensionPaths: [EXTENSION] });
					await loader.reload();
					const errors = loader.getExtensions().errors;
					assert.equal(errors.length, 1); assert.ok(errors[0].error.includes(name));
					assert.match(errors[0].error, /nothing is changed/);
					assert.equal((globalThis as Record<symbol, Set<object>>)[Symbol.for("rqw-context/owner")]?.size ?? 0, 0);
					if (name !== "getCompactionSettings") assert.equal(pi.SettingsManager.prototype.getCompactionSettings, before[0]);
					if (name !== "_buildRuntime") assert.equal((pi.AgentSession.prototype as unknown as Record<string, unknown>)._buildRuntime, before[1]);
					if (name !== "getPhysicalModel") assert.equal(pi.ModelRuntime.prototype.getPhysicalModel, before[2]);
				} finally { Object.defineProperty(proto, name, descriptor); }
			}
		});
		for (const window of [0, 2_000_000]) {
			for (const [target, w, r] of [["small", 272_000, 27_200], ["big", 500_000, 50_000]] as const) {
				it(`selection ${window}, physical ${target}: exact threshold ${w - r}, then +1; preparation and summaries`, async () => {
					const exact = await open(pi, { window, target });
					try {
						assert.deepEqual(await exact.prompt(1_000), []);
						assert.deepEqual(await exact.prompt(w - r), []);
						assert.deepEqual(exact.session.getContextUsage(), { tokens: w - r, contextWindow: w, percent: 90 });
					} finally { await exact.close(); }
					const f = await open(pi, { window, target });
					try {
						assert.equal(f.session.model, f.selection);
						assert.equal(f.session.model.contextWindow, window);
						if (!window) assert.equal(f.session.getContextUsage(), undefined);
						assert.equal(f.session.settingsManager.getCompactionSettings(f.selection).reserveTokens, 16_384,
							"no physical request scope: never infer a reserve from the wrapper");
						assert.deepEqual(await f.prompt(1_000), []);
						f.script.requests = [];
						assert.deepEqual(await f.prompt(w - r + 1), ["threshold"]);
						assert.deepEqual(f.script.requests.map((q) => q.window), [w, w, w]);
						assert.deepEqual(f.script.requests.slice(1).map((q) => q.supplied), [undefined, undefined], "Pi 1.4 summaries carry no explicit maxTokens");
						assert.deepEqual(f.script.requests.slice(1).map((q) => q.maxTokens), [128_000, 128_000], "native model output limit");
						assert.deepEqual(f.preparations, [r]);
						assert.ok(f.ends[0].result); assert.equal(f.ends[0].errorMessage, undefined);
						assert.equal(f.session.model, f.selection); assert.equal(f.session.thinkingLevel, "low");
						assert.equal(f.script.routes.filter((q) => q.reason === "user").length, 2);
						assert.equal(f.script.routes.filter((q) => q.reason === "direct").length, 1);
						assert.equal(f.runtime.getModel("routing-test", "big")!.contextWindow, 1_000_000);
					} finally { await f.close(); }
				});
			}
		}

		it("pre-request uses THIS route, not the last successful response, at exact threshold/+1", async () => {
			for (const target of ["small", "big"]) for (const extra of [0, 1]) {
				const f = await open(pi);
				const threshold = target === "small" ? 244_800 : 450_000;
				const reserve = target === "small" ? 27_200 : 50_000;
				try {
					assert.deepEqual(await f.prompt(threshold - Math.ceil(`${f.script.tag} next`.length / 4) + extra), []);
					assert.equal(f.session.routedModel?.model.id, "big");
					f.script.target = target;
					f.script.requests = [];
					assert.deepEqual(await f.prompt(1_000, "next"), extra ? ["threshold"] : []);
					assert.equal(f.script.requests.at(-1)?.id, target, "chosen route stands after compaction");
					assert.equal(f.script.routes.filter((q) => q.reason === "user").length, 2, "no reroute for limits");
					assert.deepEqual(f.script.requests.slice(0, -1).map((q) => q.supplied), extra ? [undefined] : []);
					assert.deepEqual(f.preparations, extra ? [reserve] : []);
				} finally { await f.close(); }
			}
		});

		it("canonical direct SDK route, stable copies, native selection/state/thinking and message identities", async () => {
			const f = await open(pi);
			try {
				const route = await f.runtime.resolveModel(f.selection, [], { reason: "direct", thinkingLevel: "low" });
				assert.equal(route.model.contextWindow, 500_000);
				assert.equal(route.model, f.runtime.getPhysicalModel("routing-test", "big"));
				assert.notEqual(route.model, f.runtime.getModel("routing-test", "big"));
				assert.equal(route.thinkingLevel, "high");
				f.script.routes = [];
				for (const id of ["big", "small", "big"]) {
					f.script.target = id;
					assert.deepEqual(await f.prompt(2_000), []);
					const last = f.session.messages.at(-1) as AssistantMessage;
					assert.equal(last.model, id); assert.equal(last.thinkingLevel, "high");
					assert.equal(f.session.model, f.selection); assert.equal(f.session.thinkingLevel, "low");
				}
				assert.deepEqual(f.script.routes.map((q) => q.state), [undefined, { count: 1 }, { count: 2 }]);
				assert.deepEqual(f.script.routes.map((q) => q.previous?.model.id), [undefined, "big", "small"]);
				assert.ok(f.script.routes.every((q) => q.model === f.selection && q.thinkingLevel === "low"));
				const response = await f.runtime.completeSimple(f.selection,
					{ messages: [{ role: "user", content: f.script.tag, timestamp: 0 },
						{ ...f.session.messages.at(-1), usage: { input: 450_000, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 450_000 } }] },
					{ maxTokens: 80_000, reasoning: "low" });
				assert.equal(response.model, "big");
				assert.equal(f.script.requests.at(-1)?.window, 500_000);
				assert.equal(f.script.requests.at(-1)?.supplied, 80_000);
				assert.ok(f.script.requests.at(-1)!.maxTokens >= 45_880 && f.script.requests.at(-1)!.maxTokens <= 45_904);
				assert.equal(f.script.routes.at(-1)?.reason, "direct");
			} finally { await f.close(); }
		});

		for (const mode of ["manual", "automatic"] as const) for (const timing of ["pending direct route", "before compact hook"] as const) {
			it(`${mode} summary freezes its selection across a model switch in ${timing}`, async () => {
				const f = await open(pi);
				const other = await open(pi, { host: f.shared, owner: false, target: "small" });
				const entered = Promise.withResolvers<RouteRequest>();
				const release = Promise.withResolvers<void>();
				let operation: Promise<unknown> | undefined;
				let hookSettings: { reserveTokens: number } | undefined;
				try {
					await f.prompt(1_000); await f.prompt(2_000);
					assert.equal(f.session.routedModel?.model.id, "big");
					assert.deepEqual(f.script.routes.map((q) => q.model), [f.selection, f.selection]);
					f.script.summaryTarget = "small";
					f.script.requests = [];
					const switchSelection = async () => {
						await f.session.setModel(f.runtime.getModel("routing-test", "big")!);
						assert.equal(f.session.agent.state.model.contextWindow, 500_000);
						// Other requests on the shared runtime must not supply this summary's reserve.
						await other.prompt(1_000);
						other.script.target = "big";
						const unrelated = await f.runtime.resolveModel(other.selection,
							[{ role: "user", content: other.script.tag, timestamp: 0 }], { reason: "direct" });
						assert.equal(unrelated.model.contextWindow, 500_000);
					};
					f.script.beforeCompact = async (settings) => {
						hookSettings = settings;
						if (timing === "before compact hook") await switchSelection();
					};
					if (timing === "pending direct route") f.script.routeGate = async (request) => {
						if (request.reason !== "direct") return;
						entered.resolve(request); await release.promise;
					};
					operation = mode === "manual" ? f.session.compact() : f.prompt(450_001);
					if (timing === "pending direct route") {
						assert.equal((await entered.promise).model, f.selection);
						await switchSelection();
						// Changing routing policy does not replace the target already chosen by this operation.
						f.script.summaryTarget = "big";
						release.resolve();
					}
					await operation;
					const summaries = f.script.requests.slice(mode === "manual" ? 0 : 1);
					assert.deepEqual(summaries.map((q) => q.supplied), [undefined, undefined]);
					assert.deepEqual(summaries.map((q) => q.maxTokens), [128_000, 128_000], "native model output limit, not R");
					assert.deepEqual(summaries.map((q) => [q.id, q.window]), [["small", 272_000], ["small", 272_000]]);
					assert.deepEqual(f.preparations, [50_000]);
					assert.equal(hookSettings?.reserveTokens, 50_000, "interception preparation is not rewritten");
					const direct = f.script.routes.filter((q) => q.reason === "direct");
					assert.equal(direct.length, 1); assert.equal(direct[0].model, f.selection);
					assert.equal(f.session.model?.id, "big", "the native selection switch stands");
					assert.equal(f.session.agent.state.model.contextWindow, 500_000);
					assert.ok(f.session.getContextUsage()!.contextWindow <= 500_000);
					assert.ok(f.script.requests.every((q) => q.window <= 500_000));
					assert.ok(f.ends[0].result); assert.equal(f.ends[0].errorMessage, undefined);
				} finally {
					release.resolve();
					await operation?.catch(() => {});
					await other.close(); await f.close();
				}
			});
		}

		for (const [target, selected, usage, compact] of [
			["small", "big", 230_000, false], ["big", "small", 460_000, true],
		] as const) {
			it(`235 F1: ordinary route to ${target} retains its reserve after selecting physical ${selected}`, async () => {
				const f = await open(pi, { settings: { compaction: { enabled: false, keepRecentTokens: 0 } } });
				const entered = Promise.withResolvers<void>();
				const release = Promise.withResolvers<void>();
				let operation: Promise<unknown> | undefined;
				try {
					await f.prompt(usage);
					f.script.target = target; f.script.requests = [];
					f.script.routeGate = async (request) => {
						if (request.reason !== "user") return;
						entered.resolve(); await release.promise;
					};
					operation = f.prompt(1_000);
					await entered.promise;
					f.session.settingsManager.setCompactionEnabled(true);
					await f.session.setModel(f.runtime.getModel("routing-test", selected)!);
					const liveReserve = selected === "big" ? 50_000 : 27_200;
					assert.equal(f.session.settingsManager.getCompactionSettings(f.session.model).reserveTokens, liveReserve);
					release.resolve(); await operation;
					assert.deepEqual(f.starts, compact ? ["threshold"] : []);
					assert.deepEqual(f.preparations, compact ? [50_000] : []);
					assert.equal(f.script.requests.at(-1)?.id, target, "the ordinary route still stands");
					assert.equal(f.script.routes.filter((q) => q.reason === "user").length, 2);
					assert.equal(f.script.routes.filter((q) => q.reason === "direct").length, 0,
						"physical summary selections do not add virtual routes");
					assert.equal(f.session.model?.id, selected);
					assert.equal(f.session.settingsManager.getCompactionSettings(f.session.model).reserveTokens, liveReserve,
						"physical operation limits must not leak to later settings reads");
					assert.ok(f.script.requests.every((q) => q.window <= 500_000));
				} finally {
					release.resolve(); await operation?.catch(() => {}); await f.close();
				}
			});
		}

		it("native buildBaseOptions output cap and usage with automatic compaction disabled", async () => {
			const f = await open(pi, { settings: { compaction: { enabled: false, keepRecentTokens: 0 } } });
			try {
				for (const usage of [450_000, 480_000, 497_000, 520_001, 1]) assert.deepEqual(await f.prompt(usage), []);
				const caps = f.script.requests.map((q) => q.maxTokens);
				assert.equal(caps[0], 128_000);
				assert.ok(caps[1] >= 45_880 && caps[1] <= 45_904, `native output cap ${caps[1]}`);
				assert.ok(caps[2] >= 15_880 && caps[2] <= 15_904, `native output cap ${caps[2]}`);
				assert.deepEqual(caps.slice(3), [1, 1]);
				assert.ok(f.script.requests.every((q) => q.window === 500_000));
				assert.equal(f.session.getContextUsage()?.contextWindow, 500_000);
				assert.equal(f.session.model?.contextWindow, 0);
			} finally { await f.close(); }
		});

		it("routed silent and length overflow keep native recovery and retry policy", async () => {
			for (const length of [false, true]) {
				const f = await open(pi);
				try {
					assert.deepEqual(await f.prompt(1_000), []);
					f.script.requests = [];
					f.script.next = length ? [{ input: 495_000, stopReason: "length" }, 0, 0, 3_000] : [520_001];
					await f.session.prompt(`${f.script.tag} overflow`); await f.session.waitForIdle();
					assert.deepEqual(f.starts, ["overflow"]);
					assert.equal(f.ends[0].willRetry, length); assert.equal(f.ends[0].errorMessage, undefined);
					assert.deepEqual(f.script.requests.slice(1, 3).map((q) => q.supplied), [undefined, undefined]);
					assert.ok(f.script.requests.every((q) => q.window === 500_000));
					assert.equal(f.script.routes.filter((q) => q.reason === "retry").length, length ? 1 : 0);
					assert.equal(f.script.routes.filter((q) => q.reason === "direct").length, 1);
					assert.equal(f.session.model, f.selection);
				} finally { await f.close(); }
			}
		});

		it("manual compaction-end queued prompt continues after a successful tool call", async () => {
			const f = await open(pi);
			let queued: Promise<void> | undefined;
			let unsubscribe = () => {};
			try {
				await f.session.setModel(f.runtime.getModel("routing-test", "big")!);
				await f.prompt(1_000); await f.prompt(2_000);
				unsubscribe = f.session.subscribe((event) => {
					if (event.type !== "compaction_end" || event.reason !== "manual" || !event.result) return;
					assert.equal(f.session.isCompacting, false);
					f.script.requests = [];
					f.script.next = [{ input: 3_000, stopReason: "toolUse", toolCall: {
						type: "toolCall", id: "read-after-compact", name: "read", arguments: { path: EXTENSION, limit: 1 },
					} }, 4_000];
					queued = f.session.prompt(`${f.script.tag} queued during compaction`);
				});
				await f.session.compact();
				assert.ok(queued, "native compaction_end dispatch starts the queued prompt");
				await queued; await f.session.waitForIdle();
				const tool = f.session.messages.find((m) => m.role === "toolResult" && m.toolCallId === "read-after-compact");
				assert.ok(tool && tool.role === "toolResult" && !tool.isError, "tool succeeds before the next threshold check");
				const last = f.session.messages.at(-1) as AssistantMessage;
				assert.equal(last.stopReason, "stop", last.errorMessage);
				assert.equal(last.errorMessage, undefined);
				assert.deepEqual(f.script.requests.map((q) => q.window), [500_000, 500_000]);
				assert.deepEqual(f.preparations, [50_000]);
			} finally { unsubscribe(); await f.close(); }
		});

		it("manual summary routes once and both requests use its chosen physical model", async () => {
			for (const [chat, summary] of [["big", "small"], ["small", "big"]] as const) {
				const f = await open(pi, { target: chat });
				try {
					await f.prompt(1_000); await f.prompt(2_000);
					f.script.summaryTarget = summary; f.script.requests = [];
					await f.session.compact();
					assert.deepEqual(f.preparations, [chat === "big" ? 50_000 : 27_200]);
					assert.deepEqual(f.script.requests.map((q) => q.supplied), [undefined, undefined]);
					assert.deepEqual(f.script.requests.map((q) => q.maxTokens), [128_000, 128_000]);
					assert.ok(f.script.requests.every((q) => q.id === summary && q.window === (summary === "big" ? 500_000 : 272_000)));
					assert.equal(f.script.routes.filter((q) => q.reason === "direct").length, 1);
				} finally { await f.close(); }
			}
		});
	});
}

for (const [entry, pi] of ENTRIES) {
	describe(`${entry}: routed isolation, policy and lifecycle`, () => {
		it("parallel sessions share a runtime and selection, not physical reserve or summary routes", async () => {
			const shared = await host(pi);
			const a = await open(pi, { host: shared, target: "big" });
			const b = await open(pi, { host: shared, target: "small", owner: false });
			try {
				let arrived = 0;
				let barrier = Promise.withResolvers<void>();
				const gate = async () => {
					const current = barrier;
					if (++arrived % 2 === 0) { barrier = Promise.withResolvers<void>(); current.resolve(); }
					await current.promise;
				};
				a.script.routeGate = b.script.routeGate = gate;
				await Promise.all([a.prompt(1_000), b.prompt(1_000)]);
				a.script.summaryTarget = "small"; b.script.summaryTarget = "big";
				a.script.requests = []; b.script.requests = [];
				assert.deepEqual(await Promise.all([a.prompt(450_001), b.prompt(244_801)]), [["threshold"], ["threshold"]]);
				assert.deepEqual(a.preparations, [50_000]); assert.deepEqual(b.preparations, [27_200]);
				assert.deepEqual(a.script.requests.map((q) => q.window), [500_000, 272_000, 272_000]);
				assert.deepEqual(b.script.requests.map((q) => q.window), [272_000, 500_000, 500_000]);
				for (const f of [a, b]) assert.deepEqual(f.script.requests.slice(1).map((q) => q.supplied), [undefined, undefined]);
				for (const f of [a, b]) assert.equal(f.script.routes.length, 3);
			} finally { await a.close(); await b.close(); }
		});

		it("post-response check takes its message's physical model, not a newer routed response", async () => {
			const f = await open(pi, { target: "small", settings: { compaction: { enabled: false, keepRecentTokens: 0 } } });
			try {
				await f.prompt(244_801);
				const previous = f.session.messages.at(-1) as AssistantMessage;
				f.script.target = "big"; await f.prompt(1_000);
				assert.equal(f.session.routedModel?.model.id, "big");
				const internals = f.session as unknown as Internal;
				assert.equal(internals._modelForMessage(previous)?.contextWindow, 272_000);
				f.session.settingsManager.setCompactionEnabled(true);
				f.script.requests = [];
				await internals._checkCompaction(previous);
				assert.deepEqual(f.starts, ["threshold"]);
				assert.deepEqual(f.preparations, [27_200]);
				assert.deepEqual(f.script.requests.map((q) => q.supplied), [undefined, undefined]);
			} finally { await f.close(); }
		});

		it("explicit selection reserve keeps native override priority, including zero and invalid-for-W fallback", async () => {
			for (const [target, w, explicit, reserve] of [
				["big", 500_000, 20_000, 20_000], ["small", 272_000, 20_000, 20_000],
				["big", 500_000, 0, 0], ["small", 272_000, 600_000, 27_200],
			] as const) {
				const f = await open(pi, { target, settings: { compaction: { keepRecentTokens: 0, reserveTokens: 30_000,
					modelOverrides: { "routing/auto": { reserveTokens: explicit }, "routing-test/big": { reserveTokens: 10_000 } },
				} } });
				try {
					assert.deepEqual(await f.prompt(1_000), []);
					assert.deepEqual(await f.prompt(w - reserve), []);
					const projection = f.session.sessionManager.buildSessionProjection();
					const check = (f.session as unknown as Internal)._exceedsCompactionThreshold.bind(f.session);
					assert.equal(check(f.session.routedModel!.model, projection), false);
					f.session.sessionManager.appendMessage({ role: "user", content: "abcd", timestamp: 0 });
					assert.equal(check(f.session.routedModel!.model, f.session.sessionManager.buildSessionProjection()), true);
					// The native SDK validates settings by the selection key, not by the routed physical key.
					assert.equal(f.session.settingsManager.getCompactionSettings(f.selection).reserveTokens, explicit);
				} finally { await f.close(); }
			}
		});

		it("an explicit 300 000 reserve follows the chat model's window in the preparation; both summary calls use native maxTokens", async () => {
			for (const chat of ["small", "big"]) {
				const f = await open(pi, { target: chat, settings: { compaction: { keepRecentTokens: 0, reserveTokens: 300_000 } } });
				try {
					await f.prompt(1_000); await f.prompt(2_000);
					f.script.summaryTarget = chat === "big" ? "small" : "big";
					f.script.requests = [];
					await f.session.compact();
					assert.deepEqual(f.preparations, [chat === "big" ? 300_000 : 27_200]);
					assert.deepEqual(f.script.requests.map((q) => q.supplied), [undefined, undefined]);
					assert.deepEqual(f.script.requests.map((q) => q.maxTokens), [128_000, 128_000]);
					assert.equal(f.script.routes.filter((q) => q.reason === "direct").length, 1);
				} finally { await f.close(); }
			}
		});

		it("native cancellation and custom compaction do not resolve a summary route", async () => {
			for (const intercept of ["cancel", "custom"] as const) {
				const f = await open(pi, { intercept });
				try {
					await f.prompt(1_000);
					assert.deepEqual(await f.prompt(450_001), ["threshold"]);
					assert.deepEqual(f.preparations, [50_000]);
					assert.equal(f.script.routes.filter((q) => q.reason === "direct").length, 0);
					assert.equal(f.ends[0].aborted, intercept === "cancel");
					assert.equal(Boolean(f.ends[0].result), intercept === "custom");
				} finally { await f.close(); }
			}
		});

		it("old virtual observers, concurrent owners, last shutdown and re-enable restore physical stock identity", async () => {
			const observer = await open(pi, { owner: false });
			const a = await open(pi);
			const b = await open(pi);
			try {
				const raw = observer.runtime.getModel("routing-test", "big")!;
				const capped = observer.runtime.getPhysicalModel("routing-test", "big")!;
				assert.equal(capped.contextWindow, 500_000);
				assert.deepEqual(await observer.prompt(450_000), []);
				assert.equal(observer.session.getContextUsage()?.percent, 90);
				await a.close();
				assert.equal(observer.runtime.getPhysicalModel("routing-test", "big"), capped);
				await b.close();
				assert.equal(observer.runtime.getPhysicalModel("routing-test", "big"), raw);
				assert.equal(observer.session.routedModel?.model, raw);
				assert.equal(observer.session.getContextUsage()?.percent, 45);
				observer.script.requests = [];
				assert.deepEqual(await observer.prompt(450_001), []);
				assert.equal(observer.script.requests[0].window, 1_000_000);
				assert.equal(observer.script.requests[0].maxTokens, 128_000);
				const renewed = await open(pi);
				try {
					assert.equal(observer.runtime.getPhysicalModel("routing-test", "big"), capped);
					assert.deepEqual(await observer.prompt(1_000), ["threshold"]);
				} finally { await renewed.close(); }
				assert.equal(observer.runtime.getPhysicalModel("routing-test", "big"), raw);
				assert.equal(raw.contextWindow, 1_000_000);
				assert.equal(observer.session.model, observer.selection);
			} finally { await a.close(); await b.close(); await observer.close(); }
		});
	});
}
