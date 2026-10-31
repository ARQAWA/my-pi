import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, it, mock } from "node:test";
import { runInThisContext } from "node:vm";
import { createBrowserExtension } from "../../../extensions/RQW-browser/index.ts";

// A fake browser. The page-side functions of the extension really run, against these fake elements and page globals.

type Any = any;
const globals = globalThis as Any;
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
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
	options = [{ value: "a", label: "Alpha", text: "Alpha", index: 0, selected: true }, { value: "b", label: "Bravo", text: " Bravo ", index: 1, selected: false }];
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
		client: { on() {} }, childFrames: () => [child],
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
	async function full(input: unknown, signal?: AbortSignal) { return await tool.execute("id", input, signal, undefined, {}); }
	async function call(input: unknown, signal?: AbortSignal) { return (await full(input, signal)).details.value; }
	const chain = (...steps: Array<[string, ...unknown[]]>) => ({ action: "call", chain: steps.map(([method, ...args]) => ({ method, args })) });
	const element = <T extends FakeElement>(node: T): T => { node.ownerDocument = document; return node; };
	const emit = (event: string, value: unknown) => { for (const listener of env.listeners[event] ?? []) listener(value); };
	return { env, tool, full, call, chain, element, emit, page, main, child, navigated, description: () => tool.description as string };
}

const environments: Array<ReturnType<typeof setup>> = [];
async function opened(options: Any = {}, open: Record<string, unknown> = {}) {
	const env = setup(options);
	environments.push(env);
	await env.call({ action: "open", ...open });
	return env;
}

afterEach(async () => {
	mock.timers.reset();
	for (const env of environments.splice(0)) await env.call({ action: "close", all: true });
});

/** Run `promise` to its end while advancing mocked time, so deadlines and polls elapse at once. */
async function elapse<T>(promise: Promise<T>, step = 100): Promise<T> {
	let done = false;
	const settled = promise.finally(() => { done = true; });
	settled.catch(() => {});
	while (!done) {
		await tick();
		mock.timers.tick(step);
	}
	return await settled;
}

const mockTime = () => mock.timers.enable({ apis: ["setTimeout", "Date"] });

it("reads computed styles by selector and element reference", async () => {
	const env = await opened();
	const node = env.element(new FakeElement());
	env.env.selectors["#item"] = [node];
	env.env.refs.set("e1", node);
	assert.deepEqual(await env.call(env.chain(["styles", "#item", ["display", "opacity"]])), { display: "block", opacity: "1" });
	assert.equal((await env.call(env.chain(["ref", "e1"], ["styles"]))).display, "block");
	assert.equal(await env.call(env.chain(["styles", "#missing"])), null);
});

it("evaluates expressions and function sources in tabs and frames", async () => {
	const env = await opened();
	const owner = env.element(new FakeElement());
	owner.contentFrame = env.child;
	env.env.selectors["#frame"] = [owner];
	assert.equal(await env.call(env.chain(["evaluate", "1 + 2"])), 3);
	assert.equal(await env.call(env.chain(["evaluate", "(a, b) => a + b", 2, 5])), 7);
	assert.equal(await env.call(env.chain(["frame", "#frame"], ["evaluate", "(x) => x * 2", 4])), 8);
	await assert.rejects(env.call(env.chain(["evaluate", 1])), /expression string/);
});

it("screenshots an element inside a frame and presses keys on references", async () => {
	const env = await opened();
	const owner = env.element(new FakeElement());
	const node = env.element(new FakeElement());
	owner.contentFrame = env.child;
	env.env.selectors["#frame"] = [owner];
	env.env.childSelectors["#child"] = [node];
	env.env.refs.set("e1", node);
	const result = await env.full(env.chain(["frame", "#frame"], ["screenshot", "#child"]));
	assert.deepEqual(result.content[1], { type: "image", data: "AQID", mimeType: "image/png" });
	assert.equal(env.env.shots[0][0], "element");
	await assert.rejects(env.full(env.chain(["frame", "#frame"], ["screenshot"])), /requires an element selector/);
	await assert.rejects(env.full(env.chain(["frame", "#frame"], ["screenshot", ""])), /requires an element selector/);
	assert.equal(env.env.shots.length, 1);
	await env.call(env.chain(["ref", "e1"], ["press", "Shift+Tab"]));
	assert.equal(node.focused, 1);
	assert.deepEqual(env.env.keys, [["down", "Shift"], ["press", "Tab", undefined], ["up", "Shift"]]);
});

