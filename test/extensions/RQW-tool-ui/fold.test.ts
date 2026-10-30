import assert from "node:assert/strict";
import { afterEach, it } from "node:test";
import { AssistantMessageComponent, UserMessageComponent, type SessionEntry } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { Folds, installFolds } from "../../../extensions/RQW-tool-ui/fold.ts";
import { buildTurns, formatWorked } from "../../../extensions/RQW-tool-ui/groups.ts";
import { assistant, call, load, makeHost, makeScreen, result, Session, text, theme, user } from "./fold-host.ts";

const cleanups: (() => void)[] = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

/** The extension, a session and a fullscreen host drawn from it, as after a resume. */
function open(build: (s: Session) => void, renderer: unknown = makeScreen().screen) {
	const session = new Session();
	cleanups.push(() => session.end());
	build(session);
	const loaded = load();
	cleanups.push(() => loaded.shutdown());
	const host = makeHost(session.manager, loaded, renderer);
	host.renderInitialMessages();
	loaded.start(session.manager);
	host.chatContainer.render(80);
	return { session, loaded, host };
}

/** The folds on screen, through the header labels the model gives each finished turn. */
function labels(entries: readonly SessionEntry[]) {
	return [...buildTurns(entries).values()];
}

it("formats worked time in seconds, minutes and hours without a space before the unit", () => {
	assert.deepEqual([42_000, 59_600, 123_000, 3_599_600, 3_900_000].map(formatWorked), ["42s", "1m 00s", "2m 03s", "1h 00m", "1h 05m"]);
});

it("times a turn from the user message to the saved final answer", () => {
	const s = new Session();
	cleanups.push(() => s.end());
	s.turn(0, 1_000, 42);
	s.turn(1, 100_000, 123);
	assert.deepEqual(labels(s.manager.getBranch()), ["worked for 42s", "worked for 2m 03s"]);
});

it("does not finish a turn that ends in an error or abort, and finishes a successful retry", () => {
	const s = new Session();
	cleanups.push(() => s.end());
	s.add(user("a", 0), 0);
	s.add(assistant([text("partial")], "aborted", 1), 1_000);
	s.add(user("b", 10_000), 10_000);
	s.add(assistant([text("")], "error", 10_001), 11_000);
	s.add(assistant([text("ok")], "stop", 10_002), 15_000);
	s.add(user("c", 20_000), 20_000);
	s.add(assistant([text("cut")], "length", 20_001), 21_000);
	assert.deepEqual(labels(s.manager.getBranch()), ["worked for 15s"]);
});

it("ends turns at a compaction and at any compaction's first kept entry", () => {
	const s = new Session();
	cleanups.push(() => s.end());
	s.add(user("a", 0), 0);
	const kept = s.add(assistant([call("x", "a.ts")], "toolUse", 1), 1_000);
	s.add(result("x", "body", 2), 2_000);
	s.add(assistant([text("done a")], "stop", 3), 3_000);
	s.compact(kept, 4_000);
	s.add(user("b", 5_000), 5_000);
	s.add(assistant([text("done b")], "stop", 6), 6_000);
	// The kept suffix is independent: its clock starts at the kept assistant, not the older user.
	assert.deepEqual(labels(s.manager.getBranch()), ["worked for 3s", "worked for 1s"]);
});

it("binds each finished turn between its user message and final answer", () => {
	const m = mounted((s) => { s.turn(0, 0, 42); s.turn(1, 100_000, 7); });
	assert.ok(m.row("prompt 0") < m.row("worked for 42s ›") && m.row("worked for 42s ›") < m.row("answer 0"));
	assert.ok(m.row("prompt 1") < m.row("worked for 7s ›") && m.row("worked for 7s ›") < m.row("answer 1"));
});

it("starts closed after a rebuild and stays open on a redraw", () => {
	const m = mounted((s) => s.turn(0, 0, 42));
	m.click(1, m.row("worked for 42s ›"));
	m.host.chatContainer.render(120);
	assert.ok(m.row("worked for 42s ˅") >= 0 && m.row("update 0") >= 0);
	m.host.rebuildChatFromMessages();
	assert.ok(m.row("worked for 42s ›") >= 0 && m.row("update 0") < 0);
});

it("binds no fold for a turn without work", () => {
	const plain = open((s) => { s.add(user("hi", 0), 0); s.add(assistant([text("hello")], "stop", 1), 1_000); });
	assert.ok(!plain.host.chatContainer.render(80).some((row) => row.includes("worked for")));
});

