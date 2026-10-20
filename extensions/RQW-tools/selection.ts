import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// The user made a tool selection when argv holds a tool flag (any spelling) or the `defaultTools` setting is set.
// The extension API exposes no `tools` / `noTools` / `excludeTools` session options, so argv is the signal.
const TOOL_FLAGS = ["--tools", "-t", "--exclude-tools", "-xt", "--no-tools", "-nt", "--no-builtin-tools", "-nbt"];

/**
 * True when the user selected no tools, so an extension may add its default tools to the active set.
 * No readable settings counts as a selection: the active set stays exactly as stock Pi built it.
 */
export function noToolSelection(pi: ExtensionAPI): boolean {
	if (process.argv.some((a) => TOOL_FLAGS.some((f) => a === f || a.startsWith(f + "=")))) return false;
	try {
		const settings: any = pi.getSettings();
		return !!settings && settings.defaultTools === undefined;
	} catch {
		return false;
	}
}
