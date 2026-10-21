// Billing shape and constants follow oh-my-pi's MIT-licensed anthropic.ts.
// See THIRD-PARTY-NOTICES.md. The checksum implementation is portable JS.
import { createHash } from "node:crypto";
import { Type } from "typebox";
import { Compile } from "typebox/compile";

const Payload = Compile(Type.Object({
    system: Type.Array(Type.Object({ type: Type.String(), text: Type.String() })),
    messages: Type.Array(Type.Object({ role: Type.String(), content: Type.Union([
        Type.String(), Type.Array(Type.Object({ type: Type.String(), text: Type.Optional(Type.String()) })),
    ]) })),
    metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
}));

export const DEFAULT_VERSION = "2.1.280";
export const IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";
const MASK = (1n << 64n) - 1n;
const P1 = 11400714785074694791n;
const P2 = 14029467366897019727n;
const P3 = 1609587929392839161n;
const P4 = 9650029242287828579n;
const P5 = 2870177450012600261n;
const rot = (x: bigint, n: bigint) => ((x & MASK) << n | (x & MASK) >> (64n - n)) & MASK;
const round = (a: bigint, b: bigint) => rot(a + b * P2, 31n) * P1 & MASK;

export function xxh64(bytes: Uint8Array, seed = 0n): bigint {
	const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let i = 0;
	let h: bigint;
	if (bytes.length >= 32) {
		const lanes = [seed + P1 + P2, seed + P2, seed, seed - P1].map(x => x & MASK);
		while (i <= bytes.length - 32) {
			for (let lane = 0; lane < 4; lane++, i += 8) lanes[lane] = round(lanes[lane], data.getBigUint64(i, true));
		}
		h = lanes.reduce((sum, x, n) => sum + rot(x, [1n, 7n, 12n, 18n][n]), 0n) & MASK;
		for (const lane of lanes) h = ((h ^ round(0n, lane)) * P1 + P4) & MASK;
	} else h = (seed + P5) & MASK;
	h = (h + BigInt(bytes.length)) & MASK;
	while (i <= bytes.length - 8) {
		h = (rot(h ^ round(0n, data.getBigUint64(i, true)), 27n) * P1 + P4) & MASK;
		i += 8;
	}
	if (i <= bytes.length - 4) {
		h = (rot(h ^ BigInt(data.getUint32(i, true)) * P1, 23n) * P2 + P3) & MASK;
		i += 4;
	}
	while (i < bytes.length) h = rot(h ^ BigInt(bytes[i++]) * P5, 11n) * P1 & MASK;
	h ^= h >> 33n;
	h = h * P2 & MASK;
	h ^= h >> 29n;
	h = h * P3 & MASK;
	return (h ^ h >> 32n) & MASK;
}

export interface VersionState { readonly value: string; adopt(message: string): boolean }

export function versionState(override = process.env.PI_AI_CLAUDE_CODE_VERSION): VersionState {
	if (override !== undefined && !/^\d+\.\d+\.\d+$/.test(override)) {
		throw new Error("RQW-anthropic: PI_AI_CLAUDE_CODE_VERSION must be major.minor.patch");
	}
	let value = override ?? DEFAULT_VERSION;
	return {
		get value() { return value; },
		adopt(message: string): boolean {
			if (override || !message.includes("claude_code_version_too_old")) return false;
			const required = /version (\d+\.\d+\.\d+) or newer is required/i.exec(message)?.[1];
			if (!required) return false;
			const a = required.split(".").map(Number);
			const b = value.split(".").map(Number);
			const different = a.findIndex((v, i) => v !== b[i]);
			if (different < 0 || a[different] <= b[different]) return false;
			value = required;
			return true;
		},
	};
}

export function billingBody(raw: string, version: string, sessionId: string, deviceId: string): string {
	const parsed: unknown = JSON.parse(raw);
	if (!Payload.Check(parsed)) throw new Error("RQW-anthropic: unsupported Anthropic payload; request not sent");
	const body = parsed;
	if (body.system[0]?.text !== IDENTITY) {
		throw new Error("RQW-anthropic: missing Pi OAuth identity; request not sent");
	}
	// omp uses the first non-empty text block, not concatenation of all text blocks.
	let text = "";
	for (const message of body.messages) {
		if (message.role !== "user") continue;
		if (typeof message.content === "string") {
			if (message.content.trim()) { text = message.content; break; }
			continue;
		}
		const block = message.content.find(block => block.type === "text" && block.text?.trim());
		if (block?.text) { text = block.text; break; }
		if (message.content.some(block => block.type === "image")) break;
	}
	const sampled = [4, 7, 20].map(i => text[i] ?? "0").join("");
	const suffix = createHash("sha256").update(`59cf53e54c78${sampled}${version}`).digest("hex").slice(0, 3);
	body.system.unshift({ type: "text", text: `x-anthropic-billing-header: cc_version=${version}.${suffix}; cc_entrypoint=cli; cch=00000;` });
	body.metadata = { ...body.metadata, user_id: JSON.stringify({ device_id: deviceId, session_id: sessionId }) };
	const serialized = JSON.stringify(body);
	const hash = xxh64(new TextEncoder().encode(serialized), 0x4d659218e32a3268n);
	const digest = (hash & 0xfffffn).toString(16).padStart(5, "0");
	// Replace only the billing block; literals in messages and prompts are not checksum slots.
	body.system[0].text = body.system[0].text.replace("cch=00000", `cch=${digest}`);
	return JSON.stringify(body);
}

export const isOAuth = (key?: string) => key?.startsWith("sk-ant-oat") === true;
