// RQW-codex registration: independent owner of the openai-codex provider on each ModelRuntime, plus the child policy binder.
// One owner per registerCodex call. Owners on the same runtime share one provider registration, one auth layer set and one
// runtime-scoped dispatch; each owner keeps its own entries (controllers by thread id) and releases only its own sessions,
// leases and listeners. The owner's root is its first actual root binding; disposing that root closes the owner.
// Session controllers are supplied by the caller (createController); this module never builds a transport itself.
// Imports: this folder, Pi SDK types/runtime and npm packages only.
import type { AssistantMessage, AssistantMessageEventStream, Api, Context, CredentialStore, Model, OAuthCredential, OAuthCredentials, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { VERSION, type AgentSession, type ExtensionAPI, type ModelRuntime } from "@earendil-works/pi-coding-agent";

import { installRuntimeAuth } from "./auth-runtime.ts";
import { loginDevice, refreshCredential } from "./auth.ts";
import { installLifecycle, type Lifecycle, type SessionPolicy } from "./lifecycle.ts";
import { CODEX_API, CODEX_PROVIDER } from "./profile.ts";
import { CONTEXT_FORK_CHANNEL, type ContextForkRequest } from "./context-fork.ts";
import { installSessionCompaction } from "./session-compaction.ts";

/** Child request channel of RQW-agent (same literal; no import across folders). */
export const SESSION_POLICY_CHANNEL = "rqw-codex:session-policy";

/** Explicit idle prewarm request on pi.events: a host asks one session to prewarm its Codex history. Never periodic. */
export const PREWARM_HISTORY_CHANNEL = "rqw-codex:prewarm-with-history";

/** Marks the streamSimple layer this module registers, so a competing unknown adapter is recognised and never overwritten. */
const OWNED = Symbol.for("rqw-codex/registration-owned");
/** Process-wide registry shared by every owner instance (same symbol across copies of this module). */
const SHARED = Symbol.for("rqw-codex/registration");

export type SubagentKind = "collab_spawn" | "review";

export type ControllerLineage = {
	rootSessionId?: string;
	parentThreadId?: string;
	subagentKind?: SubagentKind;
	startupSystemPrompt?: string;
	startupSystemPromptForced?: boolean;
	agentName?: string;
	parentTurnId?: string;
	rootTurnId?: string;
};

/** Read-only snapshot of a bound session's current lineage: its thread, root session, label and current turns. */
export type LineageSnapshot = { threadId: string; rootSessionId: string; agentName?: string; turnId?: string; rootTurnId?: string };

/** Structural surface of a session controller (session.ts satisfies it). Optional members serve controllers that predate them. */
export type RegisteredController = {
	policy: { beginRun(start?: { kind?: "run" | "steer" }): void; endRun(end?: { aborted?: boolean }): void; release(): void };
	start(): Promise<void>;
	updateLineage(lineage: ControllerLineage): void;
	stream(model: Model<Api>, context: Context, options?: unknown): AssistantMessageEventStream;
	contextFork?(request: ContextForkRequest): (() => Promise<AssistantMessage>) | undefined;
	release(): void;
	readonly threadId: string;
	readonly rootSessionId: string;
	readonly lineageSnapshot?: LineageSnapshot;
	captureRunOrigin?(origin: { rootTurnId?: string }): void;
	/** Optional: explicit idle prewarm of the session's Codex history; a controller without it is never prewarmed. */
	prewarmWithHistory?(): Promise<void>;
	/** Optional: cancel pending prewarm after model selection and resolve when it has settled. */
	modelChange?(): Promise<void>;
	/** Drop in-memory continuation after Pi commits a new summary boundary. */
	afterPiCompaction?(): void;
};

export type CreateControllerOptions = {
	session: AgentSession;
	pi: ExtensionAPI;
	installationId: string;
	rootSessionId?: string;
	parentThreadId?: string;
	subagentKind?: SubagentKind;
	/** Exact startup system prompt of a child (the forced prompt the child really sends); absent for the root. */
	startupSystemPrompt?: string;
	/** Internal bridge flag: the startup prompt is forced (Pi's forceSystemPrompt). Absent or false keeps the soft behaviour. */
	startupSystemPromptForced?: boolean;
	agentName?: string;
	parentTurnId?: string;
	rootTurnId?: string;
	store: CredentialStore;
};

/** Request-local transport for a call that carries no session id (direct SDK use). Created per call; holds no shared state. */
export type DirectTransport = {
	stream(model: Model<Api>, context: Context, options?: unknown): AssistantMessageEventStream;
};

export type RegisterCodexOptions = {
	installationId: string;
	createController(options: CreateControllerOptions): RegisteredController;
	createDirectTransport?(): DirectTransport;
};

/** Mutable child request emitted by RQW-agent on pi.events; the binder fills `release` or `error`. */
export type SessionPolicyRequest = {
	session: AgentSession;
	parentThreadId: string;
	kind: SubagentKind;
	/** Optional: the child's exact startup system prompt. Never logged or persisted; absent means the projection path. */
	startupSystemPrompt?: string;
	/** Optional: the startup prompt is forced (Pi's forceSystemPrompt). Only the caller that forces it sets true. */
	startupSystemPromptForced?: boolean;
	/** Optional: the child's actual label (kind#id) in its caller's terms; the agent name is `${parent.agentName}/${childName}`. */
	childName?: string;
	/** Set by this binder: records the root turn of the child's next logical run from the actual caller, synchronously. */
	captureRun?: (callerThreadId?: string) => void;
	/** Install public compaction preparation hooks on the child's own extension API after policy binding. */
	installCompactionHooks?: (api: ExtensionAPI) => void;
	release?: () => void;
	error?: string;
};

/** Mutable prewarm request emitted on pi.events; the owner that holds the session sets `accepted: true` and nothing else. */
export type PrewarmHistoryRequest = {
	/** Optional: the session to prewarm; absent means the owner's root session. */
	threadId?: string;
	accepted?: boolean;
	error?: string;
};

type ProviderConfigInput = Parameters<ModelRuntime["registerProvider"]>[1];

/** One bound session of one owner: its current controller (replaced on a manager id change) and its runtime reference. */
type Entry = {
	session: AgentSession;
	controller: RegisteredController;
	/** Key of the entry in its owner's map: the current controller's thread id. */
	key: string;
	started: boolean;
	done: boolean;
	compacting: boolean;
	summarySignal?: AbortSignal;
	releaseSummary: () => void;
	hookReleases: Set<() => void>;
	unsubscribeCompaction: () => void;
	releaseRuntime: () => void;
};

type OwnerState = {
	entries: Map<string, Entry>;
	records: Set<RuntimeRecord>;
	root?: Entry;
	directs?: () => DirectTransport;
};

type RuntimeRecord = {
	refs: number;
	owners: Set<OwnerState>;
	summaries: WeakMap<AbortSignal, { entry: Entry; owner: OwnerState }>;
	authRelease: () => void;
	saved: ProviderConfigInput | undefined;
	config: ProviderConfigInput;
};

type Shared = {
	records: WeakMap<object, RuntimeRecord>;
	live: Set<RuntimeRecord>;
	lineage: WeakMap<AgentSession, ControllerLineage>;
	owners: Set<OwnerState>;
};

function shared(): Shared {
	const root = globalThis as unknown as Record<symbol, Shared | undefined>;
	if (!root[SHARED]) root[SHARED] = { records: new WeakMap(), live: new Set(), lineage: new WeakMap(), owners: new Set() };
	return root[SHARED]!;
}

/** Exact Pi 1.4.0 check, before anything is patched or registered. */
function assertPi(): void {
	if (VERSION !== "1.4.0") throw new Error(`RQW-codex: incompatible Pi ${VERSION}; requires Pi 1.4.0. Nothing was patched.`);
}

function isOwned(config: ProviderConfigInput | undefined): boolean {
	return config?.streamSimple !== undefined && (config.streamSimple as unknown as Record<symbol, boolean>)[OWNED] === true;
}

/** Device-only subscription login; the stored grant is read, refreshed and validated by auth.ts and never copied here. */
function oauthFor(): NonNullable<ProviderConfigInput["oauth"]> {
	return {
		name: "ChatGPT Subscription (Codex)",
		isSubscription: true,
		login: async (callbacks) => {
			const credential = await loginDevice({
				notify: (event) => {
					if (event.type !== "device_code") return;
					callbacks.onDeviceCode({
						userCode: event.userCode,
						verificationUri: event.verificationUri,
						intervalSeconds: event.intervalSeconds,
						expiresInSeconds: event.expiresInSeconds,
					});
				},
				signal: callbacks.signal,
			});
			return credential as unknown as OAuthCredentials;
		},
		refreshToken: (credentials, signal) => refreshCredential(credentials as unknown as OAuthCredential, signal) as unknown as Promise<OAuthCredentials>,
		getApiKey: (credentials) => credentials.access,
	};
}

/**
 * Takes one reference on the runtime's Codex registration for `owner`; the first reference installs auth layers and the
 * provider. Returns the release of that one reference.
 */
function attach(runtime: ModelRuntime, owner: OwnerState): () => void {
	const all = shared();
	let record = all.records.get(runtime);
	if (!record) {
		const current = runtime.getRegisteredProviderConfig(CODEX_PROVIDER);
		// A competing unknown Codex transport is refused; a registration of another API on this provider is not a Codex adapter.
		if (current !== undefined && !isOwned(current) && current.api === CODEX_API) {
			throw new Error("RQW-codex: openai-codex already has a competing Codex adapter; it was not overwritten. Nothing was registered.");
		}
		const created: RuntimeRecord = { refs: 0, owners: new Set(), summaries: new WeakMap(), authRelease: () => {}, saved: current, config: {} as ProviderConfigInput };
		const streamSimple = (model: Model<Api>, context: Context, options?: unknown): AssistantMessageEventStream => {
			const sessionId = (options as { sessionId?: string } | undefined)?.sessionId;
			if (sessionId === undefined) {
				const factory = [...created.owners].map((item) => item.directs).find((item) => item !== undefined);
				if (!factory) throw new Error("RQW-codex: request has no session id and no direct transport is configured. Request not sent.");
				return factory().stream(model, context, options);
			}
			for (const item of created.owners) {
				const entry = item.entries.get(sessionId);
				if (entry) return entry.controller.stream(model, context, options);
			}
			// Pi's standalone summaries get fresh routing IDs. Only an active Pi compaction may use this auxiliary path.
			const auxiliary = (options as { cacheRetention?: string } | undefined)?.cacheRetention === "none"
				&& /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)
				&& model.provider === CODEX_PROVIDER && model.api === CODEX_API;
			if (auxiliary) {
				const streamOptions = options as SimpleStreamOptions;
				const route = streamOptions.signal ? created.summaries.get(streamOptions.signal) : undefined;
				if (route && !route.entry.done && route.entry.compacting && route.entry.session.modelRuntime === runtime
					&& !streamOptions.signal!.aborted && route.owner.directs) {
					const agent = route.entry.session.agent;
					return route.owner.directs().stream(model, context, {
						...streamOptions,
						onPayload: streamOptions.onPayload ?? agent.onPayload,
						onResponse: streamOptions.onResponse ?? agent.onResponse,
						onProviderStreamEvent: streamOptions.onProviderStreamEvent ?? agent.onProviderStreamEvent,
					});
				}
				// SDK children without extension hooks may use an isolated transport, never another session's callbacks.
				const active = [...created.owners].flatMap((item) => [...item.entries.values()]
					.filter((entry) => !entry.done && entry.compacting && entry.session.modelRuntime === runtime)
					.map((entry) => ({ owner: item, entry })));
				if (active.length === 1 && active[0].entry.summarySignal === undefined
					&& active[0].owner.directs && !streamOptions.signal?.aborted) {
					return active[0].owner.directs().stream(model, context, options);
				}
			}
			throw new Error("RQW-codex: no bound controller for this session id. Request not sent.");
		};
		Object.defineProperty(streamSimple, OWNED, { value: true });
		created.config = { api: CODEX_API as ProviderConfigInput["api"], streamSimple, oauth: oauthFor() };
		// The auth layers only serve the registration this record installs; a later owner replaces it, never this check.
		created.authRelease = installRuntimeAuth(runtime, undefined, () => runtime.getRegisteredProviderConfig(CODEX_PROVIDER)?.streamSimple === streamSimple);
		try {
			runtime.registerProvider(CODEX_PROVIDER, created.config);
		} catch (error) {
			created.authRelease();
			throw error;
		}
		record = created;
		all.records.set(runtime, record);
		all.live.add(record);
	}
	const live = record;
	live.refs++;
	live.owners.add(owner);
	owner.records.add(live);
	let done = false;
	return () => {
		if (done) return;
		done = true;
		if (--live.refs > 0) return;
		all.records.delete(runtime);
		all.live.delete(live);
		live.authRelease();
		// Restore only when the current registration is still ours; a competing overlay is left in place.
		const current = runtime.getRegisteredProviderConfig(CODEX_PROVIDER);
		if (isOwned(current) && current?.streamSimple === live.config.streamSimple) {
			runtime.unregisterProvider(CODEX_PROVIDER);
			if (live.saved !== undefined) runtime.registerProvider(CODEX_PROVIDER, live.saved);
		}
	};
}

