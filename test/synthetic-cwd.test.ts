import assert from "node:assert/strict";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import os from "node:os";
import { syncBuiltinESMExports } from "node:module";
import { after, it, type TestContext } from "node:test";
import { reportTimings, text, world } from "./synthetic/world.ts";

after(() => reportTimings(import.meta.filename));

// RQW-cwd knows system folders only on macOS and Windows.
const supported = process.platform === "darwin" || process.platform === "win32";

/** Makes `folder` the home folder for the extension, and gives the real function and the process folder back after the test. */
function homeIs(t: TestContext, folder: string): void {
	const homedir = os.homedir;
	const cwd = process.cwd();
	os.homedir = () => folder;
	syncBuiltinESMExports();
	t.after(() => {
		os.homedir = homedir;
		syncBuiltinESMExports();
		process.chdir(cwd);
	});
}

it("a chat started in the home folder moves to the temp folder as a new chat", { skip: !supported }, async (t) => {
	const w = await world(t);
	w.model.script(text("first answer"));
	await w.submit("first question");
	const oldFile = w.sessionFile!;
	const before = readFileSync(oldFile, "utf8");
	assert.equal(w.session.sessionManager.getCwd(), w.dirs.project);

	// The project folder is now the home folder: a restart starts Pi there.
	homeIs(t, w.dirs.project);
	const w2 = await w.restart();

	assert.equal(w2.session.sessionManager.getCwd(), os.tmpdir());
	assert.notEqual(w2.sessionFile, oldFile);
	w2.notSee("first answer");
	assert.equal(readFileSync(oldFile, "utf8"), before, "the old session file is untouched");
	w2.model.script(text("second answer"));
	await w2.submit("second question");
	w2.see("second answer");
	assert.ok(existsSync(w2.sessionFile!));
	const request = w2.requests.filter((item) => item.background === undefined).at(-1)!;
	const system = request.context.messages.find((message) => message.role === "system") as unknown as { sections: { cwd: string } };
	// Pi writes the folder with forward slashes; Windows may name the temp folder in its short or long form.
	const slashes = (path: string) => path.replace(/\\/g, "/").toLowerCase();
	const named = [os.tmpdir(), realpathSync.native(os.tmpdir())].map(slashes);
	assert.ok(named.some((folder) => slashes(system.sections.cwd).includes(folder)), "the prompt names the temp folder");
	assert.ok(!slashes(system.sections.cwd).includes(slashes(w.dirs.project)), "the old project folder is gone from the prompt");
	assert.doesNotMatch(JSON.stringify(request.context.messages), /first question/);
});

it("a subfolder of the home folder stays where it is", { skip: !supported }, async (t) => {
	const w = await world(t);
	w.model.script(text("first answer"));
	await w.submit("first question");
	const file = w.sessionFile;

	homeIs(t, w.dirs.base);
	const w2 = await w.restart();

	assert.equal(w2.session.sessionManager.getCwd(), w.dirs.project);
	assert.equal(w2.sessionFile, file);
	w2.see("first answer");
});
