import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "node:test";

it("every package extension has a synthetic test file", () => {
	const root = fileURLToPath(new URL("..", import.meta.url));
	const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
	const aliases: Record<string, string> = { session: "session-commands" };
	const missing: string[] = [];

	for (const extension of manifest.pi.extensions as string[]) {
		const name = basename(dirname(extension)).replace(/^RQW-/, "").toLowerCase();
		const file = `test/synthetic-${aliases[name] ?? name}.test.ts`;
		if (!existsSync(join(root, file))) missing.push(`${extension}: ${file}`);
	}

	assert.deepEqual(missing, [], `Missing synthetic tests:\n${missing.join("\n")}`);
});
