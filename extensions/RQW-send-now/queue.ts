import { AgentSession, VERSION } from "@earendil-works/pi-coding-agent";

const PATCH = Symbol.for("rqw-send-now/queue");
type Session = { sessionManager: object; getSteeringMessages(): readonly string[] };
type State = { count: number; sessions: WeakMap<object, WeakRef<Session>>; wrapper: Function; original: PropertyDescriptor };
type Prototype = Record<symbol, State | undefined>;

/** Lease the Pi 1.4.0 binding hook without retaining sessions. */
export function installQueue(SessionClass = AgentSession, version = VERSION) {
	const prototype = SessionClass.prototype as unknown as Prototype;
	if (version !== "1.4.0") return { read: (_identity: object) => undefined, release() {} };
	let state = prototype[PATCH];
	if (!state) {
		const original = Object.getOwnPropertyDescriptor(prototype, "_bindExtensionCore");
		if (!original || typeof original.value !== "function" || (!original.configurable && !original.writable)) {
			return { read: (_identity: object) => undefined, release() {} };
		}
		const installed: State = { count: 0, sessions: new WeakMap(), original, wrapper: function(this: Session, ...args: unknown[]) {
			if (installed.count > 0) {
				try {
					const identity = this.sessionManager;
					if (identity && (typeof identity === "object" || typeof identity === "function") && typeof this.getSteeringMessages === "function") {
						installed.sessions.set(identity, new WeakRef(this));
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
			return { read: (_identity: object) => undefined, release() {} };
		}
		state = installed;
	}
	const installed = state;
	installed.count++;
	let released = false;
	return {
		read(identity: object): number | undefined {
			if (released) return undefined;
			try {
				const session = installed.sessions.get(identity)?.deref();
				if (!session || typeof session.getSteeringMessages !== "function") return undefined;
				const messages = session.getSteeringMessages();
				return Array.isArray(messages) && messages.every((message) => typeof message === "string") ? messages.length : undefined;
			} catch { return undefined; }
		},
		release() {
			if (released) return;
			released = true;
			if (--installed.count === 0) {
				installed.sessions = new WeakMap();
				if (Object.getOwnPropertyDescriptor(prototype, "_bindExtensionCore")?.value === installed.wrapper) {
					Object.defineProperty(prototype, "_bindExtensionCore", installed.original);
					delete prototype[PATCH];
				}
			}
		},
	};
}
