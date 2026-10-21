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

/** Row 1: the full-width context bar. Percent of the compaction threshold, 100% at and above it. */
export function contextRow(context: BarState["context"], width: number, paint: Paint = plain): string {
	if (width <= 0) return "";
	if (!context || !(context.limit > 0)) return paint("barEmpty", "─".repeat(width));
	const known = context.tokens !== null;
	const percent = known ? Math.min(100, Math.max(0, ((context.tokens as number) / context.limit) * 100)) : 0;
	const label = known
		? ` ${Math.round(percent)}% ${formatK(context.tokens as number)}/${formatK(context.limit)}`
		: ` ?/${formatK(context.limit)}`;
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
	paint: Paint = plain, hint: (text: string) => string = (text) => text): string {
	if (width <= 0) return "";
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

/** Row 2: model and thinking level on the left (then other extensions' statuses), `cmp N · R tok/s` on the right. */
export function modelRow(state: BarState, width: number, paint: Paint = plain): string {
	const level = thinkingLabel(state.model, state.thinkingLevel);
	let left = ` ${paint("model", `${ICON.model} ${modelName(state.model)}${level ? ` ${level}` : ""}`)}`;
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

/** Row 3: the working place on the left, git on the right. */
export function placeRow(state: BarState, width: number, paint: Paint = plain): string {
	const left = ` ${paint("path", `${ICON[state.place.kind]} ${singleLine(state.place.text)}`)}`;
	return leftRight(left, gitText(state.git, paint), width);
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
