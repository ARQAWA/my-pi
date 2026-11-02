import { getMarkdownTheme, type MessageRenderer } from "@earendil-works/pi-coding-agent";
import { Markdown, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import { messageText } from "./card.ts";
import { cached, clean, fit, padded, wrap } from "./fit.ts";

function detailsOf(content: string, details: unknown): Record<string, unknown> {
	if (details && typeof details === "object") return details as Record<string, unknown>;
	try { return JSON.parse(content) ?? {}; }
	catch { return {}; }
}

function ids(details: Record<string, unknown>): string {
	const items = [details.results, details.statuses, details.matched].find((value) => Array.isArray(value) && value.length);
	return Array.isArray(items) ? items.flatMap((item) => typeof item?.id === "string" ? [item.id] : []).join(", ") : "";
}

/** The child's summary of a progress notice: the lines after the header, before the fixed instructions and the embedded skill. */
function progressSummary(text: string): string {
	const afterHeader = text.slice(text.indexOf("\n") + 1);
	if (afterHeader === text) return "";
	// The fixed skill block and sentence close the notice, so the last of each ends the summary, even if it quotes them.
	const skillAt = afterHeader.lastIndexOf('\n\n<skill name="agent-progress">\n');
	const beforeSkill = skillAt < 0 ? afterHeader : afterHeader.slice(0, skillAt);
	const sentenceAt = beforeSkill.lastIndexOf("\nThe agent continues working.");
	return clean(sentenceAt < 0 ? beforeSkill : beforeSkill.slice(0, sentenceAt)).trim();
}

/** Open progress cards, by message: a rebuilt card (theme change, Ctrl+O) keeps its state; a new card starts collapsed. */
const opened = new WeakSet<object>();

/** Display only: expanded notifications retain all original text, including embedded skills. */
export const createNotificationCard: MessageRenderer = (message, options, theme) => {
	if (!["agent_progress", "child_wait"].includes(message.customType)) return undefined;
	const text = messageText(message.content);
	const details = detailsOf(text, message.details);
	const paint = (role: Parameters<typeof theme.fg>[0], value: string) => theme.fg(role, clean(value));
	const muted = (value: string) => paint("muted", value);
	let summary: string;
	if (message.customType === "agent_progress") {
		const id = typeof details.id === "string" ? details.id : text.match(/agent#\d+/)?.[0];
		summary = muted(`${id ?? "agent"} `) + paint("thinkingHigh", "progress");
	} else {
		const targets = ids(details);
		const reason = typeof details.reason === "string" ? details.reason.replace(/_/g, " ") : "notification";
		const status = reason === "timeout" ? "timed out" : reason;
		const failed = ["timeout", "timed out", "failed", "error"].includes(reason);
		summary = muted("wait ") + paint(failed ? "error" : "muted", status) + muted(targets ? `: ${targets}` : "");
	}
	const progress = message.customType === "agent_progress" ? progressSummary(text) : "";
	const clickable = message.customType === "agent_progress" && !!progress;
	const collapsed = (width: number): string[] => {
		if (width <= 0) return [];
		if (clickable && !opened.has(message)) return [fit(summary + muted(" [click to show]"), width)];
		const rows = [fit(summary, width)];
		if (!progress) return rows;
		const indent = width >= 8 ? "  " : "";
		const markdown = new Markdown(progress, 0, 0, getMarkdownTheme(), { color: (value) => theme.fg("muted", value) });
		return rows.concat(markdown.render(width - indent.length).map((row) => (row ? indent + row : row)));
	};
	const card = cached(padded((width) => options.expanded
		? wrap(clean(text), width).map((line) => theme.fg("muted", line))
		: collapsed(width), options.outputPad));
	if (!clickable || options.expanded) return card;
	// A left click anywhere on the card shows the summary or hides it again; Ctrl+O keeps the full original.
	return Object.assign(card, {
		handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
			if (event.type !== "click" || event.button !== "left") return undefined;
			if (!opened.delete(message)) opened.add(message);
			card.invalidate?.();
			return { handled: true, render: true };
		},
	});
};
