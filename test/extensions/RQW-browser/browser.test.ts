import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { PassThrough } from "node:stream";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { it } from "node:test";
import { createBrowserExtension } from "../../../extensions/RQW-browser/index.ts";

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(done => { resolve = done; });
	return { promise, resolve };
}

function setup(options: { launchWait?: Promise<unknown>; viewportWait?: Promise<unknown>; spawnStall?: boolean; titleWait?: Promise<string>; downloadWait?: Promise<unknown>; systemChrome?: string; realSystem?: boolean; launchError?: Error; downloadError?: Error } = {}) {
	let tool: any;
	let shutdown: () => Promise<void> = async () => {};
	let loads = 0;
	let downloads = 0;
	const launches: any[] = [];
	const connects: any[] = [];
	const browsers: any[] = [];
	const installs: any[] = [];
	const spawned: any[] = [];
	function browser(child?: any) {
		let url = "about:blank";
		const process = child ?? Object.assign(new EventEmitter(), { exitCode: null, signalCode: null, kills: 0, kill() { this.kills++; this.emit("exit"); return true; } });
		const page = {
			mainFrame: () => ({ client: { on() {} }, _lifecycleEvents: new Set(["load", "DOMContentLoaded"]), detached: false }),
			browserContext: () => ({}),
			url: () => url,
			title: async () => options.titleWait ? await options.titleWait : `title of ${url}`,
			goto: async (value: string) => { url = value; },
			setViewport: async (viewport: unknown) => { instance.viewport = viewport; if (options.viewportWait) await options.viewportWait; },
			isClosed: () => false,
			close: async () => { instance.pageClosed++; },
			browser: () => ({ connected: true }),
			on() {},
			off() {},
		};
		const instance: any = { closed: 0, disconnected: 0, pageClosed: 0, child: process, page, viewport: undefined,
			process: () => process,
			target: () => ({ createCDPSession: async () => ({ send: async () => {}, on() {}, off() {}, detach: async () => {} }) }),
			newPage: async () => page,
			close: async () => { instance.closed++; },
			disconnect: async () => { instance.disconnected++; },
		};
		browsers.push(instance);
		return instance;
	}
	createBrowserExtension({
		spawnProcess: ((_path: string) => {
			const child = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null, kills: 0, unrefs: 0, stderr: new PassThrough(), unref() { this.unrefs++; }, kill() { this.kills++; this.emit("exit"); return true; } });
			spawned.push(child);
			queueMicrotask(() => { if (options.launchError) child.emit("error", options.launchError); else if (!options.spawnStall) child.stderr.write("DevTools listening on ws://localhost/devtools/browser/app\n"); });
			return child;
		}) as never,
		load: async () => {
			loads++;
			return {
				launch: async (args: unknown) => { launches.push(args); if (options.launchError) throw options.launchError; if (options.launchWait) await options.launchWait; return browser(); },
				defaultArgs: (args: unknown) => { launches.push(args); return []; },
				connect: async (args: any) => { if (args.browserWSEndpoint === "ws://localhost/devtools/browser/app") return browser(spawned.at(-1)); connects.push(args); return browser(); },
				Puppeteer: { customQueryHandlerNames: () => [], registerCustomQueryHandler() {} },
			} as never;
		},
		...(options.realSystem ? {} : { findSystemChrome: () => options.systemChrome }),
		loadManager: async () => ({
			detectBrowserPlatform: () => process.platform === "win32" ? "win64" : "mac_arm",
			Browser: { CHROME: "chrome" },
			install: async (args: unknown) => { installs.push(args); downloads++; if (options.downloadError) throw options.downloadError; if (options.downloadWait) await options.downloadWait; return { executablePath: "/fake/chrome" }; },
		}) as never,
	})({ registerTool: (value: unknown) => { tool = value; }, on: (event: string, handler: typeof shutdown) => { if (event === "session_shutdown") shutdown = handler; } } as never);
	async function call(input: unknown, signal?: AbortSignal) {
		const result = await tool.execute("id", input, signal, undefined, {});
		return result.details.value;
	}
	return { call, shutdown: () => shutdown(), launches, connects, browsers, spawned, installs, loads: () => loads, downloads: () => downloads };
}

