import assert from "node:assert/strict";
import { join } from "node:path";
import { it } from "node:test";
import { pathToFileURL } from "node:url";
import { text, world } from "./synthetic/world.ts";

it("renders file links as encoded absolute URIs and leaves web links unchanged", async (t) => {
	const previous = process.env.PI_HYPERLINKS;
	process.env.PI_HYPERLINKS = "1";
	const w = await world(t);
	t.after(() => {
		if (previous === undefined) delete process.env.PI_HYPERLINKS;
		else process.env.PI_HYPERLINKS = previous;
	});

	w.model.script(text("[файл a.md:12](<файл a.md:12>) and [web](https://example.com/a:12)"));
	await w.submit("links");

	const raw = w.raw().join("\n");
	const file = pathToFileURL(join(w.dirs.project, "файл a.md")).href;
	assert.ok(raw.includes(`\x1b]8;;${file}\x1b\\`), "file link targets the encoded absolute path without the line number");
	assert.ok(raw.includes("файл a.md:12"), "the label keeps the line number");
	assert.ok(raw.includes("\x1b]8;;https://example.com/a:12\x1b\\"), "the web target is unchanged");
});
