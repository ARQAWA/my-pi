import type { AssistantMessage } from "@earendil-works/pi-ai";
import { AgentSession, VERSION, type ExtensionAPI, type ModelRuntime } from "@earendil-works/pi-coding-agent";
import { isRetryOwnedDiagnostic } from "./retry.ts";

/** Private handler name carried in Pi 1.4.0's native handler map; dispatched with the exact session being constructed. */
export const SESSION_BIND = "rqw-codex:session-bind";

const STATE = Symbol.for("rqw-codex/lifecycle");
/**
 * Shared method-lease contract `rqw:method-chain/v1` (self-contained copy in each RQW extension that wraps a Pi
 * prototype method). One chain per prototype and method: the stock descriptor plus the owner tokens of its layers.
 */
const CHAIN = Symbol.for("rqw:method-chain/v1");
/** Each wrapper layer links to the value it wraps; read at call time, so a rebase of the chain reaches the layer. */
const INNER = Symbol.for("rqw:method-inner");
/** Owner token of a layer; an owner removes only its own layers and never another owner's. */
const OWNER = Symbol.for("rqw:method-owner");
const CODEX_PROVIDER = "openai-codex";
const CODEX_API = "openai-codex-responses";
const PATCHED = ["_bindExtensionCore", "dispose", "_isRetryableError", "subscribe"] as const;

type Cleanup = () => void;
type Fn = (this: AgentSession, ...args: unknown[]) => unknown;
type Link = Fn & { [INNER]?: unknown; [OWNER]?: unknown };
type Chain = { stock: PropertyDescriptor; owners: Set<object> };

export type RunStart = { kind: "run" | "steer" };
export type RunEnd = { aborted: boolean };

/** Callbacks for one bound session. Lifecycle never reads or mutates Codex transport state itself. */
export type SessionPolicy = {
	beginRun?(start: RunStart): void;
	endRun?(end: RunEnd): void;
	release?(): void;
};

export type PolicyFactory = (session: AgentSession) => SessionPolicy;

export type Lifecycle = {
	release(): void;
	bindSession(session: AgentSession): Cleanup;
};

type Binding = { active: boolean };
type Lease = { factory: PolicyFactory; bindings: Set<Cleanup>; released: boolean; runtimes: Set<ModelRuntime>; bindSession(session: AgentSession): Cleanup; release(): void };
type State = {
	active: boolean;
	count: number;
	/** Our newest wrapper; it may be inert below a competing layer that does not cooperate. */
	wrapper?: Link;
	leases: WeakMap<ModelRuntime, Set<Lease>>;
	bindings: WeakMap<AgentSession, Binding>;
};

function sessionClass(): { prototype: AgentSession } & Record<symbol, State | undefined> {
	return AgentSession as unknown as { prototype: AgentSession } & Record<symbol, State | undefined>;
}

/** Exact Pi 1.4.0 seams, checked before anything is patched. */
function assertPi(): void {
	const prototype = AgentSession.prototype as unknown as Record<string, unknown>;
	const bad = PATCHED.filter(name => typeof prototype[name] !== "function");
	const descriptor = Object.getOwnPropertyDescriptor(prototype, "_bindExtensionCore");
	if (VERSION !== "1.4.0" || bad.length || !descriptor?.configurable || typeof descriptor.value !== "function") {
		throw new Error("RQW-codex: incompatible Pi lifecycle; requires Pi 1.4.0. Nothing was patched.");
	}
}

function chainsOf(target: object, create: boolean): Map<string, Chain> | undefined {
	const registry = globalThis as unknown as Record<symbol, WeakMap<object, Map<string, Chain>> | undefined>;
	if (!registry[CHAIN]) {
		if (!create) return undefined;
		registry[CHAIN] = new WeakMap();
	}
	const all = registry[CHAIN]!;
	let chains = all.get(target);
	if (!chains && create) all.set(target, chains = new Map());
	return chains;
}