it("does not import browser dependencies at extension load or registration", async () => {
	const imports: string[] = [];
	const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
		if (specifier === "puppeteer-core" || specifier === "@puppeteer/browsers") imports.push(specifier);
		return nextResolve(specifier, context);
	} });
	try {
		const module = await import("../../../extensions/RQW-browser/index.ts?startup-check");
		module.default({ registerTool() {}, on() {} } as never);
		assert.deepEqual(imports, []);
	} finally { hooks.deregister(); }
});

it("registers the public browser tool and answers through its entry", async () => {
	const { default: extension } = await import("../../../extensions/RQW-browser/index.ts");
	let tool: any;
	extension({ registerTool(value: unknown) { tool = value; }, on() {} } as never);
	assert.equal(tool.name, "browser");
	const result = await tool.execute("id", { action: "tabs" }, undefined, undefined, {});
	assert.deepEqual(result.details.value, []);
	assert.deepEqual(result.content, [{ type: "text", text: "[]" }]);
});

it("loads lazily and launches separate profiles with path and display settings", async () => {
	const env = setup();
	assert.equal(env.loads(), 0);
	assert.equal(env.downloads(), 0);
	await env.call({ action: "open", name: "first", headed: true, app: { path: "/custom/chrome", args: ["--flag"] } });
	assert.equal(env.downloads(), 0);
	assert.equal(env.launches[0].executablePath, resolve("/custom/chrome"));
	assert.equal(env.launches[0].headless, false);
	assert.deepEqual(env.launches[0].args, ["--flag"]);
	const profile = env.launches[0].userDataDir;
	assert.ok(existsSync(profile));
	await env.call({ action: "open", name: "second" });
	assert.equal(env.downloads(), 1);
	assert.equal(env.launches[1].executablePath, "/fake/chrome");
	assert.equal(env.launches[1].headless, true);
	assert.notEqual(env.launches[1].userDataDir, profile);
	await env.call({ action: "close", all: true, kill: true });
	assert.equal(env.browsers[0].child.kills, 1);
	assert.equal(env.browsers[1].closed, 1);
});

it("names and lists tabs", async () => {
	const env = setup();
	await env.call({ action: "open", name: "one", url: "https://one.test" });
	await env.call({ action: "open", name: "two", url: "https://two.test" });
	assert.deepEqual(await env.call({ action: "tabs" }), [{ name: "one", url: "https://one.test" }, { name: "two", url: "https://two.test" }]);
	await env.call({ action: "close", name: "one" });
	assert.equal(env.browsers[0].closed, 1);
	assert.equal(env.browsers[1].closed, 0);
	await env.shutdown();
	assert.equal(env.browsers[1].closed, 1);
});

it("sets the requested viewport before navigation", async () => {
	const env = setup();
	await env.call({ action: "open", viewport: { width: 900, height: 600, scale: 2 }, url: "https://example.test" });
	assert.deepEqual(env.browsers[0].viewport, { width: 900, height: 600, deviceScaleFactor: 2 });
	await env.shutdown();
});

it("cancels a stalled viewport and releases the partially opened browser", async () => {
	const pending = deferred<void>();
	const env = setup({ viewportWait: pending.promise });
	const controller = new AbortController();
	const opening = env.call({ action: "open", viewport: { width: 900, height: 600 } }, controller.signal);
	while (!env.browsers[0]?.viewport) await new Promise<void>(resolve => setImmediate(resolve));
	controller.abort();
	await assert.rejects(opening, /abort/i);
	assert.deepEqual(await env.call({ action: "tabs" }), []);
	assert.equal(env.browsers[0].closed, 1);
	pending.resolve();
	await env.shutdown();
});

