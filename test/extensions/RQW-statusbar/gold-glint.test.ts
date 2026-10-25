import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { stripVTControlCharacters as strip } from "node:util";
import {
	activityRows, GOLD, mix, SHIMMER_CELLS_PER_FRAME, shimmerText, sheenRow, topBorder,
} from "../../../extensions/RQW-statusbar/render.ts";
import { STATUS_FRAME_MS } from "../../../extensions/RQW-statusbar/index.ts";

const cells = (line: string) => [...line.matchAll(/\x1b\[(?:1;)?38;2;(\d+);(\d+);(\d+)m([^\x1b]*)\x1b\[22;39m/g)];
const peak = (cell: RegExpMatchArray) => cell[1] === "255" && cell[2] === "244" && cell[3] === "194";

it("renders one three-cell gold glint across the entire strip and Compaction label at unchanged speed", () => {
	assert.equal(STATUS_FRAME_MS, 80);
	assert.equal(SHIMMER_CELLS_PER_FRAME * 1000 / STATUS_FRAME_MS, 8.59375);
	const renders: string[] = [];
	for (const width of [10, 40, 100, 240]) {
		const travel = width - 3;
		for (const fraction of [0, 0.001, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]) {
			const frame = fraction * travel / SHIMMER_CELLS_PER_FRAME;
			const line = shimmerText("x".repeat(width), 0, frame, GOLD);
			const painted = cells(line);
			const peaks = painted.flatMap((cell, i) => peak(cell) ? [i] : []);
			const center = 1 + (fraction <= 1 ? fraction : 2 - fraction) * travel;
			const expected = Array.from({ length: width }, (_, i) => i)
				.filter((i) => i - center >= -1.5 && i - center < 1.5);
			assert.equal(painted.length, width);
			assert.equal(peaks.length, 3);
			assert.deepEqual(peaks, expected);
			assert.equal(peaks[2] - peaks[0], 2);
			assert.doesNotMatch(line, /\x1b\[(?:3|23)m/);
			const border = topBorder(width, undefined, { text: "Compaction", compacting: true, frame });
			assert.equal(border, shimmerText("─".repeat(width), 0, frame, GOLD));
			assert.equal(sheenRow(undefined, width, frame), shimmerText("━".repeat(width), 0, frame, GOLD));
			renders.push(`width=${width} elapsed=${frame * STATUS_FRAME_MS}ms`, border, sheenRow(undefined, width, frame));
		}
	}
	const labelFrames = [0, 0.01, 0.1, 2, 5, 7 / SHIMMER_CELLS_PER_FRAME, 14 / SHIMMER_CELLS_PER_FRAME];
	for (const frame of labelFrames) {
		const label = activityRows(100, { text: "Compaction", compacting: true, frame })[0];
		assert.equal(strip(label), " Compaction");
		assert.equal(cells(label).filter(peak).length, 3);
		renders.push(`Compaction elapsed=${frame * STATUS_FRAME_MS}ms`, label);
	}
	const fineFrames = [0, 0.05, 0.1, 0.15, 0.2];
	assert.equal(new Set(fineFrames.map((frame) => shimmerText("x".repeat(100), 0, frame, GOLD))).size, fineFrames.length);
	// Independent quintic shoulder samples pin the soft distributed falloff and its exact rendered colours.
	const shoulder = cells(shimmerText("x".repeat(100), 0, 40 / SHIMMER_CELLS_PER_FRAME, GOLD));
	for (let distance = 2; distance <= 8; distance++) {
		const t = Math.min(1, (distance - 1.5) / 6);
		const phase = Math.max(0, Math.min(254 / 255, 1 - t ** 3 * (t * (t * 6 - 15) + 10)));
		const color = mix(GOLD, phase);
		const rgb = [1, 3, 5].map((i) => String(parseInt(color.slice(i, i + 2), 16)));
		assert.deepEqual(shoulder[41 + distance].slice(1, 4), rgb);
		assert.deepEqual(shoulder[41 - distance].slice(1, 4), rgb);
	}
	const dir = join(tmpdir(), "statusbar-compaction-glint-renders");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "gold-sweep.ansi"), renders.join("\n") + "\n");
	writeFileSync(join(dir, "gold-sweep.txt"), strip(renders.join("\n")) + "\n");
});
