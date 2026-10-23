// The bar itself: pure functions from a fixed state to three terminal rows, the layout of the owner's omp status bar
// (omp with `statusLine` from `~/.omp/agent/config.yml` and the my-omp-harness `extensions/ui/status-bar.ts` rows):
//
//   ━━━━━━━──────────────────────────────── 3% 13.1k/450k      context: filled share, then percent and tokens/limit
//    <model> Sonnet 5.5 hi                       cmp 0 · 52.4 tok/s
//    <tree> my-pi/my-pi-statusbar                 <branch> rqw-statusbar *1 +1 ?1
//
// The context row is normally the editor's bottom border (`editorBorder`), the other two rows the footer.
//
// Evidence: notes/statusbar-omp.md. Colors intentionally use stock Pi semantic roles, without tuning.
import { stripVTControlCharacters } from "node:util";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

/** Nerd Font glyphs of omp's `nerd` symbol preset (`pi-tui/src/theme/symbols.ts`), the owner's `symbolPreset`. */
export const ICON = {
	model: "\uec19",
	folder: "\uf115",
	scratch: "\uf014",
	worktree: "\uf0e8",
	branch: "\uf126",
	throughput: "\uf0e4",
	/** Nerd Font bolt: one cell wide and coloured by ANSI, unlike U+26A1, which pi-tui measures as two cells even with VS15. */
	fast: "\uf0e7",
} as const;

export type Role =
	| "bar"
	| "barEmpty"
	| "label"
	| "model"
	| "path"
	| "gitClean"
	| "gitDirty"
	| "staged"
	| "unstaged"
	| "untracked"
	| "sep"
	| "info";
export type Paint = (role: Role, text: string) => string;
export const plain: Paint = (_role, text) => text;

/** Metadata must not create terminal rows or carry terminal commands. */
export function singleLine(text: string): string {
	return stripVTControlCharacters(text).replace(/[\r\n\t]/g, " ").replace(/[\x00-\x1f\x7f-\x9f]/g, "").replace(/ +/g, " ").trim();
}

export type PlaceKind = "folder" | "scratch" | "worktree";

export interface BarState {
	/** The sibling number N of the branch the leaf is on (`⑂ fork #N`); undefined on the original first branch. */
	branch?: number;
	/** The session model; undefined shows "no-model", as omp. */
	model?: { id: string; name?: string; reasoning?: boolean };
	thinkingLevel?: string;
	/** Context tokens (null: unknown after a compaction) against the compaction threshold. */
	context?: { tokens: number | null; limit: number };
	compactions: number;
	/** Output tokens per second of the latest assistant message. */
	rate?: number;
	place: { kind: PlaceKind; text: string };
	/** Undefined outside a git repository. */
	git?: GitCounts & { branch: string | null };
	/** GPT Fast of the main chat: the lightning right after the model name, before the thinking level. `frame` is the shimmer step while the agent works, undefined when idle. */
	fast?: { frame?: number };
	/** Texts other extensions set with `ctx.ui.setStatus`, in key order. */
	statuses: string[];
}

/** omp-harness `fmtK`: 13.1k, 450k, 1.2M. */
export function formatK(n: number): string {
	const [value, unit] = n >= 1e6 ? [n / 1e6, "M"] : [n / 1e3, "k"];
	const s = value.toFixed(1);
	return `${s.endsWith(".0") ? s.slice(0, -2) : s}${unit}`;
}

// The harness shortens omp's level words; omp's `off` (or between-tools) reads "no".
const SHORT_LEVEL: Record<string, string> = {
	off: "no",
	minimal: "min",
	low: "lo",
	medium: "md",
	high: "hi",
	xhigh: "xh",
	max: "mx",
};

/** Model name as omp shows it: `name` or `id`, without the "Claude " prefix. */
export function modelName(model: BarState["model"]): string {
	if (!model) return "no-model";
	const name = singleLine(model.name || model.id || "no-model");
	return name.startsWith("Claude ") ? name.slice(7) : name;
}

