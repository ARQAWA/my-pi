import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createWebTool, type WebDependencies } from "./tool.ts";

type RegisterWeb = (pi: ExtensionAPI) => void;

export function createWebExtension(deps: WebDependencies = {}) {
	// Each child gets its own API, never the parent's model or thinking getter.
	const register: RegisterWeb = (pi) => pi.registerTool(createWebTool(pi, deps));
	return (pi: ExtensionAPI): void => {
		register(pi);
		pi.events.on("rqw-search:subagent-web", request => {
			(request as { offer?: (register: RegisterWeb) => void })?.offer?.(register);
		});
	};
}

export default createWebExtension();
