// The summary line of one group of tool calls: `↳ Edited 2 files +24 -8 · read 6 files · ran 2 commands`.
// Pure: counts come from classified calls (classify.ts, changes.ts), colors from the theme Pi supplies.
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { ChangeClassified } from "./changes.ts";
import type { Classified } from "./classify.ts";

/** The glyph of the accepted design: one per summary line, whatever the calls are. */
export const SUMMARY_GLYPH = "↳";
const SEPARATOR = " · ";

/** A piece of one display row and the supplied-theme paint for it. */
export interface Span {
	text: string;
	paint: (text: string) => string;
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const cells = (text: string) => [...graphemes.segment(text)].map((g) => ({ g: g.segment, w: visibleWidth(g.segment) }));

/** Plain text cut at the end to `width` columns, an ellipsis marking the cut. */
export function fitEnd(text: string, width: number): string {
	return fitSpans([{ text, paint: (t) => t }], width);
}

/** Plain text cut at the start to `width` columns, a leading ellipsis marking the cut: the end stays visible. */
export function fitStart(text: string, width: number): string {
	if (width <= 0) return "";
	if (visibleWidth(text) <= width) return text;
	let used = 1, kept = "";
	for (const { g, w } of cells(text).reverse()) {
		if (used + w > width) break;
		kept = g + kept;
		used += w;
	}
	return `…${kept}`;
}

/** Paints spans and cuts them at the end to `width` columns; the ellipsis takes the paint of the span it ends. */
export function fitSpans(spans: readonly Span[], width: number): string {
	if (width <= 0) return "";
	const total = spans.reduce((n, s) => n + visibleWidth(s.text), 0);
	if (total <= width) return spans.map((s) => (s.text ? s.paint(s.text) : "")).join("");
	let used = 0, out = "";
	for (const span of spans) {
		let kept = "";
		for (const { g, w } of cells(span.text)) {
			if (used + w > width - 1) return out + span.paint(`${kept}…`);
			kept += g;
			used += w;
		}
		if (kept) out += span.paint(kept);
	}
	return out;
}

type Call = Classified | ChangeClassified;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Counts of one group: distinct files and IDs per part, confirmed `+A -R`, failed units. */
export function countSummary(calls: readonly Call[]) {
	const sets = { edit: new Set<string>(), read: new Set<string>(), search: new Set<string>(), run: new Set<string>(), wait: new Set<string>(), other: new Set<string>() };
	let added: number | undefined, removed: number | undefined, failed = 0;
	for (const call of calls) {
		for (const key of call.countKeys) sets[call.kind].add(key);
		if ("files" in call && call.files.length > 0) {
			for (const f of call.files) {
				if (f.added !== undefined) added = (added ?? 0) + f.added;
				if (f.removed !== undefined) removed = (removed ?? 0) + f.removed;
				if (f.status === "error") failed++;
			}
		} else if (call.status === "error") failed++;
	}
	return { edited: sets.edit.size, read: sets.read.size, searched: sets.search.size, ran: sets.run.size, waited: sets.wait.size, used: sets.other.size,
		added, removed, failed };
}

/** One summary line for the calls of a group, never wider than `width`. Parts in fixed order, zero parts omitted. */
export function renderSummary(calls: readonly Call[], width: number, theme: Theme): string {
	const c = countSummary(calls);
	const muted = (t: string) => theme.fg("muted", t);
	const parts: Span[][] = [];
	if (c.edited > 0) {
		const part: Span[] = [{ text: `edited ${plural(c.edited, "file", "files")}`, paint: muted }];
		if (c.added !== undefined) part.push({ text: " ", paint: muted }, { text: `+${c.added}`, paint: (t) => theme.fg("toolDiffAdded", t) });
		if (c.removed !== undefined) part.push({ text: " ", paint: muted }, { text: `-${c.removed}`, paint: (t) => theme.fg("toolDiffRemoved", t) });
		parts.push(part);
	}
	if (c.read > 0) parts.push([{ text: `read ${plural(c.read, "file", "files")}`, paint: muted }]);
	if (c.searched > 0) parts.push([{ text: `searched ${plural(c.searched, "time", "times")}`, paint: muted }]);
	if (c.ran > 0) parts.push([{ text: `ran ${plural(c.ran, "command", "commands")}`, paint: muted }]);
	if (c.waited > 0) parts.push([{ text: `waited for ${plural(c.waited, "agent", "agents")}`, paint: muted }]);
	if (c.used > 0) parts.push([{ text: `used ${plural(c.used, "tool", "tools")}`, paint: muted }]);
	if (c.failed > 0) parts.push([{ text: `${c.failed} failed`, paint: (t) => theme.fg("error", t) }]);
	if (parts.length > 0) parts[0][0] = { ...parts[0][0], text: parts[0][0].text[0].toUpperCase() + parts[0][0].text.slice(1) };
	const spans: Span[] = [{ text: `${SUMMARY_GLYPH} `, paint: muted }];
	parts.forEach((part, i) => spans.push(...(i > 0 ? [{ text: SEPARATOR, paint: muted }] : []), ...part));
	return fitSpans(spans, width);
}