/** The thinking label after the name, or "" for a model without reasoning. */
export function thinkingLabel(model: BarState["model"], level: string | undefined): string {
	if (!model?.reasoning) return "";
	const key = level ?? "off";
	return SHORT_LEVEL[key] ?? singleLine(key);
}

/** A styled line cut to width with a trailing "…" (harness `fitLine`). */
export function fit(line: string, width: number): string {
	if (width <= 0) return "";
	if (visibleWidth(line) <= width) return line;
	return truncateToWidth(line, width, "…");
}

/**
 * Own plain chrome cut to width: the escape codes that Pi's cut may add are removed after the cut, so the text is plain
 * cells that can be repainted per code point.
 */
export function fitPlain(text: string, width: number): string {
	if (width <= 0) return "";
	const cut = visibleWidth(text) <= width ? text : truncateToWidth(text, width, "…");
	return stripVTControlCharacters(cut);
}

/** Left part at the start, right part flush with the edge; the left part gives way first (harness `rowLeftRight`). */
export function leftRight(left: string, right: string, width: number): string {
	if (!left && !right) return "";
	if (!right) return fit(left, width);
	const rw = visibleWidth(right);
	if (!left) return " ".repeat(Math.max(0, width - rw)) + fit(right, width);
	const lw = visibleWidth(left);
	if (lw + rw <= width) return left + " ".repeat(width - lw - rw) + right;
	const room = width - rw - 1;
	if (room <= 0) return fit(right, width);
	const cut = fit(left, room);
	return cut + " ".repeat(Math.max(0, width - visibleWidth(cut) - rw)) + right;
}

/** The context label after the bar: percent and tokens against the limit, `?/limit` while the tokens are unknown. */
export function contextLabel(context: NonNullable<BarState["context"]>): string {
	const known = context.tokens !== null;
	const percent = known ? Math.min(100, Math.max(0, ((context.tokens as number) / context.limit) * 100)) : 0;
	return known
		? ` ${Math.round(percent)}% ${formatK(context.tokens as number)}/${formatK(context.limit)}`
		: ` ?/${formatK(context.limit)}`;
}

/** Row 1: the full-width context bar. Percent of the compaction threshold, 100% at and above it. */
export function contextRow(context: BarState["context"], width: number, paint: Paint = plain): string {
	if (width <= 0) return "";
	if (!context || !(context.limit > 0)) return paint("barEmpty", "─".repeat(width));
	const known = context.tokens !== null;
	const percent = known ? Math.min(100, Math.max(0, ((context.tokens as number) / context.limit) * 100)) : 0;
	const label = contextLabel(context);
	const barWidth = Math.max(0, width - visibleWidth(label));
	const filled = Math.round((barWidth * percent) / 100);
	const line =
		(filled > 0 ? paint("bar", "━".repeat(filled)) : "") +
		(barWidth - filled > 0 ? paint("barEmpty", "─".repeat(barWidth - filled)) : "") +
		paint("label", label);
	return fit(line, width);
}

/**
 * The context row as the editor's bottom border. With input lines hidden below, the editor's own `↓ N more` hint
 * (in `hint` color) comes first and the context row takes the rest; a width too narrow for both keeps the hint.
 */
export function editorBorder(context: BarState["context"], hiddenLineCount: number, width: number,
	paint: Paint = plain, hint: (text: string) => string = (text) => text, sheen?: number): string {
	if (width <= 0) return "";
	// Compaction: the whole row is the metallic gold, the hint included (see sheenRow).
	if (sheen !== undefined) return sheenRow(context, width, sheen, hiddenLineCount);
	if (!(hiddenLineCount > 0)) return contextRow(context, width, paint);
	const text = `↓ ${hiddenLineCount} more `;
	const rest = width - visibleWidth(text);
	if (rest <= 0) return fit(hint(text), width);
	return hint(text) + contextRow(context, rest, paint);
}

