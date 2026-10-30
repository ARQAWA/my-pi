import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { it } from "node:test";
import type { ExtensionAPI, ExtensionContext, SlashCommandInfo } from "@earendil-works/pi-coding-agent";
import { SelectList, type AutocompleteProvider, type AutocompleteSuggestions } from "@earendil-works/pi-tui";
import skillDollar from "../../../extensions/RQW-skill-dollar/index.ts";

const names = ["alpha", "review", "release", "repair", "render", "readme", "my_skill", "Upper"];
const fallbackResult: AutocompleteSuggestions = {
	items: [{ value: "fallback", label: "fallback" }],
	prefix: "fallback",
};

async function setup(t: any, skillNames = names, offerFilter?: (skills: any[]) => any[]) {
	const root = mkdtempSync(join(tmpdir(), "rqw-skill-dollar-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const commands: SlashCommandInfo[] = skillNames.map(name => {
		const directory = join(root, name);
		const path = join(directory, "SKILL.md");
		mkdirSync(directory, { recursive: true });
		writeFileSync(path, `---\nname: ${name}\ndescription: ${name} instructions\n---\n${name} body\n`);
		return {
			name: `skill:${name}`,
			description: `${name} instructions`,
			source: "skill",
			sourceInfo: { path, source: "test", scope: "project", origin: "top-level", baseDir: directory },
		};
	});
	const catalog = { available: true };
	const handlers = new Map<string, ((event: any, ctx: any) => unknown)[]>();
	let provider: AutocompleteProvider | undefined;
	const current: AutocompleteProvider = {
		async getSuggestions() { return fallbackResult; },
		applyCompletion(lines, cursorLine, cursorCol) { return { lines, cursorLine, cursorCol }; },
	};
	const editor = {
		maxVisible: 5,
		getAutocompleteMaxVisible() { return this.maxVisible; },
		setAutocompleteMaxVisible(value: number) { this.maxVisible = value; },
	};
	const editorFactory = () => editor;
	const tui = { getFocusedComponent: () => editor };
	const pi = {
		on(name: string, handler: any) { handlers.set(name, [...(handlers.get(name) ?? []), handler]); },
		getCommands() {
			if (!catalog.available) throw new Error("skill catalog unavailable");
			return commands;
		},
		events: { emit(channel: string, request: any) { if (offerFilter && channel === "rqw-skill-dollar:filter") request.offer(offerFilter); } },
	};
	skillDollar(pi as unknown as ExtensionAPI);
	t.after(() => { for (const handler of handlers.get("session_shutdown")!) handler({}, {}); });
	const ctx = {
		mode: "tui",
		ui: {
			addAutocompleteProvider(factory: (base: AutocompleteProvider) => AutocompleteProvider) {
				provider = factory(current);
			},
			getEditorComponent() { return editorFactory; },
			setWidget(_key: string, content: any) {
				if (typeof content === "function") content(tui, {});
			},
		},
	} as unknown as ExtensionContext;
	for (const handler of handlers.get("session_start")!) await handler({}, ctx);
	return {
		provider: provider!, input: handlers.get("input")![0], commands, catalog, root, editor, editorFactory,
		currentEditorFactory: () => ctx.ui.getEditorComponent(),
	};
}

function expanded(commands: SlashCommandInfo[], skillNames: string[], args?: string): string {
	const blocks = skillNames.map(name => {
		const command = commands.find(candidate => candidate.name === `skill:${name}`)!;
		const path = command.sourceInfo.path;
		return `<skill name="${name}" location="${path}">\nReferences are relative to ${dirname(path)}.\n\n${name} body\n</skill>`;
	});
	return [...blocks, ...(args ? [args] : [])].join("\n\n");
}

const options = () => ({ signal: new AbortController().signal });
const identity = (text: string) => text;
const selectTheme = {
	selectedPrefix: identity,
	selectedText: identity,
	description: identity,
	scrollInfo: identity,
	noMatch: identity,
};

