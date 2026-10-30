// Joint compatibility test: product extensions remain independent; only this root fixture loads both.
import assert from "node:assert/strict";
import { afterEach, it } from "node:test";
import { installSkillCard } from "../extensions/RQW-skill-dollar/card.ts";
import { assistant, load, makeHost, makeScreen, Session, text, theme, thinking, user } from "./extensions/RQW-tool-ui/fold-host.ts";

const cleanups: (() => void)[] = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function open() {
	const session = new Session();
	cleanups.push(() => session.end());
	session.add(user("first owner", 0), 0);
	session.add(assistant([thinking("work thinking"), text("hidden skill work")], "toolUse", 1_000), 1_000);
	const skills = '<skill name="alpha" location="/skills/alpha.md">\nalpha private body\n</skill>\n\n' +
		'<skill name="beta" location="/skills/beta.md">\nbeta private body\n</skill>\n\nowner mid skill';
	session.add(user(skills, 2_000), 2_000);
	session.add(user('<skill name="gamma" location="/skills/gamma.md">\ngamma private body\n</skill>', 3_000), 3_000);
	session.add(assistant([thinking("answer thinking"), text("skill answer")], "stop", 4_000), 5_000);
	cleanups.push(installSkillCard(() => theme));
	const loaded = load();
	cleanups.push(() => loaded.shutdown());
	const stock = makeHost(session.manager, loaded, { mouseEnabled: true });
	stock.renderInitialMessages();
	const screen = makeScreen(80, 60);
	const host = makeHost(session.manager, loaded, screen.screen);
	host.renderInitialMessages();
	loaded.start(session.manager);
	screen.screen.addChild(host.chatContainer);
	screen.screen.start();
	cleanups.push(() => screen.stop());
	const row = (value: string) => screen.frame().findIndex(line => line.includes(value));
	const click = (x: number, value: string) => {
		const y = row(value);
		assert.ok(y >= 0, value);
		screen.input(`\x1b[<0;${x + 1};${y + 1}M`);
		screen.input(`\x1b[<0;${x + 1};${y + 1}m`);
	};
	return { session, loaded, stock, screen, host, row, click };
}

it("lifts linked skill cards and skill-only cards without duplicating their footers", () => {
	const m = open();
	assert.ok(m.row("first owner") < m.row("owner mid skill"));
	assert.ok(m.row("owner mid skill") < m.row("worked for 5s ›"));
	assert.ok(m.row("gamma") >= 0 && m.row("gamma") < m.row("worked for 5s ›"));
	assert.ok(m.row("hidden skill work") < 0 && m.row("[skill]") < 0);
	assert.equal(m.screen.frame().filter(row => row.includes("└ skill")).length, 2);
	m.click(2, "gamma");
	assert.ok(m.row("worked for 5s ›") >= 0 && m.row("gamma private body") < 0);
	for (const host of [m.stock, m.host]) host.setToolsExpanded(true);
	for (const skill of ["alpha", "beta", "gamma"]) {
		assert.ok(m.row(`${skill} private body`) >= 0 && m.row(`${skill} private body`) < m.row("worked for 5s ›"), skill);
	}
	assert.equal(m.screen.frame().filter(row => row.includes("└ skill")).length, 2);
	for (const host of [m.stock, m.host]) {
		host.hideThinkingBlock = true;
		host.updateThinkingBlockVisibility();
	}
	m.click(79, "worked for 5s ›");
	assert.ok(m.row("hidden skill work") >= 0 && m.row("work thinking") < 0 && m.row("answer thinking") < 0);
	const opened = m.host.chatContainer.render(80).filter(row => !row.includes("worked for"));
	assert.deepEqual(opened, m.stock.chatContainer.render(80));
});

it("rebuilds skill-compatible history closed and restores originals in inline mode", () => {
	const m = open();
	m.click(79, "worked for 5s ›");
	assert.ok(m.row("hidden skill work") >= 0);
	m.host.rebuildChatFromMessages();
	assert.ok(m.row("worked for 5s ›") >= 0 && m.row("hidden skill work") < 0);
	assert.ok(m.row("owner mid skill") < m.row("worked for 5s ›"));
	m.host.renderer = { mouseEnabled: true };
	m.loaded.handlers.get("agent_settled")!();
	assert.deepEqual(m.host.chatContainer.render(80), m.stock.chatContainer.render(80));
	m.host.renderer = m.screen.screen;
	m.host.rebuildChatFromMessages();
	assert.ok(m.row("worked for 5s ›") >= 0 && m.row("hidden skill work") < 0);
	assert.equal(m.screen.frame().filter(row => row.includes("owner mid skill")).length, 1);
	assert.equal(m.screen.frame().filter(row => row.includes("└ skill")).length, 2);
});
