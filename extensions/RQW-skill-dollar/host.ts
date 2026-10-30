import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { InteractiveMode, VERSION, type Theme } from "@earendil-works/pi-coding-agent";
import { installSkillCard } from "./card.ts";

const KEY = Symbol.for("rqw-skill-dollar.host");
const THEME = Symbol.for("@earendil-works/pi-coding-agent:theme");
const ownPath = resolve(fileURLToPath(new URL("./index.ts", import.meta.url)));

type State = { remove?: ReturnType<typeof installSkillCard>; seen: boolean; dispose: () => void };

function currentTheme(): Theme {
	const theme = (globalThis as any)[THEME];
	if (!theme || typeof theme.fg !== "function" || typeof theme.bg !== "function") throw new Error("Theme unavailable");
	return theme;
}

// The host, not the latest factory (which may belong to a child), owns the visible cards.
export function installHost(): State | undefined {
	const existing = (globalThis as any)[KEY] as State | undefined;
	if (existing) return existing;
	const proto = InteractiveMode.prototype as any;
	const renderDescriptor = Object.getOwnPropertyDescriptor(proto, "renderSessionEntries");
	const stopDescriptor = Object.getOwnPropertyDescriptor(proto, "stop");
	if (VERSION !== "1.4.0" || !renderDescriptor?.writable || typeof renderDescriptor.value !== "function" ||
		!stopDescriptor?.writable || typeof stopDescriptor.value !== "function") return undefined;
	const render = renderDescriptor.value;
	const stop = stopDescriptor.value;
	const state: State = { seen: false, dispose() {
		state.remove?.();
		state.remove = undefined;
		if (proto.renderSessionEntries === wrappedRender) proto.renderSessionEntries = render;
		if (proto.stop === wrappedStop) proto.stop = stop;
		if ((globalThis as any)[KEY] === state) delete (globalThis as any)[KEY];
	} };
	let session: unknown;
	let generation: unknown;
	const wrappedRender = function (this: any, ...args: any[]) {
		const current = this.session;
		const loader = current?.resourceLoader;
		const loaded = typeof loader?.getExtensions === "function" ? loader.getExtensions() : undefined;
		const extensions = loaded?.extensions;
		const enabled = Array.isArray(extensions) && extensions.some((extension: any) => typeof extension?.resolvedPath === "string" && resolve(extension.resolvedPath) === ownPath);
		state.seen = true;
		if (current !== session || loaded?.runtime !== generation) state.remove?.clear();
		if (enabled) {
			if (!state.remove) state.remove = installSkillCard(currentTheme);
		} else if (state.remove) { state.remove(); state.remove = undefined; }
		session = current;
		generation = loaded?.runtime;
		return render.apply(this, args);
	};
	const wrappedStop = function (this: any, ...args: any[]) {
		try { return stop.apply(this, args); } finally { state.dispose(); }
	};
	proto.renderSessionEntries = wrappedRender;
	proto.stop = wrappedStop;
	(globalThis as any)[KEY] = state;
	return state;
}
