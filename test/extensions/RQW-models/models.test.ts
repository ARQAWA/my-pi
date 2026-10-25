import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { fauxAssistantMessage, fauxProvider, getSupportedThinkingLevels, type Model, type FauxProviderHandle } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type AgentSession, type ExtensionAPI, type ExtensionContext, type ExtensionCommandContext, type ExtensionFactory, type ExtensionUIContext, type SessionStartEvent } from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { kimiCodingProvider } from "@earendil-works/pi-ai/providers/kimi-coding";
import { matchesKey, setKittyProtocolActive, type KeyId } from "@earendil-works/pi-tui";
import extension, { FAMILIES, familyOf, levelsFor, pickerModels } from "../../../extensions/RQW-models/index.ts";

const EXTENSION = join(dirname(fileURLToPath(import.meta.url)), "../../../extensions/RQW-models", "index.ts");
const ORIGINAL_ARGV = process.argv;
const model = (id: string, provider = "anthropic", map: Record<string, string | null> = { xhigh: "xhigh", max: "max" }): Model<string> => ({
	id, provider, api: "test", name: id, baseUrl: "https://invalid.test", reasoning: true, input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 8000, thinkingLevelMap: map,
});
const LISTED = FAMILIES.slice(4).map((id) => model(id, id.startsWith("gpt") ? "openai-codex" : "anthropic"));
const KIMI = FAMILIES.slice(0, 4).map((id) => model(id, "kimi-coding"));
const EXPECTED_LEVELS = [
	["low", "medium", "high"],
	["low", "medium", "high", "xhigh"],
	["low", "medium", "high", "xhigh", "max"],
	["low", "medium", "high", "xhigh", "max"],
	["low", "medium", "high", "xhigh", "max"],
	["low", "medium", "high", "xhigh", "max"],
	["low", "medium", "high", "xhigh", "max"],
];

type Shortcut = Parameters<ExtensionAPI["registerShortcut"]>[1];
type Command = Parameters<ExtensionAPI["registerCommand"]>[1];
type StartHandler = (event: SessionStartEvent, ctx: ExtensionContext) => void | Promise<void>;

const flush = () => new Promise((resolve) => setImmediate(resolve));
const KEY_BYTES = {
	up: "\x1b[A", down: "\x1b[B", right: "\x1b[C", left: "\x1b[D", enter: "\r", escape: "\x1b",
	"shift+up": "\x1b[1;2A", "shift+down": "\x1b[1;2B", "shift+right": "\x1b[1;2C", "shift+left": "\x1b[1;2D",
} as const;
// Stub theme: roles are recorded, so tests can assert which token painted which text.
const stubTheme = { fg: (color: string, text: string) => text, bold: (text: string) => text } as unknown as Parameters<NonNullable<Parameters<ExtensionUIContext["custom"]>[0]>>[1];

function harness(initialModels = LISTED, initial = LISTED[0], initialLevel: ThinkingLevel = "medium", flags: string[] = []) {
	let models = initialModels;
	const shortcuts = new Map<KeyId, Shortcut>();
	const commands = new Map<string, Command>();
	const events = new Map<string, StartHandler>();
	const listeners = new Map<string, ((event: { model: Model<string> }) => void)[]>();
	let dialog: { component: { handleInput(data: string): void }; done: (result: unknown) => void } | undefined;
	const selected: string[] = [];
	const warnings: string[] = [];
	const incompatible: string[] = [];
	let current = initial;
	let thinking = initialLevel;
	let branch: { type: string }[] = [];
	let choice: string | undefined;
	let offered: string[] = [];
	let hasUI = true;
	let allowSet = true;
	const context = {
		get model() { return current; }, get hasUI() { return hasUI; },
		modelRegistry: { getAvailable: () => models }, sessionManager: { getBranch: () => branch },
		// The test double has no AgentSession behind it, so the stock-picker masks report incompatibility.
		ui: {
			notify: (text: string) => (text.startsWith("RQW-models cannot restrict") ? incompatible : warnings).push(text),
			select: async (_title: string, labels: string[]) => { offered = labels; return choice; },
			// Real component through the public custom callback: the test drives input, not the shortcut.
			custom: (factory: (...args: unknown[]) => unknown) => new Promise((resolve) => {
				const component = factory({ requestRender: () => {} }, stubTheme, undefined, (result: unknown) => { dialog = undefined; resolve(result); }) as { handleInput(data: string): void };
				dialog = { component, done: (result) => resolve(result) };
			}),
		},
	};
	// Test double implements only the context and API surface used by this extension.
	const ctx = context as unknown as ExtensionCommandContext;
	const pi = {
		registerProvider: () => {},
		unregisterProvider: () => {},
		registerShortcut: (key: KeyId, options: Shortcut) => shortcuts.set(key, options),
		registerCommand: (key: string, options: Command) => commands.set(key, options),
		on: (name: string, fn: StartHandler | ((event: { model: Model<string> }) => void)) => {
			if (name === "model_select") {
				const list = listeners.get(name) ?? [];
				list.push(fn as (event: { model: Model<string> }) => void);
				listeners.set(name, list);
				return () => listeners.set(name, (listeners.get(name) ?? []).filter((item) => item !== fn));
			}
			events.set(name, fn as StartHandler);
			return () => {};
		},
		getThinkingLevel: () => thinking,
		setThinkingLevel: (level: ThinkingLevel) => { thinking = level; },
		setModel: async (next: Model<string>) => {
			await Promise.resolve();
			if (!allowSet) return false;
			current = next; thinking = "low"; selected.push(`${next.provider}/${next.id}`);
			for (const listener of listeners.get("model_select") ?? []) listener({ model: next });
			return true;
		},
	};
	process.argv = [...ORIGINAL_ARGV.slice(0, 2), ...flags];
	extension(pi as unknown as ExtensionAPI);
	// Pi supplies a lazy event context before it enables snapshot-based TUI shortcuts.
	void events.get("session_start")!({ type: "session_start", reason: "reload" }, ctx);
	const open = (key: KeyId) => shortcuts.get(key)!.handler({ ...context } as unknown as ExtensionContext);
	return {
		shortcuts, commands, selected, warnings, incompatible,
		get dialogOpen() { return dialog !== undefined; },
		// Real component input (arrows, Enter, Esc) while the chooser is open.
		input: async (key: keyof typeof KEY_BYTES) => { dialog?.component.handleInput(KEY_BYTES[key]); await flush(); },
		open: async (key: KeyId) => { void open(key); await flush(); },
		set models(value: Model<string>[]) { models = value; },
		get current() { return current; }, get thinking() { return thinking; }, get offered() { return offered; },
		set branch(value: { type: string }[]) { branch = value; }, set choice(value: string | undefined) { choice = value; },
		set hasUI(value: boolean) { hasUI = value; }, set allowSet(value: boolean) { allowSet = value; },
		// Opens the chooser with the Shift key, then confirms with Enter: one transition.
		press: async (key: KeyId) => { const pending = open(key); await flush(); dialog?.component.handleInput(KEY_BYTES.enter); return pending; },
		start: (reason: SessionStartEvent["reason"] = "startup") => events.get("session_start")!({ type: "session_start", reason }, ctx),
		pick: () => commands.get("rqw-models")!.handler("", ctx),
	};
}

