// Lazy history in Pi's fullscreen view: Pi's real InteractiveMode methods, TuiAltScreen, ScrollView and VStack on a
// fake terminal. Scrolling goes through the renderer's own input path (wheel, PgUp, Ctrl+Home, scrollbar mouse).
import assert from "node:assert/strict";
import { it } from "node:test";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { Container, stripTerminalSequences, TuiMainScreen } from "@earendil-works/pi-tui";
import { installHistory } from "../../../extensions/RQW-blocks/history.ts";
import { buildSession, makeFullscreen, makeHost, type Fullscreen } from "./history-host.ts";

initTheme();

const WIDTH = 60;
const chat = (host: { chatContainer: Container }) => host.chatContainer.render(WIDTH).map(stripTerminalSequences).map((line) => line.trim()).filter(Boolean);
const prompts = (lines: string[]) => lines.filter((line) => /^prompt \d+$/.test(line));
const all = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `prompt ${from + i}`);
// Eight turns; compactions after turns 2 and 5 keep the last turn before them, so the latest interval starts at prompt 5.
const compacted = () => buildSession(8, 3, 1);

/** Run a test against a started fullscreen fixture with the patch installed. */
function run(manager: ReturnType<typeof buildSession>["manager"], body: (fx: Fullscreen) => void, options?: Parameters<typeof makeFullscreen>[1]) {
	const restore = installHistory();
	const fx = makeFullscreen(manager, options);
	try {
		fx.host.renderInitialMessages();
		fx.frame();
		body(fx);
	} finally { fx.stop(); restore(); }
}

/** Wheel up one line at a time until the viewport top is at `top`. */
function wheelTo(fx: Fullscreen, top: number) {
	for (let guard = 0; fx.view.scrollTop > top; guard++) {
		assert.ok(guard < 1000, "the wheel does not scroll");
		fx.wheel(-1);
	}
}

it("starts with only the latest interval", () => {
	run(compacted().manager, (fx) => {
		assert.deepEqual(prompts(chat(fx.host)), all(5, 7));
	});
});

it("wheel up at the top loads the next older interval above and the rows he reads stay in place", () => {
	run(compacted().manager, (fx) => {
		wheelTo(fx, 1);
		const document = fx.host.documentContainer.render(WIDTH).map(stripTerminalSequences).map((line: string) => line.trimEnd());
		const height = fx.view.viewportHeight;
		fx.wheel(-1);
		assert.deepEqual(prompts(chat(fx.host)), all(2, 7));
		// The transcript rows he reads stay on their screen rows. Only the first row differs: the header moved above the
		// loaded history, and the last row may carry the "Jump to latest" label.
		assert.deepEqual(fx.rows().slice(1, height - 1), document.slice(1, height - 1));
		assert.equal(fx.rows()[0].trim(), "answer 4");
		assert.ok(fx.view.scrollTop > 0);
	});
});

it("loads on Ctrl+Home and on Page Up at the top", () => {
	for (const key of ["\x1b[1;5H", "\x1b[5~"]) {
		run(compacted().manager, (fx) => {
			// A page up from three rows below the top reaches the top.
			if (key === "\x1b[5~") wheelTo(fx, 3);
			fx.send(key);
			assert.deepEqual(prompts(chat(fx.host)), all(2, 7), key);
			if (key !== "\x1b[5~") {
				fx.send(key);
				assert.deepEqual(prompts(chat(fx.host)), all(0, 7), key);
			}
		});
	}
});

it("a jump to the top that is not a scroll input, as the search does, loads nothing; the next wheel up does", () => {
	run(compacted().manager, (fx) => {
		fx.view.scrollTo(0);
		fx.frame();
		assert.deepEqual(prompts(chat(fx.host)), all(5, 7));
		fx.wheel(1);
		assert.deepEqual(prompts(chat(fx.host)), all(5, 7));
		fx.view.scrollTo(0);
		fx.wheel(-1);
		assert.deepEqual(prompts(chat(fx.host)), all(2, 7));
	});
});

it("loads when the latest interval is shorter than the screen and the wheel does not move anything", () => {
	run(buildSession(4, 2, 1).manager, (fx) => {
		assert.ok(fx.view.scrollTop === 0 && fx.view.isFollowingEnd);
		fx.wheel(1);
		assert.deepEqual(prompts(chat(fx.host)), all(1, 3));
		fx.wheel(-1);
		assert.deepEqual(prompts(chat(fx.host)), all(0, 3));
	}, { rows: 60 });
});

it("loads one interval when the scrollbar thumb is dragged to the top, once per arrival", () => {
	run(compacted().manager, (fx) => {
		// Column and row are 1-based in SGR: the scrollbar is the last column, the top of its track the first row.
		const at = (button: number, row: number, release = "M") => fx.send(`\x1b[<${button};${WIDTH};${row}${release}`);
		at(0, 1);
		assert.deepEqual(prompts(chat(fx.host)), all(2, 7));
		assert.ok(fx.view.scrollTop > 0);
		// Still at the top of the track: no second load.
		at(32, 1);
		assert.deepEqual(prompts(chat(fx.host)), all(2, 7));
		// Down and back to the top: the next one.
		at(32, 9);
		assert.ok(fx.view.scrollTop > 0);
		at(32, 1);
		assert.deepEqual(prompts(chat(fx.host)), all(0, 7));
		at(0, 1, "m");
	}, { scrollbar: "always" });
});

