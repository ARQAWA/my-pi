import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import * as pi from "@earendil-works/pi-coding-agent";
import { installLifecycle as installAnthropic } from "../extensions/RQW-anthropic/lifecycle.ts";
import { installLifecycle as installCodex, SESSION_BIND } from "../extensions/RQW-codex/lifecycle.ts";
import { installCacheDefault } from "../extensions/RQW-settings/cache-warming.ts";

// Package-level coexistence: this is the only test that loads both RQW-anthropic and RQW-codex together.
// Both lifecycles run their real installLifecycle on the real Pi 1.4.0 AgentSession prototype.

const { AgentSession } = pi;
const PROTOTYPE = AgentSession.prototype as unknown as Record<string, unknown>;
const NAME = "_bindExtensionCore";
const INNER = Symbol.for("rqw:method-inner");

type Fn = (this: unknown, ...args: unknown[]) => unknown;

function describe(name: string) {
	return Object.getOwnPropertyDescriptor(PROTOTYPE, name);
}

/** Number of function layers on the binder chain, stock included. Stock alone is 1. */
function chainLength(): number {
	let fn = describe(NAME)?.value as (Fn & Record<symbol, unknown>) | undefined;
	let count = 0;
	for (; typeof fn === "function" && count < 32; count++) fn = fn[INNER] as typeof fn;
	return count;
}

/** Minimal ExtensionAPI stand-in: only Pi's native handler map is used by the Codex lifecycle. */
function fakePi() {
	const handlers = new Map<string, ((event: unknown, ctx: unknown) => void)[]>();
	return {
		api: { on(name: string, handler: (event: unknown, ctx: unknown) => void) {
			handlers.set(name, [...(handlers.get(name) ?? []), handler]);
		} } as unknown as pi.ExtensionAPI,
		bind(session: unknown, name = SESSION_BIND) {
			for (const handler of handlers.get(name) ?? []) handler({ type: name, session }, {});
		},
	};
}

