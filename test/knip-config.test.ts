import assert from "node:assert/strict";
import { globSync, readFileSync } from "node:fs";
import test from "node:test";
import config from "../knip.config.mjs";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));

test("knip entries exist and keep production separate from tests", () => {
  const entries = config.workspaces["."].entry;
  for (const extension of manifest.pi.extensions) {
    assert.ok(entries.includes(`${extension}!`), extension);
  }
  for (const [workspace, settings] of Object.entries(config.workspaces)) {
    const cwd = new URL(`${workspace}/`, root);
    for (const entry of settings.entry) {
      const pattern = entry.replace(/!$/, "");
      assert.ok(globSync(pattern, { cwd }).length > 0, `${workspace}: ${entry}`);
      if (pattern.startsWith("test/")) assert.ok(!entry.endsWith("!"), entry);
    }
  }
  assert.ok(config.workspaces["pcli-vscode"].entry.includes("extension.js!"));
  assert.equal(manifest.scripts.knip, "knip --config knip.config.mjs --cache --no-progress --reporter compact --max-show-issues 20");
  assert.ok(!manifest.scripts.check.includes("knip"));
});
