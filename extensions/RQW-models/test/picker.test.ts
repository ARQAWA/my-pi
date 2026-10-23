import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { visibleWidth, type KeyId } from "@earendil-works/pi-tui";
import extension, { FAMILIES } from "../index.ts";
import { ModelEffortPicker, stepDraft, type Draft, type PickerSpec } from "../picker.ts";

// Standalone: only this extension and public Pi/TUI exports. Models are deterministic fixtures, no network.
const model = (id: string, provider = "anthropic", map: Record<string, string | null> = { xhigh: "xhigh", max: "max" }): Model<string> => ({
	id, provider, api: "test", name: id, baseUrl: "https://invalid.test", reasoning: true, input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 8000, thinkingLevelMap: map,
});
const LISTED = FAMILIES.map((id) => model(id, id.startsWith("gpt") ? "openai-codex" : "anthropic"));
const KEY = {
	up: "\x1b[A", down: "\x1b[B", right: "\x1b[C", left: "\x1b[D", enter: "\r", escape: "\x1b",
	shiftUp: "\x1b[1;2A", shiftDown: "\x1b[1;2B", shiftRight: "\x1b[1;2C", shiftLeft: "\x1b[1;2D",
} as const;
const flush = () => new Promise((resolve) => setImmediate(resolve));
const EFFORT: Record<string, string> = { low: "thinkingLow", medium: "thinkingMedium", high: "thinkingHigh", xhigh: "thinkingXhigh", max: "thinkingMax" };
const RANK = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
// Supported effort per fixture family, as in index.ts FAMILY_LEVELS.
const levelsOf = (m: Model<string> | undefined) => (m?.id === "claude-opus-5-5" ? ["low", "medium", "high"] : m?.id === "claude-sonnet-5-5" ? ["low", "medium", "high", "xhigh"] : ["low", "medium", "high", "xhigh", "max"]);
const nearestOf = (m: Model<string>, level: string) => levelsOf(m).filter((x) => RANK.indexOf(x) <= RANK.indexOf(level)).at(-1) ?? levelsOf(m)[0];

// Recording theme: every role appears in the text as <role>...</>, so tests can assert token choices.
const roles: Theme = {
	fg: (color: string, text: string) => `<${color}>${text}</>`,
	bold: (text: string) => `<bold>${text}</bold>`,
} as unknown as Theme;
type Theme = Parameters<NonNullable<Parameters<ExtensionUIContext["custom"]>[0]>>[1];
// ANSI true-colour theme for the width sweep: SGR bytes present in every styled cell.
const ansi: Theme = {
	fg: (color: string, text: string) => `\x1b[38;2;${color.length * 17};${color.charCodeAt(0)};${color.charCodeAt(1) ?? 0}m${text}\x1b[39m`,
	bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
} as unknown as Theme;

type Dialog = { component: { render(width: number): string[]; handleInput(data: string): void }; done: (result: unknown) => void };

