import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, beforeEach, it } from "node:test";
import { createBrowserExtension } from "../../../extensions/RQW-browser/index.ts";

// A fake browser with its own cookie jar, Web Storage and CDP download events. The page-side storage functions of the
// extension really run, against the fake storage of the page's origin.

type Any = any;
const globals = globalThis as Any;
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
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
	emit(event: string, payload: Any) { for (const handler of this.handlers[event] ?? []) handler(payload); }
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
	const chain = (...steps: Array<[string, ...unknown[]]>) => ({ action: "call", chain: steps.map(([method, ...args]) => ({ method, args })) });
	return { call, chain, browsers, launches, connects, dataDir, cwd, shutdown: () => shutdown(), description: () => tool.description as string };
}

// Cookies

it("sets cookies from objects, Cookie headers, cURL dumps and JSON, with a trailing scope", async () => {
	const env = setup();
	await env.call({ action: "open", url: "https://app.test/" });
	await env.call(env.chain(["setCookies", { name: "a", value: "1", httpOnly: true, sameSite: "Strict" }]));
	await env.call(env.chain(["setCookies", "Cookie: b=2; c=3", { domain: "other.test" }]));
	await env.call(env.chain(["setCookies", `curl 'https://x.test' -H 'accept: */*' -H 'Cookie: d=4'`]));
	await env.call(env.chain(["setCookies", `[{"name":"e","value":"5","path":"/app"}]`]));
	const cookies = await env.call(env.chain(["cookies"]));
	assert.deepEqual(cookies.map((cookie: Any) => [cookie.name, cookie.value, cookie.domain, cookie.path]), [
		["a", "1", "app.test", "/"], ["b", "2", "other.test", "/"], ["c", "3", "other.test", "/"], ["d", "4", "app.test", "/"], ["e", "5", "app.test", "/app"],
	]);
	assert.deepEqual(cookies[0], { name: "a", value: "1", domain: "app.test", path: "/", expires: -1, httpOnly: true, secure: false, sameSite: "Strict" });
	// A cookie without a SameSite policy reads as Lax.
	assert.equal(cookies[1].sameSite, "Lax");
	await env.shutdown();
});

it("rejects malformed cookie input with oh-my-pi's message and names a refused cookie", async () => {
	const env = setup();
	await env.call({ action: "open", url: "https://app.test/" });
	for (const bad of [[], [""], ["no-equals"], [{ name: "bad name", value: "x" }], [{ name: "a", value: 1 }], ["[]"], [{ name: "a", value: "1", sameSite: "Wild" }]]) {
		await assert.rejects(env.call(env.chain(["setCookies", ...bad])), /tab\.setCookies\(\) received malformed cookie input/);
	}
	const refusing = setup({ failCookies: true });
	await refusing.call({ action: "open", url: "https://app.test/" });
	await assert.rejects(refusing.call(refusing.chain(["setCookies", { name: "a", value: "1" }])), /tab\.setCookies\(\) could not set the supplied cookies/);
	await env.shutdown();
	await refusing.shutdown();
});

it("reads cookies of given urls and clears all or named cookies", async () => {
	const env = setup();
	await env.call({ action: "open", url: "https://app.test/" });
	await env.call(env.chain(["setCookies", "a=1; b=2; c=3"]));
	await env.call(env.chain(["cookies", { urls: ["https://app.test/x"] }]));
	assert.deepEqual(env.browsers[0].cookieUrls, ["https://app.test/x"]);
	await assert.rejects(env.call(env.chain(["cookies", { urls: "https://app.test" }])), /expects urls to be an array/);
	await env.call(env.chain(["clearCookies", { names: ["a", "c"] }]));
	assert.deepEqual((await env.call(env.chain(["cookies"]))).map((cookie: Any) => cookie.name), ["b"]);
	await assert.rejects(env.call(env.chain(["clearCookies", { names: "b" }])), /expects names to be an array/);
	await env.call(env.chain(["clearCookies"]));
	assert.deepEqual(await env.call(env.chain(["cookies"])), []);
	await env.shutdown();
});

// Storage

