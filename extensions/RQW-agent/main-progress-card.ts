import type { EntryRenderer } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

export const MAIN_PROGRESS_ENTRY = "rqw-main-progress-v1";
export type Paragraph = { main: string; details: string[] };
export type ProgressCard = { version: 1; firstStep: number; lastStep: number; paragraphs: Paragraph[] };

function sentence(value: unknown): value is string {
	return typeof value === "string" && value.length <= 512 && value === value.trim()
		&& /^[^.!?\r\n]+[.!?]$/u.test(value) && !/[\p{Cc}\p{Cf}]/u.test(value)
		&& value.split(/\s+/u).length <= 7 && /[а-яё]/u.test(value)
		&& value === value.toLocaleLowerCase("ru") && !/(?:^|[^\p{L}])вы(?:$|[^\p{L}])/u.test(value);
}

function paragraphs(value: unknown): value is Paragraph[] {
	return Array.isArray(value) && value.length >= 1 && value.length <= 2 && value.every(p =>
		p && sentence(p.main) && Array.isArray(p.details) && p.details.length <= 3 && p.details.every(sentence));
}

export function parseSummary(text: string): Paragraph[] | undefined {
	try {
		const value: unknown = JSON.parse(text);
		if (value && typeof value === "object" && "paragraphs" in value && paragraphs(value.paragraphs)) return value.paragraphs;
	} catch { /* An invalid summary is silent; another attempt belongs to the next threshold. */ }
	return undefined;
}

export const renderProgress: EntryRenderer<ProgressCard> = (entry, _options, theme) => {
	const data = entry.data;
	if (!data || data.version !== 1 || !Number.isSafeInteger(data.firstStep) || data.firstStep < 1
		|| !Number.isSafeInteger(data.lastStep) || data.lastStep < data.firstStep || !paragraphs(data.paragraphs)) return undefined;
	let cached: { width: number; rows: string[] } | undefined;
	return {
		invalidate() { cached = undefined; },
		render(width: number): string[] {
			if (cached?.width === width) return cached.rows;
			if (width < 5) return [truncateToWidth(theme.fg("customMessageLabel", "Progress update"), Math.max(0, width))];
			const inner = width - 4;
			const row = (text: string) => theme.bg("userMessageBg", theme.fg("borderAccent", "│") + " "
				+ text + " ".repeat(Math.max(0, inner - visibleWidth(text))) + "  ");
			const label = theme.fg("customMessageLabel", "Progress update");
			const range = theme.fg("dim", `steps ${data.firstStep}–${data.lastStep}`);
			const header = visibleWidth(label) + visibleWidth(range) + 1 <= inner
				? label + " ".repeat(inner - visibleWidth(label) - visibleWidth(range)) + range
				: truncateToWidth(label, inner);
			const rows = [row(header), row("")];
			for (const [index, p] of data.paragraphs.entries()) {
				if (index) rows.push(row(""));
				rows.push(...wrapTextWithAnsi(theme.bold(theme.fg("mdCodeBlock", p.main)), inner).map(row));
				for (const detail of p.details) rows.push(...wrapTextWithAnsi(theme.fg("mdCodeBlock", detail), inner).map(row));
			}
			rows.push(row(""));
			cached = { width, rows };
			return rows;
		},
	};
};
