import assert from "node:assert/strict";
import { it } from "node:test";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { fetchQuota } from "../../../extensions/RQW-anthropic/quota.ts";

const ACCESS = "sk-ant-oat01-fake-quota";
const credential = { type: "oauth" as const, access: ACCESS, refresh: "fake-refresh", expires: 4_102_444_800_000 };

it("returns weekly quota even when an unused window is malformed", async () => {
	const credentials = new InMemoryCredentialStore();
	await credentials.modify("anthropic", async () => credential);
	const result = await fetchQuota(credentials, new AbortController().signal, async () => Response.json({
		five_hour: { utilization: "invalid", resets_at: false },
		seven_day: { utilization: 100, resets_at: "2026-10-31T00:00:00Z" },
	}));
	assert.deepEqual(result.windows, {
		seven_day: { utilization: 100, remainingPercent: 0, resetsAt: "2026-10-31T00:00:00Z" },
	});
	assert.deepEqual(await credentials.read("anthropic"), credential);
});
