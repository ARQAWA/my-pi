import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { InMemoryCredentialStore, type Model } from "@earendil-works/pi-ai";
import { AgentSession, ModelRuntime, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import extension, { FAMILIES, familyOf, isListed, levelsFor, pickerModels } from "../../../extensions/RQW-models/index.ts";
import { ModelEffortPicker, stepDraft, type PickerSpec } from "../../../extensions/RQW-models/picker.ts";

const model = (id: string, provider = "anthropic"): Model<string> => ({
	id, provider, api: "test", name: id, baseUrl: "https://invalid.test", reasoning: true, input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128_000, maxTokens: 8_000,
	thinkingLevelMap: { xhigh: "xhigh", max: "max" },
});

describe("RQW-models public selection", () => {
	it("renders the statusbar's human names without changing model identity", () => {
		const models: Model<string>[] = [
			{ ...model("claude-opus-5-5"), name: "Claude Opus 5.5" },
			{ ...model("gpt-6.1-sol", "openai-codex"), name: "GPT-6.1 Sol" },
			{ ...model("claude-sonnet-5-5"), name: "Claude Sonnet 5.5" },
		];
		const spec: PickerSpec = { models, family: m => models.indexOf(m), rank: () => 0,
			levels: () => ["low"], nearest: () => "low" };
		const theme = { fg: (_: string, text: string) => text, bold: (text: string) => text };
		let selected: unknown;
		const picker = new ModelEffortPicker(spec, { model: models[1], effort: "low" }, theme as any, result => { selected = result?.model; });
		const output = picker.render(100).join("\n");
		for (const label of ["Opus 5.5", "GPT-6.1 Sol", "Sonnet 5.5"]) assert.ok(output.includes(label));
		assert.ok(!output.includes("anthropic/") && !output.includes("openai-codex/") && !output.includes("Claude "));
		picker.handleInput("\r");
		assert.equal(selected, models[1]);
	});
	it("does not offer or list unlisted provider models", () => {
		const other = [model("other-model", "other-provider"), model("other-model-pro", "other-provider")];
		const opus = model("claude-opus-5-5");
		assert.deepEqual(pickerModels([...other, opus]), [opus]);
		for (const entry of other) assert.equal(isListed(entry), false);
	});
	it("resumes a saved Terra session from Pi's own catalog", async t => {
		// Real ModelRuntime with in-memory credentials; the session is a prototype-only stand-in the probe can find.
		const credentials = new InMemoryCredentialStore();
		for (const provider of ["anthropic", "openai-codex"]) await credentials.modify(provider, async () => ({ type: "api_key", key: "test" }));
		const runtime = await ModelRuntime.create({ credentials, modelsPath: null, refreshOnCreate: false });
		const sessionManager = { getBranch: () => [] };
		const session = Object.assign(Object.create(AgentSession.prototype), { sessionManager, _modelRuntime: runtime }) as AgentSession;
		const handlers = new Map<string, (event: any, ctx: any) => unknown>();
		const switches: string[] = [];
		// The extension switches either through pi.setModel or through the owning session's setModel.
		t.mock.method(AgentSession.prototype, "setModel", async (next: Model<string>) => { switches.push(next.id); });
		const pi = { registerShortcut() {}, registerCommand() {}, setModel: async (next: Model<string>) => { switches.push(next.id); return true; }, on: (name: string, handler: any) => { handlers.set(name, handler); return () => {}; } };
		extension(pi as unknown as ExtensionAPI);
		const ctx = { hasUI: false, sessionManager, isIdle: () => (session as any).isIdle, modelRegistry: { getAvailable: () => runtime.getAvailableSnapshot() }, model: undefined as Model<string> | undefined } as unknown as ExtensionContext & { model: unknown };
		t.after(() => handlers.get("session_shutdown")!({}, ctx));
		// Pi's service setup refreshes the runtime right after loading extensions; session creation then looks the saved model up.
		await runtime.refresh({ allowNetwork: false });
		const saved = runtime.getModel("openai-codex", "gpt-6.1-terra");
		assert.deepEqual([saved?.name, saved?.contextWindow], ["GPT-6.1 Terra", 500_000], "Pi's own catalog has the saved model");
		ctx.model = saved;
		await handlers.get("session_start")!({ type: "session_start", reason: "resume" }, ctx);
		assert.deepEqual(switches, [], "the listed Terra stays selected");
		assert.equal(ctx.model, saved);
		const catalog = runtime.getModels("openai-codex");
		assert.equal(catalog.filter(entry => entry.id === "gpt-6.1-terra").length, 1);
		assert.ok(pickerModels(catalog).some(entry => entry.id === "gpt-6.1-terra"));
		handlers.get("session_shutdown")!({}, ctx);
		assert.equal(runtime.getModel("openai-codex", "gpt-6.1-terra")?.contextWindow, 500_000);
	});
	for (const release of ["shutdown", "dispose"] as const) it(`preserves native Terra across resume, reload and ${release}`, async t => {
		const terra = {
			...model("gpt-6.1-terra", "openai-codex"),
			name: "GPT-6.1 Terra", contextWindow: 500_000, maxTokens: 128_000,
			thinkingLevelMap: { off: "none", minimal: "low", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" },
		} as Model<string>;
		const catalog = [model("gpt-6.1-sol", "openai-codex"), terra, model("gpt-6-sol", "openai-codex")];
		const transport = () => {};
		const provider = { getModels: () => catalog, streamSimple: transport };
		const prototype = ModelRuntime.prototype as any;
		t.mock.method(prototype, "composeProvider", () => provider);
		t.mock.method(AgentSession.prototype, "dispose", () => {});
		const compose = prototype.composeProvider;
		const runtime = Object.create(prototype) as ModelRuntime;
		const sessionManager = { getBranch: () => [] };
		const session = Object.assign(Object.create(AgentSession.prototype), { sessionManager, _modelRuntime: runtime }) as AgentSession;
		const handlers = new Map<string, (event: any, ctx: any) => unknown>();
		const pi = { registerShortcut() {}, registerCommand() {}, on: (name: string, handler: any) => { handlers.set(name, handler); return () => {}; } };
		extension(pi as unknown as ExtensionAPI);
		const ctx = { hasUI: false, sessionManager, isIdle: () => session.isIdle, model: terra } as unknown as ExtensionContext;
		const checkCatalog = () => {
			assert.equal(prototype.composeProvider, compose);
			const composed = (runtime as any).composeProvider("openai-codex");
			assert.equal(composed, provider);
			assert.equal(composed.streamSimple, transport);
			assert.deepEqual(pickerModels(composed.getModels()), catalog);
			assert.deepEqual(levelsFor(terra), ["low", "medium", "high", "xhigh", "max"]);
		};
		checkCatalog();
		await handlers.get("session_start")!({ reason: "resume" }, ctx);
		checkCatalog();
		await handlers.get("session_start")!({ reason: "reload" }, ctx);
		checkCatalog();
		if (release === "shutdown") handlers.get("session_shutdown")!({}, ctx);
		else session.dispose();
		checkCatalog();
		if (release === "dispose") handlers.get("session_shutdown")!({}, ctx);
	});
	it("lists each supported family once and steps the draft without wrapping", () => {
		const opus = model("claude-opus-5-5");
		const sonnet = model("claude-sonnet-5-5");
		const unknown = model("other");
		assert.deepEqual(pickerModels([unknown, sonnet, opus]), [opus, sonnet]);
		assert.equal(familyOf(model("us.anthropic.claude-opus-5-5-v1:0", "bedrock")), FAMILIES.indexOf("claude-opus-5-5"));
		assert.deepEqual(levelsFor(opus), ["low", "medium", "high", "xhigh", "max"]);
		assert.deepEqual(levelsFor(sonnet), ["low", "medium", "high", "xhigh", "max"]);
		const spec: PickerSpec = {
			models: [opus, sonnet], family: (m) => familyOf(m),
			rank: (level) => ["off", "minimal", "low", "medium", "high", "xhigh", "max"].indexOf(level),
			levels: levelsFor, nearest: (m, effort) => levelsFor(m).filter((level) => spec.rank(level) <= spec.rank(effort)).at(-1) ?? levelsFor(m)[0],
		};
		assert.deepEqual(stepDraft(spec, { model: opus, effort: "max" }, "down"), { model: sonnet, effort: "max" });
		assert.deepEqual(stepDraft(spec, { model: opus, effort: "high" }, "up"), { model: opus, effort: "high" });
		assert.equal(stepDraft(spec, { model: opus, effort: "max" }, "right").effort, "max");
	});

	it("renders efforts inline after the selected model, without labels or marker", () => {
		const models = [model("gpt-6.1-sol", "openai-codex"), model("claude-opus-5-5")];
		const levels = ["off", "low", "medium", "high", "xhigh", "max"];
		const spec: PickerSpec = { models, family: m => models.indexOf(m), rank: level => levels.indexOf(level),
			levels: () => levels, nearest: (_, effort) => effort };
		// Tagged theme: [role|text] and <b>text</b> make colour and bold visible in the rendered text.
		const theme = { fg: (role: string, text: string) => `[${role}|${text}]`, bold: (text: string) => `<b>${text}</b>` };
		let result: unknown = "open";
		const picker = new ModelEffortPicker(spec, { model: models[0], effort: "high" }, theme as any, value => { result = value; });
		// The tags count as columns, so the tagged render uses a wide terminal.
		{
			const lines = picker.render(300);
			assert.equal(lines[1], "", "one empty line after the title");
			assert.ok(!lines.some(line => /\|(Model|Effort)\]$/.test(line)), "no Model/Effort label lines");
			const row = lines.find(line => line.includes("gpt-6.1-sol"));
			assert.ok(row?.startsWith("[accent|› ]<b>[text|gpt-6.1-sol]</b> [dim|off] [dim|low] [dim|medium] <b>[thinkingHigh|high]</b> [dim|xhigh] [dim|max]"));
			assert.equal(lines.filter(line => line.includes("[dim|off]")).length, 1, "efforts only on the selected row");
			assert.ok(lines.find(line => line.includes("claude-opus-5-5"))?.startsWith("  [muted|claude-opus-5-5]"));
		}
		const plainTheme = { fg: (_: string, text: string) => text, bold: (text: string) => text };
		const narrow = new ModelEffortPicker(spec, { model: models[0], effort: "high" }, plainTheme as any, () => {});
		assert.ok(narrow.render(36).map(line => stripVTControlCharacters(line)).includes("› gpt… off low medium high xhigh max"));
		for (const width of [1, 10, 35]) assert.equal(narrow.render(width).join(""), "Effort needs 36 columns");
		picker.handleInput("\u001b[B");
		picker.handleInput("\u001b[C");
		const moved = picker.render(300).find(line => line.includes("claude-opus-5-5") && line.includes("[dim|off]"));
		assert.ok(moved?.includes("[dim|high] <b>[thinkingXhigh|xhigh]</b> [dim|max]"));
		picker.handleInput("\u001b");
		assert.equal(result, undefined);
	});

	// A held Shift turns the confirming Enter into Shift+Enter (Kitty CSI u, or xterm modifyOtherKeys); the chooser must still commit.
	const keys = [["Enter", "\r", false], ["Shift+Enter", "\u001b[13;2u", false], ["Shift+Enter (modifyOtherKeys)", "\u001b[27;2;13~", false], ["Esc", "\u001b", true]] as const;
	for (const [label, key, cancel] of keys) it(`${label} ${cancel ? "cancels" : "commits"} a changed model and effort through fake Pi`, async t => {
		const opus = model("claude-opus-5-5");
		const sonnet = model("claude-sonnet-5-5");
		let current = opus;
		let thinking = "high";
		const calls: string[] = [];
		const handlers = new Map<string, ((event: any, ctx: any) => void)[]>();
		const shortcuts = new Map<string, (ctx: any) => Promise<void>>();
		const pi = {
			registerProvider() {}, unregisterProvider() {}, registerCommand() {},
			registerShortcut: (key: string, options: any) => { shortcuts.set(key, options.handler); },
			on: (name: string, handler: any) => {
				const list = handlers.get(name) ?? [];
				list.push(handler);
				handlers.set(name, list);
				return () => { handlers.set(name, (handlers.get(name) ?? []).filter((item) => item !== handler)); };
			},
			getThinkingLevel: () => thinking,
			setThinkingLevel: (level: string) => { thinking = level; calls.push(`thinking:${level}`); },
			setModel: async (next: Model<string>) => {
				current = next;
				calls.push(`model:${next.id}`);
				for (const handler of handlers.get("model_select") ?? []) handler({ model: next }, ctx);
				return true;
			},
		};
		extension(pi as unknown as ExtensionAPI);
		const ctx = {
			get model() { return current; }, hasUI: true,
			modelRegistry: { getAvailable: () => [opus, sonnet] },
			sessionManager: { getBranch: () => [] }, isIdle: () => true,
			ui: {
				notify() {},
				custom(factory: any) {
					let component: any;
					let closed = false;
					const result = new Promise((resolve) => { component = factory({ requestRender() {} }, { fg: (_: string, text: string) => text, bold: (text: string) => text }, {}, (value: unknown) => { closed = true; resolve(value); }); });
					assert.ok(component.render(60).includes("› claude-sonnet-5-5 low medium high xhigh max"));
					component.handleInput("\u001b[C");
					component.handleInput(key);
					// A chooser that ignored the key would stay open for good; close it so the assertions below fail instead of hanging.
					if (!closed) component.cancel();
					return result;
				},
			},
		} as unknown as ExtensionContext;
		t.after(() => { for (const handler of handlers.get("session_shutdown") ?? []) handler({}, ctx); });
		for (const handler of handlers.get("session_start") ?? []) await handler({ reason: "resume" }, ctx);
		await shortcuts.get("shift+down")!(ctx);
		assert.equal(current, cancel ? opus : sonnet);
		assert.equal(thinking, cancel ? "high" : "xhigh");
		assert.deepEqual(calls, cancel ? [] : ["model:claude-sonnet-5-5", "thinking:xhigh"]);
	});

	describe("session model defaults", () => {
		const opus = model("claude-opus-5-5");
		const sonnet = model("claude-sonnet-5-5");
		const sol = model("gpt-6.1-sol", "openai-codex");
		// Pi builds an empty session from the saved default, here a Bedrock Opus 4.6 outside the list.
		const savedDefault = model("us.anthropic.claude-opus-4-6-v1", "bedrock");
		type Start = { current: Model<string>; available: Model<string>[]; thinking?: string; history?: boolean; recorded?: Model<string>; answeredBy?: Model<string> };
		const start = async (t: any, reason: string, options: Start) => {
			const handlers = new Map<string, (event: any, ctx: any) => Promise<void>>();
			let current = options.current;
			let thinking = options.thinking ?? "high";
			const notices: string[] = [];
			const pi = {
				registerProvider() {}, unregisterProvider() {}, registerShortcut() {}, registerCommand() {},
				on: (name: string, handler: any) => { handlers.set(name, handler); return () => {}; },
				getThinkingLevel: () => thinking,
				setThinkingLevel: (level: string) => { thinking = level; },
				setModel: async (next: Model<string>) => { current = next; return true; },
			};
			extension(pi as unknown as ExtensionAPI);
			// A session with history records its own model; an empty one only the saved default Pi built it from.
			const recorded = options.recorded ?? options.current;
			const entries = [{ type: "model_change", provider: recorded.provider, modelId: recorded.id }, ...(options.history ? [{ type: "message", message: { role: "user" } }] : []),
				...(options.answeredBy ? [{ type: "message", message: { role: "assistant", provider: options.answeredBy.provider, model: options.answeredBy.id } }] : [])];
			const ctx = {
				get model() { return current; }, hasUI: true,
				modelRegistry: { getAvailable: () => options.available },
				sessionManager: { getBranch: () => entries }, isIdle: () => true,
				ui: { notify: (text: string) => { notices.push(text); } },
			} as unknown as ExtensionContext;
			t.after(() => handlers.get("session_shutdown")!({}, ctx));
			await handlers.get("session_start")!({ type: "session_start", reason }, ctx);
			// The fake context cannot lend its session; every other notice counts.
			return { current, thinking, notices: notices.filter((text) => !text.startsWith("RQW-models cannot restrict Pi's own model selection")) };
		};

		it("gives every new session Opus medium, whatever the saved default is", async t => {
			for (const current of [savedDefault, sonnet, sol]) {
				for (const reason of ["startup", "new"]) {
					const result = await start(t, reason, { current, available: [savedDefault, sonnet, sol, opus] });
					assert.deepEqual([result.current, result.thinking], [opus, "medium"], `${reason} from ${current.id}`);
				}
			}
		});

		it("falls back to GPT-6.1 Sol medium when Opus is not available", async t => {
			for (const current of [savedDefault, sonnet]) {
				for (const reason of ["startup", "new"]) {
					const result = await start(t, reason, { current, available: [savedDefault, sonnet, sol] });
					assert.deepEqual([result.current, result.thinking], [sol, "medium"], `${reason} from ${current.id}`);
				}
			}
		});

		it("keeps a listed model when neither Opus nor Sol is available, and refuses an unlisted one", async t => {
			assert.equal((await start(t, "new", { current: sonnet, available: [sonnet] })).current, sonnet);
			const refused = await start(t, "new", { current: savedDefault, available: [sonnet] });
			assert.equal(refused.current, savedDefault);
			assert.equal(refused.notices.length, 1);
			assert.match(refused.notices[0], /requests are refused/);
		});

		it("replaces an unlisted model without a warning", async t => {
			// Pi's own provider default for anthropic without a saved default model.
			const piDefault = model("claude-opus-4-8");
			for (const [reason, history] of [["startup", false], ["startup", true], ["resume", true]] as const) {
				const result = await start(t, reason, { current: piDefault, available: [piDefault, sonnet, sol, opus], history });
				assert.deepEqual([result.current, result.thinking, result.notices], [opus, "medium", []], `${reason}, history ${history}`);
			}
		});

		it("keeps the model and thinking the session had on resume, fork, reload and startup with history", async t => {
			for (const reason of ["resume", "fork", "reload", "startup"]) {
				const result = await start(t, reason, { current: sonnet, available: [sonnet, sol, opus], history: true });
				assert.deepEqual([result.current, result.thinking], [sonnet, "high"], reason);
			}
		});

		it("uses the new-session default when the model of a resumed session is not listed", async t => {
			for (const reason of ["resume", "fork", "reload", "startup"]) {
				const withOpus = await start(t, reason, { current: savedDefault, available: [savedDefault, sonnet, sol, opus], history: true });
				assert.deepEqual([withOpus.current, withOpus.thinking], [opus, "medium"], reason);
				const withSol = await start(t, reason, { current: savedDefault, available: [savedDefault, sonnet, sol], history: true });
				assert.deepEqual([withSol.current, withSol.thinking], [sol, "medium"], reason);
			}
		});

		it("uses the new-session default when the last answer of the session came from an unlisted model", async t => {
			const result = await start(t, "resume", { current: sonnet, recorded: sonnet, answeredBy: savedDefault, available: [sonnet, sol, opus], history: true });
			assert.deepEqual([result.current, result.thinking], [opus, "medium"]);
		});

		it("uses the new-session default when Pi could not restore the unlisted model a session recorded", async t => {
			// Pi fell back to a listed saved default, but the session itself ran on the unlisted model.
			const result = await start(t, "resume", { current: sonnet, recorded: savedDefault, available: [sonnet, sol, opus], history: true });
			assert.deepEqual([result.current, result.thinking], [opus, "medium"]);
		});
	});
});
