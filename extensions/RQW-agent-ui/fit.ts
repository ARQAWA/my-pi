// Local width helpers for the cards. Only public pi-tui exports; nothing from outside this folder.
import { stripTerminalSequences, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Display text of stored content: terminal sequences and control characters removed, tabs as spaces, \n line ends. */
export function clean(text: string): string {
	return stripTerminalSequences(text)
		.replace(/\r\n|\r/g, "\n")
		.replace(/\t/g, "    ")
		.replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, "");
}

/** One styled line cut at the end with "…" so it never exceeds width. */
export function fit(line: string, width: number): string {
	if (width <= 0) return "";
	if (visibleWidth(line) <= width) return line;
	return truncateToWidth(line, width, "…");
}

/**
 * Wraps plain text (already `clean`) to rows of at most `width` cells. Breaks after the last space that fits, else
 * inside a word; line ends are kept as empty rows. Joining the rows gives the original text back, except that a
 * single glyph wider than the width is shown as "…".
 */
export function wrap(text: string, width: number): string[] {
	if (width <= 0) return [];
	const rows: string[] = [];
	for (const source of text.split("\n")) {
		let row = "";
		let rowWidth = 0;
		let afterSpace = 0; // length of the row up to and including its last space
		let any = false;
		for (const { segment } of segmenter.segment(source)) {
			let glyph = segment;
			let w = visibleWidth(glyph);
			if (w > width) {
				glyph = "…";
				w = 1;
			}
			while (rowWidth + w > width && rowWidth > 0) {
				if (afterSpace > 0 && afterSpace < row.length) {
					rows.push(row.slice(0, afterSpace));
					row = row.slice(afterSpace);
				} else {
					rows.push(row);
					row = "";
				}
				afterSpace = 0;
				rowWidth = visibleWidth(row);
			}
			row += glyph;
			rowWidth += w;
			any = true;
			if (glyph === " ") afterSpace = row.length;
		}
		if (row || !any) rows.push(row);
	}
	return rows;
}
