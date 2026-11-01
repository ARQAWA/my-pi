import assert from "node:assert/strict";
import { createBrowserExtension } from "../../../extensions/RQW-browser/index.ts";

export type Any = any;
export function setup(replies: Any[], options: { incomplete?: boolean; disabled?: boolean; dom?: Any; lookup?: () => Promise<Any[]>; model?: (index: number, signal: AbortSignal) => Promise<Any>; press?: (key: string) => Promise<void>; waitText?: () => Promise<string>; afterClear?: () => void; cwd?: string; recorder?: Any; pageText?: string; html?: () => Promise<string> } = {}) {
	let tool: Any;
	let shutdown: Any;
	let url = "about:blank";
	const keys: string[] = [];
	const typed: string[] = [];
	const shots: Any[] = [];
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
		goto: async (value: string) => { url = value; }, content: async () => options.html ? await options.html() : `<html>${keys.join("")}</html>`, isClosed: () => false, bringToFront: async () => {}, screenshot: async (shot: Any) => { shots.push(shot); return new Uint8Array([1, 2, 3]); }, browser: () => ({ connected: true }), on() {}, off() {},
		keyboard: { press: async (key: string) => { keys.push(key); await options.press?.(key); }, down: async () => {}, up: async () => {} },
		accessibility: { snapshot: async () => ({ role: "RootWebArea", name: "Form", loaderId: "loader", backendNodeId: 1, children: [
			{ role: "button", name: "Submit", disabled: options.disabled, loaderId: "loader", backendNodeId: 2 },
			{ role: "StaticText", name: options.pageText ?? (keys.length === 3 ? "Done" : "Ready"), loaderId: "loader", backendNodeId: 3 },
		] }) },
		evaluate: async (fn: Any) => options.waitText && String(fn).includes("innerText") ? await options.waitText() : ({ viewport: {}, scroll: {} }),
	};
	const browser = { targets: () => options.recorder ? [{ url: () => "devtools://devtools?hasOtherClients=true", asPage: async () => options.recorder }] : [], target: () => ({ createCDPSession: async () => ({ send: async () => {}, on() {}, off() {}, detach: async () => {} }) }), newPage: async () => page, close: async () => {} };
	createBrowserExtension({ resizeImage: async (_bytes, mimeType) => ({ data: "AQID", mimeType, width: 800, height: 600, originalWidth: 1600, originalHeight: 1200 }), findSystemChrome: () => "/chrome", load: async () => ({ launch: async () => browser, Puppeteer: { customQueryHandlerNames: () => [], registerCustomQueryHandler() {} } }) as never })({ registerTool(value: Any) { tool = value; }, on(event: string, fn: Any) { if (event === "session_shutdown") shutdown = fn; } } as never);
	const ctx = { cwd: options.cwd, model: { provider: "anthropic" }, modelRegistry: {
		getAvailableOfType: async () => options.lookup ? await options.lookup() : [{ provider: "anthropic", id: "claude-haiku-5-5", reasoning: true }],
		streamSimple(model: Any, context: Any, streamOptions: Any) { requests.push(structuredClone({ model, context, reasoning: streamOptions.reasoning })); return { result: async () => options.model ? await options.model(requests.length - 1, streamOptions.signal) : replies.shift() }; },
	} };
	return { keys, typed, shots, requests, shutdown: () => shutdown(), async full(input: Any, signal?: AbortSignal) { return await tool.execute("id", input, signal, undefined, ctx); }, async call(input: Any, signal?: AbortSignal) { return (await tool.execute("id", input, signal, undefined, ctx)).details.value; } };
}
export const task = { action: "run", url: "https://local.test", actions: ["first", "second", "third"], expected: "Done" };
export const call = (id: number, action = id) => ({ type: "toolCall", id: `call-${id}`, name: "call", arguments: { action, chain: [{ method: "press", args: [String(id)] }] } });
export const reply = (...content: Any[]) => ({ role: "assistant", api: "test", provider: "anthropic", model: "claude-haiku-5-5", content, stopReason: content.some(part => part.type === "toolCall") ? "toolUse" : "stop", timestamp: 0, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
export const done = () => reply({ type: "text", text: JSON.stringify({ summary: "Done visible", reached: true }) });

/** A tool call of the executor model that sends one chain for the given action. */
export const chainCall = (chain: Any[], action = 0, id = `chain-${action}`) => ({ type: "toolCall", id, name: "call", arguments: { action, chain } });