/** The text of a border row without its rules: what must survive when the border gives room to the session ID. */
const borderText = (line: string) => stripVTControlCharacters(line).replace(/─/g, " ").replace(/ +/g, " ").trim();

/**
 * The editor's top border with the session ID at its right end: `── <working…> ──── <session-id> ──`.
 * `stock(width)` is Pi's own top border (the embedded working status and the up-arrow `N more` hint); it is drawn at
 * the reduced width and must keep exactly the same text and end in at least two rule cells, otherwise the ID is
 * dropped and Pi's border at the full width is returned. The ID is never cut and has one plain space on each side.
 */
export function sessionTopBorder(width: number, sessionId: string | undefined, stock: (width: number) => string,
	border: (text: string) => string = (text) => text, paint: Paint = plain): string {
	const full = stock(width);
	const id = singleLine(sessionId ?? "");
	if (!id || id.includes(" ")) return full;
	const rest = width - visibleWidth(id) - 4;
	if (rest < 2) return full;
	const left = stock(rest);
	if (visibleWidth(left) !== rest || !stripVTControlCharacters(left).endsWith("──") || borderText(left) !== borderText(full)) {
		return full;
	}
	return left + border(" ") + paint("label", id) + border(" ──");
}

/** Bright yellow, a paler yellow, white and back: SGR foreground colours of one shimmer cycle. */
export const SHIMMER = ["38;5;220", "38;5;226", "38;5;229", "97", "38;5;229", "38;5;226"] as const;
/** Static bright yellow for the idle lightning. */
export const FAST_YELLOW = "93";

/** The GPT Fast lightning. Own colours, not a theme role: the owner asked for a bright yellow whatever the theme. */
export function fastMark(frame: number | undefined): string {
	const color = frame === undefined ? FAST_YELLOW : SHIMMER[((Math.trunc(frame) % SHIMMER.length) + SHIMMER.length) % SHIMMER.length];
	return `\x1b[1;${color}m${ICON.fast}\x1b[22;39m`;
}

/** Effort colours of the footer: low plain, medium bold green, high bold gold, xhigh bold bright purple, max bold red. */
const EFFORT: Record<string, (text: string) => string> = {
	medium: (text) => `\x1b[1;32m${text}\x1b[22;39m`,
	high: (text) => `\x1b[1;38;2;201;162;39m${text}\x1b[22;39m`,
	xhigh: (text) => `\x1b[1;95m${text}\x1b[22;39m`,
	max: (text) => `\x1b[1;91m${text}\x1b[22;39m`,
};

/** The thinking label in its effort colour; levels without one keep the model colour. */
export function effortText(level: string | undefined, label: string, paint: Paint): string {
	const style = level ? EFFORT[level] : undefined;
	return style ? style(label) : paint("model", label);
}

/** Row 2: model and thinking level on the left (then other extensions' statuses), `cmp N · R tok/s` on the right. */
export function modelRow(state: BarState, width: number, paint: Paint = plain): string {
	const level = thinkingLabel(state.model, state.thinkingLevel);
	const shownLevel = level ? ` ${effortText(state.thinkingLevel ?? "off", level, paint)}` : "";
	// GPT Fast: the lightning sits right after the model name, before the thinking level; the model icon stays in front.
	const name = `${ICON.model} ${modelName(state.model)}`;
	let left = state.fast
		? ` ${paint("model", name)} ${fastMark(state.fast.frame)}${shownLevel}`
		: ` ${paint("model", name)}${shownLevel}`;
	const dot = ` ${paint("sep", "·")} `;
	const statuses = state.statuses.map(singleLine).filter(Boolean);
	if (statuses.length > 0) left += dot + statuses.join(dot);
	const right = [paint("label", `cmp ${state.compactions}`)];
	if (state.rate !== undefined && Number.isFinite(state.rate) && state.rate > 0) {
		right.push(paint("info", `${ICON.throughput}${state.rate.toFixed(1)} tok/s`));
	}
	return leftRight(left, right.join(dot), width);
}

