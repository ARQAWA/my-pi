// RQW-codex stage 5: per-session controller for the owned Codex facade.
// One controller per actual AgentSession: its own durable wire state (SessionWireState, per saved owner), its own
// transport (thread, socket, turn, fallback state), its own run boundary tracking and its own startup prewarm.
// Durable scope is the session id (thread); the process runtime id is an ephemeral lease recorded as provenance only.
// Startup runs after the session's prompt and tools are final: the RQW prompt projection is asked synchronously over
// pi.events, rendered through the exact session.systemPrompt getter and restored in finally.
// Codex auth and state work happens only for the owned openai-codex / openai-codex-responses pair; other models never
// resolve a credential. Compaction is stock Pi's own summary: the controller only observes the latest Pi compaction entry of
// the branch and, after a new one, drops its prepared work and transport (afterPiCompaction).
// Imports: Pi SDK types/runtime, this folder and npm packages only.
import { convertToLlm, type AgentSession, type ExtensionAPI, type NormalizedBuildSystemPromptOptions } from "@earendil-works/pi-coding-agent";
import { getCurrentTools, lazyStream, type Api, type AssistantMessage, type AssistantMessageEventStream, type Context, type CredentialStore, type Model } from "@earendil-works/pi-ai";

import { resolveStoredCredential } from "./auth-boundary.ts";
import { credentialIdentity, PROVIDER_ID, validateCredential } from "./auth.ts";
import { uuidv7 } from "./compaction.ts";
import type { ContextForkRequest } from "./context-fork.ts";
import { canonicalJson, HISTORY_CUSTOM_TYPE, HISTORY_VERSION, scopeDigest, sha256Hex } from "./history.ts";
import { collectWorkspaceMetadata, type CodexIdentity, type HistoryInitialization, type WorkspaceMetadata } from "./metadata.ts";
import { CODEX_API, CODEX_PROVIDER, CODEX_STABLE_FEATURES, codexModelCapabilities } from "./profile.ts";
import { installPortableHistory } from "./portable-history.ts";
import { normalizeRunOptions, pendingSystemMessage, pendingToolChanges, withHiddenTools } from "./session-prefix.ts";
import { proveForkAdoption, SessionWireState } from "./session-history.ts";
import { inferHistoryInitialization, requestMetadata, SESSION_POLICY_METADATA } from "./session-metadata.ts";
import { CodexThreadTransport, PREWARM_WAIT_BUDGET_MS, wireCapabilities, type CodexStreamOptions, type RawItemHistory, type SendRawOptions, type TransportDependencies } from "./transport.ts";
import { buildRequest, prefixContext, type WireItem, type WireOptions } from "./wire.ts";

/** Startup projection channel (same literal as RQW-prompt; no import across folders). */
export const STARTUP_PROJECTION_CHANNEL = "rqw-prompt:startup-projection";

/** Structural transport surface the controller needs (CodexThreadTransport satisfies it). */
export interface SessionTransport {
	stream(model: Model<Api>, context: Context, options?: CodexStreamOptions): AssistantMessageEventStream;
	prewarm(model: Model<Api>, context: Context, options?: CodexStreamOptions): Promise<void>;
	beginTurn(info?: { turnId?: string }): void;
	endTurn(): void;
	updateMetadata?(update: Partial<CodexIdentity>): void;
	/** Raw native send of one caller-built request (compaction). Required for backend compaction; absent means compaction refuses. */
	sendRaw?(args: SendRawOptions): AsyncIterable<Record<string, unknown>>;
	contextFork?(request: ContextForkRequest): (() => Promise<AssistantMessage>) | undefined;
	dispose(): void;
}

export type SessionDependencies = TransportDependencies & {
	/** Builds the per-session transport. Default: the real CodexThreadTransport. The third argument is the durable raw history. */
	transportFactory?: (identity: CodexIdentity, store: CredentialStore | undefined, rawHistory?: RawItemHistory) => SessionTransport;
	/** Workspace collector of the session cwd. Default: the real collectWorkspaceMetadata (tests use it as a deterministic gate). */
	collectWorkspaceMetadata?: typeof collectWorkspaceMetadata;
};

export type SubagentKind = "collab_spawn" | "review";

export interface SessionControllerOptions {
	session: AgentSession;
	pi?: ExtensionAPI;
	installationId: string;
	rootSessionId?: string;
	parentThreadId?: string;
	subagentKind?: SubagentKind;
	/** Exact startup system prompt of a child; when present the prewarm sends it instead of the projected base. */
	startupSystemPrompt?: string;
	/** Internal bridge flag: the child's startup prompt is forced (Pi's forceSystemPrompt). Only meaningful with startupSystemPrompt. */
	startupSystemPromptForced?: boolean;
	/** Actual label of a child in its caller's terms (`${parent agent}/${child label}`); the root is `/root`. */
	agentName?: string;
	/** Creation parent turn of a child (immutable once sealed). */
	parentTurnId?: string;
	/** Birth root turn of a child: the root turn of its first logical run when no later origin is captured. */
	rootTurnId?: string;
	store?: CredentialStore;
	dependencies?: SessionDependencies;
}

export interface SessionLineage {
	rootSessionId?: string;
	parentThreadId?: string;
	subagentKind?: SubagentKind;
	startupSystemPrompt?: string;
	startupSystemPromptForced?: boolean;
	agentName?: string;
	parentTurnId?: string;
	rootTurnId?: string;
}

/** Read-only snapshot of the current lineage: thread, root session, label and current turns (absent when unknown). */
export type LineageSnapshot = { threadId: string; rootSessionId: string; agentName?: string; turnId?: string; rootTurnId?: string };

export interface SessionPolicy {
	beginRun(start?: { kind?: "run" | "steer" }): void;
	endRun(end?: { aborted?: boolean }): void;
	release(): void;
}

/** One startup setup: its clock origin is taken before its first await; the first normal stream waits for it within the budget. */
type StartupAttempt = { origin: number; abort: AbortController; signal: AbortSignal; promise: Promise<void>; pending?: Promise<void>; settled: boolean; spent: boolean };

