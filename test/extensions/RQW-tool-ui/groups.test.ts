// T07: the group model from the session branch and the streaming state of public events.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildContextEntries, type SessionEntry } from "@earendil-works/pi-coding-agent";
import { classifyChange } from "../../../extensions/RQW-tool-ui/changes.ts";
import { classify } from "../../../extensions/RQW-tool-ui/classify.ts";
import { buildGroups, type LiveExecution, type LiveState, type Member } from "../../../extensions/RQW-tool-ui/groups.ts";
import { countSummary } from "../../../extensions/RQW-tool-ui/summary.ts";
import { deepFreeze } from "./harness.ts";

let clock = 0;
const entries = (...messages: unknown[]): SessionEntry[] =>
	messages.map((m, i) => (record(m).type ? m : { type: "message", id: `e${i}`, parentId: i ? `e${i - 1}` : null, timestamp: "t", message: m }) as SessionEntry);
const record = (v: unknown) => v as Record<string, unknown>;
const user = (text: string) => ({ role: "user", content: [{ type: "text", text }], timestamp: ++clock });
const thinking = (t = "hmm") => ({ type: "thinking", thinking: t });
const text = (t: string) => ({ type: "text", text: t });
const call = (id: string, name = "read", args: object = { path: `${id}.ts` }) => ({ type: "toolCall", id, name, arguments: args });
const assistant = (...content: unknown[]) => ({ role: "assistant", content, stopReason: "toolUse", timestamp: ++clock });
const result = (id: string, name = "read", extra: object = {}) =>
	({ role: "toolResult", toolCallId: id, toolName: name, content: [{ type: "text", text: `out ${id}` }], isError: false, timestamp: ++clock, durationMs: 5, ...extra });

/** Leader, active and current of each call, compactly. */
function shape(map: ReturnType<typeof buildGroups>) {
	return Object.fromEntries([...map].map(([id, g]) => [id, `${g.groupId}${g.isLeader ? " leader" : ""}${g.active ? " active" : ""} cur=${g.currentCallId} [${g.members.map((m) => m.id).join(",")}]`]));
}

/** The summary counts of members, classified the way the wiring will (classify.ts, changes.ts). */
const counts = (members: Member[]) => countSummary(members.map((m) => {
	const ctx = { toolCallId: m.id, isPartial: m.isPartial, isError: m.isError === true };
	return m.toolName === "edit" || m.toolName === "write" ? classifyChange(m.toolName, m.args, m.result, ctx, "linux") : classify(m.toolName, m.args, m.result, ctx, "linux");
}));