it("a tool call that is open while an older piece loads still shows its result in the transcript", () => {
	run(compacted().manager, (fx) => {
		// Expanded output, so the result text itself is in the rows.
		fx.host.toggleToolOutputExpansion();
		const call = { type: "toolCall", id: "live", name: "read", arguments: { path: "live.ts" } };
		const message = { role: "assistant", content: [call], stopReason: "toolUse", timestamp: 90 };
		fx.host.handleEvent({ type: "message_start", message });
		fx.host.handleEvent({ type: "message_update", message });
		fx.host.handleEvent({ type: "tool_execution_start", toolCallId: "live", toolName: "read", args: call.arguments });
		wheelTo(fx, 1);
		fx.wheel(-1);
		assert.deepEqual(prompts(chat(fx.host)), all(2, 7));
		fx.host.handleEvent({ type: "tool_execution_end", toolCallId: "live", toolName: "read", isError: false, result: { content: [{ type: "text", text: "LIVE-RESULT" }] } });
		fx.send("\x1b[1;5F");
		assert.ok(fx.rows().some((row) => row.includes("LIVE-RESULT")), fx.rows().join("|"));
	});
});

it("drops the text selection when rows are added above it", () => {
	run(compacted().manager, (fx) => {
		wheelTo(fx, 1);
		const row = fx.rows().findIndex((line) => line.length > 6) + 1;
		fx.send(`\x1b[<0;3;${row}M`);
		fx.send(`\x1b[<32;20;${row}M`);
		assert.equal(fx.screen.hasActiveSelection(), true);
		fx.wheel(-1);
		assert.equal(fx.screen.hasActiveSelection(), false);
	});
});

it("does not read the branch on frames or on scrolling that loads nothing", () => {
	run(compacted().manager, (fx) => {
		const manager = fx.host.sessionManager;
		let reads = 0;
		const getBranch = manager.getBranch.bind(manager);
		manager.getBranch = () => { reads++; return getBranch(); };
		for (let i = 0; i < 20; i++) { fx.frame(); fx.wheel(-1); fx.wheel(1); }
		assert.equal(reads, 0);
	});
});

it("a compaction while he reads in the loaded older history keeps every row in place", async () => {
	const { manager, turnUserIds } = compacted();
	await runAsync(manager, async (fx) => {
		wheelTo(fx, 1);
		fx.wheel(-1);
		fx.view.scrollTo(8);
		fx.frame();
		const before = fx.rows();
		manager.appendCompaction("fresh", turnUserIds[7], 9000);
		await fx.host.handleEvent({ type: "compaction_end", reason: "threshold", result: { summary: "fresh", tokensBefore: 9000 } });
		fx.frame();
		assert.deepEqual(prompts(chat(fx.host)), all(2, 7));
		assert.deepEqual(fx.rows(), before);
	});
});

it("a compaction while he reads in the latest interval keeps its rows too", async () => {
	const { manager, turnUserIds } = compacted();
	await runAsync(manager, async (fx) => {
		fx.view.scrollTo(2);
		fx.frame();
		const before = fx.rows();
		manager.appendCompaction("fresh", turnUserIds[7], 9000);
		await fx.host.handleEvent({ type: "compaction_end", reason: "threshold", result: { summary: "fresh", tokensBefore: 9000 } });
		fx.frame();
		assert.deepEqual(prompts(chat(fx.host)), all(5, 7));
		assert.deepEqual(fx.rows(), before);
	});
});

it("a compaction while he follows the bottom starts the chat at its kept range", async () => {
	const { manager, turnUserIds } = compacted();
	await runAsync(manager, async (fx) => {
		assert.equal(fx.view.isFollowingEnd, true);
		manager.appendCompaction("fresh", turnUserIds[7], 9000);
		await fx.host.handleEvent({ type: "compaction_end", reason: "threshold", result: { summary: "fresh", tokensBefore: 9000 } });
		fx.frame();
		assert.deepEqual(prompts(chat(fx.host)), all(7, 7));
	});
});

it("a compaction stored at a turn boundary keeps the loaded history in place as well", async () => {
	const { manager, turnUserIds } = compacted();
	await runAsync(manager, async (fx) => {
		wheelTo(fx, 1);
		fx.wheel(-1);
		fx.view.scrollTo(8);
		fx.frame();
		const before = fx.rows();
		const id = manager.appendCompaction("boundary", turnUserIds[7], 9000);
		manager.appendMessage({ role: "user", content: "after", timestamp: 99 } as never);
		await fx.host.handleEvent({ type: "entry_appended", entry: manager.getEntry(id) });
		fx.frame();
		assert.deepEqual(prompts(chat(fx.host)), all(2, 7));
		assert.deepEqual(fx.rows(), before);
	});
});

