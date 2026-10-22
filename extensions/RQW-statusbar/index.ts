// Interactive-only footer and editor borders (session ID on top, context bar at the bottom). All displayed session values are read through Pi's live context getters.
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, ExtensionUIContext, Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { type BorderSource, ContextEditor } from "./editor.ts";
import { findRepo, gitBranch, gitCounts, type RepoInfo } from "./git.ts";
import { type BarState, type GitCounts, type Paint, placeOf, RateMeter, type Role, renderBar } from "./render.ts";

const GIT_POLL_MS = 10_000;
const SHIMMER_MS = 120;
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
	/** The main chat's GPT Fast is on (asked from RQW-settings) and its model is GPT through openai-codex: the lightning shows. */
	const lit = (ctx: ExtensionContext | undefined): boolean => {
		if (ctx?.model?.provider !== "openai-codex") return false;
		const query: { fastGpt?: boolean } = {};
		pi.events.emit(FAST_GPT_QUERY, query);
		return query.fastGpt === true;
	};
	const fastState = (ctx: ExtensionContext): BarState["fast"] => lit(ctx) ? { frame: working ? frame : undefined } : undefined;
	const stopShimmer = () => { if (shimmer) clearInterval(shimmer); shimmer = undefined; };
	/** The shimmer timer runs only while the agent works, the footer is up and the lightning is shown; re-checked on every change. */
	const syncShimmer = () => {
		if (!working || !active || !lit(lightCtx)) return stopShimmer();
		if (shimmer) return;
		shimmer = setInterval(() => { frame++; if (!lit(lightCtx)) stopShimmer(); redraw?.(); }, SHIMMER_MS);
		shimmer.unref?.();
	};
	// The context row is drawn as the bottom border of this extension's editor. One factory per extension instance
	// identifies our editor in `getEditorComponent()`; its border reads the current install's source.
	let border: BorderSource | undefined;
	const editorFactory: NonNullable<Parameters<ExtensionUIContext["setEditorComponent"]>[0]> =
		(tui, theme, keybindings) => new ContextEditor(tui, theme, keybindings, () => border);

	function install(ctx: ExtensionContext): void {
		dispose?.();
		border = undefined;
		if (ctx.mode !== "tui" || !enabled) return;
		lightCtx = ctx;
		unsubscribeFast ??= pi.events.on(FAST_GPT_CHANGED, () => { syncShimmer(); redraw?.(); });
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
			paint: () => themePaint(ctx.ui.theme) };
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
			if (enabled) install(ctx);
			else {
				dispose?.();
				border = undefined;
				ctx.ui.setFooter(undefined);
				if (ctx.ui.getEditorComponent() === editorFactory) ctx.ui.setEditorComponent(undefined);
			}
		},
	});

	pi.on("session_start", (_event, ctx) => {
		rate.reset();
		install(ctx);
	});
	pi.on("session_shutdown", () => { unsubscribeFast?.(); unsubscribeFast = undefined; dispose?.(); stopShimmer(); working = false; border = undefined; });
	pi.on("session_tree", () => { rate.reset(); redraw?.(); });
	pi.on("model_select", () => { syncShimmer(); redraw?.(); });
	pi.on("agent_start", () => { working = true; frame = 0; syncShimmer(); redraw?.(); });
	pi.on("agent_end", () => { working = false; syncShimmer(); redraw?.(); });
	pi.on("thinking_level_select", () => redraw?.());
	pi.on("session_compact", () => redraw?.());
	pi.on("message_end", (event) => {
		if (!active || event.message.role !== "assistant") return;
		rate.record(event.message);
		redraw?.();
	});
	pi.on("tool_execution_end", () => refresh?.());
	pi.on("agent_end", () => refresh?.());
}
