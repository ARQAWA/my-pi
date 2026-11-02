import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { mkdirSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { after, it } from "node:test";
import { ICON } from "../extensions/RQW-statusbar/render.ts";
import { call, isTask, reportTimings, text, world } from "./synthetic/world.ts";

after(() => reportTimings(import.meta.filename));

it("shows the model, context meter and session ID in the frame", async (t) => {
	const w = await world(t);
	w.model.script(text("hello"));
	await w.submit("hi");

	const frame = w.screen();
	assert.ok(frame.some((line) => line.includes(w.session.sessionManager.getSessionId())));
	assert.ok(frame.some((line) => line.includes("Opus 5.5 md")), frame.join("\n"));
	assert.ok(frame.some((line) => /[━─]+\s+\d+%\s+[\d.]+[kM]\/[\d.]+[kM]/.test(line)), "context meter shows usage and limit");
	assert.deepEqual(w.networkAttempts, []);
});

it("shows a child's working and idle states on the screen", async (t) => {
	const w = await world(t);
	const child = w.model.hold(isTask("check status"));
	w.model.script(call("agent", { action: "start", task: "check status", title: "Status" }, "a1"), text("started"), text("child finished"));
	await w.submit("go");
	await w.until(() => child.arrived, "child started");
	w.see("agent#1 Status · working");
	child.reply(text("done"));
	await w.until(() => w.screen().some(line => line.includes("agent#1 Status · idle")), "child idle");
	w.see("agent#1 Status · idle");
	assert.deepEqual(w.networkAttempts, []);
});

it("statusbar off restores Pi's stock footer and editor border", async (t) => {
	const w = await world(t);
	const id = w.session.sessionManager.getSessionId();
	w.see(id);
	w.see("cmp 0");

	await w.submit("/statusbar off");
	w.notSee(id);
	w.notSee("cmp 0");
	w.see("(auto)");
	assert.deepEqual(w.networkAttempts, []);
});

it("keeps the branch colour across git refreshes and repaints nothing when a refresh changes nothing", async (t) => {
	const w = await world(t);
	mkdirSync(join(w.dirs.project, ".git"));
	let porcelain = "";
	let gitRuns = 0;
	// The world blocks git; the status bar's own refresh gets a fake repository on branch main.
	t.mock.method(childProcess, "execFile", (_file: string, args: string[], _options: unknown, done: (error: Error | null, stdout: string) => void) => {
		gitRuns++;
		done(null, args.includes("status") ? porcelain : "main\n");
	});
	syncBuiltinESMExports();
	const branchColour = () => new RegExp(`(\\x1b\\[[\\d;]*m)${ICON.branch} main`).exec(w.raw().join("\n"))?.[1];
	// One refresh runs git twice: file counts and branch.
	const refreshed = async (runs: number) => { await w.tick(10_000); await w.until(() => gitRuns >= runs); await w.until(() => true); };

	await refreshed(2);
	await w.until(() => w.screen().join("\n").includes("main"));
	const clean = branchColour();
	assert.ok(clean, "the branch is painted");
	porcelain = " M a.ts\0 M b.ts\0";
	await refreshed(4);
	await w.until(() => w.screen().join("\n").includes("*2"));
	assert.equal(branchColour(), clean, "the dirty state does not recolour the branch");

	// Git polls every 10 s and the quota refreshes every minute; none of them finds anything new.
	const repaints = t.mock.method(w.host.renderer, "requestRender");
	await refreshed(6);
	for (let minute = 0; minute < 3; minute++) await w.tick(60_000);
	await w.until(() => true);
	assert.ok(gitRuns > 6, "the polls ran");
	assert.equal(repaints.mock.callCount(), 0);
	assert.equal(branchColour(), clean);
});