after(() => { process.argv = ORIGINAL_ARGV; setKittyProtocolActive(false); });

describe("RQW model families and Pi thinking capabilities", () => {
	it("offers exactly the listed generations in strongest-first order, no old Claude", () => {
		assert.deepEqual(FAMILIES, ["kimi-for-coding-highspeed", "kimi-for-coding", "k3.1-pro-highspeed", "k3.1-pro", "claude-opus-5-5", "claude-sonnet-5-5", "gpt-6.1-sol", "gpt-6-sol", "claude-haiku-5-5", "gpt-5.6-luna", "gpt-6-luna"]);
		const extra = [model("gpt-5.3-codex-spark"), model("claude-opus-4-8"), model("claude-opus-5"), model("claude-sonnet-5-50"), model("gpt-6-astra")];
		assert.deepEqual(pickerModels([...extra, ...LISTED.toReversed()]), LISTED);
	});
	it("recognizes provider paths, dotted versions, dated aliases and Bedrock without inventing models", () => {
		for (const id of ["anthropic/claude-opus-5.5", "claude-opus-5-5-20261001", "us.anthropic.claude-opus-5-5-v1:0"]) assert.equal(familyOf(model(id, "proxy")), 4, id);
		assert.equal(familyOf(model("openai/gpt-6.1-sol", "proxy")), 6);
		assert.equal(familyOf(model("gpt-6.1-sol-fast")), -1);
		const alias = model("anthropic/claude-opus-5.5", "proxy");
		assert.deepEqual(pickerModels([alias, LISTED[0]]), [LISTED[0]]);
		assert.deepEqual(pickerModels([alias]), [alias]);
		for (const canonical of LISTED) {
			const proxy = model(`proxy/${canonical.id}`, "proxy");
			const other = model(canonical.id, canonical.provider === "anthropic" ? "openai-codex" : "anthropic");
			assert.deepEqual(pickerModels([proxy, other, canonical]), [canonical], canonical.id);
		}
	});
	it("uses explicit OMP family lists, including aliases, intersected with Pi support", () => {
		for (const [index, m] of LISTED.entries()) {
			assert.deepEqual(levelsFor(m), EXPECTED_LEVELS[index], m.id);
			assert.deepEqual(levelsFor({ ...m, id: `proxy/${m.id}`, provider: "proxy" }), EXPECTED_LEVELS[index]);
		}
		assert.deepEqual(levelsFor(model("claude-sonnet-5-5", "anthropic", { low: null, xhigh: null, max: "max" })), ["medium", "high"]);
		assert.deepEqual(levelsFor(model("gpt-6-sol", "openai-codex", {})), ["low", "medium", "high"]);
		assert.deepEqual(levelsFor(model("claude-opus-5-5", "anthropic", { low: null, medium: null, high: null })), []);
		// Unlisted models retain Pi-supported effort choices, without off or minimal.
		assert.deepEqual(levelsFor(model("test", "proxy", {})), ["low", "medium", "high"]);
		assert.deepEqual(levelsFor(model("test", "proxy", { low: null, xhigh: null, max: "max" })), ["medium", "high", "max"]);
		assert.deepEqual(levelsFor(model("test", "proxy", { minimal: null })), ["low", "medium", "high"]);
		assert.deepEqual(levelsFor({ ...LISTED[0], reasoning: false }), []);
		assert.deepEqual(levelsFor(undefined), []);
	});
});

describe("Kimi model families", () => {
	it("puts all four Kimi families before legacy models with their display names", () => {
		const selected = pickerModels([...LISTED, ...KIMI].toReversed());
		assert.deepEqual(selected.map((m) => m.id), [...FAMILIES]);
		assert.deepEqual(selected.slice(0, 4).map((m) => m.name), [
			"Kimi K2.7 Code Highspeed", "Kimi K2.8 Preview", "Kimi K3.1 Pro Highspeed", "Kimi K3.1 Pro",
		]);
		assert.deepEqual(selected.slice(4), LISTED);
	});
	it("has no selectable level for K2.7 Highspeed and only low, high, max for the others", () => {
		for (const [index, m] of KIMI.entries()) {
			const expected = index === 0 ? [] : ["low", "high", "max"];
			assert.deepEqual(levelsFor(m), expected, m.id);
			assert.deepEqual(levelsFor({ ...m, id: `proxy/${m.id}`, provider: "proxy" }), expected);
			assert.equal(levelsFor(m).includes("off"), false);
		}
	});
	it("prefers kimi-coding over canonical and path aliases from other providers", () => {
		for (const canonical of KIMI) {
			const proxy = model(`proxy/${canonical.id}`, "proxy");
			const other = model(canonical.id, "anthropic");
			const preferred = pickerModels([proxy, other, canonical]);
			assert.equal(preferred.length, 1);
			assert.equal(preferred[0].provider, "kimi-coding");
			assert.equal(preferred[0].id, canonical.id);
			assert.deepEqual(pickerModels([proxy]), [proxy]);
		}
	});
	it("builtin Highspeed transport omits reasoning_effort even with high thinking", async () => {
		const provider = kimiCodingProvider();
		const highspeed = provider.getModels().find((m) => m.id === "kimi-for-coding-highspeed")!;
		assert.equal(highspeed.compat?.supportsReasoningEffort, false);
		const requests: Record<string, unknown>[] = [];
		const result = await provider.streamSimple(highspeed, {
			messages: [{ role: "user", content: "offline probe", timestamp: 0 }],
		}, {
			apiKey: "faux-kimi-key", reasoning: "high",
			fetch: async (_input, init) => {
				requests.push(JSON.parse(String(init?.body)));
				const chunk = { id: "offline-kimi", object: "chat.completion.chunk", created: 0,
					model: highspeed.id, choices: [{ index: 0, delta: { role: "assistant", content: "offline reply" }, finish_reason: "stop" }] };
				return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
					headers: { "Content-Type": "text/event-stream" },
				});
			},
		}).result();
		assert.equal(requests.length, 1);
		assert.equal(requests[0].model, highspeed.id);
		assert.equal(Object.hasOwn(requests[0], "reasoning_effort"), false);
		assert.equal(result.stopReason, "stop");
		assert.deepEqual(result.content, [{ type: "text", text: "offline reply" }]);
	});
	it("keeps new-session Opus medium when the stronger Kimi families are available", async () => {
		for (const reason of ["startup", "new"] as const) {
			const h = harness([...KIMI, ...LISTED], KIMI[0], "high");
			await h.start(reason);
			assert.equal(h.current.id, "claude-opus-5-5");
			assert.equal(h.thinking, "medium");
		}
	});
});

