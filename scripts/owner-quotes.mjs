// Shared by the repo-only coordinator guard and the pre-merge gate. No Pi runtime dependencies.
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

export const normalizeQuote = (text) => text.normalize("NFC").replace(/\s+/gu, " ").trim();

export function extractOwnerMessages(entries) {
	const messages = [];
	for (const entry of entries) {
		if (entry?.type !== "message" || entry.message?.role !== "user") continue;
		const content = entry.message.content;
		const text = typeof content === "string" ? content : Array.isArray(content)
			? content.filter((block) => block?.type === "text" && typeof block.text === "string")
				.map((block) => block.text).join("\n") : "";
		if (text.trim()) messages.push(text);
	}
	return messages;
}

// Offsets are UTF-16 indices, end-exclusive; line numbers are one-based and inclusive.
// Balanced nested guillemets belong to the outer quote; unbalanced marks fail closed.
export function findQuotes(text) {
	const spans = [];
	let start = -1, startLine = 1, line = 1, depth = 0;
	const push = (end, endLine, invalid) => spans.push({
		text: text.slice(start + 1, end - (text[end - 1] === "»" ? 1 : 0)),
		start, end, startLine, endLine, malformed: invalid,
	});
	for (let i = 0; i < text.length; i++) {
		if (text[i] === "«") {
			if (!depth) { start = i; startLine = line; }
			depth++;
		} else if (text[i] === "»") {
			if (!depth) {
				start = i; startLine = line;
				push(i + 1, line, true);
			} else if (--depth === 0) push(i + 1, line, false);
		}
		if (text[i] === "\n") line++;
	}
	if (depth) push(text.length, line, true);
	return spans;
}

export function findNonVerbatimQuotes(text, messages) {
	const corpus = messages.map(normalizeQuote);
	return findQuotes(text).filter((span) => {
		const quote = normalizeQuote(span.text);
		return span.malformed || !quote || !corpus.some((message) => message.includes(quote));
	});
}

export function loadOwnerMessages(dirs) {
	const files = new Set();
	const visit = (dir) => {
		let entries;
		try { entries = readdirSync(dir, { withFileTypes: true }); }
		catch (error) { if (error.code === "ENOENT") return; throw error; }
		for (const entry of entries) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) visit(path);
			else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.add(path);
		}
	};
	for (const dir of dirs) visit(dir);
	if (!files.size) throw new Error("no session files found; set MY_PI_SESSIONS to owner session directories");
	const messages = [];
	for (const file of files) {
		const entries = readFileSync(file, "utf8").split(/\r?\n/u).flatMap((line, index) => {
			if (!line.trim()) return [];
			try { return [JSON.parse(line)]; }
			catch { throw new Error(`invalid session JSONL at ${file}:${index + 1}`); }
		});
		messages.push(...extractOwnerMessages(entries));
	}
	if (!messages.length) throw new Error("no owner user messages found in session files");
	return messages;
}

// Match Pi's path encoding on both platforms, including sessions of removed sibling worktrees.
export function ownerSessionDirs(checkouts, { env = process.env, home = homedir() } = {}) {
	if (env.MY_PI_SESSIONS !== undefined) return env.MY_PI_SESSIONS.split(delimiter).filter(Boolean);
	const sessions = join(home, ".pi", "agent", "sessions");
	const encode = (path) => `--${path.replace(/^[/\\]/u, "").replace(/[/\\:]/gu, "-")}--`;
	const names = new Set(checkouts.map(encode));
	const mainPrefix = encode(checkouts[0]).slice(0, -2) + "-worktrees-";
	try {
		for (const entry of readdirSync(sessions, { withFileTypes: true })) {
			if (entry.isDirectory() && entry.name.startsWith(mainPrefix)) names.add(entry.name);
		}
	} catch (error) { if (error.code !== "ENOENT") throw error; }
	return [...names].map((name) => join(sessions, name));
}
