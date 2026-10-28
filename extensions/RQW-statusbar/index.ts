// Interactive footer and editor borders: title and session ID on top, context bar at the bottom.
// Activity is a separate widget; our editor hides Pi's native working row. Session values use public getters.
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, ExtensionUIContext, Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { actionPhrase, CountsWatch, statusText } from "./activity.ts";
import { QuotaConsumer } from "./quota.ts";
import { type BorderSource, ContextEditor } from "./editor.ts";
import { findRepo, gitBranch, gitCounts, type RepoInfo } from "./git.ts";
import { type ActivityChrome, type BarState, type GitCounts, type Paint, placeOf, RateMeter, type Role, renderBar, modelRow, activityRows } from "./render.ts";

const GIT_POLL_MS = 10_000;
/** Thirty nominal redraws per second; travel follows elapsed time independently of this timer. */
const SHIMMER_MS = 1000 / 30;
/** Elapsed-time phase unit, independent of the redraw timer. */
export const STATUS_FRAME_MS = 80;
/** The lightning keeps its owner-accepted pulse of one colour step per 120 ms of elapsed time. */
const FAST_STEP_MS = 120;
/** Monotonic milliseconds; the animation phase is read from it at render time, not counted per timer tick. */
const now = () => performance.now();
/** Activity only; the session title belongs to the editor's top border. */
const ACTIVITY_KEY = "rqw-statusbar-activity";
// RQW-settings owns /fast-gpt. Its channels on pi.events are the only coupling; nobody answering means no lightning.
const FAST_GPT_QUERY = "rqw-settings:fast-gpt-query";
const FAST_GPT_CHANGED = "rqw-settings:fast-gpt";
type SessionManager = ExtensionContext["sessionManager"] & { getEntryCount(): number };
const COLORS: Record<Exclude<Role, "effort">, ThemeColor> = {
	bar: "text", barEmpty: "dim", label: "muted", model: "text", path: "text",
	gitClean: "success", gitDirty: "warning", staged: "success", unstaged: "warning",
	untracked: "muted", sep: "dim", info: "muted",
};
export const themePaint = (theme: Theme): Paint => (role, text, level) => role === "effort"
	? theme.getThinkingBorderColor((level ?? "off") as Parameters<Theme["getThinkingBorderColor"]>[0])(text)
	: theme.fg(COLORS[role], text);

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
	let resample: (() => void) | undefined;
	let dispose: (() => void) | undefined;
	let installRevision = 0;
	const rate = new RateMeter();
	let working = false;
	let unsubscribeFast: (() => void) | undefined;
	let animationStart = now();
	let shimmer: ReturnType<typeof setInterval> | undefined;
	let lightCtx: ExtensionContext | undefined;
	// Activity mirrors of the main agent, its tools and the compaction; they follow public events whether or not the bar is up.
	let running = false;
	let compacting = false;
	const tools = new Map<string, string>();
	const jobs = new CountsWatch(pi.events, () => { syncShimmer(); redraw?.(); });
	let sessionName: string | undefined;
	/** The main chat's GPT Fast is on (asked from RQW-settings) and its model is GPT through openai-codex: the lightning shows. */
	const lit = (ctx: ExtensionContext | undefined): boolean => {
		if (ctx?.model?.provider !== "openai-codex") return false;
		const query: { fastGpt?: boolean } = {};
		pi.events.emit(FAST_GPT_QUERY, query);
		return query.fastGpt === true;
	};
	let status: ReturnType<typeof statusText>;
	let lightning = false;
	/** The phase moves in shimmer ticks, the pace of the redraw timer, so renders within one tick are identical. */
	const chromeNow = (): ActivityChrome | undefined =>
		status && { text: status.text, compacting: status.compacting, frame: Math.floor((now() - animationStart) / SHIMMER_MS) * SHIMMER_MS / STATUS_FRAME_MS };
	const fastState = (): BarState["fast"] =>
		lightning ? { frame: working ? Math.floor((now() - animationStart) / FAST_STEP_MS) : undefined } : undefined;
	const stopShimmer = () => { if (shimmer) clearInterval(shimmer); shimmer = undefined; };
	/** The shimmer timer only asks for redraws while the status letters or the working lightning need it and the footer is up;
	 * re-checked on every tick. The phase comes from the elapsed time at render, so Pi's other redraws show it too. */
	const wantsShimmer = () => active && (status !== undefined || (working && lightning));
	const syncShimmer = () => {
		status = statusText({ compacting, running, action: [...tools.values()].at(-1), counts: jobs.get() });
		lightning = lit(lightCtx);
		syncSpinner();
		if (!wantsShimmer()) return stopShimmer();
		if (shimmer) return;
		shimmer = setInterval(() => { syncSpinner(); if (!wantsShimmer()) stopShimmer(); redraw?.(); }, SHIMMER_MS);
		shimmer.unref?.();
	};
	// The context row is drawn as the bottom border of this extension's editor. One factory per extension instance
	// identifies our editor in `getEditorComponent()`; its border reads the current install's source.
	let border: BorderSource | undefined;
	const editorFactory: NonNullable<Parameters<ExtensionUIContext["setEditorComponent"]>[0]> =
		(tui, theme, keybindings) => new ContextEditor(tui, theme, keybindings, () => border);

	// Hide Pi's spinner only while our editor owns the border; restore it for other editors and on release.
	let spinnerUi: ExtensionUIContext | undefined;
	const showNativeSpinner = (): void => {
		const ui = spinnerUi;
		spinnerUi = undefined;
		try { ui?.setWorkingIndicator(undefined); } catch {}
	};
	const syncSpinner = (): void => {
		const ctx = lightCtx;
		if (!ctx) return;
		try {
			const ours = ctx.ui.getEditorComponent() === editorFactory;
			if (ours && !spinnerUi) {
				ctx.ui.setWorkingIndicator({ frames: [] });
				spinnerUi = ctx.ui;
			} else if (!ours && spinnerUi) showNativeSpinner();
		} catch {}
	};

	/** Drops what this extension holds for the session: the GPT Fast subscription, the counts, timers, footer and border source. */
	function release(): void {
		installRevision++;
		showNativeSpinner();
		unsubscribeFast?.();
		unsubscribeFast = undefined;
		dispose?.();
		resample = undefined;
		jobs.stop();
		stopShimmer();
		border = undefined;
		lightCtx = undefined;
	}

	/** The main chat's state and session name, sampled from the live session through public getters. */
	function sample(ctx: ExtensionContext): void {
		rate.reset();
		sessionName = pi.getSessionName();
		running = !ctx.isIdle();
		working = running;
		compacting = false;
		tools.clear();
	}

	/** Pi supplies one leading spacer. The active widget adds the status and one trailing empty line, idle adds nothing. */
	const activityWidget = () => {
		let last: { width: number; chrome: ActivityChrome; rows: string[] } | undefined;
		return {
			render(width: number): string[] {
				const chrome = chromeNow();
				if (!chrome) return [];
				if (!last || last.width !== width || last.chrome.text !== chrome.text || last.chrome.compacting !== chrome.compacting || last.chrome.frame !== chrome.frame)
					last = { width, chrome, rows: activityRows(width, chrome) };
				return last.rows;
			},
			invalidate() {},
		};
	};
	const setActivity = (ctx: ExtensionContext, show: boolean): void => {
		try {
			ctx.ui.setWidget(ACTIVITY_KEY, show ? activityWidget : undefined,
				show ? { placement: "aboveEditor" } : undefined);
		} catch {
			// A widget error must not prevent the footer/editor install or stock restore.
		}
	};

	async function install(ctx: ExtensionContext): Promise<void> {
		release();
		if (ctx.mode !== "tui" || !enabled) return;
		const revision = installRevision;
		let initialCwd = ctx.cwd;
		let initialRepo = await findRepo(initialCwd);
		while (revision === installRevision && initialCwd !== ctx.cwd) {
			initialCwd = ctx.cwd;
			initialRepo = await findRepo(initialCwd);
		}
		if (revision !== installRevision) return;
		lightCtx = ctx;
		unsubscribeFast = pi.events.on(FAST_GPT_CHANGED, () => { syncShimmer(); redraw?.(); });
		jobs.start();
		setActivity(ctx, true);
		// Pi has no event for settings changes and hands out a full copy on every read: sample the compaction settings
		// here and again at the turn and model events instead of on every frame.
		let compaction = pi.getSettings().compaction;
		resample = () => { compaction = pi.getSettings().compaction; };
		let cacheKey: unknown[] = [];
		let cached: Pick<BarState, "context" | "compactions"> = { compactions: 0 };
		const contextState = (): Pick<BarState, "context" | "compactions"> => {
			const model = ctx.model;
			const manager = ctx.sessionManager as SessionManager;
			const key = [manager, manager.getSessionId(), manager.getLeafId(), manager.getEntryCount(),
				model, model?.contextWindow, compaction?.enabled, compaction?.reserveTokens, compaction?.keepRecentTokens];
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
		let borderTheme = ctx.ui.theme;
		let borderPaint = themePaint(borderTheme);
		border = { context: () => contextState().context, sessionId: () => ctx.sessionManager.getSessionId(),
			sessionName: () => sessionName, paint: () => {
				if (borderTheme !== ctx.ui.theme) { borderTheme = ctx.ui.theme; borderPaint = themePaint(borderTheme); }
				return borderPaint;
			}, activity: () => chromeNow() };
		// Another extension's editor is kept; the context row then stays in the footer.
		if (ctx.ui.getEditorComponent() === undefined) ctx.ui.setEditorComponent(editorFactory);
		ctx.ui.setFooter((tui, theme, footer) => {
			let disposed = false;
			let cwd: string | undefined = initialCwd;
			let repo: RepoInfo | undefined = initialRepo;
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
						const target = await findRepo(targetCwd);
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
			const quotas = new QuotaConsumer(pi.events, ctx.sessionManager.getSessionId(), () => tui.requestRender());
			let lastKey: unknown[] = [];
			let lastStatuses = new Map<string, string>();
			let cachedRows: string[] = [];
			let cachedState: BarState | undefined;
			let lastFastFrame: number | undefined;
			quotas.start();
			const cleanup = () => {
				if (disposed) return;
				disposed = true;
				clearInterval(poll);
				quotas.stop();
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
						repo = undefined;
						counts = undefined;
						branch = null;
						queueMicrotask(() => { void refreshGit(); });
					}
					const context = contextState();
					const fast = fastState();
					const statuses = footer.getExtensionStatuses();
					let statusChanged = statuses.size !== lastStatuses.size;
					if (!statusChanged) for (const [name, text] of statuses) if (lastStatuses.get(name) !== text) { statusChanged = true; break; }
					const key = [width, quotas.values.CX, quotas.values.KM, quotas.values.CC, ctx.model, pi.getThinkingLevel(), context, rate.value(), ctx.cwd,
						repo?.root, repo?.worktree?.project, repo?.worktree?.name, counts?.staged, counts?.unstaged, counts?.untracked, branch, !!fast];
					if (statusChanged || key.length !== lastKey.length || key.some((value, i) => value !== lastKey[i])) {
						lastStatuses = new Map(statuses);
						cachedState = {
							quotas: { ...quotas.values }, model: ctx.model, thinkingLevel: pi.getThinkingLevel(), ...context,
							rate: rate.value(), fast, place: placeOf({ cwd: ctx.cwd, home: homedir(), scratchRoots: roots, worktree: repo?.worktree, branch }),
							git: repo && { branch, staged: 0, unstaged: 0, untracked: 0, ...counts },
							statuses: [...statuses].sort(([a], [b]) => a.localeCompare(b)).map(([, text]) => text),
						};
						cachedRows = renderBar(cachedState, width, paint);
						lastKey = key;
						lastFastFrame = fast?.frame;
					} else if (cachedState && fast?.frame !== lastFastFrame) {
						cachedState.fast = fast;
						cachedRows = [...cachedRows];
						cachedRows[1] = modelRow(cachedState, width, paint);
						lastFastFrame = fast?.frame;
					}
					return ctx.ui.getEditorComponent() === editorFactory ? cachedRows.slice(1) : cachedRows;
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
				await install(ctx);
			} else {
				release();
				running = false;
				working = false;
				compacting = false;
				tools.clear();
				setActivity(ctx, false);
				ctx.ui.setFooter(undefined);
				if (ctx.ui.getEditorComponent() === editorFactory) ctx.ui.setEditorComponent(undefined);
			}
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		sample(ctx);
		await install(ctx);
	});
	pi.on("session_shutdown", (_event, ctx) => {
		release();
		running = false;
		working = false;
		compacting = false;
		tools.clear();
		sessionName = undefined;
		if (ctx.mode === "tui") setActivity(ctx, false);
	});
	pi.on("session_tree", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		rate.reset();
		syncShimmer();
		redraw?.();
	});
	pi.on("session_info_changed", (event) => { sessionName = event.name; redraw?.(); });
	pi.on("model_select", () => { resample?.(); syncShimmer(); redraw?.(); });
	pi.on("agent_start", () => { resample?.(); working = true; running = true; animationStart = now(); syncShimmer(); redraw?.(); });
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
	pi.on("session_compact", () => { compacting = false; resample?.(); syncShimmer(); redraw?.(); });
	pi.on("session_compact_failed", () => { compacting = false; syncShimmer(); redraw?.(); });
	pi.on("thinking_level_select", () => redraw?.());
	pi.on("message_end", (event) => {
		if (!active || event.message.role !== "assistant") return;
		rate.record(event.message);
		redraw?.();
	});
	pi.on("agent_end", () => refresh?.());
}
