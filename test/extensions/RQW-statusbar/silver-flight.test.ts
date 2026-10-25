import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { it } from "node:test";
import { stripVTControlCharacters as strip } from "node:util";
import { activityRows, GOLD, SILVER, shimmerText, silverGlintPosition } from "../../../extensions/RQW-statusbar/render.ts";

it("renders rapid silver flights, complete exit and the two-second absence without changing the label", () => {
	const evidence: string[] = ["Silver: 640 ms constant-speed flight, 2000 ms pause, 2640 ms cycle."];
	for (const text of ["Planning next moves", "x".repeat(100)]) {
		for (const ms of [0, 80, 160, 240, 320, 400, 480, 560, 600, 640, 641, 1640, 2639.999, 2640, 2720, 2960, 3280]) {
			const line = activityRows(120, { text, compacting: false, frame: ms / 80 })[0];
			assert.equal(strip(line), " " + text);
			assert.equal(line, " " + shimmerText(text, 1, ms / 80, SILVER));
			const colors = [...line.matchAll(/38;2;(\d+;\d+;\d+)m/g)].map((m) => m[1]);
			const absent = ms % 2640 >= 640;
			assert.equal(colors.every((rgb) => rgb === "95;94;92"), absent);
			evidence.push(`width=${text.length} t=${ms}ms center=${silverGlintPosition(text.length, ms / 80)} ${absent ? "absent" : "flight"}`, line);
		}
	}
	writeFileSync("/tmp/statusbar-silver-loop-flight.ansi", evidence.join("\n") + "\n");
	writeFileSync("/tmp/statusbar-silver-loop-flight.txt", strip(evidence.join("\n")) + "\n");
});

it("keeps gold bytes identical to the delivered bounce, including tiny widths and reverse legs", () => {
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
			const travel = width - 3;
			const distance = frame * (0.22 / 0.32) % (2 * travel);
			const center = width <= 3 ? Math.max(0, (width - 1) / 2) : 1 + (distance <= travel ? distance : 2 * travel - distance);
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