it("mid-line dollar completes a skill and submit expands it like Pi", async (t) => {
	const { provider, input, commands } = await setup(t);
	assert.deepEqual(provider.triggerCharacters, ["$"]);

	const opened = await provider.getSuggestions(["please $"], 0, 8, options());
	assert.equal(opened?.items.length, names.length);
	assert.equal(opened?.prefix, "$");

	const lines = ["please $rev now"];
	const suggestions = await provider.getSuggestions(lines, 0, 11, options());
	assert.deepEqual(suggestions?.items.map(item => item.value), ["$review"]);
	const completed = provider.applyCompletion(lines, 0, 11, suggestions!.items[0], suggestions!.prefix);
	assert.deepEqual(completed.lines, ["please $review now"]);

	const submitted = await input({ text: completed.lines[0], source: "interactive" }, {});
	assert.deepEqual(submitted, { action: "transform", text: expanded(commands, ["review"], "please now") });
});

it("passes input without a dollar unchanged even when the skill catalog is unavailable, then uses a fresh catalog", async (t) => {
	const { input, commands, catalog, root } = await setup(t);
	catalog.available = false;
	assert.equal(await input({ text: "plain message", source: "interactive" }, {}), undefined);
	catalog.available = true;
	const directory = join(root, "newskill");
	const path = join(directory, "SKILL.md");
	mkdirSync(directory, { recursive: true });
	writeFileSync(path, "---\nname: newskill\ndescription: newskill instructions\n---\nnewskill body\n");
	commands.push({
		name: "skill:newskill",
		description: "newskill instructions",
		source: "skill",
		sourceInfo: { path, source: "test", scope: "project", origin: "top-level", baseDir: directory },
	});
	const result = await input({ text: "$newskill go", source: "interactive" }, {}) as { action: string; text: string };
	assert.equal(result.action, "transform");
	assert.match(result.text, /<skill name="newskill"[^>]*>[\s\S]*newskill body[\s\S]*<\/skill>/);
	assert.match(result.text, /go$/);
});

it("replaces the whole dollar token when completing inside it", async (t) => {
	const { provider } = await setup(t, ["review"]);
	const completed = provider.applyCompletion(["please $review now"], 0, 11,
		{ value: "$review", label: "$review" }, "$rev");
	assert.deepEqual(completed.lines, ["please $review now"]);
});

it("keeps embedded and unknown dollar tokens outside skill mentions", async (t) => {
	const { provider, input } = await setup(t);
	assert.equal(await provider.getSuggestions(["echo home$"], 0, 10, options()), fallbackResult);
	assert.equal(await input({ text: "echo $HOME", source: "interactive" }, {}), undefined);
	assert.equal(await input({ text: "please $review", source: "rpc" }, {}), undefined);
});

it("accepts loaded nonstandard names and unicode whitespace boundaries", async (t) => {
	const { provider, input, commands } = await setup(t);
	const opened = await provider.getSuggestions(["please\u00a0$"], 0, 8, options());
	assert.equal(opened?.items.length, names.length);
	assert.deepEqual(await input({ text: "$my_skill", source: "interactive" }, {}),
		{ action: "transform", text: expanded(commands, ["my_skill"]) });
	assert.deepEqual(await input({ text: "$Upper", source: "interactive" }, {}),
		{ action: "transform", text: expanded(commands, ["Upper"]) });
});

it("expands every valid mentioned skill on one submit", async (t) => {
	const { input, commands } = await setup(t);
	const submitted = await input({ text: "$review $release report", source: "interactive" }, {});
	assert.deepEqual(submitted, {
		action: "transform",
		text: expanded(commands, ["review", "release"], "report"),
	});
});

it("renders at most four rows including the scroll line", async (t) => {
	const { provider, editor, editorFactory, currentEditorFactory } = await setup(t);
	const opened = await provider.getSuggestions(["$"], 0, 1, options());
	assert.equal(opened?.items.length, names.length);
	assert.equal(editor.maxVisible, 3);
	assert.equal(new SelectList(opened!.items, editor.maxVisible, selectTheme).render(80).length, 4);
	const completed = provider.applyCompletion(["$"], 0, 1, opened!.items.at(-1)!, opened!.prefix);
	assert.deepEqual(completed.lines, ["$Upper "]);
	assert.equal(currentEditorFactory(), editorFactory);

	const four = await setup(t, ["review", "release", "repair", "render"]);
	const suggestions = await four.provider.getSuggestions(["$"], 0, 1, options());
	assert.equal(suggestions?.items.length, 4);
	assert.equal(four.editor.maxVisible, 4);
	assert.equal(new SelectList(suggestions!.items, four.editor.maxVisible, selectTheme).render(80).length, 4);
});