it("leaves two owner messages and a final answer without work exactly as Pi drew them", () => {
	const m = mounted((s) => {
		s.add(user("first owner without work", 0), 0);
		s.add(user("second owner without work", 1_000), 1_000);
		s.add(assistant([text("answer without work")], "stop", 2_000), 3_000);
	});
	assert.ok(m.row("worked for") < 0);
	assert.deepEqual(m.host.chatContainer.render(80), m.stock.chatContainer.render(80));
});

it("binds no fold in Pi's inline mode, without fullscreen mouse reporting", () => {
	const inline = open((s) => s.turn(0, 0, 42), { mouseEnabled: true });
	const rows = inline.host.chatContainer.render(80);
	assert.ok(!rows.some((row) => row.includes("worked for")) && rows.some((row) => row.includes("update 0")));
});

/** One session drawn twice: by stock Pi with tool-ui (inline renderer, no folds) and by Pi's fullscreen view. */
function scene(build: (s: Session) => void) {
	const session = new Session();
	cleanups.push(() => session.end());
	build(session);
	const loaded = load();
	cleanups.push(() => loaded.shutdown());
	const stock = makeHost(session.manager, loaded, { mouseEnabled: true });
	stock.renderInitialMessages();
	const screen = makeScreen();
	const host = makeHost(session.manager, loaded, screen.screen);
	host.renderInitialMessages();
	loaded.start(session.manager);
	return { session, loaded, stock, host, screen };
}

const headerOf = (label: string, open: boolean) => " " + theme.fg("dim", `${label} ${open ? "˅" : "›"}`);

const withoutHeaders = (rows: string[]) => rows.filter((row) => !/worked for/.test(row));

it("closed, a finished turn shows its user message, one header and the final answer; open, exactly the rows before", () => {
	const m = mounted((s) => { s.turn(0, 0, 42); s.turn(1, 100_000, 123); });
	const { stock, host } = m;
	const before = stock.chatContainer.render(80);
	assert.ok(before.some((row) => row.includes("update 0")) && before.some((row) => row.includes("card 0")) && before.some((row) => row.includes("Read 1 file")));
	const closed = host.chatContainer.render(80);
	assert.ok(closed.includes(headerOf("worked for 42s", false)) && closed.includes(headerOf("worked for 2m 03s", false)));
	for (const gone of ["update 0", "card 0", "Read 1 file", "plan 0"]) assert.ok(!closed.some((row) => row.includes(gone)), gone);
	for (const kept of ["prompt 0", "answer 0", "sum 0", "prompt 1", "answer 1"]) assert.ok(closed.some((row) => row.includes(kept)), kept);
	m.click(1, m.row("worked for 42s ›"));
	const opened = host.chatContainer.render(80);
	assert.ok(opened.includes(headerOf("worked for 42s", true)) && opened.includes(headerOf("worked for 2m 03s", false)));
	m.click(1, m.row("worked for 2m 03s ›"));
	assert.deepEqual(withoutHeaders(host.chatContainer.render(80)), before);
});

it("open work follows Ctrl+T and Ctrl+O as before the fold, and neither opens a fold", () => {
	const m = mounted((s) => s.turn(0, 0, 42));
	const { stock, host } = m;
	for (const h of [stock, host]) { h.hideThinkingBlock = true; h.updateThinkingBlockVisibility(); h.setToolsExpanded(true); }
	assert.ok(m.row("worked for 42s ›") >= 0);
	m.click(1, m.row("worked for 42s ›"));
	const before = stock.chatContainer.render(80);
	const plain = before.map(stripTerminalSequences);
	assert.ok(!plain.some((row) => row.includes("plan 0")) && plain.some((row) => row.includes("body 0")));
	assert.deepEqual(withoutHeaders(host.chatContainer.render(80)), before);
});

it("does not render hidden components and gives them their own render back once unbound", () => {
	const { host } = scene((s) => s.turn(0, 0, 42));
	host.chatContainer.render(80);
	const members = host.chatContainer.children.filter((c) => c instanceof AssistantMessageComponent && c.render(80).length === 0);
	let calls = 0;
	const proto = AssistantMessageComponent.prototype as unknown as { render(width: number): string[] };
	const render = proto.render;
	proto.render = function (this: object, width: number) { if (members.some((member) => member === this)) calls++; return render.call(this, width); };
	try { host.chatContainer.render(80); } finally { proto.render = render; }
	assert.equal(calls, 0);
	host.rebuildChatFromMessages();
	host.chatContainer.render(80);
	assert.ok(members.every((m) => !Object.hasOwn(m, "render")));
});

