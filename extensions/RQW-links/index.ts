import { InteractiveMode, VERSION, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Markdown, getCapabilities } from "@earendil-works/pi-tui";
import { resolve, win32 } from "node:path";
import { pathToFileURL } from "node:url";

const PATCHED = Symbol.for("rqw-links.markdown");
type Token = { type: string; href?: string; [key: string]: unknown };
type State = { cwd: string; owners: number; restore: () => void };
type Render = ((this: unknown, tokens: Token[], ...args: unknown[]) => string) & { [PATCHED]?: State };
type Prototype = { renderInlineTokens: Render };
type Host = { sessionManager?: { getCwd?: () => string } };
type HostPrototype = { renderInitialMessages: (this: Host, ...args: unknown[]) => unknown };

function fileUrl(href: string, cwd: string): string | undefined {
	if (href.startsWith("#")) return undefined;
	const hash = href.indexOf("#");
	const destination = (hash < 0 ? href : href.slice(0, hash)).replace(/:\d+$/, "");
	const fragment = hash < 0 ? "" : href.slice(hash);
	const windowsPath = /^[a-zA-Z]:[\\/]/.test(destination);
	if (!windowsPath && (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(destination) || destination.startsWith("//"))) return undefined;
	try {
		const path = decodeURIComponent(destination.replace(/%(?![\da-f]{2})/gi, "%25"));
		if (windowsPath && process.platform !== "win32") {
			const parts = win32.resolve(path).replace(/\\/g, "/").split("/");
			return new URL(`file:///${parts[0]}/${parts.slice(1).map(encodeURIComponent).join("/")}${fragment}`).href;
		}
		const url = pathToFileURL(resolve(cwd, path));
		url.hash = fragment;
		return url.href;
	} catch {
		return undefined;
	}
}

export function installLinks(prototype: Prototype = Markdown.prototype as unknown as Prototype, version = VERSION, host: HostPrototype = InteractiveMode.prototype as unknown as HostPrototype): (() => void) | undefined {
	const descriptor = Object.getOwnPropertyDescriptor(prototype, "renderInlineTokens");
	const original = descriptor?.value as Render | undefined;
	if (version !== "1.5.0" || typeof original !== "function" || !descriptor?.writable || !descriptor.configurable) return undefined;
	if (original[PATCHED]) {
		const state = original[PATCHED];
		state.owners++;
		let released = false;
		return () => { if (!released) { released = true; if (--state.owners === 0) state.restore(); } };
	}
	const source = Function.prototype.toString.call(original);
	const hostDescriptor = Object.getOwnPropertyDescriptor(host, "renderInitialMessages");
	const renderInitialMessages = hostDescriptor?.value as HostPrototype["renderInitialMessages"] | undefined;
	if (!source.includes("token.href") || !source.includes("hyperlink(") || !source.includes("renderInlineTokens") || typeof renderInitialMessages !== "function" || !hostDescriptor?.writable || !hostDescriptor.configurable) return undefined;
	const state: State = { cwd: process.cwd(), owners: 1, restore: () => {} };
	const patched: Render = function (this: unknown, tokens: Token[], ...args: unknown[]) {
		if (!getCapabilities().hyperlinks || !Array.isArray(tokens)) return original.call(this, tokens, ...args);
		let changed = false;
		const normalized = tokens.map((token) => {
			if (token.type !== "link" || typeof token.href !== "string") return token;
			const href = fileUrl(token.href, state.cwd);
			if (!href) return token;
			changed = true;
			return { ...token, href };
		});
		return original.call(this, changed ? normalized : tokens, ...args);
	};
	const patchedInitialMessages: HostPrototype["renderInitialMessages"] = function (...args) {
		const cwd = this.sessionManager?.getCwd?.();
		if (cwd) state.cwd = cwd;
		return renderInitialMessages.call(this, ...args);
	};
	patched[PATCHED] = state;
	prototype.renderInlineTokens = patched;
	host.renderInitialMessages = patchedInitialMessages;
	state.restore = () => {
		if (prototype.renderInlineTokens === patched) prototype.renderInlineTokens = original;
		if (host.renderInitialMessages === patchedInitialMessages) host.renderInitialMessages = renderInitialMessages;
	};
	let released = false;
	return () => { if (!released) { released = true; if (--state.owners === 0) state.restore(); } };
}

export default function links(pi: ExtensionAPI) {
	const restore = installLinks();
	if (!restore) return;
	pi.on("session_start", (_event, ctx) => {
		const render = (Markdown.prototype as unknown as Prototype).renderInlineTokens;
		if (render[PATCHED]) render[PATCHED].cwd = ctx.cwd;
	});
	pi.on("session_shutdown", restore);
}
