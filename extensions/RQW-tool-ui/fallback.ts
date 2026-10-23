// Pi's expanded fallback formatting, reproduced here because Pi does not export it (owner decision, UI port P3
// amendment): a tool call without a renderCall, a result without a renderResult (or whose renderer throws), and a tool
// Pi has no definition for are drawn exactly as Pi 1.4.0 draws them in the expanded (Ctrl+O) view.
//
// Source, pinned to @earendil-works/pi-coding-agent 1.4.0 (`PI_FALLBACK_VERSION`, checked by test/original.test.ts):
// - dist/core/tools/render-utils.js:56 `getTextOutput`, :81 `formatToolCallWithArgs` (expanded branch only)
// - dist/utils/ansi.js `stripAnsi` (ansi-regex/strip-ansi, MIT, Sindre Sorhus), dist/utils/shell.js:165
//   `sanitizeBinaryOutput`, render-utils.js `replaceTabs`
// - dist/modes/interactive/components/tool-execution.js:95-111 `createCallFallback`/`createResultFallback` (expanded:
//   every line), :311 `formatToolExecution`, :200-204 the background by state, :50-51 the box and text paddings
// When Pi is upgraded, compare these sources again; test/original.test.ts compares the rows with Pi's own component.
import type { Theme } from "@earendil-works/pi-coding-agent";
import { getCapabilities, getImageDimensions, imageFallback } from "@earendil-works/pi-tui";

/** The Pi version this formatting was copied from. */
export const PI_FALLBACK_VERSION = "1.4.0";

/** The parts of a tool result the fallbacks read. */
export interface FallbackResult {
	content?: readonly { type: string; text?: string; data?: string; mimeType?: string }[];
}

const ST = "(?:\\u0007|\\u001B\\u005C|\\u009C)";
const OSC_START = "\\u001B\\]";
const CSI_START = "[\\u001B\\u009B][[\\]()#;?]*(?:\\d{1,4}(?:[;:]\\d{0,4})*)?";
const CSI_FINAL = "[\\dA-PR-TZcf-nq-uy=><~]";
const ANSI = new RegExp(`(?:${OSC_START}[\\s\\S]*?${ST})|${CSI_START}${CSI_FINAL}`, "g");

function stripAnsi(value: string): string {
	if (!value.includes("\u001B") && !value.includes("\u009B")) return value;
	return value.replace(ANSI, "");
}

function sanitizeBinaryOutput(value: string): string {
	return value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFF9-\uFFFB]/g, "");
}

const replaceTabs = (text: string) => text.replace(/\t/g, "   ");

/** Text blocks without escapes and control characters; image placeholders when images are not shown. */
export function textOutput(result: FallbackResult | undefined, showImages: boolean): string {
	if (!result) return "";
	const content = result.content ?? [];
	const textBlocks = content.filter((c) => c.type === "text");
	const imageBlocks = content.filter((c) => c.type === "image");
	let output = textBlocks.map((c) => sanitizeBinaryOutput(stripAnsi(c.text || "")).replace(/\r/g, "")).join("\n");
	const caps = getCapabilities();
	if (imageBlocks.length > 0 && (!caps.images || !showImages)) {
		const indicators = imageBlocks.map((img) => {
			const mimeType = img.mimeType ?? "image/unknown";
			const dims = img.data && img.mimeType ? (getImageDimensions(img.data, img.mimeType) ?? undefined) : undefined;
			return imageFallback(mimeType, dims);
		}).join("\n");
		output = output ? `${output}\n${indicators}` : indicators;
	}
	return output;
}

/** The call without a renderCall: the bold title, then one muted `key: value` line per argument. */
export function callFallback(title: string, args: unknown, theme: Theme): string {
	const header = theme.fg("toolTitle", theme.bold(title));
	if (args == null) return header;
	const entries = typeof args === "object" && !Array.isArray(args) ? Object.entries(args) : [["args", args] as const];
	if (entries.length === 0) return header;
	const lines = entries.map(([key, value]) => {
		const text = typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? String(value));
		return `  ${key}: ${replaceTabs(text).replace(/\r/g, "").split("\n").join("\n    ")}`;
	});
	return `${header}\n${theme.fg("muted", lines.join("\n"))}`;
}

/** The result without a renderResult: every output line in the tool output colour; undefined without output. */
export function resultFallback(result: FallbackResult | undefined, showImages: boolean, theme: Theme): string | undefined {
	const output = textOutput(result, showImages);
	if (!output) return undefined;
	return output.split("\n").map((line) => theme.fg("toolOutput", line)).join("\n");
}

/** A tool Pi has no definition for: the bold name, a blank row, the arguments as JSON, then the output. */
export function unknownToolText(toolName: string, args: unknown, result: FallbackResult | undefined, showImages: boolean, theme: Theme): string {
	let text = theme.fg("toolTitle", theme.bold(toolName));
	const content = JSON.stringify(args, null, 2);
	if (content) text += `\n\n${content}`;
	const output = textOutput(result, showImages);
	if (output) text += `\n${output}`;
	return text;
}

/** The background of the call's box: pending while partial, then error or success. */
export function shellBackground(theme: Theme, isPartial: boolean, isError: boolean): (text: string) => string {
	const role = isPartial ? "toolPendingBg" : isError ? "toolErrorBg" : "toolSuccessBg";
	return (text) => theme.bg(role, text);
}
