import assert from "node:assert/strict";
import { it } from "node:test";
import { AgentSession } from "@earendil-works/pi-coding-agent";
import { harness } from "./extensions/RQW-send-now/harness.ts";
import { pairOfTabs } from "./extensions/RQW-tabs-link/harness.ts";

it("the editor promotes a queued follow-up and routes Enter while a chat wait is open", async t => {
	const { send } = await pairOfTabs(t);
	const ctx = send.ctx();
	const editor = harness(t, { manager: ctx.sessionManager });
	editor.session._emitQueueUpdate = function() {
		AgentSession.prototype["_emitQueueUpdate"].call(this);
	};
	ctx.isIdle = () => editor.session.isIdle;
	const unbridge = send.pi.events.on("rqw:waiting:v1", event => editor.events.emit("rqw:waiting:v1", event));
	t.after(unbridge);
	const tool = send.tools.find(item => item.name === "wait_answer")!;
	const run = () => tool.execute("wait", { chatId: "recv", afterEntryId: null } as never, undefined, undefined, ctx as never);
	const reason = async () => ((await run()).details as { reason: string }).reason;
	editor.followUp("queued follow-up");
	assert.equal(await reason(), "steered");
	assert.deepEqual(editor.session._followUpMessages, []);
	assert.deepEqual(editor.session._steeringMessages, ["queued follow-up"]);
	editor.session.clearQueue();

	const pending = run();
	await editor.flush();
	editor.state.editor = "new input";
	assert.deepEqual(editor.press("\r"), { consume: true });
	assert.deepEqual(editor.inputs, ["\r"]);
	await editor.steer("new input");
	assert.equal(((await pending).details as { reason: string }).reason, "steered");
	await editor.flush();
});
