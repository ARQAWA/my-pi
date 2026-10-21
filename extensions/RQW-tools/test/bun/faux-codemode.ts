// Faux model for codemode-check.mjs. Native path checks run through the real Bun CLI tool routing.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";

const retarget = "const fs = require('node:fs'); fs.unlinkSync('link'); fs.symlinkSync(fs.realpathSync('next'), 'link', process.platform === 'win32' ? 'junction' : 'dir');";
const command = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(retarget)}`;
const SCRIPT = `
await tools.write({ path: "f.txt", content: "NEW\\n" });
const first = await tools.read({ path: "f.txt" });
await Promise.all([
  tools.bash({ command: ${JSON.stringify(command)} }),
  tools.write({ path: "link/f.txt", content: "RETARGETED\\n" }),
  tools.read({ path: "next/f.txt" }),
]);
try { await tools.write({ files: [{ path: "\\u0131.txt", content: "DOTLESS" }, { path: "I.txt", content: "ASCII" }] }); } catch {}
try { await tools.write({ files: [{ path: "\\u03a3.txt", content: "SIGMA" }, { path: "\\u03c2.txt", content: "FINAL" }] }); } catch {}
return first;
`;

export default function (pi: ExtensionAPI) {
	const faux = fauxProvider();
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("codemode", { code: SCRIPT }, { id: "c0" })], { stopReason: "toolUse" }),
		fauxAssistantMessage(fauxText("done")),
	]);
	pi.registerProvider(faux.provider as any);
}
