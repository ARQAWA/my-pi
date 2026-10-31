/** Items handled before control goes back to the event loop. */
export const SLICE = 16;

/** Visit items in slices; the generator yields after each slice, and a visitor returning false stops early. */
export function* slices<T>(items: readonly T[], visit: (item: T, index: number) => boolean | void): Generator<void> {
	for (let i = 0; i < items.length; i++) {
		if (visit(items[i]!, i) === false) return;
		if ((i + 1) % SLICE === 0) yield;
	}
}