describe("shortcuts and picker", () => {
	it("Shift+Up strengthens, Shift+Down weakens, clamps both ends and enters at the matching strength end", async () => {
		const h = harness();
		await h.press("shift+up"); assert.equal(h.selected.length, 0);
		for (const expected of LISTED.slice(1)) { await h.press("shift+down"); assert.equal(h.current, expected); }
		await h.press("shift+down"); assert.equal(h.selected.length, LISTED.length - 1);
		for (const expected of LISTED.slice(0, -1).toReversed()) { await h.press("shift+up"); assert.equal(h.current, expected); }
		await h.press("shift+up"); assert.equal(h.selected.length, (LISTED.length - 1) * 2);
		// An unlisted model survives startup only while no listed model is authenticated, e.g. before /login.
		const outside = model("other");
		const later = async (models: Model<string>[]) => { const h = harness([], outside); await h.start("reload"); h.models = models; return h; };
		const forward = await later(LISTED); await forward.press("shift+up"); assert.equal(forward.current, LISTED[0]);
		const backward = await later(LISTED); await backward.press("shift+down"); assert.equal(backward.current, LISTED.at(-1));
		const sparseModels = [LISTED[1], LISTED[3], LISTED[4]];
		const sparsePlus = await later(sparseModels);
		await sparsePlus.press("shift+up"); assert.equal(sparsePlus.current, LISTED[1]);
		await sparsePlus.press("shift+up"); assert.equal(sparsePlus.selected.length, 1);
		const sparseMinus = await later(sparseModels);
		await sparseMinus.press("shift+down"); assert.equal(sparseMinus.current, LISTED[4]);
		await sparseMinus.press("shift+down"); assert.equal(sparseMinus.selected.length, 1);
	});
	it("recognizes the current family even when resume used another provider variant", async () => {
		const proxySonnet = model("anthropic/claude-sonnet-5.5", "proxy");
		const h = harness(LISTED, proxySonnet);
		await h.press("shift+up"); assert.equal(h.current, LISTED[0]);
	});
	it("serializes quick model presses and preserves the pre-switch thinking level", async () => {
		const h = harness(LISTED, LISTED[0], "high");
		// One chooser: repeated Shift+Down navigates the open draft; a single Enter commits it once.
		await h.open("shift+down"); await h.input("shift+down"); await h.input("down"); assert.equal(h.current, LISTED[0]); assert.equal(h.selected.length, 0);
		await h.input("enter"); await h.input("enter");
		assert.equal(h.current, LISTED[3]); assert.equal(h.thinking, "high");
		assert.deepEqual(h.selected, [`${LISTED[3].provider}/${LISTED[3].id}`]);
	});
	it("queued reasoning reads the new model capabilities, not the keypress snapshot", async () => {
		const limitedOpus = model("claude-opus-5-5", "anthropic", {});
		const h = harness([limitedOpus, LISTED[1]], limitedOpus, "high");
		await h.open("shift+down"); await h.input("right"); await h.input("enter");
		assert.equal(h.current, LISTED[1]); assert.equal(h.thinking, "xhigh");
	});
	it("switching lowers unsupported effort to nearest lower level, or lowest, not Pi's upward clamp", async () => {
		const limited = model("claude-sonnet-5-5", "anthropic", {});
		const h = harness([LISTED[0], limited], LISTED[0], "max");
		await h.press("shift+down"); assert.equal(h.thinking, "high");
		const off = harness(LISTED, LISTED[0], "off"); await off.press("shift+down"); assert.equal(off.thinking, "low");
		const minimal = harness(LISTED, LISTED[1], "minimal"); await minimal.press("shift+up"); assert.equal(minimal.thinking, "low");
		const capped = harness(LISTED, LISTED[2], "max");
		await capped.press("shift+up"); assert.equal(capped.thinking, "xhigh");
		await capped.press("shift+up"); assert.equal(capped.thinking, "high");
	});
	it("cycles only supported reasoning, clamps both ends and handles off/minimal", async () => {
		const h = harness(LISTED, LISTED[2], "off");
		for (const expected of ["low", "medium", "high", "xhigh", "max", "max"]) { await h.press("shift+right"); assert.equal(h.thinking, expected); }
		for (const expected of ["xhigh", "high", "medium", "low", "low"]) { await h.press("shift+left"); assert.equal(h.thinking, expected); }
		const minimal = harness(LISTED, LISTED[0], "minimal"); await minimal.press("shift+left"); assert.equal(minimal.thinking, "low");
		const noThinking = harness(LISTED, { ...LISTED[0], reasoning: false }, "off"); await noThinking.press("shift+right"); assert.equal(noThinking.thinking, "off");
	});
	it("no models, auth lost and cancelled/headless pickers are harmless", async () => {
		const empty = harness([]); await empty.press("shift+up"); await empty.pick(); assert.equal(empty.selected.length, 0); assert.equal(empty.warnings.length, 2);
		const lost = harness(); lost.allowSet = false; await lost.press("shift+down"); assert.equal(lost.current, LISTED[0]); assert.equal(lost.thinking, "medium"); assert.equal(lost.warnings.length, 1);
		const h = harness(); await h.pick(); assert.deepEqual(h.offered, LISTED.map((m) => `${m.provider}/${m.id}`)); assert.equal(h.selected.length, 0);
		h.choice = "openai-codex/gpt-6-sol"; await h.pick(); assert.equal(h.current, LISTED[3]);
		h.hasUI = false; await h.pick(); assert.equal(h.selected.length, 1);
	});
});

describe("real terminal byte sequences through Pi's key matcher", () => {
	// Legacy xterm modified keys (iTerm2, Terminal.app, VS Code terminal) and the Kitty protocol both send CSI 1;2<A-D>.
	const ROWS: [boolean, string, KeyId][] = [
		[false, "\x1b[1;2A", "shift+up"], [false, "\x1b[1;2B", "shift+down"],
		[false, "\x1b[1;2C", "shift+right"], [false, "\x1b[1;2D", "shift+left"],
		[true, "\x1b[1;2A", "shift+up"], [true, "\x1b[1;2B", "shift+down"],
		[true, "\x1b[1;2C", "shift+right"], [true, "\x1b[1;2D", "shift+left"],
		[true, "\x1b[1;2:1A", "shift+up"], [true, "\x1b[1;2:1B", "shift+down"],
		[true, "\x1b[1;2:1C", "shift+right"], [true, "\x1b[1;2:1D", "shift+left"],
	];
	it("Shift+arrow sequences dispatch once: Up/Down change the model, Right/Left change reasoning", async () => {
		for (const [kitty, bytes, key] of ROWS) {
			setKittyProtocolActive(kitty);
			const h = harness(LISTED, LISTED[2]);
			// InteractiveMode takes the first matching registered shortcut, then returns true.
			const matching = [...h.shortcuts.keys()].filter((candidate) => matchesKey(bytes, candidate));
			assert.deepEqual(matching, [key], JSON.stringify(bytes));
			await h.press(key);
			const reasoning = key === "shift+right" || key === "shift+left";
			const lower = key === "shift+down" || key === "shift+left";
			assert.equal(h.selected.length, reasoning ? 0 : 1, JSON.stringify(bytes));
			assert.equal(h.current, reasoning ? LISTED[2] : LISTED[lower ? 3 : 1], JSON.stringify(bytes));
			assert.equal(h.thinking, reasoning ? (lower ? "low" : "high") : "medium", JSON.stringify(bytes));
			assert.equal(h.shortcuts.get(key)!.description, reasoning
				? (lower ? "RQW: decrease reasoning" : "RQW: increase reasoning")
				: (lower ? "RQW: weaker model" : "RQW: stronger model"));
		}
		setKittyProtocolActive(false);
	});
	it("registers exactly the four Shift+arrow keys; the old Alt shortcuts and other arrows are not bound", () => {
		assert.deepEqual([...harness().shortcuts.keys()].sort(), ["shift+down", "shift+left", "shift+right", "shift+up"]);
		for (const kitty of [false, true]) {
			setKittyProtocolActive(kitty);
			for (const bytes of ["\x1b[A", "\x1b[B", "\x1b[C", "\x1b[D", "\x1b[1;3A", "\x1b[1;4A", "\x1b[1;5A", "\x1b[1;6A", "\x1b=", "\x1b-", "\x1b+", "\x1b_", "\x1b[61;3u", "\x1b[45;3u", "\x1b[61:43;4u", "\x1b[45:95;4u"]) {
				assert.equal([...harness().shortcuts.keys()].some((key) => matchesKey(bytes, key)), false, JSON.stringify(bytes));
			}
		}
		setKittyProtocolActive(false);
	});
});

