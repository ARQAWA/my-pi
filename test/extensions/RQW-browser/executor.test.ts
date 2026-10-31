import assert from "node:assert/strict";
import { it } from "node:test";
import { createBrowserExtension } from "../../../extensions/RQW-browser/index.ts";

type Any = any;
function setup(replies: Any[], options: { incomplete?: boolean; disabled?: boolean; dom?: Any; lookup?: () => Promise<Any[]>; model?: (index: number, signal: AbortSignal) => Promise<Any>; press?: (key: string) => Promise<void>; waitText?: () => Promise<string>; afterClear?: () => void } = {}) {
	let tool: Any;
	let shutdown: Any;
	let url = "about:blank";
	const keys: string[] = [];
	const typed: string[] = [];
	const requests: Any[] = [];
	const main: Any = { _loaderId: "loader", url: () => url, client: { on() {} }, childFrames: () => options.incomplete ? [child] : [], _lifecycleEvents: new Set(["load"]), detached: false };
	const child: Any = { url: () => "https://frame.test", childFrames: () => [], accessibility: { snapshot: async () => null } };
	main.evaluate = async (fn: () => unknown) => {
		if (!options.dom) return { values: [keys.length === 3 ? "Done" : "Ready"], partial: false };
		const globals = globalThis as Any;
		const previous = { document: globals.document, getComputedStyle: globals.getComputedStyle, HTMLSlotElement: globals.HTMLSlotElement };
		globals.document = { body: options.dom, createRange: () => {
			let node: Any;
			return { selectNodeContents(value: Any) { node = value; }, getBoundingClientRect: () => ({ left: node.x ?? 0, right: (node.x ?? 0) + (node.width ?? 1), top: 0, bottom: 1, width: node.width ?? 1, height: 1 }) };
		} };
		globals.getComputedStyle = (element: Any) => ({ display: element.display ?? "inline", visibility: "visible", opacity: element.opacity ?? "1", overflowX: element.overflowX ?? "visible", overflowY: "visible" });
		globals.HTMLSlotElement = class {};
		try { return fn(); } finally { Object.assign(globals, previous); }
	};
	main.mainRealm = () => ({ adoptBackendNode: async (id: number) => {
		assert.equal(id, 2);
		const element = { asElement: () => element, isVisible: async () => true, dispose: async () => {},
			evaluate: (_fn: Any, ...args: Any[]) => {
				if (args.length && options.afterClear) queueMicrotask(() => queueMicrotask(() => options.afterClear!()));
				return Promise.resolve(null);
			},
			type: async (value: string) => { typed.push(value); },
		};
		return { evaluateHandle: async () => element, dispose: async () => {} };
	} });
	const page: Any = {
		mainFrame: () => main, browserContext: () => ({}), url: () => url, title: async () => "Form",
		goto: async (value: string) => { url = value; }, isClosed: () => false, browser: () => ({ connected: true }), on() {}, off() {},
		keyboard: { press: async (key: string) => { keys.push(key); await options.press?.(key); }, down: async () => {}, up: async () => {} },
		accessibility: { snapshot: async () => ({ role: "RootWebArea", name: "Form", loaderId: "loader", backendNodeId: 1, children: [
			{ role: "button", name: "Submit", disabled: options.disabled, loaderId: "loader", backendNodeId: 2 },
			{ role: "StaticText", name: keys.length === 3 ? "Done" : "Ready", loaderId: "loader", backendNodeId: 3 },
		] }) },
		evaluate: async (fn: Any) => options.waitText && String(fn).includes("innerText") ? await options.waitText() : ({ viewport: {}, scroll: {} }),
	};
	const browser = { target: () => ({ createCDPSession: async () => ({ send: async () => {}, on() {}, off() {}, detach: async () => {} }) }), newPage: async () => page, close: async () => {} };
	createBrowserExtension({ findSystemChrome: () => "/chrome", load: async () => ({ launch: async () => browser, Puppeteer: { customQueryHandlerNames: () => [], registerCustomQueryHandler() {} } }) as never })({ registerTool(value: Any) { tool = value; }, on(event: string, fn: Any) { if (event === "session_shutdown") shutdown = fn; } } as never);
	const ctx = { model: { provider: "anthropic" }, modelRegistry: {
		getAvailableOfType: async () => options.lookup ? await options.lookup() : [{ provider: "anthropic", id: "claude-haiku-5-5", reasoning: true }],
		streamSimple(model: Any, context: Any, streamOptions: Any) { requests.push(structuredClone({ model, context, reasoning: streamOptions.reasoning })); return { result: async () => options.model ? await options.model(requests.length - 1, streamOptions.signal) : replies.shift() }; },
	} };
	return { keys, typed, requests, shutdown: () => shutdown(), async call(input: Any, signal?: AbortSignal) { return (await tool.execute("id", input, signal, undefined, ctx)).details.value; } };
}
const task = { action: "run", url: "https://local.test", actions: ["first", "second", "third"], expected: "Done" };
const call = (id: number, action = id) => ({ type: "toolCall", id: `call-${id}`, name: "call", arguments: { action, chain: [{ method: "press", args: [String(id)] }] } });
const reply = (...content: Any[]) => ({ role: "assistant", api: "test", provider: "anthropic", model: "claude-haiku-5-5", content, stopReason: content.some(part => part.type === "toolCall") ? "toolUse" : "stop", timestamp: 0, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
const done = () => reply({ type: "text", text: JSON.stringify({ result: "Done visible", reached: true }) });

it("executes the ordered actions in an isolated model context and observes the result", async () => {
	const env = setup([reply(call(0), call(1), call(2)), reply(call(1)), reply(call(2)), done()]);
	const result = await env.call(task);
	assert.deepEqual(env.keys, ["0", "1", "2"]);
	assert.equal(result.reached, true);
	assert.equal(result.stopped, null);
	assert.match(result.page.summary, /Done/);
	assert.match(result.page.name, /^run-/);
	assert.equal(env.requests[0].reasoning, "medium");
	assert.deepEqual(env.requests[0].context.tools.map((item: Any) => item.name), ["view", "call"]);
	assert.deepEqual(env.requests[0].context.messages.map((item: Any) => item.role), ["user"]);
	assert.equal(env.requests[0].context.sessionId, undefined);
	assert.match(env.requests[1].context.messages.at(-1).content[0].text, /Not executed/);
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
	await early.shutdown();
	const incomplete = setup([reply(call(0)), reply(call(1)), reply(call(2)), done()], { incomplete: true });
	const result = await incomplete.call(task);
	assert.deepEqual(incomplete.keys, ["0", "1", "2"]);
	assert.equal(result.reached, false);
	assert.equal(result.stopped, "limit");
	await incomplete.shutdown();
});

it("translates short model ids to current browser ids and returns usable browser ids", async () => {
	const inspect = { type: "toolCall", id: "inspect", name: "call", arguments: { action: 0, chain: [{ method: "id", args: ["1"] }, { method: "isVisible", args: [] }] } };
	const env = setup([reply(inspect), done()]);
	const result = await env.call({ ...task, actions: ["inspect Submit"] });
	assert.equal(result.stopped, null);
	assert.equal(result.reached, true);
	const id = Number(result.page.summary.match(/button: Submit \[id:(\d+)\]/)[1]);
	assert.ok(id > 1);
	assert.equal(await env.call({ action: "call", name: result.page.name, chain: [{ method: "id", args: [id] }, { method: "isVisible", args: [] }] }), true);
	assert.match(env.requests[0].context.messages[0].content, /\[id:1\]/);
	assert.deepEqual(env.requests[1].context.messages[1].content[0].arguments.chain[0].args, ["1"]);
	await env.shutdown();
});

it("rejects ids from an older view instead of acting on a new element", async () => {
	const inspect = (id: string, action: number) => ({ type: "toolCall", id, name: "call", arguments: { action, chain: [{ method: "id", args: [1] }, { method: "isVisible", args: [] }] } });
	const env = setup([reply(inspect("first", 0)), reply(inspect("second", 1))]);
	const result = await env.call({ ...task, actions: ["inspect first", "inspect second"] });
	assert.equal(result.stopped, "error");
	assert.match(result.result, /Target is not in the current view.*last confirmed action: inspect first/);
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
		[[{ method: "press", args: ["A"] }, { method: "text", args: ["button"] }], /Element actions and reads require a target/],
		[[{ method: "press", args: ["A"] }, { method: "id", args: [1] }, { method: "isVisible", args: [] }], /changed page requires a fresh view/],
	] as const) {
		const attempt = { type: "toolCall", id: "bad", name: "call", arguments: { action: 0, chain } };
		const env = setup([reply(attempt)]);
		const result = await env.call(task);
		assert.equal(result.stopped, "error");
		assert.match(result.result, error);
		assert.deepEqual(env.keys, []);
		await env.shutdown();
	}
});

