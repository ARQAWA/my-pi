// T15 display details of delivered results, in real Pi sessions with only RQW-agent loaded and faux providers.
// The clock is a fake monotonic clock (performance.now), advanced by the scripted replies.
import assert from "node:assert/strict";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";
import { AgentSession, createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { Activity } from "../../../extensions/RQW-agent/activity.ts";
import { recordRunMessage, registerSessionRuntime, resultDisplay, type RunMeta } from "../../../extensions/RQW-agent/index.ts";
import { answer, fixture, gate, tick, until } from "./audit-fixture.ts";
import { withAgents } from "./metadata-fixture.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
type Delivered = { content: string; details: Record<string, any> };

/** Fake monotonic clock: replaces performance.now for this test only. */
function clock(t: TestContext, start = 1000) {
	const c = { now: start };
	t.mock.method(performance, "now", () => c.now);
	return c;
}

/** The delivered custom messages of one kind, in delivery order. */
function delivered(session: AgentSession, kind: string): Delivered[] {
	return session.messages.flatMap((m) => (m.role === "custom" && m.customType === kind ? [m as unknown as Delivered] : []));
}

/** The display fields of a custom message: everything in its details except delivery and run. */
function fields(details: Record<string, unknown>) {
	const { delivery: _delivery, run: _run, ...rest } = details;
	return rest;
}

/** The wait result's text with its display fields removed: the original body the model reads, unchanged. */
function bodyOf(result: { content: { type: string; text?: string }[]; details: unknown }) {
	const text = result.content[0].type === "text" ? result.content[0].text! : "";
	const details = structuredClone(result.details) as { results?: Record<string, unknown>[] };
	for (const r of details.results ?? []) delete r.display;
	return { text, withoutDisplay: JSON.stringify(details) };
}

const call = (f: Awaited<ReturnType<typeof fixture>>, name: string, params: Record<string, unknown>) =>
	f.session.getToolDefinition(name)!.execute("meta", params, undefined, undefined, f.session.extensionRunner.createContext());

const waitFor = (f: Awaited<ReturnType<typeof fixture>>, ids: string[]) =>
	call(f, "agent", { action: "wait", blocking: true, ids, timeout_ms: 60000 });

/** A separate SDK caller in the fixture's isolated home, loading only the ordinary agent runtime. */
async function callerSession(f: Awaited<ReturnType<typeof fixture>>): Promise<AgentSession> {
	const agentDir = join(f.root, "home");
	const loader = new DefaultResourceLoader({ cwd: f.root, agentDir, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
		extensionFactories: [pi => { registerSessionRuntime(pi); }] });
	await loader.reload();
	const { session } = await createAgentSession({ cwd: f.root, agentDir, modelRuntime: f.runtime, model: f.main.getModel("m"), thinkingLevel: "low",
		resourceLoader: loader, sessionManager: SessionManager.inMemory(f.root),
		settingsManager: SettingsManager.inMemory({}) });
	await session.bindExtensions({ mode: "tui", onError: e => f.errors.push(`${e.event}: ${e.error}`) });
	return session;
}

test("meta-finished-and-failed: outcome from the run, seconds from a fake monotonic clock rounded to 0.1", async (t) => {
	const c = clock(t);
	const f = await fixture();
	try {
		f.subReplies.push(async () => {
			c.now += 42_300;
			return answer("DONE");
		});
		f.subReplies.push(fauxAssistantMessage([fauxText("")], { stopReason: "error", errorMessage: "bad request" }));
		await f.start("ONE");
		await until(() => delivered(f.session, "agent").length === 1, "the first delivery");
		await f.start("TWO");
		await until(() => delivered(f.session, "agent").length === 2, "the second delivery");
		const [first, second] = delivered(f.session, "agent");
		assert.equal(first.content, "[agent#1] DONE");
		assert.deepEqual(fields(first.details), { id: "agent#1", outcome: "finished", model: `${f.sub.provider.id}/s`, thinking: "low", seconds: 42.3 });
		assert.equal(second.content, "[agent#2] error: bad request");
		assert.deepEqual(fields(second.details), { id: "agent#2", outcome: "failed", model: `${f.sub.provider.id}/s`, thinking: "low", seconds: 0 });
		assert.deepEqual(f.errors, []);
	} finally {
		await f.cleanup();
	}
});

/** A synthetic Activity: only the native clock and state are read; the run record is the caller's own (RunMeta). */
function fakeActivity() {
	const session = {
		listeners: new Set<(event: unknown) => void>(),
		messages: [] as unknown[],
		isStreaming: false,
		model: { provider: "anthropic", id: "requested" },
		subscribe(listener: (event: unknown) => void) {
			this.listeners.add(listener);
			return () => this.listeners.delete(listener);
		},
		getSessionStats: () => ({ tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }),
	};
	return new Activity(session as unknown as AgentSession);
}

test("meta-actual-model: the display model is the run's own last executed model, never the requested or session model", () => {
	const activity = fakeActivity();
	activity.startRun();
	// Activity keeps no run record of its own: the executed model and stop reason live in RQW-agent's run record.
	assert.equal("executedModel" in activity, false, "Activity exposes no executed model");
	assert.equal("lastStopReason" in activity, false, "Activity exposes no stop reason");
	// The actual collector that startRun's message_end handler calls, with the session model still the requested one.
	const meta: RunMeta = {};
	recordRunMessage(meta, { provider: "other", model: "executed-a", stopReason: "stop" });
	recordRunMessage(meta, { provider: "other", model: "executed-b", stopReason: "stop" });
	assert.equal(resultDisplay("agent#1", "completed", activity, meta, "low").model, "other/executed-b", "the last executed one, not the requested model");
	activity.endRun("completed");
	assert.equal(resultDisplay("agent#1", "completed", activity, meta, "low").model, "other/executed-b", "the record is the run's own, kept with it");
	// A fresh run record holds no data of the earlier run.
	const fresh: RunMeta = {};
	const display = resultDisplay("agent#2", "completed", activity, fresh, "low");
	assert.equal(Object.hasOwn(display, "model"), false, "a fresh run without executed messages omits the model");
});

test("meta-missing-model-omitted: with no executed assistant message the model field is absent, and seconds stay monotonic", (t) => {
	const c = clock(t);
	const activity = fakeActivity();
	activity.startRun();
	c.now += 2550;
	assert.equal(activity.runElapsedMs(), 2550, "running time is read from the monotonic clock");
	activity.endRun("error");
	assert.equal(activity.runElapsedMs(), 2550, "the finished run keeps its time");
	// A run whose record is still empty: no assistant message_end yet, so no model and no stop reason.
	const display = resultDisplay("agent#1", "error", activity, {});
	assert.equal(Object.hasOwn(display, "model"), false, "no executed model: the assembler omits the field");
	assert.equal(Object.hasOwn(display, "thinking"), false, "no thinking given: the assembler omits the field");
	assert.equal(display.outcome, "failed", "an error outcome is failed");
	assert.equal(display.seconds, 2.6, "2550 ms rounds to 2.6 seconds");
});

test("meta-both-paths: the custom message and the wait result carry the same display details", async (t) => {
	const c = clock(t);
	const f = await fixture();
	try {
		f.subReplies.push(async () => {
			c.now += 1000;
			return answer("MESSAGE");
		});
		const g = gate("WAITED");
		f.subReplies.push(g.reply);
		await f.start("ONE");
		await until(() => delivered(f.session, "agent").length === 1, "the message delivery");
		assert.deepEqual(fields(delivered(f.session, "agent")[0].details), { id: "agent#1", outcome: "finished", model: `${f.sub.provider.id}/s`, thinking: "low", seconds: 1 });

		await f.start("TWO");
		await until(() => g.entered(), "the second child running");
		const waiting = waitFor(f, ["agent#2"]);
		await tick(20);
		c.now += 2500;
		g.release();
		const result = await waiting;
		const details = result.details as { results: Record<string, unknown>[] };
		assert.equal(details.results.length, 1);
		assert.equal(details.results[0].text, "WAITED");
		assert.equal(details.results[0].outcome, "completed", "the legacy outcome stays");
		const expected = { id: "agent#2", outcome: "finished", model: `${f.sub.provider.id}/s`, thinking: "low", seconds: 2.5 };
		assert.deepEqual(details.results[0].display, expected);
		assert.equal(delivered(f.session, "agent").length, 1, "a result taken by wait is not also sent as a message");
	} finally {
		await f.cleanup();
	}
});

test("meta-models: ordinary agents on distinct models preserve display details through message and wait paths", async (t) => {
	for (const separateModel of [false, true]) {
		const role = "agent";
		const c = clock(t);
		const f = await fixture();
		try {
			const replies = separateModel ? await withAgents(f) : f.subReplies;
			const model = separateModel ? "anthropic/metadata-agent" : `${f.sub.provider.id}/s`;
			const start = (task: string) => call(f, role, { ...f.params(task), model });
			// Message path: the result is pushed to the caller as a custom message.
			replies.push(async () => {
				c.now += 7000;
				return answer("CODED");
			});
			assert.equal(await start("FIRST_BRIEF").then(r => r.content[0].type === "text" ? r.content[0].text : ""), `${role}#1 started`);
			await until(() => delivered(f.session, role).length === 1, `the ${role} message`);
			const [message] = delivered(f.session, role);
			assert.equal(message.content, `[${role}#1] CODED`);
			assert.deepEqual(fields(message.details), { id: `${role}#1`, outcome: "finished", model, thinking: "low", seconds: 7 });

			// Wait path: the same run's details come on the wait result, and the body keeps its text.
			const g = gate("WAITED");
			replies.push(g.reply);
			await start("WAIT_BRIEF");
			await until(() => g.entered(), `the ${role} running`);
			const waiting = call(f, role, { action: "wait", blocking: true, ids: [`${role}#2`], timeout_ms: 60000 });
			await tick(20);
			c.now += 2500;
			g.release();
			const result = await waiting;
			const details = result.details as { results: Record<string, unknown>[] };
			assert.equal(details.results[0].text, "WAITED");
			assert.deepEqual(details.results[0].display, { id: `${role}#2`, outcome: "finished", model, thinking: "low", seconds: 2.5 });
			const body = bodyOf(result);
			assert.equal(body.text, body.withoutDisplay, "the content text is the original body, display removed from details only");
			assert.doesNotMatch(body.text, /"display"/);
			assert.equal(delivered(f.session, role).length, 1, "a result taken by wait is not also sent as a message");
			assert.deepEqual(f.errors, []);
		} finally {
			await f.cleanup();
		}
	}
});

test("meta-aborted-final-failed: a delivered final aborted stop shows as failed; a successful retry shows as finished", async (t) => {
	const c = clock(t);
	const f = await fixture();
	try {
		f.subReplies.push(fauxAssistantMessage([], { stopReason: "aborted" }));
		f.subReplies.push(fauxAssistantMessage([], { stopReason: "error", errorMessage: "overloaded_error" }), async () => {
			c.now += 500;
			return answer("RETRIED");
		});
		await f.start("ABORTED");
		await until(() => delivered(f.session, "agent").length === 1, "the aborted delivery");
		assert.deepEqual(fields(delivered(f.session, "agent")[0].details), { id: "agent#1", outcome: "failed", model: `${f.sub.provider.id}/s`, thinking: "low", seconds: 0 });
		// The retry happens inside the child: its error is not a result, and the final stop makes the display finished.
		await f.start("RETRY");
		await until(() => delivered(f.session, "agent").length === 2, "the retried delivery", 15000);
		const second = delivered(f.session, "agent")[1];
		assert.equal(second.content, "[agent#2] RETRIED");
		assert.equal(second.details.outcome, "finished");
		assert.deepEqual(f.errors, []);
	} finally {
		await f.cleanup();
	}
});

test("delivery-unchanged: content, delivery token, quiet, queued and retry delivery keep their protocol with the metadata", async (t) => {
	await t.test("plain run: nothing while running, then exactly one message with the original bytes", async () => {
		const f = await fixture();
		try {
			const g = gate("FIRST");
			f.subReplies.push(g.reply);
			await f.start("ONE");
			await until(() => g.entered(), "the child running");
			await tick(50);
			assert.deepEqual(delivered(f.session, "agent"), [], "no delivery while the child runs");
			g.release();
			await until(() => delivered(f.session, "agent").length === 1, "the delivery");
			await tick(50);
			const messages = delivered(f.session, "agent");
			assert.equal(messages.length, 1, "exactly one message after complete");
			const [message] = messages;
			assert.equal(message.content, "[agent#1] FIRST");
			assert.match(String(message.details.delivery), UUID);
			assert.equal(typeof message.details.run, "string");
			assert.deepEqual(Object.keys(message.details).sort(), ["delivery", "id", "model", "outcome", "run", "seconds", "thinking"]);
			assert.equal(message.details.outcome, "finished");
			// A public wait after the pushed delivery: a receipt carrying the same delivery token, with no second copy.
			const receipt = JSON.parse(await f.call({ action: "wait", blocking: true, ids: ["agent#1"], timeout_ms: 1 }));
			assert.equal(receipt.reason, "receipt");
			assert.equal(receipt.receipts.length, 1);
			assert.equal(receipt.receipts[0].delivered_via, "message");
			assert.equal(receipt.receipts[0].delivery, message.details.delivery, "the receipt carries the custom message's delivery token");
			assert.equal(receipt.receipts[0].run, message.details.run);
			await tick(50);
			assert.equal(delivered(f.session, "agent").length, 1, "no duplicate after the receipt");
			assert.deepEqual(f.errors, []);
		} finally {
			await f.cleanup();
		}
	});

	await t.test("queued steering: nothing while queued, then exactly one message holding both answers in order", async () => {
		const f = await fixture();
		try {
			const g = gate("FIRST");
			f.subReplies.push(g.reply, answer("SECOND"));
			await f.start("ONE");
			await until(() => g.entered(), "the child running");
			assert.equal(await f.call({ action: "send", id: "1", task: "TWO" }), "agent#1: queued after the current tool call");
			await tick(50);
			assert.deepEqual(delivered(f.session, "agent"), [], "no delivery while the queued work is pending");
			g.release();
			await until(() => delivered(f.session, "agent").length === 1, "the delivery");
			await tick(50);
			const messages = delivered(f.session, "agent");
			assert.equal(messages.length, 1, "exactly one message after complete");
			assert.equal(messages[0].content, "[agent#1] FIRST\n\nSECOND");
			assert.equal(messages[0].details.outcome, "finished");
			assert.deepEqual(f.errors, []);
		} finally {
			await f.cleanup();
		}
	});

	await t.test("native follow-up: a queued follow-up joins the child's run, delivered once after its last answer", async childTest => {
		const f = await fixture();
		let extra: AgentSession | undefined;
		try {
			extra = await callerSession(f);
			let child: AgentSession | undefined;
			const prompt = AgentSession.prototype.prompt;
			childTest.mock.method(AgentSession.prototype, "prompt", function(this: AgentSession, ...args: Parameters<typeof prompt>) {
				if (this !== extra && this !== f.session) child = this;
				return prompt.apply(this, args);
			});
			const first = gate("FIRST"), second = gate("SECOND");
			f.subReplies.push(first.reply, second.reply);
			const started = await extra.getToolDefinition("agent")!.execute("native", f.params("ONE"), undefined, undefined, extra.extensionRunner.createContext());
			assert.equal(started.content[0].type === "text" ? started.content[0].text : "", "agent#1 started");
			await until(() => first.entered(), "the first child reply");
			const mainRequests = f.requests.main.length;
			assert.ok(child, "the runtime created a real child session");
			await child.followUp("TWO");
			await tick(50);
			assert.deepEqual(delivered(extra, "agent"), [], "no message before the first release");
			first.release();
			await until(() => second.entered(), "the follow-up reply");
			await tick(50);
			assert.deepEqual(delivered(extra, "agent"), [], "no message while the follow-up's reply is pending");
			assert.equal(f.requests.main.length, mainRequests, "the caller is not woken while the follow-up runs");
			second.release();
			await until(() => delivered(extra, "agent").length === 1, "the delivery");
			await until(() => f.requests.main.length === mainRequests + 1, "the one caller wake");
			await tick(50);
			const messages = delivered(extra, "agent");
			assert.equal(messages.length, 1, "exactly one message after the follow-up completes");
			assert.equal(messages[0].content, "[agent#1] FIRST\n\nSECOND");
			assert.equal(messages[0].details.outcome, "finished");
			assert.equal(f.requests.main.length, mainRequests + 1, "the caller is woken once");
			assert.deepEqual(f.errors, []);
		} finally {
			if (extra) {
				await extra.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
				extra.dispose();
			}
			await f.cleanup();
		}
	});

	await t.test("quiet interrupt: nothing is delivered and the caller is not woken", async () => {
		const f = await fixture();
		try {
			const g = gate("NEVER");
			f.subReplies.push(g.reply);
			await f.start("ONE");
			await until(() => g.entered(), "the child running");
			const mainRequests = f.requests.main.length;
			const messages = f.session.messages.length;
			assert.equal(JSON.parse(await f.call({ action: "interrupt", id: "1" })).reason, "interruption_requested");
			await until(() => g.aborted(), "the child aborted");
			await tick(100);
			assert.deepEqual(delivered(f.session, "agent"), [], "a quiet run delivers nothing");
			assert.equal(f.session.messages.length, messages, "no message of any kind is added");
			assert.equal(f.requests.main.length, mainRequests, "the caller is not woken");
			assert.deepEqual(f.errors, []);
		} finally {
			await f.cleanup();
		}
	});

	await t.test("successful retry: the final answer is delivered once as finished, with no provisional error", async () => {
		const f = await fixture();
		try {
			const retry = gate("RETRIED");
			f.subReplies.push(fauxAssistantMessage([], { stopReason: "error", errorMessage: "overloaded_error" }), retry.reply);
			await f.start("ONE");
			await until(() => retry.entered(), "the retry running", 15000);
			const mainRequests = f.requests.main.length;
			await tick(50);
			assert.deepEqual(delivered(f.session, "agent"), [], "no provisional delivery while the retry runs");
			assert.equal(f.requests.main.length, mainRequests, "the caller is not woken while the retry runs");
			retry.release();
			await until(() => delivered(f.session, "agent").length === 1, "the retried delivery", 15000);
			await tick(50);
			const messages = delivered(f.session, "agent");
			assert.equal(messages.length, 1, "exactly one message after complete");
			assert.equal(messages[0].content, "[agent#1] RETRIED", "the provisional error is not in the answer");
			assert.equal(messages[0].details.outcome, "finished");
			assert.equal(messages[0].details.model, `${f.sub.provider.id}/s`);
			assert.equal(f.requests.sub.length, 2, "one retry request");
			assert.deepEqual(f.errors, []);
		} finally {
			await f.cleanup();
		}
	});
});
