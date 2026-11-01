import type { Frame } from "puppeteer-core";

/** A frame's DevTools identifier, the id CDP download events name it by. */
export function devtoolsFrameId(frame: Frame): string {
	return (frame as unknown as { _id: string })._id;
}