describe("initial selection and explicit choices", () => {
	it("new main session starts Opus medium, including /new", async () => {
		for (const reason of ["startup", "new"] as const) { const h = harness(LISTED, LISTED[3], "high"); await h.start(reason); assert.equal(h.current, LISTED[0]); assert.equal(h.thinking, "medium"); }
	});
	it("respects --model, --thinking, model suffix and explicit off/minimal", async () => {
		for (const [flags, expectedModel, level] of [
			[["--model", "gpt-6-sol"], LISTED[3], "high"],
			[["--model", "gpt-6-sol:high"], LISTED[3], "high"],
			[["--models", "gpt-6-sol:high,gpt-6-luna:low"], LISTED[3], "high"],
			[["--model", "gpt-6-sol", "--thinking", "off"], LISTED[3], "off"],
			[["--thinking", "minimal"], LISTED[0], "minimal"],
			[["--thinking", "low", "--thinking", "high"], LISTED[0], "high"],
		] as const) {
			for (const reason of ["startup", "new"] as const) {
				const h = harness(LISTED, LISTED[3], level, [...flags]); await h.start(reason); assert.equal(h.current, expectedModel); assert.equal(h.thinking, level);
			}
		}
	});
	it("applies explicit thinking to Opus even when Pi clamped the initial non-reasoning model to off", async () => {
		const h = harness(LISTED, { ...LISTED[3], reasoning: false }, "off", ["--thinking", "high"]);
		await h.start(); assert.equal(h.current, LISTED[0]); assert.equal(h.thinking, "high");
	});
	it("does not reset resume, fork, reload, CLI continuation or a startup with history", async () => {
		for (const reason of ["resume", "fork", "reload"] as const) { const h = harness(LISTED, LISTED[4], "max"); await h.start(reason); assert.equal(h.current, LISTED[4]); assert.equal(h.thinking, "max"); }
		for (const flags of [["-c"], ["--continue"], ["--resume"], ["-r"], ["--session", "file"]]) { const h = harness(LISTED, LISTED[4], "max", flags); await h.start(); assert.equal(h.selected.length, 0); assert.equal(h.thinking, "max"); }
		const h = harness(LISTED, LISTED[3], "high"); h.branch = [{ type: "message" }]; await h.start(); assert.equal(h.selected.length, 0); assert.equal(h.thinking, "high");
	});
	it("unlisted startup falls back to Haiku before either Luna when only weak families are authenticated", async () => {
		const weak = LISTED.slice(4);
		for (const available of [weak, weak.slice(1), weak.slice(2)]) {
			const h = harness(available.toReversed(), model("outside"));
			await h.start();
			assert.equal(h.current, available[0]);
			assert.equal(h.thinking, "medium");
		}
	});
	it("no Opus leaves Pi's model, while authenticated proxy Opus is usable", async () => {
		const noOpus = harness(LISTED.slice(1), LISTED[2], "high"); await noOpus.start(); assert.equal(noOpus.current, LISTED[2]); assert.equal(noOpus.thinking, "medium");
		const proxy = model("anthropic/claude-opus-5.5", "proxy"); const h = harness([proxy], LISTED[3]); await h.start(); assert.equal(h.current, proxy);
	});
});

let root: string;
let runtime: ModelRuntime;
let anthropic: FauxProviderHandle;
let codex: FauxProviderHandle;
const catalogue = new Map<string, Model<string>>();
before(async () => {
	root = await mkdtemp(join(tmpdir(), "rqw-models-"));
	runtime = await ModelRuntime.create({ authPath: join(root, "auth.json"), modelsPath: null, refreshOnCreate: false });
	for (const m of LISTED) catalogue.set(m.id, runtime.getModel(m.provider, m.id)!);
	anthropic = fauxProvider({ provider: "anthropic", models: LISTED.filter((m) => m.provider === "anthropic") });
	// GPT 5.3 Codex Spark is a real catalog model outside the RQW list.
	codex = fauxProvider({ provider: "openai-codex", models: [...LISTED.filter((m) => m.provider === "openai-codex"), model("gpt-5.3-codex-spark", "openai-codex")] });
	for (const faux of [anthropic, codex]) {
		for (const m of faux.models) m.thinkingLevelMap = catalogue.get(m.id)?.thinkingLevelMap ?? m.thinkingLevelMap;
		faux.provider.auth.apiKey = { name: "Faux test", resolve: async () => ({ auth: { apiKey: "faux-test-key" } }) };
		runtime.registerNativeProvider(faux.provider);
		await runtime.setRuntimeApiKey(faux.provider.id, "faux-test-key");
	}
	await runtime.getAvailable();
	assert.ok(runtime.hasConfiguredAuth("anthropic"));
	assert.ok(runtime.hasConfiguredAuth("openai-codex"));
});
after(async () => { await rm(root, { recursive: true, force: true }); });

type SessionOptions = {
	enabled?: boolean; manager?: SessionManager; reason?: SessionStartEvent["reason"]; model?: Model<string>; flags?: string[]; thinking?: ThinkingLevel;
	modelRuntime?: ModelRuntime; scopedModels?: { model: Model<string> }[]; factories?: ExtensionFactory[]; ui?: Partial<ExtensionUIContext>; loaded?: (loader: DefaultResourceLoader) => void;
};
async function realSession(options: SessionOptions = {}) {
	process.argv = [...ORIGINAL_ARGV.slice(0, 2), ...(options.flags ?? [])];
	const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: "off" });
	const loader = new DefaultResourceLoader({ cwd: root, agentDir: root, settingsManager: settings, additionalExtensionPaths: options.enabled === false ? [] : [EXTENSION], extensionFactories: options.factories, noSkills: true, noContextFiles: true, noThemes: true, noPromptTemplates: true });
	await loader.reload(); assert.deepEqual(loader.getExtensions().errors, []);
	options.loaded?.(loader);
	const { session } = await createAgentSession({ cwd: root, agentDir: root, modelRuntime: options.modelRuntime ?? runtime, resourceLoader: loader, settingsManager: settings, sessionManager: options.manager ?? SessionManager.inMemory(root), model: options.model ?? (options.manager ? undefined : codex.getModel("gpt-6-sol")), thinkingLevel: options.thinking ?? (options.manager ? undefined : "high"), scopedModels: options.scopedModels, sessionStartEvent: { type: "session_start", reason: options.reason ?? "startup" }, noTools: "all" });
	const errors: string[] = [];
	// Only the dialog and notification methods used by RQW-models are needed.
	await session.bindExtensions({ uiContext: { ...chooserUi(), ...options.ui } as ExtensionUIContext, onError: (error) => errors.push(error.error) }); assert.deepEqual(errors, []);
	return session;
}
// The chooser is a real component reached through the public custom callback; the test sends its input.
let sdkDialog: { handleInput(data: string): void } | undefined;
function chooserUi(): Partial<ExtensionUIContext> {
	return {
		custom: ((factory: (...args: unknown[]) => unknown) => new Promise((resolve) => {
			sdkDialog = factory({ requestRender: () => {} }, stubTheme, undefined, (result: unknown) => { sdkDialog = undefined; resolve(result); }) as { handleInput(data: string): void };
		})) as ExtensionUIContext["custom"],
	};
}
// Shift arrow opens with the draft stepped; Enter confirms. Pass enter=false to leave the chooser open.
async function press(session: AgentSession, key: KeyId, enter = true) {
	const runner = session.extensionRunner;
	const shortcuts = runner.getShortcuts({});
	assert.ok(shortcuts.has(key));
	const pending = shortcuts.get(key)!.handler({ ...runner.createContext() });
	await flush();
	if (enter) sdkDialog?.handleInput(KEY_BYTES.enter);
	await pending;
}

