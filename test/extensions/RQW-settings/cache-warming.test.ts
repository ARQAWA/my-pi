import assert from "node:assert/strict";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
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