it("a rebuild starts again from the latest interval, nothing stays loaded", () => {
	for (const rebuild of ["renderCurrentSessionState", "rebuildChatFromMessages"]) {
		run(compacted().manager, (fx) => {
			wheelTo(fx, 1);
			fx.wheel(-1);
			assert.deepEqual(prompts(chat(fx.host)), all(2, 7));
			fx.host.chatContainer.clear();
			fx.host.pendingMessagesContainer = new Container();
			fx.host.loadedResourcesContainer = new Container();
			if (rebuild === "renderCurrentSessionState") fx.host.renderInitialMessages();
			else fx.host.rebuildChatFromMessages();
			fx.frame();
			assert.deepEqual(prompts(chat(fx.host)), all(5, 7), rebuild);
			wheelTo(fx, 1);
			fx.wheel(-1);
			assert.deepEqual(prompts(chat(fx.host)), all(2, 7), rebuild);
		});
	}
});

it("switching to the real inline renderer, as inline mode does, shows the whole transcript", () => {
	run(compacted().manager, (fx) => {
		assert.deepEqual(prompts(chat(fx.host)), all(5, 7));
		// Pi's switchTuiMode remounts the renderer's children on the new renderer.
		fx.screen.addChild(fx.host.documentContainer);
		assert.equal(fx.host.switchTuiMode("regular"), true);
		try {
			assert.equal(fx.host.renderer instanceof TuiMainScreen, true);
			const lines = fx.host.renderer.render(WIDTH).map(stripTerminalSequences).map((line: string) => line.trim());
			assert.deepEqual(prompts(lines), all(0, 7));
		} finally { fx.host.renderer.stop(); }
	});
});

it("a loaded older interval follows the current tool output and thinking toggles", () => {
	for (const toggled of [false, true]) {
		run(buildSession(4, 2, 1, true).manager, (fx) => {
			// Compaction after turn 2 keeps turn 1: turn 0 waits.
			if (toggled) { fx.host.toggleToolOutputExpansion(); fx.host.toggleThinkingBlockVisibility(); }
			assert.deepEqual(prompts(chat(fx.host)), all(1, 3));
			wheelTo(fx, 1);
			fx.wheel(-1);
			const lines = chat(fx.host);
			assert.deepEqual(prompts(lines), all(0, 3));
			assert.equal(lines.includes("body 0"), toggled, "tool output");
			assert.equal(lines.includes("Thinking..."), toggled, "hidden thinking label");
			assert.equal(lines.includes("reasoning 0"), !toggled, "visible thinking");
			// The kept turn is a reference: it follows the same state.
			assert.equal(lines.includes("body 1"), toggled);
			// Toggling again after the load changes the rows of the components that are already loaded.
			fx.host.toggleToolOutputExpansion();
			fx.host.toggleThinkingBlockVisibility();
			const after = chat(fx.host);
			assert.equal(after.includes("body 0"), !toggled, "tool output after the toggle");
			assert.equal(after.includes("Thinking..."), !toggled, "hidden thinking label after the toggle");
			assert.equal(after.includes("reasoning 0"), toggled, "visible thinking after the toggle");
			assert.equal(after.includes("body 1"), !toggled);
		}, { rows: 60 });
	}
});

it("draws the whole branch when the view is not the fullscreen one", () => {
	const restore = installHistory();
	try {
		const host: any = makeHost(compacted().manager);
		Object.assign(host, { renderer: { mode: "regular", terminal: { columns: WIDTH } }, transcriptScrollView: undefined });
		host.renderInitialMessages();
		assert.deepEqual(prompts(chat(host)), all(0, 7));
	} finally { restore(); }
});

it("draws the whole branch when the scroll view has another shape", () => {
	for (const missing of ["scrollToEnd", "scrollTo", "contentHeight", "scrollScrollbarToPointer"]) {
		run(compacted().manager, (fx) => {
			Object.defineProperty(missing === "scrollScrollbarToPointer" ? fx.screen : fx.view, missing, { value: undefined, configurable: true });
			fx.host.chatContainer.clear();
			fx.host.renderInitialMessages();
			assert.deepEqual(prompts(chat(fx.host)), all(0, 7), missing);
		});
	}
});

it("a failure while loading draws the whole branch at once and keeps it", () => {
	run(compacted().manager, (fx) => {
		wheelTo(fx, 1);
		let broken = true;
		const width = fx.view.getContentWidth.bind(fx.view);
		fx.view.getContentWidth = (columns: number) => { if (broken) { broken = false; throw new Error("boom"); } return width(columns); };
		fx.wheel(-1);
		assert.equal(broken, false, "the failure was injected");
		assert.deepEqual(prompts(chat(fx.host)), all(0, 7));
		fx.host.chatContainer.clear();
		fx.host.renderInitialMessages();
		assert.deepEqual(prompts(chat(fx.host)), all(0, 7));
	});
});

