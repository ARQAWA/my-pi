import assert from "node:assert/strict";
import { it } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { Agent } from "@earendil-works/pi-agent-core";
import { harness } from "./harness.ts";
import { installHook } from "../../../extensions/RQW-context/hooks.ts";
import "../../../extensions/RQW-context/index.ts";
import { saveContextHooks } from "./hooks-cleanup.ts";

it("restores new hooks and preserves an earlier owner's forwarding slot", () => {
	const proto = SessionManager.prototype;
	const original = Object.getOwnPropertyDescriptor(proto, "buildSessionProjection")!;
	const key = Symbol.for("rqw-context/live-hooks");
	const previous = (globalThis as Record<symbol, any>)[key]?.get(proto)?.get("buildSessionProjection");
	const previousRun = previous?.run;
	const finish = saveContextHooks();
	try {
		installHook(proto, "buildContextEntries", "value", originalMethod => function (this: unknown, ...args: unknown[]) {
			return originalMethod.apply(this, args);
		});
		const before = Object.getOwnPropertyDescriptor(proto, "buildContextEntries")!;
		const registry = (globalThis as Record<symbol, any>)[key];
		const slot = registry.get(proto).get("buildContextEntries");
		const run = slot.run;
		const shared = globalThis as Record<symbol, any>;
		const live = shared[Symbol.for("rqw-context/live-helpers")];
		const previousHelper = live.capModel;
		const background = shared[Symbol.for("rqw-context/background")];
		const previousOn = background.on;
		const restore = saveContextHooks();
		live.capModel = () => "other owner";
		background.on = !previousOn;
		installHook(proto, "buildContextEntries", "value", () => () => []);
		installHook(proto, "buildSessionProjection", "value", originalMethod => function (this: unknown, ...args: unknown[]) {
			return originalMethod.apply(this, args);
		});
		restore();
		assert.deepEqual(Object.getOwnPropertyDescriptor(proto, "buildContextEntries"), before);
		assert.equal(registry.get(proto).get("buildContextEntries"), slot);
		assert.equal(slot.run, run);
		assert.equal(live.capModel, previousHelper);
		assert.equal(background.on, previousOn);
		assert.deepEqual(Object.getOwnPropertyDescriptor(proto, "buildSessionProjection"), original);
		assert.equal(registry.get(proto).get("buildSessionProjection"), previous);
		if (previous) assert.equal(previous.run, previousRun);
	} finally { finish(); }
});

it("reinstalls a known slot after another cleanup restored the original descriptor", () => {
	const proto = SessionManager.prototype;
	const name = "buildContextEntries";
	const before = Object.getOwnPropertyDescriptor(proto, name)!;
	const restore = saveContextHooks();
	const registry = (globalThis as Record<symbol, any>)[Symbol.for("rqw-context/live-hooks")];
	try {
		installHook(proto, name, "value", original => function (this: unknown, ...args: unknown[]) {
			return original.apply(this, args);
		});
		const slot = registry.get(proto).get(name);
		Object.defineProperty(proto, name, before);
		installHook(proto, name, "value", original => function (this: unknown, ...args: unknown[]) {
			return original.apply(this, args);
		});
		assert.equal(Object.getOwnPropertyDescriptor(proto, name)?.value, slot.forward);
	} finally { restore(); }
});

it("removes a slot when another cleanup already restored the original descriptor", () => {
	const proto = SessionManager.prototype;
	const name = "buildContextEntries";
	const before = Object.getOwnPropertyDescriptor(proto, name)!;
	const restore = saveContextHooks();
	const registry = (globalThis as Record<symbol, any>)[Symbol.for("rqw-context/live-hooks")];
	try {
		installHook(proto, name, "value", original => function (this: unknown, ...args: unknown[]) {
			return original.apply(this, args);
		});
		Object.defineProperty(proto, name, before);
		restore();
		assert.equal(registry.get(proto)?.has(name) ?? false, false);
		installHook(proto, name, "value", original => function (this: unknown, ...args: unknown[]) {
			return original.apply(this, args);
		});
		assert.equal(Object.getOwnPropertyDescriptor(proto, name)?.value, registry.get(proto).get(name).forward);
	} finally { restore(); }
});