/** The git part: branch and the counts of unstaged `*`, staged `+` and untracked `?` files. */
export function gitText(git: BarState["git"], paint: Paint = plain): string {
	if (!git) return "";
	const dirty = git.staged + git.unstaged + git.untracked > 0;
	const marks: string[] = [];
	if (git.unstaged > 0) marks.push(paint("unstaged", `*${git.unstaged}`));
	if (git.staged > 0) marks.push(paint("staged", `+${git.staged}`));
	if (git.untracked > 0) marks.push(paint("untracked", `?${git.untracked}`));
	if (!git.branch && marks.length === 0) return "";
	const head = git.branch ? `${ICON.branch} ${singleLine(git.branch)}` : "";
	return paint(dirty ? "gitDirty" : "gitClean", head) + (marks.length > 0 ? `${head ? " " : ""}${marks.join(" ")}` : "");
}

/**
 * Row 3: the working place on the left, git on the right. Off the original branch the `⑂ fork #N` mark follows the folder
 * after two spaces; it is dropped whole, before the folder is cut, when folder, mark and git do not fit together.
 */
export function placeRow(state: BarState, width: number, paint: Paint = plain): string {
	const folder = ` ${paint("path", `${ICON[state.place.kind]} ${singleLine(state.place.text)}`)}`;
	const git = gitText(state.git, paint);
	const withMark = state.branch === undefined ? undefined : `${folder}  ${paint("label", `⑂ fork #${state.branch}`)}`;
	const fits = withMark !== undefined && visibleWidth(withMark) + (git ? 1 + visibleWidth(git) : 0) <= width;
	return leftRight(fits ? (withMark as string) : folder, git, width);
}

/** The three rows of the bar at this width. */
export function renderBar(state: BarState, width: number, paint: Paint = plain): string[] {
	return [contextRow(state.context, width, paint), modelRow(state, width, paint), placeRow(state, width, paint)];
}

// ---- The place: omp's `path` segment (`pi-tui/src/status-line/segments.ts`), on plain strings so a Windows path
// is handled the same on every OS.

const MAX_PLACE = 40;

const isWindowsStyle = (p: string) => /^[A-Za-z]:[\\/]/.test(p) || p.startsWith("\\\\") || p.startsWith("//");

function comparable(p: string): string {
	let s = p.replace(/\\/g, "/");
	if (s.length > 1 && s.endsWith("/") && !/^[A-Za-z]:\/$/.test(s)) s = s.replace(/\/+$/, "");
	return isWindowsStyle(p) ? s.toLowerCase() : s;
}

/** The part of `p` below `root` ("" for root itself, null outside); case-insensitive for Windows paths. */
export function within(root: string, p: string): string | null {
	const r = comparable(root);
	const full = p.replace(/\\/g, "/").replace(/(.)\/+$/, "$1");
	const c = comparable(p);
	if (c === r) return "";
	const prefix = r.endsWith("/") ? r : `${r}/`;
	return c.startsWith(prefix) ? full.slice(prefix.length) : null;
}

/** Home as "~" with forward slashes; other paths as they are (omp `shortenPath`). */
export function shortenHome(p: string, home: string): string {
	const rest = within(home, p);
	return rest === null ? p : rest === "" ? "~" : `~/${rest}`;
}

/** Left-cut to 40 characters with a leading "…". */
export function clampPlace(text: string, max = MAX_PLACE): string {
	const chars = Array.from(singleLine(text));
	return chars.length <= max ? chars.join("") : `…${chars.slice(-(max - 1)).join("")}`;
}

export interface PlaceInput {
	cwd: string;
	home: string;
	/** Scratch roots (temp directories); a cwd below one shows the scratch icon and the path below it. */
	scratchRoots: string[];
	/** A linked git worktree: the main repository's folder name and the worktree folder name. */
	worktree?: { project: string; name: string };
	branch?: string | null;
}