it("forgets Pi's cached row layout of the transcript when it adds rows", () => {
	run(compacted().manager, (fx) => {
		wheelTo(fx, 1);
		const layouts = () => [fx.host.chatContainer, fx.host.documentContainer].map((container: any) => container.mouseLayout);
		assert.ok(layouts().every(Boolean), "a frame stores the layout");
		fx.raw("\x1b[<64;10;3M");
		assert.deepEqual(layouts(), [undefined, undefined]);
	});
});

it("takes its scroll patches off the view when it is removed", () => {
	const restore = installHistory();
	const fx = makeFullscreen(compacted().manager);
	try {
		fx.host.renderInitialMessages();
		assert.ok(Object.hasOwn(fx.view, "scrollBy"));
		restore();
		assert.ok(!Object.hasOwn(fx.view, "scrollBy") && !Object.hasOwn(fx.view, "scrollToStart") && !Object.hasOwn(fx.screen, "scrollScrollbarToPointer"));
	} finally { fx.stop(); restore(); }
});

async function runAsync(manager: ReturnType<typeof buildSession>["manager"], body: (fx: Fullscreen) => Promise<void>) {
	const restore = installHistory();
	const fx = makeFullscreen(manager);
	try {
		fx.host.renderInitialMessages();
		fx.frame();
		await body(fx);
	} finally { fx.stop(); restore(); }
}

it("loads one interval per step, newest first, until nothing is left", () => {
	// Compactions after turns 1, 3, 5 and 7 keep the turn after them: the latest interval starts at prompt 7.
	run(buildSession(10, 2, 1).manager, (fx) => {
		assert.deepEqual(prompts(chat(fx.host)), all(7, 9));
		for (const from of [5, 3, 1, 0]) {
			wheelTo(fx, 1);
			fx.wheel(-1);
			assert.deepEqual(prompts(chat(fx.host)), all(from, 9));
		}
		wheelTo(fx, 0);
		fx.wheel(-1);
		assert.deepEqual(prompts(chat(fx.host)), all(0, 9));
	});
});

it("draws the whole branch when a compaction's kept range does not start after the previous one's", () => {
	const { manager, turnUserIds } = buildSession(8);
	manager.appendCompaction("first", turnUserIds[5], 1000);
	manager.appendCompaction("second", turnUserIds[3], 2000);
	run(manager, (fx) => {
		assert.deepEqual(prompts(chat(fx.host)), all(0, 7));
	});
});

it("draws the whole branch when two compactions keep from the same entry", () => {
	const { manager, turnUserIds } = buildSession(8);
	manager.appendCompaction("first", turnUserIds[5], 1000);
	manager.appendCompaction("second", turnUserIds[5], 2000);
	run(manager, (fx) => {
		assert.deepEqual(prompts(chat(fx.host)), all(0, 7));
	});
});

it("draws the whole branch when an older compaction's kept range cannot be found", () => {
	const { manager, turnUserIds } = buildSession(8);
	manager.appendCompaction("first", "no-such-entry", 1000);
	manager.appendCompaction("second", turnUserIds[5], 2000);
	run(manager, (fx) => {
		assert.deepEqual(prompts(chat(fx.host)), all(0, 7));
	});
});

it("keeps the editor's input history the whole branch's, whatever is drawn", () => {
	run(compacted().manager, (fx) => {
		const seen: string[] = [];
		fx.host.editor = { addToHistory: (text: string) => { seen.push(text); } };
		fx.host.chatContainer.clear();
		fx.host.renderInitialMessages();
		assert.deepEqual(prompts(chat(fx.host)), all(5, 7));
		assert.deepEqual(seen, all(0, 7));
		wheelTo(fx, 1);
		fx.wheel(-1);
		assert.deepEqual(seen, all(0, 7), "loading adds nothing");
	});
});

it("draws the whole branch when the lazy shape check itself throws", () => {
	run(compacted().manager, (fx) => {
		const seen: string[] = [];
		fx.host.editor = { addToHistory: (text: string) => { seen.push(text); } };
		let broken = true;
		const real = (fx.view as any).contentHeight;
		Object.defineProperty(fx.view, "contentHeight", { get: () => { if (broken) { broken = false; throw new Error("boom"); } return real; }, configurable: true });
		fx.host.chatContainer.clear();
		fx.host.renderInitialMessages();
		assert.equal(broken, false, "the failure was injected");
		assert.deepEqual(prompts(chat(fx.host)), all(0, 7));
		assert.deepEqual(seen, all(0, 7));
	});
});

// Unloading. Ten turns, compactions after turns 2, 4, 6 and 8, each keeping the turn before it: the latest interval starts at
// prompt 7 (36 rows), the older ones are 25, 25 and 9 rows. A 14-row screen is shorter than the latest interval, a 60-row one longer.
const long = () => buildSession(10, 2, 1);

/** Load every older interval, one wheel up at the top at a time. */
function loadAll(fx: Fullscreen) {
	for (let guard = 0; guard < 10 && prompts(chat(fx.host))[0] !== "prompt 0"; guard++) {
		fx.view.scrollTo(0);
		fx.frame();
		fx.wheel(-1);
	}
	assert.deepEqual(prompts(chat(fx.host)), all(0, 9));
}

