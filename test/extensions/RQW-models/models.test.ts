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

// Real ModelRuntime with in-memory credentials; the session is a prototype-only stand-in the probe can find.
async function newRuntime(stubRefresh = true) {
	const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false });
	// Pi's registrations start a background refresh that recomposes providers; keep it out so only this extension's own recompose counts.
	if (stubRefresh) runtime.refresh = async () => ({ aborted: false, errors: new Map() });
	return runtime;
}

async function runtimeFixture(stubRefresh = true) {
	const runtime = await newRuntime(stubRefresh);
	const overlay = {
		api: "openai-codex-responses" as const,
		streamSimple: (() => { throw new Error("unused"); }) as never,
		oauth: { name: "test", login: async () => ({ access: "a", refresh: "r", expires: 4_102_444_800_000 }), refreshToken: async (c: any) => c, getApiKey: (c: any) => c.access },
	};
	const session = (owned = runtime) => {
		const sessionManager = { getBranch: () => [] };
		const fake = Object.assign(Object.create(AgentSession.prototype), { sessionManager, _modelRuntime: owned }) as AgentSession;
		const handlers = new Map<string, (event: any, ctx: any) => unknown>();
		const pi = { registerShortcut() {}, registerCommand() {}, on: (name: string, handler: any) => { handlers.set(name, handler); return () => {}; } };
		extension(pi as unknown as ExtensionAPI);
		const ctx = { hasUI: false, sessionManager, isIdle: () => (fake as any).isIdle, model: undefined } as unknown as ExtensionContext;
		return { start: async () => { await handlers.get("session_start")!({ type: "session_start", reason: "resume" }, ctx); }, stop: () => handlers.get("session_shutdown")!({}, ctx), fake };
	};
	return { runtime, overlay, session };
}

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
	it("has Terra before session_start, where Pi restores a saved model", async t => {
		const { runtime, session } = await runtimeFixture(false);
		const owner = session();
		t.after(() => owner.stop());
		// Pi's service setup refreshes the runtime right after loading extensions; session creation then looks the saved model up.
		await runtime.refresh({ allowNetwork: false });
		assert.equal(runtime.getModel("openai-codex", "gpt-6.1-terra")?.name, "GPT-6.1 Terra");
	});
	for (const overlayFirst of [false, true]) it(`adds Terra and keeps another extension's Codex transport (${overlayFirst ? "transport first" : "models first"})`, async t => {
		const { runtime, overlay, session } = await runtimeFixture();
		const owner = session();
		t.after(() => owner.stop());
		if (overlayFirst) runtime.registerProvider("openai-codex", overlay);
		await owner.start();
		// The picker reads this snapshot right after session_start, before any background refresh.
		assert.ok(runtime.getModels("openai-codex").some(model => model.id === "gpt-6.1-terra"));
		if (!overlayFirst) runtime.registerProvider("openai-codex", overlay);
		const catalog = [...runtime.getModels("openai-codex")];
		const terra = catalog.find(model => model.id === "gpt-6.1-terra")!;
		assert.equal(catalog.filter(model => model.id === terra.id).length, 1);
		assert.deepEqual([terra.provider, terra.contextWindow, terra.maxTokens], ["openai-codex", 1_050_000, 128_000]);
		assert.deepEqual(levelsFor(terra), ["low", "medium", "high", "xhigh", "max"]);
		assert.deepEqual(pickerModels(catalog).map(model => model.id), ["gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-sol", "gpt-5.6-luna", "gpt-6-luna"]);
		assert.equal(runtime.getRegisteredProviderConfig("openai-codex")?.streamSimple, overlay.streamSimple);
		assert.ok(runtime.getAllModels("openai-codex").some(model => model.id === "gpt-6.1-terra"));
	});
	for (const release of ["shutdown", "dispose"] as const) for (const firstOut of [0, 1]) it(`removes Terra only after the last owner ends (${release}, session ${firstOut} first)`, async t => {
		t.mock.method(AgentSession.prototype, "dispose", () => {});
		const { runtime, overlay, session } = await runtimeFixture();
		const owners = [session(), session()];
		t.after(() => owners.forEach(owner => owner.stop()));
		runtime.registerProvider("openai-codex", overlay);
		for (const owner of owners) await owner.start();
		const hasTerra = () => runtime.getModels("openai-codex").some(model => model.id === "gpt-6.1-terra");
		const end = (owner: typeof owners[number]) => release === "shutdown" ? owner.stop() : owner.fake.dispose();
		end(owners[firstOut]);
		assert.ok(hasTerra(), "the other session still owns the addition");
		end(owners[1 - firstOut]);
		assert.ok(!hasTerra(), "Terra is gone with its last owner");
		assert.equal(runtime.getRegisteredProviderConfig("openai-codex")?.streamSimple, overlay.streamSimple);
		assert.ok(runtime.getModels("openai-codex").some(model => model.id === "gpt-6.1-sol"));
	});
	it("keeps Terra on a runtime until its own last owner ends, whatever other runtimes do", async t => {
		const { runtime: first, session } = await runtimeFixture();
		const second = await newRuntime();
		const owners = [session(first), session(second)];
		t.after(() => owners.forEach(owner => owner.stop()));
		for (const owner of owners) await owner.start();
		const hasTerra = (runtime: ModelRuntime) => runtime.getModels("openai-codex").some(model => model.id === "gpt-6.1-terra");
		owners[0].stop();
		assert.ok(!hasTerra(first), "the ended owner's runtime loses Terra although another runtime still holds the layer");
		assert.ok(hasTerra(second));
		owners[1].stop();
		assert.ok(!hasTerra(second));
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

	it("regression 4b0e7f4: an unlisted restored model falls back to authenticated Opus first", async t => {
		const run = async (available: Model<string>[]) => {
			const handlers = new Map<string, (event: any, ctx: any) => Promise<void>>();
			let current = model("outside", "other");
			let thinking = "high";
			const pi = {
				registerProvider() {}, unregisterProvider() {}, registerShortcut() {}, registerCommand() {},
				on: (name: string, handler: any) => { handlers.set(name, handler); return () => {}; },
				getThinkingLevel: () => thinking,
				setThinkingLevel: (level: string) => { thinking = level; },
				setModel: async (next: Model<string>) => { current = next; return true; },
			};
			extension(pi as unknown as ExtensionAPI);
			const ctx = {
				get model() { return current; }, hasUI: true,
				modelRegistry: { getAvailable: () => available },
				sessionManager: { getBranch: () => [] }, isIdle: () => true,
				ui: { notify() {} },
			} as unknown as ExtensionContext;
			t.after(() => handlers.get("session_shutdown")!({}, ctx));
			await handlers.get("session_start")!({ type: "session_start", reason: "resume" }, ctx);
			return { current, thinking };
		};
		const argv = process.argv;
		process.argv = argv.slice(0, 2);
		try {
			const unlisted = model("outside-model", "other");
			const opus = model("claude-opus-5-5");
			assert.equal((await run([unlisted, opus])).current, opus);
			assert.equal((await run([unlisted])).current.id, "outside");
		} finally {
			process.argv = argv;
		}
	});
});
