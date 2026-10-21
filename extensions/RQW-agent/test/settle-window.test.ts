import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { fixture, gate, texts, tick, until } from "./audit-fixture.ts";

for (const mode of ["tui", "rpc", "print", "json"] as const) {
	for (const stage of ["end", "before", "after", "settled", "end-idle", "before-idle", "mixed"] as const) {
		for (const aborted of stage === "mixed" ? [false] : stage === "end-idle" ? [true] : [true, false]) {
			test(`${mode}: two children at ${stage}, ${aborted ? "abort never wakes" : "normal batch continues"}`, async () => {
				const hold = { enabled: true, entered: false, side: stage === "after" ? "after" : "before",
					event: stage.startsWith("end") ? "agent_end" : stage === "settled" ? "agent_settled" : "agent_before_settle", release: () => {} };
				(globalThis as any).__agentPhase = hold;
				const f = await fixture(mode, undefined, [join(import.meta.dirname, "phase-before.ts")], [join(import.meta.dirname, "phase-after.ts")]);
				const children = [gate("ONE"), gate("TWO")];
				f.subReplies.push(...children.map(g => g.reply));
				const busy = gate("BUSY");
				const streamAbort = stage === "settled" && aborted;
				if (streamAbort || stage === "mixed") f.mainReplies.push(busy.reply);
				let run: Promise<void> | undefined, abort: Promise<void> | undefined;
				try {
					if (streamAbort) { await f.start("ONE"); await f.start("TWO"); }
					else if (stage === "mixed") await f.start("ONE");
					run = f.session.prompt("GO");
					if (streamAbort) {
						await until(busy.entered, "held main stream");
						if (mode === "tui") f.session.clearQueue();
						abort = f.session.abort();
					}
					if (stage === "mixed") {
						await until(() => busy.entered() && children[0].entered(), "first child during main stream");
						children[0].release();
						await tick(100);
						busy.release();
					}
					await until(() => hold.entered, "earlier lifecycle hook");
					assert.equal(f.session.isIdle, stage === "settled", "SDK flips idle before settled handlers");
					if (!streamAbort) {
						if (stage !== "mixed") await f.start("ONE");
						await f.start("TWO");
						if (aborted) abort = f.session.abort();
					}
					if (stage.endsWith("-idle")) {
						const release = hold.release;
						hold.entered = false; hold.event = "agent_settled"; hold.enabled = true;
						release();
						await until(() => hold.entered, "earlier settled after late abort");
						assert.equal(f.session.isIdle, true);
					}
					await until(() => children.every(g => g.entered()), "both child streams");
					for (const g of children) g.release();
					await tick(100);
					assert.equal(f.requests.main.length, 1, "no main request escapes held lifecycle");
					hold.release();
					await Promise.all([run, abort]);
					await until(() => f.delivered().length === 2, "both results persisted");
					await f.session.waitForIdle();
					await tick(100);
					const results = ["[agent#1] ONE", "[agent#2] TWO"];
					assert.deepEqual(f.delivered().sort(), results);
					assert.equal(f.requests.main.length, aborted ? 1 : 2, "abort stays stopped; normal settlement gets one batch turn");
					assert.equal(f.session.agent.hasQueuedMessages(), false);
					if (aborted) await f.session.prompt("USER_RESUMES");
					for (const result of results) assert.equal(texts(f.requests.main.at(-1)!).filter(text => text === result).length, 1);
					// Ordinary settlement re-enables an idle child's normal wakeup, including after a user resumes an abort.
					const third = gate("THREE");
					f.subReplies.push(third.reply);
					await f.start("THREE");
					third.release();
					await until(() => f.requests.main.length === 3, "ordinary idle wakeup");
					await f.session.waitForIdle();
					assert.equal(texts(f.requests.main[2]).filter(text => text === "[agent#3] THREE").length, 1);
					assert.deepEqual(f.errors, []);
				} finally {
					hold.enabled = false; hold.release();
					for (const g of children) g.release();
					busy.release();
					await f.session.abort();
					await Promise.all([run, abort]);
					await f.cleanup();
					delete (globalThis as any).__agentPhase;
				}
			});
		}
	}
}
