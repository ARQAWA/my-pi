import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxToolCall, getCurrentTools } from "@earendil-works/pi-ai";
import { forkBranch } from "../../../extensions/RQW-agent/fork.ts";
import { retainedChildManager } from "../../../extensions/RQW-agent/persistence.ts";
import { countSyncSessionReads, runtime, world } from "./fixture.ts";

test("fork start copies the selected branch and its projection without unfinished tools or service state", async t => {
	const w = await world(t);
	const run = runtime(w.cwd, w.base, "low");
	const parent = run.parent;
	const root = parent.appendMessage({ role: "user", content: "old user", timestamp: 1 });
	parent.appendMessage({ role: "user", content: "abandoned branch", timestamp: 1 });
	parent.branch(root);
	const marker = parent.appendCustomEntry("rqw-agent-child", { id: 99 });
	const kept = parent.appendMessage({ role: "user", content: [{ type: "text", text: "kept" }, { type: "image", data: "aGVsbG8=", mimeType: "image/png" }], timestamp: 2 });
	parent.appendCompaction("summary of old user", marker, 100);
	const edited = parent.appendMessage({ role: "user", content: "before edit", timestamp: 3 });
	parent.appendContextEdit(edited, { content: "after edit" });
	parent.appendCustomMessageEntry("notice", "visible notice", true, { delivery: "private" });
	parent.appendMessage(fauxAssistantMessage([fauxToolCall("agent", {}, { id: "spawn" }), fauxToolCall("bash", {}, { id: "parallel" })], { stopReason: "toolUse" }));
	parent.appendMessage({ role: "toolResult", toolCallId: "parallel", toolName: "bash", content: [{ type: "text", text: "partial" }], isError: false, timestamp: 4 });
	await run.execute({ action: "start", fork_turns: "all", task: "fork task", tools: [] });
	await run.live.wait(new AbortController().signal);
	run.live.close();
	const fork = retainedChildManager(parent, "agent", 1)!;
	assert.ok(fork);
	assert.equal(dirname(fork.getSessionFile()!), join(`${parent.getSessionFile()}.children`, "agent-1"));
	assert.ok(existsSync(fork.getSessionFile()!));
	assert.equal(fork.getHeader()?.parentSession, parent.getSessionFile());
	assert.notEqual(fork.getSessionId(), parent.getSessionId());
	const branch = fork.getBranch();
	assert.ok(branch.some(entry => entry.id === kept));
	assert.ok(!JSON.stringify(branch).includes("abandoned branch"));
	assert.ok(branch.some(entry => entry.type === "compaction" && entry.firstKeptEntryId === kept));
	for (let i = 0; i < branch.length; i++) assert.equal(branch[i].parentId, branch[i - 1]?.id ?? null);
	assert.ok(branch.some(entry => entry.type === "context_edit" && entry.targetId === edited));
	assert.ok(!branch.some(entry => entry.type === "custom" && entry.customType === "rqw-agent-child"));
	const notice = branch.find(entry => entry.type === "custom_message" && entry.customType === "notice");
	assert.ok(notice && notice.type === "custom_message" && notice.details === undefined);
	assert.ok(!branch.some(entry => entry.type === "message" && entry.message.role === "toolResult"));
	const request = run.requests[0];
	const serialized = JSON.stringify(request.messages.filter((message: any) => message.role !== "system"));
	assert.match(serialized, /summary of old user/);
	assert.match(serialized, /after edit/);
	assert.match(serialized, /aGVsbG8=/);
	assert.doesNotMatch(serialized, /before edit|partial|parallel|spawn/);
	assert.equal(run.efforts[0], "low");
	assert.match(request.messages.find((message: any) => message.role === "system").content, /original prompt/);
});

test("fork rejects incompatible overrides before allocating a child", async t => {
	const w = await world(t);
	const run = runtime(w.cwd, w.base);
	try {
		for (const [key, value] of Object.entries({ model: "persist-test/other", thinking: "high", agent_type: "default", system: "x", system_file: "x", role: "x", role_file: "x", include: ["user_messages"] })) {
			await assert.rejects(async () => run.execute({ action: "start", fork_turns: "all", task: "x", [key]: value }), /fork_turns all cannot be combined/, key);
		}
		assert.equal(run.parent.getBranch().filter(entry => entry.type === "custom" && entry.customType === "agent").length, 0);
		await assert.rejects(async () => run.execute({ action: "restart", id: "agent#1", fork_turns: "all" }), /only supported on start/);
	} finally { run.live.close(); }
});

