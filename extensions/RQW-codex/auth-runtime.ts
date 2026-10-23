import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import type { AuthResult, CredentialStore } from "@earendil-works/pi-ai";
import { VERSION, type ModelRuntime } from "@earendil-works/pi-coding-agent";

import { resolveStoredCredential, validateSubscriptionEndpoint } from "./auth-boundary.ts";
import { AuthRecoveryError, LOGIN_HELP } from "./auth.ts";
import { mergeHeaders } from "./headers.ts";
import { CODEX_API } from "./profile.ts";

/** Provenance of a resolved stored bearer, attached to prepared request options before any payload hook runs. */
export const CODEX_AUTH_ORIGIN = Symbol.for("rqw-codex/auth-origin");
/** Entry contract of one request: the native `stream` or the legacy `streamSimple` path. */
export const CODEX_STREAM_CONTRACT = Symbol.for("rqw-codex/stream-contract");
/** Internal link from a wrapper layer to the value it wraps; lets a re-install recognise its own layer. */
const LAYER_INNER = Symbol.for("rqw-codex/inner");

const CODEX_PROVIDER = "openai-codex";
const CODEX_BASE_URL = "https://chatgpt.com/backend-api";

export type CodexStreamContract = "native" | "simple";
export type CodexAuthOrigin = {
	readonly provider: typeof CODEX_PROVIDER;
	readonly accountId: string;
	/** Digest of the access token that was resolved; the token itself is never stored here. */
	readonly accessRevision: string;
	/** Only a bearer resolved from the stored subscription login carries this origin. */
	readonly source: "resolved-bearer";
};

type Fn = (this: unknown, ...args: unknown[]) => unknown;
type Layer = {
	target: object;
	name: string;
	make(inner: Fn, layer: Layer): Fn;
	installed: boolean;
	active: boolean;
	wrapper?: Fn;
	own?: PropertyDescriptor;
};
type Resolution = { apiKey: string; origin: CodexAuthOrigin };
/** Per-call frame: records the stored-bearer resolution made inside one prepareRequest for its own runtime. */
type Frame = { models: object; resolution?: Resolution };
/** `owned` is the caller's predicate: true only while the runtime's current openai-codex registration is the owned one. */
type RuntimeState = { store: CredentialStore; count: number; layers: Layer[]; owned: () => boolean };

const STATES = new WeakMap<object, RuntimeState>();
const FRAMES = new AsyncLocalStorage<Frame>();

function digest(access: string): string {
	return createHash("sha256").update(access).digest("hex").slice(0, 16);
}

/** Exact Pi 1.4.0 seams and a credential store with read and modify. Checked before anything is patched. */
function assertPi(runtime: ModelRuntime, store: CredentialStore): void {
	const target = runtime as unknown as Record<string, unknown>;
	const models = (runtime as unknown as { models?: Record<string, unknown> }).models;
	const names = ["getAuth", "prepareRequest", "stream", "streamSimple", "composeProvider"] as const;
	const candidate = store as unknown as Record<string, unknown> | undefined;
	const ok = VERSION === "1.4.0"
		&& names.every(name => typeof target[name] === "function")
		&& typeof models?.getAuth === "function"
		&& typeof candidate?.read === "function" && typeof candidate?.modify === "function";
	const configurable = [[target, "prepareRequest"], [target, "stream"], [target, "streamSimple"], [target, "composeProvider"], [models, "getAuth"]]
		.every(([object, name]) => {
			const own = Object.getOwnPropertyDescriptor(object as object, name as string);
			return own === undefined || own.configurable === true;
		});
	if (!ok || !configurable) throw new Error("RQW-codex: incompatible Pi auth seams (requires Pi 1.4.0). Nothing was patched.");
}

/**
 * The stored subscription bearer for one call. Policy: JWT exp within five minutes, or no exp and last_refresh
 * older than eight days, refreshes once under the store lock; Pi's stored-expiry resolver never runs. The only
 * accepted explicit key is the exact resolved bearer. Env OPENAI_API_KEY and ambient keys are never used.
 */