/** The place text and icon, as omp's path segment with its default options. */
export function placeOf(input: PlaceInput): BarState["place"] {
	const { cwd, home, worktree } = input;
	if (worktree) {
		const label = input.branch === worktree.name ? worktree.project : `${worktree.project}/${worktree.name}`;
		return { kind: "worktree", text: clampPlace(label) };
	}
	for (const root of input.scratchRoots) {
		const rest = within(root, cwd);
		if (rest !== null) return { kind: "scratch", text: clampPlace(shortenHome(rest || cwd, home)) };
	}
	let shown = cwd;
	for (const root of [`${home}/Projects`, `${home}/repos`, "/work"]) {
		const rest = within(root, cwd);
		if (rest) {
			shown = rest;
			break;
		}
	}
	return { kind: "folder", text: clampPlace(shortenHome(shown, home)) };
}

// ---- Git status counts from `git status --porcelain=v1 -z`.

export interface GitCounts {
	staged: number;
	unstaged: number;
	untracked: number;
}

export function parsePorcelain(out: string): GitCounts {
	const counts: GitCounts = { staged: 0, unstaged: 0, untracked: 0 };
	const records = out.split("\0");
	for (let i = 0; i < records.length; i++) {
		const rec = records[i];
		if (rec.length < 3) continue;
		const x = rec[0];
		const y = rec[1];
		if (x === "?" && y === "?") {
			counts.untracked++;
			continue;
		}
		if (x === "!") continue;
		if (x !== " ") counts.staged++;
		if (y !== " ") counts.unstaged++;
		// A rename or copy carries its source path as the next record.
		if (x === "R" || x === "C" || y === "R" || y === "C") i++;
	}
	return counts;
}

// ---- Tokens per second.

/** Responses shorter than this are not measured: their timing noise dominates the rate. */
export const MIN_RATE_MS = 500;

/**
 * The rate of the latest qualified assistant response: the provider's output tokens (`usage.output`, which already
 * includes reasoning tokens) over Pi's monotonic `durationMs` of that response. A response without both numbers,
 * shorter than `MIN_RATE_MS`, or ended by an abort or an error (its output count may be incomplete), is skipped. The value is held until the next qualified response and until `reset`.
 */
export class RateMeter {
	private last: number | undefined;

	record(message: { usage?: { output?: number }; durationMs?: number; stopReason?: string }): void {
		if (message.stopReason === "aborted" || message.stopReason === "error") return;
		const tokens = message.usage?.output;
		const ms = message.durationMs;
		if (typeof tokens !== "number" || typeof ms !== "number") return;
		if (!Number.isFinite(tokens) || !Number.isFinite(ms) || tokens <= 0 || ms < MIN_RATE_MS) return;
		this.last = (tokens * 1000) / ms;
	}

	reset(): void {
		this.last = undefined;
	}

	value(): number | undefined {
		return this.last;
	}
}

// ---- Activity: silver busy letters, gold compaction letters and chrome, the static gold session title.

/** Gold of the compaction status: the source stops (not the browser calibration), then the sheen and the edge. */
export const GOLD: readonly string[] = ["#8a6d1c", "#c9a227", "#e3c45a"];
export const GOLD_SHEEN = "#f2de8a";
export const GOLD_EDGE = "#d9b84a";
/** Silver of the ordinary busy letters: dim, muted, then the foreground. */
export const SILVER: readonly string[] = ["#5f5e5c", "#8d8d8c", "#e5efff"];
/** The ordinary top rule: a fixed silver, independent of the editor's thinking colour. */
export const RULE_SILVER = "#b6b6b4";

const rgbOf = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** The colour at `t` (0..1) along the stops. */
export function mix(stops: readonly string[], t: number): string {
	const x = Math.min(1, Math.max(0, t)) * (stops.length - 1);
	const i = Math.min(stops.length - 2, Math.floor(x));
	const u = x - i;
	const a = rgbOf(stops[i]);
	const b = rgbOf(stops[i + 1]);
	return `#${a.map((c, k) => Math.round(c + (b[k] - c) * u).toString(16).padStart(2, "0")).join("")}`;
}

