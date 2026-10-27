import assert from "node:assert/strict";
import { stripVTControlCharacters as strip } from "node:util";
import { it } from "node:test";
import { type BorderSource, ContextEditor } from "../../../extensions/RQW-statusbar/editor.ts";
import { plain } from "../../../extensions/RQW-statusbar/render.ts";

const id = "019a1b2c-3d4e-7f80-9a1b-2c3d4e5f6a7b";
const source: BorderSource = {
	context: () => ({ tokens: 13100, limit: 450000 }), sessionId: () => id, paint: () => plain,
};

function editor(withSource: boolean, working = false) {
	const result = new ContextEditor({ requestRender() {}, terminal: { rows: 40 } } as never,
		{ borderColor: (text: string) => text, selectList: {} } as never, { matches: () => false } as never,
		() => withSource ? source : undefined);
	result.setText("hello");
	if (working) result.setWorkingStatusIndicator({
		renderInBorder: () => "Working", renderSpinnerInBorder: () => "Working",
	} as never);
	return result;
}

it("renders owned borders without Pi's native working row", () => {
	const rows = editor(true, true).render(48).map(strip);
	assert.equal(rows[0], `──────── ${id} ──`);
	assert.equal(rows.at(-1), "━───────────────────────────────── 3% 13.1k/450k");
	assert.equal(rows.some((row) => row.includes("hello")), true);
	assert.equal(rows.some((row) => row.includes("Working")), false);
});

it("restores Pi's native indicator without a border source", () => {
	assert.match(strip(editor(false, true).render(48)[0]), /Working/);
});
