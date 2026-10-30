// Joint regression through Pi's extension loader and fullscreen input path. Only external terminal/data are faked.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, it } from "node:test";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { makeFullscreen } from "./extensions/RQW-blocks/history-host.ts";
import { assistant, call, result, Session, text, theme, user } from "./extensions/RQW-tool-ui/fold-host.ts";

const WIDTH = 60;
const cleanups: (() => unknown)[] = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });

async function open(origin: "owner" | "card" | "work" = "owner", ms = 42_000, suffix = false) {
	const s = new Session();
	cleanups.push(() => s.end());
	if (origin === "owner") s.add(user("prefix owner", 1_000), 1_000);
	if (origin === "card") s.card("prefix card", 1_000);
	s.add(assistant([text("prefix work"), call("prefix", "prefix.ts")], "toolUse", origin === "work" ? 1_000 : 2_000), 2_000);
	s.add(result("prefix", "prefix body", 3_000), 3_000);
	if (origin === "owner") s.card("prefix card", 3_500);
	s.add(assistant([text("prefix interrupted")], "aborted", 4_000), 4_000);
	if (origin === "owner") s.add(user("prefix steering", 5_000), 5_000);
	const end = 1_000 + ms;
	s.add(assistant([text("prefix last work"), call("last", "last.ts")], "toolUse", end - 1_000), end - 1_000);
	// The saved timestamp of the last entry, not the tool call or result's message timestamp, ends the prefix.
	s.add(result("last", "last body", end - 100), end);
	const kept = s.add(assistant([text(suffix ? "suffix work" : "boundary answer")], suffix ? "toolUse" : "stop", end + 10_000), end + 10_000);
	if (suffix) s.add(assistant([text("boundary answer")], "stop", end + 11_000), end + 13_000);
	s.compact(kept, end + 14_000);
	for (let n = 0; n < 4; n++) s.turn(n, end + 100_000 + n * 100_000, 10 + n);

	const root = new URL("../", import.meta.url);
	const manifest = JSON.parse(readFileSync(new URL("package.json", root), "utf8")) as { pi: { extensions: string[] } };
	const paths = manifest.pi.extensions.filter(p => /RQW-(tool-ui|blocks)\/index\.ts$/.test(p)).map(p => fileURLToPath(new URL(p, root)));
	const { loadExtensions } = await import(new URL("node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js", root).href);
	const loaded = await loadExtensions(paths, fileURLToPath(root));
	assert.deepEqual(loaded.errors, []);
	const extensions = loaded.extensions as { handlers: Map<string, ((...args: any[]) => unknown)[]>; toolRenderers?: ((name: string, next: () => any) => any)[] }[];
	const ctx = { mode: "tui", hasUI: true, sessionManager: s.manager, ui: { theme, setWidget() {} } };
	cleanups.push(async () => { for (const extension of extensions.toReversed()) for (const handler of extension.handlers.get("session_shutdown") ?? []) await handler({}, ctx); });
	const fx = makeFullscreen(s.manager, { columns: WIDTH, rows: 20 });
	(fx.host.runtimeHost.session as any).resourceLoader = { getExtensions: () => loaded };
	cleanups.push(() => fx.stop());
	cleanups.push(() => {
		const host = fx.host as any;
		Object.assign(host, { isInitialized: false, disposeActiveSelector() {}, clearExtensionTerminalInputListeners() {}, unregisterSignalHandlers() {}, footerDataProvider: { dispose() {} } });
		Object.assign(host.footer, { dispose() {} });
		Object.assign(host.themeController, { disableAutoSync() {} });
		Object.assign(host.session.settingsManager, { getShowTerminalProgress: () => false });
		host.stop("none");
	});
	(fx.host.runtimeHost.session as any).extensionRunner.resolveToolRenderers = (name: string, next: () => unknown) => {
		let resolve = next;
		for (const extension of extensions.toReversed()) for (const renderer of (extension.toolRenderers ?? []).toReversed()) {
			const following = resolve;
			resolve = () => renderer(name, following);
		}
		return resolve();
	};
	(fx.host.runtimeHost.session as any).resourceLoader = { getExtensions: () => ({ runtime: s.manager, extensions }) };
	fx.host.renderInitialMessages();
	for (const extension of extensions) for (const handler of extension.handlers.get("session_start") ?? []) await handler({}, ctx);
	fx.frame();
	const rows = () => fx.host.chatContainer.render(WIDTH).map(stripTerminalSequences).map(row => row.trim()).filter(Boolean);
	const loadOlder = () => { fx.view.scrollTo(0); fx.frame(); fx.wheel(-1); };
	const click = (value: string) => {
		const document = fx.host.documentContainer.render(WIDTH).map(stripTerminalSequences);
		const at = document.findIndex((row: string) => row.includes(value));
		assert.ok(at >= 0, value);
		fx.view.scrollTo(Math.max(0, at - 3)); fx.frame();
		const y = fx.rows().findIndex(row => row.includes(value));
		assert.ok(y >= 0, value);
		fx.send(`\x1b[<0;2;${y + 1}M`); fx.send(`\x1b[<0;2;${y + 1}m`);
	};
	const unload = () => { fx.screen.scrollToBottom(); fx.frame(); };
	return { fx, rows, loadOlder, click, unload };
}