test("fork inherits the available base tools", async t => {
	const w = await world(t);
	const run = runtime(w.cwd, w.base, "low", [], ["bash"]);
	await run.execute({ action: "start", fork_turns: "all", task: "tools" });
	await run.live.wait(new AbortController().signal);
	run.live.close();
	const tools = getCurrentTools(run.requests[0].messages.filter((message: any) => message.role === "system"));
	assert.deepEqual(tools.map((tool: any) => tool.name).sort(), ["agent", "bash"]);
});

test("ordinary start still begins with a clean history", async t => {
	const w = await world(t);
	const run = runtime(w.cwd, w.base);
	run.parent.appendMessage({ role: "user", content: "parent history", timestamp: 1 });
	await run.execute({ action: "start", task: "ordinary", tools: [] });
	await run.live.wait(new AbortController().signal);
	run.live.close();
	const messages = JSON.stringify(run.requests[0].messages);
	assert.match(messages, /ordinary/);
	assert.doesNotMatch(messages, /parent history/);
});

test("fork start writes the branch without reading any session file back", async t => {
	const w = await world(t);
	const run = runtime(w.cwd, w.base);
	for (let i = 0; i < 40; i++) run.parent.appendMessage({ role: "user", content: `history ${i}`, timestamp: i });
	const reads = countSyncSessionReads(t);
	await run.execute({ action: "start", fork_turns: "all", task: "fork task", tools: [] });
	const synchronous = reads.count();
	reads.stop();
	await run.live.wait(new AbortController().signal);
	run.live.close();
	assert.equal(synchronous, 0);
	const fork = retainedChildManager(run.parent, "agent", 1)!;
	assert.ok(fork.getEntries().filter(entry => entry.type === "message").length >= 40);
	// The file holds one JSON line per entry, and Pi reads the same history from it.
	const file = fork.getSessionFile()!;
	const lines = (await readFile(file, "utf8")).split("\n").filter(Boolean);
	assert.equal(lines.length, fork.getEntries().length + 1);
	assert.deepEqual(SessionManager.open(file, dirname(file), w.cwd).getEntries(), fork.getEntries());
});

test("fork start does not walk the branch before it returns", async t => {
	const w = await world(t);
	const run = runtime(w.cwd, w.base);
	for (let i = 0; i < 40; i++) run.parent.appendMessage({ role: "user", content: `history ${i}`, timestamp: i });
	const getBranch = t.mock.method(run.parent, "getBranch");
	const started = run.execute({ action: "start", fork_turns: "all", task: "fork task", tools: [] });
	try {
		// The synchronous part of the call must not copy a long branch.
		assert.equal(getBranch.mock.callCount(), 0);
	} finally {
		await started;
		await run.live.wait(new AbortController().signal);
		run.live.close();
	}
	assert.ok(retainedChildManager(run.parent, "agent", 1)!.getEntries().filter(entry => entry.type === "message").length >= 40);
});

test("copying a long branch yields to the event loop between slices", async t => {
	const w = await world(t);
	const run = runtime(w.cwd, w.base);
	for (let i = 0; i < 200; i++) run.parent.appendMessage({ role: "user", content: `history ${i}`, timestamp: i });
	// Every clock read costs more than a slice, so each work item ends its slice.
	let now = 0;
	t.mock.method(performance, "now", () => (now += 5));
	let turns = 0;
	let copying = true;
	const spin = () => { if (!copying) return; turns++; setImmediate(spin); };
	setImmediate(spin);
	const seed = await forkBranch(run.parent, run.parent.getLeafEntry()).finally(() => { copying = false; });
	assert.equal(seed.length, 200);
	assert.ok(turns >= 200, `only ${turns} event loop turns`);
	for (let i = 0; i < seed.length; i++) assert.equal(seed[i].parentId, seed[i - 1]?.id ?? null);
});
