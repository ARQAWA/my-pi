// The GPT Fast lightning: pure renders (frames, idle, widths) and the real extension in a real Pi session, where the
// state arrives through pi.events from a stand-in for RQW-settings (this test loads only RQW-statusbar).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { type Component, visibleWidth } from "@earendil-works/pi-tui";
import * as pi from "@earendil-works/pi-coding-agent";
import { type BarState, FAST_YELLOW, fastMark, ICON, modelRow, renderBar, SHIMMER } from "../render.ts";

const base: BarState = {
	model: { id: "gpt-6.1-sol", name: "GPT 6.1 Sol", reasoning: true }, thinkingLevel: "high",
	compactions: 0, place: { kind: "folder", text: "x" }, statuses: [],
};
const sgr = (color: string) => `\x1b[1;${color}m${ICON.fast}\x1b[22;39m`;
const plain = (text: string) => stripVTControlCharacters(text);

describe("GPT Fast lightning render", () => {
	it("idle: the static bright yellow bolt right after the model name, before the level; no state: no bolt", () => {
		const row = modelRow({ ...base, fast: {} }, 60);
		// The bolt's own colour sits right after the name; the high level's effort colour follows it, the visible text is plain.
		assert.equal(row.startsWith(` ${ICON.model} GPT 6.1 Sol ${sgr(FAST_YELLOW)} `), true, JSON.stringify(row));
		assert.equal(row.includes(` \x1b[1;38;2;201;162;39mhi\x1b[22;39m`), true, JSON.stringify(row));
		assert.equal(plain(row).startsWith(` ${ICON.model} GPT 6.1 Sol ${ICON.fast} hi`), true, JSON.stringify(row));
		const left = ` ${ICON.model} GPT 6.1 Sol ${ICON.fast} hi`;
		assert.equal(plain(row), `${left}${" ".repeat(60 - left.length - "cmp 0".length)}cmp 0`);
		assert.equal(FAST_YELLOW, "93", "SGR bright yellow");
		assert.ok(!modelRow(base, 60).includes(ICON.fast));
		assert.equal(plain(modelRow(base, 60)).startsWith(` ${ICON.model} GPT 6.1 Sol hi `), true, "the model glyph stays in front, as before");
		// A model without reasoning has no level: the bolt ends the left part.
		assert.equal(plain(modelRow({ ...base, model: { id: "x", name: "X" }, fast: {} }, 30)).startsWith(` ${ICON.model} X ${ICON.fast} `), true);
		assert.ok(!renderBar({ ...base, thinkingLevel: "low" }, 60).join("\n").includes("\x1b"), "no level colour and no bolt: plain");
		assert.ok(renderBar({ ...base, fast: {} }, 60)[1].includes(sgr(FAST_YELLOW)), "the bolt carries its own colour");
	});

	it("working: one shimmer cycle goes yellow, paler yellow, white and back; frames wrap", () => {
		assert.deepEqual(SHIMMER, ["38;5;220", "38;5;226", "38;5;229", "97", "38;5;229", "38;5;226"]);
		const frames = SHIMMER.map((_, frame) => fastMark(frame));
		assert.deepEqual(frames, SHIMMER.map(sgr));
		assert.equal(new Set(frames).size, 4);
		assert.ok(frames[3].includes(";97m"), "the white peak");
		assert.ok(frames[0].includes("38;5;220") && frames[5].includes("38;5;226"), "yellow on both sides");
		assert.equal(fastMark(SHIMMER.length), fastMark(0));
		assert.equal(fastMark(-1), fastMark(SHIMMER.length - 1));
		assert.notEqual(fastMark(0), fastMark(undefined), "shimmer is not the idle colour");
		for (let frame = 0; frame < SHIMMER.length; frame++) {
			assert.equal(plain(modelRow({ ...base, fast: { frame } }, 60)), plain(modelRow({ ...base, fast: {} }, 60)), "colour only, same cells");
		}
	});

	it("the bolt is one cell, takes ANSI colour and never overflows a row at any width", () => {
		assert.equal(visibleWidth(ICON.fast), 1);
		for (let width = 0; width <= 120; width++) {
			for (const fast of [{}, { frame: 3 }]) {
				for (const row of renderBar({ ...base, rate: 40, statuses: ["status"], fast }, width)) assert.ok(visibleWidth(row) <= width, `${width}: ${JSON.stringify(row)}`);
			}
		}
	});
});

