import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { generate } from "../scripts/repo-index.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function fixture(t: { after: (fn: () => void) => void }) {
  const root = mkdtempSync(join(tmpdir(), "repo-index-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const manifest = {
    pi: {
      extensions: ["./extensions/RQW-context/index.ts", "./extensions/RQW-review/index.ts"],
      themes: ["./extensions/RQW-theme/theme.json"],
    },
  };
  for (const path of [...manifest.pi.extensions, ...manifest.pi.themes]) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), "fixture\n");
  }
  writeFileSync(join(root, "package.json"), JSON.stringify(manifest));
  return { root, manifest };
}

describe("repository index local development tooling", {
  skip: process.platform !== "darwin" && "Local development tooling is supported only on the owner's macOS laptop",
}, () => {

test("repository index and extension maps are fresh", () => {
  const result = spawnSync(process.execPath, [join(ROOT, "scripts/repo-index.mjs"), "--check"], {
    cwd: ROOT, encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Repository maps are current/);
});

test("CLI check fails on stale maps without writing, and write repairs them", t => {
  const { root } = fixture(t);
  mkdirSync(join(root, "scripts"));
  const script = join(root, "scripts/repo-index.mjs");
  writeFileSync(script, readFileSync(join(ROOT, "scripts/repo-index.mjs"), "utf8"));
  generate(root, "--write");
  writeFileSync(join(root, "INDEX.md"), "stale index\n");
  const stale = spawnSync(process.execPath, [script, "--check"], { encoding: "utf8" });
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /Stale repository maps: INDEX.md/);
  assert.equal(readFileSync(join(root, "INDEX.md"), "utf8"), "stale index\n");
  const write = spawnSync(process.execPath, [script, "--write"], { encoding: "utf8" });
  assert.equal(write.status, 0, write.stderr);
  assert.deepEqual(generate(root, "--check"), []);
});

test("missing closing marker fails check and write without changing manual prose", t => {
  const { root } = fixture(t);
  mkdirSync(join(root, "scripts"));
  const script = join(root, "scripts/repo-index.mjs");
  writeFileSync(script, readFileSync(join(ROOT, "scripts/repo-index.mjs"), "utf8"));
  generate(root, "--write");
  const readme = join(root, "extensions/RQW-context/README.md");
  const malformed = "# Manual contract\n\n<!-- repo-index:start -->\nOld map\n\n## Manual suffix\nKeep this prose unchanged.\n";
  writeFileSync(readme, malformed);
  writeFileSync(join(root, "INDEX.md"), "stale index\n");
  for (const mode of ["--check", "--write"]) {
    const result = spawnSync(process.execPath, [script, mode], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /RQW-context\/README.md: generated file map must contain one ordered START\/END marker pair/);
    assert.equal(readFileSync(readme, "utf8"), malformed);
    assert.equal(readFileSync(join(root, "INDEX.md"), "utf8"), "stale index\n");
  }
});

test("duplicate, nested, reversed and orphan markers fail without changing file bytes", t => {
  const { root } = fixture(t);
  mkdirSync(join(root, "scripts"));
  const script = join(root, "scripts/repo-index.mjs");
  writeFileSync(script, readFileSync(join(ROOT, "scripts/repo-index.mjs"), "utf8"));
  generate(root, "--write");
  const readme = join(root, "extensions/RQW-context/README.md");
  const start = "<!-- repo-index:start -->";
  const end = "<!-- repo-index:end -->";
  const malformedMaps = [
    `${start}\r\nManual prose\r\n${start}\r\nActual map\r\n${end}`,
    `${start}\r\nMap\r\n${end}\r\nManual prose\r\n${end}`,
    `${start}\r\nOuter\r\n${start}\r\nInner\r\n${end}\r\n${end}`,
    `${end}\r\nManual prose\r\n${start}`,
    `${end}\r\nManual prose`,
    `${start}\r\nFirst map\r\n${end}\r\nManual prose\r\n${start}\r\nSecond map\r\n${end}`,
  ];
  const index = Buffer.from("stale index\r\n");
  writeFileSync(join(root, "INDEX.md"), index);
  for (const map of malformedMaps) {
    const original = Buffer.from(`# Manual contract\r\n${map}\r\n## Manual suffix\r\nKeep all bytes.\r\n`);
    writeFileSync(readme, original);
    for (const mode of ["--check", "--write"]) {
      const result = spawnSync(process.execPath, [script, mode], { encoding: "utf8" });
      assert.equal(result.status, 1, `${mode}: ${map}`);
      assert.match(result.stderr, /must contain one ordered START\/END marker pair/);
      assert.deepEqual(readFileSync(readme), original);
      assert.deepEqual(readFileSync(join(root, "INDEX.md")), index);
    }
  }
});

test("generation is deterministic and follows manifest load order and native themes", t => {
  const { root, manifest } = fixture(t);
  assert.equal(generate(root, "--write").length, 4);
  assert.deepEqual(generate(root, "--check"), []);
  assert.deepEqual(generate(root, "--write"), []);
  const index = readFileSync(join(root, "INDEX.md"), "utf8");
  assert.ok(index.indexOf("| 1 | [RQW-context]") < index.indexOf("| 2 | [RQW-review]"));
  assert.match(index, /test\/extensions\/RQW-context\//);
  assert.match(index, /native `pi.themes` data, not an extension/);
  assert.doesNotMatch(index, /RQW-theme\/index\.ts/);
  manifest.pi.extensions.reverse();
  writeFileSync(join(root, "package.json"), JSON.stringify(manifest));
  assert.deepEqual(generate(root, "--check"), ["INDEX.md"]);
  generate(root, "--write");
  assert.match(readFileSync(join(root, "INDEX.md"), "utf8"), /\| 1 \| \[RQW-review\]/);
});

test("maps preserve hand-written README text before and after their generated block", t => {
  const { root } = fixture(t);
  const readme = join(root, "extensions/RQW-context/README.md");
  const before = "# My contract\n\nKeep this exact hand-written text.\n";
  writeFileSync(readme, before);
  generate(root, "--write");
  const after = "\n## Limits\nKeep this suffix too.\n";
  writeFileSync(readme, readFileSync(readme, "utf8") + after);
  writeFileSync(join(root, "extensions/RQW-context/policy.ts"), "export const policy = 1;\n");
  assert.deepEqual(generate(root, "--check"), ["./extensions/RQW-context/README.md"]);
  generate(root, "--write");
  const updated = readFileSync(readme, "utf8");
  assert.ok(updated.startsWith(before));
  assert.ok(updated.endsWith(after));
  assert.match(updated, /\[\`policy.ts\`\]\(policy.ts\)/);
  assert.deepEqual(generate(root, "--check"), []);
});

test("freshness detects stale text and nested file additions, renames and removals", t => {
  const { root } = fixture(t);
  generate(root, "--write");
  const readme = join(root, "extensions/RQW-review/README.md");
  writeFileSync(readme, readFileSync(readme, "utf8").replace("Pi extension entrypoint", "Outdated entrypoint"));
  const resources = join(root, "extensions/RQW-review/profiles");
  mkdirSync(resources);
  writeFileSync(join(resources, "spotty.toml"), 'name = "spotty"\n');
  assert.deepEqual(generate(root, "--check"), ["./extensions/RQW-review/README.md"]);
  generate(root, "--write");
  assert.match(readFileSync(readme, "utf8"), /profiles\/spotty.toml/);
  rmSync(join(resources, "spotty.toml"));
  writeFileSync(join(resources, "bossy.toml"), 'name = "bossy"\n');
  assert.deepEqual(generate(root, "--check"), ["./extensions/RQW-review/README.md"]);
  generate(root, "--write");
  assert.match(readFileSync(readme, "utf8"), /profiles\/bossy.toml/);
  assert.doesNotMatch(readFileSync(readme, "utf8"), /profiles\/spotty.toml/);
  rmSync(join(resources, "bossy.toml"));
  assert.deepEqual(generate(root, "--check"), ["./extensions/RQW-review/README.md"]);
  generate(root, "--write");
  assert.doesNotMatch(readFileSync(readme, "utf8"), /profiles\/bossy.toml/);
  assert.deepEqual(generate(root, "--check"), []);
});
});
