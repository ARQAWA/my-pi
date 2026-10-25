// The wiring: every tool call is drawn by this extension's self-shell renderers. Collapsed, a call that does not lead
// its group draws nothing; the leader draws the summary line and, while the group is active, the live block of the
// current call. Expanded (Ctrl+O), every call draws its original as Pi does: the renderers that come after this
// resolver in Pi's tool box (or Pi's fallback formatting, reproduced in fallback.ts), from public pi-tui components.
// Once a call has been expanded its original renderers keep receiving every update, so they finish what they start.
// State comes from public events and the session manager only; no timers of its own, nothing outside the TUI.
import type { ReadonlySessionManager, SessionEntry, Theme, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { Box, type Component, Container, Text } from "@earendil-works/pi-tui";
import { type ChangeClassified, classifyChange } from "./changes.ts";
import { type CallResult, type Classified, classify, record } from "./classify.ts";
import { buildGroups, type CallGroup, type LiveExecution, type Member } from "./groups.ts";
import type { ToolRenderContext } from "./index.ts";
import { callFallback, type FallbackResult, resultFallback, shellBackground, unknownToolText } from "./fallback.ts";
import { diffOf, renderLive } from "./live.ts";
import { renderSummary } from "./summary.ts";

/** The renderer state slot of this extension, beside whatever the original renderers keep in the same object. */
const OWN = Symbol("rqw-tool-ui");

interface RowState {
	/** The latest render context of this row (Pi passes a fresh one on every redraw). */
	context?: ToolRenderContext;
	theme?: Theme;
	/** The latest result Pi handed to `renderResult`, as Pi's component holds it. */
	result?: { content: CallResult["content"]; details?: unknown };
	/** The original renderers' view of the row, from the start of execution or the first expansion on. */
	original?: Original;
}

/** The original of a row: what the renderers after this resolver (or Pi's fallbacks) drew, in Pi's shell. */
interface Original {
	/** Expanded at least once: from then on the original also receives every result. */
	shown: boolean;
	/** The components the original renderers returned last, handed back to them as `lastComponent`. */
	lastCall?: Component;
	lastResult?: Component;
	/** The call and result parts of the shell. */
	call?: Component;
	result?: Component;
	shell?: Box | Container | Text;
}

const EMPTY: Component = { render: () => [], invalidate: () => {} };

/** A classified member of a group, as the summary and the live block take it. */
export function classifyMember(m: Member, cwd: string | undefined): Classified | ChangeClassified {
	const context = { toolCallId: m.id, isPartial: m.isPartial, isError: m.isError === true, stopReason: m.stopReason, ...(cwd ? { cwd } : {}) };
	return m.toolName === "edit" || m.toolName === "write" ? classifyChange(m.toolName, m.args, m.result, context) : classify(m.toolName, m.args, m.result, context);
}

/** The collapsed rows of one call: nothing unless it leads its group; the leader shows the summary line and, while the
 * group is active, the live block of the current call. `pad` is Pi's output padding, applied as a left margin. */
export function collapsedRows(g: CallGroup | undefined, width: number, theme: Theme, cwd: string | undefined, pad = 0): string[] {
	if (!g || !g.isLeader || width <= 0) return [];
	const margin = Math.max(0, Math.min(pad, width));
	const inner = width - margin;
	const indent = " ".repeat(margin);
	const calls = g.members.map((m) => classifyMember(m, cwd));
	const rows = [indent + renderSummary(calls, inner, theme)];
	if (!g.active || g.members.length === 0) return rows;
	// The current call is a member unless it is a parent whose nested calls count instead; then the latest member.
	const found = g.members.findIndex((m) => m.id === g.currentCallId);
	const at = found >= 0 ? found : g.members.length - 1;
	const member = g.members[at];
	const call = calls[at];
	const live = renderLive({ ...call, toolName: member.toolName, ...(member.durationMs !== undefined ? { durationMs: member.durationMs } : {}),
		...(call.kind === "edit" ? { diff: diffOf(member.result) } : {}) }, inner, theme);
	// A nested call whose saved record ended `unfinished` has no known outcome: no running, success or failure row.
	if (member.unconfirmed) live.pop();
	return [...rows, ...live.map((line) => indent + line)];
}

/** One line per event that can change the groups; holds the streaming state between saves. */
export class ToolUi {
	private sessionManager: ReadonlySessionManager | undefined;
	private entries: SessionEntry[] = [];
	private messages: unknown[] = [];
	private streaming = false;
	private executions: LiveExecution[] = [];
	private groups = new Map<string, CallGroup>();
	/** The latest `invalidate` Pi gave each row, by tool call ID. */
	private rows = new Map<string, () => void>();
	/** What each row drew last time it was asked to redraw: leader or not, active or not. */
	private drawn = new Map<string, string>();
	private updateKey = "";

	/** True between a TUI `session_start` and `session_shutdown`. */
	get installed(): boolean {
		return this.sessionManager !== undefined;
	}

	/** The group of a top-level call, for tests and the renderers. */
	group(toolCallId: string): CallGroup | undefined {
		return this.groups.get(toolCallId);
	}

	/** Number of rows this instance can redraw; zero after shutdown. */
	get rowCount(): number {
		return this.rows.size;
	}

	/** Install for a TUI session: read what Pi draws and redraw every row already built (Pi may build the transcript
	 * before it starts the session's extensions, on `/reload` and session switches). */
	start(sessionManager: ReadonlySessionManager): void {
		this.sessionManager = sessionManager;
		this.messages = [];
		this.executions = [];
		this.streaming = false;
		this.updateKey = "";
		this.refresh(true, true);
	}

	/** Forget everything of the session: state, rows and their redraw callbacks. */
	shutdown(): void {
		this.sessionManager = undefined;
		this.entries = [];
		this.messages = [];
		this.executions = [];
		this.streaming = false;
		this.groups.clear();
		this.rows.clear();
		this.drawn.clear();
		this.updateKey = "";
	}

	/** Saved entries changed: a compaction, or tree navigation (`rebuild`: Pi then draws the transcript anew, so the
	 * rows of the old one are forgotten). */
	entriesChanged(rebuild = false): void {
		if (rebuild) {
			this.rows.clear();
			this.drawn.clear();
		}
		this.refresh(true);
	}

	messageStart(message: unknown): void {
		this.messages.push(message);
		this.streaming = true;
		this.updateKey = "";
		this.refresh(false);
	}

	messageUpdate(message: unknown): void {
		this.replace(message);
		this.streaming = true;
		// Text tokens after the first and thinking tokens change nothing here; tool calls and their arguments do.
		const key = streamKey(message);
		if (key === this.updateKey) return;
		this.updateKey = key;
		this.refresh(false);
	}

	messageEnd(message: unknown): void {
		this.replace(message);
		this.streaming = false;
		this.updateKey = "";
		this.refresh(true);
	}

	toolStart(e: { toolCallId: string; toolName: string; args?: unknown; parentToolCallId?: string }): void {
		if (this.executions.some((x) => x.toolCallId === e.toolCallId)) return;
		this.executions.push({ toolCallId: e.toolCallId, toolName: e.toolName, args: e.args, ...(e.parentToolCallId ? { parentToolCallId: e.parentToolCallId } : {}) });
		this.refresh(false);
	}

	toolUpdate(e: { toolCallId: string; args?: unknown; partialResult?: unknown }): void {
		const x = this.executions.find((y) => y.toolCallId === e.toolCallId);
		if (!x) return;
		x.partialResult = e.partialResult as CallResult;
		this.refresh(false);
	}

	toolEnd(e: { toolCallId: string; result?: unknown; isError?: boolean; durationMs?: number }): void {
		const x = this.executions.find((y) => y.toolCallId === e.toolCallId);
		if (!x) return;
		x.result = e.result as CallResult;
		x.isError = e.isError === true;
		if (typeof e.durationMs === "number") x.durationMs = e.durationMs;
		x.ended = true;
		this.refresh(true);
	}

	/** The run is over and saved: the stream state is no longer needed. */
	agentEnd(): void {
		this.messages = [];
		this.executions = [];
		this.streaming = false;
		this.updateKey = "";
		this.refresh(true);
	}

	/** The resolver: self-shell renderers around whatever comes after this extension. */
	resolve(toolName: string, next: () => ToolRenderers | undefined): ToolRenderers {
		const original = next();
		return {
			renderShell: "self",
			renderCall: (args, theme, context) => {
				const own = this.own(context);
				own.context = context;
				own.theme = theme;
				this.rows.set(context.toolCallId, context.invalidate);
				this.drawn.set(context.toolCallId, this.signature(context.toolCallId));
				// The original's call side runs from the start of execution on, as in Pi, so what it starts then (the bash
				// clock) is right when the call is expanded later; its result side from the first expansion on.
				if (context.expanded || context.executionStarted || own.original) this.originalCall(toolName, original, own, args, theme, context);
				return new Row(this, own);
			},
			renderResult: (result, options, theme, context) => {
				const own = this.own(context);
				own.context = context;
				own.theme = theme;
				own.result = { content: result.content as CallResult["content"], details: result.details };
				if (own.original?.shown) this.originalResult(toolName, original, own, result, options, theme, context);
				return EMPTY;
			},
		};
	}

	/** The cwd of the session, for classifying paths as Pi resolves them. */
	get cwd(): string | undefined {
		return this.sessionManager?.getCwd();
	}

	private own(context: ToolRenderContext): RowState {
		const state = context.state as Record<symbol, RowState>;
		return (state[OWN] ??= {});
	}

	private replace(message: unknown): void {
		const last = record(this.messages.at(-1));
		const m = record(message);
		if (this.messages.length > 0 && last.role === m.role && last.timestamp === m.timestamp) this.messages[this.messages.length - 1] = message;
		else this.messages.push(message);
	}

	private refresh(readEntries: boolean, all = false): void {
		if (!this.sessionManager) return;
		if (readEntries) this.entries = this.sessionManager.buildContextEntries();
		this.groups = buildGroups(this.entries, { messages: this.messages, executions: this.executions, streaming: this.streaming });
		for (const [id, invalidate] of this.rows) {
			const g = this.groups.get(id);
			const drawn = this.signature(id);
			// The leader of the active group shows the current call, which moves with every event; others only when
			// they gain or lose the lead or the group stops.
			if (all || drawn !== (this.drawn.get(id) ?? "") || (g?.isLeader && g.active)) {
				this.drawn.set(id, drawn);
				invalidate();
			}
		}
	}

	/** What a row draws, coarsely: nothing, or the summary with or without the live block. */
	private signature(id: string): string {
		const g = this.groups.get(id);
		return g?.isLeader ? `leader:${g.active}` : "";
	}

	/** The rows of one call, drawn at render time from the current groups. */
	draw(own: RowState, width: number): string[] {
		const context = own.context;
		if (!context || !own.theme) return [];
		if (context.expanded) return this.drawOriginal(own, width);
		if (!this.sessionManager) return [];
		return collapsedRows(this.groups.get(context.toolCallId), width, own.theme, this.cwd, context.outputPad);
	}

	/** The original's call, from the renderers after this resolver with the row's own last component and the row's
	 * renderer state, or Pi's fallback when there is none or it throws. Called where Pi calls this row's renderCall, so
	 * the original is updated exactly when Pi would update it. */
	private originalCall(toolName: string, definition: ToolRenderers | undefined, own: RowState, args: unknown, theme: Theme, context: ToolRenderContext): void {
		const o = (own.original ??= { shown: false });
		if (context.expanded) o.shown = true;
		o.result = undefined;
		o.call = undefined;
		if (definition) {
			if (definition.renderCall) {
				try {
					o.call = o.lastCall = definition.renderCall(args as never, theme, { ...context, lastComponent: o.lastCall });
				} catch {
					o.lastCall = undefined;
				}
			}
			o.call ??= new Text(callFallback(toolName, args, theme), 0, 0);
		}
		this.compose(toolName, definition, own, theme, context);
	}

	/** The original's result, as {@link originalCall}: Pi calls this row's renderResult after its renderCall, for every
	 * result, partial or final, expanded or not; once the call has been expanded, each reaches the original renderers.
	 * A final or failed result therefore stops whatever they started for a running call (the bash timer), folded too. */
	private originalResult(toolName: string, definition: ToolRenderers | undefined, own: RowState, result: Parameters<NonNullable<ToolRenderers["renderResult"]>>[0],
		options: Parameters<NonNullable<ToolRenderers["renderResult"]>>[1], theme: Theme, context: ToolRenderContext): void {
		const o = own.original!;
		o.result = undefined;
		if (definition) {
			if (definition.renderResult) {
				try {
					o.result = o.lastResult = definition.renderResult(result, options, theme, { ...context, lastComponent: o.lastResult });
				} catch {
					o.lastResult = undefined;
				}
			}
			if (!o.result) {
				const text = resultFallback(result as FallbackResult, context.showImages, theme);
				if (text !== undefined) o.result = new Text(text, 0, 0);
			}
		}
		this.compose(toolName, definition, own, theme, context);
	}

	/** Pi's shell around the original: its tool box (output padding, background by state), the bare container of a
	 * self-drawn original, or its text for a tool it has no definition for. Pi adds the leading blank row and the
	 * images of the row itself. */
	private compose(toolName: string, definition: ToolRenderers | undefined, own: RowState, theme: Theme, context: ToolRenderContext): void {
		const o = own.original!;
		const bg = shellBackground(theme, context.isPartial, context.isError);
		if (!definition) {
			const text = o.shell instanceof Text ? o.shell : (o.shell = new Text("", 1, 1, bg));
			text.setCustomBgFn(bg);
			text.setPaddingX(context.outputPad);
			text.setText(unknownToolText(toolName, context.args, own.result, context.showImages, theme));
			return;
		}
		const self = definition.renderShell === "self";
		const shell = self ? (o.shell instanceof Container ? o.shell : (o.shell = new Container())) : (o.shell instanceof Box ? o.shell : (o.shell = new Box(1, 1, bg)));
		if (shell instanceof Box) {
			shell.setBgFn(bg);
			shell.setPaddingX(context.outputPad);
		}
		shell.clear();
		if (o.call) shell.addChild(o.call);
		if (o.result) shell.addChild(o.result);
	}

	/** The original rows of an expanded call, composed when Pi last updated the row. */
	private drawOriginal(own: RowState, width: number): string[] {
		return own.original?.shell?.render(width) ?? [];
	}
}

/** What of a streaming message can change the groups: its tool calls and arguments, and whether text has begun. */
function streamKey(message: unknown): string {
	const m = record(message);
	if (m.role !== "assistant" || !Array.isArray(m.content)) return `${String(m.role)}@${String(m.timestamp)}`;
	return JSON.stringify(m.content.map((c) => {
		const b = record(c);
		if (b.type === "toolCall") return [b.id, b.arguments];
		if (b.type === "text") return typeof b.text === "string" && b.text.trim() !== "" ? 1 : 0;
		return 0;
	}));
}

/** The component Pi puts in the row's self shell: drawn at render time from the current state. */
class Row implements Component {
	private readonly ui: ToolUi;
	private readonly own: RowState;
	constructor(ui: ToolUi, own: RowState) {
		this.ui = ui;
		this.own = own;
	}
	render(width: number): string[] {
		return this.ui.draw(this.own, width);
	}
	invalidate(): void {
		this.own.original?.shell?.invalidate();
	}
}
