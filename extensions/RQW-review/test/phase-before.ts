import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	for (const name of ["agent_end", "agent_before_settle", "agent_settled"] as const) {
		pi.on(name, async () => {
			const hold = (globalThis as any).__reviewPhase;
			if (!hold?.enabled || hold.side !== "before" || hold.event !== name) return;
			hold.enabled = false;
			hold.entered = true;
			await new Promise<void>(resolve => { hold.release = resolve; });
		});
	}
}
