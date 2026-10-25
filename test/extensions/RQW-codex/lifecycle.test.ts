import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import * as pi from "@earendil-works/pi-coding-agent";
import { bindSession, installLifecycle, SESSION_BIND, type SessionPolicy } from "../../../extensions/RQW-codex/lifecycle.ts";
import { CODEX_RETRY_OWNED_DIAGNOSTIC } from "../../../extensions/RQW-codex/retry.ts";

const { AgentSession } = pi;
const PROTOTYPE = AgentSession.prototype as unknown as Record<string, unknown>;

function describe(name: string) {
	return Object.getOwnPropertyDescriptor(PROTOTYPE, name);
}

type Fn = (this: unknown, ...args: unknown[]) => unknown;
const INNER = Symbol.for("rqw:method-inner");

/** Layers on the prototype's _bindExtensionCore, counted through the shared inner links. */
function layerCount(): number {
	let fn = describe("_bindExtensionCore")?.value as (Fn & Record<symbol, unknown>) | undefined;
	let count = 0;
	for (; typeof fn === "function" && count < 32; count++) fn = fn[INNER] as typeof fn;
	return count;
}

/**
 * A cooperating competing layer on the same descriptor: it links to the value it wraps through the shared inner
 * link and reads that link at call time. `restore` removes exactly this layer by rebasing the descriptor to its inner.
 */
function competitor() {
	const current = describe("_bindExtensionCore")!;
	const fn = function (this: unknown, ...args: unknown[]) { return (fn[INNER] as Fn).apply(this, args); };
	Object.defineProperty(fn, INNER, { value: current.value, writable: true, configurable: true });
	Object.defineProperty(PROTOTYPE, "_bindExtensionCore", { ...current, value: fn });
	return { fn, restore: () => Object.defineProperty(PROTOTYPE, "_bindExtensionCore", { ...current, value: (fn as unknown as Record<symbol, unknown>)[INNER] }) };
}

/** Minimal ExtensionAPI stand-in: only the native handler map is used by the lifecycle. */
function fakePi() {
	const handlers = new Map<string, ((event: unknown, ctx: unknown) => void)[]>();
	return {
		handlers,
		api: { on(name: string, handler: (event: unknown, ctx: unknown) => void) {
			handlers.set(name, [...(handlers.get(name) ?? []), handler]);
		} } as unknown as pi.ExtensionAPI,
		/** Pi's binder handler for the exact session being constructed. */
		bind(session: unknown) {
			for (const handler of handlers.get(SESSION_BIND) ?? []) handler({ type: SESSION_BIND, session }, {});
		},
	};
}

async function withSession(run: (dir: string, create: (options?: Partial<pi.CreateAgentSessionOptions>) => Promise<pi.AgentSession>) => Promise<void>) {
	const dir = mkdtempSync(join(tmpdir(), "rqw-codex-lifecycle-"));
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
	try { await run(dir, create); }
	finally {
		for (const session of sessions) session.dispose();
		rmSync(dir, { recursive: true, force: true });
	}
}

function assistant(extra: Record<string, unknown>) {
	return { role: "assistant", content: [], api: "anthropic-messages", provider: "anthropic", model: "fake", usage: {},
		stopReason: "error", errorMessage: "overloaded_error", timestamp: 0, ...extra };
}

function policyRecorder(log: string[], name: string): SessionPolicy {
	return {
		beginRun: start => log.push(`${name}:begin:${start.kind}`),
		endRun: end => log.push(`${name}:end:${end.aborted}`),
		release: () => log.push(`${name}:release`),
	};
}

it("install and final release restore the exact stock prototype descriptor", async () => {
	await withSession(async () => {
		const before = describe("_bindExtensionCore");
		const beforeDispose = describe("dispose");
		const fake = fakePi();
		const lifecycle = installLifecycle(fake.api, () => ({}));
		assert.notDeepEqual(describe("_bindExtensionCore"), before);
		lifecycle.release();
		lifecycle.release();
		assert.deepEqual(describe("_bindExtensionCore"), before);
		assert.deepEqual(describe("dispose"), beforeDispose);
	});
});