function harness(models = LISTED, live = LISTED[0], thinking = "medium") {
	const shortcuts = new Map<KeyId, { description: string; handler: (ctx: ExtensionContext) => Promise<void> | void }>();
	const commands = new Map<string, { handler: (args: string, ctx: ExtensionContext) => Promise<void> | void }>();
	const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
	const modelSelect: ((event: { model: Model<string> }) => void)[] = [];
	const calls: string[] = [];
	const notes: string[] = [];
	let current = live;
	let level = thinking;
	let customCalls = 0;
	let deferred: (() => void) | undefined;
	let defer = false;
	let dialog: Dialog | undefined;
	// First render of each custom open, captured synchronously inside the factory run (before any yield).
	const firstFrames: { lines: string[]; calls: string[] }[] = [];
	let setModelResult: (next: Model<string>) => Promise<boolean> = async () => true;
	let silent = false;
	let pick: string | undefined;
	const ctx = {
		get model() { return current; }, hasUI: true,
		modelRegistry: { getAvailable: () => models }, sessionManager: { getBranch: () => [] },
		ui: {
			notify: (text: string) => { if (!text.startsWith("RQW-models cannot restrict")) notes.push(text); },
			select: async (_title: string, labels: string[]) => labels.find((label) => label === pick),
			custom: (factory: (...args: unknown[]) => unknown) => {
				customCalls++;
				return new Promise((resolve) => {
					const done = (result: unknown) => { if (dialog?.done === done) dialog = undefined; resolve(result); };
					const run = () => {
						const component = factory({ requestRender: () => {} }, roles, undefined, done) as Dialog["component"];
						firstFrames[customCalls - 1] = { lines: component.render(400), calls: [...calls] };
						dialog = { component, done };
					};
					if (defer) deferred = run; else run();
				});
			},
		},
	} as unknown as ExtensionContext;
	const pi = {
		registerShortcut: (key: KeyId, options: { description: string; handler: (ctx: ExtensionContext) => Promise<void> | void }) => shortcuts.set(key, options),
		registerCommand: (name: string, options: { handler: (args: string, ctx: ExtensionContext) => Promise<void> | void }) => commands.set(name, options),
		// Requests must never be attempted by the chooser or /rqw-models; any attempt is recorded.
		sendUserMessage: () => { calls.push("request:sendUserMessage"); },
		sendMessage: () => { calls.push("request:sendMessage"); },
		on: (name: string, fn: (event: unknown, ctx: ExtensionContext) => unknown) => {
			if (name !== "model_select") { handlers.set(name, fn); return () => {}; }
			const listener = fn as (event: { model: Model<string> }) => void;
			modelSelect.push(listener);
			return () => { modelSelect.splice(modelSelect.indexOf(listener), 1); };
		},
		getThinkingLevel: () => level,
		setThinkingLevel: (next: string) => { calls.push(`thinking:${next}`); level = next; },
		setModel: (next: Model<string>) => {
			calls.push(`model:${next.provider}/${next.id}`);
			return setModelResult(next).then((ok) => {
				if (ok) { current = next; if (!silent) for (const listener of [...modelSelect]) listener({ model: next }); }
				return ok;
			});
		},
	};
	extension(pi as unknown as ExtensionAPI);
	const session = (reason = "reload") => handlers.get("session_start")?.({ type: "session_start", reason }, ctx);
	// Pi starts the session before the chooser is reachable; reload leaves the default model alone.
	void session();
	return {
		shortcuts, commands, calls, notes, handlers, modelSelect,
		set pick(label: string | undefined) { pick = label; },
		runCommand: (name: string) => commands.get(name)!.handler("", ctx),
		get current() { return current; }, get level() { return level; }, get customCalls() { return customCalls; },
		get dialog() { return dialog; },
		firstFrame: (open = customCalls) => firstFrames[open - 1],
		setModelResult(fn: (next: Model<string>) => Promise<boolean>) { setModelResult = fn; },
		set silent(value: boolean) { silent = value; },
		set defer(value: boolean) { defer = value; }, runDeferred: () => deferred?.(),
		// Opens the chooser with a Shift arrow; the promise settles when the dialog commits or closes.
		open: (key: KeyId) => shortcuts.get(key)!.handler(ctx),
		input: (data: string) => dialog?.component.handleInput(data),
		session,
		press: async (key: KeyId, data: string) => { const pending = shortcuts.get(key)!.handler(ctx); await flush(); dialog?.component.handleInput(data); await pending; },
	};
}

