// RQW-predictions: a gray next-message suggestion in the empty main input; Tab accepts it.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createPromptSource } from "./codex-prompt.ts";
import { createController, type Deps } from "./controller.ts";
import { installContext } from "./context.ts";
import { installEditor } from "./editor.ts";
import { installKeybindings } from "./keybindings.ts";

export function install(pi: ExtensionAPI, deps: Deps, clearSource: () => void = () => {}) {
	const context = installContext(pi);
	let hint: string | undefined;
	let offered: { snapshot(): string | undefined; subscribe(listener: () => void): () => void } | undefined;
	let unsubscribeOffer: (() => void) | undefined;
	let session: Parameters<typeof controller.start>[0] | undefined;
	const update = () => {
		hint = controller.brewing() ? "ctrl+r to interrupt" : offered?.snapshot() ?? (controller.available() && keys.ensure() ? "ctrl+e to suggest" : undefined);
		editor.refresh();
	};
	const controller = createController(pi, context, { ...deps, changed: update });
	let notify: ((message: string) => void) | undefined;
	const keys = installKeybindings(message => notify?.(message));
	const editor = installEditor({
		generate: controller.generate,
		cancel: controller.cancel,
		suggestion: controller.suggestion,
		// The manual keys act only while Pi's own actions on them are freed.
		hotkeys: keys.ensure,
		hint: () => hint,
	});

	const adopt = (source: typeof offered, mainEditor?: unknown) => {
		if (mainEditor) editor.attach(mainEditor);
		unsubscribeOffer?.();
		offered = source;
		unsubscribeOffer = source?.subscribe(update);
		update();
	};
	pi.events.on("rqw:editor-hint:painter-query", (value: any) => {
		if (session && value?.sessionId === session.sessionManager.getSessionId()) value.reply?.();
	});
	pi.events.on("rqw:editor-hint:editor-changed", (value: any) => {
		if (session && value?.sessionId === session.sessionManager.getSessionId()) editor.attach(value.editor);
	});
	pi.events.on("rqw:editor-hint:offer", (value: any) => {
		if (session && value?.sessionId === session.sessionManager.getSessionId()) adopt(value.source);
	});

	pi.on("session_start", (_event, ctx) => {
		// Only the main interactive chat has an input to predict for; other modes and child sessions stay quiet.
		if (ctx.mode !== "tui") return;
		notify = message => ctx.ui.notify(message, "warning");
		session = ctx;
		controller.start(ctx);
		editor.start(ctx);
		keys.ensure();
		pi.events.emit("rqw:editor-hint:request", { sessionId: ctx.sessionManager.getSessionId(), reply: adopt });
		pi.events.emit("rqw:editor-hint:painter", { sessionId: ctx.sessionManager.getSessionId(), active: true });
		update();
	});
	pi.on("message_end", event => context.record(event.message));
	pi.on("turn_end", (event, ctx) => controller.answered(ctx, event));
	pi.on("agent_start", () => controller.interrupt());
	pi.on("model_select", () => { controller.interrupt(); update(); });
	pi.on("agent_settled", () => update());
	pi.on("session_compact", () => context.drop());
	pi.on("session_tree", () => controller.clear());
	pi.on("session_shutdown", event => {
		if (session) pi.events.emit("rqw:editor-hint:painter", { sessionId: session.sessionManager.getSessionId(), active: false });
		unsubscribeOffer?.(); unsubscribeOffer = undefined; offered = undefined; session = undefined; hint = undefined;
		editor.stop();
		controller.stop();
		keys.release();
		notify = undefined;
		// A chat switch keeps the fresh prompt of the same account; quit and reload drop it.
		if (event.reason === "quit" || event.reason === "reload") clearSource();
	});
	return controller;
}

export default function predictions(pi: ExtensionAPI) {
	const source = createPromptSource();
	install(pi, { source: { get: signal => source.get(signal) }, now: () => performance.now() }, () => source.clear());
}