it("writes, reads and clears local and session storage of the current origin", async () => {
	const env = setup();
	await env.call({ action: "open", url: "https://app.test/" });
	await env.call(env.chain(["setStorage", "local", "token", "abc"], ["setStorage", "local", { theme: "dark", prefs: { a: [1, 2] } }], ["setStorage", "session", "step", 3]));
	assert.deepEqual(await env.call(env.chain(["storage", "local"])), { token: "abc", theme: "dark", prefs: '{"a":[1,2]}' });
	assert.equal(await env.call(env.chain(["storage", "local", { key: "token" }])), "abc");
	assert.equal(await env.call(env.chain(["storage", "local", { key: "nope" }])), null);
	assert.deepEqual(await env.call(env.chain(["storage", "session"])), { step: "3" });
	await env.call(env.chain(["clearStorage", "local"]));
	assert.deepEqual(await env.call(env.chain(["storage", "local"])), {});
	assert.deepEqual(await env.call(env.chain(["storage", "session"])), { step: "3" });
	for (const step of [["storage", "cookie"], ["setStorage", "cookie", "a", "b"], ["clearStorage", "x"]] as Array<[string, ...unknown[]]>) {
		await assert.rejects(env.call(env.chain(step)), /Storage kind must be "local" or "session"/);
	}
	await assert.rejects(env.call(env.chain(["setStorage", "local", 5])), /expects a key\/value object/);
	await assert.rejects(env.call(env.chain(["storage", "local", { key: 5 }])), /expects key to be a string/);
	await env.shutdown();
});

// Saving and restoring state

async function savedLogin(env: ReturnType<typeof setup>, options: Record<string, unknown> = {}) {
	await env.call({ action: "open", name: "shop", url: "https://app.test/", ...options });
	await env.call({ ...env.chain(["setCookies", { name: "sid", value: "s1", expires: 4_102_444_800 }], ["setCookies", { name: "tmp", value: "t" }], ["setStorage", "local", "token", "abc"], ["setStorage", "session", "step", "2"]), name: "shop" });
}

it("saves the state to the extension's own state folder under the tab's name, readable by its owner only", async () => {
	const env = setup();
	await savedLogin(env);
	const path = await env.call({ ...env.chain(["saveState"]), name: "shop" });
	assert.equal(path, join(env.dataDir, "state", "shop.json"));
	const state = JSON.parse(await readFile(path, "utf8"));
	assert.deepEqual(state.cookies.map((cookie: Any) => [cookie.name, cookie.expires]), [["sid", 4_102_444_800], ["tmp", -1]]);
	assert.deepEqual(state.origins, [{ origin: "https://app.test", localStorage: [{ name: "token", value: "abc" }], sessionStorage: [{ name: "step", value: "2" }] }]);
	if (process.platform !== "win32") assert.equal((await stat(path)).mode & 0o777, 0o600);
	assert.deepEqual(await readdir(join(env.dataDir, "state")), ["shop.json"]);
	await env.shutdown();
});

it("does not follow a link planted at a predictable temporary name when saving", { skip: process.platform === "win32" }, async () => {
	const env = setup();
	await env.call({ action: "open", name: "shop", url: "https://app.test/" });
	const victim = join(folder, "victim.txt");
	await writeFile(victim, "keep");
	const target = join(folder, "shared", "state.json");
	await mkdir(join(folder, "shared"));
	await symlink(victim, `${target}.${process.pid}.tmp`);
	await env.call({ ...env.chain(["saveState", target]), name: "shop" });
	assert.equal(await readFile(victim, "utf8"), "keep");
	assert.deepEqual(JSON.parse(await readFile(target, "utf8")).origins, [{ origin: "https://app.test", localStorage: [], sessionStorage: [] }]);
	await env.shutdown();
});

it("leaves no copy of the state behind when it cannot be saved", async () => {
	const env = setup();
	await env.call({ action: "open", name: "shop", url: "https://app.test/" });
	const target = join(folder, "taken");
	await mkdir(target);
	await assert.rejects(env.call({ ...env.chain(["saveState", target]), name: "shop" }));
	assert.deepEqual(await readdir(folder).then(names => names.filter(name => name.startsWith("taken"))), ["taken"]);
	await env.shutdown();
});

it("saves to a requested path relative to the session folder and names an unsafe tab safely", async () => {
	const env = setup();
	await env.call({ action: "open", name: "../evil", url: "https://app.test/" });
	assert.equal(await env.call({ ...env.chain(["saveState", "out/login.json"]), name: "../evil" }), join(env.cwd, "out", "login.json"));
	assert.ok(existsSync(join(env.cwd, "out", "login.json")));
	assert.equal(await env.call({ ...env.chain(["saveState"]), name: "../evil" }), join(env.dataDir, "state", ".._evil.json"));
	await env.shutdown();
});

