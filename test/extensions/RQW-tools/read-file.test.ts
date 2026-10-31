import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createReadFileTool } from "../../../extensions/RQW-tools/read-file.ts";

async function fixture(t: any) {
	const cwd = await mkdtemp(join(tmpdir(), "rqw read кириллица-"));
	t.after(() => rm(cwd, { recursive: true, force: true }));
	const tool: any = createReadFileTool(cwd, () => ({ images: { autoResize: false } }));
	const execute = (params: any, ctx: any = { cwd }, signal?: AbortSignal) => tool.execute("test", params, signal, undefined, ctx);
	const text = async (params: any) => (await execute(params)).structuredContent;
	return { cwd, tool, execute, text };
}

test("rqw_readfile reads text, ranges and exact continuation", async (t) => {
	const { cwd, text, tool } = await fixture(t);
	await writeFile(join(cwd, "текст.txt"), "один\r\ntwo\r\nthree");
	assert.equal(await text({ path: "текст.txt" }), "один\ntwo\nthree");
	assert.equal(await text({ path: "текст.txt", offset: 0, limit: 1 }), "один\n\n[Use offset=2 to continue.]");
	assert.equal(await text({ path: "текст.txt", offset: 2, limit: 1 }), "two\n\n[Use offset=3 to continue.]");
	assert.equal(await text({ path: "текст.txt", offset: -1 }), "three");
	assert.equal(await text({ path: "текст.txt", offset: -2 }), "two\nthree");
	assert.equal(await text({ path: join(cwd, "текст.txt") }), "один\ntwo\nthree");
	if (process.platform === "win32") {
		const abs = join(cwd, "текст.txt");
		assert.equal(await text({ path: abs.replaceAll("\\", "/") }), "один\ntwo\nthree");
		const match = /^([a-z]):[\\/](.*)$/i.exec(abs);
		if (match) {
			for (const prefix of ["/", "/mnt/", "/cygdrive/"]) {
				assert.equal(await text({ path: `${prefix}${match[1]}/${match[2].replaceAll("\\", "/")}` }), "один\ntwo\nthree");
			}
		}
	}
	assert.equal(await text({ path: "текст.txt", offset: -100, limit: 1 }), "один\n\n[Use offset=2 to continue.]");
	await assert.rejects(text({ path: "текст.txt", offset: 4 }), /beyond end/);
	await assert.rejects(text({ path: "текст.txt", limit: 0 }), /at least 1/);
	assert.deepEqual(tool.prepareArguments({ path: "x", offset: null, limit: "null" }), { path: "x" });
});

test("rqw_readfile marks every tenth absolute line", async (t) => {
	const { cwd, text } = await fixture(t);
	const lines = Array.from({ length: 25 }, (_, i) => `line ${i + 1}`);
	await writeFile(join(cwd, "numbered.txt"), lines.join("\n"));
	const numbered = [...lines];
	numbered[9] = "    10|line 10";
	numbered[19] = "    20|line 20";
	await t.test("whole file", async () => assert.equal(await text({ path: "numbered.txt" }), numbered.join("\n")));
	await t.test("positive offset", async () => assert.equal(await text({ path: "numbered.txt", offset: 15 }), numbered.slice(14).join("\n")));
	await t.test("negative offset", async () => assert.equal(await text({ path: "numbered.txt", offset: -8 }), numbered.slice(17).join("\n")));
});

