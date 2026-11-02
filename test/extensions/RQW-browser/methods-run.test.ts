import assert from "node:assert/strict";
import { afterEach, it, mock } from "node:test";
import { runInThisContext } from "node:vm";
import { createBrowserExtension } from "../../../extensions/RQW-browser/index.ts";
import { chainCall, done, reply } from "./run-helper.ts";

// A fake browser. The page-side functions of the extension really run, against these fake elements and page globals.

type Any = any;
const globals = globalThis as Any;
const noHandle = { asElement: () => null, dispose: async () => {} };

class FakeElement {
	nodeType = 1;
	tagName = "DIV";
	id = "";
	type = "";
	checked = false;
	disabled = false;
	readOnly = false;
	isConnected = true;
	classList: string[] = [];
	labels: Any[] = [];
	parentElement: Any = null;
	shadowRoot: Any = null;
	attrs: Record<string, string> = {};
	rect = { left: 10, top: 20, right: 110, bottom: 50, width: 100, height: 30 };
	style = { display: "block", visibility: "visible", pointerEvents: "auto", opacity: "1" };
	hit: Any;
	visible = true;
	inViewport = true;
	innerText = "";
	ownerDocument: Any;
	events: string[] = [];
	scrolled = 0;
	focused = 0;
	typed: string[] = [];
	scrolledBy: Any[] = [];
	get box() { return { x: this.rect.left, y: this.rect.top, width: this.rect.width, height: this.rect.height }; }
	matches(selector: string) { return selector === ":disabled" && this.disabled; }
	focus() { this.focused++; }
	closest() { return this; }
	getAttribute(name: string) { return this.attrs[name] ?? null; }
	setAttribute(name: string, value: string) { this.attrs[name] = value; }
	dispatchEvent(event: { type: string }) { this.events.push(event.type); return true; }
	scrollIntoView() { this.scrolled++; }
	scrollBy(options: Any) { this.scrolledBy.push(options); }
	getBoundingClientRect() { return this.rect; }
	getClientRects() { return [this.rect]; }
	getRootNode() { return { host: null }; }
}