it("cancels stalled new methods and keeps the queue usable", async () => {
	const env = await opened();
	const owner = env.element(new FakeElement());
	const node = env.element(new FakeElement());
	owner.contentFrame = env.child;
	env.env.selectors["#frame"] = [owner];
	env.env.selectors["#item"] = [node];
	env.env.childSelectors["#item"] = [node];
	env.env.refs.set("e1", node);
	for (const [flag, steps] of [
		["hangEvaluate", [["styles", "#item"]]],
		["hangEvaluate", [["ref", "e1"], ["styles"]]],
		["hangPageEvaluate", [["evaluate", "1"]]],
		["hangPageEvaluate", [["frame", "#frame"], ["evaluate", "1"]]],
		["hangScreenshot", [["frame", "#frame"], ["screenshot", "#item"]]],
		["hangFocus", [["ref", "e1"], ["press", "Enter"]]],
	] as Array<[string, string[][]]>) {
		env.env[flag] = true;
		const controller = new AbortController();
		const pending = env.call(env.chain(...steps as [string, ...unknown[]][]), controller.signal);
		await tick();
		controller.abort();
		await assert.rejects(pending, /abort/i);
		env.env[flag] = false;
		assert.equal(await env.call(env.chain(["title"])), "Title");
	}
});

// Navigation

it("goto waits for the main document only, forgets observed ids and answers with the url", async () => {
	const env = await opened();
	const save = env.element(new FakeElement());
	env.env.nodes.set(5, save);
	await env.call(env.chain(["observe"]));
	assert.equal(await env.call(env.chain(["goto", "https://b.test/"])), "https://b.test/");
	assert.equal(env.env.navigations.length, 1);
	const [kind, url, options] = env.env.navigations[0];
	assert.deepEqual([kind, url, options.waitUntil], ["goto", "https://b.test/", []]);
	assert.ok(options.timeout >= 1);
	await assert.rejects(env.call(env.chain(["id", 1], ["text"])), /Unknown element id 1/);
	await env.call(env.chain(["goto", "https://c.test/", { waitUntil: "networkidle0" }]));
	assert.equal(env.env.navigations[1][2].waitUntil, "networkidle0");
});

it("goto that never loads stops the navigation and says how to retry", async () => {
	const env = await opened();
	env.env.neverLoads = true;
	await assert.rejects(
		env.call({ ...env.chain(["goto", "https://slow.test/"]), timeout: 1 }),
		/tab\.goto\("https:\/\/slow\.test\/"\) timed out after 1ms; pending navigation stopped; retry with a longer tool timeout or waitUntil:"domcontentloaded"/,
	);
	assert.deepEqual(env.env.cdp, ["Page.stopLoading"]);
	await assert.rejects(env.call(env.chain(["goto", 5])), /takes the URL as a string/);
});

it("back, forward and reload wait like goto and answer with the url", async () => {
	const env = await opened();
	assert.equal(await env.call(env.chain(["back"], ["url"])), "about:blank");
	await env.call(env.chain(["forward", { waitUntil: "domcontentloaded" }]));
	await env.call(env.chain(["reload"]));
	assert.deepEqual(env.env.navigations.map((entry: Any) => [entry[0], entry[1].waitUntil]), [["back", []], ["forward", []], ["reload", []]]);
	env.env.neverLoads = true;
	await assert.rejects(env.call({ ...env.chain(["reload"]), timeout: 1 }), /Navigation timeout of 1 ms exceeded/);
});

it("pushState uses the History API, or the Next.js router when the page has one", async () => {
	const env = await opened();
	assert.equal(await env.call(env.chain(["pushState", "/next-page"])), "/next-page");
	assert.deepEqual(env.env.pushed, ["/next-page"]);
	const routed: string[] = [];
	globals.next = { router: { push: async (target: string) => { routed.push(target); env.env.url = `https://app.test${target}`; } } };
	try {
		assert.equal(await env.call(env.chain(["pushState", "/routed"])), "https://app.test/routed");
	} finally {
		delete globals.next;
	}
	assert.deepEqual(routed, ["/routed"]);
	assert.deepEqual(env.env.pushed, ["/next-page"]);
});

// Fields