/** The screen shows exactly the document rows at the scroll position: nothing visible was removed or moved. */
function assertCoherent(fx: Fullscreen, label: string) {
	const document = fx.host.documentContainer.render(WIDTH).map(stripTerminalSequences).map((line: string) => line.trimEnd());
	const rows = fx.rows();
	// The last viewport row may carry the "Jump to latest" label.
	for (let i = 0; i < fx.view.viewportHeight - 1; i++) assert.equal(rows[i], document[fx.view.scrollTop + i] ?? "", `${label}: row ${i}`);
}

/** The viewport rows: all but the last, which may carry the "Jump to latest" label. */
const seen = (fx: Fullscreen) => fx.rows().slice(0, fx.view.viewportHeight - 1);
const documentRows = (fx: Fullscreen, width = WIDTH) => fx.host.documentContainer.render(width).map(stripTerminalSequences).map((line: string) => line.trimEnd());

/** Run a downward `input` and assert that what the screen shows afterwards is the rows from `moved` lower in the document that
 * was there before it: the unload took rows out of the document and the scroll position followed, so nothing visible jumped.
 * `moved` is the scroll the input asks for, cut at the end of the transcript; the unload must not add to it. */
function assertScrolled(fx: Fullscreen, amount: number, input: () => void, label: string, width = WIDTH) {
	const before = { rows: seen(fx), top: fx.view.scrollTop, height: documentRows(fx, width).length };
	const moved = Math.min(amount, Math.max(0, before.height - fx.view.viewportHeight - before.top));
	input();
	const after = seen(fx);
	for (let i = 0; i + moved < after.length; i++) assert.equal(after[i], before.rows[i + moved], `${label}: row ${i}`);
}

it("unloads an interval on the way down only when it is a whole screen above, and nothing visible moves", () => {
	run(long().manager, (fx) => {
		loadAll(fx);
		let drawn = prompts(chat(fx.host));
		const unloaded: string[][] = [];
		for (let step = 0; step < 300 && fx.view.scrollTop < 400; step++) {
			const before = { top: fx.view.scrollTop, height: fx.host.documentContainer.render(WIDTH).length };
			assertScrolled(fx, 1, () => fx.wheel(1), `step ${step}`);
			assertCoherent(fx, `step ${step}`);
			const now = prompts(chat(fx.host));
			if (now.length === drawn.length) continue;
			// Removed rows, and the position the scroll had reached when it left: one screen below the interval's end
			// (1 row of header above the chat), or at the end of the transcript.
			const removed = before.height - fx.host.documentContainer.render(WIDTH).length;
			assert.ok(before.top + 1 >= 1 + removed + fx.view.viewportHeight || fx.view.isFollowingEnd, `step ${step}: removed ${removed} rows at ${before.top}`);
			unloaded.push(now);
			drawn = now;
		}
		assert.deepEqual(unloaded.map((list) => list[0]), ["prompt 1", "prompt 3", "prompt 5", "prompt 7"]);
		assert.deepEqual(prompts(chat(fx.host)), all(7, 9), "the floor stays, nothing more is removed");
	});
});

it("a wheel step that loaded does not unload, and the next one down keeps what it loaded", () => {
	run(long().manager, (fx) => {
		wheelTo(fx, 1);
		fx.wheel(-1);
		assert.deepEqual(prompts(chat(fx.host)), all(5, 9));
		for (let i = 0; i < 5; i++) fx.wheel(1);
		assert.deepEqual(prompts(chat(fx.host)), all(5, 9));
	});
});

it("unloads only what is entirely above the screen on Escape, Ctrl+End and Jump to latest", () => {
	// Escape in RQW-scroll calls scrollToBottom; the key and the label click arrive as terminal input.
	const paths: [string, (fx: Fullscreen) => void][] = [
		["scrollToBottom", (fx) => { fx.screen.scrollToBottom(); fx.frame(); }],
		["Ctrl+End", (fx) => fx.send("\x1b[1;5F")],
		["Jump to latest", (fx) => {
			const row = fx.rows().findIndex((line) => line.includes("Jump to latest"));
			assert.ok(row >= 0, "the label is on the screen");
			const column = fx.rows()[row].indexOf("Jump to latest") + 2;
			fx.send(`\x1b[<0;${column};${row + 1}M`);
			fx.send(`\x1b[<0;${column};${row + 1}m`);
		}],
	];
	for (const [name, go] of paths) {
		// The screen (60 rows) is taller than the latest interval (36), so loaded older rows are visible at the end.
		run(long().manager, (fx) => {
			loadAll(fx);
			fx.view.scrollTo(30);
			fx.frame();
			const before = documentRows(fx);
			go(fx);
			assert.equal(fx.view.isFollowingEnd, true, name);
			assertCoherent(fx, name);
			// The end of the transcript as it was before anything left: the unload took away only rows above the screen.
			for (let i = 0; i < fx.view.viewportHeight - 1; i++) assert.equal(fx.rows()[i], before[before.length - fx.view.viewportHeight + i] ?? "", `${name}: row ${i}`);
			assert.deepEqual(prompts(chat(fx.host)), all(5, 9), name);
		}, { rows: 60 });
		// Shorter than the latest interval: nothing older is on the screen at the end.
		run(long().manager, (fx) => {
			loadAll(fx);
			fx.view.scrollTo(30);
			fx.frame();
			go(fx);
			assertCoherent(fx, name);
			assert.deepEqual(prompts(chat(fx.host)), all(7, 9), name);
		});
	}
});

