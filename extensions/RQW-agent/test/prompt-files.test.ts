// F3: real Pi sessions with faux providers; no network, credentials or other extensions.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fauxToolCall, getSystemMessageText, type TranscriptContext } from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { appendUserMessages, loadPromptFile } from "../prompt-files.ts";
import { SUBAGENT_REMINDER } from "../prompt.ts";
import { answer, fixture, gate, texts, tick, until } from "./audit-fixture.ts";

const system = (context: TranscriptContext) => context.messages.filter(m => m.role === "system").map(getSystemMessageText).join("\n");
const hash = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");

test("system_file loads exact bytes relative to caller cwd, and push details identify that loaded version", async () => {
	const f = await fixture(), held = gate("FILE_DONE");
	const prompt = "\uFEFF  exact\r\nwhole prompt\n\n";
	const path = join(f.root, "system.txt");
	f.subReplies.push(held.reply);
	try {
		await writeFile(path, prompt);
		const { system: _inline, ...params } = f.params();
		await f.call({ ...params, system_file: "system.txt" });
		await until(held.entered, "file prompt request");
		assert.equal(system(f.requests.sub[0]), prompt);
		await writeFile(path, "CHANGED_AFTER_LOAD");
		held.release();
		await until(() => f.delivered().length === 1, "file result push");
		const message = f.session.messages.find(m => m.role === "custom" && m.customType === "agent")!;
		assert.deepEqual(message.details.prompt_file, { kind: "system", path, sha256: hash(prompt) });
		assert.equal(message.content, "[agent#1] FILE_DONE");
	} finally { held.release(); await f.cleanup(); }
});

test("inherited file is re-read on restart; invalid replacement does not interrupt or discard the old child", async () => {
	const f = await fixture(), held = gate("OLD_SURVIVES");
	const path = join(f.root, "prompt.txt");
	f.subReplies.push(held.reply);
	try {
		await writeFile(path, "FIRST");
		const { system: _inline, ...params } = f.params();
		await f.call({ ...params, system_file: "prompt.txt" });
		await until(held.entered, "old run");
		await rm(path);
		await assert.rejects(f.call({ action: "restart", id: "agent#1", task: "new" }), /ENOENT/);
		assert.equal(held.aborted(), false);
		await writeFile(path, Buffer.from([0xc3, 0x28]));
		await assert.rejects(f.call({ action: "restart", id: "agent#1", task: "new" }), /encoded data/);
		assert.equal(held.aborted(), false);
		await assert.rejects(f.call({ action: "restart", id: "agent#1", system_file: f.root }), /regular text file/);
		assert.equal(held.aborted(), false);
		held.release();
		await until(() => f.delivered().length === 1, "old child still delivers");
		await writeFile(path, "  SECOND\r\n");
		await f.call({ action: "restart", id: "agent#1", task: "again" });
		await until(() => f.delivered().length === 2, "fresh file delivery");
		assert.equal(system(f.requests.sub[1]), "  SECOND\r\n");
		assert.deepEqual(texts(f.requests.sub[1]), ["again"]);
		const messages = f.session.messages.filter(m => m.role === "custom" && m.customType === "agent");
		assert.deepEqual(messages[1].details.prompt_file, { kind: "system", path, sha256: hash("  SECOND\r\n") });
		await f.call({ action: "restart", id: "agent#1", role: "INLINE_ROLE", task: "inline" });
		await until(() => f.delivered().length === 3, "inline replacement");
		assert.ok(system(f.requests.sub[2]).endsWith("<role>\nINLINE_ROLE\n</role>"));
		const last = f.session.messages.findLast(m => m.role === "custom" && m.customType === "agent")!;
		assert.equal("prompt_file" in last.details, false);
	} finally { held.release(); await f.cleanup(); }
});

test("role_file preserves whitespace, restart keeps and re-reads it, system replaces the file choice", async () => {
	const f = await fixture(), path = join(f.root, "role.txt");
	try {
		const role = " \r\n  precise role  \n\n";
		await writeFile(path, role);
		const { system: _inline, ...params } = f.params();
		const expected = `${f.session.systemPrompt.trimEnd()}\n\n${SUBAGENT_REMINDER}\n\n<role>\n${role}\n</role>`;
		await f.call({ ...params, role_file: "role.txt" });
		await until(() => f.delivered().length === 1, "role delivery");
		assert.equal(system(f.requests.sub[0]), expected);
		await writeFile(path, " ROLE_TWO ");
		await f.call({ action: "restart", id: "agent#1" });
		await f.call({ action: "send", id: "agent#1", task: "fresh" });
		await until(() => f.delivered().length === 2, "inherited role delivery");
		assert.ok(system(f.requests.sub[1]).endsWith("<role>\n ROLE_TWO \n</role>"));
		await rm(path);
		await f.call({ action: "restart", id: "agent#1", system: "REPLACEMENT", task: "new" });
		await until(() => f.delivered().length === 3, "system replaces role file");
		assert.equal(system(f.requests.sub[2]), "REPLACEMENT");
	} finally { await f.cleanup(); }
});

