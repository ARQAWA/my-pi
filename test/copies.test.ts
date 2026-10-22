// The git guard is kept as two self-contained copies, one for RQW-agent and one for RQW-review; they must stay byte equal.
// Raw reads only: neither extension is imported or executed here.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("git guard copies", () => {
	it("RQW-agent and RQW-review git-guard.ts are byte for byte equal", () => {
		const agent = readFileSync(new URL("../extensions/RQW-agent/git-guard.ts", import.meta.url));
		const review = readFileSync(new URL("../extensions/RQW-review/git-guard.ts", import.meta.url));
		assert.ok(Buffer.isBuffer(agent) && Buffer.isBuffer(review));
		assert.ok(Buffer.compare(agent, review) === 0, "the two git-guard.ts copies differ");
	});
});