export interface SessionController {
	readonly policy: SessionPolicy;
	start(): Promise<void>;
	updateLineage(lineage: SessionLineage): void;
	stream(model: Model<Api>, context: Context, options?: CodexStreamOptions): AssistantMessageEventStream;
	contextFork(request: ContextForkRequest): (() => Promise<AssistantMessage>) | undefined;
	release(): void;
	readonly threadId: string;
	readonly rootSessionId: string;
	/** Durable wire state of the current saved owner; undefined until the first Codex request or start() resolved it. */
	readonly wireState?: SessionWireState;
	/** Fresh snapshot of the current lineage and turns; carries no response, socket, sticky routing or secret. */
	readonly lineageSnapshot: LineageSnapshot;
	/** Stores the root turn of the NEXT logical run (an explicit empty origin records that the root turn is unknown). */
	captureRunOrigin(origin: { rootTurnId?: string }): void;
	/** Explicit idle prewarm of the Codex history: accepted only when the session is idle; never a turn. Automatic idle prewarm is controller-owned (see createSessionController). */
	prewarmWithHistory(): Promise<void>;
	/** Invalidate pending prewarm on model selection and resolve after its preparation and transport have settled. */
	modelChange(): Promise<void>;
	/**
	 * Called after stock Pi finished a compaction. When the latest Pi compaction entry of the branch differs from the observed one,
	 * prepared work and the transport are dropped and the owned state is refreshed; otherwise nothing happens.
	 */
	afterPiCompaction(): void;
}

/** Pi's startup projection request, as RQW-prompt reads it (structural copy). */
type ProjectionRequest = { options: NormalizedBuildSystemPromptOptions; model?: { provider: string; id: string }; error?: string };

/** Private Pi fields read only through checked access (Pi 1.4.0). */
type PromptInternals = {
	_baseSystemPromptOptions?: NormalizedBuildSystemPromptOptions;
	_runSystemPromptOptions?: NormalizedBuildSystemPromptOptions;
};

type RunnerLike = {
	emitBeforeProviderRequest(payload: unknown): Promise<unknown>;
	hasHandlers?(name: string): boolean;
};

/**
 * Clone of the base options that the projection channel receives, carrying the session's actual selected and hidden tools
 * (the active set and the hidden declarations Pi's run preparation uses) before the projection is dispatched, so a
 * projector decides on the same tools the next run will have.
 */
function projectionCloneOf(session: AgentSession, base: NormalizedBuildSystemPromptOptions): ProjectionRequest["options"] {
	const options = structuredClone(base);
	options.selectedTools = session.getActiveToolNames();
	options.hiddenTools = [...hiddenNamesOf(session)];
	return options;
}

/** Hidden declaration names of the session (Pi's private set, read through checked access). */
function hiddenNamesOf(session: AgentSession): Set<string> {
	const hidden = (session as unknown as { _hiddenDeclarations?: unknown })._hiddenDeclarations;
	if (!(hidden instanceof Set)) throw new Error("RQW-codex: session has no hidden declaration set");
	return new Set([...hidden].map(String));
}

/**
 * The tools a request declares: the executable catalog without the hidden declarations (Pi keeps hidden tools executable and
 * projects them out of the declarations; the request projection drops them the same way). Read-only; the catalog is not changed.
 */
function declaredCatalogOf(session: AgentSession): Context["tools"] {
	const hidden = hiddenNamesOf(session);
	return session.agent.state.tools.filter((tool) => !hidden.has(tool.name)) as Context["tools"];
}

/**
 * Renders the RQW startup prompt for the session without changing it: asks the projection channel for a clone of the
 * normalized base options, then renders session.systemPrompt with that clone as the temporary run options.
 * Throws when the projection fails; the caller must not prewarm with a stale or missing prompt.
 */
export function projectStartupPrompt(session: AgentSession, pi: ExtensionAPI | undefined): string {
	const internals = session as unknown as PromptInternals;
	if (!("systemPrompt" in session)) throw new Error("RQW-codex: session has no systemPrompt getter");
	if (!pi) return session.systemPrompt;
	const base = internals._baseSystemPromptOptions;
	if (!base || typeof base !== "object") throw new Error("RQW-codex: session has no normalized base prompt options");
	const model = session.model;
	const request: ProjectionRequest = {
		options: projectionCloneOf(session, base),
		model: model ? { provider: model.provider, id: model.id } : undefined,
	};
	pi.events.emit(STARTUP_PROJECTION_CHANNEL, request);
	if (request.error !== undefined) throw new Error(request.error);
	const previous = internals._runSystemPromptOptions;
	internals._runSystemPromptOptions = request.options;
	try {
		return session.systemPrompt;
	} finally {
		internals._runSystemPromptOptions = previous;
	}
}

/** The wire options the transport derives from stream options (same mapping as the transport's own request path). */
function wireOptionsOf(options: CodexStreamOptions): WireOptions {
	return {
		reasoningEffort: options.reasoningEffort,
		reasoning: options.reasoning,
		reasoningSummary: options.reasoningSummary,
		serviceTier: options.serviceTier,
		verbosity: options.verbosity,
		reasoningEffortOverride: CODEX_STABLE_FEATURES.reasoningEffortOverride,
	};
}

/**
 * Arms the durable state for one request and returns the options the transport gets. The state returns the fresh prefix
 * followed by the projection; the transport adds its own prefix once, so the exact fresh prefix is verified and removed
 * here. A projection that does not start with that prefix is refused, never stripped silently.
 */
function projectedOptions(state: SessionWireState, model: Model<Api>, context: Context, options: CodexStreamOptions, identity: CodexIdentity, known?: readonly unknown[]): CodexStreamOptions {
	const capabilities = wireCapabilities(model);
	const wire = wireOptionsOf(options);
	// An idle warm (known given) only previews: its request-time messages are never persisted, and the normal stream keeps nativeInput.
	const native = known === undefined ? state.nativeInput({ context, model, capabilities, options: wire }) : state.previewNativeInput({ context, model, capabilities, options: wire }, known);
	if (native === undefined) return options;
	const prefix = buildRequest({ model, context: prefixContext(context), options: wire, capabilities, identity }).input;
	if (native.length < prefix.length || !prefix.every((item, i) => canonicalJson(item) === canonicalJson(native[i]))) {
		throw new Error("RQW-codex: the durable projection does not start with the fresh request prefix. Request not sent.");
	}
	return { ...options, nativeInput: native.slice(prefix.length) as WireItem[] };
}

