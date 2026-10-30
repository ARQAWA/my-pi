import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installCommands } from "./commands.ts";

export default function commands(pi: ExtensionAPI) {
 try { installCommands(pi); }
 catch { pi.on("session_start", (_event, ctx) => { if (ctx.hasUI) ctx.ui.notify("RQW-commands: incompatible Pi command internals; command cleanup is disabled.", "warning"); }); }
}