test("rqw_readfile counts number prefixes in its byte budget", async (t) => {
	const { cwd, text } = await fixture(t);
	const lines = [...Array(9).fill("x"), "a".repeat(51180), "end"];
	await writeFile(join(cwd, "numbered-bytes.txt"), lines.join("\n"));
	const page = await text({ path: "numbered-bytes.txt" });
	assert.equal(page, lines.slice(0, 9).join("\n") + "\n\n[Use offset=10 to continue.]");
	assert.ok(Buffer.byteLength(page) <= 50 * 1024);
	const next = await text({ path: "numbered-bytes.txt", offset: 10 });
	assert.ok(next.startsWith("    10|"));
	assert.ok(Buffer.byteLength(next) <= 50 * 1024);
	await writeFile(join(cwd, "exact.txt"), [...Array(9).fill("x"), "a".repeat(51182)].join("\n"));
	assert.equal(await text({ path: "exact.txt" }), Array(9).fill("x").join("\n") + "\n\n[Use offset=10 to continue.]");
	await writeFile(join(cwd, "oversized.txt"), [...Array(9).fill("x"), "я".repeat(30000)].join("\n"));
	const oversized = await text({ path: "oversized.txt", offset: 10 });
	assert.ok(oversized.startsWith("    10|"));
	assert.ok(oversized.endsWith("\n\n[Line 10 is not shown in full.]"));
	assert.ok(Buffer.byteLength(oversized) <= 50 * 1024);
});

test("rqw_readfile bounds output and preserves Unicode on a long line", async (t) => {
	const { cwd, text } = await fixture(t);
	const lines = Array.from({ length: 2001 }, (_, i) => `line ${i + 1}`);
	await writeFile(join(cwd, "many.txt"), lines.join("\n"));
	const page = await text({ path: "many.txt" });
	const numbered = lines.slice(0, 2000).map((line, i) => (i + 1) % 10 === 0 ? `${String(i + 1).padStart(6)}|${line}` : line);
	assert.equal(page, numbered.join("\n") + "\n\n[Use offset=2001 to continue.]");
	assert.equal(await text({ path: "many.txt", offset: 2001 }), "line 2001");
	await writeFile(join(cwd, "long.txt"), "Ж" + "я".repeat(30000));
	const long = await text({ path: "long.txt" });
	const longNotice = "\n\n[Line 1 is not shown in full.]";
	assert.equal(long, "Ж" + "я".repeat(Math.floor((51200 - Buffer.byteLength(longNotice)) / 2) - 1) + longNotice);
	assert.doesNotMatch(long, /�|sed|head/);
	assert.ok(Buffer.byteLength(long) <= 50 * 1024);
	await writeFile(join(cwd, "long-next.txt"), "Ж" + "я".repeat(30000) + "\nnext");
	const longNext = await text({ path: "long-next.txt" });
	const longNextNotice = "\n\n[Line 1 is not shown in full. Use offset=2 to continue.]";
	assert.equal(longNext, "Ж" + "я".repeat(Math.floor((51200 - Buffer.byteLength(longNextNotice)) / 2) - 1) + longNextNotice);
	assert.equal(await text({ path: "long-next.txt", offset: 2 }), "next");
	await writeFile(join(cwd, "bytes.txt"), "a".repeat(50000) + "\n" + "б".repeat(1000));
	assert.equal(await text({ path: "bytes.txt", limit: 2 }), "a".repeat(50000) + "\n\n[Use offset=2 to continue.]");
	assert.equal(await text({ path: "bytes.txt", offset: 2 }), "б".repeat(1000));
	await writeFile(join(cwd, "boundary.txt"), "a".repeat(51200) + "\nnext");
	const boundary = await text({ path: "boundary.txt" });
	assert.ok(Buffer.byteLength(boundary) <= 51200);
	const boundaryNotice = "\n\n[Line 1 is not shown in full. Use offset=2 to continue.]";
	assert.equal(boundary, "a".repeat(51200 - Buffer.byteLength(boundaryNotice)) + boundaryNotice);
	assert.equal(await text({ path: "boundary.txt", offset: 2 }), "next");
});

