import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
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
	assert.equal(r.status, 0, `${what} failed (signal ${r.signal})\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
}

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
		const copiedTests = join(temp, "extensions", "RQW-statusbar", "test");
		const copied = join(copiedTests, "statusbar.test.ts");
		const allTests = readdirSync(copiedTests).filter((f) => f.endsWith(".test.ts")).map((f) => join(copiedTests, f));
		const env = { ...process.env, PI_OFFLINE: "1" };

		check(spawnSync(process.execPath, ["--import", noNetwork, "--test", ...allTests], {
			cwd: temp, encoding: "utf8", timeout: 120000, env,
		}), "statusbar tests");

		check(spawnSync(process.execPath, ["--import", noNetwork, "--test", "--test-name-pattern=Pi reserves", copied], {
			cwd: temp, encoding: "utf8", timeout: 120000, env,
		}), "Pi reserves tests");
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
});
