import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createReadOnlyCredentialStore, READ_ONLY_MESSAGE } from "../cli/web/credentials.ts";

// Fake, non-secret placeholder values only.
const FAKE_ACCESS = "fake-access-value-for-tests";
const FAKE_REFRESH = "fake-refresh-value-for-tests";

function authFile(content: unknown): string {
	const path = join(mkdtempSync(join(tmpdir(), "rqw-web-auth-")), "auth.json");
	writeFileSync(path, JSON.stringify(content));
	return path;
}
const oauth = { type: "oauth", access: FAKE_ACCESS, refresh: FAKE_REFRESH, expires: Date.now() + 3_600_000 };

describe("rqw-web cross-platform CLI", () => {
describe("rqw-web read-only credential store", () => {
	it("reads only a saved openai-codex OAuth login", async () => {
		const path = authFile({ "openai-codex": oauth, anthropic: { type: "api_key", key: "fake-key" } });
		const store = createReadOnlyCredentialStore(path);
		assert.deepEqual(await store.read("openai-codex"), oauth);
		assert.equal(await store.read("anthropic"), undefined);
		assert.deepEqual(await store.list(), [{ providerId: "openai-codex", type: "oauth" }]);
	});

	it("never serves an api_key entry or a missing file as the subscription login", async () => {
		const apiKey = createReadOnlyCredentialStore(authFile({ "openai-codex": { type: "api_key", key: "fake-key" } }));
		assert.equal(await apiKey.read("openai-codex"), undefined);
		assert.deepEqual(await apiKey.list(), []);
		const missing = createReadOnlyCredentialStore(join(tmpdir(), "rqw-web-does-not-exist", "auth.json"));
		assert.equal(await missing.read("openai-codex"), undefined);
	});

	it("refuses modify and delete with the login hint and leaves the file untouched", async () => {
		const path = authFile({ "openai-codex": oauth });
		const before = readFileSync(path, "utf8");
		const mtime = statSync(path).mtimeMs;
		const store = createReadOnlyCredentialStore(path);
		let ran = false;
		await assert.rejects(store.modify("openai-codex", async () => (ran = true, undefined)), error => {
			assert.equal((error as Error).message, READ_ONLY_MESSAGE);
			assert.equal(READ_ONLY_MESSAGE.includes(FAKE_ACCESS) || READ_ONLY_MESSAGE.includes(FAKE_REFRESH), false);
			return true;
		});
		await assert.rejects(store.delete("openai-codex"), /\/login openai-codex/);
		assert.equal(ran, false, "the refresh callback never runs");
		assert.equal(readFileSync(path, "utf8"), before);
		assert.equal(statSync(path).mtimeMs, mtime);
	});

	it("honours an aborted signal", async () => {
		const store = createReadOnlyCredentialStore(authFile({ "openai-codex": oauth }));
		const controller = new AbortController();
		controller.abort(new Error("stop"));
		await assert.rejects(store.read("openai-codex", { signal: controller.signal }), /stop/);
	});
});

});