/** True when `layer` is reachable from the current descriptor value through the inner links. */
function chainHas(target: object, name: string, layer: unknown): boolean {
	let fn = Object.getOwnPropertyDescriptor(target, name)?.value as unknown;
	for (let depth = 0; typeof fn === "function" && depth < 64; depth++) {
		if (fn === layer) return true;
		fn = (fn as Link)[INNER];
	}
	return false;
}

/** Puts `layer` on top of the current value. The layer's inner link is the value it replaces. */
function joinChain(target: object, name: string, owner: object, layer: Link): void {
	const current = Object.getOwnPropertyDescriptor(target, name)!;
	const chains = chainsOf(target, true)!;
	let chain = chains.get(name);
	if (!chain) chains.set(name, chain = { stock: current, owners: new Set() });
	chain.owners.add(owner);
	Object.defineProperty(layer, INNER, { value: current.value, writable: true, configurable: true });
	Object.defineProperty(layer, OWNER, { value: owner });
	Object.defineProperty(target, name, { ...current, value: layer });
}

/**
 * Removes every layer of `owner` that is reachable through cooperating links, rebasing the layer above it onto
 * the layer below. Layers of other owners stay in place, so a survivor keeps working with its updated inner value.
 * When no owner is left and the chain is the stock value again, the exact stock descriptor is restored.
 * An unreachable layer (behind a non-cooperating competitor) stays and passes through while inactive.
 */
function leaveChain(target: object, name: string, owner: object): void {
	const chains = chainsOf(target, false);
	const chain = chains?.get(name);
	if (!chains || !chain) return;
	chain.owners.delete(owner);
	let parent: Link | undefined;
	let node = Object.getOwnPropertyDescriptor(target, name)?.value as unknown;
	for (let depth = 0; typeof node === "function" && depth < 64; depth++) {
		const link = node as Link;
		if (!(INNER in link)) break;
		if (link[OWNER] === owner) {
			const inner = link[INNER];
			if (parent) parent[INNER] = inner;
			else Object.defineProperty(target, name, { ...Object.getOwnPropertyDescriptor(target, name)!, value: inner });
			node = inner;
			continue;
		}
		parent = link;
		node = link[INNER];
	}
	if (chain.owners.size === 0 && Object.getOwnPropertyDescriptor(target, name)?.value === chain.stock.value) {
		Object.defineProperty(target, name, chain.stock);
		chains.delete(name);
	}
}

/**
 * Reference-counted prototype patch. Our layer is removed when the last binding is released; a layer below
 * another owner's layer is rebased, never clobbered. Reloads reuse the live wrapper while it is still reachable.
 */
function acquire(): Cleanup {
	const owner = sessionClass();
	let state = owner[STATE];
	if (!state) {
		assertPi();
		state = { active: false, count: 0, leases: new WeakMap(), bindings: new WeakMap() };
		owner[STATE] = state;
	}
	const live = state;
	const prototype = AgentSession.prototype;
	if (!live.wrapper || !chainHas(prototype, "_bindExtensionCore", live.wrapper)) {
		assertPi();
		const wrapper: Link = function (this: AgentSession, runner: unknown) {
			if (live.active) {
				// Pi's handler map is the exact-session path for the loaded instance.
				const ctx = this.extensionRunner.createContext();
				for (const extension of this.resourceLoader?.getExtensions().extensions ?? []) {
					for (const handler of extension.handlers.get(SESSION_BIND) ?? []) handler({ type: SESSION_BIND, session: this } as never, ctx);
				}
				// Same-runtime generic children bind before Pi's native registration.
				for (const lease of [...(live.leases.get(this.modelRuntime) ?? [])]) lease.bindSession(this);
			}
			return (wrapper[INNER] as Fn).call(this, runner);
		};
		joinChain(prototype, "_bindExtensionCore", live, wrapper);
		live.wrapper = wrapper;
	}
	live.active = true;
	live.count++;
	let done = false;
	return () => {
		if (done) return;
		done = true;
		if (--live.count > 0) return;
		live.active = false;
		leaveChain(prototype, "_bindExtensionCore", live);
	};
}

