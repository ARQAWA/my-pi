import assert from "node:assert/strict";
import { after, it } from "node:test";
import { fail, reportTimings, text, world } from "./synthetic/world.ts";
import { saveContextHooks } from "./extensions/RQW-context/hooks-cleanup.ts";

after(() => reportTimings(import.meta.filename));

type World = Awaited<ReturnType<typeof world>>;
type Request = World["requests"][number];

// Opus declares 1000000 tokens; the rule caps it at W = 500000, R = 50000. The threshold is 450000, the background summary starts at 325000.
// The fake model counts about 0.35 tokens per character; the system prompt and the tools take about 30000 tokens.
const THRESHOLD = 450_000;
const BACKGROUND_FROM = 325_000;
const TURN = 450_000;

/** Pi's summary request: its last message carries the conversation to summarize. */
const isSummary = (request: Request) => {
	const message = request.context.messages.at(-1) as { role: string; content: string | { text?: string }[] };
	const first = typeof message.content === "string" ? message.content : message.content[0]?.text;
	return message.role === "user" && first?.startsWith("<conversation>") === true;
};
const summaries = (w: World) => w.requests.filter(isSummary);
const compactions = (w: World) => w.jsonl().filter((entry) => entry.type === "compaction");
const filler = (characters: number) => "x".repeat(characters);
const tokens = (w: World) => w.session.getContextUsage()?.tokens ?? 0;

/** Two long turns that bring the context above 65% of the window and below the threshold. */
async function fillToBackground(w: World): Promise<void> {
	w.model.script(text("one"), text("two"));
	await w.session.prompt(filler(TURN));
	await w.settle();
	await w.session.prompt(filler(TURN));
	await w.settle();
	assert.ok(tokens(w) >= BACKGROUND_FROM && tokens(w) < THRESHOLD, `the context holds ${tokens(w)} tokens`);
}

const backgroundStatus = (w: World) => w.events.filter((event) => event.channel === "rqw-context:background-compaction").map((event) => (event.data as { active: boolean }).active);

it("from 65% of the window a summary runs in the background and at the threshold it is stored without a second request", async (t) => {
	const restore = saveContextHooks();
	let w: World | undefined;
	t.after(async () => { await w?.dispose(); restore(); });
	w = await world(t);
	w.model.when(isSummary, text("BACKGROUND SUMMARY"));
	await fillToBackground(w);

	await w.until(() => backgroundStatus(w).at(-1) === false, "the background summary ends");
	assert.equal(summaries(w).length, 1);
	assert.deepEqual(compactions(w), [], "nothing is compacted below the threshold");

	w.model.script(text("three"));
	await w.session.prompt(filler(500_000));
	await w.settle();

	const [compaction] = compactions(w);
	assert.ok(compaction, "the session compacted");
	assert.equal(compaction.summary, "BACKGROUND SUMMARY");
	assert.equal(summaries(w).length, 1, "the stored summary was reused, no second request");
});

it("a failed background summary is followed by an ordinary compaction at the threshold", async (t) => {
	const restore = saveContextHooks();
	let w: World | undefined;
	t.after(async () => { await w?.dispose(); restore(); });
	w = await world(t);
	w.model.when(isSummary, fail("summary failed"), text("FOREGROUND SUMMARY"));
	await fillToBackground(w);

	await w.until(() => backgroundStatus(w).at(-1) === false, "the background attempt ends");
	assert.equal(summaries(w).length, 1);
	assert.deepEqual(compactions(w), []);

	w.model.script(text("three"));
	await w.session.prompt(filler(500_000));
	await w.settle();

	const [compaction] = compactions(w);
	assert.ok(compaction, "the session compacted");
	assert.equal(compaction.summary, "FOREGROUND SUMMARY");
	assert.equal(summaries(w).length, 2, "the compaction asked the model again");
});
