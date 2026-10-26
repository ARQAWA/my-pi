import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { capModel, contextRule, reserveFor } from "../../../extensions/RQW-context/index.ts";

describe("RQW-context public rules", () => {
	it("caps the window and computes the compaction threshold", () => {
		assert.deepEqual(contextRule(1_000_000), { window: 500_000, reserve: 50_000, threshold: 450_000 });
		assert.deepEqual(contextRule(272_000), { window: 272_000, reserve: 27_200, threshold: 244_800 });
		assert.equal(reserveFor(500_000, 30_000), 30_000);
		assert.equal(reserveFor(1_000_000, 30_000), 530_000);
		assert.equal(reserveFor(1_000_000, 600_000), 550_000);
	});

	it("regression 2e8b38d: capped model round trips keep identity and the declared object", () => {
		const declared = { api: "test", contextWindow: 1_000_000 };
		const capped = capModel(declared);
		assert.equal(capped.contextWindow, 500_000);
		assert.equal(capModel(declared), capped);
		assert.equal(capModel(capped), capped);
		assert.equal(declared.contextWindow, 1_000_000);
		const small = { api: "test", contextWindow: 272_000 };
		const virtual = { api: "pi-virtual", contextWindow: 1_000_000 };
		assert.equal(capModel(small), small);
		assert.equal(capModel(virtual), virtual);
	});
});
