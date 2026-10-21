import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Capture native signals, without supplying a synthetic signal to a boundary.
export default function (pi: ExtensionAPI) {
	const observations = (globalThis as any).__reviewLifecycle;
	pi.on("agent_start", (_event, ctx) => { observations.active = ctx.signal; });
	pi.on("agent_end", (_event, ctx) => { observations.end = ctx.signal; });
	pi.on("agent_before_settle", (_event, ctx) => { observations.boundary = ctx.signal; });
}
