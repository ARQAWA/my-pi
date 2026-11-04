import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { connect as netConnect } from "node:net";
import type { AddressInfo } from "node:net";
import { registerHooks } from "node:module";
import { PassThrough } from "node:stream";
import type { Duplex } from "node:stream";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { it } from "node:test";
import { WebSocketServer } from "ws";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import { createBrowserExtension } from "../../../extensions/RQW-browser/index.ts";

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(done => { resolve = done; });
	return { promise, resolve };
}

function setup(options: { launchWait?: Promise<unknown>; viewportWait?: Promise<unknown>; spawnStall?: boolean; titleWait?: Promise<string>; downloadWait?: Promise<unknown>; systemChrome?: string; realSystem?: boolean; launchError?: Error; downloadError?: Error } = {}) {
	let tool: any;
	const events = createEventBus();
	let shutdown: () => Promise<void> = async () => {};
	let loads = 0;
	let downloads = 0;
	const launches: any[] = [];
	const connects: any[] = [];
	const applicationConnects: any[] = [];
	const browsers: any[] = [];
	const installs: any[] = [];
	const spawned: any[] = [];
	function browser(child?: any) {
		let url = "about:blank";
		const process = child ?? Object.assign(new EventEmitter(), { exitCode: null, signalCode: null, kills: 0, kill(this: EventEmitter & { kills: number }) { this.kills++; this.emit("exit"); return true; } });
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
		spawnProcess: ((_path: string, args: string[]) => {
			const child = Object.assign(new EventEmitter(), { args, exitCode: null, signalCode: null, kills: 0, unrefs: 0, stderr: new PassThrough(), unref() { this.unrefs++; }, kill(this: EventEmitter & { kills: number }) { this.kills++; this.emit("exit"); return true; } });
			spawned.push(child);
			queueMicrotask(() => { if (options.launchError) child.emit("error", options.launchError); else if (!options.spawnStall) child.stderr.write("DevTools listening on ws://localhost/devtools/browser/app\n"); });
			return child;
		}) as never,
		load: async () => {
			loads++;
			return {
				launch: async (args: unknown) => { launches.push(args); if (options.launchError) throw options.launchError; if (options.launchWait) await options.launchWait; return browser(); },
				defaultArgs: (args: any) => { launches.push(args); return [...args.args]; },
				connect: async (args: any) => { if (args.browserWSEndpoint === "ws://localhost/devtools/browser/app") { applicationConnects.push(args); return browser(spawned.at(-1)); } connects.push(args); return browser(); },
				Puppeteer: { customQueryHandlerNames: () => [], registerCustomQueryHandler() {} },
			} as never;
		},
		...(options.realSystem ? {} : { findSystemChrome: () => options.systemChrome }),
		loadManager: async () => ({
			detectBrowserPlatform: () => process.platform === "win32" ? "win64" : "mac_arm",
			Browser: { CHROME: "chrome" },
			install: async (args: unknown) => { installs.push(args); downloads++; if (options.downloadError) throw options.downloadError; if (options.downloadWait) await options.downloadWait; return { executablePath: "/fake/chrome" }; },
		}) as never,
	})({ events, registerTool: (value: unknown) => { tool = value; }, on: (event: string, handler: typeof shutdown) => { if (event === "session_shutdown") shutdown = handler; } } as never);
	async function call(input: unknown, signal?: AbortSignal) {
		const result = await tool.execute("id", input, signal, undefined, {});
		return result.details.value;
	}
	function child() {
		let factory: any;
		let names: string[] = [];
		events.emit("rqw-agent:subagent-extension-factories", { offer: (value: any, tools: string[]) => { factory = value; names = tools; } });
		let childTool: any;
		let childShutdown: () => Promise<void> = async () => {};
		factory({ events: createEventBus(), registerTool: (value: unknown) => { childTool = value; }, on: (event: string, handler: typeof shutdown) => { if (event === "session_shutdown") childShutdown = handler; } });
		return { names, busy: () => factory.busy(), call: async (input: unknown) => (await childTool.execute("id", input, undefined, undefined, {})).details.value, shutdown: () => childShutdown() };
	}
	return { call, child, shutdown: () => shutdown(), launches, connects, applicationConnects, browsers, spawned, installs, loads: () => loads, downloads: () => downloads };
}

