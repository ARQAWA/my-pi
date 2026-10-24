#!/usr/bin/env node
// Entry of the rqw-web CLI. Resolves its own location, so it works from any cwd and through a symlink.
// Node refuses to run TypeScript inside node_modules, so jiti (the loader Pi itself uses) loads the source.
import { createJiti } from "jiti";

const { main } = await createJiti(import.meta.url).import("../cli/web/main.ts");
const code = await main(process.argv.slice(2));
// Flush stdout, then exit: a stuck engine handle must not keep the process alive after the report.
process.stdout.write("", () => process.exit(code));
