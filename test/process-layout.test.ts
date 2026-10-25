import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, test } from "node:test";

const root = join(import.meta.dirname, "..");
const process = readFileSync(join(root, "PROCESS.md"), "utf8");
const sections = [
	"Research and agreement", "Isolated parallel execution", "Task pipeline", "Task timebox", "Subagent models",
	"Golden rule", "Code quality", "Sufficient proof, without idle reruns", "Measurements and benchmarks",
	"Independent review", "Quality control loop", "Third-party installation fast path", "Delivery",
	"Communication and continuity",
];
const slug = (heading: string) => heading.toLowerCase().replaceAll(",", "").replaceAll(" ", "-");
const files = ["PROCESS.md", ...readdirSync(join(root, "process")).map(name => `process/${name}`)];
const documents = files.map(file => ({ file, text: readFileSync(join(root, file), "utf8") }));
const anchors = (text: string) => [
	...Array.from(text.matchAll(/^#{1,6} (.+)$/gm), match => slug(match[1])),
	...Array.from(text.matchAll(/<a id="([^"]+)"><\/a>/g), match => match[1]),
];

describe("process layout", { skip: globalThis.process.platform !== "darwin" && "Local development tooling is supported only on the owner's macOS laptop" }, () => {
test("legacy process anchors resolve and each section body has one owner", () => {
	const rootAnchors = anchors(process);
	assert.equal(new Set(rootAnchors).size, rootAnchors.length, "duplicate root anchors");
	for (const section of sections) {
		assert.ok(rootAnchors.includes(slug(section)), `missing legacy root anchor: ${section}`);
		const owners = documents.filter(({ text }) => text.includes(`## ${section}\n`));
		assert.equal(owners.length, 1, `section body must have exactly one owner: ${section}`);
		if (owners[0].file !== "PROCESS.md") {
			assert.ok(process.includes(`](${owners[0].file})`), `missing task-loading link: ${section}`);
		}
	}
});

test("all process links resolve, including relative links moved with sections", () => {
	for (const { file, text } of documents) {
		for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
			const target = match[1];
			if (/^[a-z]+:\/\//i.test(target)) continue;
			const [path, anchor] = target.split("#");
			const absolute = path ? resolve(root, dirname(file), path) : join(root, file);
			assert.ok(existsSync(absolute), `${file}: missing target ${target}`);
			if (anchor && absolute.endsWith(".md")) {
				assert.ok(anchors(readFileSync(absolute, "utf8")).includes(anchor), `${file}: missing anchor ${target}`);
			}
		}
	}
});

test("root retains the guard block and task-loaded Delivery rule", () => {
	const combined = documents.map(({ text }) => text).join("\n");
	assert.equal(Array.from(combined.matchAll(/^```json coordinator-rules$/gm)).length, 1);
	assert.match(process, /^```json coordinator-rules\n/m);
	const delivery = process.slice(process.indexOf("\n## Delivery\n"));
	assert.ok(delivery.length > 0);
	assert.ok(process.indexOf("<!-- Task-loaded section:") < process.indexOf("\n## Delivery\n"));
	assert.match(delivery, /saved owner-quote checks for touched quotes/);
	assert.match(delivery, /For all other changed sets, changed paths mechanically select/);
	assert.match(delivery, /After 10 task commits or 2 hours/);
	assert.match(delivery, /release batch checks in step 4 remain unchanged/);
	assert.equal(combined.split("saved owner-quote checks for touched quotes").length - 1, 1);
});
});
