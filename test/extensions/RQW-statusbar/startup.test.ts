import assert from "node:assert/strict";
import { it } from "node:test";
import { basename } from "node:path";
import { startupHost } from "./startup-host.ts";

it("paints the early panel while startup notification and work are pending", async t => {
	const fixture = startupHost(t, { slowGit: true, earlyNotice: true });
	const { init } = await fixture.pending();
	fixture.input("typed");
	assert.equal(fixture.host.editor.getText(), "typed");
	fixture.host.renderer.renderNow();
	t.mock.timers.tick(1100);
	fixture.host.renderer.renderNow();
	const frames = fixture.frames();
	assert.ok(frames.length > 0);
	assert.ok(frames[0].includes(fixture.session.sessionManager.getSessionId()));
	assert.match(frames[0], /Test model md/);
	assert.ok(frames[0].includes(basename(fixture.dir)), "first footer has the working folder");
	assert.match(frames.join("\n"), /STARTUP NOTICE/);
	assert.ok(frames.every(frame => !frame.includes("(auto)") && !frame.includes("cmp 0")));
	fixture.proceed.resolve();
	await fixture.startCalled.promise;
	assert.equal(fixture.gitPending, true);
	fixture.gitLookup.resolve();
	await init;
	fixture.host.renderer.renderNow();
	assert.match(fixture.frames().join("\n"), /cmp 0/);
});