const jwt = ["e30", Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acct" } })).toString("base64url"), "sig"].join(".");

/** A real Pi session with RQW-statusbar and a stand-in for RQW-settings answering the query channel with `state.fast`. */
async function mount() {
	const cwd = mkdtempSync(join(tmpdir(), "rqw-status-fast-"));
	const agentDir = join(cwd, "agent"); mkdirSync(agentDir);
	writeFileSync(join(agentDir, "auth.json"), JSON.stringify({
		"openai-codex": { type: "oauth", access: jwt, refresh: "r", expires: Date.now() + 3_600_000 },
		anthropic: { type: "api_key", key: "sk-ant-api03-fake" } }));
	let component: (Component & { dispose?(): void }) | undefined;
	const counter = { renders: 0 };
	let editor: Parameters<pi.ExtensionUIContext["setEditorComponent"]>[0];
	const state = { fast: true as boolean | undefined };
	const bus = pi.createEventBus();
	const loader = new pi.DefaultResourceLoader({ cwd, agentDir, additionalExtensionPaths: [fileURLToPath(new URL("../index.ts", import.meta.url))],
		noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, eventBus: bus,
		extensionFactories: [(api) => {
			api.events.on("rqw-settings:fast-gpt-query", (query) => { if (state.fast !== undefined) (query as { fastGpt?: boolean }).fastGpt = state.fast; });
		}] });
	await loader.reload();
	assert.deepEqual(loader.getExtensions().errors, []);
	const runtime = await pi.ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
	await runtime.refresh({ allowNetwork: false });
	const codex = runtime.getModels("openai-codex").find((m) => m.id === "gpt-6.1-sol")!;
	const claude = runtime.getModels("anthropic").find((m) => m.id === "claude-opus-5-5")!;
	const { session } = await pi.createAgentSession({ cwd, agentDir, model: codex, modelRuntime: runtime, resourceLoader: loader,
		sessionManager: pi.SessionManager.inMemory(cwd), settingsManager: pi.SettingsManager.inMemory({ compaction: { enabled: false } }) });
	await session.bindExtensions({ mode: "tui", uiContext: {
		setFooter(factory) {
			component?.dispose?.();
			component = factory?.({ requestRender() { counter.renders++; } } as never, { fg: (_role: string, text: string) => text } as never,
				{ getExtensionStatuses: () => new Map(), onBranchChange: () => () => {} } as never);
		}, notify() {},
		setEditorComponent(factory) { editor = factory; }, getEditorComponent: () => editor,
		setWidget() {}, setWorkingVisible() {},
	} as pi.ExtensionUIContext });
	return { session, state, bus, codex, claude, counter,
		row: () => component!.render(100)[0],
		emit: (event: object) => session.extensionRunner.emit(event as never),
		close: () => { session.dispose(); rmSync(cwd, { recursive: true, force: true }); } };
}

describe("GPT Fast lightning in a real session", () => {
	it("shows only with fast on and a GPT (openai-codex) model; shimmers while the agent works, static when idle; follows /fast-gpt", async (t) => {
		const m = await mount();
		const { session, state, bus, codex, claude, row, emit, counter } = m;
		const bolt = (text: string) => text.includes(ICON.fast);
		try {
			assert.ok(row().includes(sgr(FAST_YELLOW)), "GPT with fast on, idle: static bright yellow");
			assert.equal(row(), row(), "idle render is stable");

			t.mock.timers.enable({ apis: ["setInterval", "Date"] });
			t.mock.method(performance, "now", () => Date.now());
			const before = counter.renders;
			await emit({ type: "agent_start" });
			assert.ok(counter.renders > before, "agent_start redraws");
			assert.ok(row().includes(sgr(SHIMMER[0])), "working starts at frame 0");
			const seen: string[] = [];
			for (let i = 0; i < SHIMMER.length; i++) { t.mock.timers.tick(120); seen.push(row()); }
			assert.deepEqual(seen.map((r) => SHIMMER.findIndex((c) => r.includes(sgr(c)))), [1, 2, 3, 2, 1, 0], "frames 1..6 by colour; the pale steps repeat their colour");
			// The pulse keeps one colour step per 120 ms of elapsed time while the timer redraws every 20 ms.
			t.mock.timers.tick(100);
			assert.ok(row().includes(sgr(SHIMMER[0])), "100 ms later (5 ticks): still the same step");
			t.mock.timers.tick(20);
			assert.ok(row().includes(sgr(SHIMMER[1])), "at 120 ms: the next step");
			assert.ok(counter.renders > before + SHIMMER.length, "every shimmer step asks for a redraw");
			await emit({ type: "agent_end" });
			await emit({ type: "agent_settled" });
			const idle = row();
			const count = counter.renders;
			t.mock.timers.tick(1200);
			assert.equal(counter.renders, count, "no timer runs while idle");
			assert.ok(idle.includes(sgr(FAST_YELLOW)), "idle again: static bright yellow");

			// /fast-gpt off: the change event redraws and the bolt is gone; on: back.
			state.fast = false; bus.emit("rqw-settings:fast-gpt", { on: false });
			assert.equal(bolt(row()), false);
			assert.ok(counter.renders > count, "the change event redraws");
			state.fast = true; bus.emit("rqw-settings:fast-gpt", { on: true });
			assert.equal(bolt(row()), true);

			// Claude: no bolt even with fast on; back to GPT: bolt.
			await session.setModel(claude);
			assert.equal(bolt(row()), false);
			assert.match(plain(row()), /Opus/);
			await session.setModel(codex);
			assert.equal(bolt(row()), true);

			// RQW-settings not loaded: nobody answers, no bolt.
			state.fast = undefined;
			assert.equal(bolt(row()), false);
			state.fast = true;

			// Working while the footer is replaced by a new session start: the shimmer follows the new footer.
			await emit({ type: "agent_start" });
			await emit({ type: "session_start", reason: "new" });
			// The new session samples the real main state through ctx.isIdle(): nothing runs, so the bolt is static.
			assert.ok(row().includes(sgr(FAST_YELLOW)), "a new session starts from the real idle state");
			await emit({ type: "agent_end" });
			await emit({ type: "session_shutdown", reason: "quit" });
		} finally { t.mock.timers.reset(); m.close(); }
	});

	it("agent_settled without agent_end: the bolt goes static and no timer runs with zero children", async (t) => {
		const m = await mount();
		const { row, emit, counter } = m;
		t.mock.timers.enable({ apis: ["setInterval"] });
		try {
			await emit({ type: "agent_start" });
			await emit({ type: "agent_settled" });
			assert.ok(row().includes(sgr(FAST_YELLOW)), "settled without agent_end: static bright yellow");
			const count = counter.renders;
			t.mock.timers.tick(1200);
			assert.equal(counter.renders, count, "settled without agent_end: no timer renders");
			assert.ok(row().includes(sgr(FAST_YELLOW)), "still static bright yellow after the clock advanced");
			await emit({ type: "session_shutdown", reason: "quit" });
		} finally { t.mock.timers.reset(); m.close(); }
	});

	it("the status letters animate while the main chat works, with or without the lightning; the timer stops once settled", async (t) => {
		const m = await mount();
		const { session, state, bus, codex, claude, row, emit } = m;
		t.mock.timers.enable({ apis: ["setInterval"] });
		/** Redraws caused by 1.2 s of timer time: zero means no timer is running. */
		const ticks = () => { const before = m.counter.renders; t.mock.timers.tick(1200); return m.counter.renders - before; };
		try {
			// Claude model: no lightning, and the status letters still shimmer while the agent works.
			await session.setModel(claude);
			await emit({ type: "agent_start" });
			assert.ok(ticks() >= 10, "Claude: the status letters animate");
			await emit({ type: "agent_end" });
			await emit({ type: "agent_settled" });
			assert.equal(ticks(), 0, "settled: no timer");
			await session.setModel(codex);

			// GPT Fast off: the letters still animate, the bolt is gone.
			state.fast = false; bus.emit("rqw-settings:fast-gpt", { on: false });
			await emit({ type: "agent_start" });
			assert.ok(ticks() >= 10, "Fast off: the status letters animate");
			assert.ok(!row().includes(ICON.fast));

			// Switched on mid-run: the bolt shows and keeps shimmering.
			state.fast = true; bus.emit("rqw-settings:fast-gpt", { on: true });
			assert.ok(ticks() >= 10, "on mid-run: the timer runs");
			assert.ok(row().includes(ICON.fast));

			// Model change mid-run: the letters keep animating.
			await session.setModel(claude);
			assert.ok(ticks() >= 10, "switch to Claude mid-run: the letters animate");
			await session.setModel(codex);

			// The agent ends and settles: the timer stops.
			await emit({ type: "agent_end" });
			await emit({ type: "agent_settled" });
			assert.equal(ticks(), 0, "idle: no timer");

			// RQW-settings absent: nobody answers for the bolt, the letters still animate while the agent works.
			state.fast = undefined;
			await emit({ type: "agent_start" });
			assert.ok(ticks() >= 10, "no RQW-settings: the letters animate");
			await emit({ type: "agent_settled" });
			await emit({ type: "session_shutdown", reason: "quit" });
		} finally { t.mock.timers.reset(); m.close(); }
	});
});
