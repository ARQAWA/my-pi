import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { AgentSessionRuntime, InteractiveMode, SessionManager, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import tempCwd, { installTempCwd, registerTempCwd } from "../../../extensions/RQW-cwd/index.ts";

let root: string, home: string, target: string;
let log: string[];
const platform = process.platform === "win32" ? "win32" : "darwin";
let realInit: typeof InteractiveMode.prototype.init;

describe("temporary working directory init", () => {
beforeEach(async () => {
	realInit = InteractiveMode.prototype.init;
	root = await mkdtemp(join(tmpdir(), "rqw-cwd-init-"));
	home = join(root, "home");
	target = join(root, "temp");
	log = [];
});
afterEach(async () => {
	InteractiveMode.prototype.init = realInit;
	await rm(root, { recursive: true, force: true });
});

function created(cwd: string, sessionManager: SessionManager) {
	const session = { sessionManager, abort: async () => undefined, dispose: () => undefined, extensionRunner: { hasHandlers: () => false } };
	return { session, services: { cwd, agentDir: join(root, "agent") }, diagnostics: [] };
}

function host(cwd: string, failIn?: string) {
	const factory = async (options: { cwd: string; sessionManager: SessionManager }) => {
		if (options.cwd === failIn) throw new Error("broken");
		return created(options.cwd, options.sessionManager);
	};
	const first = created(cwd, SessionManager.inMemory(cwd));
	const runtimeHost = new AgentSessionRuntime(first.session as never, first.services as never, factory as never);
	// Pi's footer and its data provider as the constructor leaves them: bound to the first session and folder.
	const footer = { session: first.session as unknown, setSession(session: unknown) { footer.session = session; } };
	const footerDataProvider = { cwd, setCwd(next: string) { footerDataProvider.cwd = next; } };
	return { isInitialized: false, runtimeHost, footer, footerDataProvider, showWarning(message: string) { log.push(`warning ${message}`); } };
}

/** Stock init reduced to what matters here: it binds the session the runtime holds at that moment. */
function prototype() {
	return {
		async init(this: ReturnType<typeof host>) {
			if (this.isInitialized) return;
			const footerBound = this.footer.session === this.runtimeHost.session && this.footerDataProvider.cwd === this.runtimeHost.cwd;
			log.push(`init ${this.runtimeHost.cwd}${footerBound ? "" : " stale footer"}`);
			this.isInitialized = true;
		},
	};
}

const options = () => ({ platform, home, target, chdir: () => undefined }) as const;

it("init in the home folder runs once on the temp runtime with the footer rebound, and later inits do not move again", async () => {
	const proto = prototype();
	registerTempCwd({ on: () => undefined } as unknown as ExtensionAPI, proto, options(), "1.4.0");
	const chat = Object.assign(Object.create(proto), host(home));
	await chat.init();
	await chat.init();
	assert.deepEqual(log, [`init ${target}`]);
	assert.equal(chat.runtimeHost.session.sessionManager.getCwd(), target);
});

it("a failed move keeps the original chat and shows the warning after init", async () => {
	const proto = prototype();
	installTempCwd(proto, options(), "1.4.0");
	const chat = Object.assign(Object.create(proto), host(home, target));
	await chat.init();
	assert.equal(log[0], `init ${home}`);
	assert.match(log[1] ?? "", /^warning Could not move the chat .*broken/);
});

it("a footer without its binding methods keeps the stock chat and warns", async () => {
	const proto = prototype();
	installTempCwd(proto, options(), "1.4.0");
	const chat = Object.assign(Object.create(proto), host(home), { footer: {} });
	const first = chat.runtimeHost.session;
	await chat.init();
	assert.equal(chat.runtimeHost.session, first);
	assert.match(log.at(-1) ?? "", /^warning .*unsupported Pi version/);
});

it("a second load does not wrap twice, restore brings stock back, and a project chat is not moved", async () => {
	const proto = prototype();
	const stock = proto.init;
	installTempCwd(proto, options(), "1.4.0")?.();
	assert.equal(proto.init, stock);
	installTempCwd(proto, options(), "1.4.0");
	const once = proto.init;
	installTempCwd(proto, options(), "1.4.0");
	assert.equal(proto.init, once);
	const chat = Object.assign(Object.create(proto), host(join(home, "project")));
	await chat.init();
	assert.deepEqual(log, [`init ${join(home, "project")}`]);
});

it("the extension patches Pi's real InteractiveMode, and another Pi version keeps stock with a startup warning", () => {
	tempCwd({ on: () => undefined } as unknown as ExtensionAPI);
	assert.notEqual(InteractiveMode.prototype.init, realInit);
	const proto = prototype();
	const stock = proto.init;
	const handlers = new Map<string, (event: unknown, ctx: unknown) => void>();
	registerTempCwd({ on: (name: string, handler: never) => handlers.set(name, handler) } as unknown as ExtensionAPI, proto, options(), "1.5.0");
	assert.equal(proto.init, stock);
	const ctx = (cwd: string) => ({ cwd, hasUI: true, ui: { notify: (message: string) => log.push(message) } });
	handlers.get("session_start")?.({ reason: "startup" }, ctx(home));
	handlers.get("session_start")?.({ reason: "startup" }, ctx(join(home, "project")));
	assert.equal(log.length, 1);
	assert.match(log[0]!, /not supported by RQW-cwd; the chat stays in/);
});
});
