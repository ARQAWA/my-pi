import assert from "node:assert/strict";
import { afterEach, it, mock } from "node:test";
import { createBrowserExtension } from "../../../extensions/RQW-browser/index.ts";

// A small fake browser. Page-side functions of the extension really run, against these fake nodes,
// with `document` set to the document of the frame the node lives in.

type Any = any;
const globals = globalThis as Any;

function run<T>(node: Any, work: () => T): T {
	const previous = globals.document;
	globals.document = node.frame.document;
	try {
		return work();
	} finally {
		globals.document = previous;
	}
}

const unwrap = (value: Any) => value?.node ?? value;
const noHandle = { asElement: () => null, dispose: async () => {} };

const created: Any[] = [];

function handleOf(node: Any, world: "main" | "isolated"): Any {
	const handle: Any = {
		node, world, disposed: 0, frame: node.frame,
		asElement: () => handle,
		evaluate: async (fn: Any, ...args: Any[]) => run(node, () => fn(node, ...args.map(unwrap))),
		evaluateHandle: async (fn: Any, ...args: Any[]) => {
			const found = run(node, () => fn(node, ...args.map(unwrap)));
			return found ? handleOf(found, world) : noHandle;
		},
		isVisible: async () => node.visible,
		isIntersectingViewport: async () => node.inViewport,
		contentFrame: async () => node.contentFrame ?? null,
		backendNodeId: async () => node.backend,
		dispose: async () => { handle.disposed++; },
	};
	created.push(handle);
	return handle;
}

function stamp(tree: Any, loaderId: string): Any {
	return { ...tree, loaderId, children: tree.children?.map((child: Any) => stamp(child, loaderId)) };
}

function createFrame(id: string, name: string, url: string, parent?: Any): Any {
	const frame: Any = {
		_id: id, _loaderId: `${id}-loader-1`, document: { id }, parent, children: [] as Any[],
		nodes: new Map<number, Any>(), selectors: {} as Record<string, Any[]>, queries: [] as string[],
		axTree: null as Any, hangs: false, hangAdopt: false, snapshotOptions: [] as Any[],
		ariaText: "- generic", refsAfterSnapshot: new Map<string, Any>(), refs: new Map<string, Any>(), hrefs: {} as Record<string, string>,
		isolatedCalls: [] as Any[], listeners: {} as Record<string, Any[]>, owner: undefined as Any,
		name: () => name, url: () => url, parentFrame: () => parent ?? null, childFrames: () => frame.children,
		frameElement: async () => (frame.owner ? handleOf(frame.owner, "main") : null),
		$: async (selector: string) => {
			frame.queries.push(selector);
			const node = frame.selectors[selector]?.[0];
			return node ? handleOf(node, "main") : null;
		},
		$$: async (selector: string) => {
			frame.queries.push(selector);
			return (frame.selectors[selector] ?? []).map((node: Any) => handleOf(node, "main"));
		},
		accessibility: {
			snapshot: async (options: Any) => {
				frame.snapshotOptions.push(options);
				if (frame.hangs) return await new Promise(() => {});
				return frame.axTree ? stamp(frame.axTree, frame._loaderId) : null;
			},
		},
		client: { on: (event: string, listener: Any) => { (frame.listeners[event] ??= []).push(listener); } },
		mainRealm: () => ({
			adoptHandle: async (handle: Any) => handleOf(handle.node, "main"),
			adoptBackendNode: async (backendId: number) => {
				if (frame.hangAdopt) return await new Promise(() => {});
				const node = frame.nodes.get(backendId);
				if (!node) throw new Error("No node with this id");
				return handleOf(node, "main");
			},
		}),
		isolatedRealm: () => ({
			adoptHandle: async (handle: Any) => handleOf(handle.node, "isolated"),
			evaluate: async (fn: Any, ...args: Any[]) => {
				const source = String(fn);
				frame.isolatedCalls.push({ kind: "evaluate", source, args });
				if (source.includes("ariaSnapshot(root, request)")) {
					frame.refs = new Map(frame.refsAfterSnapshot);
					return frame.ariaText;
				}
				return frame.hrefs;
			},
			evaluateHandle: async (fn: Any, ref: string) => {
				frame.isolatedCalls.push({ kind: "evaluateHandle", source: String(fn), args: [ref] });
				const node = frame.refs.get(ref);
				return node ? handleOf(node, "isolated") : noHandle;
			},
		}),
	};
	parent?.children.push(frame);
	return frame;
}

