import { foregroundAnsi, getKeybindings, parseColor } from "@earendil-works/pi-tui";

type Theme = { fg(color: "dim", text: string): string; getColorMode(): Parameters<typeof foregroundAnsi>[1] };
const JUMP = Symbol("rqw-blocks.jump");
type Renderer = { mode?: string; scrollToEndIndicator?: () => string; [JUMP]?: (restore?: unknown) => boolean };

export function isJumpInstalled(tui: Renderer): boolean {
	return tui[JUMP]?.() === true;
}

/** Install on the current fullscreen renderer, or leave an unfamiliar renderer untouched. */
export function installJump(tui: Renderer, getTheme: () => Theme): () => void {
	if (tui.mode !== "fullscreen" || typeof tui.scrollToEndIndicator !== "function") return () => {};
	let key = "";
	let lastTheme: Theme | undefined;
	let cached = "";
	const replacement = () => {
		const theme = getTheme();
		const keys = getKeybindings().getKeys("tui.altScreen.bottom").join("/");
		const mode = theme.getColorMode();
		const signature = `${mode}:${keys}`;
		if (signature !== key || theme !== lastTheme) {
			key = signature;
			lastTheme = theme;
			const colors = ["#8a6d1c", "#a68522", "#c9a227", "#d6b340", "#e3c45a"];
			const label = Array.from("↓ latest", (char, i) => `${foregroundAnsi(parseColor(colors[Math.round(i * 4 / 7)]), mode)}${char}`).join("");
			cached = ` \x1b[1m${label}\x1b[0m${theme.fg("dim", keys ? ` · ${keys} ` : " ")}`;
		}
		return cached;
	};
	let marker: NonNullable<Renderer[typeof JUMP]>;
	// Pi's proxy binds methods to the live renderer; inspect and restore its raw property there.
	tui[JUMP] = function (this: Renderer) {
		const original = this.scrollToEndIndicator;
		marker = function (this: Renderer, restore?: unknown) {
			if (this[JUMP] !== marker || this.scrollToEndIndicator !== replacement || (restore !== undefined && restore !== marker)) return false;
			if (restore === marker) {
				this.scrollToEndIndicator = original;
				delete this[JUMP];
			}
			return true;
		};
		this.scrollToEndIndicator = replacement;
		this[JUMP] = marker;
		return true;
	};
	tui[JUMP]?.();
	return () => { tui[JUMP]?.(marker); };
}
