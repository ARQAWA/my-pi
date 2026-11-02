import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { type Any, call, chainCall, done, reply, setup as setupRun, task } from "./run-helper.ts";

function setup(...args: Parameters<typeof setupRun>) {
	const env = setupRun(...args);
	return {
		...env,
		call: (input: Any, signal?: AbortSignal) => env.call(input.action === "run" ? { record: false, ...input } : input, signal),
		full: (input: Any, signal?: AbortSignal) => env.full(input.action === "run" ? { record: false, ...input } : input, signal),
	};
}
import { startRecording } from "../../../extensions/RQW-browser/recorder.ts";

it("binds the recorder to the selected page rather than another DevTools window", async () => {
	const events: string[] = [];
	const recorder = {
		keyboard: { down: async () => {}, up: async () => {}, press: async () => {}, type: async () => {} },
		waitForFunction: async (_fn: unknown, _options: unknown, label: string | boolean) => ({ asElement: () => ({ click: async () => events.push(String(label)) }), dispose: async () => {} }),
	};
	const page = { openDevTools: async () => { events.push("selected page"); return recorder; } };
	await startRecording(page as never, new AbortController().signal);
	assert.deepEqual(events, ["selected page", "Create recording"]);
});

it("executes the ordered actions in an isolated model context and observes the result", async () => {
	const env = setup([reply(call(0), call(1), call(2)), reply(call(1)), reply(call(2)), done()]);
	const result = await env.call(task);
	assert.deepEqual(env.keys, ["0", "1", "2"]);
	assert.equal(result.reached, true);
	assert.equal(result.stopped, null);
	assert.equal(result.summary, "Done visible");
	assert.match(result.page.name, /^run-/);
	assert.equal(env.requests[0].reasoning, "medium");
	assert.deepEqual(env.requests[0].context.tools.map((item: Any) => item.name), ["view", "call"]);
	assert.deepEqual(env.requests[0].context.messages.map((item: Any) => item.role), ["user"]);
	assert.equal(env.requests[0].context.sessionId, undefined);
	assert.match(env.requests[1].context.messages.at(-1).content[0].text, /Not executed/);
	await env.shutdown();
});

it("runs a chain the executor model sends, through the registered run", async () => {
	const env = setup([reply(chainCall([{ method: "press", args: ["Z"] }])), done()]);
	const result = await env.call({ ...task, actions: ["press Z"] });
	assert.deepEqual(env.keys, ["Z"]);
	assert.equal(result.stopped, null);
	await env.shutdown();
});

it("stops on conditions, incomplete views and wrong action order before changing the page", async () => {
	for (const [options, conditions, first, stopped] of [
		[{}, [{ kind: "text_visible", value: "missing", effect: "require" }], call(0), "condition"],
		[{ incomplete: true }, [{ kind: "url_contains", value: "other", effect: "stop_if" }], call(0), "condition"],
		[{ disabled: true }, [{ kind: "control_enabled", value: "Submit", effect: "require" }], call(0), "condition"],
		[{}, [], call(0, 1), "error"],
	] as Any[]) {
		const env = setup([reply(first)], options);
		const result = await env.call({ ...task, conditions });
		assert.equal(result.stopped, stopped);
		assert.equal(result.reached, false);
		assert.deepEqual(env.keys, []);
		await env.shutdown();
	}
});

it("does not report success before all actions or with an incomplete view", async () => {
	const early = setup([done()]);
	const earlyResult = await early.call(task);
	assert.equal(earlyResult.reached, false);
	assert.equal(earlyResult.stopped, "error");
	assert.doesNotMatch(earlyResult.summary, /model|executor/i);
	await early.shutdown();
	const incomplete = setup([reply(call(0)), reply(call(1)), reply(call(2)), done()], { incomplete: true });
	const result = await incomplete.call(task);
	assert.deepEqual(incomplete.keys, ["0", "1", "2"]);
	assert.equal(result.reached, false);
	assert.equal(result.stopped, "limit");
	await incomplete.shutdown();
});

