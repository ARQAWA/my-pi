import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import extension, { FAMILIES, familyOf, levelsFor, pickerModels } from "../../../extensions/RQW-models/index.ts";
import { ModelEffortPicker, stepDraft, type PickerSpec } from "../../../extensions/RQW-models/picker.ts";

const model = (id: string, provider = "anthropic"): Model<string> => ({
	id, provider, api: "test", name: id, baseUrl: "https://invalid.test", reasoning: true, input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128_000, maxTokens: 8_000,
	thinkingLevelMap: { xhigh: "xhigh", max: "max" },
});

describe("RQW-models public selection", () => {
	it("renders the statusbar's human names without changing model identity", () => {
		const models = [
			{ ...model("claude-opus-5-5"), name: "Claude Opus 5.5" },
			{ ...model("gpt-6.1-sol", "openai-codex"), name: "GPT-6.1 Sol" },
			{ ...model("k3.1-pro", "kimi-coding"), name: "Kimi K3.1 Pro" },
		];
		const spec: PickerSpec = { models, family: m => models.indexOf(m), rank: () => 0,
			levels: () => ["low"], nearest: () => "low" };
		const theme = { fg: (_: string, text: string) => text, bold: (text: string) => text };
		let selected: unknown;
		const picker = new ModelEffortPicker(spec, { model: models[1], effort: "low" }, theme as any, result => { selected = result?.model; });
		const output = picker.render(100).join("\n");
		for (const label of ["Opus 5.5", "GPT-6.1 Sol", "Kimi K3.1 Pro"]) assert.ok(output.includes(label));
		assert.ok(!output.includes("anthropic/") && !output.includes("openai-codex/") && !output.includes("Claude "));
		picker.handleInput("\r");
		assert.equal(selected, models[1]);
	});
	it("registers Terra with its limits and picker order", () => {
		let catalog: Model<string>[] = [];
		const pi = { registerProvider(provider: any) { if (typeof provider === "object") catalog = provider.getAllModels(); },
			registerShortcut() {}, registerCommand() {}, on() {} };
		extension(pi as unknown as ExtensionAPI);
		const terra = catalog.find(model => model.id === "gpt-6.1-terra")!;
		assert.equal(catalog.filter(model => model.id === terra.id).length, 1);
		assert.deepEqual([terra.provider, terra.contextWindow, terra.maxTokens], ["openai-codex", 1_050_000, 128_000]);
		assert.deepEqual(levelsFor(terra), ["off", "low", "medium", "high", "xhigh", "max"]);
		assert.deepEqual(pickerModels(catalog).map(model => model.id), ["gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-sol", "gpt-5.6-luna", "gpt-6-luna"]);
	});
	it("lists each supported family once and steps the draft without wrapping", () => {
		const opus = model("claude-opus-5-5");
		const sonnet = model("claude-sonnet-5-5");
		const unknown = model("other");
		assert.deepEqual(pickerModels([unknown, sonnet, opus]), [opus, sonnet]);
		assert.equal(familyOf(model("us.anthropic.claude-opus-5-5-v1:0", "bedrock")), FAMILIES.indexOf("claude-opus-5-5"));
		assert.deepEqual(levelsFor(opus), ["low", "medium", "high"]);
		const spec: PickerSpec = {
			models: [opus, sonnet], family: (m) => familyOf(m),
			rank: (level) => ["off", "minimal", "low", "medium", "high", "xhigh", "max"].indexOf(level),
			levels: levelsFor, nearest: (m, effort) => levelsFor(m).filter((level) => spec.rank(level) <= spec.rank(effort)).at(-1) ?? levelsFor(m)[0],
		};
		assert.deepEqual(stepDraft(spec, { model: opus, effort: "max" }, "down"), { model: sonnet, effort: "xhigh" });
		assert.deepEqual(stepDraft(spec, { model: opus, effort: "high" }, "up"), { model: opus, effort: "high" });
		assert.equal(stepDraft(spec, { model: opus, effort: "high" }, "right").effort, "high");
	});

	it("renders every effort horizontally and keeps models vertical before cancel", () => {
		const models = [model("gpt-6.1-sol", "openai-codex"), model("claude-opus-5-5")];
		const levels = ["off", "low", "medium", "high", "xhigh", "max"];
		const spec: PickerSpec = { models, family: m => models.indexOf(m), rank: level => levels.indexOf(level),
			levels: () => levels, nearest: (_, effort) => effort };
		const theme = { fg: (_: string, text: string) => text, bold: (text: string) => text };
		let result: unknown = "open";
		const picker = new ModelEffortPicker(spec, { model: models[0], effort: "high" }, theme as any, value => { result = value; });
		for (const width of [31, 44, 100]) {
			const lines = picker.render(width);
			assert.ok(lines.includes("off low medium › high xhigh max"));
			const modelRows = models.map(m => lines.findIndex(line => line.includes(m.name)));
			assert.ok(modelRows[0] >= 0 && modelRows[1] > modelRows[0]);
		}
		for (const width of [1, 10, 30]) {
			const lines = picker.render(width);
			assert.equal(lines.join(""), "Effort needs 31 columns");
			assert.ok(lines.every(line => line.length <= width));
		}
		picker.handleInput("\u001b[B");
		picker.handleInput("\u001b[C");
		assert.ok(picker.render(44).includes("off low medium high › xhigh max"));
		picker.handleInput("\u001b");
		assert.equal(result, undefined);
	});

	for (const cancel of [false, true]) it(`${cancel ? "Esc cancels" : "Enter commits"} a changed model and effort through fake Pi`, async () => {
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
					const result = new Promise((resolve) => { component = factory({ requestRender() {} }, { fg: (_: string, text: string) => text, bold: (text: string) => text }, {}, resolve); });
					assert.ok(component.render(44).includes("low medium › high xhigh"));
					component.handleInput("\u001b[C");
					component.handleInput(cancel ? "\u001b" : "\r");
					return result;
				},
			},
		} as unknown as ExtensionContext;
		for (const handler of handlers.get("session_start") ?? []) await handler({ reason: "resume" }, ctx);
		await shortcuts.get("shift+down")!(ctx);
		assert.equal(current, cancel ? opus : sonnet);
		assert.equal(thinking, cancel ? "high" : "xhigh");
		assert.deepEqual(calls, cancel ? [] : ["model:claude-sonnet-5-5", "thinking:xhigh"]);
	});

	it("regression 4b0e7f4: an unlisted restored model falls back to authenticated Opus first", async () => {
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
			await handlers.get("session_start")!({ type: "session_start", reason: "resume" }, ctx);
			return { current, thinking };
		};
		const argv = process.argv;
		process.argv = argv.slice(0, 2);
		try {
			const kimi = model("kimi-for-coding-highspeed", "kimi-coding");
			const opus = model("claude-opus-5-5");
			assert.equal((await run([kimi, opus])).current, opus);
			assert.equal((await run([kimi])).current.id, kimi.id);
		} finally {
			process.argv = argv;
		}
	});
});