it("the loaded main session binds exactly once and same-runtime generic children bind early", async () => {
	await withSession(async (_dir, create) => {
		const log: string[] = [];
		const fake = fakePi();
		const created: pi.AgentSession[] = [];
		const lifecycle = installLifecycle(fake.api, session => { created.push(session); return policyRecorder(log, created.length === 1 ? "main" : "child"); });
		const main = await create();
		fake.bind(main);
		fake.bind(main);
		assert.equal(created.length, 1);
		assert.equal(created[0], main);
		const child = await create({ modelRuntime: main.modelRuntime });
		assert.equal(created.length, 2);
		assert.equal(created[1], child);
		// Sessions on another runtime are not marked.
		await create();
		assert.equal(created.length, 2);
		child.dispose();
		child.dispose();
		assert.deepEqual(log, ["child:release"]);
		main.dispose();
		assert.deepEqual(log, ["child:release", "main:release"]);
		lifecycle.release();
	});
});

it("bindSession releases only its exact session, and a second binding is rejected without side effects", async () => {
	await withSession(async (_dir, create) => {
		const lifecycle = installLifecycle(fakePi().api, () => ({}));
		const log: string[] = [];
		const a = await create();
		const b = await create();
		const releaseA = bindSession(a, policyRecorder(log, "a"));
		const releaseB = bindSession(b, policyRecorder(log, "b"));
		assert.throws(() => bindSession(a, policyRecorder(log, "a2")), /already has a lifecycle binding/);
		assert.deepEqual(log, []);
		a.dispose();
		assert.deepEqual(log, ["a:release"]);
		releaseA();
		assert.deepEqual(log, ["a:release"]);
		releaseB();
		assert.deepEqual(log, ["a:release", "b:release"]);
		lifecycle.release();
	});
});

it("Pi's own retry is suppressed only for messages whose diagnostics carry the owned Codex marker", async () => {
	await withSession(async (_dir, create) => {
		const session = await create();
		const log: string[] = [];
		const stock = session._isRetryableError.bind(session) as (m: unknown) => boolean;
		const diagnostic = { type: CODEX_RETRY_OWNED_DIAGNOSTIC, timestamp: 0 };
		const owned = { provider: "openai-codex", api: "openai-codex-responses", diagnostics: [diagnostic] };
		const release = bindSession(session, policyRecorder(log, "s"));
		try {
			assert.equal(session._isRetryableError(assistant(owned)), false);
			// Other Codex errors without the marker keep Pi's stock classification.
			const plain = assistant({ provider: "openai-codex", api: "openai-codex-responses" });
			assert.equal(session._isRetryableError(plain), stock(plain));
			// The marker is a diagnostic, never a content block: content items do not qualify.
			const inContent = assistant({ provider: "openai-codex", api: "openai-codex-responses", content: [{ type: CODEX_RETRY_OWNED_DIAGNOSTIC }] });
			assert.equal(session._isRetryableError(inContent), stock(inContent));
			// Anthropic messages are never ours, even with the same marker.
			const anthropicMarked = assistant({ diagnostics: [diagnostic] });
			assert.equal(session._isRetryableError(anthropicMarked), stock(anthropicMarked));
			const stop = assistant({ ...owned, stopReason: "stop" });
			assert.equal(session._isRetryableError(stop), stock(stop));
		} finally { release(); }
		assert.equal(session._isRetryableError(assistant(owned)), stock(assistant(owned)));
	});
});

it("run boundaries: agent_start/agent_end, steering inside a run and aborted endings", async () => {
	await withSession(async (_dir, create) => {
		const session = await create();
		const log: string[] = [];
		const release = bindSession(session, policyRecorder(log, "s"));
		const emit = (event: Record<string, unknown>) => (session as unknown as { _emit(e: unknown): void })._emit(event);
		try {
			emit({ type: "agent_start" });
			emit({ type: "message_start", message: { role: "user", content: [] } });
			emit({ type: "turn_start" });
			emit({ type: "message_start", message: { role: "user", content: [] } });
			emit({ type: "agent_end", messages: [{ role: "assistant", stopReason: "aborted" }] });
			// A user message outside a run is not steering.
			emit({ type: "message_start", message: { role: "user", content: [] } });
			emit({ type: "agent_start" });
			emit({ type: "agent_end", messages: [{ role: "assistant", stopReason: "stop" }] });
			assert.deepEqual(log, ["s:begin:run", "s:begin:steer", "s:end:true", "s:begin:run", "s:end:false"]);
		} finally { release(); }
	});
});

