// Instruction files in Codex order: global Codex file, Pi's personal file, then project AGENTS.md files
// (codex-rs codex-home/src/instructions/mod.rs and core/src/agents_md.rs).
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { isFile, type CodexContext } from "./config.ts";

export interface ContextFile { path: string; content: string }
export interface Instructions { files: ContextFile[]; truncatedPath?: string }

const OVERRIDE = "AGENTS.override.md";
const DEFAULT = "AGENTS.md";
const DEFAULT_MAX_BYTES = 32768;

// Rust `str::trim` removes Unicode White_Space, which keeps U+FEFF (a BOM) and adds U+0085; JS `trim` does the reverse.
const WHITESPACE = "\\t-\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const edges = new RegExp(`^[${WHITESPACE}]+|[${WHITESPACE}]+$`, "g");
const rustTrim = (text: string) => text.replace(edges, "");
// A BOM stays in the text, as with `String::from_utf8_lossy`.
const decode = (bytes: Uint8Array) => new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);

const readBytes = (path: string): Buffer | undefined => { try { return readFileSync(path); } catch { return undefined; } };

/** `AGENTS.override.md` wins over `AGENTS.md`; an empty file is skipped. The text is trimmed. */
function globalFile(ctx: CodexContext): ContextFile | undefined {
	for (const name of [OVERRIDE, DEFAULT]) {
		const path = join(ctx.env.codexHome, name);
		if (!isFile(path)) continue;
		const bytes = readBytes(path);
		const text = bytes === undefined ? undefined : rustTrim(decode(bytes));
		if (text) return { path, content: text };
	}
	return undefined;
}

/** A fallback entry must be a bare file name; path syntax is ignored before any probe. */
function candidateNames(ctx: CodexContext): string[] {
	const names = [OVERRIDE, DEFAULT];
	const configured = ctx.effective.project_doc_fallback_filenames;
	for (const entry of Array.isArray(configured) ? configured : []) {
		if (typeof entry !== "string" || entry === "" || entry === "." || entry === ".." || /[/\0]/.test(entry)) continue;
		if (process.platform === "win32" && /[\\:]/.test(entry)) continue;
		if (!names.includes(entry)) names.push(entry);
	}
	return names;
}

function maxBytes(ctx: CodexContext): number {
	const value = ctx.effective.project_doc_max_bytes;
	return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : DEFAULT_MAX_BYTES;
}

/** Project files from the root to cwd, one per directory, cut to a shared byte budget, decoded like `from_utf8_lossy`. */
function projectFiles(ctx: CodexContext): { files: ContextFile[]; truncatedPath?: string } {
	const files: ContextFile[] = [];
	if (ctx.trust === "untrusted") return { files };
	let remaining = maxBytes(ctx);
	let truncatedPath: string | undefined;
	const names = candidateNames(ctx);
	for (const dir of ctx.dirs) {
		if (remaining === 0) break;
		const path = names.map(name => join(dir, name)).find(isFile);
		const bytes = path === undefined ? undefined : readBytes(path);
		if (path === undefined || bytes === undefined) continue;
		const data = bytes.length > remaining ? bytes.subarray(0, remaining) : bytes;
		if (data.length < bytes.length) truncatedPath ??= path;
		const content = decode(data);
		if (rustTrim(content) !== "") {
			files.push({ path, content });
			remaining -= data.length;
		}
	}
	return { files, truncatedPath };
}

/**
 * The context files for one prompt. `current` is Pi's own list: only its personal file (in Pi's agent directory)
 * stays, since the project files come from the Codex rules and `CLAUDE.md` is not added on its own.
 */
export function instructionFiles(ctx: CodexContext, current: readonly ContextFile[]): Instructions {
	const agentDir = resolve(ctx.env.agentDir);
	const personal = current.filter(file => resolve(dirname(file.path)) === agentDir);
	const global = globalFile(ctx);
	const project = projectFiles(ctx);
	return { files: [...(global ? [global] : []), ...personal, ...project.files], truncatedPath: project.truncatedPath };
}
