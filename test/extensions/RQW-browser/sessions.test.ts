import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, beforeEach, it } from "node:test";
import { createBrowserExtension } from "../../../extensions/RQW-browser/index.ts";

// A fake browser with its own cookie jar, Web Storage and CDP download events. The page-side storage functions of the
// extension really run, against the fake storage of the page's origin.

type Any = any;
const globals = globalThis as Any;
const GUID = "0f8fad5b-d9cb-469f-a165-70867728950e";

class FakeStorage {
	map = new Map<string, string>();
	get length() { return this.map.size; }
	key(index: number) { return [...this.map.keys()][index] ?? null; }
	getItem(key: string) { return this.map.get(key) ?? null; }
	setItem(key: string, value: string) { this.map.set(key, String(value)); }
	clear() { this.map.clear(); }
}

class FakeSession {
	handlers: Record<string, Array<(event: Any) => void>> = {};
	sent: Array<[string, Any]> = [];
	detached = 0;
	on(event: string, handler: (event: Any) => void) { (this.handlers[event] ??= []).push(handler); }
	off(event: string, handler: (event: Any) => void) { this.handlers[event] = (this.handlers[event] ?? []).filter(known => known !== handler); }
	emit(event: string, payload: Any) { return Promise.all((this.handlers[event] ?? []).map(handler => handler(payload))); }
	async send(method: string, params: Any) { this.sent.push([method, params]); }
	async detach() { this.detached++; }
}

function fakeBrowser(setup: Any) {
	const browser: Any = {
		cookies: [] as Any[], locals: new Map<string, FakeStorage>(), pages: [] as Any[], session: new FakeSession(), closed: 0, disconnected: 0,
		navigations: [] as string[], redirects: {} as Record<string, string>, hiddenClosed: 0,
	};
	const put = (cookie: Any) => {
		browser.cookies = browser.cookies.filter((known: Any) => !(known.name === cookie.name && known.domain === cookie.domain && known.path === cookie.path));
		browser.cookies.push(cookie);
	};
	const context: Any = {
		cookies: async () => browser.cookies.map((cookie: Any) => ({ ...cookie })),
		setCookie: async (...list: Any[]) => {
			if (setup.failCookies) throw new Error("refused");
			for (const cookie of list) put({ ...cookie });
		},
		newPage: async () => makePage(true),
	};
	function makePage(hidden: boolean) {
		let url = "about:blank";
		const session = new FakeStorage();
		const origin = () => (url.startsWith("http") ? new URL(url).origin : "null");
		const local = () => {
			if (!browser.locals.has(origin())) browser.locals.set(origin(), new FakeStorage());
			return browser.locals.get(origin())!;
		};
		function inPage<T>(work: () => T): T {
			const scope = { location: { origin: origin() }, localStorage: local(), sessionStorage: session };
			const saved = Object.fromEntries(Object.keys(scope).map(key => [key, Object.getOwnPropertyDescriptor(globals, key)]));
			for (const [key, value] of Object.entries(scope)) Object.defineProperty(globals, key, { value, configurable: true, writable: true });
			const restore = () => {
				for (const [key, descriptor] of Object.entries(saved)) {
					if (descriptor) Object.defineProperty(globals, key, descriptor);
					else delete globals[key];
				}
			};
			try {
				const result = work();
				restore();
				return result;
			} catch (error) {
				restore();
				throw error;
			}
		}
		const page: Any = {
			url: () => url,
			title: async () => "title",
			goto: async (target: string) => {
				browser.navigations.push(target);
				url = browser.redirects[target] ?? target;
				if (setup.blockNavigation) throw new Error("net::ERR_FAILED");
			},
			evaluate: async (fn: Any, ...args: Any[]) => inPage(() => fn(...args)),
			mainFrame: () => ({ client: { on() {} }, _lifecycleEvents: new Set(["load", "DOMContentLoaded"]), detached: false }),
			frames: () => [{ _id: "F1" }],
			browserContext: () => context,
			browser: () => ({ connected: true }),
			isClosed: () => false,
			on() {}, off() {},
			close: async () => { if (hidden) browser.hiddenClosed++; },
			cookies: async (...urls: string[]) => { browser.cookieUrls = urls; return browser.cookies.map((cookie: Any) => ({ ...cookie })); },
			setCookie: async (...list: Any[]) => {
				if (setup.failCookies) throw new Error("refused");
				for (const cookie of list) {
					const host = new URL(cookie.url ?? url).hostname;
					put({ path: "/", expires: -1, httpOnly: false, secure: false, ...cookie, domain: cookie.domain ?? host, url: undefined });
				}
			},
			deleteCookie: async (...list: Any[]) => {
				browser.cookies = browser.cookies.filter((cookie: Any) => !list.some(gone => gone.name === cookie.name && gone.domain === cookie.domain && gone.path === cookie.path));
			},
		};
		browser.pages.push(page);
		return page;
	}
	browser.sessionsCreated = 0;
	browser.target = () => ({ createCDPSession: async () => { browser.sessionsCreated++; await setup.sessionGate; return browser.session; } });
	browser.newPage = async () => makePage(false);
	browser.close = async () => { browser.closed++; };
	browser.disconnect = async () => { browser.disconnected++; };
	return browser;
}

