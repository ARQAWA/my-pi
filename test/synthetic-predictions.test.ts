import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, it } from "node:test";
import { keys, reportTimings, text, world, type World } from "./synthetic/world.ts";

after(() => reportTimings(import.meta.filename));

// Fixed texts of the design: the endpoint Codex serves its prediction prompt from, the activity channel, the maroon time.
const CONFIG_URL = "https://chatgpt.com/backend-api/wham/predictions/config";
const ACTIVITY = "rqw-predictions:activity";
const SERVED_PROMPT = "SERVED PREDICTION PROMPT";
const SUGGESTION = "run the tests again";
const ABORTED_MS = 2000;
const FAR_FUTURE = 4_102_444_800_000;

const base64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

type Fetched = { url: string; authorization: string | undefined; account: string | undefined };

/**
 * The fake Codex route. The world blocks every network call and gives no routes, so the test answers the one
 * prediction endpoint on the blocked fetch that the extension holds, with the saved login the extension reads.
 */
function codexRoute(w: World): Fetched[] {
	const token = `${base64url({ alg: "none" })}.${base64url({ exp: 4_000_000_000, "https://api.openai.com/auth": { chatgpt_account_id: "acct" } })}.sig`;
	writeFileSync(join(w.dirs.agent, "auth.json"), JSON.stringify({ "openai-codex": { type: "oauth", access: token, refresh: "fake-refresh", expires: FAR_FUTURE, accountId: "acct" } }));
	const fetched: Fetched[] = [];
	(globalThis.fetch as unknown as { mock: { mockImplementation(impl: (url: string, init?: RequestInit) => Promise<Response>): void } }).mock.mockImplementation(async (url, init) => {
		if (url !== CONFIG_URL) {
			w.networkAttempts.push(`fetch ${url}`);
			throw new Error(`synthetic world: unrouted fetch ${url}`);
		}
		const headers = init?.headers as Record<string, string>;
		fetched.push({ url, authorization: headers.Authorization, account: headers["ChatGPT-Account-ID"] });
		return new Response(JSON.stringify({ prompt: SERVED_PROMPT, prompt_version: "v1" }), { status: 200 });
	});
	return fetched;
}

const lastUserText = (context: { messages: readonly any[] }): string => {
	const last = context.messages.findLast((message) => message.role === "user");
	return typeof last?.content === "string" ? last.content : JSON.stringify(last?.content ?? "");
};
const isPrediction = (request: { context: { messages: readonly any[] } }) => lastUserText(request.context).includes(SERVED_PROMPT);

/** A chat with one finished exchange, so Ctrl+E has a history to predict from. */
async function chatWithAnswer(t: Parameters<typeof world>[0]) {
	const w = await world(t);
	const fetched = codexRoute(w);
	w.model.script(text("The tests ran."));
	await w.submit("run the tests");
	w.see("The tests ran.");
	return { w, fetched };
}

const activityStates = (w: World) => w.events.filter((event) => event.channel === ACTIVITY).map((event) => (event.data as { state: string }).state);

it("Ctrl+E shows a gray suggestion from the served prompt, Tab turns it into text, nothing is sent", async (t) => {
	const { w, fetched } = await chatWithAnswer(t);
	w.model.when(isPrediction, text(JSON.stringify({ suggestion: SUGGESTION })));
	w.notSee(SUGGESTION);

	w.press(keys.ctrlE);
	await w.until(() => w.screen().join("\n").includes(SUGGESTION), "the suggestion is shown");

	// The prompt came from the fake route with the saved login, and the model got it as the last user message.
	assert.equal(fetched.length, 1);
	assert.equal(fetched[0].url, CONFIG_URL);
	assert.equal(fetched[0].account, "acct");
	assert.match(fetched[0].authorization ?? "", /^Bearer .+\..+\..+$/);
	const prediction = w.requests.filter(isPrediction);
	assert.equal(prediction.length, 1);
	assert.match(lastUserText(prediction[0].context), /If there is no obvious next user message, set suggestion to null\./);

	// Gray, and only drawn: the input buffer stays empty.
	// The cursor sits on its first letter; the rest is painted in the theme's colour.
	assert.ok(w.raw().some((line) => /\x1b\[38;(?:2;150;145;138|5;102)m\S*un the tests again/.test(line)), "the suggestion is painted in the theme's dim colour");
	assert.equal(w.host.editor.getText(), "");

	w.press(keys.tab);
	await w.until(() => w.host.editor.getText() === SUGGESTION, "Tab inserts the suggestion");
	w.see(SUGGESTION);

	// Nothing reached the chat: no new turn, no user message with the suggestion, no network beyond the route.
	assert.equal(w.requests.filter((request) => !isPrediction(request) && request.background === undefined).length, 1);
	assert.ok(!w.jsonl().some((entry) => JSON.stringify(entry).includes(SUGGESTION)), "the session file has no trace of the suggestion");
	assert.deepEqual(w.networkAttempts, []);
	assert.deepEqual(w.errors, []);
});

it("Ctrl+E while the request runs cancels it: aborted status, no suggestion, the aborted state ends after 2000 ms", async (t) => {
	const { w } = await chatWithAnswer(t);
	const held = w.model.hold(isPrediction);

	w.press(keys.ctrlE);
	await w.until(() => held.arrived, "the prediction request is open");
	assert.deepEqual(activityStates(w), ["brewing"]);

	w.press(keys.ctrlE);
	await w.until(() => activityStates(w).includes("aborted"), "the request is cancelled");
	assert.deepEqual(activityStates(w), ["brewing", "aborted"]);
	assert.equal(held.request?.options?.signal?.aborted, true);

	// The late answer of the cancelled request is ignored.
	held.reply(text(JSON.stringify({ suggestion: SUGGESTION })));
	await w.until(() => true);
	w.notSee(SUGGESTION);

	await w.tick(ABORTED_MS);
	assert.deepEqual(activityStates(w), ["brewing", "aborted", "idle"]);
	w.notSee(SUGGESTION);
	assert.equal(w.host.editor.getText(), "");
	assert.deepEqual(w.networkAttempts, []);
	assert.deepEqual(w.errors, []);
});
