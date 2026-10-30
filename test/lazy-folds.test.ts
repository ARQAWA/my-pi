// RQW-blocks lazy history and RQW-tool-ui worked-for folds together, on Pi's real InteractiveMode and fullscreen renderer:
// a fold in a loaded interval starts closed, is closed again after the interval was unloaded and loaded again, and an unloaded
// interval keeps no fold handler and no reference. Two extensions, so the test lives here and not in either extension's tree.
import assert from "node:assert/strict";
import v8 from "node:v8";
import vm from "node:vm";
import { afterEach, it } from "node:test";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { installHistory } from "../extensions/RQW-blocks/history.ts";
import { makeFullscreen, type Fullscreen } from "./extensions/RQW-blocks/history-host.ts";
import { assistant, load, Session, text, user } from "./extensions/RQW-tool-ui/fold-host.ts";

const WIDTH = 60;
const cleanups: (() => void)[] = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

/** Six finished turns; compactions keep from the user message of turn 1 and of turn 3: the latest interval starts at turn 3,
 * the older ones are turns 1 and 2, and turn 0. Every turn has work, so every one gets a fold, and its own label. */
function open(build?: (session: Session) => void) {
	const session = new Session();
	cleanups.push(() => session.end());
	if (build) build(session);
	else {
		const users: string[] = [];
		for (let n = 0; n < 6; n++) {
			users.push(session.turn(n, n * 100_000, 10 + n));
			if (n === 1 || n === 3) session.compact(users[n], n * 100_000 + 50_000);
		}
	}
	const loaded = load();
	cleanups.push(() => loaded.shutdown());
	cleanups.push(installHistory());
	const fx = makeFullscreen(session.manager, { columns: WIDTH, rows: 30 });
	cleanups.push(() => fx.stop());
	// The history host draws tool rows through Pi's own renderers; give it tool-ui's resolver.
	(fx.host.runtimeHost.session as any).extensionRunner.resolveToolRenderers = (name: string, next: () => unknown) => loaded.resolve(name, next);
	fx.host.renderInitialMessages();
	loaded.start(session.manager);
	fx.frame();
	return { session, loaded, fx };
}

const chatRows = (fx: Fullscreen) => fx.host.chatContainer.render(WIDTH).map(stripTerminalSequences).map((line: string) => line.trim()).filter(Boolean);
const headers = (fx: Fullscreen) => chatRows(fx).filter((row: string) => row.startsWith("worked for"));
const prompts = (fx: Fullscreen) => chatRows(fx).filter((row: string) => /^prompt \d$/.test(row));

/** Wheel up at the top: the next older interval loads. */
function loadOlder(fx: Fullscreen) {
	fx.view.scrollTo(0);
	fx.frame();
	fx.wheel(-1);
}

/** Put the document row with `text` on the screen, without a scroll input. */
function reveal(fx: Fullscreen, text: string) {
	const document = fx.host.documentContainer.render(WIDTH).map(stripTerminalSequences).map((line: string) => line.trim());
	const at = document.findIndex((line: string) => line.includes(text));
	assert.ok(at >= 0, `${text} is in the transcript`);
	fx.view.scrollTo(Math.max(0, at - 3));
	fx.frame();
}

/** A left click on the screen row that shows `text`. */
function click(fx: Fullscreen, text: string) {
	reveal(fx, text);
	const row = fx.rows().findIndex((line) => line.includes(text));
	assert.ok(row >= 0, `${text} is on the screen`);
	const column = fx.rows()[row].indexOf(text) + 2;
	fx.send(`\x1b[<0;${column};${row + 1}M`);
	fx.send(`\x1b[<0;${column};${row + 1}m`);
}

