// Display-only copy of RQW-agent's completion follow-up.
const FOLLOW_UP = "Perform any necessary follow-up actions in response to the subagent completion above. If no follow-up work is needed, no further action is required. Don't repeat the same confirmation every time.";

function cleanBody(text: string): string {
	const suffix = `\n\n${FOLLOW_UP}`;
	return text.endsWith(suffix) ? text.slice(0, -suffix.length) : text;
}

/** Clean delivered results without changing the tool result held by Pi or sent to the model. */
export function displayWaitText(text: string): string {
	try {
		const value = JSON.parse(text);
		if (!value || !Array.isArray(value.results)) return text;
		let changed = false;
		for (const item of value.results) {
			if (item && typeof item.text === "string") {
				const clean = cleanBody(item.text);
				if (clean !== item.text) { item.text = clean; changed = true; }
			}
		}
		return changed ? JSON.stringify(value) : text;
	} catch {
		return text;
	}
}
