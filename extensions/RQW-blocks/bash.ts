import { BashExecutionComponent, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateTail, type Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

type Bash = {
	command: string; outputLines: string[]; status: string; exitCode?: number | null;
	expanded: boolean; colorKey: string; truncationResult?: { truncated?: boolean }; fullOutputPath?: string;
};

const clean = (line: string) => stripTerminalSequences(line).replace(/\t/g, "   ").replace(/[\x00-\x1f\x7f-\x9f]/g, "");
const fitEnd = (text: string, width: number) => truncateToWidth(text, Math.max(0, width), "…");
function fitStart(text: string, width: number): string {
	if (width <= 0) return "";
	if (visibleWidth(text) <= width) return text;
	let result = "", used = 1;
	for (const { segment } of [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].reverse()) {
		const size = visibleWidth(segment);
		if (used + size > width) break;
		result = segment + result;
		used += size;
	}
	return `…${result}`;
}

export function installBash(getTheme: () => Theme, prototype: any = BashExecutionComponent.prototype): () => void {
	if (typeof prototype.render !== "function" || typeof prototype.invalidate !== "function" || typeof prototype.updateDisplay !== "function" || typeof prototype.setExpanded !== "function" || typeof prototype.appendOutput !== "function" || typeof prototype.setComplete !== "function") return () => {};
	const own = Object.getOwnPropertyDescriptors(prototype);
	const original = prototype.render;
	const invalidate = prototype.invalidate;
	const cache = new WeakMap<object, { width: number; lines: string[] }>();
	for (const method of ["appendOutput", "setComplete", "setExpanded", "setOutputPad"]) {
		if (typeof prototype[method] !== "function") continue;
		const originalMethod = prototype[method];
		prototype[method] = function (...args: unknown[]) { cache.delete(this); return originalMethod.apply(this, args); };
	}
	prototype.render = function (this: Bash, width: number) {
		if (typeof this.command !== "string" || !Array.isArray(this.outputLines) || !["running", "complete", "error", "cancelled"].includes(this.status) || typeof this.expanded !== "boolean" || !["dim", "bashMode"].includes(this.colorKey)) return original.call(this, width);
		const hit = cache.get(this);
		if (hit?.width === width) return hit.lines;
		try {
			const theme = getTheme();
			const failed = this.status === "error" || this.status === "cancelled";
			const bg = this.status === "running" ? "toolPendingBg" : failed ? "toolErrorBg" : "toolSuccessBg";
			const inner = width - 3;
			const paint = (text: string, color: Parameters<Theme["fg"]>[0]) => {
				if (inner <= 0) return " ".repeat(Math.max(0, width));
				return "   " + theme.bg(bg, theme.fg(color, text) + " ".repeat(Math.max(0, inner - visibleWidth(text))));
			};
			const truncated = this.expanded ? truncateTail(this.outputLines.join("\n"), { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES }) : undefined;
			const source = truncated ? truncated.content.split("\n") : this.outputLines;
			const output: string[] = [];
			for (let i = source.length - 1; i >= 0; i--) {
				const line = source[i];
				if (typeof line !== "string") return original.call(this, width);
				const cleaned = clean(line);
				if (output.length === 0 && !cleaned.trim()) continue;
				output.push(cleaned);
				if (!this.expanded && output.length === 4) break;
			}
			output.reverse();
			const shown = this.expanded && inner > 0 ? output.flatMap(line => wrapTextWithAnsi(line, inner)) : output;
			const status = this.status === "running" ? "running" : this.status === "cancelled" ? "aborted" : this.status === "error" ? `✗ exit ${this.exitCode}` : "✓";
			const lines = ["", paint(fitStart(`$ ${clean(this.command)}`, inner), this.colorKey === "dim" ? "dim" : "toolTitle"), ...shown.map(line => paint(fitEnd(line, inner), "toolOutput"))];
			if (this.truncationResult?.truncated || truncated?.truncated) {
				const note = this.fullOutputPath ? `Output truncated. Full output: ${this.fullOutputPath}` : "Output truncated.";
				lines.push(paint(fitEnd(note, inner), "warning"));
			}
			lines.push(paint(fitEnd(status, inner), this.status === "running" ? "muted" : failed ? "error" : "success"));
			cache.set(this, { width, lines });
			return lines;
		} catch { return original.call(this, width); }
	};
	prototype.invalidate = function () { cache.delete(this); return invalidate.call(this); };
	return () => {
		for (const key of ["render", "invalidate", "appendOutput", "setComplete", "setExpanded", "setOutputPad"]) {
			if (own[key]) Object.defineProperty(prototype, key, own[key]); else delete prototype[key];
		}
	};
}