it("keeps all rows visible if an inherited user update method cannot be wrapped", () => {
	const prototype = UserMessageComponent.prototype;
	const descriptor = Object.getOwnPropertyDescriptor(prototype, "rebuild")!;
	Object.defineProperty(prototype, "rebuild", { ...descriptor, writable: false });
	try {
		const m = mounted((s) => s.turn(0, 0, 42));
		assert.ok(m.row("worked for") < 0 && m.row("prompt 0") >= 0 && m.row("update 0") >= 0);
		assert.deepEqual(m.host.chatContainer.render(80), m.stock.chatContainer.render(80));
	} finally { Object.defineProperty(prototype, "rebuild", descriptor); }
});

it("leaves a foreign container shape visible and unchanged", () => {
	const prototype = { addMessageToChat(this: { chatContainer: { rows: string[] } }, message: string) { this.chatContainer.rows.push(message); } };
	const restore = installFolds(new Folds(), prototype);
	try {
		const host = Object.assign(Object.create(prototype), { chatContainer: { rows: ["old work"], render() { return this.rows; } } });
		host.addMessageToChat("new answer");
		assert.deepEqual(host.chatContainer.render(), ["old work", "new answer"]);
	} finally { restore(); }
});

it("leaves a turn visible and unfolded when one component cannot take the wrapper", () => {
	const session = new Session();
	cleanups.push(() => session.end());
	session.turn(0, 0, 42);
	session.turn(1, 100_000, 7);
	const loaded = load();
	cleanups.push(() => loaded.shutdown());
	const screen = makeScreen();
	const host = makeHost(session.manager, loaded, screen.screen);
	host.renderInitialMessages();
	// One component of the first turn has an unexpected shape: it is not extensible and cannot be wrapped.
	const odd = host.chatContainer.children.find((c: object) => (c as { render(width: number): string[] }).render(80).some((row) => row.includes("card 0")));
	assert.ok(odd);
	Object.preventExtensions(odd);
	loaded.start(session.manager);
	const rows = host.chatContainer.render(80);
	for (const kept of ["update 0", "card 0", "Read 1 file", "answer 0"]) assert.ok(rows.some((row) => row.includes(kept)), kept);
	assert.ok(!rows.includes(headerOf("worked for 42s", false)) && !rows.includes(headerOf("worked for 42s", true)));
	// The healthy turn after it still folds.
	assert.ok(rows.includes(headerOf("worked for 7s", false)) && !rows.some((row) => row.includes("update 1")));
});

/** The scene inside Pi's fullscreen renderer, started over the fake terminal. */
function mounted(build: (s: Session) => void, columns = 80, rows = 60) {
	const s = scene(build);
	const screen = makeScreen(columns, rows);
	s.host.renderer = screen.screen;
	screen.screen.addChild(s.host.chatContainer);
	screen.screen.start();
	cleanups.push(() => screen.stop());
	const row = (text: string) => screen.frame().findIndex((line) => line.includes(text));
	// SGR mouse reports: 0 press, 32 drag, release with `m`; one-based cells.
	const press = (x: number, y: number) => screen.input(`\x1b[<0;${x + 1};${y + 1}M`);
	const release = (x: number, y: number) => screen.input(`\x1b[<0;${x + 1};${y + 1}m`);
	const click = (x: number, y: number) => { press(x, y); release(x, y); };
	return { ...s, screen, row, press, release, click };
}

it("keeps live work visible until the agent settles", () => {
	const m = mounted(() => {});
	const add = (message: unknown, at: number) => {
		m.session.add(message, at);
		(m.host as unknown as { addMessageToChat(message: unknown): void }).addMessageToChat(message);
	};
	add(user("live prompt", 0), 0);
	add(assistant([text("live work")], "toolUse", 1), 1_000);
	assert.ok(m.row("live work") >= 0 && m.row("worked for") < 0);
	add(assistant([text("live answer")], "stop", 2), 42_000);
	assert.ok(m.row("live work") >= 0 && m.row("worked for") < 0);
	m.loaded.handlers.get("agent_settled")!();
	assert.ok(m.row("worked for 42s ›") >= 0 && m.row("live work") < 0 && m.row("live answer") >= 0);
});

