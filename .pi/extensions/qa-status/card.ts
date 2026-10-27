// The transcript card for the `qa-status` message (display only; the stored content stays the scripts/qa-status.mjs
// text). Collapsed: one line of red and green counts. Ctrl+O: every line in full, links included.
import type { MessageRenderer, Theme } from "@earendil-works/pi-coding-agent";
import { clean, fit, padded, wrap } from "./fit.ts";

type CardTheme = Pick<Theme, "fg">;
type Item = { level: string; text: string; url: string };

const ITEM = /^(RED|GREEN|PENDING|INFO) (.*)$/;
const URL = /\s(https?:\/\/\S+)$/;

/** Item rows (`LEVEL text url`, as render() writes them) and any other lines, such as the triage note or an error. */
export function parseQa(content: string): { items: Item[]; notes: string[] } {
	const items: Item[] = [];
	const notes: string[] = [];
	for (const line of clean(content).split("\n")) {
		const match = ITEM.exec(line);
		if (!match) { if (line.trim()) notes.push(line); continue; }
		const url = URL.exec(match[2]);
		items.push({ level: match[1].toLowerCase(), text: url ? match[2].slice(0, url.index) : match[2], url: url?.[1] ?? "" });
	}
	return { items, notes };
}

const color = (level: string) => (level === "red" ? "error" as const : "muted" as const);

function summary(items: Item[]): string {
	const counts = new Map<string, number>();
	for (const item of items) counts.set(item.level, (counts.get(item.level) ?? 0) + 1);
	return [...counts].map(([level, count]) => `${count} ${level}`).join(" · ");
}

export function qaLines(content: string, expanded: boolean, theme: CardTheme, width: number): string[] {
	if (width <= 0) return [];
	const { items, notes } = parseQa(content);
	const indent = width >= 8 ? "  " : "";
	const head = (text: string) => fit(theme.fg("muted", "qa-status") + (text ? theme.fg("dim", " · ") + theme.fg(items.some((i) => i.level === "red") ? "error" : "muted", text) : ""), width);
	if (!expanded) {
		const count = (level: string) => items.filter((item) => item.level === level).length;
		return [fit(theme.fg("muted", "qa-status") + theme.fg("dim", " · ")
			+ theme.fg("error", `${count("red")} red`) + theme.fg("dim", " · ")
			+ theme.fg("success", `${count("green")} green`), width)];
	}
	const rows = [head(summary(items))];
	const paint = (line: string, tone: "error" | "muted" | "warning") => wrap(line, width - indent.length).map((row) => indent + theme.fg(tone, row));
	for (const item of items) {
		rows.push(...paint(`${item.level.toUpperCase()} ${item.text}`, color(item.level)));
		if (item.url) rows.push(...paint(item.url, "muted"));
	}
	for (const note of notes) rows.push(...paint(note, items.length ? "muted" : "warning"));
	return rows;
}

export const createQaCard: MessageRenderer = (message, options, theme) => {
	if (message.customType !== "qa-status") return undefined;
	const content = typeof message.content === "string" ? message.content : message.content.map((part) => (part.type === "text" ? part.text : "")).join("\n");
	return { render: padded((width) => qaLines(content, options.expanded, theme, width), options.outputPad), invalidate() {} };
};
