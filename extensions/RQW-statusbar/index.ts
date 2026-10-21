// Interactive-only footer. All displayed session values are read through Pi's live context getters.
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { findRepo, gitBranch, gitCounts, type RepoInfo } from "./git.ts";
import { type BarState, type GitCounts, type Paint, placeOf, RateMeter, type Role, renderBar } from "./render.ts";

const GIT_POLL_MS = 10_000;
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
	let measuring = false;
	let redraw: (() => void) | undefined;
	let refresh: (() => void) | undefined;
	let dispose: (() => void) | undefined;
	const rate = new RateMeter();

	function install(ctx: ExtensionContext): void {
		dispose?.();
		if (ctx.mode !== "tui" || !enabled) return;
		ctx.ui.setFooter((tui, theme, footer) => {
			let disposed = false;
			let cwd: string | undefined;
			let repo: RepoInfo | undefined;
			let counts: GitCounts | undefined;
			let branch: string | null = null;
			let busy = false;
			let again = false;
			let cacheKey: unknown[] = [];
			let cached: Pick<BarState, "context" | "compactions"> = { compactions: 0 };
			const roots = scratchRoots();
			const paint = themePaint(theme);
			active = true;
			redraw = () => tui.requestRender();

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
				active = false;
				measuring = false;
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
					return renderBar({
						model,
						thinkingLevel: pi.getThinkingLevel(),
						...cached,
						rate: rate.value(Date.now()),
						place: placeOf({ cwd: ctx.cwd, home: homedir(), scratchRoots: roots, worktree: repo?.worktree, branch }),
						git: repo && { branch, staged: 0, unstaged: 0, untracked: 0, ...counts },
						statuses: [...footer.getExtensionStatuses().entries()]
							.sort(([a], [b]) => a.localeCompare(b)).map(([, text]) => text),
					}, width, paint);
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
			else { dispose?.(); ctx.ui.setFooter(undefined); }
		},
	});

	pi.on("session_start", (_event, ctx) => {
		rate.reset();
		install(ctx);
	});
	pi.on("session_shutdown", () => dispose?.());
	pi.on("session_tree", () => { rate.reset(); redraw?.(); });
	pi.on("model_select", () => redraw?.());
	pi.on("thinking_level_select", () => redraw?.());
	pi.on("session_compact", () => redraw?.());
	pi.on("message_start", (event) => {
		if (active && event.message.role === "assistant") {
			measuring = true;
			rate.start(Date.now());
		}
	});
	pi.on("message_update", (event) => {
		if (!active || !measuring) return;
		const update = event.assistantMessageEvent;
		if (update.type === "text_delta" || update.type === "thinking_delta" || update.type === "toolcall_delta") {
			rate.push(update.delta, Date.now());
			redraw?.();
		}
	});
	pi.on("message_end", (event) => {
		if (!active || !measuring || event.message.role !== "assistant") return;
		measuring = false;
		rate.end(event.message.usage?.output, Date.now());
		redraw?.();
	});
	pi.on("tool_execution_end", () => refresh?.());
	pi.on("agent_end", () => refresh?.());
}