it("keeps earlier turns and the user outside a live streamed fold", async () => {
	const m = mounted((s) => { s.turn(0, 0, 42); s.turn(1, 100_000, 7); });
	assert.ok(m.row("worked for 42s ›") >= 0 && m.row("worked for 7s ›") >= 0);
	const host = m.host as any;
	host.setToolsExpanded(true);
	host.programStatus = { handleEvent() {} };
	host.updatePendingMessagesDisplay = () => {};
	host.checkShutdownRequested = async () => {};
	const event = async (value: any) => { await host.handleEvent(value); };
	const prompt = user("live prompt", 200_000);
	m.session.add(prompt, 200_000);
	await event({ type: "message_start", message: prompt });
	m.loaded.handlers.get("agent_settled")!();
	assert.ok(m.row("live prompt") >= 0);
	const card = m.session.card("live card", 200_500);
	await event({ type: "entry_appended", entry: m.session.manager.getEntry(card) });
	await event({ type: "tool_execution_start", toolCallId: "direct", toolName: "read", args: { path: "direct.ts" } });
	await event({ type: "tool_execution_end", toolCallId: "direct", result: { content: [text("direct body")] }, isError: false });
	const work = assistant([text("live update"), call("live", "live.ts")], "toolUse", 201_000);
	await event({ type: "message_start", message: work });
	await event({ type: "message_update", message: work });
	await event({ type: "message_end", message: work });
	m.session.add(work, 201_000);
	await event({ type: "tool_execution_start", toolCallId: "live", toolName: "read", args: { path: "live.ts" } });
	await event({ type: "tool_execution_end", toolCallId: "live", result: { content: [text("live body")] }, isError: false });
	m.session.add(result("live", "live body", 202_000), 202_000);
	for (const visible of ["direct.ts", "live.ts"]) assert.ok(m.row(visible) >= 0, visible);
	const answer = assistant([text("live answer")], "stop", 203_000);
	await event({ type: "message_start", message: answer });
	await event({ type: "message_update", message: answer });
	await event({ type: "message_end", message: answer });
	m.session.add(answer, 210_000);
	await event({ type: "agent_settled" });
	m.loaded.handlers.get("agent_settled")!();
	for (const kept of ["prompt 0", "worked for 42s ›", "answer 0", "prompt 1", "worked for 7s ›", "answer 1", "live prompt", "worked for 10s ›", "live answer"]) assert.ok(m.row(kept) >= 0, kept);
	for (const hidden of ["live update", "live card", "direct.ts", "live.ts"]) assert.ok(m.row(hidden) < 0, hidden);
	m.click(1, m.row("worked for 10s ›"));
	for (const back of ["direct.ts", "live.ts"]) assert.ok(m.row(back) >= 0, back);
});

it("keeps each answer outside an independent fold and times a wake-up from its delivered card", () => {
	const m = mounted((s) => {
		s.add(user("prompt", 0), 0);
		s.add(assistant([text("initial work")], "toolUse", 1_000), 1_000);
		s.add(assistant([text("first answer")], "stop", 2_000), 5_000);
		s.card("late child result", 60_000);
		s.add(assistant([text("second answer")], "stop", 61_000), 64_000);
	});
	assert.ok(m.row("prompt") < m.row("worked for 5s ›"));
	assert.ok(m.row("worked for 5s ›") < m.row("first answer"));
	assert.ok(m.row("first answer") < m.row("worked for 4s ›"));
	assert.ok(m.row("worked for 4s ›") < m.row("second answer"));
	assert.ok(m.row("initial work") < 0 && m.row("late child result") < 0);
	m.click(70, m.row("worked for 4s ›"));
	assert.ok(m.row("late child result") > m.row("worked for 4s ˅"));
	assert.ok(m.row("worked for 5s ›") >= 0);
	m.click(70, m.row("worked for 5s ›"));
	assert.deepEqual(withoutHeaders(m.host.chatContainer.render(80)), m.stock.chatContainer.render(80));
});

it("does not lose earlier answers when a later tool, abort and a new prompt precede the next answer", () => {
	const m = mounted((s) => {
		s.add(user("first prompt", 0), 0);
		s.add(assistant([text("first work")], "toolUse", 1_000), 1_000);
		s.add(assistant([text("question for owner")], "stop", 2_000), 5_000);
		s.card("second work card", 8_000);
		s.add(assistant([text("second answer")], "stop", 9_000), 12_000);
	});
	m.click(70, m.row("worked for 5s ›"));
	const add = (message: unknown, at: number) => {
		m.session.add(message, at);
		(m.host as unknown as { addMessageToChat(message: unknown): void }).addMessageToChat(message);
	};
	const card = m.session.card("new wake-up", 20_000);
	const entry = m.session.manager.getEntry(card)! as { content: string; timestamp: string };
	(m.host as unknown as { addMessageToChat(message: unknown): void }).addMessageToChat({ role: "custom", customType: "note", display: true, content: entry.content, timestamp: Date.parse(entry.timestamp) });
	add(assistant([text("late tool work"), call("late", "late.ts")], "toolUse", 21_000), 21_000);
	add(assistant([text("aborted work")], "aborted", 22_000), 22_000);
	add(user("new prompt", 23_000), 23_000);
	m.loaded.handlers.get("agent_settled")!();
	for (const kept of ["worked for 5s ˅", "question for owner", "worked for 4s ›", "second answer", "new wake-up", "late tool work", "aborted work", "new prompt"]) assert.ok(m.row(kept) >= 0, kept);
	assert.ok(m.row("second work card") < 0);
});

