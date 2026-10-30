// A minimal InteractiveMode: Pi's real prototype methods on a plain object, with a real SessionManager, Container and
// TuiAltScreen over a fake terminal; the RQW-tool-ui extension loaded through a fake extension API.
import { afterEach, mock } from "node:test";
import { initTheme, InteractiveMode, SessionManager, type Theme } from "@earendil-works/pi-coding-agent";
import { Container, stripTerminalSequences, type Terminal, TuiAltScreen } from "@earendil-works/pi-tui";
import toolUi from "../../../extensions/RQW-tool-ui/index.ts";

const hosts: any[] = [];
afterEach(() => {
	for (const host of hosts.splice(0)) {
		try { host.stop("none"); } catch { /* The minimal host omits unrelated shutdown services. */ }
	}
});

initTheme();
export const theme = (globalThis as Record<symbol, unknown>)[Symbol.for("@earendil-works/pi-coding-agent:theme")] as Theme;
/** The host's theme is the global one, which other test files replace with `initTheme`; read it when drawing. */
export const liveTheme = () => (globalThis as Record<symbol, unknown>)[Symbol.for("@earendil-works/pi-coding-agent:theme")] as Theme;

const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
export const user = (text: string, timestamp: number) => ({ role: "user", content: text, timestamp });
export const assistant = (content: unknown[], stopReason: string, timestamp: number) =>
	({ role: "assistant", content, api: "x", provider: "p", model: "m", usage, stopReason, timestamp });
export const text = (value: string) => ({ type: "text", text: value });
export const thinking = (value: string) => ({ type: "thinking", thinking: value });
export const call = (id: string, path: string) => ({ type: "toolCall", id, name: "read", arguments: { path } });
export const result = (id: string, body: string, timestamp: number) =>
	({ role: "toolResult", toolCallId: id, toolName: "read", content: [{ type: "text", text: body }], isError: false, timestamp });

/** A session whose entries are saved at the given wall clock milliseconds. */
export class Session {
	readonly manager = SessionManager.inMemory("/w");
	private clock = mock.timers;
	constructor() {
		this.clock.enable({ apis: ["Date"], now: 0 });
	}
	/** Save `message` with the entry timestamp `at` (milliseconds). */
	add(message: unknown, at: number): string {
		this.clock.setTime(at);
		return this.manager.appendMessage(message as never);
	}
	card(content: string, at: number): string {
		this.clock.setTime(at);
		return this.manager.appendCustomMessageEntry("note", content, true);
	}
	compact(firstKeptEntryId: string, at: number): string {
		this.clock.setTime(at);
		return this.manager.appendCompaction("summary", firstKeptEntryId, 1000);
	}
	/** One standard turn: user, update with a call, its result, a card, the final answer. Returns the user entry ID. */
	turn(n: number, start: number, seconds: number): string {
		const id = this.add(user(`prompt ${n}`, start), start);
		this.add(assistant([thinking(`plan ${n}`), text(`update ${n}`), call(`c${n}`, `f${n}.ts`)], "toolUse", start + 1), start + 1);
		this.add(result(`c${n}`, `body ${n}`, start + 2), start + 2);
		this.card(`card ${n}`, start + 3);
		this.add(assistant([thinking(`sum ${n}`), text(`answer ${n}`)], "stop", start + 4), start + seconds * 1000);
		return id;
	}
	end(): void {
		this.clock.reset();
	}
}

export interface Loaded {
	handlers: Map<string, (event?: unknown, ctx?: unknown) => unknown>;
	resolve: (name: string, next: () => unknown) => unknown;
	resolver(): (name: string, next: () => unknown) => unknown;
	/** Start the TUI session as Pi does after drawing the transcript. */
	start(manager: SessionManager): void;
	shutdown(): void;
}

/** Load the extension as Pi does: the factory, then `session_start` in TUI mode. */
export function load(): Loaded {
	const handlers = new Map<string, (event?: unknown, ctx?: unknown) => unknown>();
	let resolve: Loaded["resolve"] = (_name, next) => next();
	toolUi({
		registerToolRenderer: (fn: Loaded["resolve"]) => { resolve = fn; },
		on: (name: string, fn: (event?: unknown, ctx?: unknown) => unknown) => handlers.set(name, fn),
	} as never);
	return {
		handlers,
		resolve: (name, next) => resolve(name, next),
		resolver: () => resolve,
		start: (manager) => handlers.get("session_start")!({}, { mode: "tui", hasUI: true, sessionManager: manager, ui: { theme } }),
		shutdown: () => handlers.get("session_shutdown")!(),
	};
}

export interface Screen {
	screen: TuiAltScreen;
	/** Feed raw terminal input, as the terminal would. */
	input(data: string): void;
	copied: string[];
	/** The fake terminal: its size can change. */
	terminal: { columns: number; rows: number };
	/** Draw one frame now, as Pi's render loop does, and return the screen rows without escapes. */
	frame(): string[];
	stop(): void;
}

/** Pi's fullscreen renderer over a fake terminal and clipboard, mouse reporting on. */
export function makeScreen(columns = 80, rows = 60): Screen {
	let onInput: (data: string) => void = () => {};
	const copied: string[] = [];
	const terminal = {
		start(input: (data: string) => void) { onInput = input; }, stop() {}, async drainInput() {}, write() {},
		columns, rows, kittyProtocolActive: false,
		moveBy() {}, hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {}, clearScreen() {},
		setTitle() {}, setProgress() {}, setProgramStatus() {},
	} as unknown as Terminal;
	const screen = new TuiAltScreen(terminal, false, undefined, { copySelection: async (value: string) => { copied.push(value); return true; } });
	const frame = () => {
		(screen as unknown as { doRender(): void }).doRender();
		return screen.getScreenLines().map(stripTerminalSequences);
	};
	return { screen, input: (data) => onInput(data), copied, terminal: terminal as unknown as Screen["terminal"], frame, stop: () => screen.stop() };
}

export interface Host {
	chatContainer: Container;
	renderer: unknown;
	hideThinkingBlock: boolean;
	renderInitialMessages(): void;
	rebuildChatFromMessages(): void;
	setToolsExpanded(expanded: boolean): void;
	updateThinkingBlockVisibility(): void;
}

/** Pi's interactive mode over `manager`; `renderer` is Pi's fullscreen renderer or anything else (inline mode). */
export function makeHost(manager: SessionManager, loaded: Loaded | undefined, renderer: unknown): Host {
	const host: any = Object.create(InteractiveMode.prototype);
	Object.assign(host, {
		chatContainer: new Container(),
		loadedResourcesContainer: new Container(),
		renderer,
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
		showStatus() {},
		renderProjectTrustWarningIfNeeded() {},
		runtimeHost: { session: {
			resourceLoader: { getExtensions: () => ({ runtime: manager, extensions: loaded ? [{ toolRenderers: [loaded.resolver()] }] : [] }) },
			sessionManager: manager,
			settingsManager: { getShowTerminalProgress: () => false, getShowCacheMissNotices: () => false, getShowImages: () => false, getImageWidthCells: () => 60, getCodeBlockIndent: () => "  ", setHideThinkingBlock() {} },
			modelRuntime: {}, thinkingLevel: "off", retryAttempt: 0,
			extensionRunner: { getMessageRenderer: () => undefined, getMarkdownTransformers: () => [], resolveToolRenderers: (name: string, next: () => unknown) => loaded ? loaded.resolve(name, next) : next() },
			getToolDefinition: () => undefined,
		} },
	});
	hosts.push(host);
	return host;
}