it("returns neutral errors for failed or invalid responses", async () => {
	for (const response of [
		{ ...reply(), stopReason: "error", errorMessage: "model executor failed" },
		{ ...reply(), stopReason: "error", errorMessage: "claude-haiku-5-5 failed" },
		reply({ type: "text", text: "invalid" }),
		reply({ type: "text", text: "{}" }),
	]) {
		const env = setup([response]);
		const result = await env.call(task);
		assert.equal(result.stopped, "error");
		assert.doesNotMatch(result.summary, /model|executor/i);
		await env.shutdown();
	}
	for (const [errorMessage, reason] of [["Account quota exceeded", "Account quota exceeded"], ["Model authentication failed", "authentication failed"], ["claude-haiku-5-5 rate limit reached", "rate limit reached"]]) {
		const env = setup([{ ...reply(), stopReason: "error", errorMessage }]);
		const result = await env.call(task);
		assert.equal(result.stopped, "error");
		assert.ok(result.summary.includes(reason));
		assert.doesNotMatch(result.summary, /model|executor|claude-haiku-5-5/i);
		await env.shutdown();
	}
});

it("translates short model ids to current browser ids", async () => {
	const inspect = { type: "toolCall", id: "inspect", name: "call", arguments: { action: 0, chain: [{ method: "id", args: ["1"] }, { method: "isVisible", args: [] }] } };
	const env = setup([reply(inspect), done()]);
	const result = await env.call({ ...task, actions: ["inspect Submit"] });
	assert.equal(result.stopped, null);
	assert.equal(result.reached, true);
	assert.equal(result.steps[1].target, "button: Submit");
	assert.equal(JSON.parse(env.requests[1].context.messages.at(-1).content[0].text).value, true);
	assert.match(env.requests[0].context.messages[0].content, /\[id:1\]/);
	assert.deepEqual(env.requests[1].context.messages[1].content[0].arguments.chain[0].args, ["1"]);
	await env.shutdown();
});

it("rejects ids from an older view instead of acting on a new element", async () => {
	const inspect = (id: string, action: number) => ({ type: "toolCall", id, name: "call", arguments: { action, chain: [{ method: "id", args: [1] }, { method: "isVisible", args: [] }] } });
	const env = setup([reply(inspect("first", 0)), reply(inspect("second", 1))]);
	const result = await env.call({ ...task, actions: ["inspect first", "inspect second"] });
	assert.equal(result.stopped, "error");
	assert.match(result.summary, /Target is not in the current view.*last confirmed action: inspect first/);
	await env.shutdown();
});

it("does not treat renderer role or state labels as visible page text", async () => {
	for (const value of ["button", "disabled", "Submit"]) {
		const env = setup([reply(call(0))], { disabled: true });
		const result = await env.call({ ...task, conditions: [{ kind: "text_visible", value, effect: "require" }] });
		assert.equal(result.stopped, "condition");
		assert.deepEqual(env.keys, []);
		await env.shutdown();
	}
});

it("checks visible shadow text and ignores transparent text", async () => {
	const text = (value: string) => ({ nodeType: 3, textContent: value });
	const element = (children: Any[], extra: Any = {}) => ({ nodeType: 1, childNodes: children, matches: () => false, ...extra });
	const dom = element([element([text("Hidden")], { opacity: "0" }), element([], { shadowRoot: { nodeType: 11, childNodes: [element([text("Shadow")])] } })]);
	for (const [value, effect] of [["Hidden", "require"], ["Shadow", "stop_if"]]) {
		const env = setup([reply(call(0))], { dom });
		const result = await env.call({ ...task, conditions: [{ kind: "text_visible", value, effect }] });
		assert.equal(result.stopped, "condition");
		assert.deepEqual(env.keys, []);
		await env.shutdown();
	}
});