it("refuses a chain that uses a target after navigation", async () => {
	const navigation = { type: "toolCall", id: "nav", name: "call", arguments: { action: 0, chain: [{ method: "goto", args: ["https://other.test"] }, { method: "id", args: [1] }, { method: "isVisible", args: [] }] } };
	const env = setup([reply(navigation)]);
	const result = await env.call(task);
	assert.equal(result.stopped, "error");
	assert.match(result.result, /Navigation must be followed by a fresh view/);
	assert.equal(await env.call({ action: "call", name: result.page.name, chain: [{ method: "url", args: [] }] }), "https://local.test");
	await env.shutdown();
});

it("limits changing operations before executing a chain", async () => {
	const excess = { type: "toolCall", id: "excess", name: "call", arguments: { action: 0, chain: Array.from({ length: 25 }, () => ({ method: "press", args: ["A"] })) } };
	const env = setup([reply(excess)]);
	assert.equal((await env.call(task)).stopped, "limit");
	assert.deepEqual(env.keys, []);
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
	assert.match(result.result, /last confirmed action: none/);
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
	assert.match(result.result, /last confirmed action: first/);
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
	assert.match(result.result, /last confirmed action: none/);
	assert.deepEqual(env.keys, ["A"]);
	assert.equal(env.requests.length, 1);
	await env.shutdown();
});

it("bounds model requests and rejects unsupported methods before actions", async () => {
	const view = (id: number) => ({ type: "toolCall", id: `v${id}`, name: "view", arguments: {} });
	const env = setup(Array.from({ length: 8 }, (_, i) => reply(view(i))));
	assert.equal((await env.call(task)).stopped, "limit");
	assert.equal(env.requests.length, 8);
	await env.shutdown();
	const bad = setup([reply({ type: "toolCall", id: "bad", name: "call", arguments: { action: 0, chain: [{ method: "evaluate", args: ["1"] }] } })]);
	assert.equal((await bad.call(task)).stopped, "error");
	assert.deepEqual(bad.keys, []);
	await bad.shutdown();
});
