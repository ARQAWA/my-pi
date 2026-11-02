import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import http from "node:http";
import { syncBuiltinESMExports } from "node:module";
import { Duplex } from "node:stream";
import { after, it, type TestContext } from "node:test";
import WebSocket from "ws";
import { call, keys, reportTimings, text, world } from "./synthetic/world.ts";

after(() => {
	reportTimings(import.meta.filename);
	assert.equal("mock" in http.request, false, "a test left its websocket route behind");
});

type World = Awaited<ReturnType<typeof world>>;

const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const CDP_URL = "ws://localhost:9222/devtools/browser/1";

/** Two ends of an in-memory socket: what one writes, the other reads. */
function socketPair(): [Duplex, Duplex] {
	const ends: Duplex[] = [];
	for (const peer of [1, 0]) {
		const end = new Duplex({ read() {}, write(chunk, _encoding, done) { ends[peer]!.push(chunk); done(); } });
		Object.assign(end, { setTimeout: () => end, setNoDelay: () => end, setKeepAlive: () => end });
		ends.push(end);
	}
	return [ends[0]!, ends[1]!];
}

/** A Chrome that has one page and answers the DevTools commands Puppeteer sends; every command name is kept in `commands`. */
function fakeChrome(send: (message: object) => void, commands: string[]) {
	const frame = { id: "F1", loaderId: "L1", url: "about:blank", securityOrigin: "://", mimeType: "text/html" };
	const targetInfo = () => ({ targetId: "T1", type: "page", title: "", url: frame.url, attached: true, canAccessOpener: false, browserContextId: "C1" });
	const axNode = (id: string, role: string, name: string, childIds: string[] = []) =>
		({ nodeId: id, ignored: false, role: { type: "role", value: role }, name: { type: "string", value: name }, childIds, backendDOMNodeId: Number(id) });

	return ({ id, method, params = {}, sessionId }: { id: number; method: string; params?: { url?: string; worldName?: string }; sessionId?: string }) => {
		commands.push(method);
		const inSession = sessionId ? { sessionId } : {};
		const reply = (result: object = {}) => send({ id, result, ...inSession });
		const event = (name: string, body: object, session?: string) => send({ method: name, params: body, ...(session ? { sessionId: session } : {}) });
		switch (method) {
			case "Target.getBrowserContexts":
				return reply({ browserContextIds: [] });
			case "Target.createTarget":
				reply({ targetId: "T1" });
				event("Target.targetCreated", { targetInfo: targetInfo() });
				event("Target.attachedToTarget", { sessionId: "S1", targetInfo: targetInfo(), waitingForDebugger: false });
				return;
			case "Page.getFrameTree":
				return reply({ frameTree: { frame } });
			case "Runtime.enable":
				reply();
				event("Runtime.executionContextCreated", { context: { id: 1, origin: "://", name: "", uniqueId: "U1", auxData: { isDefault: true, type: "default", frameId: "F1" } } }, sessionId);
				return;
			case "Page.createIsolatedWorld":
				reply({ executionContextId: 2 });
				event("Runtime.executionContextCreated", { context: { id: 2, origin: "://", name: params.worldName, uniqueId: "U2", auxData: { isDefault: false, type: "isolated", frameId: "F1" } } }, sessionId);
				return;
			case "Runtime.callFunctionOn":
				// The only script the tool runs here reads the page title.
				return reply({ result: { type: "string", value: "Docs" } });
			case "Page.navigate":
				frame.url = params.url!;
				reply({ frameId: "F1", loaderId: "L2" });
				event("Page.frameNavigated", { frame: { ...frame, loaderId: "L2" }, type: "Navigation" }, sessionId);
				for (const name of ["init", "DOMContentLoaded", "load"]) event("Page.lifecycleEvent", { frameId: "F1", loaderId: "L2", name, timestamp: 1 }, sessionId);
				return;
			case "Accessibility.getFullAXTree":
				return reply({ nodes: [axNode("1", "RootWebArea", "Docs", ["2", "3"]), axNode("2", "heading", "Hello page"), axNode("3", "button", "Go")] });
			default:
				return reply();
		}
	};
}

/**
 * The outside of RQW-browser: a websocket upgrade is answered by an in-memory Chrome. Installed on top of the world's
 * network block; the route is taken back before the world gives the real functions back.
 */