async function resolveBearer(store: CredentialStore, providerOrModel: unknown, overrides: { apiKey?: string; env?: Record<string, string | undefined>; signal?: AbortSignal } | undefined): Promise<{ apiKey: string; accountId: string; origin: CodexAuthOrigin }> {
	const model = typeof providerOrModel === "string" ? undefined : providerOrModel as { baseUrl?: string };
	// Origin validation of the destination always runs; the subscription host is the only one allowed.
	validateSubscriptionEndpoint(model?.baseUrl ?? CODEX_BASE_URL, { env: overrides?.env });
	const signal = overrides?.signal ?? new AbortController().signal;
	const { credential, accountId } = await resolveStoredCredential(store, signal);
	if (overrides?.apiKey !== undefined && overrides.apiKey !== credential.access) {
		throw new AuthRecoveryError(`${LOGIN_HELP} An explicit API key cannot replace the saved subscription login. Request not sent.`, true);
	}
	return {
		apiKey: credential.access,
		accountId,
		origin: { provider: CODEX_PROVIDER, accountId, accessRevision: digest(credential.access), source: "resolved-bearer" },
	};
}

/** Native scope: the openai-codex provider on the openai-codex-responses API only; other APIs sharing the provider stay stock. */
function isCodexNative(model: unknown): boolean {
	const m = model as { provider?: string; api?: string } | undefined;
	return m?.provider === CODEX_PROVIDER && m.api === CODEX_API;
}

function layersFor(runtime: ModelRuntime, store: CredentialStore, owned: () => boolean): Layer[] {
	const models = (runtime as unknown as { models: object }).models;
	const contract = (name: string, value: CodexStreamContract): Layer => ({
		target: runtime, name, installed: false, active: false,
		make: (inner, layer) => function (this: unknown, model: unknown, context: unknown, options: unknown) {
			if (!layer.active || !owned() || !isCodexNative(model)) return inner.call(this, model, context, options);
			const tagged = { ...((options ?? {}) as Record<PropertyKey, unknown>), [CODEX_STREAM_CONTRACT]: value };
			return inner.call(this, model, context, tagged);
		},
	});
	return [
		{
			target: models, name: "getAuth", installed: false, active: false,
			make: (inner, layer) => async function (this: unknown, providerOrModel: unknown, overrides: unknown) {
				const providerId = typeof providerOrModel === "string" ? providerOrModel : (providerOrModel as { provider?: string } | undefined)?.provider;
				const native = typeof providerOrModel === "string" || isCodexNative(providerOrModel);
				if (!layer.active || !owned() || providerId !== CODEX_PROVIDER || !native) return inner.call(this, providerOrModel, overrides);
				const bearer = await resolveBearer(store, providerOrModel, overrides as never);
				const frame = FRAMES.getStore();
				if (frame?.models === models) frame.resolution = { apiKey: bearer.apiKey, origin: bearer.origin };
				const configured = typeof providerOrModel === "string" ? undefined : (providerOrModel as { headers?: Record<string, string> }).headers;
				// Configured headers first; the adapter's own account and bearer last, so no casing variant of them survives.
				// Request-local provenance carrier: Pi's prepareRequest merges env by spread, which keeps this enumerable symbol even
				// when an outer layer reaches the native prepareRequest without this runtime's prepareRequest wrapper.
				const result: AuthResult = {
					auth: { apiKey: bearer.apiKey, headers: mergeHeaders(configured, { "chatgpt-account-id": bearer.accountId, Authorization: `Bearer ${bearer.apiKey}` }) },
					env: { [CODEX_AUTH_ORIGIN]: bearer.origin },
					source: "OAuth",
				};
				return result;
			},
		},
		{
			target: runtime, name: "prepareRequest", installed: false, active: false,
			make: (inner, layer) => async function (this: unknown, model: unknown, options: unknown) {
				if (!layer.active || !owned() || !isCodexNative(model)) return inner.call(this, model, options);
				const frame: Frame = { models };
				const prepared = await FRAMES.run(frame, () => inner.call(this, model, options)) as { options: Record<PropertyKey, unknown> };
				// Fail closed: the prepared request must carry exactly the bearer resolved for this call.
				if (!frame.resolution || prepared.options.apiKey !== frame.resolution.apiKey) {
					throw new AuthRecoveryError(`${LOGIN_HELP} The prepared request does not carry the resolved subscription login. Request not sent.`, true);
				}
				prepared.options[CODEX_AUTH_ORIGIN] = frame.resolution.origin;
				return prepared;
			},
		},
		{
			// Instance composition: an owned Codex provider keeps only its device login, even when models.json carries a raw apiKey.
			target: runtime, name: "composeProvider", installed: false, active: false,
			make: (inner, layer) => function (this: unknown, providerId: unknown, ...rest: unknown[]) {
				const provider = inner.call(this, providerId, ...rest) as { auth?: { apiKey?: unknown; oauth?: unknown } } | undefined;
				if (!layer.active || !owned() || providerId !== CODEX_PROVIDER || provider?.auth?.apiKey === undefined) return provider;
				const { apiKey: _rawKey, ...auth } = provider.auth;
				return { ...provider, auth };
			},
		},
		contract("stream", "native"),
		contract("streamSimple", "simple"),
	];
}

