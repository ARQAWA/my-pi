import assert from "node:assert/strict";
import { AgentSession, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { it } from "node:test";
import { installCacheDefault } from "../../../extensions/RQW-settings/cache-warming.ts";

it("shared cache warming stays off until the last owner releases", () => {
	const handlers: ((event: unknown) => void)[] = [];
	const pi = { on(name: string, handler: (event: unknown) => void) {
		if (name === "rqw-settings:cache-default-bind") handlers.push(handler);
		return () => {};
	} } as unknown as ExtensionAPI;
	const first = installCacheDefault(pi);
	const second = installCacheDefault(pi);
	const manager = { cacheWarming: "idle", getCacheWarmingMode: () => "streaming" };
	try {
		handlers[0]({ session: { settingsManager: manager } });
		handlers[1]({ session: { settingsManager: manager } });
		assert.equal(manager.getCacheWarmingMode(), "off");
		assert.equal(manager.cacheWarming, "idle");
		first();
		assert.equal(manager.getCacheWarmingMode(), "off");
		second();
		assert.equal(manager.getCacheWarmingMode(), "streaming");
	} finally {
		first();
		second();
	}
});

it("Pi's session bind turns cache warming off and dispose gives the native mode back", () => {
	const proto = AgentSession.prototype as unknown as Record<string, unknown>;
	const nativeBind = Object.getOwnPropertyDescriptor(proto, "_bindExtensionCore")!;
	const nativeDispose = Object.getOwnPropertyDescriptor(proto, "dispose")!;
	const calls: string[] = [];
	// Stock Pi methods are replaced by recorders, so the test needs no real session.
	Object.defineProperty(proto, "_bindExtensionCore", { ...nativeBind, value() { calls.push("bind"); } });
	Object.defineProperty(proto, "dispose", { ...nativeDispose, value() { calls.push("dispose"); } });
	const handlers: ((event: unknown) => void)[] = [];
	const pi = { on(name: string, handler: (event: unknown) => void) {
		if (name === "rqw-settings:cache-default-bind") handlers.push(handler);
	} } as unknown as ExtensionAPI;
	const release = installCacheDefault(pi);
	try {
		const manager = { getCacheWarmingMode: () => "streaming" };
		const session = {
			settingsManager: manager,
			resourceLoader: { getExtensions: () => ({ extensions: [{ handlers: new Map([["rqw-settings:cache-default-bind", handlers]]) }] }) },
		};
		(proto._bindExtensionCore as (this: unknown) => void).call(session);
		assert.equal(manager.getCacheWarmingMode(), "off");
		(proto.dispose as (this: unknown) => void).call(session);
		assert.equal(manager.getCacheWarmingMode(), "streaming");
		assert.deepEqual(calls, ["bind", "dispose"]);
	} finally {
		release();
		Object.defineProperty(proto, "_bindExtensionCore", nativeBind);
		Object.defineProperty(proto, "dispose", nativeDispose);
	}
});
