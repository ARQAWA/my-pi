import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, it } from "node:test";
import { InteractiveMode } from "@earendil-works/pi-coding-agent";
import { guardProcess, patchedMembers } from "./synthetic/guard.ts";
import { reportTimings, text, world } from "./synthetic/world.ts";

after(() => reportTimings(import.meta.filename));

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { pi: { extensions: string[] } };

// RQW-theme: `dim` is #96918a, `userMessageBg` is #36312c.
const DIM_FOREGROUND = "38;2;150;145;138";
const USER_BACKGROUND = "48;2;54;49;44";

it("smoke: every extension loads quietly, a turn is drawn and saved", async (t) => {
	const w = await world(t);
	assert.equal(w.loadedExtensions.length, manifest.pi.extensions.length);
	assert.deepEqual(w.errors, []);
	assert.deepEqual(w.networkAttempts, []);
	assert.deepEqual(w.processAttempts, []);
	assert.equal(w.settings.getTheme(), "RQW-theme");
	w.see("Opus 5.5");
	w.notSee("Failed to load");
	assert.ok(w.raw().some((line) => line.includes(DIM_FOREGROUND)), "the first frame uses the RQW-theme colours");

	w.model.script(text("hello"));
	await w.submit("hi");
	w.see("hello");
	assert.ok(w.raw().some((line) => line.includes(USER_BACKGROUND)), "the user message uses the RQW-theme background");
	const messages = w.jsonl().filter((entry) => entry.type === "message" && entry.message.role !== "system").map((entry) => entry.message);
	assert.deepEqual(messages.map((message) => message.role), ["user", "assistant"]);
	assert.equal(messages[0].content[0]?.text ?? messages[0].content, "hi");
	assert.equal(messages[1].content[0].text, "hello");
	assert.deepEqual(w.model.unscripted, []);
	assert.deepEqual(w.networkAttempts, []);
});

it("applies the real setup profile once and preserves the owner's later choice", async (t) => {
	const w = await world(t);
	const settingsFile = `${w.dirs.agent}/settings.json`;
	const settings = JSON.parse(readFileSync(settingsFile, "utf8"));
	assert.equal(settings.rqwSetupVersion, 1);
	assert.equal(settings.theme, "RQW-theme");
	assert.equal(settings.quietStartup, true);
	assert.equal(settings.outputPad, 1);
	w.settings.setTheme("dark");
	const restarted = await w.restart();
	assert.equal(restarted.settings.getTheme(), "dark");
});

it("scenario settings override the setup profile without replacing later choices on restart", async (t) => {
	const w = await world(t, { settings: { hideThinkingBlock: false, theme: "dark", websockets: true, terminal: { showTerminalProgress: true } } });
	assert.equal(w.settings.getHideThinkingBlock(), false);
	assert.equal(w.settings.getTheme(), "dark");
	assert.equal(w.settings.getSettings().transport, "websocket");
	assert.deepEqual(w.settings.getSettings().terminal, { showImages: false, showTerminalProgress: true });
	w.settings.setTheme("RQW-theme");
	const restarted = await w.restart();
	assert.equal(restarted.settings.getTheme(), "RQW-theme");
	assert.equal(restarted.settings.getHideThinkingBlock(), false);
});

it("a second world patches Pi the same way, and the first one gave everything back", async (t) => {
	const before = { home: process.env.HOME, fetch: globalThis.fetch, now: Date.now };
	const first = await world(t);
	const patched = first.patched();
	assert.ok(patched.length > 0, "the extensions patch Pi in memory");
	await first.dispose();
	assert.equal(process.env.HOME, before.home);
	assert.equal(globalThis.fetch, before.fetch);
	assert.equal(Date.now, before.now);
	assert.deepEqual(first.patched(), [], "every Pi prototype and static member has its original descriptor again");

	const second = await world(t);
	assert.deepEqual(second.patched(), patched);
});

it("the guard reports a changed, an added and a deleted Pi member, and gives them all back", () => {
	const guard = guardProcess();
	const proto = InteractiveMode.prototype as unknown as Record<string, unknown>;
	const original = Object.getOwnPropertyDescriptor(proto, "init")!;
	try {
		proto.init = () => {};
		proto.addedByTest = 1;
		delete proto.stop;
		assert.deepEqual(patchedMembers(guard.snapshot).sort(), ["InteractiveMode.prototype.addedByTest", "InteractiveMode.prototype.init", "InteractiveMode.prototype.stop"].sort());
	} finally {
		guard.restore();
	}
	assert.deepEqual(patchedMembers(guard.snapshot), []);
	assert.deepEqual(Object.getOwnPropertyDescriptor(proto, "init"), original);
	assert.ok("stop" in proto && !("addedByTest" in proto));
});