let folder: string;
beforeEach(async () => { folder = await mkdtemp(join(tmpdir(), "browser-sessions-")); });
afterEach(async () => { await rm(folder, { recursive: true, force: true }); });

function setup(options: { failCookies?: boolean; blockNavigation?: boolean; failLaunch?: boolean; sessionGate?: Promise<void> } = {}) {
	let tool: Any;
	let shutdown: () => Promise<void> = async () => {};
	const browsers: Any[] = [];
	const launches: Any[] = [];
	const connects: Any[] = [];
	const dataDir = join(folder, "data");
	const cwd = join(folder, "cwd");
	createBrowserExtension({
		load: async () => ({
			launch: async (args: Any) => {
				launches.push(args);
				if (options.failLaunch) throw new Error("launch failed");
				const browser = fakeBrowser(options);
				browsers.push(browser);
				return browser;
			},
			connect: async (args: Any) => { connects.push(args); const browser = fakeBrowser(options); browsers.push(browser); return browser; },
			Puppeteer: { customQueryHandlerNames: () => [], registerCustomQueryHandler() {} },
		}) as never,
		findSystemChrome: () => "/Applications/Fake Chrome",
		dataDir: () => dataDir,
	})({ registerTool: (value: unknown) => { tool = value; }, on: (event: string, handler: typeof shutdown) => { if (event === "session_shutdown") shutdown = handler; } } as never);
	async function call(input: unknown, signal?: AbortSignal) { return (await tool.execute("id", input, signal, undefined, { cwd })).details.value; }
	return { call, browsers, launches, connects, dataDir, cwd, shutdown: () => shutdown() };
}

// The browser's own profile

it("keeps a persistent profile across closes, apart from the temporary one", async () => {
	const env = setup();
	await env.call({ action: "open", name: "temp" });
	const temporary = env.launches[0].userDataDir;
	await env.call({ action: "open", name: "login", persist: true });
	const profile = env.launches[1].userDataDir;
	assert.equal(dirname(profile), join(env.dataDir, "profiles"));
	assert.match(basename(profile), /^fake-chrome-[0-9a-f]{16}$/);
	assert.ok(existsSync(profile));
	await env.call({ action: "close", all: true });
	assert.equal(existsSync(temporary), false);
	assert.ok(existsSync(profile), "the persistent profile survives close");
	await env.call({ action: "open", name: "again", persist: true });
	assert.equal(env.launches[2].userDataDir, profile);
	await env.shutdown();
	assert.ok(existsSync(profile));
});

it("lets one tab at a time hold a persistent profile and frees it when its tab closes or the launch fails", async () => {
	const env = setup();
	await env.call({ action: "open", name: "one", persist: true });
	await assert.rejects(env.call({ action: "open", name: "two", persist: true }), /persistent profile of this browser is in use by tab "one"; close that tab first/);
	assert.equal(env.launches.length, 1);
	await env.call({ action: "open", name: "temp" });
	await env.call({ action: "close", name: "one" });
	await env.call({ action: "open", name: "two", persist: true });
	assert.equal(env.launches[2].userDataDir, env.launches[0].userDataDir);
	await env.shutdown();

	const failing = setup({ failLaunch: true });
	await assert.rejects(failing.call({ action: "open", persist: true }), /launch failed/);
	await assert.rejects(failing.call({ action: "open", persist: true }), /launch failed/);
});