describe("real Pi SDK and faux providers only", () => {
	it("loads standalone, defaults to Opus medium, uses Pi's actual maps and calls only faux", async () => {
		const session = await realSession();
		try {
			assert.equal(session.model?.id, "claude-opus-5-5"); assert.equal(session.thinkingLevel, "medium");
			for (const [index, m] of LISTED.entries()) {
				assert.deepEqual(levelsFor(catalogue.get(m.id)), EXPECTED_LEVELS[index], m.id);
				assert.ok(levelsFor(catalogue.get(m.id)).every((level) => getSupportedThinkingLevels(catalogue.get(m.id)!).includes(level)));
			}
			anthropic.setResponses([fauxAssistantMessage("faux only")]); await session.prompt("hello"); assert.equal(session.getLastAssistantText(), "faux only");
			await press(session, "shift+down"); assert.equal(session.model?.id, "claude-sonnet-5-5"); assert.equal(session.thinkingLevel, "medium");
			await press(session, "shift+right"); assert.equal(session.thinkingLevel, "high");
			const saved = session.settingsManager.getSettings(); assert.equal(saved.defaultModel, undefined); assert.equal(saved.defaultThinkingLevel, undefined);
		} finally { session.dispose(); }
	});
	it("real effort shortcuts obey each OMP list and clamp at both ends", async () => {
		for (const [index, m] of LISTED.entries()) {
			const session = await realSession({ model: (m.provider === "anthropic" ? anthropic : codex).getModel(m.id), flags: ["--model", m.id], thinking: "low" });
			try {
				const expected = EXPECTED_LEVELS[index];
				for (const level of [...expected.slice(1), expected.at(-1)]) {
					await press(session, "shift+right"); assert.equal(session.thinkingLevel, level, m.id);
				}
				for (const level of [...expected.slice(0, -1).toReversed(), "low"]) {
					await press(session, "shift+left"); assert.equal(session.thinkingLevel, level, m.id);
				}
			} finally { session.dispose(); }
		}
	});
	it("Shift+Down then Down inside one chooser commits a single change, Opus to GPT6", async () => {
		const session = await realSession();
		try {
			const pending = session.extensionRunner.getShortcuts({}).get("shift+down")!.handler({ ...session.extensionRunner.createContext() });
			await flush(); sdkDialog?.handleInput(KEY_BYTES.down); sdkDialog?.handleInput(KEY_BYTES.down); sdkDialog?.handleInput(KEY_BYTES.enter); await pending;
			const changes = session.sessionManager.getBranch().filter((entry) => entry.type === "model_change");
			assert.deepEqual(changes.slice(-1).map((entry) => entry.modelId), [LISTED[3].id]);
			assert.equal(session.model?.id, "gpt-6-sol"); assert.equal(session.thinkingLevel, "medium");
		} finally { session.dispose(); }
	});
	it("disabled extension adds no shortcut or default override", async () => {
		const session = await realSession({ enabled: false });
		try { assert.equal(session.model?.id, "gpt-6-sol"); assert.equal(session.thinkingLevel, "high"); assert.equal(session.extensionRunner.getShortcuts({}).size, 0); }
		finally { session.dispose(); }
	});
	it("explicit CLI model/thinking remains Pi's native clamped selection", async () => {
		const session = await realSession({ flags: ["--model", "gpt-6-sol", "--thinking", "off"], thinking: "off" });
		try { assert.equal(session.model?.id, "gpt-6-sol"); assert.equal(session.thinkingLevel, "off"); }
		finally { session.dispose(); }
	});
	it("reload and resumed history retain selected model and reasoning", async () => {
		const manager = SessionManager.inMemory(root);
		const session = await realSession({ manager, reason: "new" });
		try {
			await press(session, "shift+down"); await press(session, "shift+down"); await press(session, "shift+right");
			codex.setResponses([fauxAssistantMessage("saved")]); await session.prompt("save history");
			await session.reload(); assert.equal(session.model?.id, "gpt-6.1-sol"); assert.equal(session.thinkingLevel, "high");
		} finally { session.dispose(); }
		const resumed = await realSession({ manager });
		try { assert.equal(resumed.model?.id, "gpt-6.1-sol"); assert.equal(resumed.thinkingLevel, "high"); }
		finally { resumed.dispose(); }
	});
});

describe("public Kimi catalog registration", () => {
	it("extends the actual SDK catalog with exact K3.1 metadata, preserves OAuth, and restores stock on disable", async () => {
		const own = await ModelRuntime.create({ authPath: join(root, "auth-kimi-registration.json"), modelsPath: null, refreshOnCreate: false });
		const builtin = kimiCodingProvider();
		const original = builtin.getModels();
		const originalIds = original.map((m) => m.id);
		assert.ok(builtin.auth.oauth);
		assert.equal(own.getModel("kimi-coding", "k3.1-pro"), undefined);
		assert.equal(own.getModel("kimi-coding", "k3.1-pro-highspeed"), undefined);
		let enabled = true;
		const session = await realSession({ modelRuntime: own, model: own.getModel("anthropic", "claude-opus-5-5"), loaded: (loader) => {
			const reload = loader.reload.bind(loader);
			loader.reload = async () => { if (enabled) await reload(); else loader.getExtensions().extensions.length = 0; };
		} });
		try {
			const provider = own.getProvider("kimi-coding")!;
			assert.ok(provider.auth.oauth, "built-in OAuth remains available without credentials");
			assert.deepEqual(Object.keys(provider.auth.oauth).sort(), Object.keys(builtin.auth.oauth!).sort());
			assert.deepEqual(provider.getModels().map((m) => m.id), [...originalIds, "k3.1-pro", "k3.1-pro-highspeed"]);
			for (const originalModel of original) assert.deepEqual(own.getModel("kimi-coding", originalModel.id), { ...originalModel, headers: undefined });
			for (const [id, name, inputCost, outputCost] of [
				["k3.1-pro", "Kimi K3.1 Pro", 2, 10],
				["k3.1-pro-highspeed", "Kimi K3.1 Pro Highspeed", 4, 20],
			] as const) {
				const registered = own.getModel("kimi-coding", id)!;
				assert.deepEqual(registered, {
					id, name, provider: "kimi-coding", api: "openai-completions", headers: undefined,
					baseUrl: "https://api.kimi.com/coding/v1",
					reasoning: true, input: ["text", "image"],
					cost: { input: inputCost, output: outputCost, cacheRead: 0.2, cacheWrite: 0 },
					contextWindow: 1048576, maxTokens: 131072,
					thinkingLevelMap: { off: null, minimal: null, low: "low", medium: null, high: "high", xhigh: null, max: "max" },
					compat: {
						supportsStrictMode: false, supportsStore: false, supportsDeveloperRole: false,
						supportsReasoningEffort: true, maxTokensField: "max_tokens", thinkingFormat: "openai",
						requiresReasoningContentOnAssistantMessages: true,
						supportsMidConvoSystemMessages: true, supportsMidConvoToolAdditions: true,
					},
					inputLimits: { images: { resize: { maxWidth: 2000, maxHeight: 2000, maxBytes: 4718592, jpegQuality: 80 } } },
				});
				assert.deepEqual(levelsFor(registered), ["low", "high", "max"]);
			}
			enabled = false;
			await session.reload();
			assert.deepEqual(own.getProvider("kimi-coding")!.getModels(), original);
			assert.ok(own.getProvider("kimi-coding")!.auth.oauth);
			assert.equal(own.getModel("kimi-coding", "k3.1-pro"), undefined);
			assert.equal(own.getModel("kimi-coding", "k3.1-pro-highspeed"), undefined);
		} finally { session.dispose(); }
	});
});

