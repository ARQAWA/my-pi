import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { AgentSession, createEventBus, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { stripVTControlCharacters } from "node:util";
import { getKeybindings, KeybindingsManager, setKeybindings, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
import predictions from "../extensions/RQW-predictions/index.ts";
import historyEdit from "../extensions/RQW-history-edit/index.ts";
import scroll from "../extensions/RQW-scroll/index.ts";
import sendNow from "../extensions/RQW-send-now/index.ts";
import { harness, OTHER, settle, suggestion } from "./extensions/RQW-predictions/harness.ts";

for (const extraFirst of [true, false]) it(`send-now and predictions share the editor, send-now ${extraFirst ? "first" : "last"}`, async t => {
	t.mock.method(AgentSession.prototype as any, "_bindExtensionCore", function() {});
	let background = 0;
	let changed = () => {};
	const h = harness({ replies: [suggestion("next step")], extraFirst, extraInstall(pi) {
		pi.events.on("rqw:running-counts:request", (request: any) => request.reply({ version: 1, snapshot: () => ({ agents: background }), subscribe(fn: () => void) { changed = fn; return () => {}; } }));
		sendNow(pi);
	} });
	t.after(() => h.fire("session_shutdown", { reason: "quit" }));
	assert.equal(Object.hasOwn(h.session, "_queueSteer"), true, "session was captured");
	assert.ok((h.session as any)._eventListeners.length, "session events are observed");
	const row = () => stripVTControlCharacters(h.screen()[1].replace(/\x1b_[^\x07]*\x07/g, "")).trim();
	h.asked(); await settle();
	assert.equal(row(), "next step");
	h.state.idle = false;
	(h.session as any)._emit({ type: "agent_start" });
	assert.equal(row(), "esc to interrupt");
	await (h.session as any)._queueSteer("adjust");
	assert.equal(row(), "esc to send now");
	h.setModel(OTHER);
	assert.equal(row(), "ctrl+enter to send now");
	(h.session as any)._steeringMessages = [];
	h.state.idle = true; background = 1; changed();
	assert.equal(row(), "esc esc to stop background");
	background = 0; changed();
	assert.equal(row(), "next step");
	h.key("\t");
	assert.equal(h.editor.getText(), "next step");
});

for (const work of ["turn", "background", "idle"] as const) it(`Escape jumps before ${work} control in package order`, t => {
	const original = getKeybindings();
	t.after(() => setKeybindings(original));
	t.mock.method(AgentSession.prototype as any, "_bindExtensionCore", function() {});
	let now = 1000;
	t.mock.method(Date, "now", () => now);
	let stops = 0;
	let background = work === "background" ? 1 : 0;
	const manager = new KeybindingsManager({
		...TUI_KEYBINDINGS,
		"app.interrupt": { defaultKeys: "escape", description: "Interrupt" },
		"app.session.rename": { defaultKeys: "ctrl+r", description: "Rename" },
	});
	const h = harness({ entry: true, extraFirst: true, realKeys: true, keybindings: manager, extraInstall(pi) {
		pi.events.on("rqw:running-counts:request", (request: any) => request.reply({ version: 1, snapshot: () => ({ agents: background }), subscribe: () => () => {} }));
		pi.events.on("rqw:stop-background:v1", () => { stops++; background = 0; });
		scroll(pi);
		sendNow(pi);
		historyEdit(pi);
	} });
	t.after(() => h.fire("session_shutdown", { reason: "quit" }));
	let interrupts = 0;
	h.editor.onEscape = () => { interrupts++; h.state.idle = true; };
	h.state.idle = work !== "turn";
	h.viewport.following = false;
	const row = () => stripVTControlCharacters(h.screen()[1].replace(/\x1b_[^\x07]*\x07/g, "")).trim();
	const scrolledHint = row();
	h.dispatch("\x1b");
	assert.equal(h.viewport.jumps, 1);
	assert.equal(scrolledHint, "esc to jump to latest");
	assert.equal(interrupts, 0);
	assert.equal(stops, 0);
	h.dispatch("\x1b[27;1:2u");
	assert.equal(interrupts, 0, "a held scroll key must not interrupt");
	assert.equal(stops, 0);
	now += 100;
	h.dispatch("\x1b");
	assert.equal(interrupts, work === "turn" || work === "idle" ? 1 : 0);
	assert.equal(stops, 0, "the scroll press did not arm a stop");
	now += 100;
	h.dispatch("\x1b");
	if (work === "idle") assert.deepEqual(h.sent, ["/edit-history"]);
	else assert.equal(stops, 1);
});

describe("scroll and predictions keybindings", () => {
	const original = getKeybindings();
	const originalStackLimit = Error.stackTraceLimit;
	afterEach(() => { setKeybindings(original); Error.stackTraceLimit = originalStackLimit; });

	for (const order of [[scroll, predictions], [predictions, scroll]]) {
		it(`works in ${order[0] === scroll ? "scroll-first" : "predictions-first"} order across sessions and reload`, () => {
			const manager = new KeybindingsManager({
				...TUI_KEYBINDINGS,
				"app.session.rename": { defaultKeys: "ctrl+r", description: "Rename" },
			}, { "app.session.rename": ["ctrl+r", "ctrl+x"] });
			Error.stackTraceLimit = 100;
			const stockGetKeys = manager.getKeys;
			let depth = 0;
			manager.getKeys = function(id) {
				depth = new Error().stack!.split("\n").length;
				return stockGetKeys.call(this, id);
			};
			setKeybindings(manager);
			let handlers: Map<string, ((event: any, ctx: any) => void)[]>;
			const load = () => {
				handlers = new Map();
				const pi = { events: createEventBus(), on(name: string, handler: (event: any, ctx: any) => void) {
					handlers.set(name, [...(handlers.get(name) ?? []), handler]);
				} } as unknown as ExtensionAPI;
				for (const extension of order) extension(pi);
			};
			load();
			let following = false;
			let jumps = 0;
			const listeners = new Set<(data: string) => unknown>();
			const tui = {
				mode: "fullscreen", get isFollowingOutput() { return following; },
				scrollToBottom() { jumps++; following = true; },
				getFocusedComponent: () => ({ actionHandlers: new Map() }), requestRender() {},
			};
			const ctx = { mode: "tui", isIdle: () => true, sessionManager: { getSessionId: () => "test" }, ui: {
				setWidget(_key: string, factory: any) { if (factory) factory(tui); },
				onTerminalInput(listener: (data: string) => unknown) { listeners.add(listener); return () => listeners.delete(listener); },
				setStatus() {}, notify(message: string) { assert.fail(message); },
			} } as unknown as ExtensionContext;
			const fire = (name: string, reason: string) => {
				for (const handler of handlers.get(name) ?? []) handler({ reason }, ctx);
			};
			const check = () => {
				const live = getKeybindings();
				assert.deepEqual(live.getKeys("tui.editor.cursorLineEnd"), ["end"]);
				assert.deepEqual(live.getKeys("app.session.rename"), ["ctrl+x"]);
				assert.equal(live.matches("\x05", "tui.editor.cursorLineEnd"), false);
				assert.equal(live.matches("\x12", "app.session.rename"), false);
				assert.equal(manager.matches("\x12", "app.session.rename"), false);
				assert.equal(manager.matches("\x1b[F", "tui.editor.cursorLineEnd"), true);
				assert.equal(manager.matches("\x18", "app.session.rename"), true);
				assert.ok(live.getKeys("tui.altScreen.bottom").includes("esc"));
				assert.equal(live.matches("\x1b", "tui.altScreen.bottom"), false, "the display hint must not change viewport input");
				assert.ok([...listeners].some(listener => (listener("\x1b") as { consume?: boolean } | undefined)?.consume));
				assert.equal(following, true);
				following = false;
			};
			try {
				fire("session_start", "startup");
				check();
				fire("session_start", "new");
				check();
				let reloadDepth: number | undefined;
				for (let i = 0; i < 5; i++) {
					fire("session_shutdown", "reload");
					load();
					fire("session_start", "reload");
					getKeybindings().getKeys("tui.editor.cursorLineEnd");
					if (reloadDepth === undefined) reloadDepth = depth;
					else assert.equal(depth, reloadDepth, "getKeys depth must stay constant across reloads");
					check();
				}
				assert.equal(jumps, 7);
			} finally {
				fire("session_shutdown", "quit");
			}
			assert.equal(manager.matches("\x05", "tui.editor.cursorLineEnd"), true);
			assert.equal(manager.matches("\x12", "app.session.rename"), true);
			assert.equal(manager.getKeys("tui.altScreen.bottom").includes("esc"), false);
		});
	}
});
