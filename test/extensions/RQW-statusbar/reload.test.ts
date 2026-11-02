import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { it } from "node:test";
import { initTheme, InteractiveMode } from "@earendil-works/pi-coding-agent";
import { installEarly } from "../../../extensions/RQW-statusbar/early.ts";

const here = dirname(fileURLToPath(import.meta.url));
const folder = join(here, "../../../extensions/RQW-statusbar");
const NAMES = ["init", "rebindCurrentSession", "renderSessionEntries", "stop"] as const;
const THEME = Symbol.for("@earendil-works/pi-coding-agent:theme");
const REGISTRY = Symbol.for("rqw-statusbar/early/1.5.0");

// Stand-ins for Pi's own methods: the hooks wrap these, and the fake host below is not a real InteractiveMode.
function stubPi() {
	const proto = InteractiveMode.prototype as any;
	const saved = NAMES.map((name) => Object.getOwnPropertyDescriptor(proto, name)!);
	for (const name of NAMES) Object.defineProperty(proto, name, { ...Object.getOwnPropertyDescriptor(proto, name), value() {} });
	return () => NAMES.forEach((name, i) => Object.defineProperty(proto, name, saved[i]!));
}

/** A host whose loaded extensions are the ones given to `load`, as Pi's loader reports them after a /reload. */
function fakeHost() {
	const host: any = Object.create(InteractiveMode.prototype);
	const define = (name: string, value: unknown) => Object.defineProperty(host, name, { value, configurable: true, writable: true });
	define("defaultEditor", { renderTopBorder: () => "stock top", renderBottomBorder: () => "stock bottom" });
	define("footer", { render: () => ["stock footer"] });
	define("renderer", {});
	define("sessionManager", { getSessionId: () => "session-1", getSessionName: () => undefined, getCwd: () => "/w" });
	define("createExtensionUIContext", () => ({ theme: (globalThis as any)[THEME] }));
	return {
		host,
		load: (handler: Function) => define("session", {
			model: undefined, thinkingLevel: "off",
			resourceLoader: { getExtensions: () => ({ extensions: [{ commands: new Map([["statusbar", { handler }]]) }] }) },
		}),
	};
}

it("a reloaded module's host hooks bind the editor with its own code, not the first module's", async () => {
	initTheme();
	// A registry left by another test hooked Pi's methods before the stand-ins; this test builds its own.
	const global = globalThis as unknown as Record<symbol, unknown>;
	const leftover = global[REGISTRY];
	delete global[REGISTRY];
	const restorePi = stubPi();
	const dir = mkdtempSync(join(here, ".reload-copy-"));
	const { host, load } = fakeHost();
	const first = () => {};
	const second = () => {};
	let releaseFirst: { dispose(): void } | undefined;
	let releaseSecond: { dispose(): void } | undefined;
	try {
		releaseFirst = installEarly(first, () => true);
		load(first);
		host.init();
		assert.match(host.defaultEditor.renderTopBorder(60, 0), /session-1/);

		// The updated module draws a fixed top border, which shows whose code bound the editor.
		for (const file of ["early.ts", "render.ts", "index.ts", "git.ts", "quota.ts", "editor.ts", "activity.ts"]) cpSync(join(folder, file), join(dir, file));
		const early = readFileSync(join(dir, "early.ts"), "utf8");
		const drawn = "topBorder(width, s.id, undefined, hidden, themePaint(ui.theme), s.name)";
		assert.ok(early.includes(drawn));
		writeFileSync(join(dir, "early.ts"), early.replace(drawn, "\"updated top\""));
		const updated = await import(pathToFileURL(join(dir, "early.ts")).href);
		releaseSecond = updated.installEarly(second, () => true);
		load(second);
		host.rebindCurrentSession();
		assert.equal(host.defaultEditor.renderTopBorder(60, 0), "updated top");
	} finally {
		releaseSecond?.dispose();
		releaseFirst?.dispose();
		host.stop();
		rmSync(dir, { recursive: true, force: true });
		restorePi();
		if (leftover) global[REGISTRY] = leftover; else delete global[REGISTRY];
	}
});
