// The card for RQW-agent's `child_wait` notification that delivers finished child results (display only).
// Its `details` are the wait result: `{ reason, results: [{ id, text, outcome }], ... }`, and its content is the same
// object as JSON text. Timeouts, alerts and every message without a delivered result return undefined, so Pi keeps
// its default view for them.
import type { MessageRenderer } from "@earendil-works/pi-coding-agent";
import { type CardTheme, cardLines, cardParts, messageText, type ParsedCard } from "./card.ts";
import { fit, padded } from "./fit.ts";

const TYPE = "child_wait";

/** The coordinator's outcome (`completed` | `error`) in the card's words; any other value shows no status. */
const OUTCOMES: Record<string, "finished" | "failed"> = { completed: "finished", error: "failed" };

function waitDetails(message: { content: unknown; details?: unknown }): { reason?: unknown; results?: unknown } | undefined {
	if (message.details && typeof message.details === "object") return message.details;
	try {
		const parsed: unknown = JSON.parse(messageText(message.content));
		return parsed && typeof parsed === "object" ? parsed : undefined;
	} catch {
		return undefined;
	}
}

/** One card per delivered result; undefined for anything that is not a `reason: "result"` notification with results. */
export function childWaitCards(message: { content: unknown; details?: unknown }): ParsedCard[] | undefined {
	const details = waitDetails(message);
	if (details?.reason !== "result" || !Array.isArray(details.results)) return undefined;
	const cards: ParsedCard[] = [];
	for (const item of details.results) {
		if (!item || typeof item !== "object") continue;
		const { id, text, outcome } = item as { id?: unknown; text?: unknown; outcome?: unknown };
		const status = typeof outcome === "string" ? OUTCOMES[outcome] : undefined;
		cards.push(cardParts(id, { outcome: status }, typeof text === "string" ? text : "", TYPE));
	}
	return cards.length ? cards : undefined;
}

/** A single result is one card named `child_wait · <id>`; several get a summary row and indented cards. */
export function childWaitLines(cards: ParsedCard[], expanded: boolean, theme: CardTheme, width: number): string[] {
	if (width <= 0) return [];
	if (cards.length === 1) return cardLines({ ...cards[0], id: `${TYPE} · ${cards[0].id}` }, expanded, theme, width);
	const failed = cards.filter((card) => card.outcome === "failed").length;
	const summary = theme.fg("muted", `${TYPE} · ${cards.length} results`) + (failed ? theme.fg("dim", " · ") + theme.fg("error", `${failed} failed`) : "");
	const indent = width >= 8 ? "  " : "";
	return [
		fit(summary, width),
		...cards.flatMap((card) => cardLines(card, expanded, theme, width - indent.length).map((row) => (row ? indent + row : ""))),
	];
}

export const createChildWaitCard: MessageRenderer = (message, options, theme) => {
	if (message.customType !== TYPE) return undefined;
	const cards = childWaitCards(message);
	if (!cards) return undefined;
	return { render: padded((width) => childWaitLines(cards, options.expanded, theme, width), options.outputPad), invalidate() {} };
};
