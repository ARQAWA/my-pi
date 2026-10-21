import { it } from "node:test";
import * as pi from "@earendil-works/pi-coding-agent";

export const entries: [string, typeof pi][] = [["library", pi]];
try {
	const bundle: typeof pi = await import(new URL("./bundle/index.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href);
	entries.push(["CLI bundle", bundle]);
} catch (error) {
	// Stock Pi's npm bundle fails before extension loading on its release runtime.
	if (process.versions.bun !== "1.3.14" || !(error instanceof TypeError) ||
		!error.message.includes("webidl.util.markAsUncloneable is not a function")) throw error;
	it("stock Pi CLI bundle import on Bun 1.3.14", { skip: error.message }, () => {});
}
