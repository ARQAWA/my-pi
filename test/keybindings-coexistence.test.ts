import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createEventBus, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getKeybindings, KeybindingsManager, setKeybindings, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
import predictions from "../extensions/RQW-predictions/index.ts";
import scroll from "../extensions/RQW-scroll/index.ts";

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
			const ctx = { mode: "tui", sessionManager: { getSessionId: () => "test" }, ui: {
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
