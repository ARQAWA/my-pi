import assert from "node:assert/strict";
import { it } from "node:test";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { deferred, startupHost } from "./startup-host.ts";

for (const kind of ["select", "confirm", "input", "editor", "custom", "overlay"] as const) {
	it(`startup ${kind} paints and accepts input before statusbar is ready`, async t => {
		const f = startupHost(t);
		const { init } = await f.pending();
		const ui = f.host.createExtensionUIContext();
		let answer: Promise<unknown>;
		if (kind === "select") answer = ui.select("STARTUP QUESTION", ["one"]);
		else if (kind === "confirm") answer = ui.confirm("STARTUP QUESTION", "continue?");
		else if (kind === "input") answer = ui.input("STARTUP QUESTION", "text");
		else if (kind === "editor") answer = ui.editor("STARTUP QUESTION", "text");
		else answer = ui.custom((_tui: unknown, _theme: unknown, _keys: unknown, done: (value: string) => void) => ({
			render: () => ["STARTUP QUESTION"], invalidate() {}, handleInput() { done("done"); },
		}), { overlay: kind === "overlay" });
		// Custom factories may be async; let Pi mount their component.
		await Promise.resolve();
		f.host.renderer.renderNow();
		assert.match(f.frames().join("\n"), /STARTUP QUESTION/);
		if (kind === "input") f.input("fixed input");
		f.input("\r");
		assert.equal(await answer, { select: "one", confirm: true, input: "fixed input", editor: "text", custom: "done", overlay: "done" }[kind]);
		f.proceed.resolve();
		await init;
	});
}

for (const kind of ["notification", "error", "extension error", "managed tool", "foreign editor", "foreign footer", "shutdown", "off"] as const) {
	it(`${kind} immediately releases startup painting`, async t => {
		const f = startupHost(t);
		const { init } = await f.pending();
		const ui = f.host.createExtensionUIContext();
		if (kind === "notification") ui.notify("STARTUP NOTICE", "info");
		else if (kind === "error") f.host.showError("STARTUP ERROR");
		else if (kind === "extension error") f.host.showExtensionError("fixture.ts", "STARTUP ERROR");
		else if (kind === "managed tool") f.host.showManagedToolStatus({ type: "info", message: "STARTUP TOOL" });
		else if (kind === "foreign editor") ui.setEditorComponent((tui: any, theme: any, keys: any) => {
			const editor = new CustomEditor(tui, theme, keys);
			editor.render = () => ["FOREIGN EDITOR"];
			return editor;
		});
		else if (kind === "foreign footer") ui.setFooter(() => ({ render: () => ["FOREIGN FOOTER"], invalidate() {} }));
		else if (kind === "off") await f.commands.get("statusbar").handler("off", { mode: "tui", ui });
		else f.host.renderer.stop();
		if (kind === "shutdown") {
			// Stop restored painting, without requiring completion of extension binding.
			f.host.renderer.start();
		}
		f.host.renderer.renderNow();
		assert.ok(f.frames().length > 0);
		const output = f.frames().join("\n");
		if (kind === "notification") assert.match(output, /STARTUP NOTICE/);
		if (kind === "error" || kind === "extension error") assert.match(output, /STARTUP ERROR/);
		if (kind === "managed tool") assert.match(output, /STARTUP TOOL/);
		if (kind === "foreign editor") assert.match(output, /FOREIGN EDITOR/);
		if (kind === "foreign footer") assert.match(output, /FOREIGN FOOTER/);
		f.proceed.resolve();
		await init;
	});
}

it("the 1000 ms cap restores stock painting even while startup remains pending", async t => {
	const f = startupHost(t);
	const { init } = await f.pending();
	t.mock.timers.tick(899);
	f.host.renderer.renderNow();
	assert.equal(f.frames().length, 0);
	t.mock.timers.tick(1);
	f.host.renderer.renderNow();
	assert.match(f.frames().join("\n"), /\(auto\)/);
	f.proceed.resolve();
	await init;
});

it("no loaded statusbar uses Pi's normal first frame", async t => {
	const f = startupHost(t, { loaded: false });
	const { init } = await f.pending();
	assert.match(f.frames().join("\n"), /\(auto\)/);
	f.proceed.resolve();
	await init;
});

it("a statusbar factory belonging to another session does not hold this session", async t => {
	const f = startupHost(t);
	f.session.resourceLoader.getExtensions = () => ({ extensions: [] });
	const { init } = await f.pending();
	assert.match(f.frames().join("\n"), /\(auto\)/);
	f.proceed.resolve();
	await init;
});

it("an incompatible renderer stays stock without a partial hold", async t => {
	const f = startupHost(t);
	Object.defineProperty(f.host.renderer, "showOverlay", { value: f.host.renderer.showOverlay, writable: false, configurable: false });
	const { init } = await f.pending();
	assert.match(f.frames().join("\n"), /\(auto\)/);
	f.proceed.resolve();
	await init;
});

