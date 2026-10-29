import { BranchSummaryMessageComponent, CompactionSummaryMessageComponent, keyText, type ExtensionAPI, type Theme } from "@earendil-works/pi-coding-agent";
import { foregroundAnsi, Markdown, parseColor, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { installBash } from "./bash.ts";
import { installThinking } from "./thinking.ts";
import { installJump, isJumpInstalled } from "./jump.ts";
import { installFlash } from "./flash.ts";
import { installHistory } from "./history.ts";

const ACTIVE = Symbol.for("rqw-blocks.compaction");
const GOLD = ["#8a6d1c", "#c9a227", "#e3c45a"];
const FADE = ["#8a6d1c", "#3a3836"];
const SILVER = ["#7f7e7c", "#adadac", "#d6d6d5"];
const SILVER_FADE = ["#7f7e7c", "#2c2b2a"];

type Summary = { expanded: boolean; message: { summary: string; tokensBefore: number }; markdownTheme: any; paddingX: number };

function mix(stops: string[], position: number): string {
	const p = position * (stops.length - 1);
	const a = stops[Math.floor(p)].slice(1);
	const b = stops[Math.min(Math.floor(p) + 1, stops.length - 1)].slice(1);
	return "#" + [0, 2, 4].map(i => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - p % 1) + parseInt(b.slice(i, i + 2), 16) * (p % 1)).toString(16).padStart(2, "0")).join("");
}

function gradient(text: string, stops: string[], theme: Theme, bold = false): string {
	const chars = Array.from(text);
	return chars.map((char, i) => char === " " ? char : `${bold ? "\x1b[1m" : ""}${foregroundAnsi(parseColor(mix(stops, chars.length > 1 ? i / (chars.length - 1) : 0.5)), theme.getColorMode())}${char}\x1b[39m${bold ? "\x1b[22m" : ""}`).join("");
}

function formatK(n: number): string {
	const [value, unit] = n >= 1e6 ? [n / 1e6, "M"] : [n / 1e3, "k"];
	return `${value.toFixed(1).replace(/\.0$/, "")}${unit}`;
}

function row(label: string, width: number, theme: Theme, stops = GOLD, fade = FADE): string {
	const hint = keyText("app.tools.expand");
	const room = Math.max(0, width);
	const head = "── ";
	const tail = ` ${hint} ──`;
	const fill = room - visibleWidth(head + label + " " + tail);
	if (fill < 2) return truncateToWidth(gradient(`${head}${label}`, stops, theme, true), room);
	return gradient(head, stops.slice(0, 1), theme) + gradient(label, stops, theme, true) + " " + gradient("─".repeat(fill), fade, theme) + " " + theme.fg("dim", hint) + gradient(" ──", fade.slice(-1), theme);
}

function installSummary(getTheme: () => Theme, prototype: any, branch: boolean): () => void {
	if (typeof prototype.render !== "function" || typeof prototype.invalidate !== "function" || typeof prototype.setExpanded !== "function" || typeof prototype.updateDisplay !== "function") return () => {};
	const own = Object.getOwnPropertyDescriptors(prototype);
	const original = prototype.render;
	const cache = new WeakMap<object, { width: number; expanded: boolean; message: Summary["message"]; pad: number; lines: string[] }>();
	const patched = new WeakSet<object>();
	const valid = (value: Summary) => typeof value.expanded === "boolean" && typeof value.message?.summary === "string" && (branch || typeof value.message.tokensBefore === "number") && !!value.markdownTheme && typeof value.paddingX === "number";
	prototype.render = function (this: Summary, width: number) {
		if (!valid(this)) { patched.delete(this); return original.call(this, width); }
		try {
			const cached = cache.get(this);
			if (cached && cached.width === width && cached.expanded === this.expanded && cached.message === this.message && cached.pad === this.paddingX) { patched.add(this); return cached.lines; }
			const theme = getTheme();
			const pad = Math.max(0, this.paddingX);
			const label = branch ? "branch summary" : `compaction · ${formatK(this.message.tokensBefore)} tokens`;
			const lines = [" ".repeat(pad) + row(label, width - pad * 2, theme, branch ? SILVER : GOLD, branch ? SILVER_FADE : FADE)];
			if (this.expanded) lines.push(...new Markdown(this.message.summary, 0, 0, this.markdownTheme, { color: text => theme.fg("muted", text) }).render(Math.max(1, width - 4)).map(line => "   " + line));
			cache.set(this, { width, expanded: this.expanded, message: this.message, pad: this.paddingX, lines });
			patched.add(this);
			return lines;
		} catch { patched.delete(this); return original.call(this, width); }
	};
	const invalidate = prototype.invalidate;
	prototype.invalidate = function () { cache.delete(this); return invalidate.call(this); };
	const mouse = prototype.handleMouse;
	prototype.handleMouse = function (event: unknown) {
		if (!valid(this) || !patched.has(this)) return mouse?.call(this, event);
		return undefined;
	};
	const restore = () => {
		for (const key of ["render", "invalidate", "handleMouse"]) {
			if (own[key]) Object.defineProperty(prototype, key, own[key]); else delete prototype[key];
		}
	};
	return restore;
}

export function installCompaction(getTheme: () => Theme, prototype: any = CompactionSummaryMessageComponent.prototype): () => void {
	return installSummary(getTheme, prototype, false);
}

export function installBranch(getTheme: () => Theme, prototype: any = BranchSummaryMessageComponent.prototype): () => void {
	return installSummary(getTheme, prototype, true);
}

export default function blocks(pi: ExtensionAPI): void {
	let restore = () => {};
	// Installed while the extension loads, not at session_start: Pi draws the transcript of a reload or a switched
	// session before the new session's extensions start.
	const restoreHistory = installHistory();
	// Other block patches are installed here, each with its own cleanup.
	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		(globalThis as any)[ACTIVE]?.();
		const cleanups = [installCompaction(() => ctx.ui.theme), installBranch(() => ctx.ui.theme), installBash(() => ctx.ui.theme), installThinking()];
		let uninstallTui = () => {};
		if (ctx.mode === "tui") {
			ctx.ui.setWidget("rqw-blocks", (tui) => {
				const renderer = tui as any;
				let mode: unknown;
				let jumpInstalled = false;
				let flashes: unknown;
				let theme: Theme | undefined;
				const install = () => {
					if (mode === renderer.mode && jumpInstalled === isJumpInstalled(renderer) && flashes === renderer.flashes && theme === ctx.ui.theme) return;
					uninstallTui();
					theme = ctx.ui.theme;
					const jump = installJump(renderer, () => ctx.ui.theme);
					const flash = installFlash(renderer, theme);
					mode = renderer.mode;
					jumpInstalled = isJumpInstalled(renderer);
					flashes = renderer.flashes;
					uninstallTui = () => { jump(); flash(); };
				};
				install();
				return { render: () => [], invalidate: install };
			}, { placement: "belowEditor" });
			cleanups.push(() => { uninstallTui(); ctx.ui.setWidget("rqw-blocks", undefined); });
		}
		restore = () => { for (const cleanup of cleanups) cleanup(); if ((globalThis as any)[ACTIVE] === restore) delete (globalThis as any)[ACTIVE]; };
		(globalThis as any)[ACTIVE] = restore;
	});
	pi.on("session_shutdown", () => { restoreHistory(); restore(); });
}