async function withSessions(run: (create: (options?: Partial<pi.CreateAgentSessionOptions>) => Promise<pi.AgentSession>) => Promise<void>) {
	const dir = mkdtempSync(join(tmpdir(), "rqw-codex-coexistence-"));
	const sessions: pi.AgentSession[] = [];
	const create = async (options: Partial<pi.CreateAgentSessionOptions> = {}) => {
		const resourceLoader = new pi.DefaultResourceLoader({ cwd: dir, agentDir: dir, noExtensions: true,
			noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
		await resourceLoader.reload();
		const { session } = await pi.createAgentSession({ cwd: dir, agentDir: dir, resourceLoader,
			sessionManager: pi.SessionManager.inMemory(dir), settingsManager: pi.SettingsManager.inMemory({ retry: { enabled: false } }),
			...options });
		sessions.push(session);
		return session;
	};
	try { await run(create); }
	finally {
		for (const session of sessions) session.dispose();
		rmSync(dir, { recursive: true, force: true });
	}
}

it("Anthropic installed first, Codex second: releasing Anthropic keeps Codex bound for same-runtime children", async () => {
	await withSessions(async create => {
		const stock = describe(NAME);
		const fake = fakePi();
		const codexBound: pi.AgentSession[] = [];
		let anthropicDisposed = 0;
		const anthropic = installAnthropic(() => { anthropicDisposed++; });
		const codex = installCodex(fake.api, session => { codexBound.push(session); return {}; });
		assert.equal(chainLength(), 3);

		const main = await create();
		fake.bind(main);
		anthropic.bindSession({}, main);
		anthropic.release();
		assert.equal(chainLength(), 2, "Anthropic's layer is gone, Codex's survives over stock");
		assert.notDeepEqual(describe(NAME), stock);

		const child = await create({ modelRuntime: main.modelRuntime });
		assert.deepEqual(codexBound, [main, child], "the same-runtime generic child is bound by Codex after Anthropic released");
		codex.release();
		assert.deepEqual(describe(NAME), stock, "exact stock restored after both last owners");
		assert.equal(anthropicDisposed, 0);
	});
});

it("Codex installed first, Anthropic second: releasing Codex keeps Anthropic's method behaviour, and both last owners restore stock", async () => {
	await withSessions(async create => {
		const stock = describe(NAME);
		const fake = fakePi();
		const codexBound: pi.AgentSession[] = [];
		let anthropicDisposed = 0;
		const codex = installCodex(fake.api, session => { codexBound.push(session); return {}; });
		const anthropic = installAnthropic(() => { anthropicDisposed++; });
		assert.equal(chainLength(), 3);

		codex.release();
		assert.equal(chainLength(), 2, "Codex's layer is rebased out; Anthropic's layer survives with stock inside");
		const main = await create();
		fake.bind(main);
		assert.equal(codexBound.length, 0, "released Codex binds nothing");

		// Anthropic's dispose behaviour survives Codex's release: its bound callback still runs on dispose.
		anthropic.bindSession({}, main);
		main.dispose();
		assert.equal(anthropicDisposed, 1);
		anthropic.release();
		assert.deepEqual(describe(NAME), stock);
	});
});

it("opposite orders with interleaved owners keep every survivor and never leave a stale layer", async () => {
	await withSessions(async create => {
		const stock = describe(NAME);
		const fake = fakePi();
		const codexBound: pi.AgentSession[] = [];
		const codex = installCodex(fake.api, session => { codexBound.push(session); return {}; });
		const first = installAnthropic(() => {});
		const second = installAnthropic(() => {});
		assert.equal(chainLength(), 3, "two Anthropic installs share one layer over Codex's layer over stock");
		first.release();
		assert.equal(chainLength(), 3, "a second Anthropic install keeps the patch while Codex is alive");
		const main = await create();
		fake.bind(main);
		second.release();
		assert.equal(chainLength(), 2);
		const child = await create({ modelRuntime: main.modelRuntime });
		assert.deepEqual(codexBound, [main, child]);
		codex.release();
		assert.deepEqual(describe(NAME), stock);
	});
});

it("reloads: repeated install and release cycles keep the chain bounded and restore stock at the end", async () => {
	await withSessions(async create => {
		const stock = describe(NAME);
		const fake = fakePi();
		const codexBound: pi.AgentSession[] = [];
		for (let reload = 0; reload < 4; reload++) {
			const codex = installCodex(fake.api, session => { codexBound.push(session); return {}; });
			const anthropic = installAnthropic(() => {});
			assert.equal(chainLength(), 3, `reload ${reload}: one layer per live owner over stock`);
			const main = await create();
			fake.bind(main);
			anthropic.release();
			assert.equal(chainLength(), 2, `reload ${reload}: Anthropic released, Codex intact`);
			const child = await create({ modelRuntime: main.modelRuntime });
			assert.equal(codexBound.at(-1), child, `reload ${reload}: child bound by Codex`);
			codex.release();
			assert.deepEqual(describe(NAME), stock, `reload ${reload}: exact stock restored`);
		}
	});
});

it("a runtime without a Codex lease is not marked by Codex, with Anthropic installed alongside", async () => {
	await withSessions(async create => {
		const fake = fakePi();
		const codexBound: pi.AgentSession[] = [];
		const anthropic = installAnthropic(() => {});
		const codex = installCodex(fake.api, session => { codexBound.push(session); return {}; });
		const main = await create();
		fake.bind(main);
		const other = await create();
		assert.deepEqual(codexBound, [main]);
		assert.notEqual(other.modelRuntime, main.modelRuntime);
		codex.release();
		anthropic.release();
	});
});

// Settings' own bind marker, dispatched by the test the way Pi dispatches it for a loaded extension instance.

const CACHE_BIND = "rqw-settings:cache-default-bind";

it("settings, Anthropic, Codex installed in manifest order: each release keeps the survivors and the last owner restores stock", async () => {
	for (const order of ["manifest", "reverse"] as const) {
		await withSessions(async create => {
			const stock = describe(NAME);
			const stockDispose = describe("dispose");
			const fake = fakePi();
			const cacheFake = fakePi();
			const codexBound: pi.AgentSession[] = [];
			const settings = installCacheDefault(cacheFake.api);
			const anthropic = installAnthropic(() => {});
			const codex = installCodex(fake.api, session => { codexBound.push(session); return {}; });
			assert.equal(chainLength(), 4, `${order}: stock, settings, Anthropic, Codex`);

			const main = await create();
			cacheFake.bind(main, CACHE_BIND);
			fake.bind(main);
			anthropic.bindSession({}, main);
			assert.equal(main.settingsManager.getCacheWarmingMode(), "off");
			const child = await create({ modelRuntime: main.modelRuntime });
			assert.deepEqual(codexBound, [main, child], `${order}: same-runtime child bound by Codex`);
			assert.equal(child.settingsManager.getCacheWarmingMode(), "streaming", "a child's own manager keeps Pi's default");

			const steps: [string, () => void][] = order === "manifest"
				? [["settings", () => settings()], ["anthropic", () => anthropic.release()], ["codex", () => codex.release()]]
				: [["codex", () => codex.release()], ["anthropic", () => anthropic.release()], ["settings", () => settings()]];
			const alive = new Set(["settings", "anthropic", "codex"]);
			for (const [name, release] of steps) {
				release();
				alive.delete(name);
				assert.equal(chainLength(), alive.size + 1, `${order}: after ${name} released`);
				assert.equal(main.settingsManager.getCacheWarmingMode(), alive.has("settings") ? "off" : "streaming", `${order}: settings default after ${name}`);
				const before = codexBound.length;
				const late = await create({ modelRuntime: main.modelRuntime });
				if (alive.has("codex")) assert.equal(codexBound.at(-1), late, `${order}: Codex still binds after ${name}`);
				else assert.equal(codexBound.length, before, `${order}: released Codex binds nothing after ${name}`);
				late.dispose();
			}
			assert.deepEqual(describe(NAME), stock, `${order}: exact stock binder restored`);
			assert.deepEqual(describe("dispose"), stockDispose, `${order}: exact stock dispose restored`);
			assert.equal(Object.hasOwn(main.settingsManager, "getCacheWarmingMode"), false);
		});
	}
});

it("two settings owners on one manager: the manager default is restored by the last owner only", async () => {
	await withSessions(async create => {
		const stock = describe(NAME);
		const a = fakePi();
		const b = fakePi();
		const first = installCacheDefault(a.api);
		const second = installCacheDefault(b.api);
		const main = await create();
		const shared = main.settingsManager;
		a.bind(main, CACHE_BIND);
		const twin = await create({ settingsManager: shared });
		b.bind(twin, CACHE_BIND);
		assert.equal(shared.getCacheWarmingMode(), "off");
		first();
		assert.equal(shared.getCacheWarmingMode(), "off", "the surviving owner keeps the override");
		second();
		assert.equal(shared.getCacheWarmingMode(), "streaming");
		assert.equal(Object.hasOwn(shared, "getCacheWarmingMode"), false);
		assert.deepEqual(describe(NAME), stock);
	});
});

it("settings, Anthropic, Codex across reloads: depth stays bounded and stock is restored at the end", async () => {
	await withSessions(async create => {
		const stock = describe(NAME);
		const stockDispose = describe("dispose");
		const fake = fakePi();
		const cacheFake = fakePi();
		const codexBound: pi.AgentSession[] = [];
		for (let reload = 0; reload < 3; reload++) {
			const settings = installCacheDefault(cacheFake.api);
			const anthropic = installAnthropic(() => {});
			const codex = installCodex(fake.api, session => { codexBound.push(session); return {}; });
			assert.equal(chainLength(), 4, `reload ${reload}: one layer per live owner over stock`);
			const main = await create();
			cacheFake.bind(main, CACHE_BIND);
			fake.bind(main);
			anthropic.bindSession({}, main);
			assert.equal(main.settingsManager.getCacheWarmingMode(), "off");
			codex.release();
			anthropic.release();
			settings();
			assert.equal(chainLength(), 1, `reload ${reload}: no layer left`);
			assert.deepEqual(describe(NAME), stock, `reload ${reload}: exact stock binder`);
			assert.deepEqual(describe("dispose"), stockDispose, `reload ${reload}: exact stock dispose`);
		}
	});
});
