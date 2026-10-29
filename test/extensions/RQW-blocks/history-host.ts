// A minimal InteractiveMode: Pi's real prototype methods on a plain object with a real SessionManager and Container.
import { InteractiveMode, SessionManager } from "@earendil-works/pi-coding-agent";
import { Container } from "@earendil-works/pi-tui";

const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const user = (text: string, timestamp: number) => ({ role: "user", content: text, timestamp });
const assistant = (content: unknown[], stopReason: string, timestamp: number) =>
	({ role: "assistant", content, api: "x", provider: "p", model: "m", usage, stopReason, timestamp });

export interface Built { manager: SessionManager; compactions: string[]; turnUserIds: string[] }

/** `turns` turns of four entries each (prompt, tool call, result, answer); a compaction after every `every` turns keeps the last `keep`. */
export function buildSession(turns: number, every = 0, keep = 2): Built {
	const manager = SessionManager.inMemory("/w");
	const compactions: string[] = [];
	const turnUserIds: string[] = [];
	for (let t = 0; t < turns; t++) {
		const at = t * 10;
		turnUserIds.push(manager.appendMessage(user(`prompt ${t}`, at) as never));
		manager.appendMessage(assistant([{ type: "toolCall", id: `call${t}`, name: "read", arguments: { path: `f${t}.ts` } }], "toolUse", at + 1) as never);
		manager.appendMessage({ role: "toolResult", toolCallId: `call${t}`, toolName: "read", content: [{ type: "text", text: `body ${t}` }], isError: false, timestamp: at + 2 } as never);
		manager.appendMessage(assistant([{ type: "text", text: `answer ${t}` }], "stop", at + 3) as never);
		if (every > 0 && (t + 1) % every === 0 && t + 1 < turns) compactions.push(manager.appendCompaction(`summary ${t}`, turnUserIds[t + 1 - keep], 1000 * (t + 1)));
	}
	return { manager, compactions, turnUserIds };
}

export interface Host {
	chatContainer: Container;
	sessionManager: SessionManager;
	programStatus: unknown;
	runtimeHost: { session: { sessionManager: unknown } };
	renderInitialMessages(): void;
	rebuildChatFromMessages(): void;
	handleEvent(event: unknown): Promise<void>;
}

export function makeHost(manager: SessionManager): Host {
	const host: any = Object.create(InteractiveMode.prototype);
	Object.assign(host, {
		chatContainer: new Container(),
		pendingTools: new Map(),
		compactionQueuedMessages: [],
		entriesRenderedByBoundaryCompaction: new Set(),
		outputPad: 1,
		toolOutputExpanded: false,
		hideThinkingBlock: false,
		hiddenThinkingLabel: "Thinking...",
		mermaidMarkdownTransformer: undefined,
		footer: { invalidate() {} },
		ui: { requestRender() {}, terminal: { setProgress() {} } },
		editor: { addToHistory() {} },
		updateEditorBorderColor() {},
		isInitialized: true,
		programStatus: { handleEvent() {} },
		clearStatusIndicator() {},
		showStatus() {},
		renderProjectTrustWarningIfNeeded() {},
		settingsManagerProject: undefined,
		runtimeHost: { session: {
			sessionManager: manager,
			settingsManager: { getShowTerminalProgress: () => false, getShowCacheMissNotices: () => false, getShowImages: () => false, getImageWidthCells: () => 60, getCodeBlockIndent: () => "  " },
			modelRuntime: {}, thinkingLevel: "off", retryAttempt: 0,
			extensionRunner: { getMessageRenderer: () => undefined, getMarkdownTransformers: () => [], resolveToolRenderers: (_n: string, next: () => unknown) => next() },
			getToolDefinition: () => undefined,
		} },
	});
	return host;
}
