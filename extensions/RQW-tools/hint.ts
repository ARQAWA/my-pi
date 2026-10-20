import { readFile } from "node:fs/promises";

// Nearest-match hint for a "Could not find" edit error: the best window of the file by line similarity.

const MIN_SCORE = 0.5;
const MAX_COMPARISONS = 50_000; // window count x oldText lines
const MAX_CELLS = 20_000_000; // Levenshtein inner-loop cells over the whole search: bounds CPU time
const MAX_LINE = 200;
const MAX_SHOWN = 30;

function collapse(line: string): string {
	return line.replace(/\s+/g, " ").trim().slice(0, MAX_LINE);
}

let cells = 0;

function levenshtein(a: string, b: string): number {
	if (a === b) return 0;
	if (a.length === 0) return b.length;
	if (b.length === 0) return a.length;
	cells += a.length * b.length;
	let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		const cur = [i];
		for (let j = 1; j <= b.length; j++) {
			cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
		}
		prev = cur;
	}
	return prev[b.length];
}

/** 1 for equal lines, 0 for nothing in common. */
function similarity(a: string, b: string): number {
	const longest = Math.max(a.length, b.length);
	return longest === 0 ? 1 : 1 - levenshtein(a, b) / longest;
}

/** Never throws; returns undefined when there is no good enough window. */
export async function nearestMatchHint(absolutePath: string, oldText: string): Promise<string | undefined> {
	try {
		const raw = (await readFile(absolutePath, "utf-8")).replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
		const lines = raw.split("\n");
		const want = oldText.replace(/\r\n/g, "\n").split("\n");
		if (want.length > 1 && want[want.length - 1] === "") want.pop();
		if (want.every((l) => l.trim() === "")) return undefined;
		const size = Math.min(want.length, lines.length);
		const windows = lines.length - size + 1;
		if (windows * size > MAX_COMPARISONS) return undefined;
		const wantNorm = want.slice(0, size).map(collapse);
		const norm = lines.map(collapse);
		let best = -1;
		let bestStart = 0;
		cells = 0;
		for (let start = 0; start < windows; start++) {
			let sum = 0;
			for (let k = 0; k < size; k++) {
				sum += similarity(norm[start + k], wantNorm[k]);
				if (cells > MAX_CELLS) return undefined;
			}
			const score = sum / size;
			if (score > best) {
				best = score;
				bestStart = start;
			}
		}
		if (best < MIN_SCORE) return undefined;
		const shown = lines.slice(bestStart, bestStart + Math.min(size, MAX_SHOWN));
		const first = bestStart + 1;
		const last = bestStart + size;
		return [`Nearest match at lines ${first}-${last}:`, ...shown.map((l, i) => `${first + i}|${l}`)].join("\n");
	} catch {
		return undefined;
	}
}