function currentState(): State {
	const state = sessionClass()[STATE];
	if (!state?.active) throw new Error("RQW-codex: lifecycle is not installed; use installLifecycle first");
	return state;
}

/**
 * Replace one instance method with a wrapper. Returns a restore that removes our own property
 * only while it is still the top layer; otherwise the wrapper stays and passes through.
 */
function patchInstance(session: AgentSession, name: string, wrap: (original: (...args: unknown[]) => unknown) => (...args: unknown[]) => unknown): Cleanup {
	const own = Object.getOwnPropertyDescriptor(session, name);
	const original = (session as unknown as Record<string, (...args: unknown[]) => unknown>)[name];
	const wrapped = wrap(original);
	Object.defineProperty(session, name, { value: wrapped, configurable: true, writable: true, enumerable: false });
	return () => {
		if (Object.getOwnPropertyDescriptor(session, name)?.value !== wrapped) return;
		if (own) Object.defineProperty(session, name, own);
		else delete (session as unknown as Record<string, unknown>)[name];
	};
}

/**
 * Owned Codex diagnostics are retried by the adapter itself; Pi must not retry them again. The carrier is the
 * message's `diagnostics` array (Pi AssistantMessage diagnostics), never its content. Only a message carrying the
 * CODEX_RETRY_OWNED_DIAGNOSTIC item from retry.ts qualifies; other Codex errors keep Pi's behaviour.
 */
function isOwnedCodexDiagnostic(message: unknown): boolean {
	const m = message as Partial<AssistantMessage> | undefined;
	return m?.role === "assistant" && m.stopReason === "error" && m.provider === CODEX_PROVIDER && m.api === CODEX_API
		&& Array.isArray(m.diagnostics) && m.diagnostics.some(item => isRetryOwnedDiagnostic(item));
}

/** Pi's standalone summary helper retries returned errors separately from AgentSession._isRetryableError. */
function suppressSummaryRetries(session: AgentSession): Cleanup {
	const agent = session.agent;
	const original = agent.streamFunction;
	let active = true;
	const wrapped: typeof original = async (model, context, options) => {
		const stream = await original.call(agent, model, context, options);
		if (!active || model.provider !== CODEX_PROVIDER || model.api !== CODEX_API || options?.cacheRetention !== "none"
			|| options.sessionId === session.sessionId) return stream;
		const result = stream.result.bind(stream);
		stream.result = async () => {
			const message = await result();
			if (active && isOwnedCodexDiagnostic(message)) {
				// Reject outside Pi's lazy provider streams, before retryAssistantCall can reuse its budget.
				// Keep Pi 1.4.0's error label for both history and split-turn prefix summaries.
				const content = context.messages.find(item => item.role === "user")?.content;
				const text = typeof content === "string" ? content : content?.find(item => item.type === "text")?.text;
				const label = text?.startsWith("# Conversation\n") ? "Turn prefix summarization" : "Summarization";
				throw new Error(`${label} failed: ${message.errorMessage || "Unknown error"}`);
			}
			return message;
		};
		return stream;
	};
	agent.streamFunction = wrapped;
	return () => {
		active = false;
		if (agent.streamFunction === wrapped) agent.streamFunction = original;
	};
}

/**
 * Bind one policy to one exact session. Instance-level patches only; the prototype is untouched except
 * for the shared reference-counted binder. Returns the release for this binding; it is idempotent.
 */
