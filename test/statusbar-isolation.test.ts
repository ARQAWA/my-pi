import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const root = join(repo, "extensions/RQW-statusbar");
const noNetwork = pathToFileURL(join(repo, "test", "no-network.mjs")).href;

function check(r: ReturnType<typeof spawnSync>, what: string) {
	assert.ifError(r.error);
	const details = `${what} failed (signal ${r.signal})\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`;
	assert.equal(r.status, 0, details);
	assert.match(String(r.stdout), /^# tests [1-9]\d*$/m, details);
	assert.match(String(r.stdout), /^# pass [1-9]\d*$/m, details);
	assert.match(String(r.stdout), /^# fail 0$/m, details);
}

function runTests(cwd: string, args: string[]) {
	const env = { ...process.env, PI_OFFLINE: "1" };
	delete env.NODE_TEST_CONTEXT;
	return spawnSync(process.execPath, ["--import", noNetwork, "--test", "--test-reporter=tap", ...args], {
		cwd, encoding: "utf8", timeout: 120000, env,
	});
}

it("isolation harness rejects missing execution and propagates a failing child", () => {
	const temp = mkdtempSync(join(tmpdir(), "rqw-statusbar-isolation-fault-"));
	try {
		const fixture = join(temp, "fault.test.mjs");
		const marker = join(temp, "executed");
		writeFileSync(fixture, `import { it } from "node:test";
import { writeFileSync } from "node:fs";
it("injected child failure", () => {
	writeFileSync(${JSON.stringify(marker)}, "executed");
	throw new Error("injected isolation fault");
});\n`);
		// Reproduce the old green result without running the failing test.
		const missing = spawnSync(process.execPath, ["--test", fixture], {
			cwd: temp, encoding: "utf8", timeout: 120000,
			env: { ...process.env, NODE_TEST_CONTEXT: "child-v8" },
		});
		assert.ifError(missing.error);
		assert.equal(missing.status, 0);
		assert.equal(existsSync(marker), false);
		assert.throws(() => check(missing, "missing execution"));

		const failed = runTests(temp, [fixture]);
		assert.equal(readFileSync(marker, "utf8"), "executed");
		assert.equal(failed.status, 1);
		assert.match(String(failed.stdout), /injected isolation fault/);
		assert.throws(() => check(failed, "injected child failure"));

		writeFileSync(fixture, 'import { it } from "node:test"; it("executed child", () => {});\n');
		check(runTests(temp, [fixture]), "executed child");
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
});

it("statusbar tests pass from a physical copy that holds only this extension folder", async () => {
	const temp = mkdtempSync(join(tmpdir(), "rqw-statusbar-isolation-"));
	try {
		await cp(root, join(temp, "extensions", "RQW-statusbar"), { recursive: true });
		await cp(join(repo, "package.json"), join(temp, "package.json"));
		// Junction on Windows; dependency resolution then matches the repo without copying packages.
		symlinkSync(join(repo, "node_modules"), join(temp, "node_modules"), "junction");
		assert.equal(existsSync(join(temp, "extensions", "RQW-context")), false);
		const manifest = JSON.parse(readFileSync(join(temp, "package.json"), "utf8"));
		assert.equal(manifest.type, "module");
		assert.ok(manifest.pi.extensions.includes("./extensions/RQW-statusbar/index.ts"));
		const copiedTests = join(temp, "test", "extensions", "RQW-statusbar");
		await cp(join(repo, "test", "extensions", "RQW-statusbar"), copiedTests, { recursive: true });
		const copied = join(copiedTests, "statusbar.test.ts");
		const allTests = readdirSync(copiedTests).filter((f) => f.endsWith(".test.ts")).map((f) => join(copiedTests, f));
		assert.ok(allTests.length > 0, "physical copy must contain test files");
		for (const file of allTests) {
			check(runTests(temp, [file]), file);
		}

		check(runTests(temp, ["--test-name-pattern=Pi reserves", copied]), "Pi reserves tests");
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
});
