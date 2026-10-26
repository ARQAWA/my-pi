import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { stripVTControlCharacters as strip } from "node:util";
import { activityRows, GOLD, mix, shimmerText, sheenRow, topBorder } from "../../../extensions/RQW-statusbar/render.ts";
import { STATUS_FRAME_MS } from "../../../extensions/RQW-statusbar/index.ts";

const cells = (line: string) => [...line.matchAll(/\x1b\[(?:1;)?38;2;(\d+);(\d+);(\d+)m([^\x1b]*)\x1b\[22;39m/g)];
const peak = (cell: RegExpMatchArray) => cell[1] === "255" && cell[2] === "244" && cell[3] === "194";

it("renders gold forward in 1250 ms with no reverse or pause across the strip and Compaction", () => {
	assert.equal(STATUS_FRAME_MS, 80);
	assert.deepEqual(GOLD, ["#8a6d1c", "#c9a227", "#fff4c2"]);
	const renders: string[] = [];
	for (const width of [10, 40, 100, 240]) {
		for (const ms of [0, 0.08, 80, 312.5, 625, 937.5, 1100, 1249.999, 1250, 1875, 2499.999, 2500]) {
			const frame = ms / STATUS_FRAME_MS;
			const line = shimmerText("x".repeat(width), 0, frame, GOLD);
			const painted = cells(line);
			const center = 1 + (width - 1 + 1.5 + 6 - 1) * (ms % 1250) / 1250;
			const expected = Array.from({ length: width }, (_, i) => i)
				.filter((i) => i - center >= -1.5 && i - center < 1.5);
			assert.equal(painted.length, width);
			assert.deepEqual(painted.flatMap((cell, i) => peak(cell) ? [i] : []), expected);
			assert.doesNotMatch(line, /\x1b\[(?:3|23)m/);
			const border = topBorder(width, undefined, { text: "Compaction", compacting: true, frame });
			assert.equal(border, shimmerText("─".repeat(width), 0, frame, GOLD));
			assert.equal(sheenRow(undefined, width, frame), shimmerText("━".repeat(width), 0, frame, GOLD));
			for (const period of [1250, 2500]) {
				assert.equal(shimmerText("x".repeat(width), 0, (ms + period) / 80, GOLD), line);
			}
			renders.push(`width=${width} elapsed=${ms}ms`, border, sheenRow(undefined, width, frame));
		}
	}
	for (const ms of [0, 312.5, 625, 937.5, 1249.999]) {
		const label = activityRows(100, { text: "Compaction", compacting: true, frame: ms / 80 })[0];
		assert.equal(strip(label), " Compaction");
		assert.equal(label, " " + shimmerText("Compaction", 1, ms / 80, GOLD));
		for (const period of [1250, 2500]) {
			assert.equal(activityRows(100, { text: "Compaction", compacting: true, frame: (ms + period) / 80 })[0], label);
		}
		const center = 1 + (10 - 1 + 1.5 + 6 - 1) * ms / 1250;
		assert.deepEqual(cells(label).flatMap((cell, i) => peak(cell) ? [i] : []),
			Array.from({ length: 10 }, (_, i) => i).filter((i) => i - center >= -1.5 && i - center < 1.5));
		renders.push(`Compaction elapsed=${ms}ms`, label);
	}
	const fineFrames = [0, 0.05, 0.1, 0.15, 0.2];
	assert.equal(new Set(fineFrames.map((frame) => shimmerText("x".repeat(100), 0, frame, GOLD))).size, fineFrames.length);
	// Place the crest at column 41 to retain exact samples of both unchanged shoulders.
	const shoulder = cells(shimmerText("x".repeat(100), 0, 40 / 105.5 * 15.625, GOLD));
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