it("restores saved cookies and storage into a fresh browser after the first one is closed", async () => {
	const first = setup();
	await savedLogin(first);
	const path = await first.call({ ...first.chain(["saveState"]), name: "shop" });
	await first.call({ action: "close", all: true });
	assert.equal(first.browsers[0].closed, 1);

	const second = setup();
	await second.call({ action: "open", name: "shop", url: "https://app.test/" });
	assert.deepEqual(await second.call({ ...second.chain(["storage", "local"]), name: "shop" }), {});
	const result = await second.call({ ...second.chain(["loadState", path]), name: "shop" });
	assert.deepEqual(result, { loadedOrigins: ["https://app.test"], skippedOrigins: [] });
	assert.deepEqual((await second.call({ ...second.chain(["cookies"]), name: "shop" })).map((cookie: Any) => [cookie.name, cookie.value, cookie.expires]), [["sid", "s1", 4_102_444_800], ["tmp", "t", -1]]);
	assert.deepEqual(await second.call({ ...second.chain(["storage", "local"]), name: "shop" }), { token: "abc" });
	assert.deepEqual(await second.call({ ...second.chain(["storage", "session"]), name: "shop" }), { step: "2" });
	await first.shutdown();
	await second.shutdown();
});

it("restores the storage of other origins through a hidden page only in a hidden managed browser", async () => {
	const origins = [
		{ origin: "https://app.test", localStorage: [{ name: "here", value: "1" }] },
		{ origin: "https://api.test", localStorage: [{ name: "token", value: "x" }] },
		{ origin: "https://sess.test", localStorage: [], sessionStorage: [{ name: "s", value: "1" }] },
		{ origin: "https://moved.test", localStorage: [{ name: "m", value: "1" }] },
	];
	const env = setup();
	const path = join(folder, "state.json");
	await writeFile(path, JSON.stringify({ cookies: [], origins }));
	await env.call({ action: "open", url: "https://app.test/" });
	env.browsers[0].redirects["https://moved.test/"] = "https://elsewhere.test/";
	assert.deepEqual(await env.call(env.chain(["loadState", path])), { loadedOrigins: ["https://app.test", "https://api.test"], skippedOrigins: ["https://sess.test", "https://moved.test"] });
	assert.deepEqual(env.browsers[0].navigations, ["https://app.test/", "https://api.test/", "https://moved.test/"]);
	assert.equal(env.browsers[0].locals.get("https://api.test").getItem("token"), "x");
	assert.equal(env.browsers[0].hiddenClosed, 2);

	const watched = setup();
	await watched.call({ action: "open", url: "https://app.test/", headed: true });
	assert.deepEqual(await watched.call(watched.chain(["loadState", path])), { loadedOrigins: ["https://app.test"], skippedOrigins: ["https://api.test", "https://sess.test", "https://moved.test"] });
	assert.deepEqual(watched.browsers[0].navigations, ["https://app.test/"]);
	await env.shutdown();
	await watched.shutdown();
});

it("rejects a state file that is missing or malformed, and a state that cannot be applied", async () => {
	const env = setup();
	await env.call({ action: "open", url: "https://app.test/" });
	await assert.rejects(env.call(env.chain(["loadState", "broken.json"])), /tab\.loadState\(\) received an invalid browser state file/);
	await assert.rejects(env.call(env.chain(["loadState"])), /received an invalid browser state file/);
	await writeFile(join(folder, "bad.json"), JSON.stringify({ cookies: [{ name: "a", value: "1" }], origins: [] }));
	await assert.rejects(env.call(env.chain(["loadState", join(folder, "bad.json")])), /received an invalid browser state file/);
	await writeFile(join(folder, "bad.json"), JSON.stringify({ cookies: [], origins: [{ origin: "https://a.test/path", localStorage: [] }] }));
	await assert.rejects(env.call(env.chain(["loadState", join(folder, "bad.json")])), /received an invalid browser state file/);
	await writeFile(join(folder, "refused.json"), JSON.stringify({ cookies: [{ name: "a", value: "1", domain: "app.test", path: "/", expires: -1 }], origins: [] }));
	const refusing = setup({ failCookies: true });
	await refusing.call({ action: "open", url: "https://app.test/" });
	await assert.rejects(refusing.call(refusing.chain(["loadState", join(folder, "refused.json")])), /could not restore cookies from the browser state file/);
	await env.shutdown();
	await refusing.shutdown();
});

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

// Downloads

/** A wait is registered once it has pointed the download folder at its tab, which `sent` shows. */
async function waitStarted(browser: Any, sentBefore: number) {
	while (browser.session.sent.length <= sentBefore) await tick();
	await tick();
}

