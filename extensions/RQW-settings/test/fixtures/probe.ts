// Test extension: takes over the built-in `codemode` with a nested barrier of its own (the production function from
// RQW-tools) and registers a `probe` tool that says which barrier it runs under. It proves that the tool call id Pi
// gives a call of a `codemode` script leads to the barrier of that script through Pi's real sandbox (worker thread,
// host callback, nested call).
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { takeOverBuiltinCodemode } from "../../../RQW-tools/codemode.ts";
import { createNestedBarrier } from "../../../RQW-tools/nested.ts";

export default function (pi: ExtensionAPI) {
	const nested = createNestedBarrier();
	const numbers = new WeakMap<object, number>();
	let counter = 0;
	pi.registerTool({
		name: "probe",
		label: "probe",
		description: "Says which barrier of a codemode call it runs under.",
		parameters: { type: "object", properties: {}, additionalProperties: false } as any,
		async execute(id) {
			const own = nested.groupOf(id);
			if (own && !numbers.has(own)) numbers.set(own, ++counter);
			return { content: [{ type: "text", text: own ? `group-${numbers.get(own)}` : "no-group" }], details: {} };
		},
	});
	pi.on("session_start", () => {
		takeOverBuiltinCodemode(pi, nested);
	});
}