it("restores the previous height for slash and file autocompletes", async (t) => {
	const { provider, editor } = await setup(t);
	editor.maxVisible = 7;
	await provider.getSuggestions(["$"], 0, 1, options());
	assert.equal(editor.maxVisible, 3);
	assert.equal(await provider.getSuggestions(["/"], 0, 1, options()), fallbackResult);
	assert.equal(editor.maxVisible, 7);

	await provider.getSuggestions(["$rev"], 0, 4, options());
	assert.equal(editor.maxVisible, 4);
	assert.equal(await provider.getSuggestions(["@"], 0, 1, options()), fallbackResult);
	assert.equal(editor.maxVisible, 7);
});

it("an offered filter removes a skill from suggestions and from expansion", async (t) => {
	const { provider, input, commands } = await setup(t, ["keep", "drop"], skills => skills.filter(skill => skill.name !== "drop"));
	const all = await provider.getSuggestions(["$"], 0, 1, options());
	assert.deepEqual(all?.items.map(item => item.value), ["$keep"]);
	assert.equal(await input({ text: "use $drop now", source: "interactive" }, {}), undefined);
	assert.deepEqual(await input({ text: "use $keep now", source: "interactive" }, {}), { action: "transform", text: expanded(commands, ["keep"], "use now") });
});

it("same-name skills: $name takes the first, a skill:// link takes its own path, completion offers both", async (t) => {
	const { root, provider, input } = await setup(t, ["keep"], skills => {
		const path = join(root2(skills), "second", "SKILL.md");
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, "---\nname: keep\ndescription: second keep\n---\nsecond body\n");
		return [...skills, { name: "keep", description: "second keep", filePath: path, baseDir: dirname(path) }];
	});
	const second = join(root, "second", "SKILL.md");
	const first = join(root, "keep", "SKILL.md");
	const items = (await provider.getSuggestions(["$ke"], 0, 3, options()))!.items;
	assert.deepEqual(items.map(item => item.value), ["$keep", `[$keep](skill://${second})`]);
	assert.match(items[1].description!, new RegExp(second.replace(/[\\/.]/g, "\\$&")));
	// Applying the second completion writes the link of that very skill into the editor text.
	const link = `[$keep](skill://${second}) `;
	const applied = provider.applyCompletion(["$ke"], 0, 3, items[1], "$ke");
	assert.deepEqual(applied.lines, [link]);
	assert.equal(applied.cursorCol, link.length);
	assert.deepEqual(provider.applyCompletion(["$ke"], 0, 3, items[0], "$ke").lines, ["$keep "]);
	const plain = await input({ text: "use $keep", source: "interactive" }, {}) as { text: string };
	assert.match(plain.text, new RegExp(`location="${first.replace(/[\\/.]/g, "\\$&")}"`));
	assert.doesNotMatch(plain.text, /second body/);
	const linked = await input({ text: `use [$keep](skill://${second}) now`, source: "interactive" }, {}) as { text: string };
	assert.match(linked.text, /second body/);
	assert.doesNotMatch(linked.text, /keep body/);
	assert.match(linked.text, /\n\nuse now$/);
	assert.equal(await input({ text: "use [$keep](skill:///nowhere/SKILL.md)", source: "interactive" }, {}), undefined);
});

// The temp root of `setup` is the directory above a skill folder; the filter only has the skills to learn it from.
const root2 = (skills: { filePath: string }[]) => dirname(dirname(skills[0].filePath));

it("a skill link whose path has parentheses, like Windows Program Files (x86), is recognised on submit", async (t) => {
	const { provider, input } = await setup(t, ["keep"], skills => {
		const path = join(root2(skills), "Program Files (x86)", "second", "SKILL.md");
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, "---\nname: keep\ndescription: second keep\n---\nsecond body\n");
		return [...skills, { name: "keep", description: "second keep", filePath: path, baseDir: dirname(path) }];
	});
	const items = (await provider.getSuggestions(["$ke"], 0, 3, options()))!.items;
	const applied = provider.applyCompletion(["$ke"], 0, 3, items[1], "$ke");
	assert.match(applied.lines[0], /Program Files \(x86\)/);
	const linked = await input({ text: `use ${applied.lines[0]}now`, source: "interactive" }, {}) as { text: string };
	assert.match(linked.text, /second body/);
	assert.doesNotMatch(linked.text, /keep body/);
	assert.match(linked.text, /\n\nuse now$/);
});
