import { AgentSession, VERSION } from "@earendil-works/pi-coding-agent";
import type { ImageContent } from "@earendil-works/pi-ai";

const PATCH = Symbol.for("rqw-send-now/queue");
const WRAPPED = ["_queueUserInput", "_queueSteer", "prompt"] as const;

/** A user steering message as Pi queued it: the expanded text and its images. */
export type Steer = { text: string; images: ImageContent[] };
type PromptOptions = { streamingBehavior?: string; expandPromptTemplates?: boolean; images?: ImageContent[]; source?: string; preflightResult?: (result: string) => void };
type Session = {
	sessionManager: object; getSteeringMessages(): readonly string[]; followUp?(text: string): Promise<unknown>; isCompacting?: boolean; clearQueue?(): { steering: string[]; followUp: string[] };
	isStreaming?: boolean; abort?(): Promise<unknown>; _isEmittingAgentSettled?: boolean;
	_steeringMessages?: unknown; agent?: { steeringQueue?: { messages?: unknown } }; _emitQueueUpdate?(): void;
	_queueUserInput?(text: string, images: ImageContent[] | undefined, behavior: string, source: string): Promise<string>;
	_runInputHandlers?(text: string, images: ImageContent[] | undefined, source: string, behavior: string | undefined): Promise<{ text: string; images?: ImageContent[] } | undefined>;
	_queueSteer?(text: string, images?: ImageContent[]): Promise<void>;
	_startRun?(trigger: { messageType: "user"; prompt: string; images?: ImageContent[] }, onStarted?: () => void): Promise<void>;
	_extensionRunner?: { getCommand?(name: string): unknown };
};
/** Per session: the steering inputs still on their way into Pi's queue, and the sink that takes late ones during a force-send. */
type Tracker = { inflight: Set<Promise<unknown>>; listeners: Set<() => void>; capture?: (steer: Steer) => boolean; own: Map<string, Function> };
type State = { count: number; sessions: WeakMap<object, WeakRef<Session>>; trackers: WeakMap<Session, Tracker>; instrumented: Set<WeakRef<Session>>; wrapper: Function; original: PropertyDescriptor };
type Prototype = Record<symbol, State | undefined>;
type Queues = { display: string[]; delivery: unknown[]; emit: () => void };
export type Force = { taken: Steer[]; aborted: Promise<void>; settled: Promise<void>; release(): void };

const none = { start: (_identity: object, _text: string, _images: ImageContent[], _onStarted: () => void) => undefined as Promise<void> | undefined, session: (_identity: object) => undefined as Session | undefined, steering: (_identity: object) => undefined as { queued: number; inflight: number } | undefined, watch: (_identity: object, _listener: () => void) => () => {}, force: (_identity: object, _sink: (steer: Steer) => boolean) => undefined as Force | undefined, release() {} };

/** Pi's queues as arrays, or undefined when their shape is not the 1.4.0 one. */
function queuesOf(session: Session): Queues | undefined {
	const display = session._steeringMessages, delivery = session.agent?.steeringQueue?.messages;
	if (!Array.isArray(display) || !Array.isArray(delivery) || typeof session._emitQueueUpdate !== "function") return undefined;
	return { display, delivery, emit: () => session._emitQueueUpdate!() };
}

function steerOf(message: any): Steer | undefined {
	if (message?.role !== "user" || !Array.isArray(message.content)) return undefined;
	const [first, ...rest] = message.content;
	if (first?.type !== "text" || typeof first.text !== "string") return undefined;
	return { text: first.text, images: rest.filter((part: any) => part?.type === "image") };
}

/** The user steering messages: delivery entries whose text is also in the display list, one display entry each. */
function userSteers(queues: Queues): { at: number; steer: Steer }[] {
	const display = [...queues.display];
	const found: { at: number; steer: Steer }[] = [];
	queues.delivery.forEach((message, at) => {
		const steer = steerOf(message);
		const shown = steer ? display.indexOf(steer.text) : -1;
		if (!steer || shown === -1) return;
		display.splice(shown, 1);
		found.push({ at, steer });
	});
	return found;
}