it("a fold in a loaded interval starts closed, and is closed again after an unload and a new load", () => {
	const { fx } = open();
	// Start: the latest interval, folds closed.
	assert.deepEqual(prompts(fx), ["prompt 3", "prompt 4", "prompt 5"]);
	assert.deepEqual(headers(fx), ["worked for 13s ›", "worked for 14s ›", "worked for 15s ›"]);
	// The loaded interval brings its turns with closed folds.
	loadOlder(fx);
	assert.deepEqual(prompts(fx), ["prompt 1", "prompt 2", "prompt 3", "prompt 4", "prompt 5"]);
	assert.deepEqual(headers(fx), ["worked for 11s ›", "worked for 12s ›", "worked for 13s ›", "worked for 14s ›", "worked for 15s ›"]);
	assert.ok(!chatRows(fx).some((row: string) => row.includes("update 1")));
	// A click on its header opens it.
	click(fx, "worked for 11s ›");
	assert.ok(chatRows(fx).includes("worked for 11s ˅") && chatRows(fx).some((row: string) => row.includes("update 1")));
	// And a fold of the latest interval, which stays drawn the whole time.
	click(fx, "worked for 14s ›");
	assert.ok(chatRows(fx).includes("worked for 14s ˅"));
	// Escape: the loaded interval goes. The kept fold stays open.
	fx.screen.scrollToBottom();
	fx.frame();
	assert.deepEqual(prompts(fx), ["prompt 3", "prompt 4", "prompt 5"]);
	assert.deepEqual(headers(fx), ["worked for 13s ›", "worked for 14s ˅", "worked for 15s ›"]);
	// Loaded again: closed, as new components.
	loadOlder(fx);
	assert.deepEqual(headers(fx), ["worked for 11s ›", "worked for 12s ›", "worked for 13s ›", "worked for 14s ˅", "worked for 15s ›"]);
	assert.ok(!chatRows(fx).some((row: string) => row.includes("update 1")));
	// Its header still works.
	click(fx, "worked for 11s ›");
	assert.ok(chatRows(fx).includes("worked for 11s ˅"));
});

it("an unloaded interval's components get their own render and mouse handling back", () => {
	const { fx } = open();
	loadOlder(fx);
	const before = new Set(fx.host.chatContainer.children as object[]);
	fx.screen.scrollToBottom();
	fx.frame();
	const after = new Set(fx.host.chatContainer.children as object[]);
	const unloaded = [...before].filter((child) => !after.has(child));
	assert.ok(unloaded.length > 10, "an interval was unloaded");
	// Folds wrapped these with an own render and handleMouse; an unloaded component no longer carries them.
	for (const child of unloaded) for (const name of ["render", "handleMouse", "invalidate", "setExpanded", "setOutputPad", "rebuild"]) {
		assert.ok(!Object.hasOwn(child, name), `${child.constructor.name}.${name}`);
	}
});

it("an unloaded interval is collected: no fold list, binding or row callback keeps its components", async () => {
	const { fx } = open();
	// Every component on screen once the interval is loaded; the ones that stay drawn after the unload are held below.
	const refs = (() => {
		loadOlder(fx);
		return (fx.host.chatContainer.children as object[]).map((child) => new WeakRef(child));
	})();
	fx.screen.scrollToBottom();
	fx.frame();
	const kept = new Set(fx.host.chatContainer.children as object[]);
	// A WeakRef keeps its target to the end of the job: read it after a later turn.
	await new Promise((resolve) => setImmediate(resolve));
	v8.setFlagsFromString("--expose-gc");
	(vm.runInNewContext("gc") as () => void)();
	const gone = refs.filter((ref) => ref.deref() === undefined).length;
	const stillDrawn = refs.filter((ref) => { const target = ref.deref(); return target !== undefined && kept.has(target); }).length;
	assert.equal(stillDrawn, kept.size, "everything still drawn is alive");
	assert.equal(refs.length - gone, kept.size, `only the drawn components are alive (${refs.length - gone} alive, ${kept.size} drawn)`);
});

