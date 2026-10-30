import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installCommands } from "./commands.ts";
import { installControls } from "./controls.ts";

export default function commands(pi: ExtensionAPI) {
 let commandsDispose: (() => void) | undefined;
 let controlsDispose: (() => void) | undefined;
 try { commandsDispose = installCommands(pi, false); }
 catch { pi.on("session_start", (_event, ctx) => { if (ctx.hasUI) ctx.ui.notify("RQW-commands: incompatible Pi command internals; command cleanup is disabled.", "warning"); }); }
 try { controlsDispose = installControls(pi, false); }
 catch { pi.on("session_start", (_event, ctx) => { if (ctx.hasUI) ctx.ui.notify("RQW-commands: incompatible Pi controls internals; controls cleanup is disabled.", "warning"); }); }
 pi.on("session_shutdown", () => { controlsDispose?.(); commandsDispose?.(); });
}