const styled = (hex: string, bold: boolean, text: string) =>
	`\x1b[${bold ? "1;" : ""}38;2;${rgbOf(hex).join(";")}m${text}\x1b[22;39m`;

/** The shimmer phase of letter or global column `index` at `frame`: f = (.5 + .5 cos(i*.32 - frame*.22))**2. */
export function shimmerPhase(index: number, frame: number): number {
	return (0.5 + 0.5 * Math.cos(index * 0.32 - frame * 0.22)) ** 2;
}

/** Status letters by their global column: colour by phase along the stops, bold on the crest (phase above .85); spaces stay plain. */
export function shimmerText(text: string, startColumn: number, frame: number, stops: readonly string[]): string {
	return Array.from(stripVTControlCharacters(text)).map((ch, i) => {
		if (ch === " ") return ch;
		const f = shimmerPhase(startColumn + i, frame);
		return styled(mix(stops, f), f > 0.85, ch);
	}).join("");
}

/** The metallic at a whole frame: the run starts at cell `frame` (mod width). */
function metallicCell(x: number, width: number, frame: number): string {
	const d = (((x - frame) % width) + width) % width;
	if (d < 6) return GOLD_SHEEN;
	if (d === 6 || d === width - 1) return GOLD_EDGE;
	return mix(GOLD, width > 1 ? x / (width - 1) : 0.5);
}

/**
 * The compaction metallic at global column `x` of a `width`-cell row: a sheen run of six cells, the edge cell after it
 * and the last cell, and the gold gradient across the full width everywhere else. The run moves one cell per whole
 * frame; between whole frames each cell blends linearly into its colour of the next frame, so the run glides.
 */
export function metallicColor(x: number, width: number, frame: number): string {
	const base = Math.floor(frame);
	const a = metallicCell(x, width, base);
	const u = frame - base;
	if (u === 0) return a;
	const b = metallicCell(x, width, base + 1);
	return a === b ? a : mix([a, b], u);
}

/** Compaction chrome text from global column `startColumn` of a `width`-cell row: every cell bold in its metallic colour. */
export function metallicText(text: string, width: number, frame: number, startColumn = 0): string {
	if (width <= 0) return "";
	let x = startColumn;
	let out = "";
	for (const ch of Array.from(stripVTControlCharacters(text))) {
		out += styled(metallicColor(x, width, frame), true, ch);
		x += visibleWidth(ch);
	}
	return out;
}

/**
 * The context row during compaction: the whole row in the metallic gold, the `↓ N more` hint first when lines are hidden,
 * then a full meter (busy, not measured progress) with the label. Unknown tokens keep the full meter too.
 */
export function sheenRow(context: BarState["context"], width: number, frame: number, hiddenLineCount = 0): string {
	if (width <= 0) return "";
	const hint = hiddenLineCount > 0 ? `↓ ${hiddenLineCount} more ` : "";
	const hintWidth = visibleWidth(hint);
	if (hintWidth >= width) return metallicText(fitPlain(hint, width), width, frame);
	const rest = width - hintWidth;
	const label = context && context.limit > 0 ? fitPlain(contextLabel(context), rest) : "";
	return metallicText(hint + "━".repeat(rest - visibleWidth(label)) + label, width, frame);
}

/** The session title above the input: static bold gold over the fitted title's own code points; empty until named. */
export function titleRow(name: string | undefined, width: number): string {
	const text = singleLine(name ?? "");
	if (!text || width <= 0) return "";
	const points = Array.from(fitPlain(text, width));
	return points.map((ch, i) => styled(mix(GOLD, points.length > 1 ? i / (points.length - 1) : 0.5), true, ch)).join("");
}