test("rqw_readfile does not decode an unrequested next line", async (t) => {
	const { cwd, text } = await fixture(t);
	const notice = "\n\n[Line 1 is not shown in full. Use offset=2 to continue.]";
	await writeFile(join(cwd, "invalid-next.txt"), Buffer.concat([Buffer.from("a".repeat(60000) + "\n"), Buffer.from([0xff])]));
	assert.equal(await text({ path: "invalid-next.txt", limit: 1 }), "a".repeat(51200 - Buffer.byteLength(notice)) + notice);
	await writeFile(join(cwd, "short-next.txt"), Buffer.concat([Buffer.from("first\n"), Buffer.from([0xff])]));
	assert.equal(await text({ path: "short-next.txt", limit: 1 }), "first\n\n[Use offset=2 to continue.]");
	const utf16 = Buffer.from("я".repeat(30000) + "\n", "utf16le");
	await writeFile(join(cwd, "utf16-next.txt"), Buffer.concat([Buffer.from([0xff, 0xfe]), utf16, Buffer.from([0xff])]));
	assert.equal(await text({ path: "utf16-next.txt", limit: 1 }), "я".repeat(Math.floor((51200 - Buffer.byteLength(notice)) / 2)) + notice);
});

test("rqw_readfile keeps its name, schema and full descriptions", async (t) => {
	const { tool } = await fixture(t);
	assert.equal(tool.name, "rqw_readfile");
	assert.deepEqual(tool.parameters.required, ["path"]);
	assert.equal(tool.parameters.properties.offset.type, "integer");
	assert.equal(tool.parameters.properties.path.description, "The relative or absolute path of the file to read.");
	assert.equal(tool.parameters.properties.limit.description, "The number of lines to read. Only provide if the file is too large to read at once.");
	assert.equal(tool.parameters.properties.offset.description, "The line number to start reading from. Positive values are 1-indexed from the start of the file. Negative values count backwards from the end (e.g. -1 is the last line). Only provide if the file is too large to read at once.");
	assert.equal(tool.description.replaceAll("\r\n", "\n"), `Reads a file from the local filesystem. You can access any file directly by using this tool.
If the User provides a path to a file assume that path is valid. It is okay to read a file that does not exist; an error will be returned.

Usage:
- You can optionally specify a line offset and limit (especially handy for long files), but it's recommended to read the whole file by not providing these parameters. Output is limited to 2000 lines or 50KiB; a longer file returns its first part with an exact continuation offset.
- You have the capability to call multiple tools in a single response. It is always better to speculatively read multiple files as a batch that are potentially useful.
- If you read a file that exists but has empty contents you will receive 'File is empty.'

Image Support:
- This tool can also read image files when called with the appropriate path.
- Supported image formats: jpeg/jpg, png, gif, webp, bmp.

PDF Support:
- PDF files return an unsupported-format error; there is no PDF conversion.`.replaceAll("\r\n", "\n"));
});

test("rqw_readfile reads text beginning with BM", async (t) => {
	const { cwd, text } = await fixture(t);
	await writeFile(join(cwd, "text.txt"), "BM is a text prefix");
	assert.equal(await text({ path: "text.txt" }), "BM is a text prefix");
	const longText = "BM is a text prefix followed by an ordinary sentence and Unicode: текст";
	await writeFile(join(cwd, "long-text.txt"), longText);
	assert.equal(await text({ path: "long-text.txt" }), longText);
});

test("rqw_readfile handles BOM, empty, missing and unsupported binary formats", async (t) => {
	const { cwd, text } = await fixture(t);
	await writeFile(join(cwd, "empty"), "");
	assert.equal(await text({ path: "empty" }), "File is empty.");
	await writeFile(join(cwd, "utf8"), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("текст\r\nстрока")]));
	assert.equal(await text({ path: "utf8" }), "текст\nстрока");
	const utf16 = Buffer.from("one\r\nдва", "utf16le");
	await writeFile(join(cwd, "le"), Buffer.concat([Buffer.from([0xff, 0xfe]), utf16]));
	await writeFile(join(cwd, "be"), Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(utf16).swap16()]));
	assert.equal(await text({ path: "le" }), "one\nдва");
	assert.equal(await text({ path: "be" }), "one\nдва");
	await writeFile(join(cwd, "binary"), Buffer.from([1, 0, 2]));
	await assert.rejects(text({ path: "binary" }), /Unsupported binary/);
	await writeFile(join(cwd, "control"), Buffer.from([1, 2, 3]));
	await assert.rejects(text({ path: "control" }), /Unsupported binary/);
	await writeFile(join(cwd, "bad"), Buffer.from([0xff, 0xff]));
	await assert.rejects(text({ path: "bad" }), /Unsupported binary/);
	await writeFile(join(cwd, "file.pdf"), "%PDF-1.7");
	await assert.rejects(text({ path: "file.pdf" }), /Unsupported format: PDF/);
	await assert.rejects(text({ path: "missing" }), /ENOENT/);
});

