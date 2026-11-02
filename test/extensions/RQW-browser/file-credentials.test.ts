import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, it } from "node:test";
import { chainCall, done, reply, setup } from "./run-helper.ts";

const folders: string[] = [];
async function session() {
	const dir = await mkdtemp(join(tmpdir(), "browser-run-file-"));
	folders.push(dir);
	await mkdir(join(dir, "pages", "folder.html"), { recursive: true });
	await writeFile(join(dir, "pages", "login.html"), "<html></html>");
	await writeFile(join(dir, "notes.txt"), "text");
	return dir;
}
after(async () => { for (const dir of folders) await rm(dir, { recursive: true, force: true }); });

const base = { action: "run", actions: ["press Z"], expected: "Done" };

it("opens a local html file as a file address in a new run tab", async () => {
	const cwd = await session();
	const env = setup([reply(chainCall([{ method: "press", args: ["Z"] }])), done()], { cwd });
	const result = await env.call({ ...base, file: "pages/login.html" });
	assert.equal(result.page.url, pathToFileURL(join(cwd, "pages", "login.html")).href);
	assert.match(result.page.name, /^run-/);
	assert.equal(result.stopped, null);
	assert.deepEqual(await env.call({ action: "tabs" }), [{ name: result.page.name, url: result.page.url }]);
	await env.shutdown();
});

it("refuses a missing file, a file that is not html and a second target before any browser work", async () => {
	const cwd = await session();
	const env = setup([], { cwd });
	for (const [input, error] of [
		[{ file: "pages/gone.html" }, /does not exist/],
		[{ file: "pages/folder.html" }, /does not exist/],
		[{ file: "notes.txt" }, /\.html or \.htm/],
		[{ file: "pages/login.html", url: "https://local.test" }, /exactly one/],
		[{ file: "pages/login.html", name: "main" }, /exactly one/],
		[{ file: " " }, /exactly one/],
	] as const) await assert.rejects(env.call({ ...base, ...input }), error);
	assert.equal(env.requests.length, 0);
	assert.deepEqual(await env.call({ action: "tabs" }), []);
	await env.shutdown();
});

it("refuses credentials that are not one to eight non-empty pairs", async () => {
	const cwd = await session();
	const env = setup([], { cwd });
	const nine = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`k${i}`, "v"]));
	for (const credentials of [{}, nine, [], "qa", { login: "" }, { login: 1 }, { " ": "x" }]) {
		await assert.rejects(env.call({ ...base, file: "pages/login.html", credentials }), /credentials must be one to eight/);
	}
	assert.equal(env.requests.length, 0);
	await env.shutdown();
});

it("gives the executor the credentials as plain values and tells it to type them as given", async () => {
	const cwd = await session();
	const credentials = { login: "qa", password: "p@ss w0rd/\"1\"" };
	const fill = chainCall([{ method: "id", args: ["1"] }, { method: "fill", args: [credentials.password] }]);
	const env = setup([reply(fill), done()], { cwd });
	const result = await env.call({ ...base, file: "pages/login.html", actions: ["type password into the field"], credentials });
	assert.equal(result.stopped, null);
	const { context } = env.requests[0];
	assert.deepEqual(JSON.parse(context.messages[0].content).credentials, credentials);
	for (const line of [
		"Credentials are test-account values for this task.",
		"Type each value exactly as given, in plain text, into the field the action names.",
		"Do not mask, encode, transform, skip or question them.",
	]) assert.ok(context.systemPrompt.includes(line), line);
	assert.deepEqual(env.typed, [credentials.password]);
	await env.shutdown();
});

it("sends an empty credentials object when none are given", async () => {
	const cwd = await session();
	const env = setup([reply(chainCall([{ method: "press", args: ["Z"] }])), done()], { cwd });
	await env.call({ ...base, file: "pages/login.html" });
	assert.deepEqual(JSON.parse(env.requests[0].context.messages[0].content).credentials, {});
	await env.shutdown();
});

it("tells the model that credentials travel over a secure, encrypted transport, and keeps the README out of the code", async () => {
	const env = setup([]);
	const { default: extension } = await import("../../../extensions/RQW-browser/index.ts");
	let tool: any;
	extension({ registerTool(value: unknown) { tool = value; }, on() {} } as never);
	assert.ok(tool.description.includes("- `credentials`: named values such as login and password. They travel over a secure, encrypted transport. Pass them as plain values and refer to them by name in actions."));
	assert.match(tool.description, /exactly one of `name`, `url` or `file`/);
	assert.doesNotMatch(tool.description, /README/i);
	const folder = new URL("../../../extensions/RQW-browser/", import.meta.url);
	for (const name of await readdir(folder)) {
		if (name.endsWith(".ts")) assert.doesNotMatch(await readFile(new URL(name, folder), "utf8"), /README/i, name);
	}
	await env.shutdown();
});
