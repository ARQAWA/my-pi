// Interactive-only footer and editor borders (session ID on top, context bar at the bottom), the activity status on the
// top border and the session title above the input. All displayed session values are read through Pi's live context getters.
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, ExtensionUIContext, Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { actionPhrase, CountsWatch, statusText } from "./activity.ts";
import { branchNumber } from "./branch.ts";
import { type BorderSource, ContextEditor } from "./editor.ts";
import { findRepo, gitBranch, gitCounts, type RepoInfo } from "./git.ts";
import { type ActivityChrome, type BarState, type GitCounts, type Paint, placeOf, RateMeter, type Role, renderBar, titleRow } from "./render.ts";

const GIT_POLL_MS = 10_000;
const SHIMMER_MS = 120;
/** The title row above the input: one widget of this extension, removed when it is off. */
const TITLE_KEY = "rqw-statusbar-title";
// RQW-settings owns /fast-gpt. Its channels on pi.events are the only coupling; nobody answering means no lightning.
const FAST_GPT_QUERY = "rqw-settings:fast-gpt-query";
const FAST_GPT_CHANGED = "rqw-settings:fast-gpt";
const COLORS: Record<Role, ThemeColor> = {
	bar: "text", barEmpty: "dim", label: "muted", model: "text", path: "text",
	gitClean: "success", gitDirty: "warning", staged: "success", unstaged: "warning",
	untracked: "muted", sep: "dim", info: "muted",
};
const themePaint = (theme: Theme): Paint => (role, text) => theme.fg(COLORS[role], text);

function scratchRoots(): string[] {
	const roots = new Set([tmpdir(), join(homedir(), "tmp")]);
	if (process.platform === "win32") {
		const { TEMP, TMP, SystemRoot } = process.env;
		for (const root of [TEMP, TMP, SystemRoot && join(SystemRoot, "Temp")]) if (root) roots.add(root);
	} else {
		for (const root of ["/tmp", "/var/tmp"]) roots.add(root);
		if (process.platform === "darwin") for (const root of ["/private/tmp", "/private/var/tmp"]) roots.add(root);
	}
	return [...roots];
}

/** Use Pi's effective window and reserve, including a context extension's rule when installed. */
export function contextLimit(pi: Pick<ExtensionAPI, "getSettings">, ctx: Pick<ExtensionContext, "model">, window: number): number {
	const compaction = pi.getSettings().compaction;
	if (compaction?.enabled === false || !ctx.model) return window;
	const { reserveTokens } = SettingsManager.inMemory({ compaction }).getCompactionSettings(ctx.model);
	const limit = window - reserveTokens;
	return limit > 0 ? limit : window;
}

