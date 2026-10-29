import { truncateToWidth } from "@earendil-works/pi-tui";

type Theme = { fg(color: "success", text: string): string };
type Flash = { entries: { message: string }[]; render(width: number): string[]; flash(message: string, durationMs?: number): void; dispose: unknown };
type Renderer = { mode?: string; flashes?: Flash };

/** Restyle successful copy notices; preserve stock output for every other flash. */
export function installFlash(tui: Renderer, theme: Theme): () => void {
	const flashes = tui.flashes;
	if (tui.mode !== "fullscreen" || !flashes || !Array.isArray(flashes.entries) ||
		typeof flashes.render !== "function" || typeof flashes.flash !== "function" || typeof flashes.dispose !== "function") return () => {};
	const original = flashes.render;
	const originalFlash = flashes.flash;
	let version = 0;
	let lastVersion = -1;
	let lastWidth = -1;
	let lastEntries: Flash["entries"] | undefined;
	let lastLength = -1;
	let cached: string[] = [];
	const addFlash: Flash["flash"] = function (message, durationMs) {
		version++;
		return originalFlash.call(flashes, message, durationMs);
	};
	const replacement = (width: number) => {
		const entries = flashes.entries;
		if (!Array.isArray(entries)) return original.call(flashes, width);
		if (width !== lastWidth || entries !== lastEntries || entries.length !== lastLength || version !== lastVersion) {
			if (!entries.every((entry) => entry && typeof entry.message === "string")) return original.call(flashes, width);
			lastWidth = width;
			lastEntries = entries;
			lastLength = entries.length;
			lastVersion = version;
			cached = original.call(flashes, width).map((line, i) => entries[i].message === "Copied!"
				? theme.fg("success", truncateToWidth("✓ copied ", width, "")) : line);
		}
		return cached;
	};
	flashes.flash = addFlash;
	flashes.render = replacement;
	return () => {
		if (flashes.render === replacement) flashes.render = original;
		if (flashes.flash === addFlash) flashes.flash = originalFlash;
	};
}
