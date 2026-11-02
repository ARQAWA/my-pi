import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, it } from "node:test";
import { keys, reportTimings, text, world } from "./synthetic/world.ts";

after(() => reportTimings(import.meta.filename));

async function withSkill(t: Parameters<typeof world>[0]) {
	const initial = await world(t);
	const directory = join(initial.dirs.codex, "skills", "world-check");
	mkdirSync(directory, { recursive: true });
	writeFileSync(join(directory, "SKILL.md"), "---\nname: world-check\ndescription: Synthetic skill for checking input\n---\nFollow the synthetic instruction.\n");
	return initial.restart();
}

it("suggests a skill and sends its instructions after selection", async (t) => {
	const w = await withSkill(t);
	w.type("please $world");
	await w.tick(20);
	await w.until(() => w.screen().some((line) => line.includes("$world-check")), "skill suggestion");
	w.press(keys.tab);
	w.model.script(text("done"));
	w.press(keys.enter);
	await w.settle();

	const request = w.requests.find((item) => !item.background)!;
	const message = request.context.messages.find((item) => item.role === "user")!;
	const content = typeof message.content === "string" ? message.content : message.content.map((part) => part.type === "text" ? part.text : "").join("");
	assert.match(content, /<skill name="world-check"/);
	assert.match(content, /Follow the synthetic instruction\./);
	assert.match(content, /please/);
	w.see("done");
	const screen = w.screen();
	assert.equal(screen.filter((line) => line.includes("└ skill") && line.includes("world-check")).length, 1);
	assert.ok(screen.every((line) => !line.includes("[skill] world-check") && !line.includes("Follow the synthetic instruction.")));
	assert.deepEqual(w.networkAttempts, []);
	assert.deepEqual(w.model.unscripted, []);
});

