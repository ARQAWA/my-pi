import { StringDecoder } from "node:string_decoder";

/** One JSON line is at most 64 KiB; a larger answer travels as several chunk frames. */
export const MAX_FRAME_BYTES = 64 * 1024;
/** Even if every character became a six-byte escape, a chunk frame stays under the limit. */
export const CHUNK_CHARS = 8000;

export type ErrorCode = "unauthorized" | "stale_generation" | "bad_request" | "unknown_op" | "internal";
export type Request = { v: 1; id: string; op: string; generation: string; secret: string; params?: unknown };
export type Frame =
	| { v: 1; id: string; seq: number; last: boolean; chunk: string }
	| { v: 1; id: string; error: { code: ErrorCode } };

export function encode(frame: Request | Frame): string {
	const line = `${JSON.stringify(frame)}\n`;
	if (Buffer.byteLength(line) > MAX_FRAME_BYTES) throw new Error("frame too large");
	return line;
}

/** The frames that carry one result, each within the size limit. */
export function chunkResult(id: string, result: unknown): Frame[] {
	const text = JSON.stringify(result ?? null);
	const frames: Frame[] = [];
	for (let at = 0; at === 0 || at < text.length; at += CHUNK_CHARS) {
		frames.push({ v: 1, id, seq: frames.length, last: at + CHUNK_CHARS >= text.length, chunk: text.slice(at, at + CHUNK_CHARS) });
	}
	return frames;
}

/** Splits a byte stream into JSON lines; a line over the limit is a protocol error. */
export class FrameReader {
	private decoder = new StringDecoder("utf8");
	private pending = "";

	push(data: Buffer | string): unknown[] {
		this.pending += typeof data === "string" ? data : this.decoder.write(data);
		const lines = this.pending.split("\n");
		this.pending = lines.pop() ?? "";
		if (Buffer.byteLength(this.pending) > MAX_FRAME_BYTES || lines.some(line => Buffer.byteLength(line) > MAX_FRAME_BYTES)) {
			throw new Error("frame too large");
		}
		return lines.filter(line => line.trim()).map(line => JSON.parse(line) as unknown);
	}
}

/** Puts the chunks of one answer back together, in order. */
export class Assembler {
	private text = "";
	private next = 0;

	/** Returns the parsed result after the last chunk, undefined before it. */
	add(frame: Extract<Frame, { chunk: string }>): { result: unknown } | undefined {
		if (frame.seq !== this.next++) throw new Error("chunk out of order");
		this.text += frame.chunk;
		return frame.last ? { result: JSON.parse(this.text) as unknown } : undefined;
	}
}
