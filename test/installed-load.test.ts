// Check our runtime import graph against the installed package manifest, then start every real factory in the fenced world.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { builtinModules } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "node:test";
import { parseSync } from "oxc-parser";
import { world } from "./synthetic/world.ts";

type Manifest = { dependencies?: Record<string, string>; peerDependencies?: Record<string, string>; pi: { extensions: string[] } };
const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as Manifest;
const builtins = new Set(builtinModules.flatMap(name => [name, `node:${name}`]));

/** Follow our code, not dependencies: only runtime imports must be supplied by the installed package or Pi. */
function checkImports(base: string, input: Manifest): void {
	const seen = new Set<string>();
	const allowed = new Set([...Object.keys(input.dependencies ?? {}), ...Object.keys(input.peerDependencies ?? {})]);
	// Pi provides these aliases to extensions even though they are not package dependencies.
	for (const scope of ["@earendil-works", "@mariozechner"]) {
		for (const name of ["pi-ai", "pi-agent-core", "pi-coding-agent", "pi-tui"]) allowed.add(`${scope}/${name}`);
	}
	allowed.add("@sinclair/typebox");
	const visit = (file: string) => {
		if (seen.has(file)) return;
		seen.add(file);
		const source = parseSync(file, readFileSync(file, "utf8"), { astType: "js" });
		assert.deepEqual(source.errors, [], `parse ${file}`);
		const check = (specifier: string) => {
			if (specifier.startsWith(".")) { visit(resolve(dirname(file), specifier)); return; }
			if (builtins.has(specifier)) return;
			const name = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
			assert.ok(allowed.has(name), `${file}: undeclared runtime dependency ${name}`);
		};
		const walk = (node: any): void => {
			if (!node || typeof node !== "object") return;
			if (node.type === "ImportExpression") {
				assert.equal(typeof node.source?.value, "string", `${file}: dynamic import must use a literal specifier`);
				check(node.source.value);
			} else if ((node.type === "ImportDeclaration" || node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration") && typeof node.source?.value === "string") check(node.source.value);
			if (node.type === "CallExpression" && node.callee?.type === "Identifier" && node.callee.name === "require") {
				assert.equal(typeof node.arguments?.[0]?.value, "string", `${file}: require must use a literal specifier`);
				check(node.arguments[0].value);
			}
			for (const value of Object.values(node)) {
				if (Array.isArray(value)) value.forEach(walk);
				else if (value && typeof value === "object") walk(value);
			}
		};
		walk(source.program);
	};
	for (const entry of input.pi.extensions) visit(resolve(base, entry));
}

it("checks every production import and loads every extension without a child process", async (t) => {
	checkImports(root, manifest);
	const w = await world(t);
	assert.deepEqual(w.errors, []);
	assert.equal(w.loadedExtensions.length, manifest.pi.extensions.length);
	assert.deepEqual(w.processAttempts, []);
	assert.deepEqual(w.networkAttempts, []);
});

it("rejects an undeclared runtime dependency and accepts it when declared", () => {
	const fixture = mkdtempSync(resolve(tmpdir(), "rqw-imports-"));
	try {
		writeFileSync(resolve(fixture, "index.ts"), 'import "./nested.ts";');
		writeFileSync(resolve(fixture, "nested.ts"), 'import "fake-runtime/deep";');
		const input: Manifest = { pi: { extensions: ["./index.ts"] } };
		assert.throws(() => checkImports(fixture, input), /undeclared runtime dependency fake-runtime/);
		assert.doesNotThrow(() => checkImports(fixture, { ...input, dependencies: { "fake-runtime": "1" } }));
		writeFileSync(resolve(fixture, "nested.ts"), 'const name = "fake-runtime"; import(name);');
		assert.throws(() => checkImports(fixture, input), /dynamic import must use a literal/);
		writeFileSync(resolve(fixture, "nested.ts"), 'import("@earendil-works/pi-coding-agent");');
		assert.doesNotThrow(() => checkImports(fixture, input));
	} finally {
		rmSync(fixture, { recursive: true, force: true });
	}
});
