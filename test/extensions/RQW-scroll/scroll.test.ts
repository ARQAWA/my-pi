import assert from "node:assert/strict";
import { it } from "node:test";
import { getKeybindings, KeybindingsManager, setKeybindings, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import scroll from "../../../extensions/RQW-scroll/index.ts";

it("Escape jumps only from a scrolled fullscreen editor", () => {
	const handlers = new Map<string, (event: any, ctx: any) => void>();
	scroll({ on: (name: string, handler: any) => handlers.set(name, handler) } as unknown as ExtensionAPI);
	let input: ((data: string) => { consume: true } | undefined) | undefined;
	let following = false;
	let jumps = 0;
	let autocomplete = false;
	const focused = { actionHandlers: new Map(), isShowingAutocomplete: () => autocomplete };
	const tui = {
		mode: "fullscreen", get isFollowingOutput() { return following; },
		scrollToBottom: () => { jumps++; following = true; }, getFocusedComponent: () => focused,
	};
	const ctx = { mode: "tui", ui: {
		setWidget: (_key: string, factory: any) => { if (factory) factory(tui); },
		onTerminalInput: (handler: typeof input) => { input = handler; return () => { input = undefined; }; },
	} } as unknown as ExtensionContext;
	const original = getKeybindings();
	handlers.get("session_start")!({}, ctx);
	try {
		assert.deepEqual(input!("\x1b"), { consume: true });
		assert.equal(jumps, 1);
		assert.equal(input!("\x1b"), undefined);
		following = false;
		assert.ok(getKeybindings().getKeys("tui.altScreen.bottom").includes("esc"));
		autocomplete = true;
		assert.equal(input!("\x1b"), undefined);
	} finally {
		handlers.get("session_shutdown")!({}, ctx);
	}
	assert.equal(getKeybindings(), original);
});

it("keeps the stock display if the manager cannot be decorated", () => {
	const original = getKeybindings();
	const manager = new KeybindingsManager(TUI_KEYBINDINGS, {});
	Object.defineProperty(manager, "getKeys", { value: manager.getKeys, configurable: false });
	setKeybindings(manager);
	const handlers = new Map<string, (event: any, ctx: any) => void>();
	scroll({ on: (name: string, handler: any) => handlers.set(name, handler) } as unknown as ExtensionAPI);
	const tui = { mode: "fullscreen", isFollowingOutput: false, scrollToBottom() {}, getFocusedComponent: () => ({ actionHandlers: new Map() }) };
	const ctx = { mode: "tui", ui: {
		setWidget: (_key: string, factory: any) => { if (factory) factory(tui); },
		onTerminalInput: () => () => {},
	} } as unknown as ExtensionContext;
	try {
		handlers.get("session_start")!({}, ctx);
		assert.equal(manager.getKeys("tui.altScreen.bottom").includes("esc"), false);
		handlers.get("session_shutdown")!({}, ctx);
	} finally {
		setKeybindings(original);
	}
});