it("a competing layer above ours survives our release; our layer is removed from the chain", async () => {
	await withSession(async (_dir, create) => {
		const session = await create();
		const log: string[] = [];
		const owned = assistant({ provider: "openai-codex", api: "openai-codex-responses" });
		const stockValue = session._isRetryableError(owned);
		const stock = describe("_bindExtensionCore");
		const base = layerCount();
		const release = bindSession(session, policyRecorder(log, "s"));
		let competitorCalls = 0;
		const ours = Object.getOwnPropertyDescriptor(session, "dispose")!.value as () => void;
		const above = competitor();
		const competitorDispose = function (this: unknown) { competitorCalls++; return ours.call(this); };
		session.dispose = competitorDispose;
		release();
		assert.equal(session.dispose, competitorDispose);
		assert.deepEqual(log, ["s:release"]);
		session.dispose();
		assert.equal(competitorCalls, 1);
		assert.deepEqual(log, ["s:release"]);
		assert.equal(session._isRetryableError(owned), stockValue);
		// Our binder layer left the chain; the competitor now sits directly on the stock value.
		assert.equal(describe("_bindExtensionCore")?.value, above.fn);
		assert.equal(layerCount(), base + 1);
		above.restore();
		assert.deepEqual(describe("_bindExtensionCore"), stock);
	});
});

it("two owners released in either order keep the patch until the last one is gone", async () => {
	await withSession(async () => {
		const stock = describe("_bindExtensionCore");
		const a = installLifecycle(fakePi().api, () => ({}));
		const b = installLifecycle(fakePi().api, () => ({}));
		assert.notDeepEqual(describe("_bindExtensionCore"), stock);
		a.release();
		assert.notDeepEqual(describe("_bindExtensionCore"), stock);
		assert.equal(layerCount(), 2, "b's layer is rebased onto stock, a's is gone");
		b.release();
		assert.deepEqual(describe("_bindExtensionCore"), stock);
	});
});

it("a released owner stops binding new children and its wrapper passes through", async () => {
	await withSession(async (_dir, create) => {
		const fake = fakePi();
		const created: pi.AgentSession[] = [];
		const lifecycle = installLifecycle(fake.api, session => { created.push(session); return {}; });
		const main = await create();
		fake.bind(main);
		lifecycle.release();
		const child = await create({ modelRuntime: main.modelRuntime });
		assert.equal(created.length, 1);
		assert.equal(child.modelRuntime, main.modelRuntime);
		fake.bind(child);
		assert.equal(created.length, 1);
	});
});

it("reloads above a cooperating competitor do not grow the chain; the competitor is never clobbered", async () => {
	await withSession(async () => {
		const stock = describe("_bindExtensionCore");
		const base = layerCount();
		assert.equal(base, 1, "stock only before the test");
		for (let reload = 0; reload < 5; reload++) {
			const lifecycle = installLifecycle(fakePi().api, () => ({}));
			assert.equal(layerCount(), base + 1);
			const above = competitor();
			lifecycle.release();
			assert.equal(describe("_bindExtensionCore")?.value, above.fn, "the competitor is not clobbered");
			assert.equal(layerCount(), base + 1, "our layer is removed from under the competitor");
			above.restore();
			assert.equal(layerCount(), base);
		}
		assert.deepEqual(describe("_bindExtensionCore"), stock);
	});
});

it("competitor order: ours released with a lower competitor, and a higher competitor restored before ours", async () => {
	await withSession(async () => {
		const stock = describe("_bindExtensionCore");
		// Order A: competitor below ours. Ours releases first; the competitor stays on top of stock.
		const below = competitor();
		const a = installLifecycle(fakePi().api, () => ({}));
		a.release();
		assert.equal(describe("_bindExtensionCore")?.value, below.fn);
		below.restore();
		assert.deepEqual(describe("_bindExtensionCore"), stock);
		// Order B: competitor above ours. The competitor restores (ours returns to the top) before ours releases.
		const b = installLifecycle(fakePi().api, () => ({}));
		const above = competitor();
		above.restore();
		b.release();
		assert.deepEqual(describe("_bindExtensionCore"), stock);
	});
});