class FakeField extends FakeElement {
	tagName = "INPUT";
	#value = "";
	get value() { return this.#value; }
	set value(next: string) { this.#value = next; }
}

class FakeSelect extends FakeElement {
	tagName = "SELECT";
	multiple = false;
	options = [{ value: "a", label: "Alpha", text: "Alpha", index: 0, selected: true }, { value: "b", label: "Bravo", text: "Bravo", index: 1, selected: false }];
	set selectedIndex(index: number) { for (const option of this.options) option.selected = option.index === index; }
	get selectedIndex() { return this.options.findIndex(option => option.selected); }
}

function setup(options: { visible?: boolean; resized?: Any } = {}) {
	const env: Any = {
		url: "about:blank", title: "Title", mouse: [] as Any[], keys: [] as Any[], navigations: [] as Any[], cdp: [] as string[],
		shots: [] as Any[], locatorTimeouts: [] as number[], waits: [] as Any[], brought: 0, focusCalls: [] as string[],
		hangClick: false, hangWheel: false, hangFinalDispose: false, hangResolve: false, hangInspect: false, hangRect: false, hangEvaluate: false, hangPageEvaluate: false, hangFocus: false, hangScreenshot: false, hangDrag: false, neverLoads: false, focusedPage: [] as string[],
		dialogLog: [] as Any[], listeners: {} as Record<string, Any[]>, resizes: [] as Any[],
		selectors: {} as Record<string, Any[]>, childSelectors: {} as Record<string, Any[]>, refs: new Map<string, Any>(), nodes: new Map<number, Any>(),
		pushed: [] as string[], visibility: options.visible === false ? "hidden" : "visible", current: undefined as Any,
		body: { innerText: "" },
		uploads: [] as string[][], chooser: undefined as Any, accepted: [] as string[][], drops: [] as Any[],
	};
	const document = {
		elementFromPoint: () => env.current?.hit ?? env.current,
		documentElement: { scrollWidth: 800, scrollHeight: 1200 },
		body: env.body,
		get visibilityState() { return env.visibility; },
	};
	const history = { state: {}, pushState: (_data: unknown, _unused: string, url: string) => { env.url = url; env.pushed.push(url); } };
	const location = { get href() { return env.url; } };
	class PopStateEvent { type: string; constructor(type: string) { this.type = type; } }
	const pageGlobals: Record<string, unknown> = {
		document, history, location, PopStateEvent, innerWidth: 800, innerHeight: 600, devicePixelRatio: 1, scrollX: 0, scrollY: 0,
		getComputedStyle: (element: Any) => ({ ...element.style, getPropertyValue: (name: string) => element.style[name] ?? "" }),
		dispatchEvent: () => true,
		requestAnimationFrame: (callback: () => void) => callback(),
		DataTransfer: class { items = { files: [] as Any[], add(file: Any) { this.files.push(file); } }; },
		File: globals.File,
		DragEvent: class { type: string; init: Any; constructor(type: string, init: Any) { this.type = type; this.init = init; env.drops.push([type, init.dataTransfer.items.files.map((file: Any) => [file.name, file.type, file.size])]); } },
	};
	// The globals stay in place until an async page function has finished too.
	function withPage<T>(node: Any, work: () => T): T {
		const saved: Record<string, unknown> = {};
		for (const key of Object.keys(pageGlobals)) { saved[key] = globals[key]; globals[key] = pageGlobals[key]; }
		env.current = node;
		const restore = () => {
			env.current = undefined;
			for (const key of Object.keys(pageGlobals)) { if (saved[key] === undefined) delete globals[key]; else globals[key] = saved[key]; }
		};
		let result: T;
		try {
			result = work();
		} catch (error) {
			restore();
			throw error;
		}
		if (result instanceof Promise) return result.finally(restore) as T;
		restore();
		return result;
	}
	const unwrap = (value: Any) => value?.node ?? value;
	const framePage = { page: () => page };
	function handleOf(node: Any): Any {
		const handle: Any = {
			node, disposed: 0, frame: framePage,
			asElement: () => handle,
			evaluate: async (fn: Any, ...args: Any[]) => {
				if (env.hangEvaluate) await new Promise(() => {});
				return withPage(node, () => fn(node, ...args));
			},
			evaluateHandle: async (fn: Any, ...args: Any[]) => {
				if (env.hangInspect) await new Promise(() => {});
				const found = withPage(node, () => fn(node, ...args.map(unwrap)));
				const result = found ? handleOf(found) : noHandle;
				// The handle an observed id resolves to is the one a call hands back, so it can be made to never dispose.
				if (found) result.hangDispose = env.hangFinalDispose;
				// The ancestor exists; measuring it is what never answers.
				if (env.hangRect) env.hangEvaluate = true;
				return result;
			},
			boundingBox: async () => node.box,
			isVisible: async () => node.visible,
			isIntersectingViewport: async () => node.inViewport,
			hover: async () => { env.mouse.push(["hover", node]); },
			focus: async () => { node.focused++; if (env.hangFocus) await new Promise(() => {}); },
			uploadFile: async (...paths: string[]) => { env.uploads.push(paths); },
			type: async (text: string) => { node.typed.push(text); if ("value" in node) node.value += text; },
			screenshot: async (shot: Any) => { env.shots.push(["element", shot, node.scrolled]); if (env.hangScreenshot) await new Promise(() => {}); return new Uint8Array([1, 2, 3]); },
			contentFrame: async () => node.contentFrame ?? null,
			dispose: async () => { handle.disposed++; if (handle.hangDispose) await new Promise(() => {}); },
		};
		env.handles.push(handle);
		return handle;
	}
	env.handles = [] as Any[];
	function scopeOf(map: () => Record<string, Any[]>) {
		return {
			$: async (selector: string) => {
				if (env.hangResolve) await new Promise(() => {});
				return map()[selector]?.[0] ? handleOf(map()[selector]![0]) : null;
			},
			$$: async (selector: string) => (map()[selector] ?? []).map(handleOf),
			focus: async (selector: string) => {
				if (!map()[selector]?.length) throw new Error(`No element matches selector: ${selector}`);
				env.focusedPage.push(selector);
			},
			locator: (selector: string) => ({
				setTimeout(ms: number) { env.locatorTimeouts.push(ms); return this; },
				waitHandle: ({ signal }: { signal: AbortSignal }) => new Promise((resolve, reject) => {
					const node = map()[selector]?.[0];
					if (node) return resolve(handleOf(node));
					signal.addEventListener("abort", () => reject(signal.reason), { once: true });
				}),
			}),
			waitForSelector: async (selector: string, waitOptions: Any) => {
				env.waits.push([selector, waitOptions]);
				const node = map()[selector]?.[0];
				if (!node && !waitOptions.hidden) { const error = new Error("Waiting failed"); error.name = "TimeoutError"; throw error; }
				return node ? handleOf(node) : null;
			},
		};
	}
	const child: Any = {
		evaluate: async (source: string) => { if (env.hangPageEvaluate) await new Promise(() => {}); return withPage(undefined, () => runInThisContext(source)); },
		...scopeOf(() => env.childSelectors), name: () => "pay", url: () => "https://pay.test/", childFrames: () => [],
		_lifecycleEvents: new Set<string>(), detached: false, client: { on() {} }, accessibility: { snapshot: async () => null },
	};
	const main: Any = {
		...scopeOf(() => env.selectors), _loaderId: "loader-1", _lifecycleEvents: new Set(["load", "DOMContentLoaded"]), detached: false,
		client: { on(event: string, listener: Any) { (env.listeners[event] ??= []).push(listener); } }, childFrames: () => [],
		evaluate: async () => ({ values: [], partial: false }),
		accessibility: {
			snapshot: async () => ({
				role: "RootWebArea", name: "App", backendNodeId: 1, loaderId: main._loaderId,
				children: [
					{ role: "textbox", name: "Name", backendNodeId: 4, loaderId: main._loaderId, children: [] },
					{ role: "button", name: "Save", backendNodeId: 5, loaderId: main._loaderId, children: [] },
				],
			}),
		},
		mainRealm: () => ({
			adoptHandle: async (handle: Any) => handleOf(handle.node),
			adoptBackendNode: async (backendId: number) => handleOf(env.nodes.get(backendId)),
		}),
		isolatedRealm: () => ({
			evaluateHandle: async (_fn: Any, ref: string) => (env.refs.has(ref) ? handleOf(env.refs.get(ref)) : noHandle),
		}),
	};
	function navigated(loads = !env.neverLoads) {
		main._loaderId = `loader-${Number(main._loaderId.slice(7)) + 1}`;
		main._lifecycleEvents = new Set(loads ? ["load", "DOMContentLoaded"] : []);
		for (const node of env.nodes.values()) node.isConnected = false;
	}
	const page: Any = {
		...scopeOf(() => env.selectors),
		mainFrame: () => main, frames: () => [main, child], browserContext: () => ({}), url: () => env.url, title: async () => env.title,
		accessibility: main.accessibility, isClosed: () => false, browser: () => ({ connected: true }),
		goto: async (url: string, gotoOptions: Any) => { env.navigations.push(["goto", url, gotoOptions]); env.url = url; navigated(); },
		goBack: async (o: Any) => { env.navigations.push(["back", o]); navigated(); },
		goForward: async (o: Any) => { env.navigations.push(["forward", o]); navigated(); },
		reload: async (o: Any) => { env.navigations.push(["reload", o]); navigated(); },
		evaluate: async (fn: Any, ...args: Any[]) => { if (env.hangPageEvaluate) await new Promise(() => {}); return withPage(undefined, () => typeof fn === "string" ? runInThisContext(fn) : fn(...args)); },
		waitForFunction: async (fn: Any, waitOptions: Any, ...args: Any[]) => {
			env.waits.push(["function", waitOptions, ...args]);
			if (!withPage(undefined, () => fn(...args))) { const error = new Error("Waiting failed"); error.name = "TimeoutError"; throw error; }
		},
		createCDPSession: async () => ({ send: async (method: string) => { env.cdp.push(method); }, detach: async () => {} }),
		bringToFront: async () => { env.brought++; },
		waitForFileChooser: async () => {
			if (!env.chooser) { const error = new Error("Waiting failed"); error.name = "TimeoutError"; throw error; }
			return { accept: async (paths: string[]) => { env.accepted.push(paths); } };
		},
		screenshot: async (shot: Any) => { env.shots.push(["page", shot]); return new Uint8Array([1, 2, 3]); },
		mouse: {
			click: async (x: number, y: number, o: Any) => { if (env.hangClick) await new Promise(() => {}); env.mouse.push(["click", x, y, o]); },
			move: async (x: number, y: number, o: Any) => { env.mouse.push(["move", x, y, o]); if (env.hangDrag && o?.steps) await new Promise(() => {}); },
			down: async (o: Any) => { env.mouse.push(["down", o]); },
			up: async (o: Any) => { env.mouse.push(["up", o]); },
			wheel: async (o: Any) => { if (env.hangWheel) await new Promise(() => {}); env.mouse.push(["wheel", o]); },
		},
		keyboard: {
			down: async (key: string) => { env.keys.push(["down", key]); },
			up: async (key: string) => { env.keys.push(["up", key]); },
			press: async (key: string, o: Any) => { env.keys.push(["press", key, o]); },
		},
		on: (event: string, listener: Any) => { (env.listeners[event] ??= []).push(listener); },
		off: (event: string, listener: Any) => { env.listeners[event] = (env.listeners[event] ?? []).filter((l: Any) => l !== listener); },
	};
	const browser = { target: () => ({ createCDPSession: async () => ({ send: async () => {}, on() {}, off() {}, detach: async () => {} }) }), newPage: async () => page, close: async () => {}, disconnect: async () => {} };
	let tool: Any;
	createBrowserExtension({
		load: async () => ({ launch: async () => browser, connect: async () => browser, Puppeteer: { customQueryHandlerNames: () => [], registerCustomQueryHandler() {} } }) as never,
		findSystemChrome: () => "/chrome",
		resizeImage: async (bytes, mimeType) => {
			env.resizes.push([bytes, mimeType]);
			return options.resized === undefined ? { data: "AQID", mimeType, width: 800, height: 600, originalWidth: 1600, originalHeight: 1200 } : options.resized;
		},
	})({ registerTool: (value: unknown) => { tool = value; }, on: () => {} } as never);
	const responses: Any[] = [];
	const requests: Any[] = [];
	const ctx = { model: { provider: "anthropic" }, modelRegistry: {
		getAvailableOfType: async () => [{ provider: "anthropic", id: "claude-haiku-5-5", reasoning: true }],
		streamSimple(_model: Any, context: Any) {
			requests.push(structuredClone(context));
			return { result: async () => { env.beforeReply?.(); return responses.shift(); } };
		},
	} };
	async function full(input: unknown, signal?: AbortSignal) { return await tool.execute("id", input, signal, undefined, ctx); }
	async function runSteps(steps: Array<{ method: string; args: unknown[] }>, signal?: AbortSignal, options: Record<string, unknown> = {}) {
		responses.splice(0, responses.length, reply(chainCall(steps)), done());
		return await call({ action: "run", name: "main", actions: ["perform action"], expected: "done", record: false, ...options }, signal);
	}
	async function call(input: unknown, signal?: AbortSignal) { return (await full(input, signal)).details.value; }
	const element = <T extends FakeElement>(node: T): T => { node.ownerDocument = document; return node; };
	const emit = (event: string, value: unknown) => { for (const listener of env.listeners[event] ?? []) listener(value); };
	return { env, tool, full, call, runSteps, requests, element, emit, page, main, child, navigated, description: () => tool.description as string };
}

const environments: Array<ReturnType<typeof setup>> = [];
async function opened(options: Any = {}, open: Record<string, unknown> = {}) {
	const env = setup(options);
	environments.push(env);
	await env.call({ action: "open", ...open });
	return env;
}

afterEach(async () => {
	mock.restoreAll();
	mock.timers.reset();
	for (const env of environments.splice(0)) await env.call({ action: "close", all: true });
});

it("runs element methods against ids from the executor view", async () => {
	const env = await opened();
	const field = env.element(new FakeField());
	field.value = "old";
	env.env.nodes.set(4, field);
	const filled = await env.runSteps([{ method: "id", args: [1] }, { method: "fill", args: ["Ada"] }]);
	assert.equal(filled.stopped, null);
	assert.equal(field.value, "Ada");
	const typed = await env.runSteps([{ method: "id", args: [1] }, { method: "type", args: ["!"] }]);
	assert.equal(typed.stopped, null);
	assert.equal(field.value, "Ada!");
	await env.runSteps([{ method: "id", args: [1] }, { method: "value", args: [] }]);
	assert.match(env.requests.at(-1).messages.at(-1).content[0].text, /Ada!/);
	field.disabled = true;
	const refused = await env.runSteps([{ method: "id", args: [1] }, { method: "fill", args: ["bad"] }]);
	assert.equal(refused.stopped, "error");
	assert.match(refused.summary, /disabled/);
	assert.equal(field.value, "Ada!");
	field.disabled = false;
	field.readOnly = true;
	const readonly = await env.runSteps([{ method: "id", args: [1] }, { method: "type", args: ["bad"] }]);
	assert.equal(readonly.stopped, "error");
	assert.match(readonly.summary, /read-only/);
	field.readOnly = false;
	const cleared = await env.runSteps([{ method: "id", args: [1] }, { method: "fill", args: [""] }]);
	assert.equal(cleared.stopped, null);
	assert.equal(field.value, "");
	assert.deepEqual(field.events, ["input", "change"]);
});

it("runs navigation and keyboard methods through run", async () => {
	const env = await opened();
	const navigation = await env.runSteps([{ method: "goto", args: ["https://b.test/"] }]);
	assert.equal(navigation.stopped, null);
	assert.equal(navigation.page.url, "https://b.test/");
	const keys = await env.runSteps([{ method: "press", args: ["Shift+Tab"] }]);
	assert.equal(keys.stopped, null);
	assert.deepEqual(env.env.keys, [["down", "Shift"], ["press", "Tab", undefined], ["up", "Shift"]]);
});

it("selects a value and refuses an unknown option through run", async () => {
	const env = await opened();
	const select = env.element(new FakeSelect());
	env.env.nodes.set(4, select);
	const selected = await env.runSteps([{ method: "id", args: [1] }, { method: "select", args: ["Bravo"] }]);
	assert.equal(selected.stopped, null);
	assert.equal(select.selectedIndex, 1);
	const refused = await env.runSteps([{ method: "id", args: [1] }, { method: "select", args: ["missing"] }]);
	assert.equal(refused.stopped, "error");
	assert.match(refused.summary, /No <select> option matches/);
	assert.equal(select.selectedIndex, 1);
});

it("reads element text and state through the executor", async () => {
	const env = await opened();
	const field = env.element(new FakeField());
	field.innerText = "hello";
	field.type = "checkbox";
	field.checked = true;
	env.env.nodes.set(4, field);
	for (const [method, value] of [["text", "hello"], ["isVisible", true], ["isEnabled", true], ["isChecked", true]] as const) {
		const result = await env.runSteps([{ method: "id", args: [1] }, { method, args: [] }]);
		assert.equal(result.stopped, null);
		const output = JSON.parse(env.requests.at(-1).messages.at(-1).content[0].text);
		assert.equal(output.value, value);
	}
});

async function advance<T>(promise: Promise<T>): Promise<T> {
	let settled = false;
	void promise.finally(() => { settled = true; }).catch(() => {});
	while (!settled) {
		await new Promise<void>(resolve => setImmediate(resolve));
		mock.timers.tick(100);
	}
	return await promise;
}

it("clicks, checks and unchecks an observed control", async () => {
	const env = await opened();
	const box = env.element(new FakeField());
	box.type = "checkbox";
	env.env.nodes.set(4, box);
	mock.timers.enable({ apis: ["setTimeout", "Date"] });
	const setTimer = globalThis.setTimeout;
	mock.method(globalThis, "setTimeout", ((callback: (...args: any[]) => void, delay?: number, ...args: any[]) => {
		const timer = setTimer(callback, delay, ...args);
		if (delay === 16 || delay === 34) setImmediate(() => mock.timers.tick(delay));
		return timer;
	}) as typeof setTimeout);
	for (const [method, state, clicks] of [["click", false, 1], ["check", true, 2], ["check", true, 2], ["uncheck", false, 3]] as const) {
		const result = await env.runSteps([{ method: "id", args: [1] }, { method, args: [] }]);
		assert.equal(result.stopped, null);
		assert.equal(box.checked, state);
		assert.equal(env.env.mouse.length, clicks);
	}
	const banner = env.element(new FakeElement());
	banner.id = "banner";
	box.hit = banner;
	const refused = await env.runSteps([{ method: "id", args: [1] }, { method: "click", args: [] }]);
	assert.equal(refused.stopped, "error");
	assert.match(refused.summary, /covered by <div#banner>/);
	assert.equal(env.env.mouse.length, 3);
});

it("focuses an observed element before pressing a key", async () => {
	const env = await opened();
	const field = env.element(new FakeField());
	env.env.nodes.set(4, field);
	const result = await env.runSteps([{ method: "id", args: [1] }, { method: "press", args: ["Enter"] }]);
	assert.equal(result.stopped, null);
	assert.equal(field.focused, 1);
	assert.deepEqual(env.env.keys, [["press", "Enter", undefined]]);
});

it("refuses an id whose document changes before the action", async () => {
	const env = await opened();
	const field = env.element(new FakeField());
	env.env.nodes.set(4, field);
	env.env.beforeReply = () => { env.main._loaderId = "new-document"; };
	const result = await env.runSteps([{ method: "id", args: [1] }, { method: "fill", args: ["Ada"] }]);
	assert.equal(result.stopped, "error");
	assert.match(result.summary, /stale/);
	assert.equal(field.value, "");
});

it("refuses an observed id after a back-forward cache restore", async () => {
	const env = await opened();
	const field = env.element(new FakeField());
	env.env.nodes.set(4, field);
	env.env.beforeReply = () => env.emit("Page.frameNavigated", { type: "BackForwardCacheRestore" });
	const result = await env.runSteps([{ method: "id", args: [1] }, { method: "fill", args: ["Ada"] }]);
	assert.equal(result.stopped, "error");
	assert.match(result.summary, /Unknown element id/);
	assert.equal(field.value, "");
});

it("refuses an observed element that was removed or moved to another document", async () => {
	for (const change of ["removed", "moved"]) {
		const env = await opened();
		const field = env.element(new FakeField());
		env.env.nodes.set(4, field);
		env.env.beforeReply = () => {
			if (change === "removed") field.isConnected = false;
			else field.ownerDocument = {};
		};
		const result = await env.runSteps([{ method: "id", args: [1] }, { method: "fill", args: ["Ada"] }]);
		assert.equal(result.stopped, "error", change);
		assert.match(result.summary, /stale/);
		assert.equal(field.value, "");
	}
});

it("cancels a stalled element action and releases the queue", async () => {
	const env = await opened();
	const field = env.element(new FakeField());
	env.env.nodes.set(4, field);
	env.env.hangEvaluate = true;
	const controller = new AbortController();
	const running = env.runSteps([{ method: "id", args: [1] }, { method: "fill", args: ["Ada"] }], controller.signal);
	let finished = false;
	void running.finally(() => { finished = true; });
	while (env.env.handles.length < 2 && !finished) await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(finished, false, "the element action must start before cancellation");
	controller.abort();
	const result = await running;
	assert.equal(result.stopped, "cancelled");
	assert.equal(field.value, "");
	assert.equal((await env.call({ action: "tabs" })).length, 1);
});

it("does not wait for a finished handle to be disposed", async () => {
	const env = await opened();
	const field = env.element(new FakeField());
	env.env.nodes.set(4, field);
	env.env.hangFinalDispose = true;
	const result = await env.runSteps([{ method: "id", args: [1] }, { method: "fill", args: ["Ada"] }]);
	assert.equal(result.stopped, null);
	assert.equal(field.value, "Ada");
});

it("times out an exact text wait that only partially matches", async () => {
	const env = await opened();
	let textRead = false;
	Object.defineProperty(env.env.body, "innerText", { get: () => { textRead = true; return "All Saved now"; } });
	mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
	const running = env.runSteps([{ method: "waitForText", args: ["Saved", { exact: true, timeout: 300 }] }]);
	while (!textRead) await new Promise<void>(resolve => setImmediate(resolve));
	mock.timers.tick(300);
	const result = await running;
	assert.equal(result.stopped, "error");
	assert.match(result.summary, /waitForText.*timed out after 300ms/);
});

it("stops a navigation that exceeds the run budget", async () => {
	const env = await opened();
	env.env.neverLoads = true;
	mock.timers.enable({ apis: ["setTimeout", "Date"] });
	const result = await advance(env.runSteps([{ method: "goto", args: ["https://slow.test/"] }], undefined, { timeout: 1 }));
	assert.equal(result.stopped, "error");
	assert.match(result.summary, /pending navigation stopped/);
	assert.deepEqual(env.env.cdp, ["Page.stopLoading"]);
});

it("honors the open dialog policy and stops listening on close", async () => {
	const env = await opened({}, { dialogs: "accept" });
	const log: string[] = [];
	env.emit("dialog", { type: () => "confirm", message: () => "Continue?", accept: async () => { log.push("accept"); }, dismiss: async () => { log.push("dismiss"); } });
	assert.deepEqual(log, ["accept"]);
	await env.call({ action: "close" });
	assert.equal(env.env.listeners.dialog.length, 0);
});

it("takes a visible screenshot without focusing a foreign tab", async () => {
	const shown = await opened({}, { app: { cdp_url: "http://localhost:9222" } });
	const result = await shown.full({ action: "screenshot" });
	assert.equal(result.content[1].mimeType, "image/png");
	assert.equal(shown.env.brought, 0);
	const hidden = await opened({ visible: false }, { app: { cdp_url: "http://localhost:9222" } });
	await assert.rejects(hidden.full({ action: "screenshot" }), /attached browser tab is not visible/);
	const large = await opened({ resized: null });
	await assert.rejects(large.full({ action: "screenshot" }), /too large to return as an image/);
});

it("runs history navigation and waits through run", async () => {
	const env = await opened();
	env.env.url = "https://example.test/done";
	env.env.body.innerText = "Saved";
	for (const method of ["back", "forward", "reload"]) {
		const result = await env.runSteps([{ method, args: [] }]);
		assert.equal(result.stopped, null);
	}
	assert.deepEqual(env.env.navigations.map((entry: Any) => entry[0]), ["back", "forward", "reload"]);
	for (const [method, value] of [["waitForUrl", "/done"], ["waitForText", "Saved"]]) {
		const result = await env.runSteps([{ method, args: [value] }]);
		assert.equal(result.stopped, null);
	}
});