describe("first rendered draft: every initiating key updates the draft before the first render", () => {
	// Start: Sonnet medium. Expected draft: model index in LISTED and effort.
	const cases: [KeyId, number, string][] = [
		["shift+up", 0, "medium"],
		["shift+down", 2, "medium"],
		["shift+right", 1, "high"],
		["shift+left", 1, "low"],
	];
	for (const [key, index, expectedEffort] of cases) {
		it(`${key} opens with the stepped draft in the very first render, with no setter call`, async () => {
			const h = harness(LISTED, LISTED[1], "medium");
			const pending = h.open(key);
			// The saved first render from the factory run: the selected row (marked ›) is the stepped draft.
			const first = h.firstFrame();
			assert.ok(first, key);
			const lines = first.lines;
			const selected = lines.filter((line) => line.includes("›"));
			assert.ok(selected.some((line) => line.includes(`${LISTED[index].provider}/${LISTED[index].id}`)), key);
			assert.ok(lines.some((line) => line.includes(`<bold><${EFFORT[expectedEffort]}>${expectedEffort}</></bold>`) || (expectedEffort === "low" && line.includes(`<${EFFORT.low}>low</>`))), key);
			assert.deepEqual(first.calls, [], key);
			assert.deepEqual(h.calls, [], key);
			await flush();
			h.input(KEY.escape);
			await pending;
		});
	}
	it("optional alias: live proxy Sonnet keeps its exact provider/id on Shift+Right Enter, only thinking:high", async () => {
		const proxySonnet = model("anthropic/claude-sonnet-5.5", "proxy");
		const h = harness(LISTED, proxySonnet, "medium");
		const pending = h.open("shift+right");
		await flush();
		h.input(KEY.enter);
		await pending;
		assert.deepEqual(h.calls, ["thinking:high"]);
		assert.equal(h.current, proxySonnet);
		assert.equal(h.current.provider, "proxy");
		assert.equal(h.current.id, "anthropic/claude-sonnet-5.5");
	});
});

describe("transaction: open, navigate and Esc never change live state", () => {
	it("zero setter or request calls on open, navigation and Esc", async () => {
		const h = harness();
		const pending = h.open("shift+down");
		await flush();
		for (const data of [KEY.shiftDown, KEY.right, KEY.left, KEY.up, KEY.down, KEY.shiftUp, KEY.shiftRight]) { h.input(data); await flush(); }
		h.input(KEY.escape);
		await pending;
		assert.deepEqual(h.calls, []);
		assert.equal(h.current, LISTED[0]);
		assert.equal(h.level, "medium");
		assert.deepEqual(h.notes, []);
	});
	it("Enter with an unchanged exact provider/id calls only the thinking setter, once", async () => {
		const h = harness(LISTED, LISTED[1], "medium");
		const pending = h.open("shift+right");
		await flush();
		h.input(KEY.enter); h.input(KEY.enter); h.input(KEY.escape);
		await pending;
		assert.deepEqual(h.calls, ["thinking:high"]);
		assert.equal(h.current, LISTED[1]);
	});
	it("Enter with a changed model uses public setModel once, then the effort; repeats do nothing", async () => {
		const h = harness(LISTED, LISTED[0], "high");
		const pending = h.open("shift+down");
		await flush();
		h.input(KEY.enter); h.input(KEY.enter);
		await pending;
		// The scoped listener applies the draft effort synchronously inside setModel; no fallback is needed.
		assert.deepEqual(h.calls, ["model:anthropic/claude-sonnet-5-5", "thinking:high"]);
		assert.equal(h.current, LISTED[1]);
		assert.equal(h.calls.filter((entry) => entry.startsWith("model:")).length, 1);
		assert.equal(h.level, "high");
	});
	it("the scoped model_select handler sets the draft effort before later handlers, then cleans up", async () => {
		const h = harness(LISTED, LISTED[0], "medium");
		const seen: string[] = [];
		// A handler that Pi registers after ours; it must observe the draft effort already applied.
		h.setModelResult(async () => { h.modelSelect.push(() => seen.push(`later:${h.level}`)); return true; });
		const pending = h.open("shift+down");
		await flush();
		h.input(KEY.right); // Sonnet medium -> high
		h.input(KEY.enter);
		await pending;
		assert.equal(h.level, "high");
		assert.deepEqual(seen, ["later:high"]);
		assert.equal(h.modelSelect.length, 1, "only the later listener remains registered");
	});
	it("effort clamps to nearest lower when the model changes; never wraps", async () => {
		const h = harness(LISTED, LISTED[1], "max");
		const pending = h.open("shift+up");
		await flush();
		h.input(KEY.shiftLeft); h.input(KEY.shiftLeft); h.input(KEY.shiftLeft); h.input(KEY.shiftLeft); h.input(KEY.shiftLeft);
		h.input(KEY.enter);
		await pending;
		assert.equal(h.current, LISTED[0]);
		assert.equal(h.level, "low");
	});
});

