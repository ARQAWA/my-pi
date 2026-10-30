// Runs in its own process: loading every extension patches Pi's global prototypes, which must not leak into other tests.
import { pathToFileURL } from "node:url";

const [loaderPath, cwd, ...entries] = process.argv.slice(2);
const { loadExtensions } = await import(pathToFileURL(loaderPath).href);
const loaded = await loadExtensions(entries, cwd);
process.stdout.write(JSON.stringify({ errors: loaded.errors, count: loaded.extensions.length }));
process.exit(0);
