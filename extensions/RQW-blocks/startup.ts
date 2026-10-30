// Pi 1.4.0 normally starts the terminal before binding extensions and draws history after the bind.
// Move only the first history draw to the ready viewport; leave subsequent session draws to Pi.
const started = new WeakSet<object>();
const starting = new WeakSet<object>();
const rebinding = new WeakSet<object>();

type Restore = () => void;

export function startWithHistory(host: any, run: () => Promise<unknown>): Promise<unknown> {
	const renderer = host?.renderer;
	const editor = host?.editor;
	const methods = ["renderInitialMessages", "renderCurrentSessionState", "rebindCurrentSession", "setCustomEditorComponent"];
	const replaceable = (target: any, name: string) => {
		if (!target || typeof target[name] !== "function") return false;
		const descriptor = Object.getOwnPropertyDescriptor(target, name);
		return descriptor ? descriptor.configurable && descriptor.writable : Object.isExtensible(target);
	};
	if (host.isInitialized || started.has(host) || !replaceable(renderer, "start") || !replaceable(editor, "addToHistory")
		|| methods.some(name => !replaceable(host, name)) || typeof host.sessionManager?.getSessionId !== "function"
		|| typeof host.sessionManager?.buildContextEntries !== "function") return run();

	starting.add(host);
	const restores: Restore[] = [];
	const wrap = (target: any, name: string, make: (original: Function) => Function) => {
		const own = Object.getOwnPropertyDescriptor(target, name);
		const wrapper = make(target[name]);
		Object.defineProperty(target, name, { value: wrapper, writable: true, configurable: true });
		const restore = () => {
			if (target[name] !== wrapper) return;
			if (own) Object.defineProperty(target, name, own); else delete target[name];
		};
		restores.push(restore);
		return restore;
	};
	let drawn = false;
	let firstRebind = false;
	let skipState = false;
	let skipLate = false;
	let capture = false;
	let replay = false;
	let viewSession: any;
	let viewId: string | undefined;
	let texts: string[] = [];
	const editors = new WeakSet<object>();
	const replayed = new WeakSet<object>();
	const sameView = () => host.session === viewSession && host.sessionManager?.getSessionId?.() === viewId;
	const watchEditor = (current: any) => {
		if (editors.has(current) || !replaceable(current, "addToHistory")) return;
		editors.add(current);
		wrap(current, "addToHistory", original => function (this: any, text: string) {
			if (capture && !replay && sameView()) texts.push(text);
			return original.call(this, text);
		});
	};
	watchEditor(editor);
	wrap(host, "renderInitialMessages", original => function (this: any, ...args: unknown[]) {
		if (skipLate) {
			skipLate = false;
			if (sameView()) return;
		}
		viewSession = host.session;
		viewId = host.sessionManager.getSessionId();
		texts = [];
		watchEditor(host.editor);
		capture = true;
		try { return original.apply(this, args); }
		finally { capture = false; replayed.add(host.editor); }
	});
	wrap(host, "renderCurrentSessionState", original => function (this: any, ...args: unknown[]) {
		if (skipState) { skipState = false; return; }
		return original.apply(this, args);
	});
	wrap(host, "rebindCurrentSession", original => async function (this: any, options: any, ...args: unknown[]) {
		if (!drawn || firstRebind) {
			skipState = false;
			return original.call(this, options, ...args);
		}
		firstRebind = true;
		skipState = true;
		try {
			const result = await original.call(this, { ...options, renderBeforeBind: true }, ...args);
			skipLate = sameView();
			return result;
		} finally { skipState = false; }
	});
	wrap(host, "setCustomEditorComponent", original => function (this: any, ...args: unknown[]) {
		const previous = host.editor;
		const result = original.apply(this, args);
		const current = host.editor;
		if (current !== previous && sameView() && !replayed.has(current) && typeof current?.addToHistory === "function") {
			replayed.add(current);
			replay = true;
			try { for (const text of texts) current.addToHistory(text); } finally { replay = false; }
		}
		return result;
	});
	const restoreStart = wrap(renderer, "start", original => function (this: any, ...args: unknown[]) {
		restoreStart();
		if (!drawn && host.renderer === renderer && host.transcriptScrollView && host.chatContainer && host.sessionManager) {
			host.renderInitialMessages();
			drawn = true;
			started.add(host);
		}
		return original.apply(this, args);
	});
	try {
		return Promise.resolve(run()).finally(() => { for (const restore of restores.reverse()) restore(); starting.delete(host); });
	} catch (error) {
		for (const restore of restores.reverse()) restore();
		starting.delete(host);
		throw error;
	}
}

/** A switched session draws into Pi's default editor before extensions can replace it. */
export function rebindWithHistory(host: any, run: () => Promise<unknown>): Promise<unknown> {
	if (starting.has(host) || rebinding.has(host) || !host.editor || typeof host.editor.addToHistory !== "function"
		|| typeof host.renderInitialMessages !== "function" || typeof host.setCustomEditorComponent !== "function"
		|| typeof host.sessionManager?.getSessionId !== "function") return run();
	const names = ["renderInitialMessages", "setCustomEditorComponent"];
	if (names.some(name => { const d = Object.getOwnPropertyDescriptor(host, name); return d ? !d.configurable || !d.writable : !Object.isExtensible(host); })) return run();
	const restores: Restore[] = [];
	const wrap = (target: any, name: string, make: (original: Function) => Function) => {
		const own = Object.getOwnPropertyDescriptor(target, name);
		if (own ? !own.configurable || !own.writable : !Object.isExtensible(target)) return false;
		const wrapper = make(target[name]);
		Object.defineProperty(target, name, { value: wrapper, configurable: true, writable: true });
		restores.push(() => { if (target[name] === wrapper) { if (own) Object.defineProperty(target, name, own); else delete target[name]; } });
		return true;
	};
	let session: any, id: string | undefined, texts: string[] = [], capture = false;
	const watched = new WeakSet<object>();
	const replayed = new WeakSet<object>();
	const same = () => host.session === session && host.sessionManager?.getSessionId?.() === id;
	const watch = (editor: any) => {
		if (watched.has(editor) || typeof editor.addToHistory !== "function") return;
		if (wrap(editor, "addToHistory", original => function(this: any, text: string) {
			if (capture && same()) texts.push(text);
			return original.call(this, text);
		})) watched.add(editor);
	};
	rebinding.add(host);
	wrap(host, "renderInitialMessages", original => function(this: any, ...args: unknown[]) {
		session = host.session; id = host.sessionManager.getSessionId(); texts = [];
		watch(host.editor); capture = true;
		try { return original.apply(this, args); } finally { capture = false; replayed.add(host.editor); }
	});
	wrap(host, "setCustomEditorComponent", original => function(this: any, ...args: unknown[]) {
		const previous = host.editor;
		const result = original.apply(this, args);
		const current = host.editor;
		if (current !== previous && same() && !replayed.has(current) && typeof current?.addToHistory === "function") {
			replayed.add(current);
			for (const text of texts) current.addToHistory(text);
		}
		return result;
	});
	const finish = () => { for (const restore of restores.reverse()) restore(); rebinding.delete(host); };
	try { return Promise.resolve(run()).finally(finish); } catch (error) { finish(); throw error; }
}