/** True when the layer's own wrapper is reachable from the target's current descriptor. */
function chainHas(layer: Layer): boolean {
	let fn = Object.getOwnPropertyDescriptor(layer.target, layer.name)?.value as unknown;
	for (let depth = 0; typeof fn === "function" && depth < 64; depth++) {
		if (fn === layer.wrapper) return true;
		fn = (fn as unknown as Record<symbol, unknown>)[LAYER_INNER];
	}
	return false;
}

function activate(layer: Layer): void {
	if (layer.installed && chainHas(layer)) {
		layer.active = true;
		return;
	}
	const target = layer.target as Record<string, unknown>;
	const inner = target[layer.name];
	if (typeof inner !== "function") throw new Error(`RQW-codex: ${layer.name} is not a function; nothing was patched.`);
	const own = Object.getOwnPropertyDescriptor(layer.target, layer.name);
	const wrapper = layer.make(inner as Fn, layer);
	Object.defineProperty(wrapper, LAYER_INNER, { value: inner });
	Object.defineProperty(layer.target, layer.name, { value: wrapper, writable: true, configurable: true, enumerable: false });
	layer.own = own;
	layer.wrapper = wrapper;
	layer.installed = true;
	layer.active = true;
}

/** Restores our own descriptor only while our wrapper is the top layer; otherwise it stays inert and passes through. */
function deactivate(layer: Layer): void {
	layer.active = false;
	const current = Object.getOwnPropertyDescriptor(layer.target, layer.name);
	if (!layer.wrapper || current?.value !== layer.wrapper) return;
	if (layer.own) Object.defineProperty(layer.target, layer.name, layer.own);
	else delete (layer.target as Record<string, unknown>)[layer.name];
	layer.installed = false;
	layer.wrapper = undefined;
	layer.own = undefined;
}

/**
 * Install the subscription auth boundary on one ModelRuntime instance. Instance-scoped only: the Models
 * collection, prepareRequest, stream and streamSimple of this runtime; prototypes and other runtimes are untouched.
 * Refcounted per runtime: each caller gets a release, and the wrappers stay until the last one is released.
 * Non-codex providers pass through unchanged, Anthropic included.
 */
export function installRuntimeAuth(
	runtime: ModelRuntime,
	store: CredentialStore = (runtime as unknown as { credentials: CredentialStore }).credentials,
	isOwned: () => boolean = () => true,
): () => void {
	let state = STATES.get(runtime);
	if (state && state.store !== store) throw new Error("RQW-codex: this runtime already has auth wrappers for another credential store. Nothing was patched.");
	if (!state) {
		assertPi(runtime, store);
		const created: RuntimeState = { store, count: 0, layers: [], owned: isOwned };
		created.layers = layersFor(runtime, store, () => created.owned());
		state = created;
		STATES.set(runtime, state);
	}
	const live = state;
	// The predicate of the latest installer applies; the owner passes a check of its own current registration.
	live.owned = isOwned;
	if (live.count === 0) {
		const activated: Layer[] = [];
		try {
			for (const layer of live.layers) {
				activate(layer);
				activated.push(layer);
			}
		} catch (error) {
			for (const layer of activated) deactivate(layer);
			throw error;
		}
	}
	live.count++;
	let released = false;
	return () => {
		if (released) return;
		released = true;
		if (--live.count > 0) return;
		for (const layer of live.layers) deactivate(layer);
	};
}