describe("duplicate dialogs, repeats and cancellation", () => {
	it("a repeated shortcut navigates the one open dialog and never spawns a second", async () => {
		const h = harness(LISTED, LISTED[3], "medium");
		const pending = h.open("shift+down");
		await flush();
		void h.open("shift+down"); void h.open("shift+right");
		await flush();
		assert.equal(h.customCalls, 1);
		h.input(KEY.enter);
		await pending;
		assert.equal(h.customCalls, 1);
		assert.equal(h.current, LISTED[5]);
	});
	it("a new shortcut after commit opens exactly one new dialog", async () => {
		const h = harness();
		const first = h.open("shift+down"); await flush(); h.input(KEY.enter); await first;
		const second = h.open("shift+down"); await flush(); h.input(KEY.escape); await second;
		assert.equal(h.customCalls, 2);
	});
	it("session_start after the factory cancels the dialog: nothing is applied", async () => {
		const h = harness(LISTED, LISTED[0], "medium");
		const pending = h.open("shift+down");
		await flush();
		h.session("reload");
		await pending;
		assert.deepEqual(h.calls, []);
		assert.equal(h.dialog, undefined);
	});
	it("session_shutdown after the factory cancels the dialog", async () => {
		const h = harness();
		const pending = h.open("shift+right");
		await flush();
		h.handlers.get("session_shutdown")?.({ type: "session_shutdown" }, {} as ExtensionContext);
		await pending;
		assert.deepEqual(h.calls, []);
	});
	it("session_start before the factory runs: the late factory is inert and resolves without a dialog", async () => {
		const h = harness();
		h.defer = true;
		const pending = h.open("shift+down");
		await flush();
		h.session("reload");
		h.runDeferred();
		await pending;
		assert.deepEqual(h.calls, []);
		assert.equal(h.current, LISTED[0]);
	});
	it("a stale async setModel result after session change never applies effort", async () => {
		const h = harness(LISTED, LISTED[0], "medium");
		let release!: (ok: boolean) => void;
		h.setModelResult(() => new Promise<boolean>((resolve) => { release = resolve; }));
		const pending = h.open("shift+down");
		await flush();
		h.input(KEY.enter);
		await flush();
		h.session("reload");
		release(true);
		await pending;
		assert.deepEqual(h.calls, ["model:anthropic/claude-sonnet-5-5"]);
		assert.equal(h.modelSelect.length, 0);
	});
	it("setModel false: warning, no effort change, scoped handler removed", async () => {
		const h = harness(LISTED, LISTED[0], "medium");
		h.setModelResult(async () => false);
		await h.press("shift+down", KEY.enter);
		assert.deepEqual(h.calls, ["model:anthropic/claude-sonnet-5-5"]);
		assert.equal(h.notes.length, 1);
		assert.match(h.notes[0], /No authentication/);
		assert.equal(h.modelSelect.length, 0);
	});
	it("setModel throws: warning, cleanup, no effort change", async () => {
		const h = harness(LISTED, LISTED[0], "medium");
		h.setModelResult(async () => { throw new Error("boom"); });
		await h.press("shift+down", KEY.enter);
		assert.deepEqual(h.calls, ["model:anthropic/claude-sonnet-5-5"]);
		assert.match(h.notes[0] ?? "", /boom/);
		assert.equal(h.modelSelect.length, 0);
	});
	it("successful setModel without a model_select applies the draft effort as fallback, exactly once", async () => {
		const h = harness(LISTED, LISTED[0], "medium");
		h.setModelResult(async () => true);
		// A Pi that switches without emitting model_select: the fallback must apply the draft effort.
		h.silent = true;
		const pending = h.open("shift+down");
		await flush();
		h.input(KEY.right); // Sonnet medium -> high, on a changed model
		h.input(KEY.enter);
		await pending;
		assert.deepEqual(h.calls, ["model:anthropic/claude-sonnet-5-5", "thinking:high"]);
		assert.equal(h.current, LISTED[1]);
		assert.equal(h.level, "high");
		assert.equal(h.modelSelect.length, 0, "scoped listener removed");
	});
	it("unrelated model_select during the switch is ignored; a repeated matching callback sets effort once", async () => {
		const h = harness(LISTED, LISTED[0], "medium");
		h.setModelResult(async (next) => {
			const listeners = [...h.modelSelect];
			for (const listener of listeners) listener({ model: LISTED[4] });
			assert.equal(h.calls.filter((entry) => entry.startsWith("thinking:")).length, 0, "unrelated event applies nothing");
			for (const listener of listeners) { listener({ model: next }); listener({ model: next }); }
			return true;
		});
		const pending = h.open("shift+down");
		await flush();
		h.input(KEY.right);
		h.input(KEY.enter);
		await pending;
		assert.deepEqual(h.calls.filter((entry) => entry.startsWith("thinking:")), ["thinking:high"]);
		assert.equal(h.level, "high");
		assert.equal(h.modelSelect.length, 0);
	});
});