it("does not import browser dependencies at extension load or registration", async () => {
	const imports: string[] = [];
	const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
		if (specifier === "puppeteer-core" || specifier === "@puppeteer/browsers") imports.push(specifier);
		return nextResolve(specifier, context);
	} });
	try {
		const module = await import(new URL("../../../extensions/RQW-browser/index.ts?startup-check", import.meta.url).href) as typeof import("../../../extensions/RQW-browser/index.ts");
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

it("offers independent browser instances to children and tracks their tabs", async () => {
	const env = setup({ systemChrome: "/installed/chrome" });
	const first = env.child();
	const second = env.child();
	assert.deepEqual(first.names, ["browser"]);
	assert.equal(first.busy(), false);
	await env.call({ action: "open", name: "main" });
	await first.call({ action: "open", name: "child" });
	await second.call({ action: "open", name: "other" });
	assert.equal(first.busy(), true);
	assert.deepEqual((await first.call({ action: "tabs" })).map((tab: any) => tab.name), ["child"]);
	await first.shutdown();
	assert.equal(first.busy(), false);
	assert.equal(second.busy(), true);
	assert.deepEqual((await env.call({ action: "tabs" })).map((tab: any) => tab.name), ["main"]);
	assert.deepEqual((await second.call({ action: "tabs" })).map((tab: any) => tab.name), ["other"]);
	await second.call({ action: "close", name: "other" });
	assert.equal(second.busy(), false);
	await second.shutdown();
	await env.shutdown();
});

it("loads lazily and launches separate profiles with path and display settings", async () => {
	const keys = ["HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"] as const;
	const saved = keys.map(key => process.env[key]);
	for (const key of keys) delete process.env[key];
	try {
	const env = setup();
	assert.equal(env.loads(), 0);
	assert.equal(env.downloads(), 0);
	await env.call({ action: "open", name: "first", headed: true, app: { path: "/custom/chrome", args: ["--flag"] } });
	assert.equal(env.downloads(), 0);
	assert.equal(env.launches[0].executablePath, resolve("/custom/chrome"));
	assert.equal(env.launches[0].headless, false);
	assert.deepEqual(env.launches[0].args, ["--flag"]);
	assert.equal(env.applicationConnects[0].handleDevToolsAsPage, true);
	const profile = env.launches[0].userDataDir;
	assert.ok(existsSync(profile));
	await env.call({ action: "open", name: "second" });
	assert.equal(env.downloads(), 1);
	assert.equal(env.launches[1].executablePath, "/fake/chrome");
	assert.equal(env.launches[1].headless, true);
	assert.equal(env.launches[1].handleDevToolsAsPage, true);
	assert.notEqual(env.launches[1].userDataDir, profile);
	await env.call({ action: "close", all: true, kill: true });
	assert.equal(env.browsers[0].child.kills, 1);
	assert.equal(env.browsers[1].closed, 1);
	} finally {
		for (const [index, key] of keys.entries()) {
			if (saved[index] === undefined) delete process.env[key];
			else process.env[key] = saved[index];
		}
	}
});

it("passes environment proxies and bypasses to launched browsers while respecting explicit flags", async () => {
	const keys = ["HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy", "NO_PROXY", "no_proxy"] as const;
	const saved = keys.map(key => process.env[key]);
	try {
		for (const key of keys) delete process.env[key];
		process.env.HTTP_PROXY = "http://proxy.test:8080";
		process.env.HTTPS_PROXY = "http://secure-proxy.test:8081";
		process.env.NO_PROXY = "example.test,.internal.test:3000,2001:db8::1";
		const env = setup({ systemChrome: "/installed/chrome" });
		await env.call({ action: "open", name: "managed" });
		await env.call({ action: "open", name: "app", app: { path: "/custom/chrome" } });
		for (const args of [env.launches[0].args, env.spawned[0].args]) {
			assert.ok(args.includes("--proxy-server=http=http://proxy.test:8080;https=http://secure-proxy.test:8081"));
			const bypass = args.find((arg: string) => arg.startsWith("--proxy-bypass-list="));
			for (const item of ["example.test", "*.example.test", "internal.test:3000", "*.internal.test:3000", "localhost", "127.0.0.0/8", "[::1]", "[2001:db8::1]"]) assert.ok(bypass?.split(/[=;]/).includes(item), item);
		}
		await env.call({ action: "open", name: "custom", app: { path: "/custom/chrome", args: ["--proxy-server=http://manual:8080", "--proxy-bypass-list=manual.test"] } });
		assert.deepEqual(env.launches[2].args, ["--proxy-server=http://manual:8080", "--proxy-bypass-list=manual.test"]);
		process.env.HTTP_PROXY = "http://user:secret@proxy.test:8080";
		process.env.HTTPS_PROXY = "http://user:secret@secure-proxy.test:8081";
		await env.call({ action: "open", name: "credentials" });
		assert.ok(env.launches[3].args.includes("--proxy-server=http=http://proxy.test:8080;https=http://secure-proxy.test:8081"));
		assert.ok(env.launches[3].args.every((arg: string) => !arg.includes("secret")));
		for (const key of keys) delete process.env[key];
		for (const [index, key] of ["http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"].entries()) {
			process.env[key] = "http://fallback.test:8080";
			process.env.no_proxy = "lower.test";
			await env.call({ action: "open", name: `fallback-${index}` });
			const args = env.launches.at(-1).args;
			assert.ok(args.includes("--proxy-server=http=http://fallback.test:8080;https=http://fallback.test:8080"));
			assert.ok(args.some((arg: string) => arg.includes("lower.test")));
			delete process.env[key];
		}
		process.env.HTTP_PROXY = "http://proxy.test:8080";
		for (const [index, flag] of ["--proxy-pac-url=http://manual.test/proxy.pac", "--proxy-auto-detect", "--no-proxy-server"].entries()) {
			await env.call({ action: "open", name: `override-${index}`, app: { path: "/custom/chrome", args: [flag] } });
			assert.ok(env.spawned.at(-1).args.includes(flag));
			assert.ok(env.spawned.at(-1).args.every((arg: string) => !arg.startsWith("--proxy-server")));
		}
		await env.call({ action: "close", all: true, kill: true });
	} finally {
		for (const [index, key] of keys.entries()) {
			if (saved[index] === undefined) delete process.env[key];
			else process.env[key] = saved[index];
		}
	}
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
	assert.deepEqual(env.connects, [{ browserWSEndpoint: "ws://localhost:9222/devtools/browser/1", handleDevToolsAsPage: true }]);
	await env.call({ action: "close", all: true, kill: true });
	assert.equal(env.browsers[0].closed, 0);
	assert.equal(env.browsers[0].disconnected, 1);
	await env.call({ action: "open", app: { cdp_url: "http://localhost:9222" } });
	assert.deepEqual(env.connects[1], { browserURL: "http://localhost:9222", handleDevToolsAsPage: true });
	await env.shutdown();
	assert.equal(env.browsers[1].closed, 0);
	assert.equal(env.browsers[1].disconnected, 1);
});

it("connects a remote CDP endpoint through the environment proxy and keeps loopback and NO_PROXY hosts direct", async () => {
	const keys = ["HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy", "NO_PROXY", "no_proxy"] as const;
	const saved = keys.map(key => process.env[key]);
	const cdp = createServer((request, response) => {
		if (request.url !== "/json/version") { response.statusCode = 404; response.end(); return; }
		response.end(JSON.stringify({ webSocketDebuggerUrl: "ws://chrome.test:9222/devtools/browser/1" }));
	});
	const sockets = new WebSocketServer({ server: cdp });
	sockets.on("connection", socket => socket.on("message", data => socket.send(`echo ${data}`)));
	await new Promise<void>(resolve => cdp.listen(0, "127.0.0.1", resolve));
	const cdpPort = (cdp.address() as AddressInfo).port;
	const tunnels: string[] = [];
	const open: Duplex[] = [];
	const proxy = createServer();
	proxy.on("connect", (request, client, head) => {
		tunnels.push(request.url ?? "");
		open.push(client);
		const upstream = netConnect(cdpPort, "127.0.0.1", () => {
			client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
			upstream.write(head);
			upstream.pipe(client);
			client.pipe(upstream);
		});
		upstream.on("error", () => client.destroy());
		client.on("error", () => upstream.destroy());
		client.on("close", () => upstream.destroy());
	});
	await new Promise<void>(resolve => proxy.listen(0, "127.0.0.1", resolve));
	try {
		for (const key of keys) delete process.env[key];
		process.env.HTTP_PROXY = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
		process.env.NO_PROXY = "bypassed.test";
		const env = setup();
		await env.call({ action: "open", name: "lookup", app: { cdp_url: "http://chrome.test:9222" } });
		const transport = env.connects[0].transport;
		const reply = new Promise<string>(resolve => { transport.onmessage = resolve; });
		transport.send("ping");
		assert.equal(await reply, "echo ping");
		assert.deepEqual(tunnels, ["chrome.test:9222", "chrome.test:9222"]);
		await env.call({ action: "open", name: "socket", app: { cdp_url: "ws://chrome.test:9222/devtools/browser/1" } });
		assert.equal(typeof env.connects[1].transport.send, "function");
		assert.equal(tunnels.length, 3);
		await env.call({ action: "open", name: "loopback", app: { cdp_url: `http://127.0.0.1:${cdpPort}` } });
		await env.call({ action: "open", name: "bypassed", app: { cdp_url: "http://bypassed.test:9222" } });
		assert.deepEqual(env.connects[2], { browserURL: `http://127.0.0.1:${cdpPort}`, handleDevToolsAsPage: true });
		assert.deepEqual(env.connects[3], { browserURL: "http://bypassed.test:9222", handleDevToolsAsPage: true });
		assert.equal(tunnels.length, 3);
		env.connects[0].transport.close();
		env.connects[1].transport.close();
		await env.shutdown();
	} finally {
		for (const [index, key] of keys.entries()) {
			if (saved[index] === undefined) delete process.env[key];
			else process.env[key] = saved[index];
		}
		for (const client of open) client.destroy();
		sockets.close();
		cdp.closeAllConnections();
		cdp.close();
		proxy.close();
	}
});

it("cancels a remote CDP connection that waits on the proxy without an unhandled socket error", async () => {
	const keys = ["HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy", "NO_PROXY", "no_proxy"] as const;
	const saved = keys.map(key => process.env[key]);
	const held: Duplex[] = [];
	const reached = deferred<void>();
	const proxy = createServer();
	proxy.on("connect", (_request, client) => { held.push(client); reached.resolve(); });
	await new Promise<void>(resolve => proxy.listen(0, "127.0.0.1", resolve));
	try {
		for (const key of keys) delete process.env[key];
		process.env.HTTP_PROXY = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
		const env = setup();
		const controller = new AbortController();
		const opening = env.call({ action: "open", app: { cdp_url: "ws://chrome.test:9222/devtools/browser/1" } }, controller.signal);
		const early = opening.then(() => { throw new Error("open finished before the proxy was reached"); });
		early.catch(() => {});
		await Promise.race([reached.promise, early]);
		controller.abort();
		await assert.rejects(opening, /abort/i);
		await new Promise<void>(resolve => setImmediate(resolve));
		assert.deepEqual(env.connects, []);
	} finally {
		for (const [index, key] of keys.entries()) {
			if (saved[index] === undefined) delete process.env[key];
			else process.env[key] = saved[index];
		}
		for (const client of held) client.destroy();
		proxy.close();
	}
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
