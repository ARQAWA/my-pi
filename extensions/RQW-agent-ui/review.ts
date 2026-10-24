// Display only: the merged reviewer delivers a custom message, not a wait tool result.
import type { MessageRenderer } from "@earendil-works/pi-coding-agent";
import { messageText, splitPrefix } from "./card.ts";
import { clean, fit, wrap } from "./fit.ts";

/** Ignore protocol-looking text inside verbatim source quotes and fenced examples. */
class SourceQuote {
	private fence = "";
	private quote = "";
	get open() { return Boolean(this.fence || this.quote); }
	scan(line: string) {
		if (this.fence) {
			const end = /^\s*(`{3,}|~{3,})(?:\s+\([^\n]*\))?\s*$/.exec(line)?.[1];
			if (end?.[0] === this.fence[0] && end.length >= this.fence.length) this.fence = "";
			return;
		}
		for (let i = 0; i < line.length; i++) {
			const char = line[i];
			if (char === "\\") { i++; continue; }
			if (this.quote) {
				const apostrophe = char === "'" && /\w/.test(line[i - 1] ?? "") && /\w/.test(line[i + 1] ?? "");
				if (char === this.quote && !apostrophe) this.quote = "";
				continue;
			}
			if (i > 0 && !/[\s([{=:>]/.test(line[i - 1])) continue;
			const fence = /^(`{3,}|~{3,})/.exec(line.slice(i))?.[1];
			if (fence) {
				const end = line.indexOf(fence, i + fence.length);
				if (end >= 0) { i = end + fence.length - 1; continue; }
				this.fence = fence;
				return;
			}
			if (char === '"' || char === "'") this.quote = char;
		}
	}
}

const FIELDS = ["REQUIREMENT", "MISMATCH", "EVIDENCE", "REQUIRED OUTCOME"];

/** Count headings; field order only chooses between quoted sources and the producer's literal fallback. */
function scanCounts(body: string, quoted: boolean) {
	let findings = 0, unchecked = 0, fields = 0;
	let complete = true;
	let section = "";
	const source = new SourceQuote();
	for (const line of body.split("\n")) {
		if (!quoted || !source.open) {
			const heading = /^\s*(CHECKED|UNCHECKED):/.exec(line)
				?? (section === "" ? /^(FINDINGS):[ \t]*$/.exec(line) : null);
			if (heading && (section !== "FINDINGS" || fields === FIELDS.length)) {
				if (section === "FINDINGS" && findings && fields !== FIELDS.length) complete = false;
				section = heading[1];
				continue;
			}
			if (section === "FINDINGS") {
				if (/^FINDING\s+\d+[ \t]*$/.test(line)) {
					if (findings && fields !== FIELDS.length) complete = false;
					findings++;
					fields = 0;
					continue;
				}
				const field = /^\s*(REQUIREMENT|MISMATCH|EVIDENCE|REQUIRED OUTCOME):/.exec(line);
				if (field && findings) {
					if (field[1] !== FIELDS[fields]) complete = false;
					fields++;
				}
			}
			if (section === "UNCHECKED" && /^-\s+\S/.test(line)) unchecked++;
		}
		// As in the producer, final outcomes and verification prose cannot open source quotes.
		if (quoted && section === "FINDINGS" && fields < FIELDS.length) source.scan(line);
	}
	if (findings && fields !== FIELDS.length) complete = false;
	return { findings, unchecked, complete };
}

/** Counts are presentation, not validation of the review's policy or coverage. */
export function reviewCounts(body: string): { findings: number; unchecked: number } {
	let counts = scanCounts(body, true);
	if (!counts.complete) {
		const literal = scanCounts(body, false);
		if (literal.complete) counts = literal;
	}
	return { findings: counts.findings, unchecked: counts.unchecked };
}

export const createReviewCard: MessageRenderer<{ n?: number }> = (message, options, theme) => {
	if (message.customType !== "review") return undefined;
	const prefix = splitPrefix("review", messageText(message.content));
	const body = clean(prefix.body);
	const id = clean(prefix.id ?? (typeof message.details?.n === "number" ? `review#${message.details.n}` : "review"));
	const firstLine = body.split("\n").find(line => line.trim()) ?? "";
	const first = firstLine.trim();
	const { findings, unchecked } = reviewCounts(body);
	const failed = first.startsWith("Review failed:");
	const color = failed ? "error" : firstLine === "CLEAN" ? "success" : "muted";
	const verdict = first === "FINDINGS:" ? `${findings} findings` : failed ? "Review failed:" : first;
	return {
		render(width) {
			if (width <= 0) return [];
			const suffix = unchecked ? theme.fg("warning", ` · ${unchecked} unchecked`) : "";
			const header = theme.fg("muted", id) + (verdict ? " " + theme.fg(color, verdict) : "") + suffix;
			const rows = [fit(header, width)];
			const indent = width >= 8 ? "  " : "";
			const bodyColor = failed ? "error" : "muted";
			if (options.expanded) {
				for (const row of wrap(body, width - indent.length)) rows.push(row ? indent + theme.fg(bodyColor, row) : "");
			} else if (first) rows.push(fit(indent + theme.fg(bodyColor, first), width));
			return rows;
		},
		invalidate() {},
	};
};
