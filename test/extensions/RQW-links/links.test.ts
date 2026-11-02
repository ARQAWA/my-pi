import assert from "node:assert/strict";
import { it } from "node:test";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { Markdown, resetCapabilitiesCache, type MarkdownTheme } from "@earendil-works/pi-tui";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import links, { installLinks } from "../../../extensions/RQW-links/index.ts";

const identity = (text: string) => text;
const theme: MarkdownTheme = {
	heading: identity, link: identity, linkUrl: identity, code: identity, codeBlock: identity,
	codeBlockBorder: identity, quote: identity, quoteBorder: identity, hr: identity,
	listBullet: identity, bold: identity, italic: identity, strikethrough: identity, underline: identity,
};
const render = (text: string) => new Markdown(text, 0, 0, theme).render(200).join("\n");
const target = (output: string) => /\x1b\]8;;([^\x1b]+)\x1b\\/.exec(output)?.[1];

it("renders local markdown links as encoded absolute file URIs", () => {
	const saved = process.env.PI_HYPERLINKS;
	process.env.PI_HYPERLINKS = "1";
	resetCapabilitiesCache();
	let restore: (() => void) | undefined;
	try {
		const relative = "[src/app.ts:12](src/app.ts:12)";
		assert.equal(target(render(relative)), "src/app.ts:12");
		restore = installLinks();
		assert.ok(restore);
		const output = render(relative);
		assert.equal(target(output), pathToFileURL(resolve("src/app.ts")).href);
		assert.match(output, /src\/app\.ts:12/);
		assert.equal(target(render("[README.md:12](README.md:12)")), pathToFileURL(resolve("README.md")).href);
		assert.equal(target(render("[file](<dir/файл a.md:12>)")), pathToFileURL(resolve("dir/файл a.md")).href);
		assert.equal(target(render("[file](dir/a%20b.md)")), pathToFileURL(resolve("dir/a b.md")).href);
		assert.equal(target(render("[section](README.md#section)")), `${pathToFileURL(resolve("README.md")).href}#section`);
		assert.equal(target(render("[file](dir/100%.md)")), pathToFileURL(resolve("dir/100%.md")).href);
		assert.equal(target(render("[file](</tmp/файл a.md:99>)")), pathToFileURL(resolve("/tmp/файл a.md")).href);
		assert.equal(target(render("[file](<C:/Users/файл a.md:12>)")), "file:///C:/Users/%D1%84%D0%B0%D0%B9%D0%BB%20a.md");
		assert.equal(target(render("[web](https://example.com/a:12)")), "https://example.com/a:12");
		assert.equal(target(render("[mail](mailto:a@example.com)")), "mailto:a@example.com");
		assert.equal(target(render("`src/app.ts:12`")), undefined);
	} finally {
		restore?.();
		if (saved === undefined) delete process.env.PI_HYPERLINKS;
		else process.env.PI_HYPERLINKS = saved;
		resetCapabilitiesCache();
	}
});

it("uses the session directory before rendering a switched session", () => {
	const saved = process.env.PI_HYPERLINKS;
	process.env.PI_HYPERLINKS = "1";
	resetCapabilitiesCache();
	const host = { renderInitialMessages() { return render("[file](src/app.ts:12)"); } };
	const original = host.renderInitialMessages;
	const restore = installLinks(undefined, "1.4.0", host);
	try {
		assert.ok(restore);
		const cwd = resolve("different-project");
		const output = host.renderInitialMessages.call({ sessionManager: { getCwd: () => cwd } });
		assert.equal(target(output), pathToFileURL(resolve(cwd, "src/app.ts")).href);
	} finally {
		restore?.();
		assert.equal(host.renderInitialMessages, original);
		if (saved === undefined) delete process.env.PI_HYPERLINKS;
		else process.env.PI_HYPERLINKS = saved;
		resetCapabilitiesCache();
	}
});

it("restores stock links after the last extension shuts down", () => {
	const saved = process.env.PI_HYPERLINKS;
	process.env.PI_HYPERLINKS = "1";
	resetCapabilitiesCache();
	const owners: Array<Map<string, (...args: any[]) => void>> = [];
	try {
		for (let i = 0; i < 2; i++) {
			const handlers = new Map<string, (...args: any[]) => void>();
			owners.push(handlers);
			links({ on: (name: string, handler: (...args: any[]) => void) => handlers.set(name, handler) } as unknown as ExtensionAPI);
			handlers.get("session_start")!({}, { cwd: resolve("project") });
		}
		const markdown = "[file](src/app.ts:12)";
		assert.equal(target(render(markdown)), pathToFileURL(resolve("project/src/app.ts")).href);
		owners[0]!.get("session_shutdown")!();
		assert.equal(target(render(markdown)), pathToFileURL(resolve("project/src/app.ts")).href);
		owners[1]!.get("session_shutdown")!();
		assert.equal(target(render(markdown)), "src/app.ts:12");
	} finally {
		for (const owner of owners) owner.get("session_shutdown")?.();
		if (saved === undefined) delete process.env.PI_HYPERLINKS;
		else process.env.PI_HYPERLINKS = saved;
		resetCapabilitiesCache();
	}
});

it("keeps the stock fallback on terminals without hyperlinks", () => {
	const saved = process.env.PI_HYPERLINKS;
	process.env.PI_HYPERLINKS = "0";
	resetCapabilitiesCache();
	let restore: (() => void) | undefined;
	try {
		const markdown = "[file](src/app.ts:12)";
		const stock = render(markdown);
		restore = installLinks();
		assert.ok(restore);
		assert.equal(render(markdown), stock);
	} finally {
		restore?.();
		if (saved === undefined) delete process.env.PI_HYPERLINKS;
		else process.env.PI_HYPERLINKS = saved;
		resetCapabilitiesCache();
	}
});

it("leaves an unsupported renderer untouched", () => {
	const proto = Markdown.prototype as any;
	const original = proto.renderInlineTokens;
	assert.equal(installLinks(proto, "other"), undefined);
	assert.equal(proto.renderInlineTokens, original);
	const incompatible = { renderInlineTokens() { return "stock"; } };
	const stock = incompatible.renderInlineTokens;
	assert.equal(installLinks(incompatible, "1.4.0"), undefined);
	assert.equal(incompatible.renderInlineTokens, stock);
});