export function bindSession(session: AgentSession, policy: SessionPolicy): Cleanup {
	const releaseAcquire = acquire();
	const state = currentState();
	if (state.bindings.has(session)) {
		releaseAcquire();
		throw new Error("RQW-codex: session already has a lifecycle binding");
	}
	const binding: Binding = { active: true };
	state.bindings.set(session, binding);
	const restores: Cleanup[] = [];
	let unsubscribe: Cleanup = () => {};
	let releaseSummary: Cleanup = () => {};
	let runActive = false;
	let ownFirstInput = false;
	let released = false;
	const release = () => {
		if (released) return;
		released = true;
		binding.active = false;
		try { policy.release?.(); }
		finally {
			unsubscribe();
			releaseSummary();
			for (const restore of restores.reverse()) restore();
			if (state.bindings.get(session) === binding) state.bindings.delete(session);
			releaseAcquire();
		}
	};
	try {
		restores.push(patchInstance(session, "dispose", original => function (this: unknown, ...args: unknown[]) {
			// Disposal closes exactly this session's resources; other sessions and layers keep working.
			release();
			return original.apply(this, args);
		}));
		restores.push(patchInstance(session, "_isRetryableError", original => function (this: unknown, message: unknown) {
			if (binding.active && isOwnedCodexDiagnostic(message)) return false;
			return original.call(this, message);
		}));
		unsubscribe = session.subscribe(event => {
			if (!binding.active) return;
			const type = (event as { type: string }).type;
			if (type === "compaction_start") {
				releaseSummary();
				releaseSummary = suppressSummaryRetries(session);
			} else if (type === "compaction_end") {
				releaseSummary();
				releaseSummary = () => {};
			} else if (type === "agent_start") {
				runActive = true;
				ownFirstInput = true;
				policy.beginRun?.({ kind: "run" });
			} else if (type === "message_start" && runActive && (event as { message: { role: string } }).message.role === "user") {
				// The first user message of a run is its own input; later ones are steering inside the same run.
				if (ownFirstInput) ownFirstInput = false;
				else policy.beginRun?.({ kind: "steer" });
			} else if (type === "agent_end") {
				runActive = false;
				ownFirstInput = false;
				const messages = (event as { messages: unknown[] }).messages;
				const last = [...messages].reverse().find(m => (m as { role?: string }).role === "assistant") as AssistantMessage | undefined;
				policy.endRun?.({ aborted: last?.stopReason === "aborted" });
			}
		});
		return release;
	} catch (error) {
		release();
		throw error;
	}
}

/** Install the Pi 1.4.0 binder for one loaded extension instance and bind its exact runtime's sessions. */
export function installLifecycle(pi: ExtensionAPI, policyFactory: PolicyFactory): Lifecycle {
	const releaseAcquire = acquire();
	const state = currentState();
	const lease: Lease = {
		factory: policyFactory,
		bindings: new Set(),
		released: false,
		runtimes: new Set(),
		bindSession(session: AgentSession): Cleanup {
			if (lease.released || state.bindings.has(session)) return () => {};
			const runtime = session.modelRuntime;
			const policy = policyFactory(session);
			const release = bindSession(session, { ...policy, release: () => { lease.bindings.delete(cleanup); policy.release?.(); } });
			const cleanup = () => { lease.bindings.delete(cleanup); release(); };
			lease.bindings.add(cleanup);
			let leases = state.leases.get(runtime);
			if (!leases) state.leases.set(runtime, leases = new Set());
			leases.add(lease);
			lease.runtimes.add(runtime);
			return cleanup;
		},
		release() {
			if (lease.released) return;
			lease.released = true;
			try {
				for (const cleanup of [...lease.bindings]) cleanup();
			} finally {
				for (const runtime of lease.runtimes) state.leases.get(runtime)?.delete(lease);
				lease.runtimes.clear();
				releaseAcquire();
			}
		},
	};
	pi.on(SESSION_BIND as "session_start", (event, _ctx) => {
		lease.bindSession((event as unknown as { session: AgentSession }).session);
	});
	return { release: () => lease.release(), bindSession: session => lease.bindSession(session) };
}
