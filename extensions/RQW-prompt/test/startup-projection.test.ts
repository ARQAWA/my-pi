import "./guard.mjs";
import assert from "node:assert/strict";
import { it } from "node:test";
import type { ExtensionAPI, NormalizedBuildSystemPromptOptions } from "@earendil-works/pi-coding-agent";
import { once, start, faux } from "./fixture.ts";
import type { StartupProjectionRequest } from "../index.ts";

const CHANNEL = "rqw-prompt:startup-projection";
const INSTANT = "2026-10-21T22:30:00.000Z";

// Pins Date to one instant so the normal and projected prefixes are computed in the same tick.
async function fixedDate<T>(run: () => Promise<T>): Promise<T> {
	const RealDate = Date;
	globalThis.Date = class extends RealDate { constructor(value?: string | number) { super(value ?? INSTANT); } } as DateConstructor;
	try { return await run(); } finally { globalThis.Date = RealDate; }
}

// A session with RQW-prompt loaded. Its bus carries the projection; `stock` is what Pi's loader hands out before
// RQW-prompt writes customPrompt, rebuilt from the post-prompt clone by clearing that one field.
async function live() {
	let bus: ExtensionAPI["events"] | undefined;
	const normal: { options?: NormalizedBuildSystemPromptOptions } = {};
	const run = await start({
		extraFactory: (pi) => {
			bus = pi.events;
			pi.on("before_agent_start", (event) => { normal.options = structuredClone(event.systemPromptOptions); });
		},
	});
	const got = await run.capture();
	assert.ok(bus && normal.options?.customPrompt);
	const stock = { ...structuredClone(normal.options), customPrompt: undefined } as NormalizedBuildSystemPromptOptions;
	return { run, bus, got, stock, normalPrefix: normal.options.customPrompt };
}

it("startup projection sets the same prefix as normal before_agent_start, same tick, same model", async () => {
	await fixedDate(async () => {
		const sess = await live();
		try {
			const request: StartupProjectionRequest = { options: structuredClone(sess.stock), model: { provider: faux.getModel()!.provider, id: faux.getModel()!.id } };
			sess.bus.emit(CHANNEL, request);
			assert.equal(request.error, undefined);
			assert.equal(request.options.customPrompt, sess.normalPrefix);
			once(sess.got.prompt, sess.normalPrefix);
			assert.deepEqual(request.options.selectedTools, sess.stock.selectedTools);
			assert.deepEqual(request.options.hiddenTools, sess.stock.hiddenTools);
			assert.equal(request.options.forceSystemPrompt, undefined);
		} finally { await sess.run.close(); }
	});
});

it("startup projection without a handler leaves the stock options untouched", async () => {
	let bus: ExtensionAPI["events"] | undefined;
	const run = await start({ enabled: false, extraFactory: (pi) => { bus = pi.events; } });
	try {
		const request: StartupProjectionRequest = { options: { selectedTools: [], hiddenTools: [] } as unknown as NormalizedBuildSystemPromptOptions, model: { provider: "x", id: "y" } };
		bus!.emit(CHANNEL, request);
		assert.equal(request.options.customPrompt, undefined);
		assert.equal(request.error, undefined);
	} finally { await run.close(); }
});

it("startup projection leaves a custom or forced prompt unchanged", async () => {
	const sess = await live();
	try {
		const custom: StartupProjectionRequest = { options: { ...structuredClone(sess.stock), customPrompt: "CALLER_CUSTOM" } };
		sess.bus.emit(CHANNEL, custom);
		assert.equal(custom.options.customPrompt, "CALLER_CUSTOM");
		const forced: StartupProjectionRequest = { options: { ...structuredClone(sess.stock), forceSystemPrompt: "FORCED" } as NormalizedBuildSystemPromptOptions };
		sess.bus.emit(CHANNEL, forced);
		assert.equal(forced.options.customPrompt, undefined);
	} finally { await sess.run.close(); }
});

it("startup projection reports an unsafe failure through request.error and writes nothing", async () => {
	const sess = await live();
	try {
		const broken: StartupProjectionRequest = { options: {} as NormalizedBuildSystemPromptOptions };
		sess.bus.emit(CHANNEL, broken);
		assert.equal(typeof broken.error, "string");
		assert.equal(broken.options.customPrompt, undefined);
		const missing = {} as StartupProjectionRequest;
		sess.bus.emit(CHANNEL, missing);
		assert.equal(typeof missing.error, "string");
	} finally { await sess.run.close(); }
});

it("startup projection never touches the prepared model_select lifecycle of a live session", async () => {
	const sess = await live();
	try {
		assert.match(sess.got.prompt, /Model: prompt-regression-faux\/one/);
		sess.bus.emit(CHANNEL, { options: structuredClone(sess.stock), model: { provider: faux.getModel().provider, id: "two" } });
		await sess.run.session.setModel(faux.getModel("two")!);
		const after = await sess.run.capture();
		assert.match(after.prompt, /Model: prompt-regression-faux\/two/);
		assert.doesNotMatch(after.prompt, /Model: prompt-regression-faux\/one/);
	} finally { await sess.run.close(); }
});

it("startup projection subscription is removed on shutdown", async () => {
	const sess = await live();
	try {
		sess.run.session.dispose();
		const request: StartupProjectionRequest = { options: structuredClone(sess.stock), model: { provider: "x", id: "y" } };
		// Pi's loader refuses emits from a disposed extension context; either that refusal or an untouched request is correct.
		try { sess.bus.emit(CHANNEL, request); } catch (error) { assert.match(String((error as Error).message), /ctx is stale/); }
		assert.equal(request.options.customPrompt, undefined);
		assert.equal(request.error, undefined);
	} finally { await sess.run.close(); }
});
