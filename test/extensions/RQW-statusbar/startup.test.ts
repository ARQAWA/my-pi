import assert from "node:assert/strict";
import { it } from "node:test";
import { startupHost } from "./startup-host.ts";

it("first content frame has our editor and footer, never the stock footer", async t => {
	const fixture = startupHost(t, { slowGit: true });
	const { init } = await fixture.pending();
	assert.equal(fixture.frames().length, 0, "no stock paint while extensions are pending");
	const ui = fixture.host.createExtensionUIContext();
	ui.setWidget("startup-decoration", ["STARTUP WIDGET"]);
	ui.setHeader(() => ({ render: () => ["STARTUP HEADER"], invalidate() {} }));
	fixture.host.renderer.renderNow();
	assert.equal(fixture.frames().length, 0, "noninteractive decorations must not release stock chrome");
	fixture.proceed.resolve();
	await fixture.startCalled.promise;
	assert.equal(fixture.gitPending, true, "Git discovery is still unresolved");
	fixture.host.renderer.renderNow();
	const frames = fixture.frames();
	assert.ok(frames.length > 0);
	assert.ok(frames[0].includes(fixture.session.sessionManager.getSessionId()), "our editor's session border");
	assert.match(frames[0], /cmp 0/, "our footer");
	assert.match(frames[0], /STARTUP WIDGET/);
	assert.match(frames[0], /STARTUP HEADER/);
	fixture.gitLookup.resolve();
	await init;
	assert.ok(fixture.frames().every(frame => !frame.includes("(auto)") && !frame.includes("$0.000")), "stock footer never painted");
});
