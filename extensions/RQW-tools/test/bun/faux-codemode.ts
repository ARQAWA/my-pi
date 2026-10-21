// Faux model for codemode-check.mjs. Native path checks run through the real Bun CLI tool routing.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";

const retarget = "const fs = require('node:fs'); fs.unlinkSync('link'); fs.symlinkSync(fs.realpathSync('next'), 'link', process.platform === 'win32' ? 'junction' : 'dir');";
const command = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(retarget)}`;
const dangling = "require('node:fs').symlinkSync('future.txt','future-link.txt','file')";
const danglingCommand = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(dangling)}`;
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
try { await tools.write({ files: [{ path: "hard-left/a.txt", content: "BAD" }, { path: "hard-right/b.txt", content: "BAD" }] }); } catch {}
await tools.edit({ edits: [
  { path: "hard-left/a.txt", oldText: "alpha", newText: "ALPHA" },
  { path: "hard-right/b.txt", oldText: "beta", newText: "BETA" },
] });
await Promise.all([
  tools.bash({ command: ${JSON.stringify(danglingCommand)} }),
  tools.write({ path: "future-link.txt", content: "FUTURE\\n" }),
  tools.read({ path: "future.txt" }),
]);
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
