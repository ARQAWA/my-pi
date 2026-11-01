import { basename } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { sessionOf } from "./fork-payload.ts";
import type { RunningCounts } from "./running-counts.ts";

const FILE = /^herdr-agent-state\.[cm]?[jt]s$/;
type Handler = (event: unknown, ctx: any) => unknown;

/** Keep the user-owned herdr indicator in sync without changing Pi's run or queue. */
export function registerHerdrActivity(pi: ExtensionAPI, counts: RunningCounts) {
	let release = () => {};
	pi.on("session_start", (_event, ctx) => {
		release(); release = () => {};
		if (process.env.HERDR_ENV !== "1" || ctx.mode !== "tui") return;
		const extensions = (sessionOf(ctx) as unknown as { _extensionRunner?: { extensions?: unknown } } | undefined)?._extensionRunner?.extensions;
		if (!Array.isArray(extensions)) return;
		const restores: (() => void)[] = [];
		for (const extension of extensions as { path?: unknown; resolvedPath?: unknown; handlers?: unknown }[]) {
			if (![extension?.path, extension?.resolvedPath].some(file => typeof file === "string" && FILE.test(basename(file))) || !(extension.handlers instanceof Map)) continue;
			const settled = extension.handlers.get("agent_settled") as Handler[] | undefined;
			const started = extension.handlers.get("agent_start") as Handler[] | undefined;
			if (!Array.isArray(settled) || !Array.isArray(started) || !started.every(handler => typeof handler === "function")) continue;
			let last: { event: unknown; ctx: any } | undefined;
			let background = counts.running();
			settled.forEach((original, index) => {
				if (typeof original !== "function") return;
				const wrapped: Handler = (event, handlerCtx) => {
					last = { event, ctx: handlerCtx };
					if (!counts.running()) return original(event, handlerCtx);
				};
				settled[index] = wrapped;
				restores.push(() => { const at = settled.indexOf(wrapped); if (at >= 0) settled[at] = original; });
			});
			const stop = counts.subscribe(() => {
				const next = counts.running();
				if (next === background) return;
				background = next;
				if (!last || !last.ctx.isIdle()) return;
				const handlers = next ? started : settled;
				for (const handler of handlers) { try { void Promise.resolve(handler(last.event, last.ctx)).catch(() => {}); } catch { /* User integration is best effort. */ } }
			});
			restores.push(() => {
				stop();
				if (background && last?.ctx.isIdle()) {
					for (const handler of settled) { try { void Promise.resolve(handler(last.event, last.ctx)).catch(() => {}); } catch { /* User integration is best effort. */ } }
				}
			});
		}
		release = () => restores.forEach(restore => restore());
	});
	pi.on("session_shutdown", () => { release(); release = () => {}; });
}
