// Process-wide patches of Pi's classes whose behaviour belongs to the newest extension instance.
// Pi keeps the patched classes across /reload, but loads the extension module again. The first instance installs a
// permanent forwarding slot; every later instance only replaces what the slot runs, built over the same Pi original.
// Without an owner the wrappers pass through to Pi's own code.
type Slot = { original: Function; run: Function; forward?: Function };
const LIVE = Symbol.for("rqw-context/live-hooks");
const registry = globalThis as { [LIVE]?: WeakMap<object, Map<string, Slot>> };

const slotsOf = (target: object, create: boolean) => {
	const all = create ? (registry[LIVE] ??= new WeakMap()) : registry[LIVE];
	let slots = all?.get(target);
	if (!slots && create) all!.set(target, slots = new Map());
	return slots;
};

/** True when an instance of this extension already put its forwarding slot on the property. */
export const isHooked = (target: object, name: string): boolean => slotsOf(target, false)?.has(name) ?? false;

/**
 * Makes `name` run `make(original)`. The first call replaces the property with a forwarding slot; later calls, also
 * from a reloaded module, swap what the slot runs. `original` is what the property held at the first call.
 */
export function installHook(target: object, name: string, kind: "value" | "get", make: (original: any) => Function): void {
	const slots = slotsOf(target, true)!;
	const known = slots.get(name);
	if (known) {
		known.run = make(known.original);
		const descriptor = Object.getOwnPropertyDescriptor(target, name);
		if (descriptor?.[kind] === known.original && known.forward) {
			Object.defineProperty(target, name, { ...descriptor, [kind]: known.forward });
		}
		return;
	}
	const descriptor = Object.getOwnPropertyDescriptor(target, name)!;
	const original = descriptor[kind] as Function;
	const slot: Slot = { original, run: make(original) };
	const forward = function (this: unknown, ...args: unknown[]) { return slot.run.apply(this, args); };
	slot.forward = forward;
	Object.defineProperty(forward, "length", { value: original.length });
	slots.set(name, slot);
	Object.defineProperty(target, name, { ...descriptor, [kind]: forward });
}
