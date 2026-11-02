// CI measurement, no time assertions: Pi's session projection against the safe copy of RQW-history-edit on a synthetic
// session with one compaction and a long tail. The sizes are entries after the compaction; Pi's own call overflows on
// the larger one, so only the safe copy and the time Pi needs to fail are reported there.
// Run: node scripts/measure-safe-projection.ts. Output goes to stdout and, in CI, to the job summary.
import { appendFileSync } from "node:fs";
import * as Pi from "@earendil-works/pi-coding-agent";
import { safeSessionProjection } from "../extensions/RQW-history-edit/projection.ts";

const SIZES = [50_000, 200_000];
const RUNS = 5;

type Entry = { id: string; parentId: string | null; type: string; [key: string]: unknown };

function session(tail: number): Entry[] {
	const stamp = "2026-01-01T00:00:00.000Z";
	const entries: Entry[] = [
		{ type: "message", id: "a", parentId: null, timestamp: stamp, message: { role: "user", content: "one", timestamp: 1 } },
		{ type: "compaction", id: "c", parentId: "a", timestamp: stamp, summary: "sum", firstKeptEntryId: "a", tokensBefore: 1 },
	];
	for (let i = 0; i < tail; i++) {
		entries.push({ type: "custom_message", id: `t${i}`, parentId: i === 0 ? "c" : `t${i - 1}`, timestamp: stamp, customType: "x", content: "c", display: false });
	}
	return entries;
}

function median(run: () => unknown): number {
	const times: number[] = [];
	for (let i = 0; i < RUNS; i++) {
		const start = performance.now();
		run();
		times.push(performance.now() - start);
	}
	return times.sort((a, b) => a - b)[Math.floor(RUNS / 2)]!;
}

function pi(entries: Entry[]): string {
	try {
		return `${median(() => Pi.buildSessionProjection(entries as never)).toFixed(1)} ms`;
	} catch (error) {
		const start = performance.now();
		try { Pi.buildSessionProjection(entries as never); } catch { /* measured below */ }
		return `${error instanceof RangeError ? "RangeError" : "error"} after ${(performance.now() - start).toFixed(1)} ms`;
	}
}

const lines = [`Safe projection, median of ${RUNS} runs on Node ${process.versions.node} (${process.platform}):`, "", "| tail entries | Pi | safe copy |", "| --- | --- | --- |"];
for (const size of SIZES) {
	const entries = session(size);
	lines.push(`| ${size} | ${pi(entries)} | ${median(() => safeSessionProjection(entries)).toFixed(1)} ms |`);
}
const report = lines.join("\n");
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
