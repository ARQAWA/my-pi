/**
 * Case-insensitive header merge for Codex requests. Every entry of every source is applied in order, including the first
 * source: a later entry removes every earlier key with the same lower-case name, whatever its casing, and then sets its
 * own spelling. So the final record holds at most one spelling per header name, and the last source's spelling wins.
 * Values are never lowercased or joined; this is not a WHATWG Headers merge, which would concatenate before replacing.
 */
export function mergeHeaders(...sources: (Record<string, string> | undefined)[]): Record<string, string> {
	const merged: Record<string, string> = {};
	for (const source of sources) {
		if (!source) continue;
		for (const name of Object.keys(source)) {
			const value = source[name]!;
			const lower = name.toLowerCase();
			for (const existing of Object.keys(merged)) {
				if (existing.toLowerCase() === lower) delete merged[existing];
			}
			// defineProperty, not assignment: a name such as __proto__ stays an own data property and never sets the prototype.
			Object.defineProperty(merged, name, { value, writable: true, enumerable: true, configurable: true });
		}
	}
	return merged;
}
