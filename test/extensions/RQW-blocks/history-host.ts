// A minimal InteractiveMode: Pi's real prototype methods on a plain object with a real SessionManager and Container.
import { InteractiveMode, SessionManager } from "@earendil-works/pi-coding-agent";
import { Container, ScrollView, stripTerminalSequences, TuiAltScreen, VStack, type Terminal } from "@earendil-works/pi-tui";

const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const user = (text: string, timestamp: number) => ({ role: "user", content: text, timestamp });
const assistant = (content: unknown[], stopReason: string, timestamp: number) =>
	({ role: "assistant", content, api: "x", provider: "p", model: "m", usage, stopReason, timestamp });

export interface Built { manager: SessionManager; compactions: string[]; turnUserIds: string[] }

/** `turns` turns of four entries each (prompt, tool call, result, answer, with a thinking block when `thinking`); a compaction after every `every` turns keeps the last `keep`. */
export function buildSession(turns: number, every = 0, keep = 2, thinking = false): Built {
	const manager = SessionManager.inMemory("/w");
	const compactions: string[] = [];
	const turnUserIds: string[] = [];
	for (let t = 0; t < turns; t++) {
		const at = t * 10;
		turnUserIds.push(manager.appendMessage(user(`prompt ${t}`, at) as never));
		manager.appendMessage(assistant([{ type: "toolCall", id: `call${t}`, name: "read", arguments: { path: `f${t}.ts` } }], "toolUse", at + 1) as never);
		manager.appendMessage({ role: "toolResult", toolCallId: `call${t}`, toolName: "read", content: [{ type: "text", text: `body ${t}` }], isError: false, timestamp: at + 2 } as never);
		manager.appendMessage(assistant([...(thinking ? [{ type: "thinking", thinking: `reasoning ${t}` }] : []), { type: "text", text: `answer ${t}` }], "stop", at + 3) as never);
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
		loadedResourcesContainer: new Container(),
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
			settingsManager: { getShowCacheMissNotices: () => false, getShowImages: () => false, getImageWidthCells: () => 60, getCodeBlockIndent: () => "  ", setHideThinkingBlock() {}, getFullscreenCopyOnSelect: () => false, getFullscreenWheelScrollLines: () => 1, getShowTerminalProgress: () => false },
			modelRuntime: {}, thinkingLevel: "off", retryAttempt: 0,
			extensionRunner: { getMessageRenderer: () => undefined, getMarkdownTransformers: () => [], resolveToolRenderers: (_n: string, next: () => unknown) => next() },
			getToolDefinition: () => undefined,
		} },
	});
	return host;
}

export interface Fullscreen {
	host: Host & Record<string, any>;
	screen: TuiAltScreen;
	/** The fake terminal under the renderer. */
	terminal: Terminal;
	view: ScrollView;
	/** Draw one frame now. */
	frame(): void;
	/** Send raw terminal input through the renderer's own input path, then draw. */
	send(data: string): void;
	/** Send raw terminal input without drawing a frame. */
	raw(data: string): void;
	/** The wheel one line up or down over the transcript. */
	wheel(direction: -1 | 1): void;
	/** The text rows of the last frame. */
	rows(): string[];
	stop(): void;
}

/** Pi's real TuiAltScreen, ScrollView and VStack in the layout of Pi's chat viewport, on a fake terminal. */
export function makeFullscreen(manager: SessionManager, options: { columns?: number; rows?: number; scrollbar?: "hidden" | "always"; header?: boolean } = {}): Fullscreen {
	const columns = options.columns ?? 60;
	const rows = options.rows ?? 14;
	let input: (data: string) => void = () => {};
	const terminal = {
		start(onInput: (data: string) => void) { input = onInput; }, stop() {}, async drainInput() {}, write() {},
		columns, rows, kittyProtocolActive: false,
		moveBy() {}, hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {}, clearScreen() {},
		setTitle() {}, setProgress() {}, setProgramStatus() {},
	} as unknown as Terminal;
	const screen = new TuiAltScreen(terminal, false, undefined, { wheelScrollLines: 1, copyOnSelect: false, scrollToEndIndicator: () => " Jump to latest " });
	const host: any = makeHost(manager);
	const header = { render: () => ["HEADER"], invalidate() {} };
	const document = new Container();
	if (options.header !== false) document.addChild(header);
	document.addChild(host.chatContainer);
	const view = new ScrollView(document, { follow: "end", primary: true, scrollbar: options.scrollbar ?? "hidden" });
	const dock = { render: () => ["dock"], invalidate() {} };
	screen.setLayoutRoot(new VStack([
		{ component: view, basis: 0, grow: 1, shrink: 1, minSize: 1 },
		{ component: dock, basis: "auto", grow: 0, shrink: 1, minSize: 1 },
	]));
	// What Pi's own switchTuiMode needs besides the renderer.
	Object.assign(host, { renderer: screen, transcriptScrollView: view, documentContainer: document, options: {}, themeController: { rebindTui() {} }, rebindExtensionTerminalInputListeners() {} });
	screen.start();
	const frame = () => screen.renderNow();
	frame();
	return {
		host, screen, terminal, view, frame,
		raw(data) { input(data); },
		send(data) { input(data); frame(); },
		wheel(direction) { input(`\x1b[<${direction < 0 ? 64 : 65};10;3M`); frame(); },
		rows: () => screen.getScreenLines().map((line) => stripTerminalSequences(line).trimEnd()),
		stop: () => screen.stop(),
	};
}
