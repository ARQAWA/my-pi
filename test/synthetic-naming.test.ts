import assert from "node:assert/strict";
import { after, it } from "node:test";
import { fail, reportTimings, text, world } from "./synthetic/world.ts";

after(() => reportTimings(import.meta.filename));

type World = Awaited<ReturnType<typeof world>>;
type Request = World["requests"][number];

const isNaming = (request: Request) => request.context.systemPrompt?.startsWith("You name chat sessions.") === true;
const namingRequests = (w: World) => w.requests.filter(isNaming);

it("the first input names the session and the name shows in the top border", async (t) => {
	const w = await world(t);
	w.model.when(isNaming, text('["Fix login bug", "Login work"]'));
	w.model.script(text("looking at it"));
	await w.submit("the login page breaks");

	await w.until(() => w.session.sessionName === "Fix login bug", "the name is written");
	w.see("Fix login bug");
	assert.equal(namingRequests(w).length, 1);
	// The naming model is chosen by the session's provider: Anthropic sessions use Haiku, at low effort.
	assert.equal(namingRequests(w)[0].model.id, "claude-haiku-5-5");
});

it("shows naming while the first request runs and clears it after success", async (t) => {
	const w = await world(t);
	const held = w.model.hold(isNaming);
	w.model.script(text("ok"));
	await w.submit("hello");
	await w.until(() => held.arrived, "naming request");
	w.see("naming");
	await w.submit("/statusbar off");
	await w.submit("/statusbar on");
	w.see("naming");
	held.reply(text('["New name"]'));
	await w.until(() => w.session.sessionName === "New name", "name written");
	await w.until(() => !w.screen().join("\n").includes("naming"), "indicator cleared");
});

it("shows naming after a successful compaction", async (t) => {
	const w = await world(t, { settings: { compaction: { enabled: true, keepRecentTokens: 1 } } });
	w.model.script(text("first answer"), text("second answer"));
	await w.submit("first message");
	await w.until(() => w.session.sessionName === "Greeting", "initial name");
	await w.submit("second message");
	const held = w.model.hold(isNaming);
	w.model.when(request => request.context.systemPrompt?.includes("context summarization assistant") === true, text("summary"));
	await w.session.compact();
	await w.until(() => held.arrived, "post-compaction naming request");
	w.see("naming");
	held.reply(text('["Compacted name"]'));
	await w.until(() => w.session.sessionName === "Compacted name", "name written");
	await w.until(() => !w.screen().join("\n").includes("naming"), "indicator cleared");
});

it("clears naming when a manual name cancels the request", async (t) => {
	const w = await world(t);
	const held = w.model.hold(isNaming);
	w.model.script(text("ok"));
	await w.submit("hello");
	await w.until(() => held.arrived, "naming request");
	w.see("naming");
	await w.submit("/name Manual title");
	await w.until(() => !w.screen().join("\n").includes("naming"), "indicator cleared");
	assert.equal(w.session.sessionName, "Manual title");
});

it("shows rename generation until all retries fail", async (t) => {
	const w = await world(t);
	w.model.script(text("ok"));
	await w.submit("hello");
	await w.until(() => w.session.sessionName === "Greeting", "initial name");
	const held = w.model.hold(isNaming);
	w.model.when(isNaming, fail("failed"), fail("failed"), fail("failed"));
	await w.submit("/rename-gen");
	await w.until(() => held.arrived, "rename request");
	w.see("naming");
	held.reply(fail("failed"));
	await w.until(() => w.screen().join("\n").includes("Automatic session naming failed"), "warning");
	assert.ok(!w.screen().some(line => line.includes("naming") && !line.includes("Automatic session naming failed")));
	assert.equal(w.session.sessionName, "Greeting");
});

it("a name with too many words is skipped and the next valid candidate wins", async (t) => {
	const w = await world(t);
	w.model.when(isNaming, text('["one two three four five", "Short name"]'));
	w.model.script(text("ok"));
	await w.submit("hello");

	await w.until(() => w.session.sessionName === "Short name", "the valid name is written");
	assert.equal(namingRequests(w).length, 1);
});

it("only overlong names: four attempts, a warning, and the old name stays", async (t) => {
	const w = await world(t);
	const tooLong = text('["this name has far too many words in it"]');
	w.model.when(isNaming, tooLong, tooLong, tooLong, tooLong);
	w.model.script(text("ok"));
	await w.submit("/name Old title");
	assert.equal(w.session.sessionName, "Old title");
	await w.submit("hello");

	await w.until(() => w.screen().join("\n").includes("Automatic session naming failed"), "the warning shows");
	assert.equal(namingRequests(w).length, 4, "the first attempt and three retries");
	assert.equal(w.session.sessionName, "Old title");
	w.see("Old title");
});
