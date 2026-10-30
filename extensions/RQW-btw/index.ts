// RQW-btw: `/btw` opens a side chat about the main session over the whole screen, as Codex's side conversation,
// simplified. Escape or Ctrl+C leaves it and everything is forgotten; the main chat keeps running underneath.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installBtwCore } from "./core.ts";
import { SideChat } from "./view.ts";

export default function btw(pi: ExtensionAPI) {
	const core = installBtwCore(pi);
	let open: SideChat | undefined;

	pi.on("session_shutdown", () => { open?.close(); open = undefined; });

	pi.registerCommand("btw", {
		description: "Open a side chat about this session",
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") { ctx.ui.notify("/btw needs the interactive view.", "warning"); return; }
			// What the main model sees now, frozen; the side chat grows from this mark.
			const mark = core.mark(ctx);
			if (!mark) { ctx.ui.notify("/btw needs a selected model.", "error"); return; }
			open?.close();
			const question = args.trim();
			// Never awaited: Pi's input queue and the main run do not wait for the side chat.
			void ctx.ui.custom<void>((tui, theme, _keys, done) => {
				const chat = new SideChat(tui, theme, ctx, core, mark, () => done());
				open = chat;
				if (question) chat.send(question);
				return chat;
			}, { overlay: true, overlayOptions: { anchor: "top-left", row: 0, col: 0, width: "100%", maxHeight: "100%" } })
				.catch(() => {})
				.finally(() => { if (open?.isClosed()) open = undefined; });
		},
	});
}
