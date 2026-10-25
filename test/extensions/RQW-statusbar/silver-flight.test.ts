import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { stripVTControlCharacters as strip } from "node:util";
import { activityRows, GOLD, SILVER, shimmerText, silverGlintPosition } from "../../../extensions/RQW-statusbar/render.ts";

it("renders the quarter-lift silver palette above the unchanged base", () => {
	const line = activityRows(100, { text: "x".repeat(60), compacting: false, frame: 0 })[0];
	const colors = [...line.matchAll(/38;2;(\d+);(\d+);(\d+)m/g)].map((m) => m.slice(1, 4).map(Number));
	assert.deepEqual(colors.slice(0, 3), Array(3).fill([135, 134, 133]));
	assert.deepEqual(colors.at(-1), [95, 94, 92]);
	for (const rgb of colors) {
		rgb.forEach((channel, i) => assert.ok(channel >= [95, 94, 92][i] && channel <= [135, 134, 133][i]));
	}
	assert.ok(colors.some((rgb) => rgb[0] > 95 && rgb[0] < 135));
});

it("renders silver flights, complete exit and the 2500 ms absence without changing the label", () => {
	const evidence: string[] = ["Silver: 1250 ms constant-speed flight, 2500 ms pause, 3750 ms cycle."];
	for (const text of ["Planning next moves", "x".repeat(100)]) {
		for (const ms of [0, 80, 160, 240, 320, 400, 480, 560, 625, 1250, 1251, 2500, 3749.999, 3750, 3830, 4375, 5000]) {
			const line = activityRows(120, { text, compacting: false, frame: ms / 80 })[0];
			assert.equal(strip(line), " " + text);
			assert.equal(line, " " + shimmerText(text, 1, ms / 80, SILVER));
			const colors = [...line.matchAll(/38;2;(\d+;\d+;\d+)m/g)].map((m) => m[1]);
			const absent = ms % 3750 >= 1250;
			assert.equal(colors.every((rgb) => rgb === "95;94;92"), absent);
			evidence.push(`width=${text.length} t=${ms}ms center=${silverGlintPosition(text.length, ms / 80)} ${absent ? "absent" : "flight"}`, line);
		}
	}
	writeFileSync(join(tmpdir(), "statusbar-silver-loop-flight.ansi"), evidence.join("\n") + "\n");
	writeFileSync(join(tmpdir(), "statusbar-silver-loop-flight.txt"), strip(evidence.join("\n")) + "\n");
});

it("renders the 1250 ms forward-only gold cycle with unchanged palette and shoulder, including tiny widths", () => {
	const hex = (color: string, bold: boolean) => {
		const rgb = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16)).join(";");
		return `\x1b[${bold ? "1;" : ""}38;2;${rgb}mx\x1b[22;39m`;
	};
	const mixGold = (phase: number) => {
		const stops = [[138, 109, 28], [201, 162, 39], [255, 244, 194]];
		const x = Math.min(1, Math.max(0, phase)) * 2;
		const i = Math.min(1, Math.floor(x));
		return "#" + stops[i].map((c, k) => Math.round(c + (stops[i + 1][k] - c) * (x - i)).toString(16).padStart(2, "0")).join("");
	};
	for (const width of [0, 1, 2, 3, 10, 40, 100, 240]) {
		for (const frame of [0, 0.125, 1, 12.5, 100, 250.75, 1000]) {
			const center = 1 + (width - 1 + 1.5 + 6 - 1) * (frame % 15.625) / 15.625;
			const expected = Array.from({ length: width }, (_, column) => {
				const position = column - center;
				const t = Math.max(0, Math.min(1, (Math.abs(position) - 1.5) / 6));
				const phase = position >= -1.5 && position < 1.5 ? 1 : Math.max(0, Math.min(254 / 255, 1 - t ** 3 * (t * (t * 6 - 15) + 10)));
				return hex(mixGold(phase), phase > 0.85);
			}).join("");
			assert.equal(shimmerText("x".repeat(width), 0, frame, GOLD), expected);
		}
	}
});