it("takes the current heights: Ctrl+O, the thinking toggle and a resize change them after the load", () => {
	const states: [string, (fx: Fullscreen) => void][] = [
		["Ctrl+O", (fx) => fx.host.toggleToolOutputExpansion()],
		["thinking", (fx) => fx.host.toggleThinkingBlockVisibility()],
		["resize", (fx) => { (fx.terminal as any).columns = 30; }],
	];
	for (const [name, change] of states) {
		run(buildSession(10, 2, 1, true).manager, (fx) => {
			loadAll(fx);
			change(fx);
			fx.frame();
			for (let step = 0; step < 400 && !fx.view.isFollowingEnd; step++) {
				assertScrolled(fx, 1, () => fx.wheel(1), `${name}: step ${step}`, (fx.terminal as any).columns);
				const document = documentRows(fx, (fx.terminal as any).columns);
				const rows = fx.rows();
				for (let i = 0; i < fx.view.viewportHeight - 1; i++) assert.equal(rows[i], document[fx.view.scrollTop + i] ?? "", `${name}: step ${step} row ${i}`);
			}
			assert.equal(fx.view.isFollowingEnd, true, name);
			assert.deepEqual(prompts(chat(fx.host).map((line) => line.trim())), all(7, 9), name);
		});
	}
});

it("checks the heights again at the input, not only in the last frame's layout", () => {
	run(long().manager, (fx) => {
		loadAll(fx);
		// The oldest interval (9 rows, 1 row of header above it) is one row short of being a whole screen above.
		while (fx.view.scrollTop < 22) fx.wheel(1);
		assert.equal(fx.view.scrollTop, 22);
		assert.deepEqual(prompts(chat(fx.host)), all(0, 9));
		// Expanded tool output makes it taller; no frame has drawn that yet.
		fx.host.toggleToolOutputExpansion();
		fx.raw("\x1b[<65;10;3M");
		assert.deepEqual(prompts(chat(fx.host)), all(0, 9));
		fx.frame();
		assertCoherent(fx, "after the toggle");
	});
});

it("does not unload before the first frame after a resize", () => {
	run(long().manager, (fx) => {
		loadAll(fx);
		fx.view.scrollTo(150);
		fx.frame();
		(fx.terminal as any).columns = 30;
		// The last frame's layout is for the old width: the wheel must wait for the next frame.
		fx.raw("\x1b[<65;10;3M");
		assert.deepEqual(prompts(chat(fx.host)), all(0, 9));
	});
});

it("leaves no unloaded children, layout or selection behind", () => {
	run(long().manager, (fx) => {
		loadAll(fx);
		const loaded = fx.host.chatContainer.children.slice(0, fx.host.chatContainer.children.length - 1);
		const live = { updateResult() {} };
		fx.host.pendingTools.set("live", live);
		fx.view.scrollTo(30);
		fx.frame();
		fx.screen.scrollToBottom();
		fx.frame();
		const left = new Set<unknown>(fx.host.chatContainer.children);
		assert.ok(loaded.some((child: unknown) => !left.has(child)), "something was removed");
		assert.deepEqual([...fx.host.pendingTools.entries()], [["live", live]]);
		assert.equal(fx.screen.hasActiveSelection(), false);
		// The chat starts again at its floor.
		assert.deepEqual(prompts(chat(fx.host)), all(7, 9));
		// Loading again works after unloading.
		fx.view.scrollTo(0);
		fx.frame();
		fx.wheel(-1);
		assert.deepEqual(prompts(chat(fx.host)), all(5, 9));
	});
});

it("drops the text selection and Pi's cached row layout when it unloads", () => {
	run(long().manager, (fx) => {
		loadAll(fx);
		fx.view.scrollTo(30);
		fx.frame();
		const row = fx.rows().findIndex((line) => line.length > 6) + 1;
		fx.send(`\x1b[<0;3;${row}M`);
		fx.send(`\x1b[<32;20;${row}M`);
		assert.equal(fx.screen.hasActiveSelection(), true);
		fx.raw("\x1b[1;5F");
		assert.equal(fx.screen.hasActiveSelection(), false);
		assert.deepEqual([fx.host.chatContainer, fx.host.documentContainer].map((container: any) => container.mouseLayout), [undefined, undefined]);
	});
});