it("a rejected initialization restores painting and preserves the error", async t => {
	const f = startupHost(t);
	const { init } = await f.pending();
	const failed = assert.rejects(init, /fixture startup failed/);
	f.proceed.reject(new Error("fixture startup failed"));
	await failed;
	f.host.renderer.renderNow();
	assert.match(f.frames().join("\n"), /\(auto\)/);
});

it("completion releases a hold even when no session-start handler installs chrome", async t => {
	const f = startupHost(t);
	const { init } = await f.pending();
	f.handlers.set("session_start", []);
	f.proceed.resolve();
	await init;
	f.host.renderer.renderNow();
	assert.match(f.frames().join("\n"), /\(auto\)/);
});

it("removing the extension releases pending paints and repeated init stays stock", async t => {
	const f = startupHost(t);
	const { init } = await f.pending();
	const ui = f.host.createExtensionUIContext();
	for (const handler of f.handlers.get("session_shutdown") ?? []) await handler({}, { mode: "tui", ui });
	f.handlers.clear();
	f.commands.clear();
	f.host.renderer.renderNow();
	assert.match(f.frames().join("\n"), /\(auto\)/, "removal paints stock while initialization is still pending");
	f.proceed.resolve();
	await init;
	await f.host.init();
	f.host.renderer.renderNow();
	assert.match(f.host.renderer.getScreenLines().join("\n"), /\(auto\)/);
});

it("reloading the factory keeps chrome live without another startup hold", async t => {
	const f = startupHost(t);
	const { init } = await f.pending();
	f.proceed.resolve();
	await init;
	await f.reload();
	f.host.renderer.renderNow();
	assert.match(f.host.renderer.getScreenLines().join("\n"), /cmp 0/);
	await f.commands.get("statusbar").handler("off", f.ctx);
	f.host.renderer.renderNow();
	assert.match(f.frames().at(-1)!, /\(auto\)/);
});

it("a failed chrome installation releases painting and preserves its error", async t => {
	const f = startupHost(t);
	const { init } = await f.pending();
	t.mock.method(f.host, "setExtensionFooter", () => { throw new Error("fixture install failed"); });
	const failed = assert.rejects(init, /fixture install failed/);
	f.proceed.resolve();
	await failed;
	f.host.renderer.renderNow();
	assert.ok(f.frames().length > 0);
});

it("slow old Git discovery cannot delay chrome or overwrite a new cwd", async t => {
	const f = startupHost(t);
	const oldStat = deferred<any>();
	const newStat = deferred<any>();
	const newLookupEntered = deferred();
	t.after(() => { oldStat.resolve(undefined); newStat.resolve(undefined); });
	const oldCwd = f.session.sessionManager.getCwd();
	const newCwd = join(oldCwd, "new");
	f.files.stat = async (path: string) => {
		if (path === join(oldCwd, ".git")) return oldStat.promise;
		newLookupEntered.resolve();
		return newStat.promise;
	};
	t.mock.method(childProcess, "execFile", (_file: string, args: string[], opts: { cwd: string }, done: (error: null, text: string) => void) => {
		done(null, args.includes("status") ? "" : opts.cwd === newCwd ? "NEW_BRANCH\n" : "OLD_BRANCH\n");
	});
	syncBuiltinESMExports();
	const { init } = await f.pending();
	f.proceed.resolve();
	await init;
	assert.match(f.frames()[0], /cmp 0/);
	f.ctx.cwd = newCwd;
	f.host.renderer.renderNow();
	const refreshed = deferred();
	const write = f.host.renderer.terminal.write.bind(f.host.renderer.terminal);
	t.mock.method(f.host.renderer.terminal, "write", (text: string) => { write(text); if (text.includes("NEW_BRANCH")) refreshed.resolve(); });
	t.mock.method(f.host.renderer, "requestRender", () => f.host.renderer.renderNow());
	oldStat.resolve({ isDirectory: () => true, isFile: () => false });
	await newLookupEntered.promise;
	// The old result finished while another cwd was current. Returning to its cwd must
	// not resurrect that discarded result while the newer lookup is still pending.
	f.ctx.cwd = oldCwd;
	f.host.renderer.renderNow();
	assert.ok(f.frames().every(frame => !frame.includes("OLD_BRANCH")), "a discarded old result never paints");
	f.ctx.cwd = newCwd;
	f.host.renderer.renderNow();
	newStat.resolve({ isDirectory: () => true, isFile: () => false });
	await refreshed.promise;
	assert.match(f.frames().join("\n"), /NEW_BRANCH/);
	assert.ok(f.frames().every(frame => !frame.includes("OLD_BRANCH")));
});
