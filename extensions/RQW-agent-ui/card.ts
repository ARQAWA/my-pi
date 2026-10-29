// The agent / worker result card: a pure component factory for the custom messages `agent`, `code_writer` and
// `shell_runner` that RQW-agent delivers (content `[<name>#<id>] <text>`). Registration and wiring are not here.
import type { MessageRenderer, Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { cached, clean, fit, fitTail, padded, wrap } from "./fit.ts";

export const CARD_TYPES = ["agent", "code_writer", "shell_runner"] as const;

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
export type CardTheme = Pick<Theme, "fg" | "bold">;

export interface ParsedCard {
	/** `<name>#<id>`, from the outer prefix, else from details, else the message type. */
	id: string;
	outcome?: "finished" | "failed";
	model?: string;
	thinking?: string;
	seconds?: string;
	/** The child's short title, one line; shown after the id. */
	title?: string;
	/** Text after the outer prefix, as stored; cleaned only when drawn (the whole text expanded, just its tail collapsed). */
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

/** Local copy of RQW-agent's completion follow-up sentence; cards hide it, the stored message keeps it. */
const FOLLOW_UP = "Perform any necessary follow-up actions in response to the subagent completion above. If no follow-up work is needed, no further action is required. Don't repeat the same confirmation every time.";

/** Drops the trailing follow-up paragraph and the blank line before it, when present. */
function withoutFollowUp(body: string): string {
	if (!body.endsWith(FOLLOW_UP)) return body;
	const head = body.slice(0, -FOLLOW_UP.length);
	return head.endsWith("\n\n") ? head.slice(0, -2) : head;
}

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
		body: withoutFollowUp(body),
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
	if (card.outcome) {
		let label: string = card.outcome;
		let color: "success" | "error" = card.outcome === "failed" ? "error" : "success";
		if (card.outcome === "finished") {
			const lines = card.body.split(/\r?\n/);
			const first = lines.find((line) => line.trim() !== "");
			if (first === "CLEAN") label = "CLEAN";
			else {
				const match = /^FINDINGS:(?: (\d+))?$/.exec(first ?? "");
				if (match) {
					const count = match[1] === undefined ? lines.filter((line) => /^FINDING \d+$/.test(line)).length : Number(match[1]);
					label = `${count} ${count === 1 ? "finding" : "findings"}`;
					color = "error";
				}
			}
		}
		rest += theme.fg("muted", " ") + theme.fg(color, label);
	}
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

/** How much of the answer the collapsed line reads: its last characters only, never the rest. */
const TAIL_CHARS = 400;

/** The collapsed answer line: the end of the answer as plain text on one line, cut at the front with "…" to fit `room`. */
function tailRow(body: string, color: "error" | "muted", theme: CardTheme, room: number): string | undefined {
	const tail = clean(body.slice(-TAIL_CHARS).replace(/^[\udc00-\udfff]/, "")).replace(/\s+/g, " ").trim();
	return tail && room > 0 ? theme.fg(color, fitTail(tail, room)) : undefined;
}

/** Rows of the card at `width`: a header, then the tail of the answer as plain text (collapsed) or the whole original text. */
export function cardLines(card: ParsedCard, expanded: boolean, theme: CardTheme, width: number): string[] {
	if (width <= 0) return [];
	const rows = [header(card, theme, width)];
	const color = card.outcome === "failed" ? "error" : "muted";
	const indent = width >= 8 ? "  " : "";
	if (expanded) {
		for (const row of wrap(clean(card.body), width - indent.length)) rows.push(row ? indent + theme.fg(color, row) : "");
	} else {
		const preview = tailRow(card.body, color, theme, width - indent.length);
		if (preview) rows.push(indent + preview);
	}
	return rows;
}

/** The renderer for the three custom types; any other type is left to Pi (undefined). */
export const createAgentCard: MessageRenderer<CardDetails> = (message, options, theme) => {
	if (!(CARD_TYPES as readonly string[]).includes(message.customType)) return undefined;
	const card = parseCard(message);
	const expanded = options.expanded;
	return cached(padded((width) => cardLines(card, expanded, theme, width), options.outputPad));
};