it("prefers system Chrome to a download", async () => {
	const env = setup({ systemChrome: "/installed/chrome" });
	await env.call({ action: "open" });
	assert.equal(env.launches[0].executablePath, "/installed/chrome");
	assert.equal(env.downloads(), 0);
	await env.shutdown();
});

it("reports a missing Chrome and a failed download with the cause and a path alternative", async () => {
	const env = setup({ downloadError: new Error("certificate rejected") });
	await assert.rejects(env.call({ action: "open" }), /System Chrome was not found.*download failed.*app\.path.*certificate rejected/);
	await env.shutdown();
});

it("reports a missing or blocked executable and keeps the launch cause", async () => {
	for (const message of ["ENOENT", "access denied"]) {
		const env = setup({ launchError: new Error(message) });
		await assert.rejects(env.call({ action: "open", app: { path: "chrome.exe" } }), new RegExp(`Could not start browser.*exists.*allowed.*${message}`));
		await env.shutdown();
		assert.equal(existsSync(env.launches[0].userDataDir), false);
	}
});

it("finds Windows Chrome in each user or program folder and uses the user cache for downloads", async () => {
	const root = await mkdtemp(join(tmpdir(), "browser-windows-"));
	const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")!;
	const keys = ["PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"] as const;
	const old = keys.map(key => process.env[key]);
	try {
		Object.defineProperty(process, "platform", { value: "win32", configurable: true });
		for (const [index, key] of keys.entries()) process.env[key] = join(root, String(index));
		for (const key of keys) {
			const path = join(process.env[key]!, "Google", "Chrome", "Application", "chrome.exe");
			await mkdir(join(process.env[key]!, "Google", "Chrome", "Application"), { recursive: true });
			await writeFile(path, "");
			const env = setup({ realSystem: true });
			await env.call({ action: "open" });
			assert.equal(env.launches[0].executablePath, path);
			assert.equal(env.downloads(), 0);
			await env.call({ action: "close" });
			assert.equal(env.browsers[0].closed, 1);
			await env.shutdown();
			await rm(path);
		}
		const env = setup({ realSystem: true });
		await env.call({ action: "open" });
		assert.equal(env.installs[0].cacheDir, join(process.env.LOCALAPPDATA!, "my-pi", "browser"));
		assert.equal(env.installs[0].browser, "chrome");
		assert.equal(env.installs[0].platform, "win64");
		await env.shutdown();
	} finally {
		Object.defineProperty(process, "platform", originalPlatform);
		for (const [index, key] of keys.entries()) {
			if (old[index] === undefined) delete process.env[key];
			else process.env[key] = old[index];
		}
		await rm(root, { recursive: true, force: true });
	}
});

it("shares an unfinished download after an aborted open", async () => {
	const pending = deferred<void>();
	const env = setup({ downloadWait: pending.promise });
	const controller = new AbortController();
	const first = env.call({ action: "open", name: "first" }, controller.signal);
	while (!env.downloads()) await new Promise<void>(resolve => setImmediate(resolve));
	controller.abort();
	await assert.rejects(first, /abort/i);
	const second = env.call({ action: "open", name: "second" });
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(env.downloads(), 1);
	pending.resolve();
	await second;
	assert.equal(env.launches[0].executablePath, "/fake/chrome");
	await env.shutdown();
});

it("kills only the selected spawned application when requested", async () => {
	const env = setup();
	await env.call({ action: "open", name: "one", app: { path: "/app" } });
	await env.call({ action: "open", name: "two", app: { path: "/app" } });
	await env.call({ action: "close", name: "one", kill: false });
	assert.equal(env.browsers[0].child.kills, 0);
	assert.equal(env.browsers[0].child.unrefs, 1);
	assert.equal(env.browsers[0].pageClosed, 1);
	assert.equal(env.browsers[1].child.kills, 0);
	await env.call({ action: "close", name: "two", kill: true });
	assert.equal(env.browsers[1].child.kills, 1);
	assert.equal(env.browsers[1].closed, 0);
	env.browsers[0].child.emit("exit");
	await env.shutdown();
});

