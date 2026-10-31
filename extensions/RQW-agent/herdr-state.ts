import { basename } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { sessionOf } from "./fork-payload.ts";
import type { RealFinal } from "./real-final.ts";

const FILE = /^herdr-agent-state\.[cm]?[jt]s$/;
const KEY = "herdr-agent-state";
type Handler = (event: unknown, ctx: unknown) => unknown;

/** The herdr integration is a user file we cannot edit: its `agent_settled` handler waits for the real final instead of the end of the turn. */
export function registerHerdrHold(pi: ExtensionAPI, realFinal: RealFinal) {
	let release = () => {};
	pi.on("session_start", (_event, ctx) => {
		release(); release = () => {};
		if (process.env.HERDR_ENV !== "1" || ctx.mode !== "tui") return;
		const extensions = (sessionOf(ctx) as unknown as { _extensionRunner?: { extensions?: unknown } } | undefined)?._extensionRunner?.extensions;
		if (!Array.isArray(extensions)) return;
		const restores: (() => void)[] = [];
		for (const extension of extensions as { path?: unknown; resolvedPath?: unknown; handlers?: unknown }[]) {
			const files = [extension?.path, extension?.resolvedPath];
			if (!files.some(file => typeof file === "string" && FILE.test(basename(file))) || !(extension.handlers instanceof Map)) continue;
			const list = extension.handlers.get("agent_settled") as Handler[] | undefined;
			if (!Array.isArray(list)) continue;
			list.forEach((original, index) => {
				if (typeof original !== "function") return;
				const wrapped: Handler = (event, handlerCtx) => {
					if (!realFinal.held()) return original(event, handlerCtx);
					realFinal.defer(KEY, () => original(event, handlerCtx));
				};
				list[index] = wrapped;
				restores.push(() => { const at = list.indexOf(wrapped); if (at >= 0) list[at] = original; });
			});
		}
		release = () => restores.forEach(restore => restore());
	});
	pi.on("session_shutdown", () => { release(); release = () => {}; });
}