for (const [origin, ms, label] of [["owner", 42_000, "42s"], ["card", 123_000, "2m 03s"], ["work", 3_900_000, "1h 05m"]] as const) {
	it(`a loaded prefix starts closed and times from ${origin} to its last saved entry`, async () => {
		const m = await open(origin, ms);
		m.loadOlder();
		assert.ok(m.rows().includes(`worked for ${label} ›`));
		assert.ok(!m.rows().includes("prefix last work"));
	});
}

it("a loaded prefix hides intermediate work, cards, aborted output and the last tool component", async () => {
	const m = await open("card");
	m.loadOlder();
	(m.fx.host as any).setToolsExpanded(true);
	for (const value of ["prefix card", "prefix work", "prefix interrupted", "prefix last work", "prefix body", "last body"]) assert.ok(!m.rows().includes(value), value);
});

it("a closed prefix lifts each owner once and leaves the final answer visible", async () => {
	const m = await open();
	m.loadOlder();
	const rows = m.rows();
	const header = rows.indexOf("worked for 42s ›");
	assert.ok(header >= 0);
	for (const value of ["prefix owner", "prefix steering"]) {
		assert.equal(rows.filter(row => row === value).length, 1);
		assert.ok(rows.indexOf(value) < header);
	}
	assert.ok(rows.indexOf("boundary answer") > header);
});

it("opening a prefix restores the card among its original work and lifted-owner rows", async () => {
	const m = await open();
	m.loadOlder();
	assert.ok(!m.rows().includes("prefix card"));
	m.click("worked for 42s ›");
	const rows = m.rows();
	const sequence = ["prefix owner", "prefix work", "prefix card", "prefix interrupted", "prefix steering", "prefix last work", "boundary answer"].map(value => rows.indexOf(value));
	assert.ok(sequence.every(at => at >= 0));
	assert.deepEqual(sequence, [...sequence].sort((a, b) => a - b));
	assert.equal(rows.filter(row => row === "prefix card").length, 1);
});

it("opening a prefix never absorbs the kept suffix or its final answer", async () => {
	const m = await open("owner", 42_000, true);
	m.loadOlder(); m.click("worked for 42s ›");
	assert.ok(m.rows().includes("prefix last work") && !m.rows().includes("suffix work"));
	assert.ok(m.rows().includes("boundary answer") && m.rows().includes("worked for 3s ›"));
	m.click("worked for 3s ›");
	assert.ok(m.rows().includes("suffix work") && m.rows().includes("worked for 42s ˅"));
});

it("reloading an opened prefix closes it without closing an opened kept-tail fold", async () => {
	const m = await open();
	m.click("worked for 11s ›");
	m.loadOlder(); m.click("worked for 42s ›"); m.unload(); m.loadOlder();
	assert.ok(m.rows().includes("worked for 42s ›") && !m.rows().includes("prefix work"));
	assert.ok(m.rows().includes("worked for 11s ˅"));
});

it("loading measures the closed prefix before moving the rows being read", async () => {
	const m = await open();
	m.fx.view.scrollTo(1); m.fx.frame();
	const before = m.fx.host.documentContainer.render(WIDTH).map(stripTerminalSequences).map((row: string) => row.trimEnd());
	m.fx.wheel(-1);
	assert.deepEqual(m.fx.rows().slice(1, m.fx.view.viewportHeight - 1), before.slice(1, m.fx.view.viewportHeight - 1));
	// Two lifted user bundles and one closed header, not the much taller raw tool work.
	assert.ok(m.fx.host.documentContainer.render(WIDTH).length - before.length < 16);
	assert.ok(m.rows().includes("worked for 42s ›"));
});
