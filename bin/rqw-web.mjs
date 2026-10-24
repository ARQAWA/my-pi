#!/usr/bin/env node
// Entry of the rqw-web CLI. Resolves its own location, so it works from any cwd and through a symlink.
// Node refuses to run TypeScript inside node_modules, so jiti (the loader Pi itself uses) loads the source.
try {
	import.meta.resolve("jiti");
} catch (error) {
	if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
	process.stderr.write("rqw-web: Local development dependencies are missing. Run npm ci in the repository checkout, then retry.\n");
	process.exit(1);
}
const { createJiti } = await import("jiti");

const { main } = await createJiti(import.meta.url).import("../cli/web/main.ts");
const code = await main(process.argv.slice(2));
// Flush stdout, then exit: a stuck engine handle must not keep the process alive after the report.
process.stdout.write("", () => process.exit(code));
