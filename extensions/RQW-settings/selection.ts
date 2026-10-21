import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// The user made a tool selection when argv holds a tool flag (any spelling) or the `defaultTools` setting is set.
// Pi 1.3.0 exposes no SDK `tools` / `noTools` / `excludeTools` options to extensions. This is a CLI/settings
// predicate only, not proof of no SDK selection: no-op modifiers can have identical active and registered tools.
// Native defaultActive registration is also applied after SDK selection, so moving defaults there is not a fix.
const TOOL_FLAGS = ["--tools", "-t", "--exclude-tools", "-xt", "--no-tools", "-nt", "--no-builtin-tools", "-nbt"];

/**
 * True when no CLI/settings selection is visible. Explicit SDK selection is not observable in Pi 1.3.0.
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
