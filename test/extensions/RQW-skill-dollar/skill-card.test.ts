import assert from "node:assert/strict";
import { it } from "node:test";
import {
	initTheme,
	SkillInvocationMessageComponent,
	UserMessageComponent,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import {
	Container,
	getKeybindings,
	KeybindingsManager,
	setKeybindings,
	Spacer,
	stripTerminalSequences,
	TUI_KEYBINDINGS,
} from "@earendil-works/pi-tui";
import skillDollar from "../../../extensions/RQW-skill-dollar/index.ts";

const block = (name: string) => `<skill name="${name}" location="/s/${name}/SKILL.md">\nReferences are relative to /s/${name}.\n${name} body\n</skill>`;
const plain = (lines: string[]) => lines.map(line => stripTerminalSequences(line).trimEnd());

// Builds the chat the way Pi's interactive mode does for a user message with skills.
function chat(first: string, userMessage?: string, spacer: any = new Spacer(1)) {
	const container = new Container();
	const skill = new SkillInvocationMessageComponent({ name: first, location: "x", content: `${first} body`, userMessage });
	container.addChild(new Spacer(1));
	container.addChild(skill);
	if (userMessage) {
		container.addChild(spacer);
		container.addChild(new UserMessageComponent(userMessage));
	}
	return { container, skill };
}

// Loads the extension; `start` is the session_start Pi sends after it has rebuilt the history.
function load(theme?: unknown) {
	const handlers = new Map<string, (event: any, ctx: any) => void>();
	skillDollar({ on: (name: string, handler: any) => handlers.set(name, handler), getCommands: () => [] } as unknown as ExtensionAPI);
	return {
		start: () => handlers.get("session_start")!(undefined, { mode: "tui", ui: { theme, setWidget() {}, addAutocompleteProvider() {} } }),
		stop: () => handlers.get("session_shutdown")!(undefined, undefined),
	};
}

const click = (container: Container, y: number, height: number) =>
	(container as any).handleMouse({ type: "click", button: "left", x: 2, y, screenX: 2, screenY: y, width: 60, height });

it("shows every skill as one footer line of the user card, with no separate block or raw XML", t => {
	initTheme();
	const keybindings = getKeybindings();
	setKeybindings(new KeybindingsManager({ ...TUI_KEYBINDINGS, "app.tools.expand": { defaultKeys: "ctrl+o", description: "expand" } } as any));
	t.after(() => setKeybindings(keybindings));
	// Each background token gets its own marker; the skills rows must use the user card's token, not the blue block's.
	const cardBg = "\x1b[48;5;1m";
	const theme = { fg: (_color: string, text: string) => text, bg: (color: string, text: string) => `${color === "userMessageBg" ? cardBg : "\x1b[48;5;2m"}${text}\x1b[49m` };

	const stock = plain(chat("keep", `${block("b")}\n\nText`).container.render(60));
	const loaded = load(theme);
	t.after(loaded.stop);
	// Pi rebuilds the history before session_start: that card must be linked too.
	const early = chat("keep", `${block("b")}\n\nText`);
	loaded.start();
	assert.match(plain(early.container.render(60)).at(-2)!, /└ skill {2}keep · b/);

	const message = `${block("blindreview")}\n\n${block("third")}\n\nCheck my work`;
	const { container, skill } = chat("highreview", message);
	const rendered = container.render(60);
	const lines = plain(rendered);
	assert.equal(lines.some(line => line.includes("[skill]") || line.includes("<skill") || line.includes("body")), false);
	assert.equal(lines.filter(line => line.includes("└ skill")).length, 1);
	assert.match(lines.at(-2)!, /└ skill {2}highreview · blindreview · third +ctrl\+o$/);
	// Gap row, card padding, text, skills row and bottom padding use the card colour.
	assert.equal(lines.length, 5);
	assert.match(lines[2], /Check my work/);
	assert.ok(rendered.slice(3).every(line => line.includes(cardBg)));

	// Ctrl+O shows the text of every skill under the user card, not a separate block.
	skill.setExpanded(true);
	const openRows = container.render(60);
	const open = plain(openRows);
	assert.equal(open.some(line => line.includes("[skill]") || line.includes("<skill")), false);
	for (const name of ["highreview", "blindreview", "third"]) assert.ok(open.some(line => line.includes(`${name} body`)), name);
	assert.ok(open.findIndex(line => line.includes("Check my work")) < open.findIndex(line => line.includes("highreview body")));
	assert.ok(openRows.slice(3).every(line => line.includes(cardBg)));
	skill.setExpanded(false);
	assert.equal(plain(container.render(60)).length, 5);

	// No click target: only Ctrl+O shows the skill text.
	assert.equal(click(container, 3, 4), undefined);
	const afterClick = plain(container.render(60));
	assert.equal(afterClick.some(line => line.includes("highreview body")), false);
	assert.match(afterClick.at(-2)!, /└ skill {2}highreview/);

	// A narrow card wraps the skills onto more rows and keeps every name.
	const narrow = plain(container.render(40)).join(" ");
	for (const name of ["highreview", "blindreview", "third"]) assert.ok(narrow.includes(name), name);
	assert.ok(plain(container.render(40)).length > lines.length);

	// A name wider than the card is split across rows, not cut.
	const long = "a".repeat(30);
	const split = plain(chat(long, `${block("b")}\n\nText`).container.render(24));
	assert.ok(split.join("").replace(/ctrl\+o|\s/g, "").includes(long));

	// Very narrow: the prefix goes, names still wrap whole.
	assert.ok(plain(chat("abcdefghij", `${block("b")}\n\nText`).container.render(8)).join("").replace(/\s/g, "").includes("abcdefghij"));

	// Only the skill blocks at the start leave the text; a later skill-shaped block stays text.
	const later = plain(chat("one", `${block("two")}\n\nSee:\n${block("quoted")}`).container.render(60)).join("\n");
	assert.match(later, /└ skill {2}one · two +ctrl\+o$/m);
	assert.match(later, /<skill name="quoted"/);

	// A skill with no user text becomes the same compact line, with no blue block and no click target.
	const lone = chat("solo");
	const alone = plain(lone.container.render(60));
	assert.equal(alone.some(line => line.includes("[skill]")), false);
	assert.match(alone.at(-2)!, /└ skill {2}solo +ctrl\+o$/);
	assert.equal(click(lone.container, 2, 3), undefined);
	const aloneAfter = plain(lone.container.render(60));
	assert.equal(aloneAfter.some(line => line.includes("solo body")), false);
	assert.match(aloneAfter.at(-2)!, /└ skill {2}solo/);

	// Switching the card off gives every component its stock output back.
	loaded.stop();
	assert.deepEqual(plain(early.container.render(60)), stock);
});

it("pads attached skills below while leaving plain cards unchanged", t => {
	initTheme();
	const plainCard = new UserMessageComponent("Hello");
	const stock = plainCard.render(60);
	const loaded = load({ fg: (_color: string, text: string) => text, bg: (_color: string, text: string) => text });
	t.after(loaded.stop);
	loaded.start();
	assert.deepEqual(plainCard.render(60), stock);
	const rows = plain(chat("review", "Hello").container.render(60));
	assert.equal(rows.at(-1), "");
	assert.ok(rows.at(-2)?.includes("review"));
});

it("leaves stock rendering when Pi's classes do not match", t => {
	initTheme();
	const message = `${block("b")}\n\nText`;
	const stock = plain(chat("keep", message).container.render(60));
	assert.ok(stock.some(line => line.includes("[skill]")));

	// A class without the expected method: nothing is patched.
	const proto = UserMessageComponent.prototype as any;
	proto.invalidate = undefined;
	const missing = load();
	missing.start();
	assert.deepEqual(plain(chat("keep", message).container.render(60)), stock);
	delete proto.invalidate;
	missing.stop();

	// A spacer without the expected API: the pair is not linked, nothing is changed.
	const fit = load();
	t.after(fit.stop);
	fit.start();
	const odd = { render: () => [""], invalidate() {} };
	assert.deepEqual(plain(chat("keep", message, odd).container.render(60)), stock);
});