function isExtensionCommand(session: Session, text: string): boolean {
	if (!text.startsWith("/")) return false;
	const runner = session._extensionRunner;
	return typeof runner?.getCommand !== "function" || runner.getCommand(text.slice(1).split(" ")[0]) !== undefined;
}

/** Input handlers, then the steer queue, without skill or template expansion. */
async function queueAsIs(session: Session, text: string, images: ImageContent[] | undefined, source: string): Promise<string> {
	const processed = await session._runInputHandlers!(text, images, source, "steer");
	if (!processed) return "handled";
	await session._queueSteer!(processed.text, processed.images);
	return "queued";
}

/** Wraps three methods on the session itself; each calls what the prototype has at call time, so other wrappers stay. */
function instrument(state: State, session: Session) {
	if (state.trackers.has(session)) return;
	const prototype = Object.getPrototypeOf(session);
	if (WRAPPED.some((name) => typeof prototype[name] !== "function")) return;
	const tracker: Tracker = { inflight: new Set(), listeners: new Set(), own: new Map() };
	const next = (name: string): Function => Object.getPrototypeOf(session)[name];
	const notify = () => { for (const listener of tracker.listeners) { try { listener(); } catch { /* A display cannot break Pi's queue. */ } } };
	const track = (run: Promise<unknown>) => {
		tracker.inflight.add(run);
		notify();
		const done = () => { tracker.inflight.delete(run); notify(); };
		run.then(done, done);
	};
	tracker.own.set("_queueUserInput", function (this: Session, text: string, images: unknown, behavior: string, source: string) {
		const run = next("_queueUserInput").call(this, text, images, behavior, source);
		if (behavior === "steer") track(run);
		return run;
	});
	tracker.own.set("_queueSteer", function (this: Session, text: string, images?: ImageContent[]) {
		// A sink that cannot take the steering (false) leaves it to Pi's queue.
		if (!tracker.capture?.({ text, images: images ?? [] })) return next("_queueSteer").call(this, text, images);
		return Promise.resolve();
	});
	// A busy steer from the editor goes straight to the queue path, so a run that ends while its input handlers
	// await cannot turn it into a separate run. With expansion turned off the text is queued as it is.
	tracker.own.set("prompt", function (this: Session, text: string, options?: PromptOptions) {
		const expand = options?.expandPromptTemplates !== false;
		const redirect = options?.streamingBehavior === "steer" && this.isStreaming === true && !this._isEmittingAgentSettled
			&& (expand ? typeof this._queueUserInput === "function" && !isExtensionCommand(this, text) : typeof this._runInputHandlers === "function" && typeof this._queueSteer === "function");
		if (!redirect) return next("prompt").call(this, text, options);
		const source = options.source ?? "interactive";
		const queued = expand ? this._queueUserInput!(text, options.images, "steer", source) : queueAsIs(this, text, options.images, source);
		if (!expand) track(queued);
		return queued.then((result) => options.preflightResult?.(result));
	});
	for (const [name, value] of tracker.own) Object.defineProperty(session, name, { value, configurable: true, writable: true });
	state.trackers.set(session, tracker);
	state.instrumented.add(new WeakRef(session));
}