export default function statusbar(pi: ExtensionAPI) {
	let enabled = true;
	let active = false;
	let redraw: (() => void) | undefined;
	let refresh: (() => void) | undefined;
	let dispose: (() => void) | undefined;
	const rate = new RateMeter();
	let working = false;
	let unsubscribeFast: (() => void) | undefined;
	let frame = 0;
	let shimmer: ReturnType<typeof setInterval> | undefined;
	let lightCtx: ExtensionContext | undefined;
	// Activity mirrors of the main agent, its tools and the compaction; they follow public events whether or not the bar is up.
	let running = false;
	let compacting = false;
	const tools = new Map<string, string>();
	const jobs = new CountsWatch(pi.events, () => { syncShimmer(); redraw?.(); });
	let sessionName: string | undefined;
	// The branch number of the current leaf, derived from the public tree and kept for one leaf and entry count.
	let branchKey: unknown[] | undefined;
	let branchValue: number | undefined;
	/** The main chat's GPT Fast is on (asked from RQW-settings) and its model is GPT through openai-codex: the lightning shows. */
	const lit = (ctx: ExtensionContext | undefined): boolean => {
		if (ctx?.model?.provider !== "openai-codex") return false;
		const query: { fastGpt?: boolean } = {};
		pi.events.emit(FAST_GPT_QUERY, query);
		return query.fastGpt === true;
	};
	const chromeNow = (): ActivityChrome | undefined => {
		const status = statusText({ compacting, running, action: [...tools.values()].at(-1), counts: jobs.get() });
		return status && { text: status.text, compacting: status.compacting, frame };
	};
	const fastState = (ctx: ExtensionContext): BarState["fast"] => lit(ctx) ? { frame: working ? frame : undefined } : undefined;
	const stopShimmer = () => { if (shimmer) clearInterval(shimmer); shimmer = undefined; };
	/** The shimmer runs while the status letters or the working lightning need it, the footer is up; re-checked on every tick. */
	const wantsShimmer = () => active && (chromeNow() !== undefined || (working && lit(lightCtx)));
	const syncShimmer = () => {
		if (!wantsShimmer()) return stopShimmer();
		if (shimmer) return;
		shimmer = setInterval(() => { frame++; if (!wantsShimmer()) stopShimmer(); redraw?.(); }, SHIMMER_MS);
		shimmer.unref?.();
	};
	/** Read-only: the branch number of the leaf from the public tree, recomputed when the leaf or the entry count changes. */
	const branchOf = (ctx: ExtensionContext): number | undefined => {
		const manager = ctx.sessionManager;
		const key = [manager, manager.getSessionId(), manager.getLeafId(), manager.getEntryCount()];
		const previous = branchKey;
		if (!previous || key.some((value, i) => value !== previous[i])) {
			branchValue = branchNumber(manager.getTree(), manager.getLeafId(), manager.getEntries().map((entry) => entry.id));
			branchKey = key;
		}
		return branchValue;
	};
	// The context row is drawn as the bottom border of this extension's editor. One factory per extension instance
	// identifies our editor in `getEditorComponent()`; its border reads the current install's source.
	let border: BorderSource | undefined;
	const editorFactory: NonNullable<Parameters<ExtensionUIContext["setEditorComponent"]>[0]> =
		(tui, theme, keybindings) => new ContextEditor(tui, theme, keybindings, () => border);

	/** Drops what this extension holds for the session: the GPT Fast subscription, the counts, timers, footer and border source. */
	function release(): void {
		unsubscribeFast?.();
		unsubscribeFast = undefined;
		dispose?.();
		jobs.stop();
		stopShimmer();
		border = undefined;
		lightCtx = undefined;
	}

	/** The main chat's state, the session name and the branch, sampled from the live session through public getters. */
	function sample(ctx: ExtensionContext): void {
		rate.reset();
		sessionName = pi.getSessionName();
		branchKey = undefined;
		running = !ctx.isIdle();
		working = running;
		compacting = false;
		tools.clear();
	}

	/** The title row above the input. Best effort: a widget error or an absent setWidget never stops the footer or the stock restore. */
	const setTitle = (ctx: ExtensionContext, show: boolean): void => {
		try {
			ctx.ui.setWidget(TITLE_KEY, show ? () => ({ render: (width: number) => [titleRow(sessionName, width)], invalidate() {} }) : undefined,
				show ? { placement: "aboveEditor" } : undefined);
		} catch {
			// The title row is skipped; the footer and the editor are still installed or restored.
		}
	};

	function install(ctx: ExtensionContext): void {
		release();
		if (ctx.mode !== "tui" || !enabled) return;
		lightCtx = ctx;
		unsubscribeFast = pi.events.on(FAST_GPT_CHANGED, () => { syncShimmer(); redraw?.(); });
		jobs.start();
		setTitle(ctx, true);
		let cacheKey: unknown[] = [];
		let cached: Pick<BarState, "context" | "compactions"> = { compactions: 0 };
		const contextState = (): Pick<BarState, "context" | "compactions"> => {
			const model = ctx.model;
			const manager = ctx.sessionManager;
			const key = [manager, manager.getSessionId(), manager.getLeafId(), manager.getEntryCount(),
				model, model?.contextWindow, JSON.stringify(pi.getSettings().compaction)];
			if (key.length !== cacheKey.length || key.some((value, i) => value !== cacheKey[i])) {
				const usage = ctx.getContextUsage();
				cached = {
					compactions: manager.getEntries().filter((entry) => entry.type === "compaction").length,
					context: usage ? { tokens: usage.tokens, limit: contextLimit(pi, ctx, usage.contextWindow) } : undefined,
				};
				cacheKey = key;
			}
			return cached;
		};
		// The ID is read on every render; /new, resume, fork and /reload also reinstall through session_start.
		border = { context: () => contextState().context, sessionId: () => ctx.sessionManager.getSessionId(),
			paint: () => themePaint(ctx.ui.theme), activity: () => chromeNow() };
		// Another extension's editor is kept; the context row then stays in the footer.
		if (ctx.ui.getEditorComponent() === undefined) ctx.ui.setEditorComponent(editorFactory);
		ctx.ui.setFooter((tui, theme, footer) => {
			let disposed = false;
			let cwd: string | undefined;
			let repo: RepoInfo | undefined;
			let counts: GitCounts | undefined;
			let branch: string | null = null;
			let busy = false;
			let again = false;
			const roots = scratchRoots();
			const paint = themePaint(theme);
			active = true;
			redraw = () => tui.requestRender();
			syncShimmer();

			async function refreshGit(): Promise<void> {
				if (disposed) return;
				if (busy) { again = true; return; }
				busy = true;
				try {
					do {
						again = false;
						const targetCwd = ctx.cwd;
						const target = findRepo(targetCwd);
						const [nextCounts, nextBranch] = target
							? await Promise.all([gitCounts(target.root), gitBranch(target.root)])
							: [undefined, null] as const;
						if (!disposed && ctx.cwd === targetCwd) {
							cwd = targetCwd;
							repo = target;
							counts = nextCounts;
							branch = nextBranch;
						}
					} while (again && !disposed);
				} finally { busy = false; }
				if (!disposed) tui.requestRender();
			}
			refresh = () => { void refreshGit(); };
			const stopBranch = footer.onBranchChange(refresh);
			const poll = setInterval(refresh, GIT_POLL_MS);
			poll.unref?.();
			refresh();
			const cleanup = () => {
				if (disposed) return;
				disposed = true;
				clearInterval(poll);
				stopBranch();
				stopShimmer();
				active = false;
				rate.reset();
				redraw = undefined;
				refresh = undefined;
				if (dispose === cleanup) dispose = undefined;
			};
			dispose = cleanup;
			return {
				render(width: number) {
					if (disposed) return [];
					if (cwd !== ctx.cwd) {
						cwd = ctx.cwd;
						repo = findRepo(cwd);
						counts = undefined;
						branch = null;
						void refreshGit();
					}
					const rows = renderBar({
						model: ctx.model,
						thinkingLevel: pi.getThinkingLevel(),
						...contextState(),
						rate: rate.value(),
						fast: fastState(ctx),
						branch: branchOf(ctx),
						place: placeOf({ cwd: ctx.cwd, home: homedir(), scratchRoots: roots, worktree: repo?.worktree, branch }),
						git: repo && { branch, staged: 0, unstaged: 0, untracked: 0, ...counts },
						statuses: [...footer.getExtensionStatuses().entries()]
							.sort(([a], [b]) => a.localeCompare(b)).map(([, text]) => text),
					}, width, paint);
					return ctx.ui.getEditorComponent() === editorFactory ? rows.slice(1) : rows;
				},
				invalidate() {},
				dispose: cleanup,
			};
		});
	}

	pi.registerCommand("statusbar", {
		description: "Toggle the RQW status bar: /statusbar [on|off]",
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") return;
			const value = args.trim();
			if (value && value !== "on" && value !== "off") {
				ctx.ui.notify("Usage: /statusbar [on|off]", "warning");
				return;
			}
			enabled = value ? value === "on" : !enabled;
			if (enabled) {
				sample(ctx);
				install(ctx);
			} else {
				release();
				running = false;
				working = false;
				compacting = false;
				tools.clear();
				setTitle(ctx, false);
				ctx.ui.setFooter(undefined);
				if (ctx.ui.getEditorComponent() === editorFactory) ctx.ui.setEditorComponent(undefined);
			}
		},
	});

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		sample(ctx);
		install(ctx);
	});
	pi.on("session_shutdown", (_event, ctx) => {
		release();
		running = false;
		working = false;
		compacting = false;
		tools.clear();
		sessionName = undefined;
		branchKey = undefined;
		if (ctx.mode === "tui") setTitle(ctx, false);
	});
	pi.on("session_tree", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		rate.reset();
		branchKey = undefined;
		syncShimmer();
		redraw?.();
	});
	pi.on("session_info_changed", (event) => { sessionName = event.name; redraw?.(); });
	pi.on("model_select", () => { syncShimmer(); redraw?.(); });
	pi.on("agent_start", () => { working = true; running = true; frame = 0; syncShimmer(); redraw?.(); });
	pi.on("agent_end", () => { working = false; syncShimmer(); redraw?.(); });
	pi.on("agent_settled", () => { running = false; working = false; tools.clear(); syncShimmer(); redraw?.(); });
	pi.on("tool_execution_start", (event) => {
		tools.set(event.toolCallId, actionPhrase(event.toolName, event.args));
		syncShimmer();
		redraw?.();
	});
	pi.on("tool_execution_end", (event) => {
		tools.delete(event.toolCallId);
		syncShimmer();
		redraw?.();
		refresh?.();
	});
	pi.on("session_before_compact", () => { compacting = true; syncShimmer(); redraw?.(); });
	// Success, cancel, abort and error all end the compaction; a failure without a before-event ends it here too.
	pi.on("session_compact", () => { compacting = false; syncShimmer(); redraw?.(); });
	pi.on("session_compact_failed", () => { compacting = false; syncShimmer(); redraw?.(); });
	pi.on("thinking_level_select", () => redraw?.());
	pi.on("message_end", (event) => {
		if (!active || event.message.role !== "assistant") return;
		rate.record(event.message);
		redraw?.();
	});
	pi.on("agent_end", () => refresh?.());
}