it("an open tool call keeps its result when intervals load and unload around it", () => {
	run(long().manager, (fx) => {
		fx.host.toggleToolOutputExpansion();
		const call = { type: "toolCall", id: "live", name: "read", arguments: { path: "live.ts" } };
		const message = { role: "assistant", content: [call], stopReason: "toolUse", timestamp: 90 };
		fx.host.handleEvent({ type: "message_start", message });
		fx.host.handleEvent({ type: "message_update", message });
		fx.host.handleEvent({ type: "tool_execution_start", toolCallId: "live", toolName: "read", args: call.arguments });
		loadAll(fx);
		fx.screen.scrollToBottom();
		fx.frame();
		assert.deepEqual(prompts(chat(fx.host)), all(7, 9));
		fx.host.handleEvent({ type: "tool_execution_end", toolCallId: "live", toolName: "read", isError: false, result: { content: [{ type: "text", text: "LIVE-RESULT" }] } });
		fx.frame();
		assert.ok(fx.rows().some((row) => row.includes("LIVE-RESULT")), fx.rows().join("|"));
	});
});

it("a failure while unloading draws the whole branch at once", () => {
	run(long().manager, (fx) => {
		loadAll(fx);
		fx.view.scrollTo(30);
		fx.frame();
		let broken = true;
		const scrollTo = fx.view.scrollTo.bind(fx.view);
		fx.view.scrollTo = (top: number, ...rest: any[]) => { if (broken) { broken = false; throw new Error("boom"); } return (scrollTo as any)(top, ...rest); };
		fx.screen.scrollToBottom();
		assert.equal(broken, false, "the failure was injected");
		assert.deepEqual(prompts(chat(fx.host)), all(0, 9));
		fx.host.chatContainer.clear();
		fx.host.renderInitialMessages();
		assert.deepEqual(prompts(chat(fx.host)), all(0, 9));
	});
});

it("a compaction after intervals were loaded and some unloaded keeps what is still loaded", async () => {
	const { manager, turnUserIds } = long();
	await runAsync(manager, async (fx) => {
		loadAll(fx);
		fx.screen.scrollToBottom();
		fx.frame();
		fx.view.scrollTo(0);
		fx.frame();
		fx.wheel(-1);
		assert.deepEqual(prompts(chat(fx.host)), all(5, 9));
		fx.view.scrollTo(5);
		fx.frame();
		const before = fx.rows();
		manager.appendCompaction("fresh", turnUserIds[9], 9000);
		await fx.host.handleEvent({ type: "compaction_end", reason: "threshold", result: { summary: "fresh", tokensBefore: 9000 } });
		fx.frame();
		assert.deepEqual(prompts(chat(fx.host)), all(5, 9));
		assert.deepEqual(fx.rows(), before);
		// The restored intervals are separate again: scrolling down unloads them one by one.
		fx.screen.scrollToBottom();
		fx.frame();
		assert.deepEqual(prompts(chat(fx.host)), all(9, 9));
	});
});

it("unloads on Page Down by the page the key asks for, and nothing visible jumps", () => {
	run(long().manager, (fx) => {
		loadAll(fx);
		fx.view.scrollTo(30);
		fx.frame();
		// Pi's page is the viewport less 4 rows of overlap.
		const page = fx.view.viewportHeight - 4;
		let unloads = 0;
		for (let step = 0; step < 100 && !fx.view.isFollowingEnd; step++) {
			const drawn = prompts(chat(fx.host)).length;
			assertScrolled(fx, page, () => fx.send("\x1b[6~"), `page ${step}`);
			if (prompts(chat(fx.host)).length < drawn) unloads++;
		}
		assert.ok(unloads >= 3, `unloaded ${unloads} times`);
		assert.deepEqual(prompts(chat(fx.host)), all(7, 9));
	});
});

it("unloads on a scrollbar drag down, to the row the pointer asks for, and nothing visible jumps", () => {
	run(long().manager, (fx) => {
		loadAll(fx);
		fx.view.scrollTo(2);
		fx.frame();
		// The first scrollTo of each event is the one Pi computes from the pointer, before any unload moves it.
		const requested: number[] = [];
		const scrollTo = fx.view.scrollTo.bind(fx.view);
		fx.view.scrollTo = (top: number, ...rest: any[]) => { requested.push(top); return (scrollTo as any)(top, ...rest); };
		const width = fx.view.getContentWidth(WIDTH);
		const press = (row: number) => { requested.length = 0; const before = documentRows(fx, width); fx.send(`\x1b[<0;${WIDTH};${row}M`); return before; };
		const drag = (row: number) => { requested.length = 0; const before = documentRows(fx, width); fx.send(`\x1b[<32;${WIDTH};${row}M`); return before; };
		const check = (before: string[], label: string) => {
			const target = Math.max(0, Math.min(before.length - fx.view.viewportHeight, requested[0]));
			for (let i = 0; i < fx.view.viewportHeight - 1; i++) assert.equal(fx.rows()[i].slice(0, width).trimEnd(), before[target + i] ?? "", `${label}: row ${i}`);
		};
		// A press below the thumb takes hold of it; the pointer then moves down the track.
		let before = press(Math.floor(fx.view.viewportHeight / 4));
		check(before, "press");
		for (let row = Math.floor(fx.view.viewportHeight / 4) + 1; row <= fx.view.viewportHeight; row += 2) {
			const drawn = prompts(chat(fx.host)).length;
			before = drag(row);
			check(before, `drag to row ${row}`);
			assert.ok(prompts(chat(fx.host)).length <= drawn, "a drag down never loads");
		}
		fx.send(`\x1b[<0;${WIDTH};${fx.view.viewportHeight}m`);
		assert.deepEqual(prompts(chat(fx.host)), all(7, 9));
	}, { scrollbar: "always" });
});