function download(browser: Any, name: string, options: { frameId?: string; guid?: string; body?: string; state?: string } = {}) {
	const guid = options.guid ?? GUID;
	const [, behavior] = browser.session.sent.findLast(([method]: [string]) => method === "Browser.setDownloadBehavior");
	const finish = async () => {
		// A browser Chromium names files in saves them under their GUID; a connected one under the suggested name.
		const saved = behavior.behavior === "allowAndName" ? guid : name;
		if (options.state !== "canceled") await writeFile(join(behavior.downloadPath, saved), options.body ?? "data");
		browser.session.emit("Browser.downloadProgress", { guid, state: options.state ?? "completed", receivedBytes: (options.body ?? "data").length });
	};
	browser.session.emit("Browser.downloadWillBegin", { guid, url: `https://app.test/${name}`, suggestedFilename: name, frameId: options.frameId ?? "F1" });
	return finish();
}

it("tracks downloads of a managed browser from open and names each file as the page suggested", async () => {
	const env = setup();
	await env.call({ action: "open", url: "https://app.test/" });
	const browser = env.browsers[0];
	const [method, behavior] = browser.session.sent[0];
	assert.equal(method, "Browser.setDownloadBehavior");
	assert.deepEqual([behavior.behavior, behavior.eventsEnabled], ["allowAndName", true]);
	assert.ok(existsSync(behavior.downloadPath));
	await download(browser, "report.csv", { body: "a,b" });
	const finished = await env.call(env.chain(["waitForDownload"]));
	assert.deepEqual(finished, { path: join(behavior.downloadPath, "report.csv"), suggestedFilename: "report.csv", url: "https://app.test/report.csv", bytes: 3 });
	assert.equal(await readFile(finished.path, "utf8"), "a,b");
	assert.deepEqual(await env.call(env.chain(["downloads"])), [finished]);
	await env.shutdown();
});

it("hands each finished download to one wait, in order, and also to a wait that began first", async () => {
	const env = setup();
	await env.call({ action: "open" });
	const browser = env.browsers[0];
	const waiting = env.call(env.chain(["waitForDownload"]));
	await waitStarted(browser, 1);
	await download(browser, "first.txt", { guid: GUID });
	assert.equal((await waiting).suggestedFilename, "first.txt");
	await download(browser, "second.txt", { guid: "1f8fad5b-d9cb-469f-a165-70867728950e" });
	await download(browser, "third.txt", { guid: "2f8fad5b-d9cb-469f-a165-70867728950e" });
	assert.equal((await env.call(env.chain(["waitForDownload"]))).suggestedFilename, "second.txt");
	assert.equal((await env.call(env.chain(["waitForDownload"]))).suggestedFilename, "third.txt");
	assert.deepEqual((await env.call(env.chain(["downloads"]))).map((entry: Any) => entry.suggestedFilename), ["first.txt", "second.txt", "third.txt"]);
	await env.shutdown();
});

it("ignores downloads of other tabs, reports a cancelled one and times out a wait", async () => {
	const env = setup();
	await env.call({ action: "open" });
	const browser = env.browsers[0];
	await download(browser, "foreign.txt", { frameId: "OTHER" });
	await assert.rejects(env.call({ ...env.chain(["waitForDownload", { timeout: 30 }]) }), /tab\.waitForDownload\(\) timed out after 30ms/);
	assert.deepEqual(await env.call(env.chain(["downloads"])), []);
	const sent = browser.session.sent.length;
	const waiting = env.call(env.chain(["waitForDownload"]));
	await waitStarted(browser, sent);
	await download(browser, "gone.txt", { state: "canceled" });
	await assert.rejects(waiting, /Download canceled: https:\/\/app\.test\/gone\.txt/);
	await env.shutdown();
});

it("keeps a download under its Chromium name when the suggested name is not a plain file name or the file is not its own", async () => {
	const env = setup();
	await env.call({ action: "open" });
	const browser = env.browsers[0];
	await download(browser, "../../escape.txt");
	const escaped = await env.call(env.chain(["waitForDownload"]));
	assert.equal(escaped.path, join(browser.session.sent[0][1].downloadPath, "escape.txt"));
	await download(browser, "named.txt", { guid: "not-a-guid" });
	const odd = await env.call(env.chain(["waitForDownload"]));
	assert.equal(odd.path.endsWith("not-a-guid"), true);
	await env.shutdown();
});

it("sends downloads to a directory the caller names, relative to the session folder, and keeps its files on close", async () => {
	const env = setup();
	await env.call({ action: "open", downloads: "saved" });
	const browser = env.browsers[0];
	assert.equal(browser.session.sent[0][1].downloadPath, join(env.cwd, "saved"));
	await download(browser, "kept.txt");
	const finished = await env.call(env.chain(["waitForDownload"]));
	assert.equal(finished.path, join(env.cwd, "saved", "kept.txt"));
	await env.call({ action: "close" });
	assert.ok(existsSync(finished.path));
	assert.equal(browser.session.detached, 1);
	assert.equal(env.browsers[0].closed, 1);
});

