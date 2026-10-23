import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

/** Byte provenance of the prompt actually loaded for this session, not a later version of the file. */
export type PromptFile = { kind: "system" | "role"; path: string; sha256: string };

export async function loadPromptFile(kind: PromptFile["kind"], file: string, cwd: string): Promise<{ text: string; file: PromptFile }> {
	if (!file || file.includes("\0")) throw new Error(`${kind}_file must name a text file`);
	const path = resolve(cwd, file);
	if (!(await stat(path)).isFile()) throw new Error(`${kind}_file must be a regular text file: ${path}`);
	const bytes = await readFile(path);
	// Fatal decoding rejects corrupt input; ignoreBOM preserves a literal UTF-8 BOM in the prompt.
	const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
	return { text, file: { kind, path, sha256: createHash("sha256").update(bytes).digest("hex") } };
}

/** Raw user-role text on this caller's selected branch, including entries before compaction. */
export function appendUserMessages(task: string, branch: readonly SessionEntry[]): string {
	const texts = branch.flatMap(entry => {
		if (entry.type !== "message" || entry.message.role !== "user") return [];
		const content = entry.message.content;
		return typeof content === "string" ? [content] : content.flatMap(part => part.type === "text" ? [part.text] : []);
	});
	return `${task}\n\n<user_messages>\n${texts.join("\n")}\n</user_messages>`;
}