describe("queued commit behind /rqw-models: session change before the commit runs", () => {
	it("a confirmed chooser commit queued behind a held /rqw-models selection sends no setter after session_start", async () => {
		const h = harness(LISTED, LISTED[1], "medium");
		let release!: (ok: boolean) => void;
		let first = true;
		h.setModelResult(() => {
			if (!first) return Promise.resolve(true);
			first = false;
			return new Promise<boolean>((resolve) => { release = resolve; });
		});
		h.pick = "anthropic/claude-opus-5-5";
		const command = h.runCommand("rqw-models");
		await flush();
		assert.deepEqual(h.calls, ["model:anthropic/claude-opus-5-5"]);
		// Chooser confirmed while the /rqw-models setter is still held: its commit waits in the queue.
		const chooser = h.open("shift+down");
		await flush();
		h.input(KEY.enter);
		await flush();
		assert.equal(h.dialog, undefined);
		assert.equal(h.customCalls, 1);
		// Session restarts while the commit is queued; then the first action completes.
		h.session("reload");
		release(true);
		await Promise.all([command, chooser]);
		assert.deepEqual(h.calls, ["model:anthropic/claude-opus-5-5", "thinking:medium"]);
		assert.equal(h.calls.filter((entry) => entry.startsWith("model:")).length, 1);
		assert.equal(h.current, LISTED[0]);
	});
});

describe("effort capabilities", () => {
	const none = model("claude-opus-5-5", "anthropic", { low: null, medium: null, high: null });
	it("a model without supported effort ignores Left/Right and Enter does not call the thinking setter", async () => {
		const h = harness([none, LISTED[1]], none, "off");
		await h.press("shift+right", KEY.enter);
		await h.press("shift+left", KEY.enter);
		assert.deepEqual(h.calls, []);
	});
	it("draft effort steps through only the supported list and clamps at both ends", () => {
		const spec: PickerSpec = {
			models: LISTED,
			family: (m) => FAMILIES.indexOf(m.id as typeof FAMILIES[number]),
			rank: (level) => RANK.indexOf(level),
			levels: levelsOf,
			nearest: nearestOf,
		};
		let draft: Draft = { model: LISTED[0], effort: "high" };
		for (const step of ["right", "right", "right"] as const) draft = stepDraft(spec, draft, step);
		assert.equal(draft.effort, "high");
		draft = stepDraft(spec, draft, "left");
		assert.equal(draft.effort, "medium");
		draft = stepDraft({ ...spec }, { model: LISTED[0], effort: "off" }, "left");
		assert.equal(draft.effort, "low");
		// Model step clamps effort with the nearest-lower rule; a stronger model with no change at the top stays.
		const top = stepDraft(spec, { model: LISTED[0], effort: "max" }, "up");
		assert.deepEqual(top, { model: LISTED[0], effort: "max" });
		const down = stepDraft(spec, { model: LISTED[0], effort: "max" }, "down");
		assert.equal(down.model, LISTED[1]);
		assert.equal(down.effort, "xhigh");
	});
	it("effort tokens: medium/high/xhigh/max use thinking* roles, low stays ordinary and unbolded, neighbours muted", () => {
		const spec: PickerSpec = {
			models: [LISTED[2]], family: () => 2, rank: (level) => ["off", "minimal", "low", "medium", "high", "xhigh", "max"].indexOf(level),
			levels: () => ["low", "medium", "high", "xhigh", "max"], nearest: (_m, level) => level,
		};
		// Recording tags are visible to the width maths, so role assertions use a roomy render.
		const render = (effort: string) => new ModelEffortPicker(spec, { model: LISTED[2], effort }, roles, () => {}).render(400).join("\n");
		assert.ok(render("medium").includes("<bold><thinkingMedium>medium</></bold>"));
		assert.ok(render("high").includes("<bold><thinkingHigh>high</></bold>"));
		assert.ok(render("xhigh").includes("<bold><thinkingXhigh>xhigh</></bold>"));
		assert.ok(render("max").includes("<bold><thinkingMax>max</></bold>"));
		const low = render("low");
		assert.ok(low.includes("<thinkingLow>low</>"));
		assert.ok(!low.includes("<bold><thinkingLow>"));
		assert.ok(low.includes("<muted>medium</>"), "neighbours are muted");
	});
});