describe("groups", () => {
	it("groups-one-step-batch", () => {
		const step = [user("go"), assistant(thinking(), call("a"), call("b"), call("c")), result("a"), result("b"), result("c")];
		assert.deepEqual(shape(buildGroups(entries(...step))), {
			a: "a active cur=c [a,b,c]", b: "a active cur=c [a,b,c]", c: "a leader active cur=c [a,b,c]",
		});
		const g = buildGroups(entries(...step)).get("c")!;
		assert.deepEqual(g.members[0], { id: "a", toolName: "read", args: { path: "a.ts" }, result: { content: [{ type: "text", text: "out a" }] }, isError: false, isPartial: false, durationMs: 5 });
		assert.equal(g.group.leaderId, "c");
		assert.deepEqual(g.group.callIds, ["a", "b", "c"]);
	});

	it("groups-many-steps-with-thinking", () => {
		const log = entries(user("go"),
			assistant(thinking(), call("a")), result("a"),
			assistant(thinking(), text(""), call("b"), call("c")), result("b"), result("c"),
			assistant(thinking(), text("  \n"), call("d")), result("d"),
			assistant(thinking("long thought")));
		const map = buildGroups(log);
		assert.deepEqual(new Set([...map.values()].map((g) => g.groupId)), new Set(["a"]), "thinking and empty text do not break");
		assert.equal(map.get("d")!.isLeader, true);
		assert.deepEqual(map.get("a")!.members.map((m) => m.id), ["a", "b", "c", "d"]);
		assert.equal(map.get("a")!.active, true);
	});

	it("groups-text-breaks", () => {
		const log = entries(user("go"),
			assistant(text("First I look."), call("a"), call("b")), result("a"), result("b"),
			assistant(text("Now the tests."), call("c")), result("c"),
			assistant(call("d"), text("Done with d.")), result("d"),
			user("more"), assistant(call("e")), result("e"));
		assert.deepEqual(shape(buildGroups(log)), {
			a: "a cur=b [a,b]", b: "a leader cur=b [a,b]",
			c: "c cur=d [c,d]", d: "c leader cur=d [c,d]",
			e: "e leader active cur=e [e]",
		});
	});

	it("groups-answer-folds-live", () => {
		const log = entries(user("go"), assistant(thinking(), call("a")), result("a"));
		// The next step streams: thinking only keeps the group active, the first answer text folds it at once.
		const streaming = (...content: unknown[]): LiveState => ({ messages: [{ role: "assistant", content, timestamp: 999 }] });
		assert.equal(buildGroups(log, streaming(thinking("so"))).get("a")!.active, true);
		assert.equal(buildGroups(log, streaming(thinking("so"), text(""))).get("a")!.active, true);
		assert.equal(buildGroups(log, streaming(thinking("so"), text("T"))).get("a")!.active, false);
		// A call whose arguments still stream leads and is current, before its execution starts.
		const next = buildGroups(log, { ...streaming(call("b", "bash", { command: "np" })), streaming: true, executions: [{ toolCallId: "a", toolName: "read", ended: true }] });
		assert.equal(next.get("b")!.isLeader, true);
		assert.equal(next.get("b")!.currentCallId, "b");
		assert.equal(next.get("b")!.members.at(-1)!.isPartial, true);
	});

	it("groups-custom-and-compaction-break", () => {
		const custom = (display: boolean) => ({ type: "custom_message", id: `c${++clock}`, parentId: null, timestamp: "t", customType: "agent", content: "[agent#1] done", display });
		const compaction = { type: "compaction", id: "k", parentId: null, timestamp: "t", summary: "s", firstKeptEntryId: "x", tokensBefore: 1 };
		const branch = { type: "branch_summary", id: "bs", parentId: null, timestamp: "t", fromId: "x", summary: "s" };
		const other = [{ type: "label", id: "l", parentId: null, timestamp: "t", targetId: "x", label: "l" }, { type: "model_change", id: "m", parentId: null, timestamp: "t", provider: "p", modelId: "m" }];
		const log = entries(user("go"),
			assistant(call("a")), result("a"), custom(false), ...other, assistant(call("b")), result("b"),
			custom(true), assistant(call("c")), result("c"),
			compaction, assistant(call("d")), result("d"),
			branch, assistant(call("e")), result("e"),
			{ role: "bashExecution", command: "ls", output: "", exitCode: 0, cancelled: false, truncated: false, timestamp: ++clock },
			assistant(call("f")), result("f"));
		const groups = [...buildGroups(log).values()].map((g) => g.groupId);
		assert.deepEqual([...new Set(groups)], ["a", "c", "d", "e", "f"], "hidden custom messages and other entries do not break");
		// A displayed custom message arriving through the stream breaks too.
		const live = buildGroups(entries(user("go"), assistant(call("a")), result("a")), { messages: [{ role: "custom", customType: "review", content: "[review#1] CLEAN", display: true, timestamp: 1 }] });
		assert.equal(live.get("a")!.active, false);
	});

	it("groups-compaction-context-entries", () => {
		// The entries Pi draws after a compaction: the compaction first, then kept entries from firstKeptEntryId, then
		// the entries after it. Summarized calls are not drawn and not counted; the break sits where Pi draws it.
		const log = entries(user("go"), assistant(call("old1")), result("old1"), assistant(call("old2")), result("old2"),
			assistant(call("kept")), result("kept"));
		const compaction = { type: "compaction", id: "k", parentId: log.at(-1)!.id, timestamp: "t", summary: "s", firstKeptEntryId: log[5].id, tokensBefore: 1 };
		const after = [assistant(call("new")), result("new")].map((m, i) => ({ type: "message", id: `n${i}`, parentId: i ? "n0" : "k", timestamp: "t", message: m }));
		const drawn = buildContextEntries([...log, compaction, ...after] as SessionEntry[]);
		assert.deepEqual(drawn.map((e) => e.id), ["k", "e5", "e6", "n0", "n1"]);
		assert.deepEqual(shape(buildGroups(drawn)), { kept: "kept active cur=new [kept,new]", new: "kept leader active cur=new [kept,new]" });
		// The whole path, by contrast, would count the summarized calls and break after the kept call.
		assert.ok(buildGroups([...log, compaction, ...after] as SessionEntry[]).has("old1"));
	});

	it("groups-codemode-nested", () => {
		const saved = entries(user("go"), assistant(call("p", "codemode", { code: "..." })),
			result("p", "codemode", { nestedCalls: { complete: true, calls: [
				{ id: "p/1", name: "read", arguments: { path: "x.ts" }, status: "ok", durationMs: 2 },
				{ id: "p/2", name: "codemode", arguments: { code: "" }, status: "ok" },
				{ id: "p/2/1", name: "grep", arguments: { pattern: "y" }, status: "error" },
			] } }),
			assistant(call("q", "codemode", { code: "noop" })), result("q", "codemode"));
		const map = buildGroups(saved);
		// Nested calls count instead of their parent; a parent without nested information counts itself.
		assert.deepEqual(map.get("q")!.members.map((m) => [m.id, m.toolName, m.parentId ?? "-", m.isError]),
			[["p/1", "read", "p", false], ["p/2/1", "grep", "p", true], ["q", "codemode", "-", false]]);
		assert.equal(map.get("q")!.currentCallId, "q");
		// A record still `unfinished` on the parent's final result has stopped: not running, not failed.
		// A record still `unfinished` on the parent's final result stopped with it: not running, not succeeded, not failed.
		const stopped = buildGroups(entries(user("go"), assistant(call("p", "codemode")), result("p", "codemode", { nestedCalls: { complete: false, calls: [
			{ id: "p/1", name: "bash", arguments: { command: "sleep 9" }, status: "unfinished" },
			{ id: "p/2", name: "write", arguments: { path: "w.ts", content: "1\n2\n" }, status: "unfinished" }] } }))).get("p")!;
		assert.deepEqual(stopped.members, [
			{ id: "p/1", toolName: "bash", args: { command: "sleep 9" }, parentId: "p", unconfirmed: true, isPartial: false },
			{ id: "p/2", toolName: "write", args: { path: "w.ts", content: "1\n2\n" }, parentId: "p", unconfirmed: true, isPartial: false },
		]);
		assert.deepEqual(counts(stopped.members), { edited: 1, read: 0, searched: 0, ran: 1, waited: 0, used: 0, added: undefined, removed: undefined, failed: 0 },
			"an unconfirmed write gets no +N and no failure");
		// While p runs: the live block follows the most recently started call, nested ones included.
		const running = entries(user("go"), assistant(call("p", "codemode", { code: "..." })));
		const x = (toolCallId: string, extra: Partial<LiveExecution> = {}): LiveExecution => ({ toolCallId, toolName: "read", args: { path: `${toolCallId}.ts` }, ...extra });
		const at = (executions: LiveExecution[]) => buildGroups(running, { executions }).get("p")!;
		assert.equal(at([x("p", { toolName: "codemode" })]).currentCallId, "p");
		assert.deepEqual(at([x("p", { toolName: "codemode" })]).members.map((m) => m.id), ["p"]);
		const later = at([x("p", { toolName: "codemode" }), x("p/1", { parentToolCallId: "p", ended: true, result: { content: [{ type: "text", text: "ok" }] }, durationMs: 3 }),
			x("p/2", { parentToolCallId: "p", toolName: "codemode" }), x("p/2/1", { parentToolCallId: "p/2", toolName: "bash", partialResult: { content: [{ type: "text", text: "half" }] } })]);
		assert.equal(later.currentCallId, "p/2/1");
		assert.deepEqual(later.members, [
			{ id: "p/1", toolName: "read", args: { path: "p/1.ts" }, parentId: "p", result: { content: [] }, isError: false, isPartial: false, durationMs: 3 },
			{ id: "p/2/1", toolName: "bash", args: { path: "p/2/1.ts" }, parentId: "p", result: { content: [{ type: "text", text: "half" }] }, isPartial: true },
		]);
	});

	it("groups-nested-saved-equals-streamed", () => {
		// Pi persists only a bounded record of nested calls and no results, so once the parent has its final result the
		// record is the only source: the stream (events still held) and a reload give the same members and counts.
		const head = entries(user("go"), assistant(call("p", "codemode", { code: "x" })));
		const big = "z".repeat(9000);
		const executions: LiveExecution[] = [
			{ toolCallId: "p", toolName: "codemode", args: { code: "x" } },
			{ toolCallId: "p/1", toolName: "edit", args: { path: "a.ts" }, parentToolCallId: "p", ended: true, result: { content: [{ type: "text", text: "Successfully replaced" }], details: { diff: "-1 a\n+1 b\n+2 c" } }, durationMs: 4 },
			{ toolCallId: "p/2", toolName: "bash", args: { command: "false" }, parentToolCallId: "p", ended: true, isError: true, result: { content: [{ type: "text", text: "exit 1" }], details: { exitCode: 1 } }, durationMs: 2 },
			{ toolCallId: "p/3", toolName: "write", args: { path: "b.ts", content: "1\n2\n" }, parentToolCallId: "p", ended: true, result: { content: [] }, durationMs: 1 },
			{ toolCallId: "p/4", toolName: "write", args: { path: "big.ts", content: big }, parentToolCallId: "p", ended: true, result: { content: [] }, durationMs: 1 },
		];
		// While p runs, events are the source: arguments as sent, but no result details of nested calls.
		const running = buildGroups(head, { executions }).get("p")!;
		assert.deepEqual(counts(running.members), { edited: 3, read: 0, searched: 0, ran: 1, waited: 0, used: 0, added: 3, removed: undefined, failed: 1 });
		// The final result carries Pi's record: p/4's arguments were over 8 KiB, so Pi kept only their size.
		const final = result("p", "codemode", { durationMs: 9, nestedCalls: { complete: false, calls: [
			{ id: "p/1", name: "edit", arguments: { path: "a.ts" }, status: "ok", durationMs: 4 },
			{ id: "p/2", name: "bash", arguments: { command: "false" }, status: "error", durationMs: 2, error: "exit 1" },
			{ id: "p/3", name: "write", arguments: { path: "b.ts", content: "1\n2\n" }, status: "ok", durationMs: 1 },
			{ id: "p/4", name: "write", argumentsBytes: 9030, status: "ok", durationMs: 1 },
		] } });
		const streamed = buildGroups(head, { messages: [final], executions: executions.map((x) => ({ ...x, ended: true })) }).get("p")!;
		const saved = buildGroups(entries(user("go"), assistant(call("p", "codemode", { code: "x" })), final)).get("p")!;
		assert.deepEqual(streamed.members, saved.members);
		assert.deepEqual(saved.members.at(-1), { id: "p/4", toolName: "write", args: {}, parentId: "p", result: { content: [] }, isError: false, isPartial: false, durationMs: 1 },
			"omitted arguments stay omitted: no target, no lines");
		assert.deepEqual(counts(streamed.members), counts(saved.members));
		assert.deepEqual(counts(saved.members), { edited: 2, read: 0, searched: 0, ran: 1, waited: 0, used: 0, added: 2, removed: undefined, failed: 1 },
			"the write's lines come from saved arguments; the nested edit has no confirmed +A -R in either path");
	});

	it("groups-nested-compact-live-saved-parity", () => {
		const head = entries(user("go"), assistant(call("p", "codemode", { code: "x" })));
		const files = [{ path: "actual.ts", ok: true, added: 3, removed: 2 }, { path: "noop.ts", ok: true, added: 0, removed: 0 },
			{ path: "bad.ts", ok: false, added: 99, removed: 99 }, { path: "maybe.ts", ok: false, outcome: "possibly_changed" }];
		const edit = { version: 1, tool: "edit", files };
		const bash = { version: 1, tool: "bash", exitCode: 7 };
		const executions: LiveExecution[] = [{ toolCallId: "p", toolName: "codemode" },
			{ toolCallId: "p/1", toolName: "edit", parentToolCallId: "p", ended: true, isError: true,
				result: { content: [text("private diff")], details: { rqwToolsNestedCall: edit, diff: "+1 secret" } } },
			{ toolCallId: "p/2", toolName: "bash", args: { command: "false" }, parentToolCallId: "p", ended: true,
				result: { content: [text("private output")], details: { rqwToolsNestedCall: bash }, structuredContent: { exit_code: 0 } } }];
		const live = buildGroups(head, { executions }).get("p")!;
		const final = result("p", "codemode", { nestedCalls: { calls: [
			{ id: "p/1", name: "edit", status: "error", argumentsBytes: 9000 },
			{ id: "p/2", name: "bash", status: "ok", arguments: { command: "false" } }] },
			details: { rqwToolsNested: { version: 1, calls: [{ id: "p/1", ...edit }, { id: "p/2", ...bash }, { id: "p/extra", ...edit }] } } });
		const saved = buildGroups([...head, ...entries(final)]).get("p")!;
		assert.deepEqual(saved.members, live.members);
		assert.deepEqual(saved.members[0].args, {}, "metadata never restores lost args");
		const classified = classifyChange("edit", {}, saved.members[0].result, { isError: true }, "linux");
		assert.deepEqual(classified.files, [
			{ path: "actual.ts", countKey: "actual.ts", status: "done", added: 3, removed: 2 },
			{ path: "noop.ts", countKey: "noop.ts", status: "done", added: 0, removed: 0 },
			{ path: "bad.ts", countKey: "bad.ts", status: "error" }, { path: "maybe.ts", countKey: "maybe.ts", status: "possibly_changed" }]);
		assert.deepEqual(saved.members[1].result, { content: [], structuredContent: { exit_code: 7 } });
		assert.deepEqual(counts(saved.members), { edited: 4, read: 0, searched: 0, ran: 1, waited: 0, used: 0, added: 3, removed: 2, failed: 2 });
		assert.deepEqual(counts(live.members), counts(saved.members));
		assert.ok(!JSON.stringify(saved.members).includes("private"));
		const stale: LiveExecution[] = executions.map((x) => ({ ...x, result: { content: [], details: { rqwToolsNestedCall: { version: 1, tool: "bash", exitCode: 0 } } } }));
		stale.push({ toolCallId: "p/extra", toolName: "edit", parentToolCallId: "p", ended: true, result: { content: [], details: { rqwToolsNestedCall: edit } } });
		assert.deepEqual(buildGroups([...head, ...entries(final)], { executions: stale }).get("p")!.members, saved.members, "saved metadata wins stale and extra live calls");
		assert.deepEqual(saved.members.map((m) => m.id), ["p/1", "p/2"], "metadata cannot add calls absent from Pi's record");
		const withoutCalls = result("p", "codemode", { details: record(final).details });
		assert.deepEqual(buildGroups([...head, ...entries(withoutCalls)]).get("p")!.members.map((m) => m.id), ["p"]);
	});

	it("groups-background-handoff-keeps-completed-counts-and-leaves-pending-unknown", () => {
		const head = entries(user("go"), assistant(call("p", "codemode")));
		const first = { id: "p/1", version: 1, tool: "edit", files: [{ path: "first.ts", ok: true, added: 2, removed: 1 }] };
		const handoff = result("p", "codemode", { nestedCalls: { complete: false, calls: [
			{ id: "p/1", name: "edit", arguments: { path: "first.ts" }, status: "ok" },
			{ id: "p/2", name: "bash", arguments: { command: "pending" }, status: "unfinished" },
		] }, details: { rqwToolsNested: { version: 1, calls: [first] } } });
		const saved = [...head, ...entries(handoff)];
		const members = buildGroups(saved).get("p")!.members;
		assert.deepEqual(members.map((m) => m.id), ["p/1", "p/2"]);
		assert.deepEqual(members[1], { id: "p/2", toolName: "bash", args: { command: "pending" }, parentId: "p", unconfirmed: true, isPartial: false });
		assert.deepEqual(counts(members), { edited: 1, read: 0, searched: 0, ran: 1, waited: 0, used: 0, added: 2, removed: 1, failed: 0 });
		const late: LiveExecution = { toolCallId: "p/2", toolName: "bash", parentToolCallId: "p", ended: true,
			result: { content: [], details: { rqwToolsNestedCall: { version: 1, tool: "bash", exitCode: 3 } } } };
		assert.deepEqual(buildGroups(saved, { executions: [late] }).get("p")!.members, members, "late completion must not confirm the saved unfinished call");
	});

	it("groups-nested-markers-validate-and-fall-back", () => {
		const head = entries(user("go"), assistant(call("p", "codemode")));
		const edit = { version: 1, tool: "edit", files: [{ path: "actual.ts", ok: true, added: 2, removed: 1 }] };
		for (const [toolName, marker] of [
			["edit", { ...edit, version: 2 }], ["edit", { ...edit, tool: "write" }],
			["edit", { ...edit, files: [{ path: "x", ok: true, added: -1 }] }],
			["edit", { ...edit, files: [{ path: "x", ok: "true", added: 1 }] }],
			["edit", { ...edit, files: [{ path: "x", ok: true, removed: 0.5 }] }],
			["bash", { version: 1, tool: "bash", exitCode: "7" }], ["bash", { version: 1, tool: "bash", exitCode: Infinity }],
			["bash", undefined], ["edit", undefined],
		] as const) {
			const extra = { details: { rqwToolsNestedCall: marker, files: edit.files, diff: "+1 secret", exitCode: 9 }, structuredContent: { exit_code: 9 } };
			const run: LiveExecution = { toolCallId: "p/1", toolName, parentToolCallId: "p", ended: true, result: { content: [text("secret")], ...extra } };
			const live = buildGroups(head, { executions: [run] }).get("p")!.members[0];
			assert.deepEqual(live.result, { content: [] }, `${toolName}: ${JSON.stringify(marker)}`);
			const final = result("p", "codemode", { nestedCalls: { calls: [{ id: "p/1", name: toolName, status: "ok" }] },
				details: { rqwToolsNested: { version: 1, calls: [{ ...marker, id: "p/1" }] } } });
			assert.deepEqual(buildGroups([...head, ...entries(final)]).get("p")!.members[0], live);
		}
		for (const metadata of [
			{ version: 2, calls: [{ ...edit, id: "p/1" }] },
			{ version: 1, calls: [{ ...edit, id: "p/10" }] },
			{ version: 1, calls: [{ ...edit, id: "p/1/1" }] },
		]) {
			const final = result("p", "codemode", { nestedCalls: { calls: [{ id: "p/1", name: "edit", status: "ok" }] }, details: { rqwToolsNested: metadata } });
			assert.deepEqual(buildGroups([...head, ...entries(final)]).get("p")!.members[0].result, { content: [] }, "version and exact ID must match");
		}
		const unfinished = result("p", "codemode", { nestedCalls: { calls: [{ id: "p/1", name: "edit", status: "unfinished" }] },
			details: { rqwToolsNested: { version: 1, calls: [{ ...edit, id: "p/1" }] } } });
		const member = buildGroups([...head, ...entries(unfinished)]).get("p")!.members[0];
		assert.deepEqual(member, { id: "p/1", toolName: "edit", args: {}, parentId: "p", unconfirmed: true, isPartial: false });
		assert.equal(counts([member]).added, undefined);
	});

	it("groups-current-after-parent-completes", () => {
		// Pi kept p/1 and p/2 in its record; p/3 ran beyond what Pi persists. While p runs, p/3 is current; once p has
		// its saved result the record alone decides, with the events still held and after a reload alike.
		const head = entries(user("go"), assistant(call("p", "codemode", { code: "x" })));
		const executions: LiveExecution[] = [{ toolCallId: "p", toolName: "codemode" },
			...["p/1", "p/2", "p/3"].map((id) => ({ toolCallId: id, toolName: "read", args: { path: `${id}.ts` }, parentToolCallId: "p", ended: true }))];
		assert.equal(buildGroups(head, { executions }).get("p")!.currentCallId, "p/3");
		const final = result("p", "codemode", { nestedCalls: { complete: false, calls: [
			{ id: "p/1", name: "read", arguments: { path: "p/1.ts" }, status: "ok" }, { id: "p/2", name: "read", arguments: { path: "p/2.ts" }, status: "ok" }] } });
		const held = buildGroups(head, { messages: [final], executions: executions.map((x) => ({ ...x, ended: true })) }).get("p")!;
		const reloaded = buildGroups(entries(user("go"), assistant(call("p", "codemode", { code: "x" })), final)).get("p")!;
		assert.equal(held.currentCallId, "p/2");
		assert.equal(reloaded.currentCallId, "p/2");
		assert.deepEqual(shape(buildGroups(head, { messages: [final], executions })), shape(buildGroups(entries(user("go"), assistant(call("p", "codemode", { code: "x" })), final))));
		// A later call of the same group that still runs is current, the completed p's events aside.
		const next = buildGroups(entries(user("go"), assistant(call("p", "codemode", { code: "x" })), final, assistant(call("q"))),
			{ executions: [...executions, { toolCallId: "q", toolName: "read" }] }).get("q")!;
		assert.equal(next.currentCallId, "q");
		// An un-awaited nested call of the completed p whose end never arrives does not count as running: the queued q
		// of the same step runs next.
		const batch = entries(user("go"), assistant(call("p", "codemode", { code: "x" }), call("q")), final);
		const dangling = executions.map((x) => (x.toolCallId === "p/3" ? { ...x, ended: false } : { ...x, ended: true }));
		assert.equal(buildGroups(batch, { executions: dangling }).get("q")!.currentCallId, "q");
	});

	it("groups-batch-current-call", () => {
		// One step emits a, b and c together; the live block follows the call that actually executes.
		const head = entries(user("go"), assistant(call("a"), call("b"), call("c")));
		const cur = (live: LiveState) => buildGroups(head, live).get("c")!.currentCallId;
		const x = (id: string, ended = false): LiveExecution => ({ toolCallId: id, toolName: "read", ...(ended ? { ended: true } : {}) });
		assert.equal(cur({ executions: [] }), "a", "before any start, the first waiting call runs next");
		// Sequential: a runs while b and c wait, then b.
		assert.equal(cur({ executions: [x("a")] }), "a");
		assert.equal(cur({ executions: [x("a", true)] }), "b", "between a's end and b's start, b is next");
		assert.equal(cur({ executions: [x("a", true), x("b")] }), "b");
		assert.equal(cur({ messages: [result("a")], executions: [x("a", true), x("b", true), x("c")] }), "c");
		// Parallel: all three start in order; the latest start leads the live block.
		assert.equal(cur({ executions: [x("a"), x("b"), x("c")] }), "c");
		// A complete call still streaming in the current message is new and current until its execution starts.
		const streaming: LiveState = { messages: [assistant(call("d"))], streaming: true, executions: [x("a", true), x("b", true), x("c", true)] };
		const withD = entries(user("go"), assistant(call("a"), call("b"), call("c")), result("a"), result("b"), result("c"));
		assert.equal(buildGroups(withD, streaming).get("d")!.currentCallId, "d");
		assert.equal(buildGroups(withD, { ...streaming, streaming: false }).get("d")!.currentCallId, "d", "after message_end, d waits first");
		assert.equal(buildGroups(withD, { ...streaming, streaming: false, executions: [...streaming.executions!, x("d")] }).get("d")!.currentCallId, "d");
	});

	it("groups-leader-moves", () => {
		const steps = [user("go"), assistant(call("a")), result("a"), assistant(call("b")), result("b"), assistant(call("c"))];
		const leaders = [2, 4, 6].map((n) => {
			const map = buildGroups(entries(...steps.slice(0, n)));
			return [...map].filter(([, g]) => g.isLeader).map(([id, g]) => `${id}:${g.groupId}`);
		});
		assert.deepEqual(leaders, [["a:a"], ["b:a"], ["c:a"]], "the newest call leads, the group ID stays");
	});

	it("groups-idempotent", () => {
		const all = [user("go"), assistant(thinking(), call("a"), call("b", "bash", { command: "npm test" })), result("a"), result("b", "bash", { details: { exitCode: 1 } }),
			assistant(call("p", "codemode", { code: "x" })), result("p", "codemode", { nestedCalls: { complete: true, calls: [{ id: "p/1", name: "read", arguments: { path: "n.ts" }, status: "ok" }] } }),
			assistant(text("Answer.")), user("again"), assistant(call("z"))];
		const saved = deepFreeze(entries(...all));
		const once = buildGroups(saved);
		assert.deepEqual(buildGroups(saved), once, "same input, same groups");
		// The same run as streaming state on top of the first user message, then with partly saved history.
		for (const split of [1, 3, 6, all.length]) {
			const head = entries(...all.slice(0, split));
			const live: LiveState = { messages: all.slice(split) };
			assert.deepEqual(shape(buildGroups(head, live)), shape(once), `split ${split}`);
			assert.deepEqual([...buildGroups(head, live)].map(([id, g]) => [id, g.members]), [...once].map(([id, g]) => [id, g.members]), `members, split ${split}`);
		}
		// A displayed custom message saved as a `custom_message` entry (new timestamp) and still held as streaming state
		// counts once, at its saved place: it does not fold the group that started after it.
		const msg = { role: "custom", customType: "agent", content: "[agent#1] done", display: true, details: { x: 1 }, timestamp: 5 };
		const entry = { type: "custom_message", id: "cm", parentId: null, timestamp: "2026-01-01T00:00:00.000Z", customType: "agent", content: "[agent#1] done", display: true, details: { x: 1 } };
		const withCustom = entries(user("go"), assistant(call("a")), result("a"), entry, assistant(call("b")), result("b"));
		const expected = { a: "a leader cur=a [a]", b: "b leader active cur=b [b]" };
		assert.deepEqual(shape(buildGroups(withCustom)), expected);
		assert.deepEqual(shape(buildGroups(withCustom, { messages: [msg] })), expected);
		// Each saved copy matches one streamed copy: a second identical message is new and breaks.
		assert.deepEqual(shape(buildGroups(withCustom, { messages: [msg, { ...msg, timestamp: 9 }] })), { a: "a leader cur=a [a]", b: "b leader cur=b [b]" });
		// A message both saved and still held as streaming state counts once.
		assert.deepEqual(shape(buildGroups(saved, { messages: all.slice(-3) })), shape(once));
		assert.deepEqual(shape(once), {
			a: "a cur=p/1 [a,b,p/1]", b: "a cur=p/1 [a,b,p/1]", p: "a leader cur=p/1 [a,b,p/1]", z: "z leader active cur=z [z]",
		});
	});
});