function createNode(frame: Any, backend: number, init: { text?: string; value?: string; attrs?: Record<string, string>; parent?: Any } = {}): Any {
	const node: Any = {
		nodeType: 1, backend, frame, isConnected: true, ownerDocument: frame.document, parentElement: init.parent ?? null,
		innerText: init.text ?? "", textContent: init.text ?? "", innerHTML: `<b>${init.text ?? ""}</b>`,
		...(init.value === undefined ? {} : { value: init.value }),
		attrs: init.attrs ?? {}, visible: true, inViewport: true,
		getAttribute(name: string) { return this.attrs[name] ?? null; },
		getRootNode: () => ({ host: null }),
	};
	frame.nodes.set(backend, node);
	return node;
}

function ax(role: string, name: string, backendNodeId: number, extra: Record<string, unknown> = {}, children: Any[] = []): Any {
	return { role, name, backendNodeId, ...extra, children };
}

function setup() {
	const main = createFrame("main", "", "https://app.test/");
	const child = createFrame("child", "pay", "https://pay.test/frame", main);
	const name = createNode(main, 4, { value: "Ada", attrs: { "aria-label": "Your name" } });
	const form = createNode(main, 3, { text: "Form text" });
	const save = createNode(main, 5, { text: "Save" });
	const agree = createNode(main, 7, { text: "Agree" });
	const docs = createNode(main, 8, { text: "Docs" });
	const owner = createNode(main, 20, { attrs: { id: "pay" }, parent: form });
	const pay = createNode(child, 2, { text: "Pay now" });
	const other = createNode(main, 30, { text: "Elsewhere" });
	owner.contentFrame = child;
	owner.localName = "iframe";
	child.owner = owner;
	Object.assign(main.selectors, { "#form": [form], "#pay": [owner], "#other": [other] });
	Object.assign(child.selectors, { "#amount": [pay], li: [pay, pay, pay] });
	main.axTree = ax("RootWebArea", "App", 1, {}, [
		ax("heading", "Title", 2),
		ax("group", "", 3, {}, [ax("textbox", "Name", 4, { value: "Ada", focused: true }), ax("button", "Save", 5, { disabled: true })]),
		ax("generic", "", 6),
		ax("checkbox", "Agree", 7, { checked: true }),
		ax("link", "Docs", 8),
		ax("Iframe", "", 20),
	]);
	child.axTree = ax("RootWebArea", "Pay", 1, {}, [ax("button", "Pay now", 2)]);
	main.refsAfterSnapshot = new Map([["e1", name], ["e2", docs]]);

	const registered: string[] = [];
	const Puppeteer = {
		customQueryHandlerNames: () => registered,
		registerCustomQueryHandler: (handlerName: string) => { registered.push(handlerName); },
	};
	const page = {
		mainFrame: () => main,
		frames: () => [main, child], browserContext: () => ({}),
		url: () => main.url(),
		title: async () => "App title",
		$: (selector: string) => main.$(selector),
		$$: (selector: string) => main.$$(selector),
		goto: async () => {},
		on() {},
		off() {},
		accessibility: main.accessibility,
	};
	const browser = { target: () => ({ createCDPSession: async () => ({ send: async () => {}, on() {}, off() {}, detach: async () => {} }) }), newPage: async () => page, close: async () => {}, disconnect: async () => {} };
	let tool: Any;
	createBrowserExtension({
		load: async () => ({ launch: async () => browser, connect: async () => browser, Puppeteer }) as never,
		findSystemChrome: () => "/chrome",
	})({ registerTool: (value: unknown) => { tool = value; }, on: () => {} } as never);
	async function call(input: unknown, signal?: AbortSignal) {
		const result = await tool.execute("id", input, signal, undefined, {});
		return result.details.value;
	}
	return { tool, call, main, child, page, nodes: { name, form, save, agree, docs, owner, pay, other } };
}