test("rqw_readfile delegates image processing and reports non-vision models", async (t) => {
	const { cwd, execute } = await fixture(t);
	const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
	await writeFile(join(cwd, "image.png"), png);
	const result = await execute({ path: "image.png" }, { cwd, model: { input: ["text"] } });
	assert.equal(result.structuredContent.type, "image");
	assert.equal(result.structuredContent.mimeType, "image/png");
	const pngBlock = result.content.find((block: any) => block.type === "image");
	assert.ok(pngBlock);
	assert.equal(pngBlock.mimeType, "image/png");
	assert.deepEqual(Buffer.from(pngBlock.data, "base64"), png);
	assert.equal(result.structuredContent.data, pngBlock.data);
	assert.match(result.structuredContent.note, /does not support images/);
	const images = [
		["image.jpg", Buffer.from([0xff, 0xd8, 0xff, 0xd9]), "image/jpeg"],
		["image.gif", Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64"), "image/gif"],
		["image.webp", Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64"), "image/webp"],
	] as const;
	for (const [name, bytes, mime] of images) {
		await writeFile(join(cwd, name), bytes);
		const image = await execute({ path: name });
		assert.equal(image.structuredContent.mimeType, mime);
		const block = image.content.find((entry: any) => entry.type === "image");
		assert.ok(block);
		assert.equal(block.mimeType, mime);
		assert.deepEqual(Buffer.from(block.data, "base64"), bytes);
		assert.equal(image.structuredContent.data, block.data);
	}
	const bmp = Buffer.alloc(58);
	bmp.write("BM"); bmp.writeUInt32LE(58, 2); bmp.writeUInt32LE(54, 10); bmp.writeUInt32LE(40, 14);
	bmp.writeInt32LE(1, 18); bmp.writeInt32LE(1, 22); bmp.writeUInt16LE(1, 26); bmp.writeUInt16LE(24, 28);
	await writeFile(join(cwd, "image.bmp"), bmp);
	const bmpResult = await execute({ path: "image.bmp" });
	assert.equal(bmpResult.structuredContent.mimeType, "image/png");
	const bmpBlock = bmpResult.content.find((block: any) => block.type === "image");
	assert.ok(bmpBlock);
	assert.equal(bmpBlock.mimeType, "image/png");
	const bmpPng = Buffer.from(bmpBlock.data, "base64");
	assert.deepEqual(bmpPng.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
	assert.equal(bmpPng.readUInt32BE(16), 1);
	assert.equal(bmpPng.readUInt32BE(20), 1);
	assert.equal(bmpResult.structuredContent.data, bmpBlock.data);
	const large = Buffer.alloc(70);
	large.write("BM"); large.writeUInt32LE(70, 2); large.writeUInt32LE(54, 10); large.writeUInt32LE(40, 14);
	large.writeInt32LE(2, 18); large.writeInt32LE(2, 22); large.writeUInt16LE(1, 26); large.writeUInt16LE(24, 28);
	await writeFile(join(cwd, "large.bmp"), large);
	const resizing: any = createReadFileTool(cwd, () => ({ images: { autoResize: true } }));
	const resized = await resizing.execute("test", { path: "large.bmp" }, undefined, undefined, { cwd, model: { input: ["image"], inputLimits: { images: { resize: { maxWidth: 1, maxHeight: 1 } } } } });
	const attachment = resized.content.find((block: any) => block.type === "image");
	assert.ok(attachment);
	assert.equal(attachment.mimeType, "image/png");
	const resizedPng = Buffer.from(attachment.data, "base64");
	assert.deepEqual(resizedPng.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
	assert.equal(resized.structuredContent.data, attachment.data);
	assert.equal(resizedPng.readUInt32BE(16), 1);
	assert.equal(resizedPng.readUInt32BE(20), 1);
	assert.match(resized.structuredContent.note, /original 2x2, displayed at 1x1/);
	await writeFile(join(cwd, "bad.png"), png.subarray(0, 8));
	await assert.rejects(execute({ path: "bad.png" }), /Unsupported or invalid image/);
});

test("rqw_readfile permits explicit ignored paths and respects abort", async (t) => {
	const { cwd, execute, text } = await fixture(t);
	await mkdir(join(cwd, ".git"));
	await writeFile(join(cwd, ".git", "config"), "explicit read");
	await writeFile(join(cwd, ".gitignore"), "private.txt\n");
	await writeFile(join(cwd, "private.txt"), "ignored file");
	assert.equal(await text({ path: ".git/config" }), "explicit read");
	assert.equal(await text({ path: "private.txt" }), "ignored file");
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(execute({ path: "missing" }, { cwd }, controller.signal), /aborted/);
});

// macOS names the screenshot with U+202F before AM/PM; the model usually sees a plain space.
test("rqw_readfile opens a screenshot name with U+202F before PM", async (t) => {
	const { cwd, text, execute } = await fixture(t);
	const name = "pasted-image-20261031-10028\u202FPM";
	await writeFile(join(cwd, `${name}.txt`), "narrow");
	await t.test("plain space", async () => assert.equal(await text({ path: name.replace("\u202F", " ") + ".txt" }), "narrow"));
	await t.test("exact U+202F", async () => assert.equal(await text({ path: `${name}.txt` }), "narrow"));
	await t.test("exact U+202F, absolute", async () => assert.equal(await text({ path: join(cwd, `${name}.txt`) }), "narrow"));
	await t.test("image", async () => {
		const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==", "base64");
		await writeFile(join(cwd, `${name}.png`), png);
		for (const path of [name.replace("\u202F", " ") + ".png", `${name}.png`]) {
			const result = await execute({ path });
			assert.ok(result.content.some((block: any) => block.type === "image"), path);
		}
	});
});

test("rqw_readfile keeps the exact U+202F file when a plain-space sibling exists", async (t) => {
	const { cwd, text, execute } = await fixture(t);
	const exact = "shot 10028\u202FPM", plain = "shot 10028 PM";
	await writeFile(join(cwd, `${exact}.txt`), "exact");
	await writeFile(join(cwd, `${plain}.txt`), "plain");
	assert.equal(await text({ path: `${exact}.txt` }), "exact");
	assert.equal(await text({ path: `${plain}.txt` }), "plain");
	const exactPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==", "base64");
	const plainPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNg+M/wHwAEAQH/q842iQAAAABJRU5ErkJggg==", "base64");
	await writeFile(join(cwd, `${exact}.png`), exactPng);
	await writeFile(join(cwd, `${plain}.png`), plainPng);
	// Resizing is off in the fixture, so the returned image is the source file.
	const bytes = async (path: string) => Buffer.from((await execute({ path })).content.find((b: any) => b.type === "image").data, "base64");
	assert.deepEqual(await bytes(`${exact}.png`), exactPng);
	assert.deepEqual(await bytes(`${plain}.png`), plainPng);
});

test("rqw_readfile still reads foo for @foo even when a file named @foo exists", async (t) => {
	const { cwd, text } = await fixture(t);
	await writeFile(join(cwd, "foo"), "plain foo");
	await writeFile(join(cwd, "@foo"), "at foo");
	assert.equal(await text({ path: "@foo" }), "plain foo");
});