function fakeBrowserEndpoint(t: TestContext) {
	const commands: string[] = [];
	const endpoints: string[] = [];
	let restore: (() => void) | undefined;
	t.after(() => restore?.());
	const upgrade = (options: { host?: string; hostname?: string; path?: string; headers: Record<string, string> }) => {
		endpoints.push(`${options.hostname ?? options.host}${options.path}`);
		const request: any = new EventEmitter();
		request.destroy = () => request;
		request.abort = () => {};
		request.setTimeout = () => request;
		request.end = () => queueMicrotask(() => {
			const [clientEnd, serverEnd] = socketPair();
			const chrome = new WebSocket(null as never, undefined, {});
			(chrome as any).setSocket(serverEnd, Buffer.alloc(0), { maxPayload: 1 << 28 });
			const answer = fakeChrome((message) => chrome.send(JSON.stringify(message)), commands);
			chrome.on("message", (data) => answer(JSON.parse(data.toString())));
			const accepted = createHash("sha1").update(options.headers["Sec-WebSocket-Key"] + WEBSOCKET_GUID).digest("base64");
			request.emit("upgrade", { statusCode: 101, headers: { upgrade: "websocket", "sec-websocket-accept": accepted } }, clientEnd, Buffer.alloc(0));
		});
		return request;
	};
	return {
		commands, endpoints,
		install() {
			const mocked = t.mock.method(http, "request", upgrade as never);
			restore = () => mocked.mock.restore();
			syncBuiltinESMExports();
		},
	};
}

/** The tool result the model saw in its request after `toolCallId`. */
function toolResultText(w: World, toolCallId: string): string {
	const result = w.requests.flatMap((request) => request.context.messages).findLast((message) => message.role === "toolResult" && message.toolCallId === toolCallId) as any;
	return JSON.stringify(result?.content ?? "");
}

/** Like submit, but moves the fake clock until the final answer shows: the browser tool polls a page's load with timers. */
async function submitWithTime(w: World, value: string, finalAnswer: string) {
	w.type(value);
	w.press(keys.enter);
	for (let step = 0; step < 200 && !w.screen().join("\n").includes(finalAnswer); step++) await w.tick(50);
	await w.settle();
}

const attach = { action: "open", name: "docs", url: "https://example.test/docs", app: { cdp_url: CDP_URL } };

it("open attaches to the fake Chrome and markdown gives the page back as Markdown", async (t) => {
	const chrome = fakeBrowserEndpoint(t);
	const w = await world(t);
	chrome.install();
	w.model.script(
		call("browser", attach, "b1"),
		call("browser", { action: "markdown", name: "docs" }, "b2"),
		text("page read"),
	);
	await submitWithTime(w, "look at the docs", "page read");
	w.see("page read");
	assert.match(toolResultText(w, "b1"), /https:\/\/example\.test\/docs/);
	const markdown = toolResultText(w, "b2");
	assert.match(markdown, /## Hello page/);
	assert.match(markdown, /- button: Go/);
	assert.doesNotMatch(markdown, /\[id:/);
	assert.deepEqual(chrome.endpoints, ["localhost/devtools/browser/1"]);
	assert.ok(chrome.commands.includes("Page.navigate"));
	assert.deepEqual(w.networkAttempts, []);
});

it("a tab that was never opened is refused and close leaves the attached Chrome running", async (t) => {
	const chrome = fakeBrowserEndpoint(t);
	const w = await world(t);
	chrome.install();
	w.model.script(
		call("browser", { action: "markdown", name: "ghost" }, "b1"),
		call("browser", attach, "b2"),
		call("browser", { action: "close", name: "docs" }, "b3"),
		call("browser", { action: "tabs" }, "b4"),
		text("tabs finished"),
	);
	await submitWithTime(w, "try it", "tabs finished");
	assert.match(toolResultText(w, "b1"), /No tab named \\"ghost\\"/);
	assert.match(toolResultText(w, "b3"), /closed/);
	assert.doesNotMatch(toolResultText(w, "b4"), /docs/);
	assert.equal(chrome.commands.some((command) => command === "Browser.close" || command === "Target.closeTarget"), false);
});
