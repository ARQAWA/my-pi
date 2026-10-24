// Cards for the results an agent `wait` call returns, and the stock result view that
// stays reachable through Ctrl+O. Pure functions over public Pi types; the wiring is index.ts.
import { keyHint, type ToolRenderers } from "@earendil-works/pi-coding-agent";
import { type Component, stripTerminalSequences, Text } from "@earendil-works/pi-tui";
import { type CardTheme, cardLines, cardParts, type ParsedCard } from "./card.ts";

export const WAIT_TOOLS = ["agent"] as const;

type ResultRenderer = NonNullable<ToolRenderers["renderResult"]>;
type ToolResult = Parameters<ResultRenderer>[0];

/** Rows of Pi's own fallback result view: the first lines collapsed, the rest behind the expand key. */
const FALLBACK_PREVIEW_LINES = 10;

/**
 * One card per delivered result of a wait call, read from `details.results[i]` (`id`, `text`, and the T15 display
 * details under `display`). Undefined when this is not a wait result with at least one delivered answer.
 */
export function waitCards(toolName: string, args: unknown, result: Pick<ToolResult, "details">): ParsedCard[] | undefined {
	if ((args as { action?: unknown } | undefined)?.action !== "wait") return undefined;
	const details = result.details as { reason?: unknown; results?: unknown } | undefined;
	// Alerts, timeouts and status snapshots are diagnostics, not delivered answers.
	if (details?.reason !== "result" || !Array.isArray(details.results)) return undefined;
	const results = details.results;
	const cards: ParsedCard[] = [];
	for (const item of results) {
		if (!item || typeof item !== "object") continue;
		const { id, text, display } = item as { id?: unknown; text?: unknown; display?: unknown };
		cards.push(cardParts(id, display, typeof text === "string" ? text : "", toolName));
	}
	return cards.length ? cards : undefined;
}

/** Plain text of a result's text blocks, the way Pi's fallback shows it (terminal sequences and control characters out). */
function resultText(result: Pick<ToolResult, "content">): string {
	return result.content
		.filter((block): block is { type: "text"; text: string } => block.type === "text")
		.map((block) => stripTerminalSequences(block.text || "").replace(/\r/g, "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ""))
		.join("\n");
}

const empty: Component = { render: () => [], invalidate() {} };

/**
 * The stock view of a result for a tool without its own result renderer: what Pi draws by default (`toolOutput`
 * text, ten lines collapsed with the expand hint, everything expanded). Images are not drawn here; Pi's
 * host adds them itself, outside any renderer.
 */
export function stockResult(result: Pick<ToolResult, "content">, expanded: boolean, theme: CardTheme): Component {
	const output = resultText(result);
	if (!output) return empty;
	const lines = output.split("\n");
	const shown = expanded ? lines : lines.slice(0, FALLBACK_PREVIEW_LINES);
	const remaining = lines.length - shown.length;
	let text = shown.map((line) => theme.fg("toolOutput", line)).join("\n");
	if (remaining > 0) text += `${theme.fg("muted", `\n... (${remaining} more lines,`)} ${keyHint("app.tools.expand", "to expand")}${theme.fg("muted", ")")}`;
	return new Text(text, 0, 0);
}

/**
 * The result renderer of one wait-capable tool, layered over `inner` (the renderers of whatever comes after this
 * extension). A finished, collapsed wait shows the cards; everything else, Ctrl+O included, is exactly the inner view,
 * or Pi's stock view when there is none.
 */
export function waitResultRenderer(toolName: string, inner: ToolRenderers): ResultRenderer {
	return (result, options, theme, context) => {
		if (!options.expanded && !options.isPartial && !context.isError) {
			const cards = waitCards(toolName, context.args, result);
			if (cards) return { render: (width) => cards.flatMap((card) => cardLines(card, false, theme, width)), invalidate() {} };
		}
		return inner.renderResult ? inner.renderResult(result, options, theme, context) : stockResult(result, options.expanded, theme);
	};
}