describe("only RQW-listed models: stock selection closed, requests refused", () => {
	const unlisted = () => codex.getModel("gpt-5.3-codex-spark")!;
	const stockAvailable = () => ModelRuntime.prototype.getAvailableSnapshot.call(runtime).length;
	const ui = (notes: string[], pick?: (labels: string[]) => string | undefined): Partial<ExtensionUIContext> => ({
		notify: (text: string) => { notes.push(text); }, select: async (_title: string, labels: string[]) => pick?.(labels),
	});
	it("empties the stock snapshot and scoped list; Ctrl+P cannot switch; /rqw-models and Shift+arrow keys still work", async () => {
		let offered: string[] = [];
		const notes: string[] = [];
		const scoped = [{ model: unlisted() }, { model: codex.getModel("gpt-6-sol")! }];
		const session = await realSession({ scopedModels: scoped, ui: ui(notes, (labels) => { offered = labels; return labels[2]; }) });
		try {
			assert.ok(stockAvailable() > LISTED.length);
			assert.deepEqual(runtime.getAvailableSnapshot(), []);
			assert.deepEqual(session.scopedModels, []);
			assert.deepEqual(session.extensionRunner.createContext().modelRegistry.getAvailable(), []);
			assert.equal(session.model?.id, "claude-opus-5-5");
			assert.equal(await session.cycleModel("forward"), undefined);
			assert.equal(await session.cycleModel("backward"), undefined);
			assert.equal(session.model?.id, "claude-opus-5-5");
			await press(session, "shift+down"); assert.equal(session.model?.id, "claude-sonnet-5-5");
			await session.extensionRunner.getCommand("rqw-models")!.handler("", session.extensionRunner.createCommandContext());
			assert.deepEqual(offered, LISTED.map((m) => `${m.provider}/${m.id}`));
			assert.equal(session.model?.id, "gpt-6.1-sol");
			assert.deepEqual(notes, []);
		} finally { session.dispose(); }
		// SDK dispose without session_shutdown releases every mask on the shared runtime and the session.
		assert.ok(runtime.getAvailableSnapshot().length > LISTED.length);
		assert.equal(Object.getOwnPropertySymbols(runtime).some((key) => key.description?.startsWith("rqw-models")), false);
		for (const key of ["scopedModels", "setModel", "dispose"]) assert.equal(Object.hasOwn(session, key), false, key);
		assert.deepEqual(session.scopedModels, scoped);
	});
	it("refuses an extension or stock setModel outside the list before any mutation, with a warning", async () => {
		let api!: ExtensionAPI;
		const selects: string[] = [];
		const notes: string[] = [];
		const probe: ExtensionFactory = (pi) => { api = pi; pi.on("model_select", (event) => { selects.push(event.model.id); }); };
		const session = await realSession({ factories: [probe], ui: ui(notes) });
		try {
			const entries = session.sessionManager.getBranch().length;
			selects.length = 0;
			const refusal = /openai-codex\/gpt-5\.3-codex-spark is not in the RQW models list\. Allowed: kimi-for-coding-highspeed, kimi-for-coding, k3\.1-pro-highspeed, k3\.1-pro, claude-opus-5-5, claude-sonnet-5-5, gpt-6\.1-sol, gpt-6-sol, claude-haiku-5-5, gpt-5\.6-luna, gpt-6-luna\./;
			await assert.rejects(api.setModel(unlisted()), refusal);
			await assert.rejects(session.setModel(unlisted(), { persist: true }), refusal);
			assert.equal(session.model?.id, "claude-opus-5-5"); assert.equal(session.thinkingLevel, "medium");
			assert.equal(session.sessionManager.getBranch().length, entries);
			assert.deepEqual(selects, []);
			assert.equal(session.settingsManager.getDefaultModel(), undefined);
			assert.equal(notes.length, 2); assert.match(notes[0], refusal);
			// Any provider variant of a listed family remains selectable.
			assert.equal(await api.setModel(codex.getModel("gpt-6-luna")!), true);
			assert.equal(session.model?.id, "gpt-6-luna"); assert.deepEqual(selects, ["gpt-6-luna"]);
		} finally { session.dispose(); }
	});
	it("replaces a restored or resumed session model outside the list with Opus medium and a warning", async () => {
		for (const reason of ["startup", "resume"] as const) {
			const manager = SessionManager.inMemory(root);
			const old = await realSession({ enabled: false, manager, model: unlisted(), thinking: "high", reason: "new" });
			try { codex.setResponses([fauxAssistantMessage("old history")]); await old.prompt("history"); assert.equal(old.model?.id, "gpt-5.3-codex-spark"); }
			finally { old.dispose(); }
			const notes: string[] = [];
			const restored = await realSession({ manager, reason, ui: ui(notes) });
			try {
				assert.equal(restored.model?.id, "claude-opus-5-5"); assert.equal(restored.thinkingLevel, "medium");
				assert.deepEqual(notes, [`openai-codex/gpt-5.3-codex-spark is not in the RQW models list. Allowed: ${FAMILIES.join(", ")}. Switched to anthropic/claude-opus-5-5 (medium).`]);
			} finally { restored.dispose(); }
		}
	});
	it("refuses a subagent-style session on the shared runtime with a clear error naming the allowed models", async () => {
		const main = await realSession();
		const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: "off" });
		const loader = new DefaultResourceLoader({ cwd: root, agentDir: root, settingsManager: settings, noExtensions: true, noSkills: true, noContextFiles: true, noThemes: true, noPromptTemplates: true });
		await loader.reload();
		const child = async (m: Model<string>) => (await createAgentSession({ cwd: root, agentDir: root, modelRuntime: runtime, resourceLoader: loader, settingsManager: settings, sessionManager: SessionManager.inMemory(root), model: m, thinkingLevel: "low", noTools: "all" })).session;
		const sub = await child(unlisted());
		try {
			codex.setResponses([fauxAssistantMessage("must not be requested")]);
			await sub.prompt("hello");
			const last = sub.messages.at(-1) as { role: string; stopReason?: string; errorMessage?: string };
			assert.equal(last.role, "assistant"); assert.equal(last.stopReason, "error");
			assert.equal(last.errorMessage, `RQW-models refused the request: openai-codex/gpt-5.3-codex-spark is not in the RQW models list. Allowed: ${FAMILIES.join(", ")}.`);
			assert.equal(codex.getPendingResponseCount(), 1);
			const listed = await child(codex.getModel("gpt-6-sol")!);
			try { await listed.prompt("hello"); assert.equal(listed.getLastAssistantText(), "must not be requested"); }
			finally { listed.dispose(); }
		} finally { main.dispose(); }
		// Without an owning RQW-models session the runtime is stock again.
		try { codex.setResponses([fauxAssistantMessage("stock again")]); await sub.prompt("again"); assert.equal(sub.getLastAssistantText(), "stock again"); }
		finally { sub.dispose(); }
	});
	it("offers only Pi's credential-aware availability: a provider filterModels that drops a family", async () => {
		const register = () => runtime.registerNativeProvider(codex.provider);
		// A developer's real provider keys (for example OpenRouter) would supply another gpt-6-sol variant.
		const savedEnv = { ...process.env };
		for (const key of Object.keys(process.env)) if (/(?:_API_KEY|_TOKEN|_SECRET)$/.test(key)) delete process.env[key];
		codex.provider.filterModels = (models) => models.filter((m) => m.id !== "gpt-6-sol");
		register(); await runtime.getAvailable();
		let offered: string[] = [];
		const session = await realSession({ ui: ui([], (labels) => { offered = labels; return undefined; }) });
		try {
			assert.ok(runtime.hasConfiguredAuth("openai-codex"));
			// Extension registration starts another availability refresh after the initial fixture pass.
			await runtime.getAvailable();
			await session.extensionRunner.getCommand("rqw-models")!.handler("", session.extensionRunner.createCommandContext());
			assert.deepEqual(offered, LISTED.filter((m) => m.id !== "gpt-6-sol").map((m) => `${m.provider}/${m.id}`));
			for (const id of ["claude-sonnet-5-5", "gpt-6.1-sol", "claude-haiku-5-5", "gpt-5.6-luna", "gpt-6-luna"]) { await press(session, "shift+down"); assert.equal(session.model?.id, id); }
		} finally {
			session.dispose();
			delete codex.provider.filterModels;
			Object.assign(process.env, savedEnv);
			register(); await runtime.getAvailable();
		}
	});
	it("startup waits for a pending availability pass before choosing Opus medium", async () => {
		const own = await ModelRuntime.create({ authPath: join(root, "auth-pending.json"), modelsPath: null, refreshOnCreate: false });
		let opened = false;
		let open!: () => void;
		const gate = new Promise<void>((resolve) => { open = () => { opened = true; resolve(); }; });
		const laterGate = Promise.withResolvers<void>();
		const laterSignal = new AbortController().signal;
		const getAvailable = own.getAvailable.bind(own);
		let laterPass: Promise<Model<string>[]> | undefined;
		let laterFinished = false;
		const opus = fauxProvider({ provider: "anthropic", models: [model("claude-opus-5-5")] });
		const other = fauxProvider({ provider: "openai-codex", models: [model("gpt-5.3-codex-spark", "openai-codex")] });
		for (const faux of [opus, other]) {
			// Auth only from a resolver: Pi marks nothing provisionally and waits for its availability pass.
			faux.provider.auth.apiKey = { name: "Gated faux", resolve: async ({ signal }) => {
				await (signal === laterSignal ? laterGate.promise : gate);
				return { auth: { apiKey: "faux-test-key" } };
			} };
			// A later background refresh supersedes the startup's whole-runtime pass. Pi discards
			// that older pass's results and returns its still-empty shared snapshot instead.
			faux.provider.filterModels = (models) => {
				if (!laterPass) laterPass = getAvailable(undefined, { signal: laterSignal }).then((result) => { laterFinished = true; return result; });
				return models;
			};
			own.registerNativeProvider(faux.provider);
		}
		assert.equal(own.hasConfiguredAuth("anthropic"), false);
		const notes: string[] = [];
		const session = await realSession({ modelRuntime: own, model: other.getModel("gpt-5.3-codex-spark"), ui: ui(notes), loaded: () => {
			assert.equal(opened, false);
			// Release auth only after startup actually requests availability, not after a wall-clock delay.
			own.getAvailable = (...args) => { const result = getAvailable(...args); open(); return result; };
		} });
		try {
			assert.equal(opened, true);
			assert.ok(laterPass);
			assert.equal(laterFinished, false);
			assert.equal(session.model?.id, "claude-opus-5-5"); assert.equal(session.thinkingLevel, "medium");
			assert.deepEqual(notes, []);
		} finally {
			session.dispose();
			laterGate.resolve();
			await laterPass;
		}
	});
	it("keeps an unlisted model with a warning when no listed model is authenticated, and refuses its requests", async () => {
		const savedEnv = { ...process.env };
		for (const key of Object.keys(process.env)) if (/(?:_API_KEY|_TOKEN|_SECRET)$/.test(key)) delete process.env[key];
		const own = await ModelRuntime.create({ authPath: join(root, "auth-unlisted.json"), modelsPath: null, refreshOnCreate: false });
		const only = fauxProvider({ provider: "openai-codex", models: [model("gpt-5.3-codex-spark", "openai-codex")] });
		only.provider.auth.apiKey = { name: "Faux test", resolve: async () => ({ auth: { apiKey: "faux-test-key" } }) };
		own.registerNativeProvider(only.provider);
		await own.getAvailable();
		const notes: string[] = [];
		const session = await realSession({ modelRuntime: own, model: only.getModel("gpt-5.3-codex-spark"), ui: ui(notes) });
		try {
			assert.equal(session.model?.id, "gpt-5.3-codex-spark");
			assert.deepEqual(notes, [`openai-codex/gpt-5.3-codex-spark is not in the RQW models list. Allowed: ${FAMILIES.join(", ")}. No listed model is authenticated; its requests are refused.`]);
			only.setResponses([fauxAssistantMessage("must not be requested")]);
			await session.prompt("hello");
			assert.match((session.messages.at(-1) as { errorMessage?: string }).errorMessage ?? "", /^RQW-models refused the request: openai-codex\/gpt-5\.3-codex-spark is not in the RQW models list/);
			assert.equal(only.getPendingResponseCount(), 1);
		} finally {
			session.dispose();
			for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
			Object.assign(process.env, savedEnv);
		}
	});
	it("switching RQW-models off with /reload restores stock selection", async () => {
		let enabled = true;
		const scoped = [{ model: unlisted() }, { model: codex.getModel("gpt-6-sol")! }];
		const session = await realSession({ scopedModels: scoped, loaded: (loader) => {
			const reload = loader.reload.bind(loader);
			loader.reload = async () => { if (enabled) await reload(); else loader.getExtensions().extensions.length = 0; };
		} });
		try {
			assert.deepEqual(runtime.getAvailableSnapshot(), []);
			enabled = false;
			await session.reload();
			assert.ok(runtime.getAvailableSnapshot().length > LISTED.length);
			assert.deepEqual(session.scopedModels, scoped);
			assert.equal(session.model?.id, "claude-opus-5-5");
			assert.equal((await session.cycleModel("forward"))?.model.id, "gpt-6-sol");
			await session.setModel(codex.getModel("gpt-6-luna")!); assert.equal(session.model?.id, "gpt-6-luna");
			await session.setModel(unlisted()); assert.equal(session.model?.id, "gpt-5.3-codex-spark");
		} finally { session.dispose(); }
	});
});

