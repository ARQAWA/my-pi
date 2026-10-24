// The agent result card: a pure component factory for custom `agent` messages RQW-agent delivers
// (content `[agent#<id>] <text>`). Registration and wiring are not here.
import type { MessageRenderer, Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { Markdown, type MarkdownTheme, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { clean, fit, padded, wrap } from "./fit.ts";

export const CARD_TYPES = ["agent"] as const;

/** The display details RQW-agent may attach (any part can be missing); other fields are ignored. */
export interface CardDetails {
	id?: string;
	outcome?: "finished" | "failed";
	model?: string;
	thinking?: string;
	seconds?: number;
	/** The caller's optional short title of the child (3-5 words). */
	title?: string;
}

/** What the cards use of Pi's theme: semantic colors only. */
export type CardTheme = Pick<Theme, "fg" | "bold"> & Partial<Pick<Theme, "italic" | "underline" | "strikethrough">>;

export interface ParsedCard {
	/** `<name>#<id>`, from the outer prefix, else from details, else the message type. */
	id: string;
	outcome?: "finished" | "failed";
	model?: string;
	thinking?: string;
	seconds?: string;
	/** The child's short title, one line; shown after the id. */
	title?: string;
	/** Text after the outer prefix, cleaned for display. */
	body: string;
}

/**
 * Effort colors: Pi's own per-level thinking tokens (the same ones that colour the editor border by level), so a theme
 * sets each hue once: low, minimal and off ordinary; medium and above bold.
 */
type EffortToken = "thinkingLow" | "thinkingMedium" | "thinkingHigh" | "thinkingXhigh" | "thinkingMax";
const ORDINARY: { color: EffortToken; bold: boolean } = { color: "thinkingLow", bold: false };
const EFFORT: Record<string, { color: EffortToken; bold: boolean }> = {
	off: ORDINARY,
	minimal: ORDINARY,
	low: ORDINARY,
	medium: { color: "thinkingMedium", bold: true },
	high: { color: "thinkingHigh", bold: true },
	xhigh: { color: "thinkingXhigh", bold: true },
	max: { color: "thinkingMax", bold: true },
};

/** Text of a custom message: a string, or its text parts joined. */
export function messageText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type: "text"; text: string } => part?.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("\n");
}

/** Splits the outer `[<type>#<id>]` prefix off; any other brackets stay in the text. */
export function splitPrefix(type: string, text: string): { id?: string; body: string } {
	const escaped = type.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = new RegExp(`^\\[(${escaped}#[^\\]\\s]+)\\] ?`).exec(text);
	return match ? { id: match[1], body: text.slice(match[0].length) } : { body: text };
}

/** `anthropic/claude-opus-5-5` → `opus`; any other `provider/id` → `id`. */
export function shortModel(model: string): string {
	const id = model.slice(model.lastIndexOf("/") + 1);
	return /^claude-([a-z]+)/.exec(id)?.[1] ?? id;
}

/** `42`→`42s`, `12.3`→`12.3s`, `65`→`1m 05s`; undefined for anything that is not a finite number ≥ 0. */
export function formatSeconds(seconds: unknown): string | undefined {
	if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return undefined;
	const tenths = Math.round(seconds * 10) / 10;
	if (tenths < 60) return `${Number.isInteger(tenths) ? tenths : tenths.toFixed(1)}s`;
	const whole = Math.round(tenths);
	return `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, "0")}s`;
}

const oneLine = (text: unknown): string | undefined =>
	typeof text === "string" ? clean(text).replace(/\s+/g, " ").trim() || undefined : undefined;

/** The card parts from an id (prefix or item id), display details (any shape, none required), body and a last-resort id. Never mutates. */
export function cardParts(id: unknown, details: unknown, body: string, fallbackId: string): ParsedCard {
	const raw = details && typeof details === "object" ? (details as Record<string, unknown>) : {};
	return {
		id: oneLine(id) ?? oneLine(raw.id) ?? fallbackId,
		outcome: raw.outcome === "finished" || raw.outcome === "failed" ? raw.outcome : undefined,
		model: oneLine(raw.model),
		thinking: oneLine(raw.thinking),
		seconds: formatSeconds(raw.seconds),
		title: oneLine(raw.title),
		body: clean(body),
	};
}

/** Reads a message into the parts the card shows; never mutates it. */
export function parseCard(message: { customType: string; content: unknown; details?: unknown }): ParsedCard {
	const { id, body } = splitPrefix(message.customType, messageText(message.content));
	return cardParts(id, message.details, body, message.customType);
}

