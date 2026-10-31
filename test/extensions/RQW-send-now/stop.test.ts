import assert from "node:assert/strict";
import { test } from "node:test";
import { createEventBus, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import sendNow from "../../../extensions/RQW-send-now/index.ts";

test("Ctrl+backslash aborts the active turn and asks the session to stop its background", () => {
	const events = createEventBus();
	let shortcut: ((ctx: any) => void) | undefined;
	let event: any;
	events.on("rqw:stop-background:v1", (value: any) => { event = value; value.reply({ agents: 1 }); });
	const pi: any = { events, on() {}, registerShortcut: (key: string, options: any) => { if (key === "ctrl+\\") shortcut = options.handler; } };
	sendNow(pi as ExtensionAPI);
	let aborted = 0; const notices: string[] = [];
	const ctx = { isIdle: () => false, abort: () => { aborted++; }, sessionManager: { getSessionId: () => "session" }, ui: { notify: (text: string) => notices.push(text) } };
	assert.ok(shortcut);
	shortcut(ctx);
	assert.equal(aborted, 1);
	assert.equal(event.sessionId, "session");
	assert.match(notices[0], /1 agent/);
});
