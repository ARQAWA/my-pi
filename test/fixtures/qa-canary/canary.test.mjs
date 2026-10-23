// QA canary: fails on purpose. Only the manual tests.yml run with qa_canary=true runs it (not matched by the
// npm test globs), to prove that a failure travels through the inbox to a digest.
import assert from "node:assert/strict";
import { test } from "node:test";

test("qa canary fails on purpose", () => {
	assert.equal(1 + 1, 3, "deliberate failure of the QA canary");
});