describe("chooser width sweep 0..160 and layout", () => {
	const ugly = [
		model("claude-opus-5-5"),
		model("gpt-6.1-sol", "openai-codex"),
		model("claude-sonnet-5-5", "anthropic-\u{1F680}\u{1F9D1}\u{200D}\u{1F4BB} 中文字符长别名 e\u0301\u0301\u0301 \x07\x1b[31mRED\x1b[0m\u202e\u2028tail"),
		model("gpt-6-sol", "openai-codex-\t\x00\x7f\u009b"),
	];
	const spec: PickerSpec = {
		models: ugly, family: (m) => FAMILIES.indexOf(m.id as typeof FAMILIES[number]), rank: (level) => ["off", "minimal", "low", "medium", "high", "xhigh", "max"].indexOf(level),
		levels: () => ["low", "medium", "high", "xhigh", "max"], nearest: (_m, level) => level,
	};
	for (const [label, theme] of [["roles", roles], ["ansi", ansi]] as const) {
		it(`every line fits every width 0..160 with ${label} theme, no physical newline`, () => {
			for (const draft of [{ model: ugly[2], effort: "max" }, { model: ugly[0], effort: "low" }, { model: undefined, effort: undefined }, { model: ugly[1], effort: "xhigh" }]) {
				const picker = new ModelEffortPicker(spec, draft, theme, () => {});
				for (let width = 0; width <= 160; width++) {
					const lines = picker.render(width);
					for (const line of lines) {
						assert.ok(!/[\r\n]/.test(line), `${width}: newline`);
						assert.ok(visibleWidth(line) <= width, `${width}: ${visibleWidth(line)} ${JSON.stringify(line)}`);
					}
					if (width === 0) assert.deepEqual(lines, []);
				}
			}
		});
	}
	it("wide layout: two columns, title, visible OK/Enter/Esc hints, selected row marker", () => {
		const picker = new ModelEffortPicker(spec, { model: ugly[0], effort: "medium" }, roles, () => {});
		const text = picker.render(400).join("\n");
		assert.ok(text.includes("Model / effort"));
		assert.ok(text.includes("<accent>› </>"));
		assert.match(text, /Enter/);
		assert.match(text, /OK/);
		assert.match(text, /Esc/);
		assert.ok(picker.render(400).length <= 9);
	});
	it("narrow fallback below 44 columns keeps the model, effort and hints", () => {
		const picker = new ModelEffortPicker(spec, { model: ugly[0], effort: "medium" }, ansi, () => {});
		const text = picker.render(30).join("\n").replace(/\x1b\[[0-9;]*m/g, "");
		assert.match(text, /Model/);
		assert.match(text, /Effort/);
		assert.match(text, /Enter/);
		assert.match(text, /Esc/);
	});
	it("ordinary and Shift arrows share the same axes inside the component; no wrap", async () => {
		const h = harness(LISTED, LISTED[1], "medium");
		const pending = h.open("shift+right");
		await flush();
		h.input(KEY.shiftRight); h.input(KEY.right); h.input(KEY.shiftLeft); h.input(KEY.left); h.input(KEY.left);
		h.input(KEY.enter);
		await pending;
		assert.equal(h.level, "low");
		assert.deepEqual(h.calls, ["thinking:low"]);
	});
});
