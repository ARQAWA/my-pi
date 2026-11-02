import fs from "node:fs/promises";

const NAMES = ["bash", "bash.win32", "edit", "find", "grep", "job", "read", "rqw_glob", "rqw_readfile", "rqw_rg", "write"] as const;

export type DescriptionName = (typeof NAMES)[number];
export type Descriptions = Record<DescriptionName, string>;

/** The tool descriptions, read without blocking; the factories get the ready texts. */
export async function loadDescriptions(): Promise<Descriptions> {
	const entries = await Promise.all(NAMES.map(async (name) => {
		const text = await fs.readFile(new URL(`./descriptions/${name}.md`, import.meta.url), "utf-8");
		return [name, text.trimEnd()] as const;
	}));
	return Object.fromEntries(entries) as Descriptions;
}