it("folds the prefix and local suffix separately in the whole branch and restores their original rows", () => {
	const m = mounted((s) => {
		s.add(user("prompt before cut", 0), 0);
		s.add(assistant([text("prefix stays visible")], "toolUse", 1_000), 1_000);
		const kept = s.add(assistant([text("kept local work"), call("kept", "kept.ts")], "toolUse", 5_000), 5_000);
		s.add(result("kept", "kept body", 6_000), 6_000);
		s.add(assistant([text("local answer")], "stop", 7_000), 12_000);
		s.compact(kept, 13_000);
	});
	// Show the whole saved branch without loading another extension; the cut remains a hard boundary.
	for (const host of [m.stock, m.host]) {
		host.chatContainer.clear();
		(host as unknown as { renderSessionEntries(entries: readonly SessionEntry[]): void }).renderSessionEntries(m.session.manager.getBranch());
	}
	assert.ok(m.row("prompt before cut") >= 0 && m.row("prefix stays visible") < 0);
	assert.ok(m.row("worked for 1s ›") >= 0);
	m.click(70, m.row("worked for 1s ›"));
	assert.ok(m.row("prefix stays visible") > m.row("worked for 1s ˅"));
	assert.ok(m.row("kept local work") < 0);
	assert.ok(m.row("worked for 7s ›") >= 0 && m.row("kept local work") < 0);
	assert.ok(m.row("local answer") > m.row("worked for 7s ›"));
	m.click(70, m.row("worked for 7s ›"));
	assert.ok(m.row("kept local work") > m.row("worked for 7s ˅"));
	assert.deepEqual(withoutHeaders(m.host.chatContainer.render(80)), m.stock.chatContainer.render(80));
});

for (const boundary of ["compaction", "branch summary", "! command"] as const) it(`keeps ${boundary} outside a local fold without an owner prompt`, () => {
	const m = mounted((s) => {
		const prompt = s.add(user("old prompt", 0), 0);
		s.add(assistant([text("unfinished prefix")], "toolUse", 1_000), 1_000);
		if (boundary === "compaction") s.compact(prompt, 2_000);
		else if (boundary === "branch summary") s.manager.branchWithSummary(s.manager.getLeafId(), "branch boundary");
		else s.add({ role: "bashExecution", command: "echo boundary", output: "boundary output", exitCode: 0, cancelled: false, excludeFromContext: false, timestamp: 2_000 }, 2_000);
		s.card("post-boundary work", 3_000);
		s.add(assistant([text("post-boundary answer")], "stop", 4_000), 7_000);
	});
	for (const host of [m.stock, m.host]) {
		host.chatContainer.clear();
		(host as unknown as { renderSessionEntries(entries: readonly SessionEntry[]): void }).renderSessionEntries(m.session.manager.getBranch());
	}
	assert.ok(m.row("old prompt") >= 0 && m.row("unfinished prefix") >= 0);
	assert.ok(m.row("worked for 4s ›") >= 0 && m.row("post-boundary work") < 0);
	assert.ok(m.row("post-boundary answer") > m.row("worked for 4s ›"));
	const mark = boundary === "compaction" ? "Compacted" : boundary === "branch summary" ? "Branch" : "echo boundary";
	assert.ok(m.row(mark) >= 0, mark);
	m.click(70, m.row("worked for 4s ›"));
	assert.ok(m.row("post-boundary work") > m.row("worked for 4s ˅"));
	assert.deepEqual(withoutHeaders(m.host.chatContainer.render(80)), m.stock.chatContainer.render(80));
});

it("adds no empty fold between adjacent answers and leaves both as boundaries", () => {
	const m = mounted((s) => {
		s.add(user("prompt", 0), 0);
		s.add(assistant([text("original work")], "toolUse", 1_000), 1_000);
		s.add(assistant([text("question")], "stop", 2_000), 5_000);
		s.add(assistant([text("additional answer")], "stop", 6_000), 7_000);
	});
	assert.ok(m.row("worked for 5s ›") >= 0 && m.row("original work") < 0);
	assert.ok(m.row("question") > m.row("worked for 5s ›"));
	assert.ok(m.row("additional answer") > m.row("question"));
	assert.equal(m.screen.frame().filter(row => row.includes("worked for")).length, 1);
});

