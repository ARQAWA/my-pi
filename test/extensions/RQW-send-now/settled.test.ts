import assert from "node:assert/strict";
import { it } from "node:test";
import { harness } from "./harness.ts";

const steer = (prompt: string) => ({ prompt, images: [] });

/** A force-send whose abort leaves Pi busy: the run ends later, with `agent_settled`. */
async function busyAfterAbort(t: Parameters<typeof harness>[0]) {
	const h = harness(t, { provider: "anthropic" });
	h.session.abort = async () => { h.session.aborts++; };
	await h.steer("steer me");
	assert.deepEqual(h.press(), { consume: true });
	await h.flush();
	return h;
}

it("a send that finds Pi busy starts the run when the session settles", async (t) => {
	const h = await busyAfterAbort(t);
	assert.deepEqual(h.sent, []);
	h.state.idle = true;
	h.settle();
	assert.deepEqual(h.sent, [steer("steer me")]);
	assert.deepEqual(h.notices, []);
});

it("a settle while Pi is still busy keeps waiting for the next one", async (t) => {
	const h = await busyAfterAbort(t);
	h.settle();
	assert.deepEqual(h.sent, []);
	h.state.idle = true;
	h.settle();
	assert.deepEqual(h.sent, [steer("steer me")]);
});

it("a manual compaction that ends without a settle also lets the send go", async (t) => {
	const h = await busyAfterAbort(t);
	h.state.compacting = true;
	h.session._emit({ type: "compaction_start", reason: "manual" });
	h.state.compacting = false;
	h.state.idle = true;
	h.session._emit({ type: "compaction_end", reason: "manual" });
	assert.deepEqual(h.sent, [steer("steer me")]);
});

it("nothing is polled: Pi becoming idle without the event sends nothing", async (t) => {
	const h = await busyAfterAbort(t);
	h.state.idle = true;
	h.tick(1000);
	await h.flush();
	assert.deepEqual(h.sent, []);
	h.settle();
	assert.deepEqual(h.sent, [steer("steer me")]);
});

it("a session end while waiting puts the text back, and a later settle sends nothing", async (t) => {
	const h = await busyAfterAbort(t);
	h.shutdown();
	assert.equal(h.state.editor, "steer me");
	h.state.idle = true;
	h.settle();
	assert.deepEqual(h.sent, []);
});
