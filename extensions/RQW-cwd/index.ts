import { InteractiveMode, VERSION, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isSystemFolder } from "./folders.ts";
import { moveToTemp, type MoveOptions } from "./move.ts";

const PATCHED = Symbol.for("rqw-cwd.init");

type Host = {
	isInitialized?: boolean;
	runtimeHost?: { session?: { sessionManager?: { getCwd?(): string } } };
	footer?: { setSession?(session: unknown): void };
	footerDataProvider?: { setCwd?(cwd: string): void };
	init(): Promise<void>;
	showWarning?(message: string): void;
};
type Prototype = { init: Host["init"] & { [PATCHED]?: true } };

/**
 * Runtime patch of Pi 1.5.0's `InteractiveMode.prototype.init` ([D-SCOPE-RUNTIME-PATCH]). Before the first paint a chat
 * started in a system folder moves to the temp folder; then init runs as usual on the new runtime. Installed once per
 * process and inert after the first init. Returns the restore function, or undefined for an unknown shape.
 */
export function installTempCwd(prototype: Prototype = InteractiveMode.prototype as unknown as Prototype, options: MoveOptions = {}, version = VERSION): (() => void) | undefined {
	const original = prototype.init;
	if (version !== "1.5.0" || typeof original !== "function") return undefined;
	// A later load of the extension (its new runtime, /reload) finds the patch already there.
	if (original[PATCHED]) return () => undefined;
	const started = new WeakSet<object>();
	const patched = async function (this: Host) {
		if (this.isInitialized || started.has(this)) return original.call(this);
		started.add(this);
		const footer = this.footer, footerData = this.footerDataProvider;
		const footerSupported = typeof footer?.setSession === "function" && typeof footerData?.setCwd === "function";
		const before = this.runtimeHost?.session;
		const warning = await moveToTemp(this.runtimeHost, options, footerSupported);
		const after = this.runtimeHost?.session;
		// The constructor bound the footer to the old session; stock init paints before it rebinds.
		if (footerSupported && after && after !== before) {
			footer.setSession!(after);
			const cwd = after.sessionManager?.getCwd?.();
			if (cwd) footerData.setCwd!(cwd);
		}
		// Through the prototype again: extensions of the new runtime may have wrapped init meanwhile.
		await this.init();
		if (warning) this.showWarning?.(warning);
	};
	prototype.init = Object.assign(patched, { [PATCHED]: true as const });
	return () => { if (prototype.init === patched) prototype.init = original; };
}

/** Installs the patch; on an unknown Pi shape the stock start stays and a chat in a system folder gets a warning. */
export function registerTempCwd(pi: ExtensionAPI, prototype?: Prototype, options: MoveOptions = {}, version = VERSION): void {
	if (installTempCwd(prototype, options, version)) return;
	pi.on("session_start", (event, ctx) => {
		if (event.reason !== "startup" || !ctx.hasUI || !isSystemFolder(ctx.cwd, options.platform, options.home)) return;
		ctx.ui.notify(`This Pi version is not supported by RQW-cwd; the chat stays in ${ctx.cwd}.`, "warning");
	});
}

export default function tempCwd(pi: ExtensionAPI) {
	registerTempCwd(pi);
}
