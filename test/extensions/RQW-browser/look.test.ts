import assert from "node:assert/strict";
import { it } from "node:test";
import { setup } from "./run-helper.ts";

const open = { action: "open", name: "main", url: "https://local.test" };

it("takes a screenshot of a named tab as a Pi image", async () => {
	const env = setup([]);
	await env.call(open);
	const result = await env.full({ action: "screenshot", name: "main" });
	assert.deepEqual(result.content[1], { type: "image", data: "AQID", mimeType: "image/png" });
	assert.deepEqual(result.details.value, { mimeType: "image/png", width: 800, height: 600, originalWidth: 1600, originalHeight: 1200 });
	assert.equal(env.shots.length, 1);
	await env.shutdown();
});

it("returns the page as Markdown without element ids", async () => {
	const env = setup([]);
	await env.call(open);
	const result = await env.full({ action: "markdown", name: "main" });
	assert.equal(result.content.length, 1);
	assert.equal(result.content[0].text, "# Form\nURL: https://local.test\n- button: Submit\nReady");
	assert.equal(result.details.value, result.content[0].text);
	await env.shutdown();
});

it("takes only the name and a tab that exists", async () => {
	const env = setup([]);
	await env.call(open);
	for (const action of ["screenshot", "markdown"]) {
		for (const extra of [{ fullPage: true }, { selector: "button" }, { url: "https://other.test" }]) {
			await assert.rejects(env.call({ action, name: "main", ...extra }), new RegExp(`Browser ${action} takes only name`));
		}
		await assert.rejects(env.call({ action, name: "missing" }), /No tab named "missing"/);
	}
	assert.equal(env.shots.length, 0);
	await env.shutdown();
});

it("describes both actions with only a name", async () => {
	const env = setup([]);
	const { default: extension } = await import("../../../extensions/RQW-browser/index.ts");
	let tool: any;
	extension({ registerTool(value: unknown) { tool = value; }, on() {} } as never);
	assert.match(tool.description, /- `screenshot` takes only `name`/);
	assert.match(tool.description, /- `markdown` takes only `name`/);
	await env.shutdown();
});
