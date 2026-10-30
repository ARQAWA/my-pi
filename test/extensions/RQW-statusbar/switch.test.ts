import assert from "node:assert/strict";
import { it } from "node:test";
import { writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join, sep } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { AgentSessionRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { deferred, startupHost } from "./startup-host.ts";
import { ICON } from "../../../extensions/RQW-statusbar/render.ts";

for (const kind of ["new", "resume", "fork"] as const) {
	it(`${kind} keeps the decorated panel across runtime replacement`, async t => {
		const f = startupHost(t);
		const cacheRead = deferred();
		if (kind === "resume") {
			f.session.sessionManager.appendSessionInfo("OLD SESSION NAME");
			f.runner.getContextUsageFn = () => ({ tokens: 12345, contextWindow: 100000 });
			writeFileSync(join(f.dir, "auth.json"), JSON.stringify({ "openai-codex": { type: "oauth", access: "fake", refresh: "fake", expires: 2e12, accountId: "fake-account" } }));
			const readFile = fs.readFile.bind(fs);
			t.mock.method(fs, "readFile", async (path: any, ...args: any[]) => {
				if (String(path).includes(`${sep}rqw-quota${sep}`)) {
					cacheRead.resolve();
					return JSON.stringify({ percent: 73, checkedAt: 0, okAt: 0 });
				}
				return readFile(path, ...args as [any]);
			});
			syncBuiltinESMExports();
		}
		const { init } = await f.pending();
		f.proceed.resolve(); await init;
		if (kind === "resume") {
			await cacheRead.promise;
			await Promise.resolve(); await Promise.resolve();
			f.host.renderer.renderNow();
			const oldScreen = stripVTControlCharacters(f.host.renderer.getScreenLines().join("\n"));
			assert.match(oldScreen, /OLD SESSION NAME/);
			assert.match(oldScreen, /12\.3k/);
			assert.match(oldScreen, /CX 73%/);
		}
		const old = f.session.sessionManager;
		const oldId = old.getSessionId();
		const entry = old.appendMessage({ role: "user", content: [{ type: "text", text: "fork" }], timestamp: 1 });
		f.session.abort = async () => {};
		f.session.dispose = () => {};
		const entered = deferred();
		const created = deferred();
		const newBinding = deferred();
		const bound = deferred();
		const runtime: any = new AgentSessionRuntime(f.session, { cwd: f.dir, agentDir: f.dir } as never, async (options: any) => {
			entered.resolve();
			await created.promise;
			return { session: f.renew(options.sessionManager, kind === "resume" ? newBinding.promise : undefined), services: { cwd: f.dir, agentDir: f.dir }, diagnostics: [] } as never;
		});
		f.host.runtimeHost = runtime;
		runtime.setBeforeSessionInvalidate(() => f.host.resetExtensionUI());
		runtime.setRebindSession(() => { const result = f.host.rebindCurrentSession({ renderBeforeBind: true }); bound.resolve(); return result; });
		const target = SessionManager.create(f.dir, f.dir);
		target.appendMessage({ role: "user", content: [{ type: "text", text: "resume" }], timestamp: 2 });
		const frames: string[] = [];
		const renderer = f.host.renderer;
		const draw = renderer.doRender.bind(renderer);
		t.mock.method(renderer, "doRender", (...args: unknown[]) => {
			const result = draw(...args);
			frames.push(stripVTControlCharacters(renderer.getScreenLines().join("\n")));
			return result;
		});
		const switching = kind === "new" ? runtime.newSession() : kind === "resume" ? runtime.switchSession(target.getSessionFile()) : runtime.fork(entry, { position: "at" });
		await entered.promise;
		f.host.renderer.renderNow();
		const pending = f.host.renderer.getScreenLines().join("\n");
		assert.ok(pending.includes(oldId));
		assert.ok(!pending.includes("(auto)"));
		assert.ok(!pending.includes("cmp 0"));
		created.resolve();
		if (kind === "resume") {
			await bound.promise;
			f.host.renderer.renderNow();
			const earlyNewScreen = stripVTControlCharacters(f.host.renderer.getScreenLines().join("\n"));
			assert.ok(earlyNewScreen.includes(runtime.session.sessionManager.getSessionId()));
			assert.ok(!/OLD SESSION NAME|12\.3k|CX 73%/.test(earlyNewScreen), "new session never shows old name, context or quota");
			newBinding.resolve();
		}
		await switching;
		f.host.renderer.renderNow();
		const final = f.host.renderer.getScreenLines().join("\n");
		assert.ok(final.includes(runtime.session.sessionManager.getSessionId()));
		assert.ok(!final.includes("(auto)"));
		const newId = runtime.session.sessionManager.getSessionId();
		assert.ok(frames.length > 0);
		for (const frame of frames) {
			assert.ok(frame.includes(oldId) || frame.includes(newId), "each switch frame has our session border");
			assert.ok(frame.includes(ICON.model), "each switch frame has our footer");
			assert.ok(!frame.includes("(auto)"), "no switch frame has Pi's stock footer");
		}
	});
}
