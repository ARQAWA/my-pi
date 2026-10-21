import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Loaded before RQW-agent to hold a new busy run before its abort latch is reset.
const shared = globalThis as typeof globalThis & {
	__agentSlowStart?: { enabled: boolean; entered: boolean; release: () => void };
};
export default function (pi: ExtensionAPI) {
	pi.on("agent_start", async () => {
		const slow = shared.__agentSlowStart;
		if (!slow?.enabled) return;
		slow.entered = true;
		await new Promise<void>(resolve => { slow.release = resolve; });
	});
}
