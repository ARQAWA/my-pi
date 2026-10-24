// Expanded wait cards over a self-shell owner. Folded rows remain entirely the owner's components.
import type { Theme, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { Box, type Component, Text } from "@earendil-works/pi-tui";
import { cardLines } from "./card.ts";
import { stockResult, waitCards } from "./wait.ts";

const OWN = Symbol("rqw-agent-ui-wait");
const EMPTY: Component = { render: () => [], invalidate() {} };
type View = { box?: Box };

/** Pi 1.4.0's generic expanded call header (render-utils.js:81); no unexported imports. */
function callHeader(name: string, args: unknown, theme: Theme): string {
	const title = theme.fg("toolTitle", theme.bold(name));
	if (args == null) return title;
	const entries = typeof args === "object" && !Array.isArray(args) ? Object.entries(args) : [["args", args]];
	if (!entries.length) return title;
	const lines = entries.map(([key, value]) => {
		const text = typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? String(value));
		return `  ${key}: ${text.replace(/\t/g, "   ").replace(/\r/g, "").split("\n").join("\n    ")}`;
	});
	return `${title}\n${theme.fg("muted", lines.join("\n"))}`;
}

/** The outer resolver owns only the expanded card box, never the inner resolver's group model or folded rows. */
export function selfShellWaitRenderers(name: string, inner: ToolRenderers): ToolRenderers {
	return {
		...inner,
		renderCall(args, theme, context) {
			const delegated = inner.renderCall?.(args, theme, context) ?? EMPTY;
			if (!context.expanded || args?.action !== "wait") return delegated;
			// Pi calls renderCall before renderResult on every update and expansion. The result fills this view.
			const view: View = {};
			(context.state as Record<symbol, View>)[OWN] = view;
			return {
				render: (width) => (view.box ?? delegated).render(width),
				invalidate() { delegated.invalidate(); view.box?.invalidate(); },
			};
		},
		renderResult(result, options, theme, context) {
			// Hand the exact context through, including state and invalidate, so the owner's lifecycle stays intact.
			const delegated = inner.renderResult?.(result, options, theme, context) ?? stockResult(result, options.expanded, theme);
			const view = (context.state as Record<symbol, View>)[OWN];
			const cards = options.expanded && !options.isPartial && !context.isError
				? waitCards(name, context.args, result) : undefined;
			if (!view || !cards) return delegated;
			const role = context.isPartial ? "toolPendingBg" : context.isError ? "toolErrorBg" : "toolSuccessBg";
			const box = new Box(context.outputPad, 1, (text) => theme.bg(role, text));
			box.addChild(new Text(callHeader(name, context.args, theme), 0, 0));
			box.addChild({ render: (width) => cards.flatMap((card) => cardLines(card, true, theme, width)), invalidate() {} });
			view.box = box;
			// The call component draws one complete box. A separate result component would duplicate its rows.
			return EMPTY;
		},
	};
}
