import assert from "node:assert/strict";
import test from "node:test";
import { withFileLock } from "../../../extensions/RQW-tools/lock.ts";

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => { resolve = done; });
	return { promise, resolve };
}

test("same-path writes cannot interleave", async () => {
	const entered = deferred();
	const release = deferred();
	let text = "partial";
	const first = withFileLock("same", async () => {
		entered.resolve();
		await release.promise;
		text = "complete";
	});
	await entered.promise;
	const second = withFileLock("same", async () => text);
	await Promise.resolve();
	release.resolve();
	await first;
	assert.equal(await second, "complete");
});

test("different paths remain parallel", async () => {
	const entered = deferred();
	const release = deferred();
	const first = withFileLock("first", async () => {
		entered.resolve();
		await release.promise;
	});
	await entered.promise;
	try {
		assert.equal(await withFileLock("other", async () => "done"), "done");
	} finally {
		release.resolve();
		await first;
	}
});

test("an error releases the lock", async () => {
	const first = withFileLock("error", async () => { throw new Error("failed"); });
	const second = withFileLock("error", async () => "done");
	await assert.rejects(first, /failed/);
	assert.equal(await second, "done");
});

test("a cancelled queued call returns before its predecessor and frees its slot", async () => {
	const entered = deferred();
	const release = deferred();
	const controller = new AbortController();
	let state = "held";
	const first = withFileLock("cancel", async () => {
		entered.resolve();
		await release.promise;
		state = "released";
	});
	await entered.promise;
	const cancelled = withFileLock("cancel", async () => "must not run", controller.signal);
	const rejected = assert.rejects(cancelled, /Operation aborted/);
	const next = withFileLock("cancel", async () => state);
	controller.abort();
	try {
		await rejected;
	} finally {
		release.resolve();
	}
	await first;
	assert.equal(await next, "released");
});

test("multi-file calls in reversed order do not deadlock", async () => {
	const entered = deferred();
	const release = deferred();
	const first = Promise.all(["a", "b"].map((path) => withFileLock(path, async () => {
		entered.resolve();
		await release.promise;
		return path;
	})));
	await entered.promise;
	const second = Promise.all(["b", "a"].map((path) => withFileLock(path, async () => path)));
	release.resolve();
	assert.deepEqual(await first, ["a", "b"]);
	assert.deepEqual(await second, ["b", "a"]);
});