function header(card: ParsedCard, theme: CardTheme, width: number): string {
	const dim = (text: string) => theme.fg("dim", text);
	let rest = "";
	if (card.outcome) rest += theme.fg("muted", " ") + theme.fg(card.outcome === "failed" ? "error" : "success", card.outcome);
	const meta: string[] = [];
	if (card.model || card.thinking) {
		const effort = card.thinking ? EFFORT[card.thinking] ?? ORDINARY : undefined;
		const paintedEffort = card.thinking && effort
			? effort.bold ? theme.bold(theme.fg(effort.color, card.thinking)) : theme.fg(effort.color, card.thinking)
			: "";
		meta.push((card.model ? dim(shortModel(card.model)) : "") + (card.model && paintedEffort ? dim(" ") : "") + paintedEffort);
	}
	if (card.seconds) meta.push(dim(card.seconds));
	for (const part of meta) rest += dim(" · ") + part;
	const id = theme.fg("muted", card.id);
	// The title follows the id and takes only the room the rest leaves, cut with "…"; with no room it is left out.
	let title = "";
	if (card.title) {
		const room = width - visibleWidth(id) - visibleWidth(rest) - 1;
		if (room >= 2) title = theme.fg("muted", " ") + theme.fg("muted", fit(card.title, room));
	}
	return fit(id + title + rest, width);
}

/** Pi's markdown roles, painted from the card's own theme (the tokens Pi's own markdown theme uses). */
function markdownTheme(theme: CardTheme): MarkdownTheme {
	const role = (color: ThemeColor) => (text: string) => theme.fg(color, text);
	// The theme may lack a text style (a minimal test theme); Pi's own Theme has all of them.
	const style = (name: "italic" | "underline" | "strikethrough") => (text: string) => theme[name]?.(text) ?? text;
	return {
		heading: role("mdHeading"), link: role("mdLink"), linkUrl: role("mdLinkUrl"), code: role("mdCode"), codeBlock: role("mdCodeBlock"),
		codeBlockBorder: role("mdCodeBlockBorder"), quote: role("mdQuote"), quoteBorder: role("mdQuoteBorder"), hr: role("mdHr"),
		listBullet: role("mdListBullet"), bold: (text) => theme.bold(text), italic: style("italic"), strikethrough: style("strikethrough"), underline: style("underline"),
	};
}

/** Rendered rows of a text at no width limit (Markdown pads every row to the width, so the padding is dropped again). */
function markdownRows(text: string, color: "error" | "muted", theme: CardTheme, width: number): string[] {
	const markdown = new Markdown(text, 0, 0, markdownTheme(theme), { color: (part) => theme.fg(color, part) },
		{ preserveOrderedListMarkers: true, preserveBackslashEscapes: true });
	const widest = Math.max(...text.split("\n").map((line) => visibleWidth(line)));
	// Never narrower than the card: Markdown can render more text than the source has (a reference link shows its URL),
	// and a row wrapped earlier than the card's edge would lose its end without an ellipsis.
	return markdown.render(Math.max(widest * 2 + 16, width)).map((row) => row.replace(/ +$/, "")).filter((row) => stripTerminalSequences(row).trim());
}

/** How much of the answer the collapsed line reads: its first block, so a construct over several lines is seen whole. */
const PREVIEW_CHARS = 2000;

/**
 * The collapsed answer line: the first block of the answer as Pi's Markdown renders it, so wrappers such as `**` and
 * backticks become styling instead of showing as characters, and the first rendered row is used. A first line that
 * Markdown renders as nothing, such as a reference definition, stays as its source text.
 */
function previewRow(body: string, color: "error" | "muted", theme: CardTheme, width: number): string | undefined {
	const block = body.trim().split(/\n\s*\n/)[0].slice(0, PREVIEW_CHARS);
	const first = block.split("\n").map((line) => line.trim()).find(Boolean);
	if (!first) return undefined;
	const rendered = markdownRows(block, color, theme, width);
	return markdownRows(first, color, theme, width).length && rendered.length ? rendered[0] : theme.fg(color, first);
}

/** Rows of the card at `width`: a header, then the first answer block rendered as Markdown (collapsed) or the whole original text. */
export function cardLines(card: ParsedCard, expanded: boolean, theme: CardTheme, width: number): string[] {
	if (width <= 0) return [];
	const rows = [header(card, theme, width)];
	const color = card.outcome === "failed" ? "error" : "muted";
	const indent = width >= 8 ? "  " : "";
	if (expanded) {
		for (const row of wrap(card.body, width - indent.length)) rows.push(row ? indent + theme.fg(color, row) : "");
	} else {
		const preview = previewRow(card.body, color, theme, width);
		if (preview) rows.push(fit(indent + preview, width));
	}
	return rows;
}

/** The renderer for agent messages; any other type is left to Pi (undefined). */
export const createAgentCard: MessageRenderer<CardDetails> = (message, options, theme) => {
	if (!(CARD_TYPES as readonly string[]).includes(message.customType)) return undefined;
	const card = parseCard(message);
	const expanded = options.expanded;
	const component: Component = {
		render: padded((width) => cardLines(card, expanded, theme, width), options.outputPad),
		invalidate() {},
	};
	return component;
};