it("matches inline text while ignoring text clipped outside its container", async () => {
	const text = (value: string, x = 0) => ({ nodeType: 3, textContent: value, x });
	const element = (children: Any[], extra: Any = {}) => ({ nodeType: 1, childNodes: children, matches: () => false, ...extra });
	const dom = element([text("Sub"), element([text("mit")]), element([text("Hidden", 10)], { overflowX: "hidden", getBoundingClientRect: () => ({ left: 0, right: 5, top: 0, bottom: 5, width: 5, height: 5 }) })]);
	for (const [value, effect] of [["Submit", "stop_if"], ["Hidden", "require"]]) {
		const env = setup([reply(call(0))], { dom });
		const result = await env.call({ ...task, conditions: [{ kind: "text_visible", value, effect }] });
		assert.equal(result.stopped, "condition");
		assert.deepEqual(env.keys, []);
		await env.shutdown();
	}
});

it("does not join separate blocks or trust partially clipped text", async () => {
	const text = (value: string, x = 0, width = 1) => ({ nodeType: 3, textContent: value, x, width });
	const element = (children: Any[], extra: Any = {}) => ({ nodeType: 1, childNodes: children, matches: () => false, ...extra });
	const clip = { overflowX: "hidden", getBoundingClientRect: () => ({ left: 0, right: 5, top: 0, bottom: 5, width: 5, height: 5 }) };
	for (const [dom, value] of [
		[element([element([text("Ready")], { display: "block" }), element([text("Delete")], { display: "block" })]), "ReadyDelete"],
		[element([element([text("ReadySecret", 4, 2)], clip)]), "Secret"],
	] as const) {
		const env = setup([reply(call(0))], { dom });
		const result = await env.call({ ...task, conditions: [{ kind: "text_visible", value, effect: "require" }] });
		assert.equal(result.stopped, "condition");
		assert.deepEqual(env.keys, []);
		await env.shutdown();
	}
});

it("rejects selector actions and another target after a page change", async () => {
	for (const [chain, error] of [
		[[{ method: "click", args: ["button"] }], /Element actions and reads require a target/],
		[[{ method: "waitForText", args: ["Ready", { selector: "button" }] }], /Wait cannot target a selector/],
		[[{ method: "press", args: ["A"] }, { method: "text", args: ["button"] }], /Element actions and reads require a target/],
		[[{ method: "press", args: ["A"] }, { method: "id", args: [1] }, { method: "isVisible", args: [] }], /changed page requires a fresh view/],
	] as const) {
		const attempt = { type: "toolCall", id: "bad", name: "call", arguments: { action: 0, chain } };
		const env = setup([reply(attempt)]);
		const result = await env.call(task);
		assert.equal(result.stopped, "error");
		assert.match(result.summary, error);
		assert.deepEqual(env.keys, []);
		await env.shutdown();
	}
});

it("refuses a chain that uses a target after navigation", async () => {
	const navigation = { type: "toolCall", id: "nav", name: "call", arguments: { action: 0, chain: [{ method: "goto", args: ["https://other.test"] }, { method: "id", args: [1] }, { method: "isVisible", args: [] }] } };
	const env = setup([reply(navigation)]);
	const result = await env.call(task);
	assert.equal(result.stopped, "error");
	assert.match(result.summary, /Navigation must be followed by a fresh view/);
	assert.equal((await env.call({ action: "tabs" }))[0].url, "https://local.test");
	await env.shutdown();
});

it("limits changing operations before executing a chain", async () => {
	const excess = { type: "toolCall", id: "excess", name: "call", arguments: { action: 0, chain: Array.from({ length: 25 }, () => ({ method: "press", args: ["A"] })) } };
	const env = setup([reply(excess)]);
	assert.equal((await env.call(task)).stopped, "limit");
	assert.deepEqual(env.keys, []);
	await env.shutdown();
});

