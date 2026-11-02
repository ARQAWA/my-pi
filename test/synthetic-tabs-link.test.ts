import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, it } from "node:test";
import { call, reportTimings, text, world, worldPair } from "./synthetic/world.ts";

after(() => reportTimings(import.meta.filename));

it("delivers a follow-up between two open chats without a network socket", async (t) => {
	const originalFetch = globalThis.fetch;
	const originalNow = Date.now;
	const originalConnect = net.connect;
	const originalHome = process.env.HOME;
	const originalLocalAppData = process.env.LOCALAPPDATA;
	const [sender, receiver] = await worldPair(t);
	assert.equal(process.env.LOCALAPPDATA, sender.dirs.home);
	const chatId = receiver.session.sessionManager.getSessionId();
	receiver.model.script(text("received the message"));
	sender.model.script(
		call("tool_search", { query: "rqwchat" }, "search"),
		call("send_message_to_chat", { chatId, prompt: "please check this" }, "send"),
		text("sent"),
	);
	await sender.submit("send to the other chat");
	await receiver.until(() => receiver.screen().join("\n").includes("received the message"), "receiver answers");
	const result = sender.requests.flatMap((request: any) => request.context.messages)
		.findLast((message: any) => message.role === "toolResult" && message.toolCallId === "send");
	assert.match(JSON.stringify(result), /"status".*accepted/);
	assert.match(JSON.stringify(receiver.requests), /please check this/);
	assert.deepEqual(sender.networkAttempts, []);
	assert.deepEqual(sender.model.unscripted, []);
	assert.deepEqual(receiver.model.unscripted, []);
	await sender.dispose();
	receiver.model.script(text("still open"));
	await receiver.submit("are you there?");
	receiver.see("still open");
	await receiver.dispose();
	assert.equal(globalThis.fetch, originalFetch);
	assert.equal(Date.now, originalNow);
	assert.equal(net.connect, originalConnect);
	assert.equal(process.env.HOME, originalHome);
	assert.equal(process.env.LOCALAPPDATA, originalLocalAppData);
	assert.equal(existsSync(sender.dirs.base), false);
	assert.deepEqual(sender.patched(), []);
});

it("keeps the first chat working after closing its peer and restores the shared process", async (t) => {
	const originalFetch = globalThis.fetch;
	const originalNow = Date.now;
	const originalConnect = net.connect;
	const originalHome = process.env.HOME;
	const [first, second] = await worldPair(t);
	await second.dispose();
	first.model.script(text("first still works"));
	await first.submit("continue");
	first.see("first still works");
	assert.deepEqual(first.model.unscripted, []);
	await first.dispose();
	assert.equal(globalThis.fetch, originalFetch);
	assert.equal(Date.now, originalNow);
	assert.equal(net.connect, originalConnect);
	assert.equal(process.env.HOME, originalHome);
	assert.equal(existsSync(first.dirs.base), false);
	assert.deepEqual(first.patched(), []);
});

it("a closed chat returns an open hint instead of receiving a message", async (t) => {
	const local = mkdtempSync(join(tmpdir(), "rqw-tabs-local-"));
	const oldLocalAppData = process.env.LOCALAPPDATA;
	const createServer = net.createServer;
	const connect = net.connect;
	let servers = 0;
	let connections = 0;
	process.env.LOCALAPPDATA = local;
	net.createServer = (() => {
		servers++;
		return {
			once() { return this; },
			listen(_port: number, _host: string, ready: () => void) { queueMicrotask(ready); return this; },
			address() { return { port: 40000 }; },
			close() { return this; },
		};
	}) as typeof net.createServer;
	net.connect = (() => { connections++; throw new Error("unexpected network connection"); }) as typeof net.connect;
	syncBuiltinESMExports();
	let w: Awaited<ReturnType<typeof world>> | undefined;
	try {
		w = await world(t);
		writeFileSync(join(w.dirs.sessions, "closed-chat.jsonl"), `${JSON.stringify({ type: "session", id: "closed-chat" })}\n`);
		w.model.script(
			call("tool_search", { query: "rqwchat" }, "search"),
			call("send_message_to_chat", { chatId: "closed-chat", prompt: "hello" }, "send"),
			text("finished"),
		);
		await w.submit("send to the closed chat");
		const result = w.requests.flatMap((request) => request.context.messages)
			.findLast((message) => message.role === "toolResult" && message.toolCallId === "send") as any;
		assert.ok(result?.isError);
		const answer = result.content.map((part: { text?: string }) => part.text ?? "").join("\n");
		assert.match(answer, /"error"\s*:\s*"closed"/);
		assert.match(answer, /"openHint"/);
		assert.match(answer, /\/resume/);
		assert.match(answer, /pi --session closed-chat/);
		assert.equal(servers, 1);
		assert.equal(connections, 0);
		assert.deepEqual(w.networkAttempts, []);
		assert.deepEqual(w.model.unscripted, []);
	} finally {
		try {
			await w?.dispose();
		} finally {
			net.createServer = createServer;
			net.connect = connect;
			syncBuiltinESMExports();
			if (oldLocalAppData === undefined) delete process.env.LOCALAPPDATA;
			else process.env.LOCALAPPDATA = oldLocalAppData;
			rmSync(local, { recursive: true, force: true });
		}
	}
});