/** What the top border shows of the activity: the status text and whether it is the compaction. */
export interface ActivityChrome {
	text: string;
	compacting: boolean;
	/** The phase in frames, fractional: elapsed time over the frame length, not a tick count. */
	frame: number;
}

/** A run of the top border: a rule, the hint, the status letters or the session ID. */
interface TopSegment {
	text: string;
	kind: "rule" | "hint" | "status" | "id";
}

const rule = (text: string): TopSegment => ({ text, kind: "rule" });

/**
 * The left part of the top border in `width` cells: the status after `── ` and the hint centred the way Pi centres it.
 * `whole` is false when the status or the hint had to be cut; the session ID is then dropped, never the status cut for it.
 */
function topHead(width: number, hiddenLineCount: number, chrome: ActivityChrome | undefined):
	{ segments: TopSegment[]; whole: boolean } {
	if (width <= 0) return { segments: [], whole: true };
	const hint = hiddenLineCount > 0 ? ` ↑ ${hiddenLineCount} more ` : "";
	const hintWidth = visibleWidth(hint);
	if (hint && hintWidth + 2 > width) {
		// Too narrow to centre: Pi's narrow form of the hint, cut to the width.
		const indicator = stripVTControlCharacters(truncateToWidth(`─── ↑ ${hiddenLineCount} more `, width, ""));
		return { segments: [{ text: indicator, kind: "hint" }, rule("─".repeat(width - visibleWidth(indicator)))], whole: false };
	}
	const cells = hint ? Math.floor((width - hintWidth) / 2) : width;
	const after: TopSegment[] = hint ? [{ text: hint, kind: "hint" }, rule("─".repeat(width - cells - hintWidth))] : [];
	if (!chrome) return { segments: [rule("─".repeat(cells)), ...after], whole: true };
	// Without a hint the status keeps two rule cells at its right end; before a hint it keeps one space.
	const room = hint ? cells - 4 : width - 6;
	if (room < 1) return { segments: [rule("─".repeat(cells)), ...after], whole: false };
	const text = fitPlain(chrome.text, room);
	const lw = visibleWidth(text);
	return {
		segments: [rule("── "), { text, kind: "status" }, rule(` ${"─".repeat(cells - 4 - lw)}`), ...after],
		whole: text === chrome.text,
	};
}

/** Paints the segments in global columns: ordinary rules silver, status letters shimmer silver, the ID muted; compaction all metallic. */
function paintTop(segments: TopSegment[], width: number, chrome: ActivityChrome | undefined, paint: Paint): string {
	let x = 0;
	let out = "";
	for (const segment of segments) {
		if (segment.text) {
			if (segment.kind === "status" && chrome) out += shimmerText(segment.text, x, chrome.frame, chrome.compacting ? GOLD : SILVER);
			else if (chrome?.compacting) out += metallicText(segment.text, width, chrome.frame, x);
			else if (segment.kind === "id") out += paint("label", segment.text);
			else out += styled(RULE_SILVER, false, segment.text);
		}
		x += visibleWidth(segment.text);
	}
	return out;
}

/**
 * The editor's top border in `width` cells: the rule with Pi's hint when lines are hidden above, the activity status after
 * `── ` and the session ID whole at the right end. The ID is shown only when the whole status and hint fit beside it.
 */
export function topBorder(width: number, sessionId: string | undefined, chrome: ActivityChrome | undefined,
	hiddenLineCount = 0, paint: Paint = plain): string {
	if (width <= 0) return "";
	const id = singleLine(sessionId ?? "");
	const rest = width - visibleWidth(id) - 4;
	if (id && !id.includes(" ") && rest >= 2) {
		const head = topHead(rest, hiddenLineCount, chrome);
		if (head.whole) return paintTop([...head.segments, rule(" "), { text: id, kind: "id" }, rule(" ──")], width, chrome, paint);
	}
	return paintTop(topHead(width, hiddenLineCount, chrome).segments, width, chrome, paint);
}