const environments: Array<ReturnType<typeof setup>> = [];

async function opened() {
	const env = setup();
	environments.push(env);
	await env.call({ action: "open" });
	return env;
}

afterEach(async () => {
	mock.timers.reset();
	delete globals.document;
	for (const env of environments.splice(0)) await env.call({ action: "close", all: true });
});


it("renders Markdown with controls, states and accessible frames", async () => {
	const env = await opened();
	env.main.axTree = ax("RootWebArea", "App title", 1, {}, [
		ax("heading", "Sign in", 2, {}, [ax("StaticText", "Sign in", 11)]),
		ax("generic", "Welcome back", 12, {}, [ax("StaticText", "Welcome back", 13)]),
		ax("textbox", "Name", 4, { value: "Ada", required: true }),
		ax("button", "Save", 5, { disabled: true }, [ax("StaticText", "Save", 14)]),
		ax("checkbox", "Agree", 7, { checked: false }),
		ax("Iframe", "", 20),
		ax("link", "Docs", 8),
	]);
	const view: string = await env.call({ action: "markdown" });
	assert.match(view, /^# App title\nURL: https:\/\/app\.test\//);
	assert.match(view, /## Sign in/);
	assert.equal((view.match(/Welcome back/g) ?? []).length, 1);
	assert.equal((view.match(/Sign in/g) ?? []).length, 1);
	assert.equal((view.match(/Save/g) ?? []).length, 1);
	assert.match(view, /- textbox: Name; value=Ada; required/);
	assert.match(view, /- button: Save; disabled/);
	assert.match(view, /- checkbox: Agree; checked=false/);
	assert.match(view, /button: Pay now/);
	assert.ok(view.indexOf("Pay now") < view.indexOf("link: Docs"));
	assert.doesNotMatch(view, /INCOMPLETE|\[id:/);
});

it("keeps distinct controls and state-bearing ancestors with shared names", async () => {
	const env = await opened();
	env.main.axTree = ax("RootWebArea", "App", 1, {}, [
		ax("button", "Open", 5, {}, [ax("link", "Open", 8)]),
		ax("generic", "Status", 3, { focused: true }, [ax("StaticText", "Status", 11)]),
		ax("Iframe", "", 20),
	]);
	const view: string = await env.call({ action: "markdown" });
	assert.match(view, /button: Open/);
	assert.match(view, /link: Open/);
	assert.match(view, /generic: Status; focused/);
	assert.equal((view.match(/Status/g) ?? []).length, 1);
});

it("marks unavailable frame snapshots incomplete", async () => {
	const env = await opened();
	env.child.axTree = null;
	assert.match(await env.call({ action: "markdown" }), /INCOMPLETE.*https:\/\/pay\.test\/frame/);
	env.child.accessibility.snapshot = async () => { throw new Error("detached"); };
	assert.match(await env.call({ action: "markdown" }), /INCOMPLETE.*https:\/\/pay\.test\/frame/);
});

it("returns an incomplete view when a frame does not answer", async () => {
	const env = await opened();
	env.child.hangs = true;
	mock.timers.enable({ apis: ["setTimeout", "Date"] });
	const pending = env.call({ action: "markdown" });
	while (!env.child.snapshotOptions.length) await new Promise<void>(resolve => setImmediate(resolve));
	mock.timers.tick(5000);
	assert.match(await pending, /INCOMPLETE.*https:\/\/pay\.test\/frame/);
});
