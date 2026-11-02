import { Agent } from "@earendil-works/pi-agent-core";
import { AgentSession, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";

const key = Symbol.for("rqw-context/live-hooks");
type Slot = { original: Function; run: Function; forward?: Function };
type Registry = WeakMap<object, Map<string, Slot>>;
type Pending = { order: number; ready(): boolean; restore(): void };
let nextSnapshot = 0;
const deferred = new WeakMap<Set<object>, Pending[]>();

function deferRestore(owners: Set<object>, pending: Pending): void {
	let queue = deferred.get(owners);
	if (!queue) {
		queue = [];
		deferred.set(owners, queue);
		const previous = Object.getOwnPropertyDescriptor(owners, "delete");
		const remove = owners.delete;
		const wrapped = function (this: Set<object>, owner: object) {
			const result = remove.call(this, owner);
			while (queue!.length && queue!.at(-1)!.ready()) queue!.pop()!.restore();
			if (queue!.length === 0) {
				deferred.delete(owners);
				if (owners.delete === wrapped) {
					if (previous) Object.defineProperty(owners, "delete", previous);
					else Reflect.deleteProperty(owners, "delete");
				}
			}
			return result;
		};
		Object.defineProperty(owners, "delete", { value: wrapped, configurable: true, writable: true });
	}
	queue.push(pending);
	queue.sort((a, b) => a.order - b.order);
}

/** Restore only RQW-context's slots, keeping earlier layers and unrelated registry entries. */
export function saveContextHooks(): () => void {
	const order = nextSnapshot++;
	const shared = globalThis as { [key]?: Registry; [name: symbol]: any };
	const ownerKey = Symbol.for("rqw-context/owner");
	const owners = new Set<object>(shared[ownerKey] ?? []);
	const liveKey = Symbol.for("rqw-context/live-helpers");
	const backgroundKey = Symbol.for("rqw-context/background");
	const live = shared[liveKey];
	const helpers = live && Object.getOwnPropertyDescriptors(live);
	const background = shared[backgroundKey];
	const backgroundOn = background?.on;
	const targets = [Agent.prototype, AgentSession.prototype, ModelRuntime.prototype, SessionManager.prototype, SettingsManager.prototype];
	const snapshots = targets.map(target => {
		const existing = shared[key]?.get(target);
		const slots = existing ? new Map(existing) : undefined;
		return { target, descriptors: Object.getOwnPropertyDescriptors(target), slots, runs: new Map([...slots ?? []].map(([name, slot]) => [name, slot.run])) };
	});
	let waiting = false;
	const restore = () => {
		const activeOwners: Set<object> = shared[ownerKey] ?? new Set();
		if ([...activeOwners].some(owner => !owners.has(owner))) {
			if (!waiting) {
				waiting = true;
				deferRestore(activeOwners, {
					order,
					ready: () => ![...activeOwners].some(owner => !owners.has(owner)),
					restore: () => { waiting = false; restore(); },
				});
			}
			return;
		}
		if (live && helpers) {
			for (const name of Reflect.ownKeys(live)) if (!Object.hasOwn(helpers, name)) Reflect.deleteProperty(live, name);
			Object.defineProperties(live, helpers);
		}
		if (background) background.on = backgroundOn;
		const registry = shared[key];
		for (const { target, descriptors, slots, runs } of snapshots) {
			const current = registry?.get(target);
			if (!current) continue;
			for (const name of current.keys()) {
				const old = slots?.get(name);
				if (old) { old.run = runs.get(name)!; current.set(name, old); }
				else {
					const slot = current.get(name)!;
					const actual = Object.getOwnPropertyDescriptor(target, name);
					const descriptor = descriptors[name];
					if (actual?.value === descriptor?.value && actual?.get === descriptor?.get && actual?.set === descriptor?.set) {
						current.delete(name);
						continue;
					}
					if (!slot.forward || (actual?.value !== slot.forward && actual?.get !== slot.forward)) {
						slot.run = slot.original;
						continue;
					}
					if (descriptor) Object.defineProperty(target, name, descriptor);
					else Reflect.deleteProperty(target, name);
					current.delete(name);
				}
			}
			if (!slots && current.size === 0) registry?.delete(target);
		}
	};
	return restore;
}
