import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.on("agent_before_settle", async () => {
		const hold = (globalThis as any).__agentPhase;
		if (!hold?.enabled || hold.side !== "after") return;
		hold.enabled = false;
		hold.entered = true;
		await new Promise<void>(resolve => { hold.release = resolve; });
	});
}