it("releases multiple applications without killing them at session shutdown", async () => {
	const env = setup();
	await env.call({ action: "open", name: "one", app: { path: "/app" } });
	await env.call({ action: "open", name: "two", app: { path: "/app" } });
	await env.shutdown();
	assert.deepEqual(env.browsers.map(browser => browser.child.kills), [0, 0]);
	assert.deepEqual(env.browsers.map(browser => browser.disconnected), [1, 1]);
	for (const browser of env.browsers) browser.child.emit("exit");
});

it("kills and cleans a spawned application if open is cancelled before CDP starts", async () => {
	const env = setup({ spawnStall: true });
	const controller = new AbortController();
	const opening = env.call({ action: "open", app: { path: "/app" } }, controller.signal);
	while (!env.spawned.length) await new Promise<void>(resolve => setImmediate(resolve));
	const profile = env.launches[0].userDataDir;
	controller.abort();
	await assert.rejects(opening, /abort/i);
	await env.shutdown();
	assert.equal(env.spawned[0].kills, 1);
	assert.equal(existsSync(profile), false);
});

it("does not delete a live application's profile when page close is cancelled", async () => {
	const env = setup();
	await env.call({ action: "open", app: { path: "/app" } });
	const browser = env.browsers[0];
	const profile = env.launches[0].userDataDir;
	browser.page.close = async () => await new Promise(() => {});
	const controller = new AbortController();
	const closing = env.call({ action: "close" }, controller.signal);
	await new Promise<void>(resolve => setImmediate(resolve));
	controller.abort();
	await assert.rejects(closing, /abort/i);
	assert.deepEqual(await env.call({ action: "tabs" }), []);
	assert.equal(browser.disconnected, 1);
	assert.equal(browser.child.kills, 0);
	assert.equal(existsSync(profile), true);
	browser.child.emit("exit");
	await env.shutdown();
});

it("disconnects a foreign CDP browser without killing it", async () => {
	const env = setup();
	await env.call({ action: "open", app: { cdp_url: "ws://localhost:9222/devtools/browser/1" } });
	assert.deepEqual(env.connects, [{ browserWSEndpoint: "ws://localhost:9222/devtools/browser/1" }]);
	await env.call({ action: "close", all: true, kill: true });
	assert.equal(env.browsers[0].closed, 0);
	assert.equal(env.browsers[0].disconnected, 1);
	await env.call({ action: "open", app: { cdp_url: "http://localhost:9222" } });
	assert.deepEqual(env.connects[1], { browserURL: "http://localhost:9222" });
	await env.shutdown();
	assert.equal(env.browsers[1].closed, 0);
	assert.equal(env.browsers[1].disconnected, 1);
});

it("cancels a pending launch and cleans a late browser and profile", async () => {
	const pending = deferred<void>();
	const env = setup({ launchWait: pending.promise });
	const controller = new AbortController();
	const opening = env.call({ action: "open" }, controller.signal);
	while (!env.launches.length) await new Promise<void>(resolve => setImmediate(resolve));
	const profile = env.launches[0].userDataDir;
	controller.abort();
	await assert.rejects(opening, /abort/i);
	pending.resolve();
	await env.shutdown();
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(env.browsers[0].closed, 1);
	assert.equal(existsSync(profile), false);
});

it("serializes simultaneous tool calls and honors cancellation while queued", async () => {
	const pending = deferred<void>();
	const env = setup({ viewportWait: pending.promise });
	const first = env.call({ action: "open", viewport: { width: 800, height: 600 } });
	while (!env.browsers[0]?.viewport) await new Promise<void>(resolve => setImmediate(resolve));
	const controller = new AbortController();
	const second = env.call({ action: "close" }, controller.signal);
	controller.abort();
	await assert.rejects(second, /abort/i);
	const third = env.call({ action: "close" });
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(env.browsers[0].closed, 0);
	pending.resolve();
	await first;
	await third;
	assert.equal(env.browsers[0].closed, 1);
	await env.shutdown();
});