it("leaves a profile named by the caller to the caller, and ignores persist for a connected browser", async () => {
	const env = setup();
	await env.call({ action: "open", name: "own", persist: true, app: { args: [`--user-data-dir=${join(folder, "mine")}`] } });
	assert.equal(env.launches[0].userDataDir, undefined);
	await env.call({ action: "open", name: "other", persist: true });
	await env.call({ action: "open", name: "cdp", persist: true, app: { cdp_url: "http://localhost:9222" } });
	assert.equal(env.connects.length, 1);
	assert.equal(env.launches.length, 2);
	await env.shutdown();
});


it("saves managed downloads under their suggested names and preserves them on close", async () => {
	const env = setup();
	await env.call({ action: "open", downloads: "saved" });
	const browser = env.browsers[0];
	const [method, behavior] = browser.session.sent[0];
	assert.equal(method, "Browser.setDownloadBehavior");
	assert.deepEqual([behavior.behavior, behavior.downloadPath, behavior.eventsEnabled], ["allowAndName", join(env.cwd, "saved"), true]);
	await writeFile(join(behavior.downloadPath, GUID), "data");
	await browser.session.emit("Browser.downloadWillBegin", { guid: GUID, url: "https://app.test/a", suggestedFilename: "a.txt", frameId: "F1" });
	await browser.session.emit("Browser.downloadProgress", { guid: GUID, state: "completed", receivedBytes: 4 });
	const path = join(behavior.downloadPath, "a.txt");
	assert.equal(await readFile(path, "utf8"), "data");
	await env.call({ action: "close" });
	assert.equal(browser.session.detached, 1);
	assert.equal(await readFile(path, "utf8"), "data");
	await env.shutdown();
});

it("keeps both downloads when the suggested name already exists", async () => {
	const env = setup();
	await env.call({ action: "open", downloads: "saved" });
	const browser = env.browsers[0];
	const directory = browser.session.sent[0][1].downloadPath;
	await writeFile(join(directory, "a.txt"), "original");
	await writeFile(join(directory, GUID), "new");
	await browser.session.emit("Browser.downloadWillBegin", { guid: GUID, suggestedFilename: "a.txt", frameId: "F1" });
	await browser.session.emit("Browser.downloadProgress", { guid: GUID, state: "completed" });
	assert.equal(await readFile(join(directory, "a.txt"), "utf8"), "original");
	assert.equal(await readFile(join(directory, GUID), "utf8"), "new");
	await assert.rejects(env.call({ action: "close" }), /EEXIST/);
	await env.shutdown();
});

it("cleans an empty download folder and keeps a safely named download", async () => {
	const env = setup();
	await env.call({ action: "open", name: "empty" });
	await env.call({ action: "open", name: "full" });
	const empty = env.browsers[0].session.sent[0][1].downloadPath;
	const browser = env.browsers[1];
	const directory = browser.session.sent[0][1].downloadPath;
	await writeFile(join(directory, GUID), "safe");
	await browser.session.emit("Browser.downloadWillBegin", { guid: GUID, url: "https://app.test/a", suggestedFilename: "../../escape.txt", frameId: "F1" });
	await browser.session.emit("Browser.downloadProgress", { guid: GUID, state: "completed", receivedBytes: 4 });
	const path = join(directory, "escape.txt");
	assert.equal(await readFile(path, "utf8"), "safe");
	await env.call({ action: "close", all: true });
	assert.equal(existsSync(empty), false);
	assert.equal(existsSync(path), true);
	await rm(directory, { recursive: true, force: true });
	await env.shutdown();
});

it("keeps foreign downloads untouched unless open names a directory", async () => {
	const env = setup();
	await env.call({ action: "open", name: "foreign", app: { cdp_url: "http://localhost:9222" } });
	assert.deepEqual(env.browsers[0].session.sent, []);
	await env.call({ action: "open", name: "named", downloads: "dl", app: { cdp_url: "http://localhost:9222" } });
	const behavior = env.browsers[1].session.sent[0][1];
	assert.equal(behavior.behavior, "allow");
	assert.equal(behavior.downloadPath, join(env.cwd, "dl"));
	await env.shutdown();
});