it("lifts all owner messages in order and restores their positions among the original work", () => {
	const m = mounted((s) => {
		s.add(user("first owner message", 0), 0);
		s.add(assistant([text("work before steering")], "toolUse", 1_000), 1_000);
		s.add(user("second owner message", 2_000), 2_000);
		s.add(assistant([text("work after steering")], "toolUse", 3_000), 3_000);
		s.add(assistant([text("final answer")], "stop", 4_000), 5_000);
	});
	assert.ok(m.row("first owner message") >= 0);
	assert.ok(m.row("first owner message") < m.row("second owner message"));
	assert.ok(m.row("second owner message") < m.row("worked for 5s ›"));
	assert.ok(m.row("worked for 5s ›") < m.row("final answer"));
	assert.ok(m.row("work before steering") < 0 && m.row("work after steering") < 0);
	for (const owner of ["first owner message", "second owner message"]) {
		assert.equal(m.screen.frame().filter(row => row.includes(owner)).length, 1, owner);
	}
	m.click(70, m.row("worked for 5s ›"));
	assert.ok(m.row("first owner message") < m.row("work before steering"));
	assert.ok(m.row("work before steering") < m.row("second owner message"));
	assert.ok(m.row("second owner message") < m.row("work after steering"));
	assert.deepEqual(withoutHeaders(m.host.chatContainer.render(80)), m.stock.chatContainer.render(80));
});

it("folds a multi-user span without inventing a row for an image-only prompt", () => {
	const m = mounted((s) => {
		s.add(user("earlier prompt", 0), 0);
		s.add(assistant([text("unfinished work")], "toolUse", 1), 1_000);
		s.add({ role: "user", content: [{ type: "image", data: "AA==", mimeType: "image/png" }], timestamp: 2_000 }, 2_000);
		s.add(assistant([text("new work")], "toolUse", 3), 3_000);
		s.add(assistant([text("new answer")], "stop", 4), 5_000);
	});
	assert.ok(m.row("earlier prompt") >= 0 && m.row("unfinished work") < 0);
	assert.ok(m.row("worked for 5s ›") >= 0 && m.row("new work") < 0 && m.row("new answer") >= 0);
	m.click(70, m.row("worked for 5s ›"));
	assert.deepEqual(withoutHeaders(m.host.chatContainer.render(80)), m.stock.chatContainer.render(80));
});

it("lifts a sole owner message sent after an agent card, without hiding or duplicating it", () => {
	const m = mounted((s) => {
		s.card("agent card before owner", 1_000);
		s.add(user("sole owner message", 2_000), 2_000);
		s.add(assistant([text("answer after owner")], "stop", 3_000), 5_000);
	});
	assert.ok(m.row("sole owner message") >= 0);
	assert.ok(m.row("sole owner message") < m.row("worked for 4s ›"));
	assert.ok(m.row("worked for 4s ›") < m.row("answer after owner"));
	assert.ok(m.row("agent card before owner") < 0);
	assert.equal(m.screen.frame().filter(row => row.includes("sole owner message")).length, 1);
	m.click(70, m.row("worked for 4s ›"));
	assert.ok(m.row("agent card before owner") < m.row("sole owner message"));
	assert.deepEqual(withoutHeaders(m.host.chatContainer.render(80)), m.stock.chatContainer.render(80));
});

it("keeps closed lifted rows cached and invalidates them when an original user card changes", () => {
	const m = mounted((s) => {
		s.add(user("first cached owner", 0), 0);
		s.add(assistant([text("hidden work")], "toolUse", 1_000), 1_000);
		s.add(user("second cached owner", 2_000), 2_000);
		s.add(assistant([text("cache answer")], "stop", 3_000), 5_000);
	});
	assert.ok(m.row("worked for 5s ›") >= 0);
	const cards = m.host.chatContainer.children.filter(child => child instanceof UserMessageComponent);
	const original = UserMessageComponent.prototype.render;
	let renders = 0;
	UserMessageComponent.prototype.render = function (width: number) { renders++; return original.call(this, width); };
	try {
		m.screen.frame();
		m.screen.frame();
		assert.equal(renders, 0);
		cards[1].setOutputPad(3);
		const changed = m.screen.frame();
		assert.equal(renders, 2);
		assert.equal(changed.find(row => row.includes("second cached owner"))?.indexOf("second cached owner"), 3);
		m.screen.frame();
		assert.equal(renders, 2);
	} finally { UserMessageComponent.prototype.render = original; }
});

