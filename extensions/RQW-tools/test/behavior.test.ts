import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import {
	createBashToolDefinition,
	createEditToolDefinition,
	createWriteToolDefinition,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { executeEdit } from "../edit.ts";
import { createTools } from "../index.ts";
import { executeWrite } from "../write.ts";

const context = (cwd: string) => ({
	cwd,
	sessionManager: { getSessionId: () => "behavior", getSessionFile: () => undefined },
});

describe("bash uses stock SettingsManager shellPath normalization", () => {
	it("executes file URLs and tilde paths with the current command prefix", { skip: process.platform === "win32" }, async () => {
		const cwd = process.cwd();
		let shellPath = pathToFileURL("/bin/bash").href;
		const bash = createTools(cwd, () => ({ shellPath, shellCommandPrefix: "printf PREFIX" })).find((t) => t.name === "bash")!;
		for (const path of [shellPath, `~/${relative(homedir(), "/bin/bash")}`]) {
			shellPath = path;
			const stock = createBashToolDefinition(cwd, {
				shellPath: SettingsManager.inMemory({ shellPath }).getShellPath(),
				commandPrefix: "printf PREFIX",
			});
			const params = { command: "printf OK", timeout: 3 };
			const expected = await stock.execute("id", params, undefined, undefined, context(cwd));
			const actual = await bash.execute("id", params, undefined, undefined, context(cwd));
			// Separate processes have independent elapsed times; every other result field must match stock.
			const withoutTiming = (result: typeof expected) => {
				const { wall_time_seconds, ...structuredContent } = result.structuredContent!;
				assert.equal(typeof wall_time_seconds, "number");
				assert.ok(wall_time_seconds >= 0);
				return { ...result, structuredContent };
			};
			assert.deepEqual(withoutTiming(actual), withoutTiming(expected));
			assert.equal(expected.content[0].type === "text" && expected.content[0].text, "PREFIXOK");
		}
	});

	it("matches stock rejection paths for file URLs, tilde and Windows/MSYS/WSL/Cygwin", async () => {
		const original = Object.getOwnPropertyDescriptor(process, "platform")!;
		const missingShellURL = pathToFileURL(join(process.cwd(), "rqw-no-such-shell name")).href;
		try {
			for (const platform of ["darwin", "linux", "win32"]) {
				Object.defineProperty(process, "platform", { ...original, value: platform });
				for (const shellPath of [
					missingShellURL, "~/rqw-no-such-shell", "~\\rqw-no-such-shell",
					"/z/rqw-no-such-shell", "/mnt/z/rqw-no-such-shell", "/cygdrive/z/rqw-no-such-shell",
					"Z:\\rqw-no-such-shell", "//rqw-no-such-host/share/bash", "relative-no-such-shell",
				]) {
					const settings = SettingsManager.inMemory({ shellPath });
					const expectedPath = settings.getShellPath();
					const stock = createBashToolDefinition(process.cwd(), { shellPath: expectedPath });
					const bash = createTools(process.cwd(), () => settings.getSettings()).find((t) => t.name === "bash")!;
					const params = { command: "printf UNUSED" };
					let expected: unknown;
					try { await stock.execute("id", params, undefined, undefined, context(process.cwd())); }
					catch (error) { expected = error; }
					assert.ok(expected instanceof Error);
					assert.ok(expected.message.includes(expectedPath!), expected.message);
					await assert.rejects(bash.execute("id", params, undefined, undefined, context(process.cwd())), { message: expected.message });
				}
			}
		} finally {
			Object.defineProperty(process, "platform", original);
		}
	});
});

describe("multi-file cancellation after stock writeFile commits", () => {
	for (const which of ["edit", "write"] as const) {
		it(`${which}: distinguishes possibly changed, successful and known pre-write failed files`, async () => {
			const cwd = await mkdtemp(join(tmpdir(), "rqw-post-write-"));
			try {
				const controller = new AbortController();
				const good = join(cwd, "good", "file.txt");
				const bad = join(cwd, "bad", "file.txt");
				const committed = join(cwd, "committed", "file.txt");
				for (const name of ["good", "committed"]) {
					await mkdir(join(cwd, name));
					await writeFile(join(cwd, name, "file.txt"), "OLD\n");
				}
				const { promise: goodDone, resolve: finishGood } = Promise.withResolvers<void>();
				const { promise: badDone, resolve: finishBad } = Promise.withResolvers<void>();
				const writes: string[] = [];
				const operations = {
					readFile,
					access,
					mkdir: (path: string) => mkdir(path, { recursive: true }).then(() => {}),
					writeFile: async (path: string, content: string) => {
						writes.push(path);
						if (path === committed) await Promise.all([goodDone, badDone]);
						await writeFile(path, content);
						if (path === committed) controller.abort();
					},
				};
				// Write fails in mkdir, edit fails in access: neither failure reached writeFile.
				const editStock = createEditToolDefinition(cwd, { operations });
				const writeStock = createWriteToolDefinition(cwd, { operations: {
						...operations,
						mkdir: async (path) => {
							if (path === join(cwd, "bad")) throw Object.assign(new Error("pre-write failure"), { code: "ENOENT" });
							await operations.mkdir(path);
						},
					} });
				let goodDetails: unknown;
				const execute = async (id: string, params: { path: string; edits: { oldText: string; newText: string }[] } | { path: string; content: string }, signal?: AbortSignal) => {
					try {
						const result = "edits" in params
							? await editStock.execute(id, params, signal, undefined, { cwd })
							: await writeStock.execute(id, params, signal, undefined, { cwd });
						if (params.path === good) goodDetails = result.details;
						return result;
					} finally {
						if (params.path === good) finishGood();
						if (params.path === bad) finishBad();
					}
				};
				const paths = [committed, bad, good];
				const result = which === "edit"
					? await executeEdit(execute, "id", { edits: paths.map((path) => ({ path, oldText: "OLD", newText: "NEW" })) }, controller.signal, undefined, { cwd }, cwd)
					: await executeWrite(execute, "id", { files: paths.map((path) => ({ path, content: "NEW\n" })) }, controller.signal, undefined, { cwd }, cwd);
				assert.equal(result.isError, true);
				assert.deepEqual(result.details.files[0], { path: committed, ok: false, error: "Operation aborted", outcome: "possibly_changed" });
				assert.equal(result.details.files[1].ok, false);
				assert.equal(result.details.files[1].outcome, undefined, "a shared aborted signal must not relabel a known failure");
				assert.match(result.details.files[1].error, which === "edit" ? /Could not edit file/ : /pre-write failure/);
				assert.deepEqual(result.details.files[2], { path: good, ok: true, ...(goodDetails !== undefined ? { details: goodDetails } : {}) });
				if (which === "edit") assert.ok(goodDetails && typeof goodDetails === "object" && "patch" in goodDetails);
				assert.match(result.content[0].text, /Possibly changed:[^\n]+Read this file before retrying\./);
				assert.equal(await readFile(committed, "utf8"), "NEW\n");
				assert.equal(await readFile(good, "utf8"), "NEW\n");
				assert.equal(writes.includes(bad), false);
			} finally {
				await rm(cwd, { recursive: true, force: true });
			}
		});

		it(`${which}: already-aborted calls leave files untouched without an uncertain outcome`, async () => {
			const cwd = await mkdtemp(join(tmpdir(), "rqw-pre-abort-"));
			try {
				const paths = [join(cwd, "a.txt"), join(cwd, "b.txt")];
				for (const path of paths) await writeFile(path, "OLD\n");
				const controller = new AbortController();
				controller.abort();
				let writes = 0;
				const operations = { readFile, access, mkdir: async () => {}, writeFile: async () => { writes++; } };
				const result = which === "edit"
					? await executeEdit(createEditToolDefinition(cwd, { operations }).execute, "id", { edits: paths.map((path) => ({ path, oldText: "OLD", newText: "NEW" })) }, controller.signal, undefined, { cwd }, cwd)
					: await executeWrite(createWriteToolDefinition(cwd, { operations }).execute, "id", { files: paths.map((path) => ({ path, content: "NEW" })) }, controller.signal, undefined, { cwd }, cwd);
				assert.equal(writes, 0);
				assert.equal(result.isError, true);
				for (const file of result.details.files) {
					assert.equal(file.ok, false);
					assert.equal(file.outcome, undefined);
					assert.equal(await readFile(file.path, "utf8"), "OLD\n");
				}
			} finally {
				await rm(cwd, { recursive: true, force: true });
			}
		});
	}
});