it("returns one strict step per operation and retries an overlong summary once", async () => {
	const long = reply({ type: "text", text: JSON.stringify({ summary: "First.\n\nSecond.\n\nThird.", reached: true }) });
	const env = setup([reply(chainCall([{ method: "press", args: ["A"] }, { method: "press", args: ["B"] }])), long, done()]);
	const result = await env.call({ ...task, actions: ["press twice"] });
	assert.deepEqual(result.steps.map((step: Any) => [step.index, step.action_index, step.method, step.value, step.status]), [[0, null, null, null, "done"], [1, 0, "press", "A", "done"], [2, 0, "press", "B", "done"]]);
	assert.equal(result.summary, "Done visible");
	assert.match(env.requests[2].context.messages.at(-1).content, /Shorten to two paragraphs/);
	assert.deepEqual(Object.keys(result).sort(), ["files", "page", "reached", "steps", "stopped", "summary"]);
	await env.shutdown();
});

it("writes requested captures at the start and after each operation", async () => {
	const env = setup([reply(chainCall([{ method: "press", args: ["A"] }, { method: "press", args: ["B"] }])), done()]);
	const result = await env.call({ ...task, actions: ["press twice"], capture: { screenshot: true, markdown: true, html: true } });
	for (const [index, step] of result.steps.entries()) {
		const prefix = join(result.files.folder, String(index).padStart(2, "0"));
		assert.deepEqual(step.files, { screenshot: `${prefix}.png`, markdown: `${prefix}.md`, html: `${prefix}.html` });
		assert.deepEqual(await readFile(step.files.screenshot), Buffer.from([1, 2, 3]));
		assert.doesNotMatch(await readFile(step.files.markdown, "utf8"), /\[id:/);
		assert.equal(await readFile(step.files.html, "utf8"), `<html>${"AB".slice(0, index)}</html>`);
	}
	await env.shutdown();
	const disabled = setup([reply(call(0)), done()]);
	const noFiles = await disabled.call({ ...task, actions: ["first"] });
	assert.deepEqual(noFiles.steps.map((step: Any) => step.files), [0, 1].map(() => ({ screenshot: null, markdown: null, html: null })));
	await disabled.shutdown();
});

it("only observes intermediate chain steps when Markdown capture needs them", async () => {
	for (const markdown of [false, true]) {
		const env = setup([reply(chainCall([{ method: "press", args: ["A"] }, { method: "press", args: ["B"] }])), done()]);
		const result = await env.call({ ...task, actions: ["press twice"], capture: { markdown }, record: false });
		assert.equal(result.stopped, null);
		assert.deepEqual(env.observations, markdown ? ["", "A", "AB"] : ["", "AB"]);
		if (markdown) assert.match(await readFile(result.steps[1].files.markdown, "utf8"), /Ready/);
		await env.shutdown();
	}
});

it("keeps all page Markdown and preserves targets across read operations in one chain", async () => {
	const longText = `${"x".repeat(17000)}END-OF-PAGE`;
	const env = setup([reply(chainCall([{ method: "id", args: [1] }, { method: "isVisible", args: [] }, { method: "id", args: [1] }, { method: "isEnabled", args: [] }])), done()], { pageText: longText });
	const result = await env.call({ ...task, actions: ["inspect twice"], capture: { markdown: true }, record: false });
	assert.deepEqual(result.steps.map((step: Any) => step.status), ["done", "done", "done"]);
	assert.equal(result.steps[2].target, "button: Submit");
	assert.match(await readFile(result.steps[0].files.markdown, "utf8"), /END-OF-PAGE/);
	assert.match(await readFile(result.steps[2].files.markdown, "utf8"), /END-OF-PAGE/);
	await env.shutdown();
});

it("exports the selected Recorder flow through both Chrome converters", async () => {
	const folder = await mkdtemp(join(tmpdir(), "recorder-fixture-"));
	const panelFolder = join(folder, "panels", "recorder");
	await mkdir(join(panelFolder, "converters"), { recursive: true });
	await writeFile(join(panelFolder, "recorder.js"), `export const RecorderPanel = { RecorderPanel: { instance: () => globalThis.recorderFixture.panel } };`);
	await writeFile(join(panelFolder, "converters", "converters.js"), `
		export const JSONConverter = { JSONConverter: class { async stringify(flow) {
			globalThis.recorderFixture.exports.push('json');
			if (globalThis.recorderFixture.fail === 'json') throw new Error('json export failed');
			return [JSON.stringify(flow)];
		} } };
		export const PuppeteerConverter = { PuppeteerConverter: class { async stringify(flow) {
			globalThis.recorderFixture.exports.push('script');
			if (globalThis.recorderFixture.fail === 'script') throw new Error('script export failed');
			return [\`await page.keyboard.press('\${flow.steps.at(-1).key}');\`];
		} } };`);
	const globals = globalThis as Any;
	const previousLocation = Object.getOwnPropertyDescriptor(globals, "location");
	const previousFixture = Object.getOwnPropertyDescriptor(globals, "recorderFixture");
	const events: string[] = [];
	const flow: Any = { title: "Flow", steps: [{ type: "navigate", url: "https://local.test" }] };
	const fixture = { panel: { isRecording: false, isToggling: false, currentRecording: { flow } }, exports: [] as string[], fail: "" };
	Object.defineProperty(globals, "location", { configurable: true, value: { href: pathToFileURL(join(folder, "inspector.html")).href } });
	Object.defineProperty(globals, "recorderFixture", { configurable: true, value: fixture });
	const recorder = {
		keyboard: { down: async () => {}, up: async () => {}, press: async (key: string) => { if (key === "Enter" && events.includes("Create recording")) fixture.panel.isRecording = true; }, type: async () => {} },
		waitForFunction: async (fn: Any, _options: unknown, value: string | boolean) => {
			if (typeof value === "boolean") assert.equal(await fn(value), true);
			return { asElement: () => ({ click: async () => { events.push(String(value)); if (value === "End recording") fixture.panel.isRecording = false; } }), dispose: async () => {} };
		},
		evaluate: async (fn: () => Promise<unknown>) => await fn(),
	};
	const env = setupRun(Array.from({ length: 3 }, () => [reply(call(0)), done()]).flat(), { press: async key => { if (fixture.panel.isRecording) flow.steps.push({ type: "keyDown", key }); } });
	try {
		await env.call({ action: "open", name: "other" });
		await env.call({ action: "open", name: "selected" });
		env.pages[0].openDevTools = async () => { throw new Error("wrong tab"); };
		env.pages[1].openDevTools = async () => { events.push("selected page"); return recorder; };
		const input = { action: "run", name: "selected", actions: ["first"], expected: "Done" };
		const result = await env.call(input);
		assert.deepEqual(events, ["selected page", "Create recording", "End recording"]);
		assert.deepEqual(fixture.exports, ["json", "script"]);
		assert.deepEqual(JSON.parse(await readFile(result.files.recording, "utf8")).steps.at(-1), { type: "keyDown", key: "0" });
		assert.match(await readFile(result.files.script, "utf8"), /press\('0'\)/);
		assert.equal(result.files.recording_error, null);
		for (const format of ["json", "script"]) {
			fixture.fail = format;
			const failed = await env.call(input);
			assert.equal(failed.reached, false);
			assert.equal(failed.stopped, "error");
			assert.match(failed.files.recording_error, new RegExp(`${format} export failed`));
		}
		fixture.fail = "";
		const controller = new AbortController();
		const cancelled = setupRun([], {
			openDevTools: async () => recorder,
			model: async () => { controller.abort(); return done(); },
		});
		try {
			const endCount = events.filter(event => event === "End recording").length;
			const cancelledResult = await cancelled.call({ ...task, actions: ["first"] }, controller.signal);
			assert.equal(cancelledResult.stopped, "cancelled");
			assert.equal(fixture.panel.isRecording, false);
			assert.equal(events.filter(event => event === "End recording").length, endCount + 1);
		} finally { await cancelled.shutdown(); }
	} finally {
		await env.shutdown();
		if (previousLocation) Object.defineProperty(globals, "location", previousLocation); else delete globals.location;
		if (previousFixture) Object.defineProperty(globals, "recorderFixture", previousFixture); else delete globals.recorderFixture;
		await rm(folder, { recursive: true, force: true });
	}
});

it("stops before actions if Recorder startup fails and does not record when disabled", async () => {
	const recorder = {
		keyboard: { down: async () => {}, up: async () => {}, press: async () => {}, type: async () => {} },
		waitForFunction: async (_fn: unknown, _options: unknown, value: string | boolean) => {
			if (typeof value === "boolean") throw new Error("Recorder start failed");
			return { asElement: () => ({ click: async () => {} }), dispose: async () => {} };
		},
		evaluate: async () => ({ active: false, toggling: false }),
	};
	const env = setupRun([reply(call(0)), done()], { openDevTools: async () => recorder });
	await assert.rejects(env.call({ ...task, actions: ["first"] }), /Recorder start failed/);
	assert.deepEqual(env.keys, []);
	assert.deepEqual(env.requests, []);
	const result = await env.call({ ...task, actions: ["first"], record: false });
	assert.equal(result.stopped, null);
	assert.equal(result.files.recording, null);
	assert.equal(result.files.script, null);
	await env.shutdown();
});

it("does not act if recording is unavailable by default", async () => {
	const env = setupRun([reply(call(0)), done()]);
	await assert.rejects(env.call({ ...task, actions: ["first"] }));
	assert.deepEqual(env.keys, []);
	assert.deepEqual(env.requests, []);
	await env.shutdown();
});

it("writes the executor transcript from the first request without returning it", async () => {
	const secret = "transcript-only-secret";
	const env = setup([reply(call(0)), done()]);
	const output = await env.full({ ...task, actions: ["first"], credentials: { password: secret }, record: false });
	const path = join(output.details.value.files.folder, "transcript.jsonl");
	const transcript = await readFile(path, "utf8");
	assert.match(transcript, /Credentials are test-account values/);
	assert.match(transcript, new RegExp(secret));
	assert.match(transcript, /toolResult/);
	assert.match(transcript, /Done visible/);
	assert.doesNotMatch(JSON.stringify(output), /transcript\.jsonl|transcript-only-secret|Credentials are test-account values/);
	assert.doesNotMatch(JSON.stringify(output), new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
	await env.shutdown();
});

it("marks failed operations and unstarted actions", async () => {
	const env = setup([reply(call(0))], { press: async () => { throw new Error("failed"); } });
	const result = await env.call(task);
	assert.deepEqual(result.steps.map((step: Any) => step.status), ["done", "failed", "not_run", "not_run"]);
	assert.equal(result.steps[1].error, "failed");
	await env.shutdown();
});

it("keeps a successful operation done if capture fails", async () => {
	let reads = 0;
	const env = setup([reply(call(0))], { html: async () => { if (++reads === 2) throw new Error("capture failed"); return "<html></html>"; } });
	const result = await env.call({ ...task, actions: ["first"], capture: { html: true }, record: false });
	assert.equal(result.stopped, "error");
	assert.match(result.summary, /capture failed; last confirmed action: first/);
	assert.equal(result.steps[1].status, "done");
	assert.deepEqual(env.keys, ["0"]);
	await env.shutdown();
});

it("captures the page after a failed operation that already changed it", async () => {
	const env = setup([reply(call(0))], { press: async () => { throw new Error("dispatch failed"); } });
	const result = await env.call({ ...task, actions: ["first"], capture: { html: true }, record: false });
	assert.equal(result.steps[1].status, "failed");
	assert.equal(result.steps[1].error, "dispatch failed");
	assert.equal(await readFile(result.steps[1].files.html, "utf8"), "<html>0</html>");
	await env.shutdown();
});

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(done => { resolve = done; });
	return { promise, resolve };
}

it("cancels a pending model request and releases the shared queue without accepting its late action", async () => {
	const started = deferred<AbortSignal>();
	const pending = deferred<Any>();
	const env = setup([], { model: async (_index, signal) => { started.resolve(signal); return await pending.promise; } });
	const controller = new AbortController();
	const running = env.call(task, controller.signal);
	const modelSignal = await started.promise;
	const queued = env.call({ action: "tabs" });
	controller.abort();
	const result = await running;
	assert.equal(modelSignal.aborted, true);
	assert.equal(result.stopped, "cancelled");
	assert.match(result.summary, /last confirmed action: none/);
	assert.equal((await queued)[0].name, result.page.name);
	pending.resolve(reply(call(0)));
	await env.call({ action: "tabs" });
	assert.deepEqual(env.keys, []);
	await env.shutdown();
});

it("cancels a stalled model lookup without blocking the queue or opening a tab later", async () => {
	const started = deferred<void>();
	const pending = deferred<Any[]>();
	const env = setup([], { lookup: async () => { started.resolve(); return await pending.promise; } });
	const controller = new AbortController();
	const running = env.call(task, controller.signal);
	await started.promise;
	controller.abort();
	const result = await running;
	assert.equal(result.stopped, "cancelled");
	assert.equal(result.page.url, "");
	assert.deepEqual(await env.call({ action: "tabs" }), []);
	pending.resolve([{ provider: "anthropic", id: "claude-haiku-5-5", reasoning: true }]);
	assert.deepEqual(await env.call({ action: "tabs" }), []);
	await env.shutdown();
});

it("cancels a queued run without starting it while another run holds the queue", async () => {
	const started = deferred<void>();
	const pending = deferred<Any>();
	const env = setup([], { model: async () => { started.resolve(); return await pending.promise; } });
	const first = new AbortController();
	const running = env.call(task, first.signal);
	await started.promise;
	const second = new AbortController();
	const queued = env.call(task, second.signal);
	second.abort();
	assert.equal((await queued).stopped, "cancelled");
	first.abort();
	await running;
	assert.equal(env.requests.length, 1);
	assert.deepEqual(env.keys, []);
	await env.shutdown();
});

it("cancels a browser wait after the last confirmed action and never runs the following action", async () => {
	const started = deferred<void>();
	const pending = deferred<string>();
	const wait = { type: "toolCall", id: "wait", name: "call", arguments: { action: 1, chain: [{ method: "waitForText", args: ["Never"] }, { method: "press", args: ["extra"] }] } };
	const env = setup([reply(call(0)), reply(wait)], { waitText: async () => { started.resolve(); return await pending.promise; } });
	const controller = new AbortController();
	const running = env.call(task, controller.signal);
	await started.promise;
	controller.abort();
	const result = await running;
	assert.equal(result.stopped, "cancelled");
	assert.match(result.summary, /last confirmed action: first/);
	assert.deepEqual(env.keys, ["0"]);
	pending.resolve("Never");
	assert.equal((await env.call({ action: "tabs" })).length, 1);
	await env.shutdown();
});

it("does not type after cancellation between clearing and typing a field", async () => {
	const controller = new AbortController();
	const fill = { type: "toolCall", id: "fill", name: "call", arguments: { action: 0, chain: [{ method: "id", args: [1] }, { method: "fill", args: ["Ada"] }] } };
	const env = setup([reply(fill)], { afterClear: () => controller.abort() });
	const result = await env.call(task, controller.signal);
	assert.equal(result.stopped, "cancelled");
	assert.deepEqual(env.typed, []);
	await env.shutdown();
});

it("does not retry a failed mutating action or execute the remaining chain", async () => {
	const env = setup([reply({ type: "toolCall", id: "fail", name: "call", arguments: { action: 0, chain: [{ method: "press", args: ["A"] }, { method: "press", args: ["B"] }] } })], { press: async () => { throw new Error("dispatch failed"); } });
	const result = await env.call(task);
	assert.equal(result.stopped, "error");
	assert.match(result.summary, /last confirmed action: none/);
	assert.deepEqual(env.keys, ["A"]);
	assert.equal(env.requests.length, 1);
	await env.shutdown();
});

it("bounds model requests and rejects unsupported methods before actions", async () => {
	const view = (id: number) => ({ type: "toolCall", id: `v${id}`, name: "view", arguments: {} });
	const env = setup(Array.from({ length: 8 }, (_, i) => reply(view(i))));
	const result = await env.call(task);
	assert.equal(result.stopped, "limit");
	assert.doesNotMatch(result.summary, /model|executor/i);
	assert.equal(env.requests.length, 8);
	await env.shutdown();
	const bad = setup([reply({ type: "toolCall", id: "bad", name: "call", arguments: { action: 0, chain: [{ method: "evaluate", args: ["1"] }] } })]);
	assert.equal((await bad.call(task)).stopped, "error");
	assert.deepEqual(bad.keys, []);
	await bad.shutdown();
});

it("finds the existing recording toolbar button whose title includes its shortcut", async () => {
	const globals = globalThis as Any;
	const originalDocument = Object.getOwnPropertyDescriptor(globals, "document");
	let clicked = false;
	const button = { getAttribute: (name: string) => name === "title" ? "Create recording - Ctrl+E" : null, children: [], shadowRoot: null };
	Object.defineProperty(globals, "document", { configurable: true, value: { querySelectorAll: () => [button] } });
	const recorder = {
		keyboard: { down: async () => {}, up: async () => {}, press: async () => {}, type: async () => {} },
		waitForFunction: async (fn: Any, _options: unknown, value: string | boolean) => {
			if (typeof value === "string") {
				const found = fn(value);
				if (!found) throw new Error("Create button not found");
				return { asElement: () => ({ click: async () => { clicked = true; } }), dispose: async () => {} };
			}
			return { dispose: async () => {} };
		},
	};
	try {
		await startRecording({ openDevTools: async () => recorder } as never, new AbortController().signal);
		assert.equal(clicked, true);
	} finally {
		if (originalDocument) Object.defineProperty(globals, "document", originalDocument); else delete globals.document;
	}
});

it("stops a recording that begins after cancellation during startup", async () => {
	const controller = new AbortController();
	const start = deferred<void>();
	const requested = deferred<void>();
	const events: string[] = [];
	let active = false;
	const recorder = {
		keyboard: { down: async () => {}, up: async () => {}, type: async () => {}, press: async (key: string) => {
			if (key === "Enter" && events.includes("Create recording")) { requested.resolve(); controller.abort(); }
		} },
		waitForFunction: async (_fn: Any, _options: unknown, value: string | boolean) => {
			if (value === true) { await start.promise; if (!active) throw new Error("not active"); }
			return { asElement: () => ({ click: async () => { events.push(String(value)); if (value === "End recording") active = false; } }), dispose: async () => {} };
		},
		evaluate: async () => ({ active, toggling: false }),
	};
	const env = setupRun([reply(call(0)), done()], { openDevTools: async () => recorder });
	try {
		const running = env.call({ ...task, actions: ["first"] }, controller.signal);
		await requested.promise;
		const result = await running;
		assert.equal(result.stopped, "cancelled");
		active = true;
		start.resolve();
		await env.call({ action: "tabs" });
		assert.equal(active, false);
		assert.ok(events.includes("End recording"));
		assert.deepEqual(env.keys, []);
	} finally { await env.shutdown(); }
});