it("places the click target after wrapped lifted rows and keeps owner clicks separate after resize", () => {
	const m = mounted((s) => {
		s.add(user("first owner", 0), 0);
		s.add(assistant([text("geometry work")], "toolUse", 1_000), 1_000);
		s.add(user("steering ".repeat(12) + "end", 2_000), 2_000);
		s.add(assistant([text("geometry answer")], "stop", 3_000), 5_000);
	});
	assert.ok(m.row("steering") < m.row("worked for 5s ›"));
	m.screen.terminal.columns = 40;
	m.click(30, m.row("steering"));
	assert.ok(m.row("worked for 5s ›") >= 0 && m.row("geometry work") < 0);
	m.click(39, m.row("worked for 5s ›"));
	assert.ok(m.row("worked for 5s ˅") >= 0 && m.row("geometry work") >= 0);
	assert.deepEqual(withoutHeaders(m.host.chatContainer.render(40)), m.stock.chatContainer.render(40));
});

for (const ownerText of ["", "owner text after skill"]) it(`lifts a skill bundle and routes its original clicks ${ownerText ? "with text" : "without text"}`, () => {
	const m = mounted((s) => {
		s.add(user("first owner", 0), 0);
		s.add(assistant([text("skill work")], "toolUse", 1_000), 1_000);
		s.add(user('<skill name="sample" location="/skills/sample.md">\nunique skill body\n</skill>' + (ownerText ? "\n\n" + ownerText : ""), 2_000), 2_000);
		s.add(assistant([text("skill answer")], "stop", 3_000), 5_000);
	});
	assert.ok(m.row("[skill]") >= 0 && m.row("[skill]") < m.row("worked for 5s ›"));
	if (ownerText) assert.ok(m.row(ownerText) >= 0 && m.row(ownerText) < m.row("worked for 5s ›"));
	m.host.setToolsExpanded(true);
	assert.ok(m.row("unique skill body") >= 0 && m.row("unique skill body") < m.row("worked for 5s ›"));
	m.host.setToolsExpanded(false);
	assert.ok(m.row("unique skill body") < 0 && m.row("worked for 5s ›") >= 0);
	m.click(2, m.row("[skill]"));
	assert.ok(m.row("unique skill body") >= 0 && m.row("worked for 5s ›") >= 0);
	m.stock.setToolsExpanded(true);
	m.click(70, m.row("worked for 5s ›"));
	assert.deepEqual(withoutHeaders(m.host.chatContainer.render(80)), m.stock.chatContainer.render(80));
});

it("matches a live delivered card to its saved entry despite different timestamps", () => {
	const m = mounted(() => {});
	const host = m.host as unknown as { addMessageToChat(message: unknown): void };
	host.addMessageToChat({ role: "custom", customType: "note", display: true, content: "delayed card", timestamp: 1_000 });
	assert.ok(m.row("delayed card") >= 0);
	m.session.card("delayed card", 3_000);
	const answer = assistant([text("answer immediately after card")], "stop", 4_000);
	m.session.add(answer, 7_000);
	host.addMessageToChat(answer);
	const before = m.host.chatContainer.render(80);
	m.loaded.handlers.get("agent_settled")!();
	assert.ok(m.row("worked for 4s ›") >= 0 && m.row("delayed card") < 0);
	assert.ok(m.row("answer immediately after card") > m.row("worked for 4s ›"));
	m.click(70, m.row("worked for 4s ›"));
	assert.ok(m.row("delayed card") > m.row("worked for 4s ˅"));
	assert.deepEqual(withoutHeaders(m.host.chatContainer.render(80)), before);
});

it("matches repeated delayed cards by saved order without joining their answer spans", () => {
	const m = mounted(() => {});
	const host = m.host as unknown as { addMessageToChat(message: unknown): void };
	for (const [sent, saved, end, label] of [[1_000, 3_000, 7_000, "4s"], [10_000, 13_000, 20_000, "7s"]] as const) {
		host.addMessageToChat({ role: "custom", customType: "note", display: true, content: "identical delayed card", timestamp: sent });
		assert.ok(m.row("identical delayed card") >= 0);
		m.session.card("identical delayed card", saved);
		const answer = assistant([text(`answer ${label}`)], "stop", end - 1_000);
		m.session.add(answer, end);
		host.addMessageToChat(answer);
		m.loaded.handlers.get("agent_settled")!();
		assert.ok(m.row(`worked for ${label} ›`) >= 0 && m.row("identical delayed card") < 0);
	}
	m.click(70, m.row("worked for 7s ›"));
	assert.equal(m.screen.frame().filter(row => row.includes("identical delayed card")).length, 1);
	assert.ok(m.row("worked for 4s ›") >= 0);
	m.click(70, m.row("worked for 4s ›"));
	assert.equal(m.screen.frame().filter(row => row.includes("identical delayed card")).length, 2);
	assert.ok(m.row("answer 4s") < m.row("worked for 7s ˅"));
});

