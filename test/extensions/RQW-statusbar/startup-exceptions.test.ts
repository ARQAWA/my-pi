import assert from "node:assert/strict";
import { it } from "node:test";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { deferred, startupHost } from "./startup-host.ts";

for (const kind of ["select", "confirm", "input", "custom"] as const) {
	it(`startup ${kind} remains visible and accepts input`, async t => {
		const f = startupHost(t);
		const { init } = await f.pending();
		const ui = f.host.createExtensionUIContext();
		const answer = kind === "select" ? ui.select("QUESTION", ["one"]) : kind === "confirm" ? ui.confirm("QUESTION", "continue?") : kind === "input" ? ui.input("QUESTION", "text") : ui.custom((_tui: unknown, _theme: unknown, _keys: unknown, done: (value: string) => void) => ({ render: () => ["QUESTION"], invalidate() {}, handleInput() { done("done"); } }));
		await Promise.resolve();
		f.host.renderer.renderNow();
		assert.match(f.frames().join("\n"), /QUESTION/);
		if (kind === "input") f.input("fixed input");
		f.input("\r");
		assert.equal(await answer, { select: "one", confirm: true, input: "fixed input", custom: "done" }[kind]);
		f.proceed.resolve(); await init;
	});
}

for (const kind of ["error", "progress"] as const) {
	it(`startup ${kind} stays visible over the early panel`, async t => {
		const f = startupHost(t);
		const { init } = await f.pending();
		if (kind === "error") f.host.showError("STARTUP ERROR");
		else f.host.showManagedToolStatus({ type: "info", message: "STARTUP PROGRESS" });
		f.host.renderer.renderNow();
		const screen = f.frames().join("\n");
		assert.match(screen, kind === "error" ? /STARTUP ERROR/ : /STARTUP PROGRESS/);
		assert.ok(screen.includes(f.session.sessionManager.getSessionId()));
		f.proceed.resolve(); await init;
	});
}

it("a foreign host remains stock", async t => {
	const f = startupHost(t);
	f.session.resourceLoader.getExtensions = () => ({ extensions: [] });
	const { init } = await f.pending();
	assert.match(f.frames().join("\n"), /\(auto\)/);
	f.proceed.resolve(); await init;
});

it("incompatible borders fall back to stock without partial decoration", async t => {
	const f = startupHost(t);
	Object.defineProperty(f.host.defaultEditor, "renderBottomBorder", { value: f.host.defaultEditor.renderBottomBorder, writable: false, configurable: false });
	const { init } = await f.pending();
	assert.match(f.frames().join("\n"), /\(auto\)/);
	f.proceed.resolve(); await init;
	f.host.renderer.renderNow();
	assert.match(f.host.renderer.getScreenLines().join("\n"), /cmp 0/, "the normal footer is installed after fallback");
});

it("startup leaves a foreign footer in place", async t => {
	const f = startupHost(t);
	const { init } = await f.pending();
	f.host.createExtensionUIContext().setFooter(() => ({ render: () => ["FOREIGN FOOTER"], invalidate() {} }));
	f.proceed.resolve(); await init;
	f.host.renderer.renderNow();
	assert.match(f.host.renderer.getScreenLines().join("\n"), /FOREIGN FOOTER/);
});

it("off restores stock and shutdown preserves foreign components", async t => {
	const f = startupHost(t);
	const { init } = await f.pending(); f.proceed.resolve(); await init;
	await f.commands.get("statusbar").handler("off", f.ctx);
	f.host.renderer.renderNow();
	assert.match(f.host.renderer.getScreenLines().join("\n"), /\(auto\)/);
	await f.commands.get("statusbar").handler("on", f.ctx);
	const ui = f.host.createExtensionUIContext();
	ui.setEditorComponent((tui: any, theme: any, keys: any) => {
		const editor = new CustomEditor(tui, theme, keys);
		editor.render = () => ["FOREIGN EDITOR"];
		return editor;
	});
	ui.setFooter(() => ({ render: () => ["FOREIGN FOOTER"], invalidate() {} }));
	await f.runner.emit({ type: "session_shutdown", reason: "switch" });
	f.host.renderer.renderNow();
	const screen = f.host.renderer.getScreenLines().join("\n");
	assert.match(screen, /FOREIGN EDITOR/);
	assert.match(screen, /FOREIGN FOOTER/);
});

it("reload binds a new owner before history is rendered", async t => {
	const f = startupHost(t);
	const { init } = await f.pending(); f.proceed.resolve(); await init;
	await f.reload();
	f.host.renderer.renderNow();
	const screen = f.host.renderer.getScreenLines().join("\n");
	assert.ok(screen.includes(f.session.sessionManager.getSessionId()));
	assert.ok(!screen.includes("(auto)"));
});

it("stopping restores our prototype wrappers", async t => {
	const f = startupHost(t);
	const { init } = await f.pending(); f.proceed.resolve(); await init;
	await f.runner.emit({ type: "session_shutdown", reason: "shutdown" });
	f.host.stop();
	assert.match(f.host.defaultEditor.renderTopBorder(80, 0), /─/);
	assert.ok(!f.host.defaultEditor.renderTopBorder(80, 0).includes(f.session.sessionManager.getSessionId()));
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
	f.host.renderer.renderNow();
	assert.match(f.frames().join("\n"), /cmp 0/);
	f.runner.cwd = newCwd;
	f.host.renderer.renderNow();
	const refreshed = deferred();
	const write = f.host.renderer.terminal.write.bind(f.host.renderer.terminal);
	t.mock.method(f.host.renderer.terminal, "write", (text: string) => { write(text); if (text.includes("NEW_BRANCH")) refreshed.resolve(); });
	t.mock.method(f.host.renderer, "requestRender", () => f.host.renderer.renderNow());
	oldStat.resolve({ isDirectory: () => true, isFile: () => false });
	await newLookupEntered.promise;
	// The old result finished while another cwd was current. Returning to its cwd must
	// not resurrect that discarded result while the newer lookup is still pending.
	f.runner.cwd = oldCwd;
	f.host.renderer.renderNow();
	assert.ok(f.frames().every(frame => !frame.includes("OLD_BRANCH")), "a discarded old result never paints");
	f.runner.cwd = newCwd;
	f.host.renderer.renderNow();
	newStat.resolve({ isDirectory: () => true, isFile: () => false });
	await refreshed.promise;
	assert.match(f.frames().join("\n"), /NEW_BRANCH/);
	assert.ok(f.frames().every(frame => !frame.includes("OLD_BRANCH")));
});
