import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, afterEach, beforeEach, describe, it } from "node:test";
import { createEventBus, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { AgentSession } from "@earendil-works/pi-coding-agent";
import context from "../../../extensions/RQW-context/index.ts";
import { harness } from "./harness.ts";
import { saveContextHooks } from "./hooks-cleanup.ts";

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, "../../../extensions/RQW-context");
const copies: string[] = [];
const shutdowns: Array<() => void> = [];
let restoreHooks: () => void;
beforeEach(() => { restoreHooks = saveContextHooks(); });
afterEach(() => { restoreHooks(); });
after(() => {
	for (const stop of shutdowns) stop();
	for (const dir of copies) rmSync(dir, { recursive: true, force: true });
});

const REQUESTS = Symbol.for("rqw-test/reload-requests");
const counter = globalThis as { [REQUESTS]?: number };

/** Loads a second module instance of the extension that caps at `cap` and counts request preparations, as a /reload of an updated file. */
async function updatedInstance(cap: number): Promise<typeof context> {
	const dir = mkdtempSync(join(here, ".reload-copy-"));
	copies.push(dir);
	mkdirSync(dir, { recursive: true });
	for (const file of ["index.ts", "background.ts", "large-tail.ts", "hooks.ts", "projection.ts"]) cpSync(join(source, file), join(dir, file));
	const index = join(dir, "index.ts");
	const counting = "function runRequest<T>(agent: NativeAgent, run: () => T): T {";
	const code = readFileSync(index, "utf8");
	assert.ok(code.includes(counting));
	writeFileSync(index, code.replace("MAX_WINDOW = 500_000", `MAX_WINDOW = ${cap}`)
		.replace(counting, `${counting}\n\t(globalThis as { [k: symbol]: number })[Symbol.for("rqw-test/reload-requests")] = ((globalThis as { [k: symbol]: number })[Symbol.for("rqw-test/reload-requests")] ?? 0) + 1;`));
	return (await import(pathToFileURL(index).href)).default;
}

/** What Pi's /reload does to one extension: run its factory again; session_shutdown of that instance comes later. */
function startInstance(factory: typeof context): () => void {
	const handlers = new Map<string, Array<(event: unknown, ctx: unknown) => void>>();
	const pi = { on: (event: string, handler: never) => handlers.set(event, [...(handlers.get(event) ?? []), handler]), events: createEventBus() };
	factory(pi as unknown as ExtensionAPI);
	const stop = () => { for (const handler of handlers.get("session_shutdown") ?? []) handler({ type: "session_shutdown" }, { sessionManager: {} }); };
	shutdowns.push(stop);
	return stop;
}

const bigModel = { provider: "faux", id: "big", api: "test", contextWindow: 1_000_000 };

describe("RQW-context /reload", () => {
	it("applies the reloaded module's patches to a running session, and a later reload replaces them again", async t => {
		const h = await harness();
		// Restore the original hooks and close every owner before another test file runs.
		t.after(async () => {
			startInstance(context);
			delete counter[REQUESTS];
			await h.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" } as never);
			h.session.dispose();
			for (const stop of shutdowns.splice(0)) stop();
		});
		const reserve = () => h.session.settingsManager.getCompactionSettings(bigModel as never).reserveTokens;
		// The running session's own agent state was capped by the first module; it reads the newest module's cap.
		const state = h.session.agent.state as { model: { contextWindow: number } };
		const selected = state.model;
		const window = () => { state.model = bigModel as never; const value = state.model.contextWindow; state.model = selected; return value; };
		assert.equal(reserve(), 550_000);
		assert.equal(window(), 500_000);

		const reloaded = await updatedInstance(400_000);
		const stopOld = startInstance(reloaded);
		assert.equal(reserve(), 640_000);
		assert.equal(window(), 400_000);

		// The session keeps working through every swapped hook: its request wrappers run the newest module's code
		// and a background summary still starts at 75% of W.
		assert.equal(counter[REQUESTS], undefined);
		for (const percent of [0.2, 0.2, 0.2, 0.17]) await h.say(percent);
		assert.ok((counter[REQUESTS] ?? 0) > 0);
		await h.summary(1);
		await h.quiet();
		assert.equal(h.summaries.length, 1);

		// The old instance shutting down releases only its own owner; the newest code stays in effect.
		stopOld();
		assert.equal(reserve(), 640_000);

		startInstance(context);
		assert.equal(reserve(), 550_000);
		assert.equal(window(), 500_000);
	});

	it("leaves hooks of a process started on an older release alone instead of stacking over them", () => {
		const legacy = Symbol.for("rqw-context/_buildRuntime");
		const proto = AgentSession.prototype as unknown as Record<symbol, unknown>;
		const before = Object.getOwnPropertyDescriptor(AgentSession.prototype, "compact");
		proto[legacy] = () => {};
		try {
			const stop = startInstance(context);
			assert.deepEqual(Object.getOwnPropertyDescriptor(AgentSession.prototype, "compact"), before);
			stop();
		} finally {
			delete proto[legacy];
		}
	});
});