/**
 * Registers this owner's openai-codex layer. Returns the owner's release: it releases every session binding, lease and
 * listener of this owner, and each runtime's provider and auth layers only when no owner remains on that runtime.
 * Idempotent. The release is also called when the owner's root session is disposed.
 */
export function registerCodex(pi: ExtensionAPI, options: RegisterCodexOptions): () => void {
	assertPi();
	const all = shared();
	const owner: OwnerState = { entries: new Map(), records: new Set(), directs: options.createDirectTransport };
	let closed = false;
	all.owners.add(owner);

	const findEntry = (session: AgentSession): Entry | undefined => {
		for (const entry of owner.entries.values()) if (entry.session === session) return entry;
		return undefined;
	};

	/** Starts the controller once, only for a Codex native model; other models never start a prewarm. */
	const startIfCodex = (entry: Entry, model?: Model<Api>) => {
		if (entry.done || entry.started || closed) return;
		const current = model ?? entry.session.model;
		if (current?.provider !== CODEX_PROVIDER || current.api !== CODEX_API) return;
		entry.started = true;
		void entry.controller.start().catch(() => undefined);
	};

	/** Releases one entry: its controller and its runtime reference. Releasing the root closes the owner. */
	const releaseEntry = (entry: Entry): void => {
		if (entry.done) return;
		entry.done = true;
		entry.releaseSummary();
		for (const off of entry.hookReleases) off();
		entry.hookReleases.clear();
		entry.unsubscribeCompaction();
		if (owner.entries.get(entry.key) === entry) owner.entries.delete(entry.key);
		try {
			entry.controller.release();
		} finally {
			entry.releaseRuntime();
		}
		if (owner.root === entry) closeOwner();
	};

	const createEntry = (session: AgentSession, lineage: ControllerLineage): Entry => {
		const runtime = session.modelRuntime;
		const releaseRuntime = attach(runtime, owner);
		let controller: RegisteredController;
		try {
			controller = options.createController({
				session,
				pi,
				installationId: options.installationId,
				rootSessionId: lineage.rootSessionId,
				parentThreadId: lineage.parentThreadId,
				subagentKind: lineage.subagentKind,
				startupSystemPrompt: lineage.startupSystemPrompt,
				startupSystemPromptForced: lineage.startupSystemPromptForced,
				agentName: lineage.agentName,
				parentTurnId: lineage.parentTurnId,
				rootTurnId: lineage.rootTurnId,
				store: (runtime as unknown as { credentials: CredentialStore }).credentials,
			});
		} catch (error) {
			releaseRuntime();
			throw error;
		}
		const entry: Entry = { session, controller, key: controller.threadId, started: false, done: false,
			compacting: false, releaseSummary: () => {}, hookReleases: new Set(), unsubscribeCompaction: () => {}, releaseRuntime };
		entry.unsubscribeCompaction = session.subscribe((event) => {
			if (event.type === "compaction_start") entry.compacting = true;
			else if (event.type === "compaction_end") {
				entry.releaseSummary();
				entry.compacting = false;
				if (event.result && !event.aborted) entry.controller.afterPiCompaction?.();
			}
		});
		owner.entries.set(entry.key, entry);
		return entry;
	};

	/** Replaces the current controller of the root when the session's manager id changed (/new, /resume, /fork). */
	const rebind = (entry: Entry): void => {
		const next = options.createController({
			session: entry.session,
			pi,
			installationId: options.installationId,
			store: (entry.session.modelRuntime as unknown as { credentials: CredentialStore }).credentials,
		});
		const previous = entry.controller;
		entry.releaseSummary();
		if (owner.entries.get(entry.key) === entry) owner.entries.delete(entry.key);
		previous.release();
		entry.controller = next;
		entry.key = next.threadId;
		entry.started = false;
		entry.compacting = false;
		owner.entries.set(entry.key, entry);
	};

	const policyFor = (session: AgentSession): SessionPolicy => {
		if (closed) throw new Error("RQW-codex: owner is released; session not bound.");
		const lineage = all.lineage.get(session) ?? {};
		const entry = createEntry(session, lineage);
		if (owner.root === undefined && lineage.parentThreadId === undefined) owner.root = entry;
		// The policy closures read the entry's current controller, so a rebind is followed without re-binding.
		return {
			beginRun: (start) => entry.controller.policy.beginRun(start),
			endRun: (end) => entry.controller.policy.endRun(end),
			release: () => releaseEntry(entry),
		};
	};

	const lifecycle: Lifecycle = installLifecycle(pi, policyFor);
	const entryForContext = (ctx: { sessionManager: unknown }) => [...owner.entries.values()]
		.find((entry) => !entry.done && entry.session.sessionManager === ctx.sessionManager);
	const prepareSummary = (entry: Entry, signal: AbortSignal): void => {
		entry.releaseSummary();
		const record = all.records.get(entry.session.modelRuntime);
		if (!record || signal.aborted) return;
		record.summaries.set(signal, { entry, owner });
		entry.summarySignal = signal;
		const release = () => {
			record.summaries.delete(signal);
			if (entry.summarySignal === signal) entry.summarySignal = undefined;
			signal.removeEventListener("abort", release);
			if (entry.releaseSummary === release) entry.releaseSummary = () => {};
		};
		entry.releaseSummary = release;
		signal.addEventListener("abort", release, { once: true });
	};
	const offCompaction = installSessionCompaction(pi, {
		accepts: (ctx) => !closed && entryForContext(ctx) !== undefined,
		prepare: (event, ctx) => prepareSummary(entryForContext(ctx)!, event.signal),
		onCompacted: (ctx) => entryForContext(ctx)?.controller.afterPiCompaction?.(),
		onFinished: (ctx) => entryForContext(ctx)?.releaseSummary(),
	});

	/** Closes this owner once: its listeners, its lifecycle lease, then any entry the lease did not release. */
	function closeOwner(): void {
		if (closed) return;
		closed = true;
		offCompaction();
		offChild();
		offPrewarm();
		offFork();
		all.owners.delete(owner);
		for (const record of owner.records) record.owners.delete(owner);
		owner.records.clear();
		try {
			lifecycle.release();
		} finally {
			for (const entry of [...owner.entries.values()]) releaseEntry(entry);
		}
	}

	// Main sessions: only the owner's root, only when its session manager is the one Pi is starting.
	pi.on("session_start", (_event, ctx) => {
		if (closed) return;
		const root = owner.root;
		if (!root || root.done) return;
		if (ctx.sessionManager !== root.session.sessionManager) return;
		if (root.controller.threadId !== root.session.sessionId) rebind(root);
		startIfCodex(root);
	});

	// Model choice after startup can make a Codex prewarm appropriate; a non-Codex choice never starts one.
	pi.on("model_select", async (event, ctx) => {
		if (closed) return;
		await entryForContext(ctx)?.controller.modelChange?.();
		const root = owner.root;
		if (!root || root.done) return;
		startIfCodex(root, (event as unknown as { model?: Model<Api> }).model);
	});

	/** Records the root turn of a child's next logical run from its actual caller's current turn; an absent turn records none. */
	const originFrom = (child: Entry, callerThreadId: string): void => {
		if (closed || child.done) return;
		const caller = [...all.owners].map((item) => item.entries.get(callerThreadId)).find((e) => e !== undefined && !e.done && e.session.modelRuntime === child.session.modelRuntime);
		if (!caller) return;
		const snapshot = caller.controller.lineageSnapshot;
		child.controller.captureRunOrigin?.(snapshot?.turnId === undefined ? {} : { rootTurnId: snapshot.rootTurnId ?? snapshot.turnId });
	};

	const offFork = pi.events.on(CONTEXT_FORK_CHANNEL, (raw) => {
		if (closed) return;
		const request = raw as ContextForkRequest;
		if (request.model?.provider !== CODEX_PROVIDER || request.model.api !== CODEX_API || request.signal.aborted) return;
		const entry = owner.entries.get(request.sessionId);
		if (!entry || entry.done) return;
		let infer;
		try { infer = entry.controller.contextFork?.(request); } catch { return; }
		if (infer) request.offer(infer);
	});

	const offPrewarm = pi.events.on(PREWARM_HISTORY_CHANNEL, (raw) => {
		if (closed) return;
		const request = raw as PrewarmHistoryRequest;
		if (request.accepted !== undefined || request.error !== undefined) return;
		// Only the owner that holds the requested live session answers; unknown or foreign threads stay unanswered for other owners.
		const entry = request.threadId === undefined ? owner.root : owner.entries.get(request.threadId);
		if (!entry || entry.done) return;
		const model = entry.session.model;
		if (model?.provider !== CODEX_PROVIDER || model.api !== CODEX_API) return;
		const controller = entry.controller;
		if (typeof controller.prewarmWithHistory !== "function") return;
		request.accepted = true;
		// Fire-and-forget: a failed prewarm is ignored here; the controller decides when it is safe to run.
		void controller.prewarmWithHistory().catch(() => undefined);
	});

	const offChild = pi.events.on(SESSION_POLICY_CHANNEL, (raw) => {
		if (closed) return;
		const request = raw as SessionPolicyRequest;
		if (request.release !== undefined || request.error !== undefined) return;
		if (request.kind !== "collab_spawn" && request.kind !== "review") {
			request.error = "RQW-codex: unknown subagent kind. Child not bound.";
			return;
		}
		const child = request.session;
		const runtime = child.modelRuntime;
		const parentOf = (item: OwnerState) => {
			const entry = item.entries.get(request.parentThreadId);
			return entry && entry.session.modelRuntime === runtime && !entry.done ? entry : undefined;
		};
		const parent = parentOf(owner);
		if (!parent) {
			// Another owner that holds this parent on the same runtime answers the request; this owner stays silent.
			if ([...all.owners].some((item) => item !== owner && parentOf(item) !== undefined)) return;
			request.error = "RQW-codex: unknown parent session for this runtime. Child not bound.";
			return;
		}
		try {
			const startupSystemPrompt = typeof request.startupSystemPrompt === "string" ? request.startupSystemPrompt : undefined;
			const startupSystemPromptForced = startupSystemPrompt !== undefined && request.startupSystemPromptForced === true ? true : undefined;
			// The parent's turns are read now, at bind; the lineage they give is immutable for this child.
			const snapshot = parent.controller.lineageSnapshot;
			const parentAgent = snapshot?.agentName;
			const agentName = typeof parentAgent === "string" && typeof request.childName === "string" ? `${parentAgent}/${request.childName}` : undefined;
			const lineage: ControllerLineage = {
				rootSessionId: parent.controller.rootSessionId, parentThreadId: request.parentThreadId, subagentKind: request.kind, startupSystemPrompt, startupSystemPromptForced,
				agentName, parentTurnId: snapshot?.turnId, rootTurnId: snapshot?.rootTurnId ?? snapshot?.turnId,
			};
			let entry = findEntry(child);
			if (entry) {
				// Already bound by this owner (generic same-runtime bind): the lineage is set before its start.
				if (entry.started) throw new Error("RQW-codex: child session already started. Child not bound.");
				entry.controller.updateLineage(lineage);
			} else {
				all.lineage.set(child, lineage);
				lifecycle.bindSession(child);
				entry = findEntry(child);
				if (!entry) throw new Error("RQW-codex: child session is bound to another owner. Child not bound.");
			}
			const bound = entry;
			// Initial root origin of this child: the caller is its creation parent.
			originFrom(bound, request.parentThreadId);
			request.captureRun = (callerThreadId) => originFrom(bound, callerThreadId ?? request.parentThreadId);
			let hooksInstalled = false;
			request.installCompactionHooks = (api) => {
				if (closed || bound.done || hooksInstalled) return;
				hooksInstalled = true;
				// A child has its own extension runner: its model selection must cancel the same controller's pending prewarm.
				bound.hookReleases.add(api.on("model_select", async () => {
					if (!bound.done) await bound.controller.modelChange?.();
				}));
				bound.hookReleases.add(installSessionCompaction(api, {
					accepts: (ctx) => !bound.done && ctx.sessionManager === bound.session.sessionManager,
					prepare: (event) => prepareSummary(bound, event.signal),
					onCompacted: () => bound.controller.afterPiCompaction?.(),
					onFinished: () => bound.releaseSummary(),
				}));
			};
			request.release = () => {
				request.captureRun = undefined;
				request.installCompactionHooks = undefined;
				releaseEntry(bound);
			};
			startIfCodex(bound);
		} catch (error) {
			request.error = error instanceof Error ? error.message : String(error);
		}
	});

	return closeOwner;
}
