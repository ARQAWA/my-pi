import assert from "node:assert/strict";
import test from "node:test";
import { mergeHeaders } from "../../../extensions/RQW-codex/headers.ts";

test("header overrides replace every casing variant without mutating the source", () => {
	const base = { Authorization: "Bearer old", "x-Mixed-Value": "MiXeD" };
	const merged = mergeHeaders(base, { authorization: "Bearer new" });
	assert.deepEqual(merged, { "x-Mixed-Value": "MiXeD", authorization: "Bearer new" });
	assert.deepEqual(base, { Authorization: "Bearer old", "x-Mixed-Value": "MiXeD" });
});
