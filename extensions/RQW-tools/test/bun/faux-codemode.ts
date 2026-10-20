// Test extension for codemode-check.mjs: a faux model for one turn. It sends one `codemode` call (id `c0`) whose
// script writes f.txt and then reads it, then answers "done".
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";

const SCRIPT = `await tools.write({ path: "f.txt", content: "NEW\\n" });\nreturn await tools.read({ path: "f.txt" });`;

export default function (pi: ExtensionAPI) {
	const faux = fauxProvider();
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("codemode", { code: SCRIPT }, { id: "c0" })], { stopReason: "toolUse" }),
		fauxAssistantMessage(fauxText("done")),
	]);
	pi.registerProvider(faux.provider as any);
}
