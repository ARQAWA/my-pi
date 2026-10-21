import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Loaded before RQW-review to hold a new busy run before its abort latch is reset.
const shared = globalThis as typeof globalThis & {
	__reviewSlowStart?: { enabled: boolean; entered: boolean; release: () => void };
};
export default function (pi: ExtensionAPI) {
	pi.on("agent_start", async () => {
		const slow = shared.__reviewSlowStart;
		if (!slow?.enabled) return;
		slow.entered = true;
		await new Promise<void>(resolve => { slow.release = resolve; });
	});
}