export function createSessionController(options: SessionControllerOptions): SessionController {
	const { session, pi } = options;
	const deps: SessionDependencies = options.dependencies ?? {};
	const store = options.store ?? (session.modelRuntime as unknown as { credentials?: CredentialStore }).credentials;
	const threadId = session.sessionId;
	// Ephemeral runtime lease of this controller: provenance only, never a match key.
	const runtimeLeaseId = uuidv7();
	const lineage: SessionLineage & { rootSessionId: string } = {
		rootSessionId: options.rootSessionId ?? threadId,
		parentThreadId: options.parentThreadId,
		subagentKind: options.subagentKind,
		startupSystemPrompt: options.startupSystemPrompt,
		startupSystemPromptForced: options.startupSystemPromptForced,
		agentName: options.agentName,
		parentTurnId: options.parentTurnId,
		rootTurnId: options.rootTurnId,
	};
	// Origin of the next logical run: the birth root until a capture replaces it; consumed by the run it starts.
	let pendingOrigin: { rootTurnId?: string } | undefined = options.rootTurnId === undefined ? undefined : { rootTurnId: options.rootTurnId };
	// Root turn of the active run (a child's captured root); the root thread uses its own turn instead.
	let activeRoot: string | undefined;
	const lifetime = new AbortController();
	let started = false;
	// Lineage is fixed once start() has been called, even for a non-Codex model: a later Codex transport takes its identity from it.
	let sealed = false;
	let released = false;
	let owned: { owner: string; state: SessionWireState; historyInit: HistoryInitialization } | undefined;
	let transport: SessionTransport | undefined;
	let transportWindow: string | undefined;
	let runActive = false;
	let turnId: string | undefined;
	// Start of the active run (set once at beginRun, cleared at endRun): the compaction operation of an active run keeps it.
	let turnStartedAt: number | undefined;
	// Whether the current transport has received beginTurn for the active run (a transport created later gets it at creation).
	let turnBegun = false;
	let startup: StartupAttempt | undefined;
	// Explicit idle prewarm setup: its own origin and budget, separate from the startup latch.
	let idle: StartupAttempt | undefined;
	// Automatic idle prewarm: armed by agent_start / compaction_start, consumed once on an actual idle transition (never polled).
	let autoArmed = false;
	let autoEpoch = 0;
	let autoTimer: ReturnType<typeof setTimeout> | undefined;
	let auto: StartupAttempt | undefined;
	let unsubscribeAuto: (() => void) | undefined;
	const now = (): number => (deps.clock ? deps.clock.now() : Date.now());

	/** Id of the newest real Pi compaction entry of the current branch (public session manager API only). */
	const latestCompactionId = (): string | undefined => {
		const branch = session.sessionManager.getBranch() as unknown as { type?: unknown; id?: unknown }[];
		for (let index = branch.length - 1; index >= 0; index--) {
			if (branch[index].type === "compaction") return String(branch[index].id);
		}
		return undefined;
	};
	let observedCompactionId = latestCompactionId();

	/**
	 * Compares the branch's latest Pi compaction entry with the observed one. A new boundary cancels the startup, idle and automatic
	 * attempts and the automatic check, starts a new automatic epoch, and drops the transport and its turn/window bookkeeping, so work
	 * prepared before the summary can never be reused. The logical run and its turn stay: the next transport begins the current turn.
	 */
	const observeCompactionBoundary = (): boolean => {
		const latest = owned ? owned.state.projectionBoundaryId ?? undefined : latestCompactionId();
		if (latest === observedCompactionId) return false;
		observedCompactionId = latest;
		startup?.abort.abort();
		idle?.abort.abort();
		auto?.abort.abort();
		cancelAutoCheck();
		autoEpoch++;
		turnBegun = false;
		transportWindow = undefined;
		const previous = transport;
		transport = undefined;
		previous?.dispose();
		owned?.state.refresh();
		return true;
	};

	// Native window header and blob window_id: `${thread}:${number}`. The bare UUIDv7 is the context window id (blob only).
	const windowKey = (state: SessionWireState): string => {
		const window = state.window;
		if (window.id === null) throw new Error("RQW-codex: the session wire state has no window id");
		return `${threadId}:${window.number}`;
	};

	const isRootThread = (): boolean => lineage.parentThreadId === undefined && lineage.rootSessionId === threadId;

	/** Actual label: the root is `/root`; a child carries the label its caller gave it. */
	const agentNameOf = (): string | undefined => (isRootThread() ? "/root" : lineage.agentName);

	/** Root turn of the current request: the root's own active turn, or a child's active captured root; absent when no run is active. */
	const currentRootTurn = (): string | undefined => {
		if (!runActive) return undefined;
		return isRootThread() ? turnId : activeRoot;
	};

	const identity = (state: SessionWireState): CodexIdentity => ({
		installationId: options.installationId,
		windowId: windowKey(state),
		windowNumber: state.window.number,
		contextWindowId: state.window.id ?? undefined,
		rootSessionId: lineage.rootSessionId,
		threadId,
		agentName: agentNameOf(),
		parentThreadId: lineage.parentThreadId,
		parentTurnId: lineage.parentTurnId,
		subagentKind: lineage.subagentKind,
		subagentHeader: lineage.subagentKind,
	});

	const requireStore = (): CredentialStore => {
		if (!store) throw new Error("RQW-codex: no credential store for the session");
		return store;
	};

	const isCodexModel = (model: Model<Api> | undefined): boolean =>
		model?.provider === CODEX_PROVIDER && model.api === CODEX_API;

	const isCurrentModel = (model: Model<Api>): boolean =>
		session.model?.provider === model.provider && session.model.api === model.api && session.model.id === model.id;

	const requireCodexModel = (model: Model<Api>) => {
		if (model.provider !== CODEX_PROVIDER) throw new Error(`RQW-codex: model provider ${model.provider} is not ${CODEX_PROVIDER}`);
		if (model.api !== CODEX_API) throw new Error(`RQW-codex: model api ${model.api} is not ${CODEX_API}`);
	};

	const createTransport = (state: SessionWireState): SessionTransport => {
		const id = identity(state);
		const created = deps.transportFactory
			? deps.transportFactory(id, store, state.rawHistory)
			: new CodexThreadTransport({ identity: id, store: requireStore(), history: state.rawHistory, dependencies: deps });
		transport = created;
		transportWindow = windowKey(state);
		if (runActive) {
			created.beginTurn({ turnId });
			turnBegun = true;
		}
		return created;
	};

	/** Accepted window changes reach the transport as metadata; the socket is left open. */
	const syncWindow = (state: SessionWireState, current: SessionTransport): void => {
		const key = windowKey(state);
		if (key === transportWindow) return;
		current.updateMetadata?.({ windowId: key, windowNumber: state.window.number, contextWindowId: state.window.id ?? undefined });
		transportWindow = key;
	};

	/**
	 * Codex only: resolves the saved owner, then the owner's durable state, transport and window. An owner change replaces
	 * all three (the old owner's opaque state is never used); the same owner's access rotation keeps them.
	 */
	const ensureReady = async (model: Model<Api>, signal: AbortSignal): Promise<{ owner: string; state: SessionWireState; transport: SessionTransport; historyInit: HistoryInitialization }> => {
		if (released) throw new Error("RQW-codex: session controller is released");
		// A new Pi summary boundary drops the old transport before this request picks one.
		observeCompactionBoundary();
		// The transport takes its lineage identity from here: lineage is sealed from the first Codex request on.
		sealed = true;
		const { accountId } = await resolveStoredCredential(requireStore(), signal);
		if (released) throw new Error("RQW-codex: session controller is released");
		observeCompactionBoundary();
		if (owned?.owner !== accountId) {
			const previous = transport;
			transport = undefined;
			transportWindow = undefined;
			turnBegun = false;
			previous?.dispose();
			// Producer hash of a checkpoint: the native catalog comp_hash of the model that compacted (never sha256 of capabilities).
			const modelHash = codexModelCapabilities(model.id).compactionHash;
			const created = new SessionWireState({ session, ownerId: accountId, modelHash, runtimeLeaseId });
			settle(created);
			owned = { owner: accountId, state: created, historyInit: historyInitializationOf(created, accountId) };
		}
		const state = owned.state;
		const current = transport ?? createTransport(state);
		syncWindow(state, current);
		return { owner: owned.owner, state, transport: current, historyInit: owned.historyInit };
	};

	const preparedRefusal = (): Error => new Error("RQW-codex: the saved login changed while this request was being prepared. Request not sent; saved credentials were not removed.");
	const stillOwnedBy = (ready: { owner: string; state: SessionWireState; transport: SessionTransport }): boolean =>
		!released && owned !== undefined && owned.owner === ready.owner && owned.state === ready.state && transport === ready.transport;

	/** Synchronous owner decision over one stored value (no await, no refresh): same account, and the owned state and transport are still current. */
	const decideOwnedBy = (ready: { owner: string; state: SessionWireState; transport: SessionTransport }, stored: unknown): void => {
		observeCompactionBoundary();
		if (!stillOwnedBy(ready)) throw preparedRefusal();
		let accountId: string;
		try {
			accountId = credentialIdentity(validateCredential(stored));
		} catch {
			throw preparedRefusal();
		}
		if (accountId !== ready.owner || !stillOwnedBy(ready)) throw preparedRefusal();
	};

	/**
	 * Prepared-owner guard: a prepared request (idle or startup prewarm, normal stream) goes on only
	 * while the saved login still belongs to the owner ensureReady chose and its state and transport are still the current ones. Same account
	 * token rotation passes. The saved slot is re-read and validated without a refresh; a refusal names no secret and deletes nothing.
	 */
	const assertPrepared = async (ready: { owner: string; state: SessionWireState; transport: SessionTransport }, signal: AbortSignal): Promise<void> => {
		signal.throwIfAborted();
		observeCompactionBoundary();
		if (!stillOwnedBy(ready)) throw preparedRefusal();
		let stored: unknown;
		try {
			stored = await requireStore().read(PROVIDER_ID, { signal });
		} catch {
			signal.throwIfAborted();
			throw preparedRefusal();
		}
		signal.throwIfAborted();
		decideOwnedBy(ready, stored);
	};

	/** Internal prewarm only: chains the session's before_provider_request handlers once (same guard as Pi's sdk transform), then the caller's hook. */
	const withRunnerHook = (callerOptions: CodexStreamOptions = {}): CodexStreamOptions => {
		const runner = session.extensionRunner as unknown as RunnerLike;
		if (typeof runner?.emitBeforeProviderRequest !== "function") throw new Error("RQW-codex: session has no provider request runner");
		return {
			...callerOptions,
			onPayload: async (payload, model) => {
				let value = payload;
				if (runner.hasHandlers?.("before_provider_request") !== false) value = (await runner.emitBeforeProviderRequest(payload)) ?? payload;
				const replaced = await callerOptions.onPayload?.(value as never, model);
				return replaced ?? value;
			},
		};
	};

	/** Native turn-settle hook of a wire state (wire work in progress); absent means nothing to retire. */
	const settle = (state: SessionWireState | undefined): void => state?.settleTurn();

	/** Workspace facts of the actual session cwd (read-only git, sanitized); never rejects. */
	const collectWorkspaces = (): Promise<Record<string, WorkspaceMetadata>> =>
		Promise.resolve()
			.then(() => (deps.collectWorkspaceMetadata ?? collectWorkspaceMetadata)(session.sessionManager.getCwd()))
			.catch(() => ({}));

	// Workspaces of the active logical run: collected once at its start; an operation outside a run collects its own.
	let runWorkspaces: Promise<Record<string, WorkspaceMetadata>> | undefined;
	const workspacesFor = (): Promise<Record<string, WorkspaceMetadata>> => {
		if (!runActive) return collectWorkspaces();
		runWorkspaces ??= collectWorkspaces();
		return runWorkspaces;
	};

	/**
	 * Native history initialization of one owner, captured once at its first ensureReady. Own base: a loaded native base with a
	 * signed own seed, item or checkpoint entry. Adopted base: a loaded native base without an own one, when the parent file proves it.
	 */
	const historyInitializationOf = (state: SessionWireState, ownerId: string): HistoryInitialization => {
		const loaded = state.history.load();
		const ownScope = scopeDigest({ runtimeId: "", threadId, ownerId });
		const ownBase = loaded.mode === "native" && (loaded.checkpointEntryId !== null || loaded.items.length > 0) && session.sessionManager.getBranch().some((entry) => {
			const record = entry as unknown as { type?: unknown; customType?: unknown; data?: Record<string, unknown> };
			const data = record.data;
			if (record.type !== "custom" || record.customType !== HISTORY_CUSTOM_TYPE || !data) return false;
			if (data.v !== HISTORY_VERSION || typeof data.digest !== "string" || data.scope !== ownScope) return false;
			if (data.kind !== "seed" && data.kind !== "item" && data.kind !== "checkpoint") return false;
			const { digest, ...rest } = data;
			return sha256Hex(canonicalJson(rest)) === digest;
		});
		const adoptedBase = loaded.mode === "native" && !ownBase
			&& (proveForkAdoption(session.sessionManager as unknown as Parameters<typeof proveForkAdoption>[0], threadId, ownerId)?.length ?? 0) > 0;
		return inferHistoryInitialization(session, { ownBase, adoptedBase });
	};

	/**
	 * One immutable copy of the session-derived identity for one prepared operation: policy, the actual tool catalog and effort of
	 * this request (requestMetadata), workspaces, history initialization and the run timing that the caller passes (none for a prewarm).
	 */
	const snapshotOf = (args: {
		model: Model<Api>;
		context: Context;
		options: CodexStreamOptions;
		workspaces: Record<string, WorkspaceMetadata>;
		historyInit: HistoryInitialization;
		turnStartedAtUnixMs?: number;
		rootTurnId?: string;
	}): Partial<CodexIdentity> =>
		structuredClone({
			...SESSION_POLICY_METADATA,
			...requestMetadata(args.model, args.context, args.options),
			agentName: agentNameOf(),
			workspaces: args.workspaces,
			historyInitialization: args.historyInit,
			turnStartedAtUnixMs: args.turnStartedAtUnixMs,
			rootTurnId: args.rootTurnId,
		});

	// Run boundaries come only from the registration lifecycle (policy.beginRun/endRun). One boolean: a repeated begin
	// while active and an end while inactive are no-ops; steers inside an active run keep its logical turn. No auth or
	// state work here: a transport created later receives the active turn.
	const policy: SessionPolicy = {
		beginRun(start = { kind: "run" }) {
			if (released) return;
			// A steer inside an active run is part of it: the origin captured for a later run is discarded, not used by this one.
			if (start.kind === "steer") {
				if (runActive) pendingOrigin = undefined;
				return;
			}
			if (runActive) return;
			// Explicit idle preparation is obsolete as soon as real work starts; startup still shares its remaining budget.
			idle?.abort.abort();
			runActive = true;
			turnId = uuidv7();
			turnStartedAt = now();
			// The new run consumes the pending origin; without one its root is unknown (no reuse of an older run's root).
			activeRoot = pendingOrigin?.rootTurnId;
			pendingOrigin = undefined;
			runWorkspaces = isCodexModel(session.model) ? collectWorkspaces() : undefined;
			turnBegun = false;
			if (transport) {
				transport.beginTurn({ turnId });
				turnBegun = true;
			}
		},
		endRun() {
			if (released || !runActive) return;
			runActive = false;
			settle(owned?.state);
			runWorkspaces = undefined;
			if (turnBegun) transport?.endTurn();
			turnBegun = false;
			turnId = undefined;
			turnStartedAt = undefined;
			activeRoot = undefined;
		},
		release() {
			release();
		},
	};

	function release(): void {
		if (released) return;
		released = true;
		runActive = false;
		runWorkspaces = undefined;
		turnBegun = false;
		turnId = undefined;
		turnStartedAt = undefined;
		activeRoot = undefined;
		pendingOrigin = undefined;
		// Automatic idle prewarm: public listener and its one deferred check go first; an in-flight auto setup ends with lifetime.abort().
		unsubscribeAuto?.();
		unsubscribeAuto = undefined;
		cancelAutoCheck();
		autoArmed = false;
		// Abort first, then the portable history while the owned state is still available, then the transport.
		lifetime.abort();
		portable.release();
		const current = transport;
		transport = undefined;
		transportWindow = undefined;
		current?.dispose();
	}

	const abortError = (): Error => {
		const error = new Error("Request was aborted");
		error.name = "AbortError";
		return error;
	};

	/** Settles with the work's result, or rejects as soon as the signal aborts; a late result of the work is ignored. */
	const untilAborted = <T,>(work: Promise<T>, signal: AbortSignal): Promise<T> =>
		new Promise<T>((resolve, reject) => {
			if (signal.aborted) return reject(abortError());
			const onAbort = () => reject(abortError());
			signal.addEventListener("abort", onAbort, { once: true });
			work.then(
				(value) => {
					signal.removeEventListener("abort", onAbort);
					resolve(value);
				},
				(error) => {
					signal.removeEventListener("abort", onAbort);
					reject(error);
				},
			);
		});

	/**
	 * Normal stream or compaction prepare: waits only for the remaining part of the setup budget (origin of the setup, not now)
	 * while the setup is unsettled. Budget spent: the setup is aborted and never warms after that; the caller goes on without it.
	 */
	const waitForSetup = async (attempt: StartupAttempt | undefined, signal: AbortSignal): Promise<void> => {
		if (!attempt || attempt.settled || attempt.spent) return;
		signal.throwIfAborted();
		const remaining = Math.max(0, PREWARM_WAIT_BUDGET_MS - (now() - attempt.origin));
		let timer: ReturnType<typeof setTimeout> | undefined;
		let onAbort: (() => void) | undefined;
		const outcome = await Promise.race([
			attempt.promise.then(() => "settled" as const),
			new Promise<"expired">((resolve) => {
				timer = setTimeout(() => resolve("expired"), remaining);
			}),
			new Promise<"aborted">((resolve) => {
				onAbort = () => resolve("aborted");
				signal.addEventListener("abort", onAbort, { once: true });
			}),
		]);
		if (timer !== undefined) clearTimeout(timer);
		if (onAbort) signal.removeEventListener("abort", onAbort);
		if (outcome === "aborted") throw abortError();
		if (outcome === "expired") {
			attempt.spent = true;
			attempt.abort.abort();
		}
	};

	const waitForPendingSetups = async (signal: AbortSignal): Promise<void> => {
		await waitForSetup(startup, signal);
		await waitForSetup(idle, signal);
	};

	/**
	 * Options the next run renders (Pi 1.4.0 _prepareRun, read-only): a clone of the base options through the startup projection
	 * channel, the active tools unless the projection edited them, and the hidden declarations of _preparePromptAndToolLoadout.
	 */
	const nextRunOptionsOf = (): NormalizedBuildSystemPromptOptions => {
		const internals = session as unknown as PromptInternals;
		const base = internals._baseSystemPromptOptions;
		if (!base || typeof base !== "object") throw new Error("RQW-codex: session has no normalized base prompt options");
		const request: ProjectionRequest = { options: projectionCloneOf(session, base), model: session.model ? { provider: session.model.provider, id: session.model.id } : undefined };
		const dispatched = [...request.options.selectedTools];
		// A child with its own startup prompt is not projected by the root's channel (its parent's sections and policies never
		// reach it); its base and selected tools are its own. Other sessions keep the projection channel.
		if (pi && lineage.startupSystemPrompt === undefined) {
			pi.events.emit(STARTUP_PROJECTION_CHANNEL, request);
			if (request.error !== undefined) throw new Error(request.error);
		}
		const effective = normalizeRunOptions(request.options);
		const edited = effective.selectedTools.length !== dispatched.length || effective.selectedTools.some((name, index) => name !== dispatched[index]);
		if (!edited) effective.selectedTools = session.getActiveToolNames();
		const hidden = (session as unknown as { _hiddenDeclarations?: unknown })._hiddenDeclarations;
		if (!(hidden instanceof Set)) throw new Error("RQW-codex: session has no hidden declaration set");
		effective.hiddenTools = [...hidden].map(String);
		return effective;
	};

	/**
	 * Idle warm context of the physical session as of now (called after the setup's awaits), shaped as Pi's next normal request is:
	 * an empty transcript carries the effective prompt as its leading system text (the first request's base developer item). Otherwise
	 * the transient request-time message of the next run is appended (Pi 1.4.0 _prepareRun and declareToolChanges): the sections patch
	 * and the tool delta against the replayed transcript, with hidden names dropped as Pi's request projection drops them. A leading
	 * system message is used as it is; a transcript without one gets the active tools as its catalog. A forced startup prompt is
	 * projected as Pi's _installAgentForcedPromptProjection does: one leading system message holding the exact forced text and the
	 * current catalog, the other messages unchanged. The transient messages are not stored, and startup and compaction never use this context.
	 */
	const historyContextOf = (): { context: Context; known: unknown[] } => {
		const physical = convertToLlm(session.sessionManager.buildSessionProjection().messages as never) as unknown as Context["messages"];
		const catalog = declaredCatalogOf(session);
		if (physical.length === 0) {
			return { context: { systemPrompt: lineage.startupSystemPrompt ?? projectStartupPrompt(session, pi), messages: physical, tools: catalog }, known: [] };
		}
		const hidden = hiddenNamesOf(session);
		const pending = pendingSystemMessage(physical, nextRunOptionsOf(), pendingToolChanges(physical, session.agent.state.tools, hidden));
		const all = withHiddenTools(pending ? [...physical, pending as unknown as Context["messages"][number]] : physical, hidden);
		if (lineage.startupSystemPrompt !== undefined && lineage.startupSystemPromptForced === true) {
			const current = getCurrentTools(all as never) as Context["tools"];
			const head = {
				role: "system",
				content: lineage.startupSystemPrompt,
				...(current.length > 0 ? { toolsAdded: current } : {}),
				timestamp: Date.now(),
			} as unknown as Context["messages"][number];
			return { context: { messages: [head, ...all.filter((message) => message.role !== "system")] }, known: [] };
		}
		// The request-time message (last of `all`, hidden names already dropped) is the only part that is not Pi's projection.
		const known = pending ? all.slice(-1) : [];
		return { context: all[0]?.role === "system" ? { messages: all } : { messages: all, tools: catalog }, known };
	};

	/**
	 * Idle setup (explicit or automatic): owner, workspaces, history projection and metadata are tracked before the first await; `valid` is re-checked after each await and before metadata or send; the prewarm
	 * carries the history (never a turn) and its own origin. Failures and aborts end it quietly, with no late metadata or warm.
	 */
	const setupIdle = async (model: Model<Api>, attempt: StartupAttempt, valid: () => boolean): Promise<void> => {
		let ready: { owner: string; state: SessionWireState; transport: SessionTransport; historyInit: HistoryInitialization };
		try {
			ready = await ensureReady(model, attempt.signal);
		} catch {
			return;
		}
		if (!valid()) return;
		let workspaces: Record<string, WorkspaceMetadata>;
		try {
			workspaces = await untilAborted(collectWorkspaces(), attempt.signal);
		} catch {
			return;
		}
		try {
			await assertPrepared(ready, attempt.signal);
		} catch {
			return;
		}
		if (!valid()) return;
		// Snapshot after the awaits: whatever physical messages exist now are projected, before the actual generation may begin.
		let context: Context;
		let known: unknown[];
		try {
			({ context, known } = historyContextOf());
		} catch {
			return;
		}
		const warmOptions = withRunnerHook({ reasoning: session.thinkingLevel === "off" ? undefined : session.thinkingLevel, preparedOwner: ready.owner });
		const snapshot = snapshotOf({
			model,
			context,
			options: warmOptions,
			workspaces,
			historyInit: ready.historyInit,
			rootTurnId: currentRootTurn() ?? (isRootThread() ? undefined : lineage.rootTurnId),
		});
		let armed: CodexStreamOptions;
		try {
			armed = projectedOptions(ready.state, model, context, warmOptions, { ...identity(ready.state), ...snapshot }, known);
		} catch {
			return;
		}
		if (!valid()) return;
		ready.transport.updateMetadata?.(snapshot);
		await ready.transport.prewarm(model, context, { ...armed, prewarmInput: "history", prewarmStartedAt: attempt.origin, signal: attempt.signal }).catch(() => undefined);
	};

	/**
	 * Startup setup: owner, projected prompt, startup workspaces, metadata, then the prewarm is SCHEDULED (never awaited). The
	 * transport waits on the same origin. Failures and aborts end it quietly; an aborted setup never updates metadata or warms.
	 */
	const setupStartup = async (model: Model<Api>, attempt: StartupAttempt): Promise<void> => {
		let ready: { owner: string; state: SessionWireState; transport: SessionTransport; historyInit: HistoryInitialization };
		try {
			ready = await ensureReady(model, attempt.signal);
		} catch {
			// No usable saved login: the normal path stays in charge and reports it; the startup budget is not consumed.
			return;
		}
		if (attempt.signal.aborted || released || !isCurrentModel(model)) return;
		let prompt: string;
		let warmOptions: CodexStreamOptions;
		try {
			// A child's exact forced prompt is what the session really sends; otherwise the projected base.
			prompt = lineage.startupSystemPrompt ?? projectStartupPrompt(session, pi);
			warmOptions = withRunnerHook({ reasoning: session.thinkingLevel === "off" ? undefined : session.thinkingLevel, preparedOwner: ready.owner });
		} catch {
			// A failed projection is never replaced by a stale or stock prompt: no prewarm, the budget is not consumed.
			return;
		}
		// Always cold: no messages, no native base, no projected options. The prewarm never seeds or alters the user history.
		const context: Context = {
			systemPrompt: prompt,
			messages: [],
			tools: declaredCatalogOf(session),
		};
		// Startup has its own workspace capture (never the logical run's), so an abandoned capture holds nothing else.
		let workspaces: Record<string, WorkspaceMetadata>;
		try {
			workspaces = await untilAborted(collectWorkspaces(), attempt.signal);
		} catch {
			return;
		}
		try {
			await assertPrepared(ready, attempt.signal);
		} catch {
			return;
		}
		// Budget spent, release, a newer generation or another selected model: no metadata update and no prewarm.
		if (attempt.signal.aborted || released || !isCurrentModel(model)) return;
		// Startup has its own snapshot: its workspaces are collected now, and it has no turn, time or root turn.
		const snapshot = snapshotOf({ model, context, options: warmOptions, workspaces, historyInit: ready.historyInit, rootTurnId: isRootThread() ? undefined : lineage.rootTurnId });
		ready.transport.updateMetadata?.(snapshot);
		started = true;
		// Prewarm failure only leaves the normal path in charge; the transport already swallows it.
		attempt.pending = ready.transport.prewarm(model, context, { ...warmOptions, prewarmInput: "base", prewarmStartedAt: attempt.origin, signal: attempt.signal }).catch(() => undefined);
	};

	/** Pi's own idle state at this instant (no run, no streaming, no compaction) and this controller's run boundary. */
	const autoIdle = (): boolean => !released && !runActive && session.isIdle && !session.isStreaming && !session.isCompacting;

	const cancelAutoCheck = (): void => {
		if (autoTimer === undefined) return;
		clearTimeout(autoTimer);
		autoTimer = undefined;
	};

	/** A new run or compaction: a new epoch, armed; the scheduled check and any in-flight automatic setup are cancelled. */
	const armAuto = (): void => {
		cancelAutoCheck();
		idle?.abort.abort();
		auto?.abort.abort();
		autoArmed = true;
		autoEpoch++;
	};

	/** Coalesced: at most one zero-delay check is pending; a duplicate completion event for the same transition finds no arm. */
	const scheduleAutoCheck = (): void => {
		if (released || !autoArmed || autoTimer !== undefined) return;
		autoTimer = setTimeout(() => {
			autoTimer = undefined;
			runAutoCheck();
		}, 0);
		autoTimer.unref?.();
	};

	const runAutoCheck = (): void => {
		// Still busy (Pi holds a compaction, a queued run is starting): stays armed; the next public settled or compaction end asks again.
		if (!autoArmed || !autoIdle()) return;
		autoArmed = false;
		const model = session.model;
		if (!isCodexModel(model)) return;
		// A pending startup or explicit idle setup already prepares this idle; the automatic one does not duplicate it.
		if (startup && !startup.settled) return;
		if (idle && !idle.settled) return;
		if (auto && !auto.settled && !auto.abort.signal.aborted) return;
		const abort = new AbortController();
		const epoch = autoEpoch;
		const attempt: StartupAttempt = { origin: now(), abort, signal: AbortSignal.any([lifetime.signal, abort.signal]), promise: Promise.resolve(), settled: false, spent: false };
		// The selected model must still be the captured one after every await: a switch while setup waits never sends the old model.
		const valid = (): boolean => !released && !attempt.signal.aborted && epoch === autoEpoch && autoIdle() && isCurrentModel(model as Model<Api>);
		auto = attempt;
		// Best-effort background setup: its failure is consumed here, never an unhandled rejection.
		attempt.promise = setupIdle(model as Model<Api>, attempt, valid).catch(() => undefined).finally(() => {
			attempt.settled = true;
		});
	};

	const controller: SessionController = {
		policy,
		get threadId() {
			return threadId;
		},
		get rootSessionId() {
			return lineage.rootSessionId;
		},
		get wireState() {
			return owned?.state;
		},
		get lineageSnapshot(): LineageSnapshot {
			const snapshot: LineageSnapshot = { threadId, rootSessionId: lineage.rootSessionId };
			const agentName = agentNameOf();
			if (agentName !== undefined) snapshot.agentName = agentName;
			if (runActive) snapshot.turnId = turnId;
			const rootTurnId = currentRootTurn();
			if (rootTurnId !== undefined) snapshot.rootTurnId = rootTurnId;
			return snapshot;
		},
		captureRunOrigin(origin: { rootTurnId?: string }) {
			if (released) return;
			pendingOrigin = origin.rootTurnId === undefined ? {} : { rootTurnId: origin.rootTurnId };
		},
		prewarmWithHistory() {
			if (released) return Promise.resolve();
			observeCompactionBoundary();
			const model = session.model;
			// Foreign models never touch auth or state. A setup of this controller already in flight is joined, never duplicated.
			if (!isCodexModel(model)) return Promise.resolve();
			if (startup && !startup.settled) return startup.promise;
			if (idle && !idle.settled) return idle.promise;
			if (auto && !auto.settled && !auto.abort.signal.aborted) return auto.promise;
			// Only an idle session is prewarmed: a busy session refuses the new request at invocation.
			if (runActive || session.isStreaming || session.isCompacting) return Promise.resolve();
			const abort = new AbortController();
			const attempt: StartupAttempt = { origin: now(), abort, signal: AbortSignal.any([lifetime.signal, abort.signal]), promise: Promise.resolve(), settled: false, spent: false };
			idle = attempt;
			attempt.promise = setupIdle(model as Model<Api>, attempt, () => !released && !attempt.signal.aborted && autoIdle() && isCurrentModel(model as Model<Api>)).finally(() => {
				attempt.settled = true;
			});
			return attempt.promise;
		},
		modelChange() {
			if (released) return Promise.resolve();
			startup?.abort.abort();
			idle?.abort.abort();
			auto?.abort.abort();
			return Promise.allSettled([startup?.promise, startup?.pending, idle?.promise, auto?.promise]).then(() => undefined);
		},
		start() {
			if (released) return Promise.resolve();
			sealed = true;
			observeCompactionBoundary();
			// One latched or spent attempt only; an unsettled attempt is shared by every concurrent start call.
			if (started || startup?.spent) return Promise.resolve();
			if (startup && !startup.settled) return startup.promise;
			const model = session.model;
			// Not a Codex model (provider and api): stock Pi behaviour, no transport, no credential and no extra request. Not latched,
			// so a later Codex model selection on this session can still start.
			if (!isCodexModel(model)) return Promise.resolve();
			// The origin and the setup task are recorded before the setup's first await.
			const abort = new AbortController();
			const attempt: StartupAttempt = { origin: now(), abort, signal: AbortSignal.any([lifetime.signal, abort.signal]), promise: Promise.resolve(), settled: false, spent: false };
			startup = attempt;
			attempt.promise = setupStartup(model as Model<Api>, attempt).finally(() => {
				attempt.settled = true;
			});
			return attempt.promise;
		},
		updateLineage(next: SessionLineage) {
			if (released) throw new Error("RQW-codex: session controller is released");
			if (sealed) throw new Error("RQW-codex: lineage must be set before start()");
			if (next.rootSessionId !== undefined) lineage.rootSessionId = next.rootSessionId;
			if ("parentThreadId" in next) lineage.parentThreadId = next.parentThreadId;
			if ("subagentKind" in next) lineage.subagentKind = next.subagentKind;
			if ("startupSystemPrompt" in next) lineage.startupSystemPrompt = next.startupSystemPrompt;
			if ("startupSystemPromptForced" in next) lineage.startupSystemPromptForced = next.startupSystemPromptForced;
			if ("agentName" in next) lineage.agentName = next.agentName;
			if ("parentTurnId" in next) lineage.parentTurnId = next.parentTurnId;
			if ("rootTurnId" in next) {
				// The birth root is also the pending origin of the first run.
				lineage.rootTurnId = next.rootTurnId;
				pendingOrigin = next.rootTurnId === undefined ? undefined : { rootTurnId: next.rootTurnId };
			}
		},
		contextFork(request) {
			if (released || request.sessionId !== threadId) return;
			return transport?.contextFork?.(request);
		},
		stream(model, context, streamOptions) {
			if (released) throw new Error("RQW-codex: session controller is released");
			requireCodexModel(model);
			// Caller hook identities and option values are retained; the owner binding (preparedOwner) and optional nativeInput are added. A real agent's onPayload already carries Pi's before_provider_request chain (sdk.js).
			// The owner and durable state are resolved first, so the stream is lazy; setup failures end it with one error event.
			return lazyStream(model, async () => {
				const signal = streamOptions?.signal ? AbortSignal.any([streamOptions.signal, lifetime.signal]) : lifetime.signal;
				observeCompactionBoundary();
				// The first normal stream sees the startup setup and waits only for its remaining budget (never a second 15 s).
				await waitForPendingSetups(signal);
				const ready = await ensureReady(model, signal);
				// One snapshot per request, applied before the stream starts; the projection and the body share its identity.
				const preparedOptions: CodexStreamOptions = { ...(streamOptions ?? {}), preparedOwner: ready.owner };
				const snapshot = snapshotOf({
					model,
					context,
					options: streamOptions ?? {},
					workspaces: await untilAborted(workspacesFor(), signal),
					historyInit: ready.historyInit,
					turnStartedAtUnixMs: runActive ? turnStartedAt : undefined,
					rootTurnId: currentRootTurn(),
				});
				if (signal.aborted) throw abortError();
				await assertPrepared(ready, signal);
				ready.transport.updateMetadata?.(snapshot);
				const armed = projectedOptions(ready.state, model, context, preparedOptions, { ...identity(ready.state), ...snapshot });
				return ready.transport.stream(model, context, armed);
			});
		},
		afterPiCompaction() {
			if (released) return;
			observeCompactionBoundary();
		},
		release,
	};
	const portable = installPortableHistory(session, {
		hasNativeCheckpoint: () => {
			const loaded = owned?.state.history.load();
			return loaded?.mode === "native" && loaded.checkpointEntryId !== null;
		},
	});
	// Automatic idle prewarm, after the controller exists (the deferred check reads it only when it fires). One public listener:
	// agent_start / compaction_start arm; agent_settled (Pi _emitAgentSettled: after retries, compaction and queue, not agent_end) and
	// a successful compaction_end schedule ONE zero-delay check. Only that check consumes the arm, and only when actually idle.
	unsubscribeAuto = typeof session.subscribe === "function" ? session.subscribe((event) => {
		if (released) return;
		const item = event as { type: string; aborted?: boolean; result?: unknown };
		if (item.type === "agent_start" || item.type === "compaction_start") armAuto();
		else if (item.type === "agent_settled") {
			// An aborted settled never warms automatically; the arm is dropped until the next start.
			if (item.aborted) {
				autoArmed = false;
				cancelAutoCheck();
			} else scheduleAutoCheck();
		} else if (item.type === "compaction_end" && item.aborted !== true && item.result !== undefined) {
			observeCompactionBoundary();
			scheduleAutoCheck();
		}
	}) : undefined;
	return controller;
}