const exec = promisify(execFile);
const CLI = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")).replace(/dist[\\/]index\.js$/, "dist/cli.js");
// The installed `pi` command runs Pi's CLI bundle, which has its own module graph.
const BUNDLE = CLI.replace(/cli\.js$/, join("bundle", "cli.js"));
const FAUX = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "faux.ts");
let cliCounter = 0;
let cliStderr = "";
async function cli(flags: string[], noAnthropic = false, settings?: Record<string, unknown>, entry = CLI) {
	const dir = join(root, `cli-${cliCounter++}`);
	await mkdir(dir);
	// Seed auth before native-provider registration starts its asynchronous snapshot refreshes.
	await writeFile(join(dir, "models.json"), JSON.stringify({ providers: { "openai-codex": { apiKey: "faux-only" } } }));
	if (settings) await writeFile(join(dir, "settings.json"), JSON.stringify(settings));
	const child = exec(process.execPath, [entry, "--extension", FAUX, "--extension", EXTENSION,
		"--no-tools", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files", "--no-mcp", "--no-session", "--print", ...flags, "faux probe"], {
		cwd: dir, timeout: 20000,
		env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
			TMPDIR: process.env.TMPDIR, TMP: process.env.TMP, TEMP: process.env.TEMP, HOME: dir, USERPROFILE: dir,
			PI_CODING_AGENT_DIR: dir, PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1", RQW_TEST_NO_ANTHROPIC: noAnthropic ? "1" : "" },
	});
	child.child.stdin?.end();
	const { stdout, stderr } = await child;
	cliStderr = stderr;
	assert.doesNotMatch(stderr, /Failed to load|Extension error/);
	return JSON.parse(stdout.trim());
}
describe("real Pi CLI, no network and faux transport", () => {
	it("starts Opus medium through the actual CLI", async () => {
		assert.deepEqual(await cli([]), { provider: "anthropic", model: "claude-opus-5-5", thinking: "medium" });
	});
	it("respects real --model/--thinking and model thinking suffix", async () => {
		assert.deepEqual(await cli(["--model", "openai-codex/gpt-5.6-luna:max"]), { provider: "openai-codex", model: "gpt-5.6-luna", thinking: "max" });
		assert.deepEqual(await cli(["--model", "openai-codex/gpt-6-sol", "--thinking", "off"]), { provider: "openai-codex", model: "gpt-6-sol", thinking: "off" });
		assert.deepEqual(await cli(["--model", "openai-codex/gpt-6-luna:high"]), { provider: "openai-codex", model: "gpt-6-luna", thinking: "high" });
	});
	it("preserves Pi-resolved --models efforts and mixed scoped suffixes", async () => {
		assert.deepEqual(await cli(["--models", "openai-codex/gpt-6-sol:high"]), { provider: "openai-codex", model: "gpt-6-sol", thinking: "high" });
		const mixed = ["--models", "openai-codex/gpt-6-luna:low,openai-codex/gpt-6-sol:high"];
		assert.deepEqual(await cli(mixed), { provider: "openai-codex", model: "gpt-6-luna", thinking: "low" });
		assert.deepEqual(await cli(mixed, false, { defaultProvider: "openai-codex", defaultModel: "gpt-6-sol" }), { provider: "openai-codex", model: "gpt-6-sol", thinking: "high" });
		assert.deepEqual(await cli([...mixed, "--thinking", "off"]), { provider: "openai-codex", model: "gpt-6-luna", thinking: "off" });
	});
	it("keeps Pi settings effort for an explicit model without a suffix", async () => {
		assert.deepEqual(await cli(["--model", "openai-codex/gpt-6-sol"], false, { defaultThinkingLevel: "low" }), { provider: "openai-codex", model: "gpt-6-sol", thinking: "low" });
	});
	it("does not select Opus without auth and keeps Pi's listed initial model", async () => {
		assert.deepEqual(await cli([], true), { provider: "openai-codex", model: "gpt-6.1-sol", thinking: "medium" });
		assert.equal(cliStderr, "");
	});
	it("replaces a CLI --model or saved default outside the list with the default and a warning", async () => {
		const warning = /Warning: openai-codex\/gpt-5\.3-codex-spark is not in the RQW models list\. Allowed: kimi-for-coding-highspeed, kimi-for-coding, k3\.1-pro-highspeed, k3\.1-pro, claude-opus-5-5, .*gpt-6-luna\. Switched to anthropic\/claude-opus-5-5 \(medium\)/;
		assert.deepEqual(await cli(["--model", "openai-codex/gpt-5.3-codex-spark"]), { provider: "anthropic", model: "claude-opus-5-5", thinking: "medium" });
		assert.match(cliStderr, warning);
		assert.deepEqual(await cli([], false, { defaultProvider: "openai-codex", defaultModel: "gpt-5.3-codex-spark", defaultThinkingLevel: "high" }),
			{ provider: "anthropic", model: "claude-opus-5-5", thinking: "medium" });
		// A fresh startup always selects Opus first, so this saved default never becomes current.
		assert.equal(cliStderr, "");
		// Without Opus auth the strongest authenticated listed model replaces it; explicit --thinking still applies.
		assert.deepEqual(await cli(["--model", "openai-codex/gpt-5.3-codex-spark", "--thinking", "minimal"], true), { provider: "openai-codex", model: "gpt-6.1-sol", thinking: "minimal" });
		assert.match(cliStderr, /gpt-5\.3-codex-spark is not in the RQW models list.*Switched to openai-codex\/gpt-6\.1-sol \(minimal\)/);
		assert.deepEqual(await cli([], true, { defaultProvider: "openai-codex", defaultModel: "gpt-5.3-codex-spark", defaultThinkingLevel: "high" }),
			{ provider: "openai-codex", model: "gpt-6.1-sol", thinking: "medium" });
		assert.match(cliStderr, /gpt-5\.3-codex-spark is not in the RQW models list.*Switched to openai-codex\/gpt-6\.1-sol \(medium\)/);
		assert.deepEqual(await cli(["--models", "openai-codex/gpt-5.3-codex-spark:high"]), { provider: "anthropic", model: "claude-opus-5-5", thinking: "medium" });
		// The bundle lends its own AgentSession to the extension too: no incompatibility warning.
		assert.deepEqual(await cli(["--model", "openai-codex/gpt-5.3-codex-spark"], false, undefined, BUNDLE), { provider: "anthropic", model: "claude-opus-5-5", thinking: "medium" });
		assert.match(cliStderr, warning);
		assert.doesNotMatch(cliStderr, /cannot restrict/);
	});
});
