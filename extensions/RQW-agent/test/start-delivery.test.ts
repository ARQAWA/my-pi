import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { fixture, gate, texts, tick, until } from "./audit-fixture.ts";

for (const mode of ["tui", "rpc", "print", "json"] as const) {
	test(`${mode}: two late children after abort, across an earlier agent_start hook`, async (t) => {
		for (const delivery of ["busy", "abort", "idle"] as const) {
			const slow = { enabled: false, entered: false, release: () => {} };
			const shared = globalThis as typeof globalThis & { __agentSlowStart?: typeof slow };
			shared.__agentSlowStart = slow;
			const f = await fixture(mode, undefined, [join(import.meta.dirname, "slow-start.ts")]);
			const children = [gate("LATE_ONE"), gate("LATE_TWO")];
			const busy = gate("INITIAL_BUSY");
			f.subReplies.push(...children.map(child => child.reply));
			f.mainReplies.push(busy.reply);
			const sent: { content: unknown; triggerTurn?: boolean }[] = [];
			const send = f.session.sendCustomMessage;
			const mock = t.mock.method(f.session, "sendCustomMessage", function (this: AgentSession, ...args: Parameters<typeof send>) {
				if (args[0].customType === "agent") sent.push({ content: args[0].content, triggerTurn: args[1]?.triggerTurn });
				return send.apply(this, args);
			});
			const settled: boolean[] = [];
			const unsubscribe = f.session.subscribe(event => {
				if (event.type === "agent_settled") settled.push(event.aborted);
			});
			let initial: Promise<void> | undefined, next: Promise<void> | undefined, abort: Promise<void> | undefined;
			try {
				await f.start("ONE");
				await f.start("TWO");
				initial = f.session.prompt("GO");
				await until(() => children.every(child => child.entered()) && busy.entered(), "both children and main busy");
				if (mode === "tui") f.session.clearQueue();
				await f.session.abort();
				await initial;
				assert.deepEqual(settled, [true]);
				assert.equal(f.requests.main.length, 1);
				assert.ok(children.every(child => !child.aborted()), "accepted children survive the main abort");

				if (delivery !== "idle") {
					slow.enabled = true;
					next = f.session.prompt("NEXT");
					await until(() => slow.entered, "earlier agent_start held");
					assert.equal(f.session.isIdle, false, "the new run is busy before agent's start hook");
					if (delivery === "abort") abort = f.session.abort();
				}
				for (const child of children) child.release();
				await until(() => sent.length === 2, "both late results sent");
				assert.deepEqual(sent.map(message => message.triggerTurn), [false, false]);
				assert.equal(f.requests.main.length, 1, "no request escapes the held hook or wakes an idle aborted main");
				assert.equal(f.session.agent.hasQueuedMessages(), false);
				if (delivery !== "idle") assert.deepEqual(f.delivered(), [], "Pi holds results until the current turn or run ends");
				else {
					await tick(100);
					assert.equal(f.requests.main.length, 1, "late idle results do not auto-wake");
				}
				slow.enabled = false;
				slow.release();
				await Promise.all([next, abort]);
				await tick(100);
				const results = ["[agent#1] LATE_ONE", "[agent#2] LATE_TWO"];
				assert.deepEqual(f.delivered().sort(), results);
				assert.equal(f.session.agent.hasQueuedMessages(), false);
				if (delivery === "busy") {
					assert.deepEqual(settled, [true, false]);
					assert.equal(f.requests.main.length, 3, "initial aborted request, new prompt and one continuation, not four requests");
					for (const result of results) assert.equal(texts(f.requests.main[1]).filter(text => text === result).length, 0);
				} else {
					assert.deepEqual(settled, delivery === "abort" ? [true, true] : [true]);
					assert.equal(f.requests.main.length, 1, "neither abort nor idle delivery auto-resumes");
					await f.session.prompt("USER_RESUMES");
					assert.equal(f.requests.main.length, 2, "results included in the next prompt need no duplicate continuation");
				}
				for (const result of results) assert.equal(texts(f.requests.main.at(-1)!).filter(text => text === result).length, 1);
				await tick(100);
				assert.equal(f.requests.main.length, delivery === "busy" ? 3 : 2, "no duplicate replay or wake");
				assert.deepEqual(f.errors, []);
			} finally {
				slow.enabled = false;
				slow.release();
				for (const child of children) child.release();
				busy.release();
				await f.session.abort();
				await Promise.all([initial, next, abort]);
				unsubscribe();
				mock.mock.restore();
				await f.cleanup();
				delete shared.__agentSlowStart;
			}
		}
	});
}