it("keeps local suffix folds separate across two kept cuts while loading and unloading lifted owners", () => {
	const { fx } = open((s) => {
		s.add(user("owner before first cut", 0), 0);
		s.add(assistant([text("first unfinished prefix")], "toolUse", 1_000), 1_000);
		const first = s.add(assistant([text("first local work")], "toolUse", 4_000), 4_000);
		s.card("identical result card", 5_000);
		s.add(user("first lifted steering", 6_000), 6_000);
		s.add(assistant([text("first suffix answer")], "stop", 10_000), 11_000);
		s.compact(first, 12_000);
		s.add(user("owner before second cut", 20_000), 20_000);
		s.add(assistant([text("second unfinished prefix")], "toolUse", 22_000), 22_000);
		const second = s.add(assistant([text("second local work")], "toolUse", 24_000), 24_000);
		s.card("identical result card", 25_000);
		s.add(user("second lifted steering", 26_000), 26_000);
		s.add(assistant([text("second suffix answer")], "stop", 29_000), 30_000);
		s.compact(second, 31_000);
		for (let n = 2; n < 5; n++) s.turn(n, n * 20_000, 10 + n);
	});
	const has = (value: string) => chatRows(fx).some(row => row.includes(value));
	assert.deepEqual(headers(fx), ["worked for 6s ›", "worked for 12s ›", "worked for 13s ›", "worked for 14s ›"]);
	assert.ok(has("second lifted steering") && !has("owner before second cut") && !has("second local work"));
	loadOlder(fx);
	assert.deepEqual(headers(fx), ["worked for 7s ›", "worked for 2s ›", "worked for 6s ›", "worked for 12s ›", "worked for 13s ›", "worked for 14s ›"]);
	for (const value of ["first lifted steering", "second lifted steering", "owner before second cut"]) assert.ok(has(value), value);
	assert.ok(!has("second unfinished prefix"));
	click(fx, "worked for 2s ›");
	assert.ok(has("second unfinished prefix") && !has("first local work") && !has("second local work"));
	assert.ok(!has("first local work") && !has("second local work") && !has("identical result card"));
	loadOlder(fx);
	assert.ok(has("owner before first cut") && !has("first unfinished prefix"));
	click(fx, "worked for 1s ›");
	assert.ok(has("first unfinished prefix") && !has("first local work") && !has("second local work"));
	assert.equal(chatRows(fx).filter(row => row.includes("lifted steering")).length, 2);
	click(fx, "worked for 7s ›");
	assert.ok(has("first local work") && !has("second local work"));
	assert.equal(chatRows(fx).filter(row => row.includes("identical result card")).length, 1);
	click(fx, "worked for 6s ›");
	assert.equal(chatRows(fx).filter(row => row.includes("identical result card")).length, 2);
	fx.screen.scrollToBottom();
	fx.frame();
	assert.deepEqual(headers(fx), ["worked for 6s ˅", "worked for 12s ›", "worked for 13s ›", "worked for 14s ›"]);
	assert.ok(!has("first lifted steering") && !has("owner before second cut"));
	loadOlder(fx);
	assert.deepEqual(headers(fx), ["worked for 7s ›", "worked for 2s ›", "worked for 6s ˅", "worked for 12s ›", "worked for 13s ›", "worked for 14s ›"]);
	assert.ok(!has("second unfinished prefix"));
	assert.ok(has("first lifted steering") && !has("first local work"));
	assert.equal(chatRows(fx).filter(row => row.includes("identical result card")).length, 1);
});

it("the rows he reads stay in place when the loaded interval has folds, which start closed", () => {
	const { fx } = open();
	fx.view.scrollTo(1);
	fx.frame();
	const strip = (lines: string[]) => lines.map(stripTerminalSequences).map((line) => line.trimEnd());
	const before = strip(fx.host.documentContainer.render(WIDTH));
	fx.wheel(-1);
	assert.deepEqual(prompts(fx), ["prompt 1", "prompt 2", "prompt 3", "prompt 4", "prompt 5"]);
	// Row 0 shows what is above the loaded interval now; the header moved up there. The rest is what he was reading.
	// Measured open, the loaded folds would have pushed the position further than the closed folds the frame draws.
	const height = fx.view.viewportHeight;
	assert.deepEqual(fx.rows().slice(1, height - 1), before.slice(1, height - 1));
});