it("a load that leaves the view following the end does not unload what it just loaded", () => {
	// No header row, and a viewport exactly as tall as the latest interval: the view is at the top and following the end, so
	// after the load it follows the end of a transcript whose loaded interval is wholly above the screen.
	for (const [name, load] of [["wheel up", (fx: Fullscreen) => fx.wheel(-1)], ["Ctrl+Home", (fx: Fullscreen) => fx.send("\x1b[1;5H")]] as const) {
		run(long().manager, (fx) => {
			assert.equal(fx.view.viewportHeight, documentRows(fx).length, "the transcript exactly fills the viewport");
			assert.deepEqual([fx.view.scrollTop, fx.view.isFollowingEnd], [0, true]);
			load(fx);
			assert.deepEqual(prompts(chat(fx.host)), all(5, 9), name);
			// The premise of the case: following, and the loaded rows are all above the screen.
			assert.equal(fx.view.isFollowingEnd, true, `${name}: following`);
			assert.equal(fx.view.scrollTop, documentRows(fx).length - fx.view.viewportHeight, `${name}: at the end`);
			assert.ok(fx.view.scrollTop > 0);
			// And the next load is still possible: scroll to the top and up.
			fx.view.scrollTo(0);
			fx.frame();
			load(fx);
			assert.deepEqual(prompts(chat(fx.host)), all(3, 9), name);
		}, { rows: 36, header: false });
	}
});

it("takes the heights as they are now: a Ctrl+O collapse before the next frame makes an interval short enough to go", () => {
	// Expanded, the oldest interval (prompt 0) is 11 rows and ends at row 12 of the document (1 header row); collapsed it is 9
	// rows and ends at row 10. A 13-row viewport one step down from the top of the document puts the limit at row 11.
	run(buildSession(10, 2, 1).manager, (fx) => {
		fx.host.toggleToolOutputExpansion();
		loadAll(fx);
		fx.frame();
		fx.view.scrollTo(23);
		fx.frame();
		fx.host.toggleToolOutputExpansion();
		// No frame has drawn the collapsed rows yet.
		fx.raw("\x1b[<65;10;3M");
		assert.deepEqual(prompts(chat(fx.host)), all(1, 9));
		fx.frame();
		assert.deepEqual(prompts(chat(fx.host)), all(1, 9));
	});
});

it("does not unload at the end an interval that the document as it is now still shows", () => {
	// Collapsed after the last frame, the transcript is shorter and the screen at its end reaches higher up: the stale
	// scroll position must not decide what is above the screen.
	run(buildSession(10, 2, 1).manager, (fx) => {
		fx.host.toggleToolOutputExpansion();
		loadAll(fx);
		fx.frame();
		fx.host.toggleToolOutputExpansion();
		fx.screen.scrollToBottom();
		fx.frame();
		const document = documentRows(fx);
		for (let i = 0; i < fx.view.viewportHeight - 1; i++) assert.equal(fx.rows()[i], document[fx.view.scrollTop + i] ?? "", `row ${i}`);
		// Collapsed, prompts 5 and 6 (rows 60 to 85) reach into the 50-row screen that ends at row 120: they stay, the ones
		// above go. With the old, taller numbers the end of the screen would have been 28 rows lower and they would have gone.
		assert.deepEqual(prompts(chat(fx.host)), all(5, 9));
		assert.ok(fx.rows().some((row) => row.includes("answer 6")));
	}, { rows: 51 });
});

it("a scrollbar drag up never unloads, even when intervals are far above the screen", () => {
	run(long().manager, (fx) => {
		loadAll(fx);
		// 40-row screen, 120-row document: the thumb is 13 rows of a 39-row track, one track row is about 3 document rows.
		// At 75 the thumb is on track rows 24 to 36; the oldest interval (rows 1 to 10) is far above every position below.
		fx.view.scrollTo(75);
		fx.frame();
		fx.send(`\x1b[<0;${WIDTH};31M`);
		const tops: number[] = [fx.view.scrollTop];
		for (let row = 30; row >= 26; row--) {
			fx.send(`\x1b[<32;${WIDTH};${row}M`);
			tops.push(fx.view.scrollTop);
			assert.deepEqual(prompts(chat(fx.host)), all(0, 9), `drag up to row ${row}`);
		}
		fx.send(`\x1b[<0;${WIDTH};26m`);
		// The drag really went up, and stayed far below the oldest interval, so a drag down would have unloaded it.
		assert.ok(tops.at(-1)! < tops[0] && Math.min(...tops) >= 40, tops.join(","));
	}, { rows: 40, scrollbar: "always" });
});
