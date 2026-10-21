import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// A minimal SDK nested caller, like codemode, preserving the returned review text.
export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "relay",
		label: "relay",
		description: "Test-only nested review caller.",
		parameters: Type.Object({ level: Type.String(), object: Type.String(), criterion: Type.String() }),
		async execute(_id, args, _signal, _update, ctx) {
			const outcome = await ctx.executeTool("review", args);
			return outcome.result;
		},
	});
}