it("clicks the centre of a stable element and refuses one that is covered", async () => {
	const env = await opened();
	const save = env.element(new FakeElement());
	env.env.selectors["#save"] = [save];
	await env.call(env.chain(["click", "#save"]));
	assert.deepEqual(env.env.mouse, [["click", 60, 35, { button: undefined, count: undefined }]]);
	assert.equal(save.scrolled, 1);
	assert.deepEqual(env.env.locatorTimeouts, [8000]);
	const banner = env.element(new FakeElement());
	banner.id = "cookie";
	banner.classList = ["banner", "wide", "third"];
	save.hit = banner;
	await assert.rejects(env.call(env.chain(["click", "#save"])), /tab\.click\("#save"\) blocked: covered by <div#cookie\.banner\.wide>/);
	assert.equal(env.env.mouse.length, 1);
});

it("double clicks, hovers and explains an element that never becomes clickable", async () => {
	const env = await opened();
	const save = env.element(new FakeElement());
	env.env.selectors["#save"] = [save];
	await env.call(env.chain(["dblclick", "#save"], ["hover", "#save"]));
	assert.equal(env.env.mouse[0][3].count, 2);
	assert.equal(env.env.mouse[1][0], "hover");
	save.style.display = "none";
	mockTime();
	await assert.rejects(
		elapse(env.call(env.chain(["click", "#save"]))),
		/tab\.click\("#save"\) timed out after 8000ms; the element never became clickable \(last check: display:none; selector matches 1 element\(s\)\)/,
	);
	const missing: string = await elapse(env.call(env.chain(["click", "#missing"]))).catch((error: Error) => error.message);
	assert.match(missing, /timed out after 8000ms; selector currently matches no elements/);
	assert.doesNotMatch(missing, /dialog/);
});

it("caps an action at the call's own timeout", async () => {
	const env = await opened();
	mockTime();
	await assert.rejects(elapse(env.call({ ...env.chain(["click", "#missing"]), timeout: 2 })), /tab\.click\("#missing"\) timed out after 1000ms/);
});

it("clicks the first visible match of a text selector", async () => {
	const env = await opened();
	const hidden = env.element(new FakeElement());
	hidden.rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
	const lower = env.element(new FakeElement());
	lower.rect = { left: 10, top: 300, right: 110, bottom: 330, width: 100, height: 30 };
	const upper = env.element(new FakeElement());
	env.env.selectors["text/Save"] = [hidden, lower, upper];
	await env.call(env.chain(["click", "text/Save"]));
	assert.deepEqual(env.env.mouse.map((entry: Any[]) => entry.slice(0, 3)), [["click", 60, 35]]);
});

it("fill replaces the text, type appends, and both refuse fields that cannot take text", async () => {
	const env = await opened();
	const field = env.element(new FakeField());
	env.env.selectors["#name"] = [field];
	await env.call(env.chain(["type", "#name", "ab"], ["fill", "#name", "new"]));
	assert.equal(field.value, "new");
	assert.deepEqual(field.typed, ["ab", "new"]);
	await env.call(env.chain(["fill", "#name", ""]));
	assert.equal(field.value, "");
	assert.deepEqual(field.events, ["input", "change"]);
	field.disabled = true;
	await assert.rejects(env.call(env.chain(["fill", "#name", "x"])), /Cannot fill a disabled element/);
	field.disabled = false;
	field.readOnly = true;
	await assert.rejects(env.call(env.chain(["type", "#name", "x"])), /Cannot type into a read-only element/);
	await assert.rejects(env.call(env.chain(["fill", "#name"])), /takes exactly one string value/);
	assert.equal(field.typed.length, 3);
});

it("selects options by value then label, and rejects an unknown one before touching the select", async () => {
	const env = await opened();
	const select = env.element(new FakeSelect());
	env.env.selectors["#choice"] = [select];
	assert.deepEqual(await env.call(env.chain(["select", "#choice", "b"])), ["b"]);
	assert.equal(select.selectedIndex, 1);
	assert.deepEqual(await env.call(env.chain(["select", "#choice", "Alpha"])), ["a"]);
	assert.equal(select.selectedIndex, 0);
	await assert.rejects(env.call(env.chain(["select", "#choice", "Nope"])), /No <select> option matches "Nope"/);
	assert.equal(select.selectedIndex, 0);
	const plain = env.element(new FakeElement());
	env.env.selectors["#plain"] = [plain];
	await assert.rejects(env.call(env.chain(["select", "#plain", "a"])), /tab\.select\("#plain"\) requires a <select> element/);
});

it("check and uncheck click only when the state has to change", async () => {
	const env = await opened();
	const box = env.element(new FakeField());
	box.type = "checkbox";
	env.env.selectors["#agree"] = [box];
	await env.call(env.chain(["check", "#agree"]));
	assert.equal(box.checked, true);
	assert.equal(env.env.mouse.length, 1);
	await env.call(env.chain(["check", "#agree"]));
	assert.equal(env.env.mouse.length, 1);
	await env.call(env.chain(["uncheck", "#agree"]));
	assert.equal(box.checked, false);
	assert.equal(env.env.mouse.length, 2);
	const plain = env.element(new FakeElement());
	env.env.selectors["#plain"] = [plain];
	await assert.rejects(env.call(env.chain(["check", "#plain"])), /requires a checkbox, radio, or ARIA switch/);
	assert.deepEqual(await env.call(env.chain(["isChecked", "#agree"])), false);
	assert.deepEqual(await env.call(env.chain(["isEnabled", "#agree"])), true);
	box.disabled = true;
	assert.deepEqual(await env.call(env.chain(["isEnabled", "#agree"])), false);
	box.disabled = false;
	box.attrs["aria-disabled"] = "true";
	assert.deepEqual(await env.call(env.chain(["isEnabled", "#agree"])), false);
	assert.deepEqual(await env.call(env.chain(["box", "#agree"])), { x: 10, y: 20, width: 100, height: 30 });
	assert.equal(await env.call(env.chain(["isEnabled", "#missing"])), false);
	assert.equal(await env.call(env.chain(["box", "#missing"])), null);
});

// Uploads

it("uploads to a file input by selector and by handle, resolving relative paths from the session folder", async () => {
	const env = await opened();
	const input = env.element(new FakeField());
	input.type = "file";
	env.env.selectors["#file"] = [input];
	env.env.refs.set("e1", input);
	await env.call(env.chain(["uploadFile", "#file", "a.txt", "/abs/b.txt"]));
	assert.deepEqual(env.env.uploads, [[resolve("a.txt"), resolve("/abs/b.txt")]]);
	await env.call(env.chain(["ref", "e1"], ["uploadFile", "c.txt"]));
	assert.deepEqual(env.env.uploads[1], [resolve("c.txt")]);
	assert.equal(env.env.mouse.length, 0);
});

it("refuses an upload without files before looking for the element", async () => {
	const env = await opened();
	await assert.rejects(env.call(env.chain(["uploadFile", "#missing"])), /tab\.uploadFile\("#missing"\) requires at least one file path/);
	await assert.rejects(env.call(env.chain(["uploadFile", "#missing", 5])), /takes string arguments/);
});

it("uploads through the file chooser a click opens on a button", async () => {
	const env = await opened();
	env.env.selectors["#pick"] = [env.element(new FakeElement())];
	env.env.chooser = true;
	await env.call(env.chain(["uploadFile", "#pick", "/abs/a.txt"]));
	assert.equal(env.env.mouse.filter((entry: Any[]) => entry[0] === "click").length, 1);
	assert.deepEqual(env.env.accepted, [[resolve("/abs/a.txt")]]);
});

it("drops the files on an element that opens no chooser", async () => {
	const env = await opened();
	const zone = env.element(new FakeElement());
	env.env.selectors["#zone"] = [zone];
	const folder = await mkdtemp(join(tmpdir(), "browser-upload-"));
	try {
		await writeFile(join(folder, "note.txt"), "hello");
		await env.call(env.chain(["uploadFile", "#zone", join(folder, "note.txt")]));
	} finally {
		await rm(folder, { recursive: true, force: true });
	}
	assert.deepEqual(env.env.drops, [["dragenter", [["note.txt", "text/plain", 5]]], ["dragover", [["note.txt", "text/plain", 5]]], ["drop", [["note.txt", "text/plain", 5]]]]);
	assert.deepEqual(zone.events, ["dragenter", "dragover", "drop"]);
});

// Keys and mouse

it("presses a combo with its modifiers held and released, and focuses a selector first", async () => {
	const env = await opened();
	const field = env.element(new FakeField());
	env.env.selectors["#name"] = [field];
	await env.call(env.chain(["press", "Shift+Tab", { selector: "#name" }]));
	assert.deepEqual(env.env.focusedPage, ["#name"]);
	assert.deepEqual(env.env.keys, [["down", "Shift"], ["press", "Tab", undefined], ["up", "Shift"]]);
	env.env.keys.length = 0;
	await env.call(env.chain(["press", "Control++"], ["keyDown", "a"], ["keyUp", "a"]));
	assert.deepEqual(env.env.keys, [["down", "Control"], ["press", "+", undefined], ["up", "Control"], ["down", "a"], ["up", "a"]]);
	await assert.rejects(env.call(env.chain(["press", "#name", "Enter"])), /Did you mean tab\.press\("Enter", \{ selector: "#name" \}\)\?/);
});

it("names the macOS editing command for a Meta combo and only there", async () => {
	const env = await opened();
	const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
	try {
		Object.defineProperty(process, "platform", { value: "darwin" });
		await env.call(env.chain(["press", "Meta+a"], ["press", "MetaLeft+KeyC"], ["press", "Shift+Meta+Z"], ["press", "Shift+Tab"]));
		assert.deepEqual(env.env.keys.filter((key: Any[]) => key[0] === "press").map((key: Any[]) => key[2]), [{ commands: ["selectAll"] }, { commands: ["copy"] }, { commands: ["redo"] }, undefined]);
		env.env.keys.length = 0;
		Object.defineProperty(process, "platform", { value: "linux" });
		await env.call(env.chain(["press", "Meta+a"]));
		assert.deepEqual(env.env.keys.filter((key: Any[]) => key[0] === "press").map((key: Any[]) => key[2]), [undefined]);
	} finally {
		Object.defineProperty(process, "platform", platform);
	}
});

it("moves, clicks and wheels the mouse at page coordinates and rejects bad numbers", async () => {
	const env = await opened();
	await env.call(env.chain(["mouseMove", 5, 6, { steps: 3 }], ["mouseDown", { button: "right" }], ["mouseUp"], ["clickAt", 7, 8, { button: "right", clickCount: 2 }], ["wheel", 0, 120]));
	assert.deepEqual(env.env.mouse, [
		["move", 5, 6, { steps: 3 }], ["down", { button: "right" }], ["up", {}], ["click", 7, 8, { button: "right", count: 2 }], ["wheel", { deltaX: 0, deltaY: 120 }],
	]);
	await assert.rejects(env.call(env.chain(["clickAt", null, 1])), /clickAt x must be a finite number/);
	await assert.rejects(env.call(env.chain(["mouseMove", 1, Number.NaN])), /mouseMove y must be a finite number/);
	await assert.rejects(env.call(env.chain(["wheel", 1, undefined])), /wheel deltaY must be a finite number/);
});

it("scrolls the page without waiting for the renderer, or one element, and drags between points", async () => {
	const env = await opened();
	env.env.hangWheel = true;
	mockTime();
	await elapse(env.call(env.chain(["scroll", 0, 300])), 500);
	mock.timers.reset();
	env.env.hangWheel = false;
	const list = env.element(new FakeElement());
	env.env.selectors["#list"] = [list];
	await env.call(env.chain(["scroll", 0, 50, { selector: "#list" }], ["scrollIntoView", "#list"]));
	assert.deepEqual(list.scrolledBy, [{ left: 0, top: 50, behavior: "instant" }]);
	assert.equal(list.scrolled, 1);
	env.env.mouse.length = 0;
	await env.call(env.chain(["drag", "#list", { x: 300, y: 400 }]));
	assert.deepEqual(env.env.mouse, [["move", 60, 35, undefined], ["down", undefined], ["move", 300, 400, { steps: 12 }], ["up", undefined]]);
	await assert.rejects(env.call(env.chain(["drag", "#list", 5])), /Drag to must be a selector string or \{ x: number, y: number \} point/);
	await assert.rejects(env.call(env.chain(["drag", "#missing", { x: 1, y: 2 }])), /Drag from selector did not resolve: #missing/);
});

// Waits

it("waits for elements with the action limit, an explicit limit clamped to the call, and a named timeout", async () => {
	const env = await opened();
	const node = env.element(new FakeElement());
	env.env.selectors["#ready"] = [node];
	await env.call(env.chain(["waitFor", "#ready"], ["waitFor", "#ready", { timeout: 999999 }], ["waitFor", "#ready", { timeout: 0 }], ["waitFor", "#ready", { timeout: -5 }], ["waitFor", "#ready", { timeout: 1500 }]));
	assert.deepEqual(env.env.locatorTimeouts, [8000, 29000, 29000, 8000, 1500]);
	mockTime();
	await assert.rejects(elapse(env.call(env.chain(["waitFor", "#late", { timeout: 1500 }]))), /tab\.waitFor\("#late"\) timed out after 1500ms; selector currently matches no elements/);
});

it("waitForSelector passes visibility options on, and resolves refs without waiting", async () => {
	const env = await opened();
	const node = env.element(new FakeElement());
	env.env.selectors["#ready"] = [node];
	await env.call(env.chain(["waitForSelector", "#ready", { timeout: 2000, visible: true }], ["waitForSelector", "#gone", { hidden: true }]));
	assert.equal(env.env.waits[0][0], "#ready");
	assert.deepEqual({ ...env.env.waits[0][1], signal: undefined }, { timeout: 2000, visible: true, hidden: undefined, signal: undefined });
	assert.equal(env.env.waits[1][1].hidden, true);
	env.env.refs.set("e1", node);
	await env.call(env.chain(["waitForSelector", "e1"]));
	assert.equal(env.env.waits.length, 2);
	mockTime();
	await assert.rejects(elapse(env.call(env.chain(["waitForSelector", "#absent", { timeout: 700 }]))), /tab\.waitForSelector\("#absent"\) timed out after 700ms/);
});

it("waits for a url fragment and for text, exact or scoped", async () => {
	const env = await opened();
	env.env.url = "https://app.test/done?ok=1";
	assert.equal(await env.call(env.chain(["waitForUrl", "/done"])), "https://app.test/done?ok=1");
	mockTime();
	await assert.rejects(elapse(env.call(env.chain(["waitForUrl", "/elsewhere", { timeout: 400 }]))), /tab\.waitForUrl\(\) timed out after 400ms/);
	env.env.body.innerText = "Loading";
	let found = false;
	const waiting = env.call(env.chain(["waitForText", "Saved", { timeout: 5000 }])).then(() => { found = true; });
	await tick();
	await tick();
	mock.timers.tick(300);
	await tick();
	assert.equal(found, false);
	env.env.body.innerText = "All Saved now";
	await elapse(waiting);
	await assert.rejects(elapse(env.call(env.chain(["waitForText", "Saved", { exact: true, timeout: 300 }]))), /tab\.waitForText\("Saved"\) timed out after 300ms/);
	const status = env.element(new FakeElement());
	status.innerText = " Saved ";
	env.env.selectors["#status"] = [status];
	await elapse(env.call(env.chain(["waitForText", "Saved", { exact: true, selector: "#status" }])));
});

// Screenshots

it("returns a screenshot as an image result and brings an owned tab to the front", async () => {
	const env = await opened();
	const result = await env.full(env.chain(["screenshot", { fullPage: true }]));
	assert.deepEqual(result.content[1], { type: "image", data: "AQID", mimeType: "image/png" });
	assert.deepEqual(result.details.value, { mimeType: "image/png", width: 800, height: 600, originalWidth: 1600, originalHeight: 1200 });
	assert.equal(env.env.brought, 1);
	assert.deepEqual(env.env.shots, [["page", { type: "png", quality: undefined, fullPage: true }]]);
	assert.deepEqual([...env.env.resizes[0][0]], [1, 2, 3]);
});

it("screenshots one element scrolled into view, as jpeg with quality", async () => {
	const env = await opened();
	const card = env.element(new FakeElement());
	env.env.selectors["#card"] = [card];
	const result = await env.full(env.chain(["screenshot", { selector: "#card", format: "jpeg", quality: 60 }]));
	assert.equal(result.content[1].mimeType, "image/jpeg");
	assert.deepEqual(env.env.shots, [["element", { type: "jpeg", quality: 60, scrollIntoView: false }, 1]]);
	assert.equal(env.env.resizes[0][1], "image/jpeg");
	await assert.rejects(env.full(env.chain(["screenshot", { selector: "#nothing" }])), /did not resolve to an element/);
	await assert.rejects(env.full(env.chain(["screenshot", { quality: 60 }])), /quality is only valid with format: "jpeg"/);
	await assert.rejects(env.full(env.chain(["screenshot", { format: "jpeg", quality: 101 }])), /integer from 0 to 100/);
});

it("does not take focus from a browser the user drives, and refuses a hidden tab there", async () => {
	const hidden = await opened({ visible: false }, { app: { cdp_url: "http://localhost:9222" } });
	await assert.rejects(hidden.full(hidden.chain(["screenshot"])), /attached browser tab is not visible/);
	assert.equal(hidden.env.brought, 0);
	const shown = await opened({}, { app: { cdp_url: "http://localhost:9222" } });
	assert.equal((await shown.full(shown.chain(["screenshot"]))).content.length, 2);
	assert.equal(shown.env.brought, 0);
});

it("refuses a screenshot that cannot be made small enough", async () => {
	const env = await opened({ resized: null });
	await assert.rejects(env.full(env.chain(["screenshot"])), /too large to return as an image/);
});

// Dialogs

function dialogOf(type: string, message: string, log: Any[]) {
	return { type: () => type, message: () => message, defaultValue: () => "def", accept: async (text?: string) => { log.push(["accept", type, text]); }, dismiss: async () => { log.push(["dismiss", type]); } };
}

it("accepts alerts at once, holds confirms and prompts for handleDialog, and forgets them after navigation", async () => {
	const env = await opened();
	env.emit("dialog", dialogOf("alert", "hi", env.env.dialogLog));
	env.emit("dialog", dialogOf("beforeunload", "leave?", env.env.dialogLog));
	assert.deepEqual(env.env.dialogLog, [["accept", "alert", undefined], ["accept", "beforeunload", undefined]]);
	assert.deepEqual(await env.call(env.chain(["dialog"])), { open: false });
	await assert.rejects(env.call(env.chain(["handleDialog", { accept: true }])), /found no pending confirm or prompt/);
	env.emit("dialog", dialogOf("prompt", "Name?", env.env.dialogLog));
	assert.deepEqual(await env.call(env.chain(["dialog"])), { open: true, type: "prompt", message: "Name?", defaultValue: "def" });
	await env.call(env.chain(["handleDialog", { accept: true, text: "Ada" }]));
	assert.deepEqual(env.env.dialogLog.at(-1), ["accept", "prompt", "Ada"]);
	assert.deepEqual(await env.call(env.chain(["dialog"])), { open: false });
	env.emit("dialog", dialogOf("confirm", "Sure?", env.env.dialogLog));
	assert.deepEqual(await env.call(env.chain(["dialog"])), { open: true, type: "confirm", message: "Sure?" });
	env.emit("framenavigated", env.main);
	assert.deepEqual(await env.call(env.chain(["dialog"])), { open: false });
	env.emit("dialog", dialogOf("confirm", "Again?", env.env.dialogLog));
	await env.call(env.chain(["handleDialog", { accept: false }]));
	assert.deepEqual(env.env.dialogLog.at(-1), ["dismiss", "confirm"]);
	await assert.rejects(env.call(env.chain(["handleDialog", {}])), /takes \{ accept: boolean/);
});

it("a dialog policy settles the pending dialog and the next ones, and can be removed", async () => {
	const env = await opened();
	env.emit("dialog", dialogOf("confirm", "Sure?", env.env.dialogLog));
	await env.call(env.chain(["setDialogs", "dismiss"]));
	assert.deepEqual(env.env.dialogLog, [["dismiss", "confirm"]]);
	env.emit("dialog", dialogOf("prompt", "Next?", env.env.dialogLog));
	assert.deepEqual(env.env.dialogLog.at(-1), ["dismiss", "prompt"]);
	await env.call(env.chain(["setDialogs", null]));
	env.emit("dialog", dialogOf("confirm", "Held?", env.env.dialogLog));
	assert.equal((await env.call(env.chain(["dialog"]))).open, true);
	await assert.rejects(env.call(env.chain(["setDialogs", "maybe"])), /takes "accept", "dismiss" or null/);
});

it("open can set the dialog policy, and closing stops listening", async () => {
	const env = await opened({}, { dialogs: "accept" });
	env.emit("dialog", dialogOf("confirm", "Sure?", env.env.dialogLog));
	assert.deepEqual(env.env.dialogLog, [["accept", "confirm", undefined]]);
	assert.equal(env.env.listeners.dialog.length, 1);
	await env.call({ action: "close" });
	assert.equal(env.env.listeners.dialog.length, 0);
});

it("a click blocked by an open dialog times out naming the dialog, and the dialog can still be handled", async () => {
	const env = await opened();
	const button = env.element(new FakeElement());
	env.env.selectors["#ask"] = [button];
	env.env.hangClick = true;
	mockTime();
	const clicking = env.call(env.chain(["click", "#ask"]));
	while (!button.scrolled) await tick();
	env.emit("dialog", dialogOf("confirm", "Delete everything?", env.env.dialogLog));
	await assert.rejects(elapse(clicking), /tab\.click\("#ask"\) timed out after 8000ms.*a confirm\("Delete everything\?"\) dialog is open and may block the page; use tab\.handleDialog\(\) or tab\.setDialogs\("accept"\|"dismiss"\)/);
	mock.timers.reset();
	await env.call(env.chain(["handleDialog", { accept: true }]));
	assert.deepEqual(env.env.dialogLog, [["accept", "confirm", undefined]]);
});

// Handles, frames, stale ids and cancellation

it("acts on observed ids, ARIA refs and frame selectors, and rejects ids after real navigation", async () => {
	const env = await opened();
	const name = env.element(new FakeField());
	const save = env.element(new FakeElement());
	env.env.nodes.set(4, name);
	env.env.nodes.set(5, save);
	const observation = await env.call(env.chain(["observe"]));
	assert.deepEqual(observation.elements.map((entry: Any) => [entry.id, entry.name]), [[1, "Name"], [2, "Save"]]);
	await env.call(env.chain(["id", 1], ["fill", "Ada"]));
	assert.equal(name.value, "Ada");
	await env.call(env.chain(["id", 2], ["click"]));
	assert.equal(env.env.mouse.length, 1);
	env.env.refs.set("e7", save);
	await env.call(env.chain(["ref", "e7"], ["dblclick"]));
	assert.equal(env.env.mouse.at(-1)[3].count, 2);
	assert.equal(await env.call(env.chain(["id", 1], ["isEnabled"])), true);
	const field = env.element(new FakeField());
	const frameButton = env.element(new FakeElement());
	const owner = env.element(new FakeElement());
	owner.contentFrame = env.child;
	env.env.selectors["#pay"] = [owner];
	env.env.childSelectors["#amount"] = [field];
	env.env.childSelectors["#go"] = [frameButton];
	await env.call(env.chain(["frame", "#pay"], ["fill", "#amount", "12"]));
	assert.equal(field.value, "12");
	await env.call(env.chain(["frame", "#pay"], ["click", "#go"]));
	assert.equal(env.env.mouse.length, 3);
	await assert.rejects(env.call(env.chain(["frame", "#pay"], ["click", "e1"])), /ARIA refs of a frame snapshot cannot be used as selectors/);
	env.env.mouse.length = 0;
	await env.call(env.chain(["back"]));
	await assert.rejects(env.call(env.chain(["id", 2], ["click"])), /Element id 2 is stale\. Run tab\.observe\(\) again\./);
	assert.equal(env.env.mouse.length, 0);
	await assert.rejects(env.call(env.chain(["ref", "e9"], ["click"])), /Unknown ARIA ref "e9"/);
});

it("does not wait for the page to release a handle once the action is done", { timeout: 3000 }, async () => {
	const env = await opened();
	const name = env.element(new FakeField());
	env.env.nodes.set(4, name);
	await env.call(env.chain(["observe"]));
	env.env.hangFinalDispose = true;
	assert.equal(await env.call(env.chain(["id", 1], ["isEnabled"])), true);
	await env.call(env.chain(["id", 1], ["fill", "x"]));
	assert.equal(name.value, "x");
});

it("lists the methods of a handle and keeps unsupported helpers out", async () => {
	const env = await opened();
	const save = env.element(new FakeElement());
	env.env.refs.set("e1", save);
	await assert.rejects(env.call(env.chain(["ref", "e1"], ["wobble"])), /Unknown element method "wobble"\. Available element methods: .*click.*fill.*select.*scrollIntoView/);
});

it("cancelling a stuck click releases the queue", async () => {
	const env = await opened();
	const button = env.element(new FakeElement());
	env.env.selectors["#ask"] = [button];
	env.env.hangClick = true;
	const controller = new AbortController();
	const clicking = env.call(env.chain(["click", "#ask"]), controller.signal);
	while (!button.scrolled) await tick();
	controller.abort();
	await assert.rejects(clicking, /abort/i);
	assert.equal(await env.call(env.chain(["title"])), "Title");
});

it("cancelling a stuck element screenshot releases the queue", async () => {
	const env = await opened();
	env.env.selectors["#card"] = [env.element(new FakeElement())];
	env.env.hangResolve = true;
	const controller = new AbortController();
	const shooting = env.full(env.chain(["screenshot", { selector: "#card" }]), controller.signal);
	await tick();
	controller.abort();
	await assert.rejects(shooting, /abort/i);
	env.env.hangResolve = false;
	assert.equal(await env.call(env.chain(["title"])), "Title");
});

it("cancelling a text click whose match never answers releases the queue and its handles", async () => {
	const env = await opened();
	env.env.selectors["text/Go"] = [env.element(new FakeElement())];
	env.env.hangInspect = true;
	const controller = new AbortController();
	const clicking = env.call(env.chain(["click", "text/Go"]), controller.signal);
	await tick();
	controller.abort();
	await assert.rejects(clicking, /abort/i);
	env.env.hangInspect = false;
	assert.equal(await env.call(env.chain(["title"])), "Title");
	assert.ok(env.env.handles.every((handle: Any) => handle.disposed > 0));
});

it("disposes the ancestor handle of a text match whose measuring never answers", async () => {
	const env = await opened();
	env.env.selectors["text/Go"] = [env.element(new FakeElement())];
	env.env.hangRect = true;
	const controller = new AbortController();
	const clicking = env.call(env.chain(["click", "text/Go"]), controller.signal);
	while (!env.env.hangEvaluate) await tick();
	await tick();
	controller.abort();
	await assert.rejects(clicking, /abort/i);
	env.env.hangRect = false;
	env.env.hangEvaluate = false;
	assert.equal(env.env.handles.length, 2);
	assert.ok(env.env.handles.every((handle: Any) => handle.disposed > 0));
});

it("releases the mouse button when a drag is cancelled after pressing it", async () => {
	const env = await opened();
	env.env.selectors["#list"] = [env.element(new FakeElement())];
	env.env.hangDrag = true;
	const controller = new AbortController();
	const dragging = env.call(env.chain(["drag", "#list", { x: 300, y: 400 }]), controller.signal);
	while (!env.env.mouse.some((entry: Any) => entry[0] === "down")) await tick();
	controller.abort();
	await assert.rejects(dragging, /abort/i);
	await tick();
	assert.equal(env.env.mouse.at(-1)[0], "up");
	env.env.hangDrag = false;
	assert.equal(await env.call(env.chain(["title"])), "Title");
});

it("describes the new helpers with oh-my-pi's wording", async () => {
	const { description } = setup();
	for (const line of [
		"Navigation: `url`, `title`, `goto`, `back`, `forward`, `reload`, `pushState`.",
		"Waiting: `waitFor`, `waitForSelector`, `waitForUrl`, `waitForText`.",
		"Without a policy, alerts and beforeunload prompts are accepted automatically; confirms and prompts remain pending for `handleDialog`.",
		"Navigation and re-renders invalidate observed ids and refs. Re-observe, then act in the same call. Use `pushState(url)` for SPA navigation without a document load.",
		"Use `tab.select` for `<select>` elements; `tab.fill` does not support them.",
		"Default to `tab.observe()`; use screenshots for visual confirmation.",
		"`tab.id(n)` / `tab.ref(\"e5\")` return `BrowserElement` handles for supported interaction and inspection methods.",
		"Screenshots return as Pi image results.",
	]) assert.ok(description().includes(line), line);
});
