import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { it } from "node:test";
import { InteractiveMode } from "@earendil-works/pi-coding-agent";
import { registerHost } from "../../../extensions/RQW-tool-ui/host.ts";

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, "../../../extensions/RQW-tool-ui/host.ts");
const NAMES = ["init", "renderSessionEntries", "addMessageToChat", "stop"] as const;

// Stand-ins for Pi's own methods: the hooks wrap these, and the fake host below is not a real InteractiveMode.
function stubPi() {
	const proto = InteractiveMode.prototype as any;
	const saved = NAMES.map((name) => Object.getOwnPropertyDescriptor(proto, name)!);
	for (const name of NAMES) Object.defineProperty(proto, name, { ...Object.getOwnPropertyDescriptor(proto, name), value() {} });
	return () => NAMES.forEach((name, i) => Object.defineProperty(proto, name, saved[i]!));
}

function owner() {
	const log: unknown[] = [];
	const ui = { start: (manager: unknown) => log.push(manager), shutdown() {}, freeze() {}, installed: false };
	const folds = { start() {}, attach() {}, detach() {}, freeze() {}, message() {} };
	return { log, ui, folds, resolver: () => undefined };
}

/** A host whose current runtime lists `resolver` among its tool renderers, as Pi's loader does after a /reload. */
function fakeHost(manager: object) {
	const host: any = Object.create(InteractiveMode.prototype);
	// Pi defines these as getters on the class, so the fake host overrides them on the instance.
	const define = (name: string, value: unknown) => Object.defineProperty(host, name, { value, configurable: true, writable: true });
	define("sessionManager", manager);
	host.chatContainer = { children: [] };
	host.createExtensionUIContext = () => ({ get theme() { return { fg: () => "" }; } });
	const runtime = (resolver: Function) => {
		const loaded = { runtime: {}, extensions: [{ toolRenderers: [resolver] }] };
		define("session", { resourceLoader: { getExtensions: () => loaded } });
	};
	return { host, runtime };
}

it("a reloaded module's host hooks run its own code, not the first module's", async () => {
	const restorePi = stubPi();
	const dir = mkdtempSync(join(here, ".reload-copy-"));
	const { host, runtime } = fakeHost({ getBranch: () => [], getCwd: () => "/w" });
	try {
		const first = owner();
		registerHost(first.resolver, first.ui as never, first.folds as never);
		runtime(first.resolver);
		host.renderSessionEntries([]);
		assert.deepEqual(first.log, [host.sessionManager]);

		// The updated module binds the manager under a different argument, which shows whose code ran.
		const code = readFileSync(source, "utf8");
		assert.ok(code.includes("owner.ui.start(manager);"));
		const file = join(dir, "host.ts");
		writeFileSync(file, code.replace("owner.ui.start(manager);", "owner.ui.start(\"updated\");"));
		const updated = await import(pathToFileURL(file).href);
		const second = owner();
		updated.registerHost(second.resolver, second.ui, second.folds);
		runtime(second.resolver);
		host.renderSessionEntries([]);
		assert.deepEqual(second.log, ["updated"]);
	} finally {
		host.stop();
		rmSync(dir, { recursive: true, force: true });
		restorePi();
	}
});