test("prompt-file provenance appears under results[].display on explicit wait, without changing delivered text", async () => {
	const f = await fixture(), held = gate("WAIT_FILE_RESULT"), path = join(f.root, "role.txt");
	f.subReplies.push(held.reply);
	try {
		await writeFile(path, " role ");
		const { system: _inline, ...params } = f.params();
		f.mainReplies.push(
			answer([fauxToolCall("agent", { ...params, role_file: "role.txt" })], { stopReason: "toolUse" }),
			answer([fauxToolCall("agent", { action: "wait", ids: ["agent#1"], timeout_ms: 10000 })], { stopReason: "toolUse" }),
			answer("DONE"),
		);
		const run = f.session.prompt("GO");
		await until(() => held.entered() && f.requests.main.length === 2, "explicit wait registration");
		await tick();
		held.release(); await run;
		const result = f.session.messages.findLast(m => m.role === "toolResult" && m.toolName === "agent")!;
		assert.deepEqual(result.details.results[0].display.prompt_file, { kind: "role", path, sha256: hash(" role ") });
		assert.equal(result.details.results[0].text, "WAIT_FILE_RESULT");
		assert.deepEqual(f.delivered(), []);
	} finally { held.release(); await f.cleanup(); }
});

test("text/file and system/role conflicts fail before creation; explorers reject file overrides, workers expose no F3 params", async () => {
	const f = await fixture();
	try {
		const { system: _inline, ...params } = f.params();
		for (const overrides of [
			{ system: "S", system_file: "missing" }, { role: "R", role_file: "missing" },
			{ system: "S", role_file: "missing" }, { role: "R", system_file: "missing" },
			{ system_file: "missing", role_file: "missing" }, { system: "", system_file: "missing" },
		]) await assert.rejects(f.call({ ...params, ...overrides }), /not both/);
		for (const key of ["system_file", "role_file"]) {
			await assert.rejects(f.call({ action: "start", explore: "quick", task: "find", [key]: "missing" }), /explorer/);
			await assert.rejects(f.call({ action: "send", id: "agent#1", task: "x", [key]: "missing" }), /only supported on start\/restart/);
		}
		await assert.rejects(f.call({ ...params, system_file: "" }), /must name a text file/);
		await assert.rejects(f.call({ ...params, system_file: "missing" }), /ENOENT/);
		for (const worker of ["code_writer", "shell_runner"]) {
			const properties = f.session.getToolDefinition(worker)!.parameters.properties;
			for (const key of ["system_file", "role_file", "include"]) assert.equal(key in properties, false);
		}
		assert.equal(f.requests.sub.length, 0);
	} finally { await f.cleanup(); }
});

test("user_messages includes only raw user text on current branch, before compaction too, without trimming text parts", () => {
	const manager = SessionManager.inMemory("/tmp");
	const first = manager.appendMessage({ role: "user", content: " first\r\n ", timestamp: 0 });
	manager.appendMessage({ role: "user", content: "OTHER_BRANCH", timestamp: 1 });
	manager.branch(first);
	const kept = manager.appendMessage({ role: "user", content: [
		{ type: "text", text: "  part one\n" }, { type: "image", data: "AA==", mimeType: "image/png" },
		{ type: "text", text: "\r\npart two  " }, { type: "text", text: "" },
	], timestamp: 2 });
	manager.appendCustomMessageEntry("agent", "NOT_USER", true);
	manager.appendMessage(answer("NOT_USER_EITHER"));
	manager.appendCompaction("NOT_ORIGINAL_WORDING", kept, 100);
	assert.equal(appendUserMessages("TASK ", manager.getBranch()),
		"TASK \n\n<user_messages>\n first\r\n \n  part one\n\n\r\npart two  \n\n</user_messages>");
});

test("include appends caller text after task; nested include reads child's current session, not root; restart opt-in is not inherited", async () => {
	const f = await fixture();
	try {
		f.session.sessionManager.appendMessage({ role: "user", content: " ROOT_WORDS \n", timestamp: 0 });
		const nested = { ...f.params("NESTED_TASK "), include: ["user_messages"] };
		f.subReplies.push(
			answer([fauxToolCall("agent", nested)], { stopReason: "toolUse" }),
			answer("CHILD_WAITING"), answer("GRANDCHILD_DONE"),
		);
		const outer = "CHILD_TASK \n\n<user_messages>\n ROOT_WORDS \n\n</user_messages>";
		await f.call({ ...f.params("CHILD_TASK "), include: ["user_messages"] });
		await until(() => f.requests.sub.length >= 3, "nested child request");
		assert.deepEqual(texts(f.requests.sub[0]), [outer]);
		const grandchild = f.requests.sub.find(r => texts(r)[0]?.startsWith("NESTED_TASK "))!;
		assert.ok(grandchild);
		assert.deepEqual(texts(grandchild), [`NESTED_TASK \n\n<user_messages>\n${outer}\n</user_messages>`]);
		await until(() => f.delivered().length === 1, "outer result");
		await f.call({ action: "restart", id: "agent#1", task: "PLAIN_RESTART" });
		await until(() => f.delivered().length === 2, "restart result");
		assert.deepEqual(texts(f.requests.sub.at(-1)!), ["PLAIN_RESTART"]);
		await f.call({ action: "restart", id: "agent#1", task: "INCLUDED_RESTART", include: ["user_messages"] });
		await until(() => f.delivered().length === 3, "included restart result");
		assert.deepEqual(texts(f.requests.sub.at(-1)!), ["INCLUDED_RESTART\n\n<user_messages>\n ROOT_WORDS \n\n</user_messages>"]);
	} finally { await f.cleanup(); }
});

test("empty text files are exact prompts and invalid UTF-8 is rejected without replacement characters", async () => {
	const f = await fixture();
	try {
		await mkdir(join(f.root, "nested"));
		await writeFile(join(f.root, "nested", "empty"), "");
		const loaded = await loadPromptFile("system", "nested/empty", f.root);
		assert.equal(loaded.text, "");
		assert.equal(loaded.file.sha256, hash(""));
		await writeFile(join(f.root, "bad"), Buffer.from([0xff]));
		await assert.rejects(loadPromptFile("role", "bad", f.root), /encoded data/);
	} finally { await f.cleanup(); }
});
