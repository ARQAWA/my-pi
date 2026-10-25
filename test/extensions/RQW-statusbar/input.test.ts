import assert from "node:assert/strict";
import { it } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { type BorderSource, ContextEditor } from "../../../extensions/RQW-statusbar/editor.ts";
import { type ActivityChrome, plain } from "../../../extensions/RQW-statusbar/render.ts";

const id = "019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b";
const width = 80;
const text = "Привет, мир 👋 日本語 café\nsecond line — ünïcödé ✓";

it("input rows are byte-identical across busy, compaction and idle frames at width 80, and the text is unchanged", () => {
	// Fixed clock: the activity callback reads these locals; no timers are involved.
	let frame = 0;
	let chrome: ActivityChrome | undefined;
	const source: BorderSource = {
		context: () => ({ tokens: 13100, limit: 450000 }),
		sessionId: () => id,
		paint: () => plain,
		activity: () => (chrome ? { ...chrome, frame } : undefined),
	};
	const tui = { requestRender() {}, terminal: { rows: 40 } } as never;
	const theme = { borderColor: (value: string) => value, selectList: {} } as never;
	const editor = new ContextEditor(tui, theme, { matches: () => false } as never, () => source);
	editor.setText(text);

	const states: Array<{ name: string; chrome: ActivityChrome | undefined; frame: number }> = [
		{ name: "busy 0", chrome: { text: "Planning next moves", compacting: false, frame: 0 }, frame: 0 },
		{ name: "busy 7", chrome: { text: "Planning next moves", compacting: false, frame: 7 }, frame: 7 },
		{ name: "busy 19", chrome: { text: "Running tools", compacting: false, frame: 19 }, frame: 19 },
		{ name: "compaction 0", chrome: { text: "Compacting context", compacting: true, frame: 0 }, frame: 0 },
		{ name: "compaction 5", chrome: { text: "Compacting context", compacting: true, frame: 5 }, frame: 5 },
		{ name: "compaction 31", chrome: { text: "Compacting context", compacting: true, frame: 31 }, frame: 31 },
		{ name: "idle", chrome: undefined, frame: 0 },
		{ name: "idle again", chrome: undefined, frame: 12 },
	];

	let baseline: string[] | undefined;
	for (const state of states) {
		chrome = state.chrome;
		frame = state.frame;
		const lines = editor.render(width);
		for (const line of lines) {
			assert.ok(!line.includes("\n"), `${state.name}: physical row contains a newline`);
			assert.ok(visibleWidth(line) <= width, `${state.name}: row is ${visibleWidth(line)} cells wide`);
		}
		const body = lines.slice(1, -1);
		assert.ok(body.length > 0, `${state.name}: no input rows`);
		if (baseline === undefined) baseline = body;
		else assert.deepEqual(body, baseline, `${state.name}: input rows differ from the first state`);
	}

	assert.equal(editor.getText(), text, "getText returns the original Unicode text");
});
