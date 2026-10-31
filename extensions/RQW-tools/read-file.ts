import { constants } from "node:fs";
import { access, open, readFile } from "node:fs/promises";
import { createReadToolDefinition, detectSupportedImageMimeTypeFromFile, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { resolveReadPath } from "./keys.ts";
import { readDescription } from "./rg.ts";

const MAX_LINES = 2000;
const MAX_BYTES = 50 * 1024;
const CHUNK_BYTES = 16 * 1024;

type ReadParams = { path: string; offset?: number; limit?: number };
type Line = { text: string; oversized: boolean; hasNext: boolean };

function prefixBytes(text: string, max: number): string {
	let result = "";
	let bytes = 0;
	for (const character of text) {
		const size = Buffer.byteLength(character);
		if (bytes + size > max) break;
		result += character;
		bytes += size;
	}
	return result;
}

function isBmp(buffer: Buffer): boolean {
	if (buffer.length < 26 || buffer.subarray(0, 2).toString("ascii") !== "BM") return false;
	const size = buffer.readUInt32LE(2);
	const pixels = buffer.readUInt32LE(10);
	const header = buffer.readUInt32LE(14);
	if ((size !== 0 && size < 26) || pixels < 14 + header || (size !== 0 && pixels >= size)) return false;
	let planes: number;
	let bits: number;
	if (header === 12) { planes = buffer.readUInt16LE(22); bits = buffer.readUInt16LE(24); }
	else if (header >= 40 && header <= 124 && buffer.length >= 30) {
		planes = buffer.readUInt16LE(26);
		bits = buffer.readUInt16LE(28);
	} else return false;
	return planes === 1 && [1, 4, 8, 16, 24, 32].includes(bits);
}

function isImage(buffer: Buffer): boolean {
	return buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ||
		buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ||
		["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii")) ||
		(buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") ||
		isBmp(buffer);
}

function checkAbort(signal?: AbortSignal): void {
	if (signal?.aborted) throw new Error("Operation aborted");
}

async function* lines(path: string, signal?: AbortSignal): AsyncGenerator<Line> {
	const file = await open(path, "r");
	try {
		const buffer = Buffer.alloc(CHUNK_BYTES);
		let decoder: TextDecoder | undefined;
		let encoding = "utf-8";
		let tail = Buffer.alloc(0);
		let pending = "";
		let oversized = false;
		let sawText = false;
		const append = (chunk: Uint8Array, stream: boolean) => {
			let decoded: string;
			try { decoded = decoder!.decode(chunk, { stream }); }
			catch { throw new Error("Unsupported binary or text encoding"); }
			if (/[\x00-\x08\x0b\x0e-\x1f\x7f]/.test(decoded)) throw new Error("Unsupported binary or text encoding");
			if (decoded.length) sawText = true;
			if (!oversized) {
				pending += decoded;
				if (Buffer.byteLength(pending) > MAX_BYTES + 4) {
					pending = prefixBytes(pending, MAX_BYTES + 4);
					oversized = true;
				}
			}
		};
		for (;;) {
			checkAbort(signal);
			const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
			let chunk: Buffer = buffer.subarray(0, bytesRead);
			if (!decoder) {
				if (chunk[0] === 0xff && chunk[1] === 0xfe) { encoding = "utf-16le"; chunk = chunk.subarray(2); }
				else if (chunk[0] === 0xfe && chunk[1] === 0xff) { encoding = "utf-16be"; chunk = chunk.subarray(2); }
				else if (chunk[0] === 0xef && chunk[1] === 0xbb && chunk[2] === 0xbf) chunk = chunk.subarray(3);
				decoder = new TextDecoder(encoding, { fatal: true });
			}
			if (tail.length) { chunk = Buffer.concat([tail, chunk]); tail = Buffer.alloc(0); }
			const width = encoding === "utf-8" ? 1 : 2;
			if (bytesRead && width === 2 && chunk.length % 2) {
				tail = Buffer.from(chunk.subarray(chunk.length - 1));
				chunk = chunk.subarray(0, chunk.length - 1);
			}
			let start = 0;
			for (let i = 0; i + width <= chunk.length; i += width) {
				const newline = width === 1 ? chunk[i] === 10 : encoding === "utf-16le"
					? chunk[i] === 10 && chunk[i + 1] === 0 : chunk[i] === 0 && chunk[i + 1] === 10;
				if (!newline) continue;
				append(chunk.subarray(start, i + width), true);
				const text = pending.endsWith("\n") ? pending.slice(0, -1) : pending;
				yield { text: text.endsWith("\r") ? text.slice(0, -1) : text, oversized, hasNext: true };
				pending = "";
				oversized = false;
				start = i + width;
			}
			append(chunk.subarray(start), bytesRead > 0);
			if (!bytesRead) break;
		}
		if (pending || oversized || sawText) yield { text: pending, oversized, hasNext: false };
	} finally {
		await file.close();
	}
}

function continuation(selected: string[], nextLine: number): string {
	for (;;) {
		const notice = `\n\n[Use offset=${nextLine} to continue.]`;
		const body = selected.join("\n");
		if (Buffer.byteLength(body) + Buffer.byteLength(notice) <= MAX_BYTES) return body + notice;
		if (selected.length === 1) {
			const partial = `\n\n[Line ${nextLine - 1} is not shown in full. Use offset=${nextLine} to continue.]`;
			return prefixBytes(body, MAX_BYTES - Buffer.byteLength(partial)) + partial;
		}
		selected.pop();
		nextLine--;
	}
}

async function readText(path: string, offset: number, limit: number | undefined, signal?: AbortSignal): Promise<string> {
	let start = Math.max(1, offset);
	if (offset < 0) {
		let count = 0;
		for await (const _line of lines(path, signal)) count++;
		start = Math.max(1, count + offset + 1);
	}
	const selected: string[] = [];
	let lineNumber = 0;
	let bytes = 0;
	const input = lines(path, signal);
	for await (const line of input) {
		lineNumber++;
		if (lineNumber < start) continue;
		const text = lineNumber % 10 === 0 ? `${String(lineNumber).padStart(6)}|${line.text}` : line.text;
		const available = MAX_BYTES - bytes - (selected.length ? 1 : 0);
		if (line.oversized || Buffer.byteLength(text) > available) {
			if (selected.length) return continuation(selected, lineNumber);
			const suffix = line.hasNext ? ` Use offset=${lineNumber + 1} to continue.` : "";
			const notice = `\n\n[Line ${lineNumber} is not shown in full.${suffix}]`;
			return prefixBytes(text, MAX_BYTES - Buffer.byteLength(notice)) + notice;
		}
		selected.push(text);
		bytes += Buffer.byteLength(text) + (selected.length > 1 ? 1 : 0);
		if (selected.length >= Math.min(limit ?? MAX_LINES, MAX_LINES)) {
			return line.hasNext ? continuation(selected, lineNumber + 1) : selected.join("\n");
		}
	}
	if (!lineNumber) return "File is empty.";
	if (start > lineNumber) throw new Error(`Offset ${offset} is beyond end of file (${lineNumber} lines total)`);
	return selected.join("\n");
}

export function createReadFileTool(cwd: string, settings: () => any): ToolDefinition {
	const stock: any = createReadToolDefinition(cwd);
	return {
		...stock,
		name: "rqw_readfile",
		label: "rqw_readfile",
		description: readDescription("rqw_readfile"),
		parameters: Type.Object({
			path: Type.String({ description: "The relative or absolute path of the file to read." }),
			offset: Type.Optional(Type.Integer({ description: "The line number to start reading from. Positive values are 1-indexed from the start of the file. Negative values count backwards from the end (e.g. -1 is the last line). Only provide if the file is too large to read at once." })),
			limit: Type.Optional(Type.Integer({ description: "The number of lines to read. Only provide if the file is too large to read at once." })),
		}),
		prepareArguments(input: any) {
			if (!input || typeof input !== "object" || Array.isArray(input)) return input;
			return Object.fromEntries(Object.entries(input).filter(([key, value]) => key === "path" || (value != null && value !== "null")));
		},
		async execute(id: string, params: ReadParams, signal: AbortSignal | undefined, onUpdate: any, ctx: any) {
			checkAbort(signal);
			if (params.offset !== undefined && !Number.isSafeInteger(params.offset)) throw new Error("offset must be an integer");
			if (params.limit !== undefined && (!Number.isSafeInteger(params.limit) || params.limit < 1)) throw new Error("limit must be at least 1");
			const root = ctx?.cwd || cwd;
			const path = await resolveReadPath(params.path, root);
			const file = await open(path, "r");
			let sample: Buffer;
			try {
				const buffer = Buffer.alloc(32);
				const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
				sample = buffer.subarray(0, bytesRead);
			} finally { await file.close(); }
			if (isImage(sample)) {
				let options: any;
				try { const s = settings(); options = s ? { autoResizeImages: s.images?.autoResize ?? true } : undefined; } catch { /* stock defaults */ }
				// The stock tool resolves its path again and could pick a sibling name; pin every file operation to ours.
				const pinned = {
					readFile: () => readFile(path),
					access: () => access(path, constants.R_OK),
					detectImageMimeType: () => detectSupportedImageMimeTypeFromFile(path),
				};
				const image: any = createReadToolDefinition(root, { ...options, operations: pinned });
				const result = await image.execute(id, { path }, signal, onUpdate, ctx);
				if (!result.content.some((block: any) => block.type === "image") && !result.content.some((block: any) => block.type === "text" && block.text.startsWith("Read image file ["))) {
					throw new Error("Unsupported or invalid image format");
				}
				return result;
			}
			if (sample.subarray(0, 5).toString("ascii") === "%PDF-" || /\.pdf$/i.test(path)) throw new Error("Unsupported format: PDF");
			const text = await readText(path, params.offset ?? 1, params.limit, signal);
			return { content: [{ type: "text", text }], structuredContent: text };
		},
	} as ToolDefinition;
}