it("keeps a later wrapper and neutralizes the test's forwarding slot", () => {
	const proto = SessionManager.prototype as unknown as Record<string, any>;
	const name = "testCleanupMethod";
	const original = () => "original";
	Object.defineProperty(proto, name, { value: original, writable: true, configurable: true });
	const restore = saveContextHooks();
	const registry = (globalThis as Record<symbol, any>)[Symbol.for("rqw-context/live-hooks")];
	try {
		installHook(proto, name, "value", () => () => "test");
		const forward = proto[name];
		const other = () => `other ${forward()}`;
		proto[name] = other;
		restore();
		assert.equal(proto[name], other);
		assert.equal(proto[name](), "other original");
		assert.equal(registry.get(proto).get(name).run, original);
	} finally {
		Reflect.deleteProperty(proto, name);
		registry.get(proto)?.delete(name);
	}
});

it("keeps a later active owner's helpers and hooks, then restores on shutdown", async () => {
	const before = Object.getOwnPropertyDescriptor(Agent.prototype, "state");
	const sharedBefore = globalThis as Record<symbol, any>;
	const helperBefore = sharedBefore[Symbol.for("rqw-context/live-helpers")].capModel;
	const restore = saveContextHooks();
	const h = await harness();
	const shared = globalThis as Record<symbol, any>;
	const live = shared[Symbol.for("rqw-context/live-helpers")];
	const registry = shared[Symbol.for("rqw-context/live-hooks")];
	const slot = registry.get(Agent.prototype).get("state");
	const run = slot.run;
	const helper = live.capModel;
	try {
		restore();
		assert.equal(slot.run, run);
		assert.equal(live.capModel, helper);
		const state = h.session.agent.state as { model: { contextWindow: number } };
		state.model = { provider: "faux", id: "big", api: "test", contextWindow: 1_000_000 } as never;
		assert.equal(state.model.contextWindow, 500_000);
	} finally {
		await h.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" } as never);
		h.session.dispose();
	}
	assert.deepEqual(Object.getOwnPropertyDescriptor(Agent.prototype, "state"), before);
	assert.equal(live.capModel, helperBefore);
});

for (const newestFirst of [false, true]) it(`restores overlapping deferred snapshots in reverse order, newest requested first: ${newestFirst}`, async () => {
	const before = Object.getOwnPropertyDescriptor(Agent.prototype, "state");
	const firstRestore = saveContextHooks();
	const first = await harness();
	const secondRestore = saveContextHooks();
	const second = await harness();
	const owners = (globalThis as Record<symbol, any>)[Symbol.for("rqw-context/owner")] as Set<object>;
	const deleteBefore = Object.getOwnPropertyDescriptor(owners, "delete");
	try {
		await first.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" } as never);
		first.session.dispose();
		for (const restore of newestFirst ? [secondRestore, firstRestore] : [firstRestore, secondRestore]) restore();
		await second.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" } as never);
		second.session.dispose();
		assert.deepEqual(Object.getOwnPropertyDescriptor(Agent.prototype, "state"), before);
		assert.deepEqual(Object.getOwnPropertyDescriptor(owners, "delete"), deleteBefore);
	} finally {
		secondRestore();
		firstRestore();
	}
});

it("reinstalls neutralized agent hooks under a later wrapper for a new session", async () => {
	const restore = saveContextHooks();
	const first = await harness();
	const proto = Agent.prototype;
	const registry = (globalThis as Record<symbol, any>)[Symbol.for("rqw-context/live-hooks")];
	const slots = registry.get(proto);
	const descriptors = ["state", "createLoopConfig"].map(name => [name, Object.getOwnPropertyDescriptor(proto, name)!] as const);
	let second: Awaited<ReturnType<typeof harness>> | undefined;
	try {
		for (const [name, descriptor] of descriptors) {
			const slot = slots.get(name);
			slot.run = slot.original;
			if (name === "state") Object.defineProperty(proto, name, { ...descriptor, get: function () { return descriptor.get!.call(this); } });
			else Object.defineProperty(proto, name, { ...descriptor, value: function (this: unknown, ...args: unknown[]) { return descriptor.value.apply(this, args); } });
		}
		second = await harness();
		for (const [name] of descriptors) assert.notEqual(slots.get(name).run, slots.get(name).original);
		const state = second.session.agent.state as { model: { contextWindow: number } };
		state.model = { provider: "faux", id: "big", api: "test", contextWindow: 1_000_000 } as never;
		assert.equal(state.model.contextWindow, 500_000);
	} finally {
		for (const [name, descriptor] of descriptors) Object.defineProperty(proto, name, descriptor);
		for (const h of [first, second]) if (h) {
			await h.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" } as never);
			h.session.dispose();
		}
		restore();
	}
});