it("removes the empty default download folder on close and keeps one that holds a download", async () => {
	const env = setup();
	await env.call({ action: "open", name: "empty" });
	await env.call({ action: "open", name: "full" });
	const emptyFolder = env.browsers[0].session.sent[0][1].downloadPath;
	const fullFolder = env.browsers[1].session.sent[0][1].downloadPath;
	await download(env.browsers[1], "keep.txt");
	await env.call({ ...env.chain(["waitForDownload"]), name: "full" });
	await env.call({ action: "close", all: true });
	assert.equal(existsSync(emptyFolder), false);
	assert.ok(existsSync(join(fullFolder, "keep.txt")));
	await rm(fullFolder, { recursive: true, force: true });
});

it("leaves the downloads of a connected browser alone until asked", async () => {
	const env = setup();
	await env.call({ action: "open", app: { cdp_url: "http://localhost:9222" } });
	const browser = env.browsers[0];
	assert.deepEqual(browser.session.sent, []);
	assert.deepEqual(await env.call(env.chain(["downloads"])), []);
	const waiting = env.call({ ...env.chain(["waitForDownload", { timeout: 1000 }]) });
	await waitStarted(browser, 0);
	assert.equal(browser.session.sent[0][1].behavior, "allow");
	await download(browser, "theirs.txt");
	assert.equal((await waiting).path.endsWith("theirs.txt"), true);
	await env.call({ action: "close" });
	assert.equal(browser.disconnected, 1);
	await env.shutdown();

	const named = setup();
	await named.call({ action: "open", downloads: "dl", app: { cdp_url: "ws://localhost:9222/devtools/browser/1" } });
	assert.deepEqual([named.browsers[0].session.sent[0][1].behavior, named.browsers[0].session.sent[0][1].downloadPath], ["allow", join(named.cwd, "dl")]);
	await named.shutdown();
});

it("attaches download tracking once when a wait is cancelled mid-attach, and detaches a session that arrives after close", async () => {
	let open!: () => void;
	const env = setup({ sessionGate: new Promise<void>(resolve => { open = resolve; }) });
	await env.call({ action: "open", app: { cdp_url: "http://localhost:9222" } });
	const browser = env.browsers[0];
	const controller = new AbortController();
	const first = env.call(env.chain(["waitForDownload"]), controller.signal);
	while (!browser.sessionsCreated) await tick();
	controller.abort();
	await assert.rejects(first, /abort/i);
	const second = env.call({ ...env.chain(["waitForDownload", { timeout: 1000 }]) });
	await tick();
	await tick();
	assert.equal(browser.sessionsCreated, 1);
	open();
	await waitStarted(browser, 0);
	await download(browser, "once.txt", { guid: GUID });
	assert.equal((await second).suggestedFilename, "once.txt");
	assert.equal((await env.call(env.chain(["downloads"]))).length, 1);
	await env.shutdown();

	let release!: () => void;
	const late = setup({ sessionGate: new Promise<void>(resolve => { release = resolve; }) });
	await late.call({ action: "open", app: { cdp_url: "http://localhost:9222" } });
	const abandoned = new AbortController();
	const waiting = late.call(late.chain(["waitForDownload"]), abandoned.signal);
	while (!late.browsers[0].sessionsCreated) await tick();
	abandoned.abort();
	await assert.rejects(waiting, /abort/i);
	await late.call({ action: "close" });
	release();
	for (let waited = 0; waited < 50 && !late.browsers[0].session.detached; waited++) await tick();
	assert.equal(late.browsers[0].session.detached, 1);
	await late.shutdown();
});

// Description

it("describes the session helpers with oh-my-pi's wording", async () => {
	const { description } = setup();
	for (const line of [
		"- `open` options: `name`, `url`, `app`, `wait_until`, `dialogs`, `downloads`, `headed`, `viewport: {width, height, scale?}`, `timeout`, `persist`.",
		"Storage: `cookies`, `setCookies`, `clearCookies`, `storage`, `setStorage`, `clearStorage`, `saveState`, `loadState`; cookie imports accept objects, raw `Cookie:` headers, DevTools cURL dumps, or JSON arrays.",
		"Downloads: `waitForDownload`, `downloads`.",
		"`select`, `uploadFile`.",
	]) assert.ok(description().includes(line), line);
});