/** Lease the Pi 1.4.0 binding hook without retaining sessions. */
export function installQueue(SessionClass = AgentSession, version = VERSION) {
	const prototype = SessionClass.prototype as unknown as Prototype;
	if (version !== "1.4.0") return none;
	let state = prototype[PATCH];
	if (!state) {
		const original = Object.getOwnPropertyDescriptor(prototype, "_bindExtensionCore");
		if (!original || typeof original.value !== "function" || (!original.configurable && !original.writable)) return none;
		const installed: State = { count: 0, sessions: new WeakMap(), trackers: new WeakMap(), instrumented: new Set(), original, wrapper: function(this: Session, ...args: unknown[]) {
			if (installed.count > 0) {
				try {
					const identity = this.sessionManager;
					if (identity && (typeof identity === "object" || typeof identity === "function") && typeof this.getSteeringMessages === "function") {
						installed.sessions.set(identity, new WeakRef(this));
						instrument(installed, this);
					}
				} catch { /* Capture must not affect Pi. */ }
			}
			return original.value.apply(this, args);
		} };
		try {
			Object.defineProperty(prototype, PATCH, { value: installed, configurable: true });
			Object.defineProperty(prototype, "_bindExtensionCore", { ...original, value: installed.wrapper });
		} catch {
			delete prototype[PATCH];
			return none;
		}
		state = installed;
	}
	const installed = state;
	installed.count++;
	let released = false;
	const tracked = (identity: object) => {
		const session = released ? undefined : installed.sessions.get(identity)?.deref();
		const tracker = session && installed.trackers.get(session);
		return session && tracker ? { session, tracker } : undefined;
	};
	return {
		session(identity: object): Session | undefined { return released ? undefined : installed.sessions.get(identity)?.deref(); },
		/** User steering messages queued in Pi and those still on their way; undefined when Pi's shape is not the known one. */
		steering(identity: object): { queued: number; inflight: number } | undefined {
			try {
				const found = tracked(identity);
				const queues = found && queuesOf(found.session);
				return found && queues ? { queued: userSteers(queues).length, inflight: found.tracker.inflight.size } : undefined;
			} catch { return undefined; }
		},
		watch(identity: object, listener: () => void): () => void {
			const tracker = tracked(identity)?.tracker;
			tracker?.listeners.add(listener);
			return () => { tracker?.listeners.delete(listener); };
		},
		/**
		 * Takes the user steering messages out of both queues at once (follow-ups and other messages stay), aborts the
		 * run and routes steering that arrives meanwhile to `sink`, which may refuse it by returning false. `settled` ends when the inputs that were on their
		 * way have finished; `release` ends the routing.
		 */
		force(identity: object, sink: (steer: Steer) => boolean): Force | undefined {
			try {
				const found = tracked(identity);
				const queues = found && queuesOf(found.session);
				if (!found || !queues || typeof found.session.abort !== "function" || typeof found.session._startRun !== "function" || found.tracker.capture) return undefined;
				const picked = userSteers(queues);
				for (const { at } of [...picked].reverse()) queues.delivery.splice(at, 1);
				for (const { steer } of picked) queues.display.splice(queues.display.indexOf(steer.text), 1);
				if (picked.length > 0) queues.emit();
				found.tracker.capture = sink;
				const waiting = [...found.tracker.inflight];
				const aborted = Promise.resolve(found.session.abort()).then(() => {}, () => {});
				const settled = Promise.allSettled(waiting).then(() => {});
				return { taken: picked.map((entry) => entry.steer), aborted, settled, release() { if (found.tracker.capture === sink) found.tracker.capture = undefined; } };
			} catch { return undefined; }
		},
		/** Starts a run with the already prepared text, as Pi's own prompt does after its input handlers; they do not run again. */
		start(identity: object, text: string, images: ImageContent[], onStarted: () => void): Promise<void> | undefined {
			const session = released ? undefined : installed.sessions.get(identity)?.deref();
			if (!session || typeof session._startRun !== "function") return undefined;
			return session._startRun({ messageType: "user", prompt: text, ...(images.length > 0 ? { images } : {}) }, onStarted);
		},
		release() {
			if (released) return;
			released = true;
			if (--installed.count === 0) {
				for (const ref of installed.instrumented) {
					const session = ref.deref(), tracker = session && installed.trackers.get(session);
					if (!session || !tracker) continue;
					for (const [name, value] of tracker.own) if (Object.getOwnPropertyDescriptor(session, name)?.value === value) delete (session as any)[name];
				}
				installed.sessions = new WeakMap();
				installed.trackers = new WeakMap();
				installed.instrumented.clear();
				if (Object.getOwnPropertyDescriptor(prototype, "_bindExtensionCore")?.value === installed.wrapper) {
					Object.defineProperty(prototype, "_bindExtensionCore", installed.original);
					delete prototype[PATCH];
				}
			}
		},
	};
}
