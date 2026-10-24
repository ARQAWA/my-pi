import { normalizeText } from "./safe-text.ts";
import type { RunOptions, TargetResult, WebSource } from "./types.ts";

const INDEX_SOURCES = 5;
const LABEL_CHARS = 120;
/** Lines longer than this are split, so every line can be read back with a line offset. */
const MAX_LINE_CHARS = 8000;

function oneLine(text: string): string {
	return normalizeText(text).replace(/\s+/g, " ").trim();
}

function label(result: TargetResult): string {
	const value = oneLine(result.target.value);
	const clipped = value.length > LABEL_CHARS ? `${value.slice(0, LABEL_CHARS - 3)}...` : value;
	return `${result.target.kind}: ${clipped}`;
}

function uniqueSources(sources: WebSource[]): WebSource[] {
	const seen = new Set<string>();
	return sources.filter(source => {
		if (typeof source?.url !== "string" || !/^https?:\/\//i.test(source.url) || seen.has(source.url)) return false;
		seen.add(source.url);
		return true;
	});
}

/** Percent-escapes what would end a Markdown destination early. encodeURIComponent leaves ( and ) alone. */
function markdownUrl(url: string): string {
	return url.replace(/[()<>\s]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
}

function link(source: WebSource): string {
	const title = oneLine(source.title ?? "") || source.url;
	return `[${title.replace(/[[\]]/g, "")}](${markdownUrl(source.url)})`;
}

function statusLine(result: TargetResult, index: number): string {
	const state = result.status === "ok" ? "ok" : `error (${oneLine(result.error?.code ?? "error")})`;
	return `${index + 1}. ${state} - ${label(result)}`;
}

function indexSection(results: TargetResult[]): string[] {
	return results.flatMap((result, index) => {
		const sources = uniqueSources(result.sources);
		const shown = sources.slice(0, INDEX_SOURCES).map(source => `   - ${link(source)}`);
		const more = sources.length > INDEX_SOURCES ? [`   - (+${sources.length - INDEX_SOURCES} more below)`] : [];
		return [statusLine(result, index), ...shown, ...more];
	});
}

function bodySection(results: TargetResult[]): string[] {
	return results.flatMap((result, index) => {
		const lines = ["", `### ${index + 1}. ${label(result)}`];
		if (result.status !== "ok") {
			return [...lines, `Error (${oneLine(result.error?.code ?? "error")}): ${oneLine(result.error?.message ?? "The target failed.")}`];
		}
		const sources = uniqueSources(result.sources);
		const list = sources.length > 0 ? ["", "Sources:", ...sources.map(source => `- ${link(source)}`)] : [];
		return [...lines, normalizeText(result.summary).trim(), ...list];
	});
}

function splitLongLines(text: string): string {
	return text.split("\n").flatMap(line => {
		const parts: string[] = [];
		let rest = line;
		while (rest.length > MAX_LINE_CHARS) {
			const space = rest.lastIndexOf(" ", MAX_LINE_CHARS);
			const cut = space > 0 ? space : MAX_LINE_CHARS;
			parts.push(rest.slice(0, cut));
			rest = rest.slice(space > 0 ? cut + 1 : cut);
		}
		return [...parts, rest];
	}).join("\n");
}

/** The full normalized result. Statuses and source links come first so a cut never hides them. */
export function renderReport(results: TargetResult[], options: RunOptions): string {
	const ok = results.filter(result => result.status === "ok").length;
	const head = [
		`# rqw-web: ${results.length} target${results.length === 1 ? "" : "s"}, ${ok} ok, ${results.length - ok} failed`,
		`search model ${options.search.model}, effort ${options.search.effort}, mode ${options.mode}, response length ${options.responseLength}`,
		"",
		"## Targets",
		...indexSection(results),
		"",
		"## Results",
		...bodySection(results),
	];
	return splitLongLines(head.join("\n")) + "\n";
}
