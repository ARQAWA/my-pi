import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const MAX_LINES = 2000;
export const MAX_BYTES = 48 * 1024;

const bytes = (text: string) => Buffer.byteLength(text, "utf8");

/** Saves the full text in a new temp directory and returns the file path. */
export async function saveFullResult(text: string, root: string = tmpdir()): Promise<string> {
	const dir = await mkdtemp(join(root, "rqw-search-"));
	const path = join(dir, "result.md");
	await writeFile(path, text);
	return path;
}

function note(path: string, shown: number, total: number): string {
	return [
		"",
		`[Output cut: showing lines 1-${shown} of ${total}. Full result: ${path}]`,
		`[Continue with: read ${path} offset=${shown + 1}]`,
	].join("\n") + "\n";
}

/**
 * Stdout text within MAX_LINES and MAX_BYTES. When the report is larger, the full text is saved and the
 * output ends with the file path and the exact line offset to continue from.
 */
export async function fitOutput(report: string, root?: string): Promise<string> {
	const lines = report.replace(/\n$/, "").split("\n");
	if (lines.length <= MAX_LINES && bytes(report) <= MAX_BYTES) return report;
	const path = await saveFullResult(report, root);
	const noteLines = note(path, lines.length, lines.length).split("\n").length - 1;
	const budget = MAX_BYTES - bytes(note(path, lines.length, lines.length));
	let used = 0;
	let shown = 0;
	while (shown < lines.length && shown < MAX_LINES - noteLines && used + bytes(lines[shown]) + 1 <= budget) {
		used += bytes(lines[shown]) + 1;
		shown++;
	}
	return lines.slice(0, shown).join("\n") + "\n" + note(path, shown, lines.length);
}
