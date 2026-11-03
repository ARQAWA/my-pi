/**
 * The shortest tail after a compaction that really overflows Pi's `push(...tail)`, plus a margin.
 * The limit is V8's argument count for the current stack size, so it shrinks with `--stack-size` and is not a Pi constant.
 */
export function overflowTail(): number {
	const overflows = (count: number) => {
		try {
			new Array<number>().push(...new Array<number>(count));
			return false;
		} catch (error) {
			return error instanceof RangeError;
		}
	};
	let high = 1_000;
	while (!overflows(high)) high *= 2;
	let low = high / 2;
	while (low + 1 < high) {
		const middle = Math.floor((low + high) / 2);
		if (overflows(middle)) high = middle; else low = middle;
	}
	return Math.ceil(high * 1.05);
}
