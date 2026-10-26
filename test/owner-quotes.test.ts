import assert from "node:assert/strict";
import * as fs from "node:fs";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { registerHooks } from "node:module";
import { after, describe, it } from "node:test";
import { extractOwnerMessages, findNonVerbatimQuotes, findQuotes, loadOwnerMessages,
	normalizeQuote, ownerSessionDirs } from "../scripts/owner-quotes.mjs";

const temps: string[] = [];
const temp = () => { const dir = mkdtempSync(join(tmpdir(), "owner-quotes-")); temps.push(dir); return dir; };
after(() => { for (const dir of temps) rmSync(dir, { recursive: true, force: true }); });
const user = (content: unknown) => ({ type: "message", message: { role: "user", content } });

describe("owner quote helpers", { skip: process.platform !== "darwin" && "Local development tooling is supported only on the owner's macOS laptop" }, () => {
	it("normalizes NFC and whitespace but not spelling, punctuation or case", () => {
		assert.equal(normalizeQuote("  Cafe\u0301\n\twith\u00a0spaces  "), "Café with spaces");
		assert.equal(findNonVerbatimQuotes("«café»", ["Café"]).length, 1);
		assert.equal(findNonVerbatimQuotes("«Café!»", ["Café."]).length, 1);
	});

	it("extracts only user message string content and text blocks", () => {
		assert.deepEqual(extractOwnerMessages([
			user("string"), user([{ type: "text", text: "first" }, { type: "image", text: "not text" },
				{ type: "text", text: "second" }, { type: "text", text: 42 }]),
			{ type: "message", message: { role: "assistant", content: "not owner" } },
			{ type: "message", message: { role: "toolResult", content: "not owner" } },
			{ type: "custom", message: { role: "user", content: "not message" } },
			{ role: "user", content: "not entry" }, user([{ type: "image", data: "hidden" }]), null,
		]), ["string", "first\nsecond"]);
	});

	it("reports offsets and inclusive lines for multiline and adjacent spans", () => {
		const text = "preamble\n«first\nsecond» «third»";
		const spans = findQuotes(text);
		assert.deepEqual(spans, [
			{ text: "first\nsecond", start: 9, end: 23, startLine: 2, endLine: 3, malformed: false },
			{ text: "third", start: 24, end: 31, startLine: 3, endLine: 3, malformed: false },
		]);
	});

	it("does not assemble one quote across separate owner messages", () => {
		assert.equal(findNonVerbatimQuotes("«first second»", ["first", "second"]).length, 1);
		assert.equal(findNonVerbatimQuotes("«first\nsecond»", ["first second"]).length, 0);
	});

	it("accepts literal owner ellipses and balanced nested guillemets", () => {
		for (const message of ["Wait... keep going.", "Wait… keep going.", "Use «...» shorthand.",
			"outer «inner» tail", "outer «middle «inner» tail» end"]) {
			assert.deepEqual(findNonVerbatimQuotes(`«${message}»`, [message]), [], message);
		}
		assert.equal(findQuotes("«outer «inner» tail»")[0].malformed, false);
		assert.equal(findQuotes("«outer «inner» tail»")[0].text, "outer «inner» tail");
	});

	it("rejects fabricated nested quotes and inserted ellipses by exact comparison", () => {
		for (const text of ["«Keep ... words.»", "«Keep … words.»", "«Keep «exact» words.»"]) {
			assert.equal(findNonVerbatimQuotes(text, ["Keep the owner's exact words."]).length, 1, text);
		}
	});

	it("rejects unbalanced and empty quotes even if present in the corpus", () => {
		for (const text of ["«unclosed", "unopened»", "«outer «inner»", "«outer» tail»", "«»"]) {
			assert.ok(findNonVerbatimQuotes(text, [text]).length, text);
		}
	});

	it("loads nested JSONL files structurally and never searches assistant serialized text", () => {
		const root = temp();
		mkdirSync(join(root, "nested"));
		writeFileSync(join(root, "nested", "session.jsonl"), [user("owner words"),
			{ type: "message", message: { role: "assistant", content: "assistant only" } },
			user([{ type: "text", text: "block words" }, { type: "image", text: "image secret" }]),
		].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
		writeFileSync(join(root, "ignore.txt"), "not JSONL");
		assert.deepEqual(loadOwnerMessages([root, root]), ["owner words", "block words"]);
		assert.throws(() => loadOwnerMessages([join(root, "missing")]), /no session files found/);
		assert.equal(findNonVerbatimQuotes("«assistant only»", loadOwnerMessages([root])).length, 1);
	});

	it("loads sessions when whole-file reads exceed Node's string limit", async (t) => {
		const root = temp();
		const file = join(root, "session.jsonl");
		writeFileSync(file, JSON.stringify(user("streamed owner")) + "\n");
		const key = "__owner_quotes_fs_mock__";
		const names = ["readdirSync", "readFileSync", "openSync", "readSync", "closeSync"];
		(globalThis as any)[key] = { ...fs, readFileSync(path: unknown) {
			if (path === file) {
				const error = new Error("Cannot create a string longer than 0x1fffffe8 characters") as NodeJS.ErrnoException;
				error.code = "ERR_STRING_TOO_LONG";
				throw error;
			}
			return fs.readFileSync(path as any);
		} };
		const hooks = registerHooks({
			resolve(specifier, context, nextResolve) {
				if (specifier !== "node:fs") return nextResolve(specifier, context);
				return { url: "mock:owner-quotes-fs", shortCircuit: true };
			},
			load(specifier, context, nextLoad) {
				if (specifier !== "mock:owner-quotes-fs") return nextLoad(specifier, context);
				return { format: "module", shortCircuit: true, source: names.map((name) =>
					`export const ${name} = globalThis.${key}.${name};`).join("\n") };
			},
		});
		try {
			const loaded = await import(`../scripts/owner-quotes.mjs?stream=${Date.now()}`);
			assert.deepEqual(loaded.loadOwnerMessages([root]), ["streamed owner"]);
		} finally {
			hooks.deregister();
			delete (globalThis as any)[key];
		}
	});

	it("fails closed on corrupt JSONL or a corpus without owner messages", () => {
		const root = temp();
		const file = join(root, "session.jsonl");
		writeFileSync(file, JSON.stringify(user("valid")) + "\n{truncated");
		assert.throws(() => loadOwnerMessages([root]), /invalid session JSONL at .*:2/);
		writeFileSync(file, JSON.stringify({ type: "message", message: { role: "assistant", content: "text" } }));
		assert.throws(() => loadOwnerMessages([root]), /no owner user messages/);
	});

	it("discovers checkout, registered external worktree and removed sibling worktree sessions", () => {
		const home = temp();
		const sessions = join(home, ".pi", "agent", "sessions");
		mkdirSync(join(sessions, "--Users-owner-my-pi-worktrees-old--"), { recursive: true });
		mkdirSync(join(sessions, "--Users-owner-unrelated--"));
		const dirs = ownerSessionDirs(["/Users/owner/my-pi", "/tmp/external"], { home, env: {} });
		assert.deepEqual(new Set(dirs), new Set(["--Users-owner-my-pi--", "--tmp-external--",
			"--Users-owner-my-pi-worktrees-old--"].map((name) => join(sessions, name))));
	});

	it("encodes Windows checkout paths and honors an explicit empty override", () => {
		const home = temp();
		assert.deepEqual(ownerSessionDirs(["C:\\Users\\owner\\my-pi"], { home, env: {} }),
			[join(home, ".pi", "agent", "sessions", "--C--Users-owner-my-pi--")]);
		assert.deepEqual(ownerSessionDirs(["/repo"], { home, env: { MY_PI_SESSIONS: `one${delimiter}two` } }), ["one", "two"]);
		assert.deepEqual(ownerSessionDirs(["/repo"], { home, env: { MY_PI_SESSIONS: "" } }), []);
	});
});
