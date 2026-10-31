// Billing shape and constants follow oh-my-pi's MIT-licensed anthropic.ts.
// See THIRD-PARTY-NOTICES.md.
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

export interface VersionState {
	readonly value: string;
	fork(): VersionState;
	adopt(message: string, sentVersion?: string): boolean;
}

function compareVersions(a: string, b: string): number {
	const left = a.split(".").map(Number);
	const right = b.split(".").map(Number);
	const different = left.findIndex((part, i) => part !== right[i]);
	return different < 0 ? 0 : Math.sign(left[different] - right[different]);
}

export function versionState(override = process.env.PI_AI_CLAUDE_CODE_VERSION): VersionState {
	if (override !== undefined && !/^\d+\.\d+\.\d+$/.test(override)) {
		throw new Error("RQW-anthropic: PI_AI_CLAUDE_CODE_VERSION must be major.minor.patch");
	}
	return createVersionState(override ?? DEFAULT_VERSION, override !== undefined);
}

function createVersionState(value: string, pinned: boolean): VersionState {
	return {
		get value() { return value; },
		fork() { return createVersionState(value, pinned); },
		adopt(message: string, sentVersion = value): boolean {
			if (pinned || !message.includes("claude_code_version_too_old")) return false;
			const required = /version (\d+\.\d+\.\d+) or newer is required/i.exec(message)?.[1];
			if (!required) return false;
			if (compareVersions(required, value) > 0) value = required;
			// A neighbor may already have adopted the minimum while this request was in flight.
			return compareVersions(value, sentVersion) > 0 && compareVersions(value, required) >= 0;
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
	body.system.unshift({ type: "text", text: `x-anthropic-billing-header: cc_version=${version}.${suffix}; cc_entrypoint=cli;` });
	body.metadata = { ...body.metadata, user_id: JSON.stringify({ device_id: deviceId, session_id: sessionId }) };
	return JSON.stringify(body);
}
