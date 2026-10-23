// Transcript fixtures for the wiring tests: saved messages in a public in-memory SessionManager, fixed timestamps,
// and the render context Pi gives a tool row. Public Pi exports only.
import * as pi from "@earendil-works/pi-coding-agent";
import type { ToolRenderContext } from "../index.ts";

export const CWD = "/work/project";

const USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

export type Block = { type: "text"; text: string } | { type: "thinking"; thinking: string } | { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> };

/** Builds messages with increasing fixed timestamps. */
export function messages(start = 1_000) {
	let t = start;
	return {
		user: (text: string) => ({ role: "user" as const, content: [{ type: "text" as const, text }], timestamp: t++ }),
		assistant: (content: Block[], stopReason: "toolUse" | "stop" = content.some((c) => c.type === "toolCall") ? "toolUse" : "stop") =>
			({ role: "assistant" as const, content, api: "faux", provider: "faux", model: "m", usage: USAGE, stopReason, timestamp: t++ }),
		result: (toolCallId: string, toolName: string, text: string, extra: Record<string, unknown> = {}) =>
			({ role: "toolResult" as const, toolCallId, toolName, content: [{ type: "text" as const, text }], isError: false, timestamp: t++, ...extra }),
	};
}

export const call = (id: string, name: string, args: Record<string, unknown>): Block => ({ type: "toolCall", id, name, arguments: args });
export const text = (value: string): Block => ({ type: "text", text: value });
export const thinking = (value: string): Block => ({ type: "thinking", thinking: value });

/** A public in-memory session holding `list` in order. */
export function session(list: readonly unknown[], cwd = CWD): pi.SessionManager {
	const sm = pi.SessionManager.inMemory(cwd);
	for (const m of list) sm.appendMessage(m as never);
	return sm;
}

/** The render context Pi builds for a tool row (tool-execution.js getRenderContext), with overrides. */
export function context(toolCallId: string, args: unknown, o: Partial<ToolRenderContext> = {}): ToolRenderContext {
	return {
		args, toolCallId, invalidate: () => {}, lastComponent: undefined, state: {}, cwd: CWD, executionStarted: true, argsComplete: true,
		isPartial: false, expanded: false, showImages: true, isError: false, durationMs: 50, outputPad: 1, ...o,
	} as ToolRenderContext;
}

/** Pi's stock renderers of the built-in tools, as Pi resolves them without extensions. */
export function stockDefinitions(cwd = CWD): Record<string, pi.ToolRenderers> {
	return { read: pi.createReadToolDefinition(cwd), bash: pi.createBashToolDefinition(cwd), edit: pi.createEditToolDefinition(cwd),
		write: pi.createWriteToolDefinition(cwd), grep: pi.createGrepToolDefinition(cwd), find: pi.createFindToolDefinition(cwd) };
}

/** A render host that only counts requests, as the TUI would schedule a frame. */
export function fakeTui() {
	const host = { renders: 0, requestRender() { host.renders++; } };
	return host;
}

/** The theme Pi hands tool renderers (its active theme after `initTheme`), taken the way a renderer receives it. */
export function stockTheme(): pi.Theme {
	let theme: pi.Theme | undefined;
	new pi.ToolExecutionComponent("probe", "probe", {}, {}, { renderCall: (_args, t) => { theme = t; return { render: () => [], invalidate: () => {} }; } }, fakeTui() as never, CWD);
	if (!theme) throw new Error("no theme");
	return theme;
}
