import assert from "node:assert/strict";
import { test } from "node:test";
import { fauxToolCall } from "@earendil-works/pi-ai";
import { answer, fixture, gate, tick, until } from "./audit-fixture.ts";

for (const mode of ["tui", "rpc"] as const) {
	test(`${mode}: default wait ends its call and wakes once through a notification`, async () => {
		const f = await fixture(mode), child = gate("ASYNC_RESULT");
		f.subReplies.push(child.reply);
		f.mainReplies.push(
			answer([fauxToolCall("agent", f.params())], { stopReason: "toolUse" }),
			answer([fauxToolCall("agent", { action: "wait", ids: ["agent#1"], timeout_ms: 60000 })], { stopReason: "toolUse" }),
			answer("NOTIFIED"),
		);
		try {
			await f.session.prompt("GO");
			const receipt = f.session.messages.findLast(m => m.role === "toolResult" && m.toolName === "agent");
			assert.ok(receipt && receipt.role === "toolResult");
			assert.equal((receipt.details as { reason: string }).reason, "waiting");
			assert.equal(f.requests.main.length, 2, "no request merely to wait");
			assert.equal(child.aborted(), false);
			child.release();
			await until(() => f.requests.main.length === 3, "notification wakes caller");
			await f.session.waitForIdle();
			const notifications = f.session.messages.filter(m => m.role === "custom" && m.customType === "child_wait");
			assert.equal(notifications.length, 1);
			assert.match(JSON.stringify(notifications[0]), /ASYNC_RESULT/);
			assert.deepEqual(f.delivered(), [], "no duplicate agent message");
		} finally { child.release(); await f.cleanup(); }
	});
}

for (const mode of ["print", "json", "tui"] as const) {
	test(`${mode}: ${mode === "tui" ? "nested codemode" : "external host"} wait keeps its held behavior`, async () => {
		const f = await fixture(mode), child = gate("HELD_RESULT");
		f.subReplies.push(child.reply);
		try {
			await f.start();
			await until(child.entered, "child entered");
			let returned = false;
			const call = f.session.getToolDefinition("agent")!.execute(
				mode === "tui" ? "codemode/agent-wait" : "host-wait",
				{ action: "wait", ids: ["agent#1"], timeout_ms: 60000 },
				undefined, undefined, f.session.extensionRunner.createContext(),
			).then(result => { returned = true; return result; });
			await tick();
			assert.equal(returned, false, "implicit held path remains");
			child.release();
			const result = await call;
			assert.equal((result.details as { reason: string }).reason, "result");
			assert.match(JSON.stringify(result.content), /HELD_RESULT/);
			assert.deepEqual(f.delivered(), []);
		} finally { child.release(); await f.cleanup(); }
	});
}