it("rebuilds only the selected branch with closed folds and lifted steering", () => {
	let fork = "";
	const m = mounted((s) => {
		s.turn(0, 0, 42);
		fork = s.manager.getLeafId()!;
		s.turn(1, 100_000, 7);
	});
	m.click(70, m.row("worked for 42s ›"));
	m.session.manager.branch(fork);
	m.session.add(user("branch owner", 200_000), 200_000);
	m.session.add(assistant([text("branch work")], "toolUse", 201_000), 201_000);
	m.session.add(user("branch steering", 202_000), 202_000);
	m.session.add(assistant([text("branch answer")], "stop", 203_000), 205_000);
	m.host.rebuildChatFromMessages();
	m.loaded.handlers.get("session_tree")!();
	assert.ok(m.row("worked for 42s ›") >= 0 && m.row("worked for 5s ›") >= 0);
	assert.ok(m.row("answer 1") < 0 && m.row("prompt 1") < 0 && m.row("branch work") < 0);
	assert.ok(m.row("branch owner") >= 0 && m.row("branch owner") < m.row("branch steering"));
	assert.ok(m.row("branch steering") < m.row("worked for 5s ›"));
	m.click(70, m.row("worked for 5s ›"));
	assert.ok(m.row("branch owner") < m.row("branch work") && m.row("branch work") < m.row("branch steering"));
});

it("updates a settled turn from the new session tail without rereading the branch", () => {
	const m = mounted((s) => s.turn(0, 0, 42));
	const manager = m.session.manager;
	const original = manager.getBranch;
	let reads = 0;
	manager.getBranch = function (...args) { reads++; return original.apply(this, args); };
	try {
		const add = (message: unknown, at: number) => {
			m.session.add(message, at);
			(m.host as unknown as { addMessageToChat(message: unknown): void }).addMessageToChat(message);
		};
		add(user("next prompt", 100_000), 100_000);
		add(assistant([text("next work")], "toolUse", 101), 101_000);
		add(assistant([text("next answer")], "stop", 102), 110_000);
		m.loaded.handlers.get("agent_settled")!();
		assert.ok(m.row("worked for 10s ›") >= 0 && m.row("next work") < 0);
		assert.equal(reads, 0);
	} finally { manager.getBranch = original; }
});

it("a click anywhere on the header row opens and closes that fold only", () => {
	const m = mounted((s) => { s.turn(0, 0, 42); s.turn(1, 100_000, 7); });
	const y = m.row("worked for 42s ›");
	assert.ok(y >= 0);
	m.click(70, y);
	assert.ok(m.row("worked for 42s ˅") >= 0 && m.row("update 0") > m.row("worked for 42s ˅"));
	assert.ok(m.row("worked for 7s ›") >= 0 && m.row("update 1") < 0);
	m.click(1, m.row("worked for 42s ˅"));
	assert.ok(m.row("worked for 42s ›") >= 0 && m.row("update 0") < 0);
});

it("a drag over the header copies its text and toggles nothing; Enter and Ctrl+O toggle nothing", () => {
	const m = mounted((s) => s.turn(0, 0, 42));
	const y = m.row("worked for 42s ›");
	m.press(1, y);
	m.screen.input(`\x1b[<32;${20};${y + 1}M`);
	m.release(19, y);
	assert.ok(m.screen.copied.some((text) => text.includes("worked for")));
	m.screen.input("\r");
	m.host.setToolsExpanded(true);
	assert.ok(m.row("worked for 42s ›") >= 0 && m.row("update 0") < 0);
});

it("the header stays clickable after scrolling and resizing, and open work keeps its own clicks", () => {
	const m = mounted((s) => { for (let n = 0; n < 6; n++) s.turn(n, n * 100_000, 42); }, 80, 20);
	const bottom = m.screen.frame().join("\n");
	for (let i = 0; i < 40; i++) m.screen.input("\x1b[<64;1;1M");
	assert.notEqual(m.screen.frame().join("\n"), bottom);
	let y = m.row("worked for 42s ›");
	assert.ok(y >= 0);
	m.screen.terminal.columns = 60;
	y = m.row("worked for 42s ›");
	m.click(55, y);
	assert.ok(m.row("worked for 42s ˅") >= 0);
	// A click on the open tool row reaches Pi's tool component (it expands that call), not the fold.
	const tool = m.row("Read 1 file");
	assert.ok(tool > m.row("worked for 42s ˅"));
	m.click(3, tool);
	assert.ok(m.row("worked for 42s ˅") >= 0);
	assert.ok(m.row("body 0") >= 0);
});


