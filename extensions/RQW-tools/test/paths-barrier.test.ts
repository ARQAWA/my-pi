// Real filesystem regressions for the path/barrier audit. Gates expose overlap without large writes or sleeps.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AgentToolResult, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { createTools } from "../index.ts";
import { pathKey, scopeOf } from "../keys.ts";
import { createNestedBarrier } from "../nested.ts";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const text = (result: AgentToolResult<unknown>) => result.content.map((c) => c.type === "text" ? c.text : "").join("\n");
const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";

function gate() {
  let release!: () => void;
  const open = new Promise<void>((resolve) => { release = resolve; });
  return { open, release };
}

function harness(dir: string, heldId: string) {
  const nested = createNestedBarrier();
  const hold = gate();
  const started = gate();
  const events: string[] = [];
  const tools = Object.fromEntries(createTools(dir, () => ({}), {
    ...nested,
    schedule(id, scope, run) {
      return nested.schedule(id, scope, async () => {
        events.push(`${id}:start`);
        if (id === heldId) {
          started.release();
          await hold.open;
        }
        try {
          return await run();
        } finally {
          events.push(`${id}:end`);
        }
      });
    },
  }).map((tool) => [tool.name, tool]));
  const ctx = { cwd: dir, sessionManager: { getSessionId: () => "paths-test", getSessionFile: () => undefined } };
  // Stock tools only use cwd and sessionManager; the rest of the SDK context is irrelevant to this test seam.
  const toolContext = ctx as unknown as ExtensionToolContext;
  const run = (name: string, id: string, args: Record<string, unknown>) => tools[name].execute(id, args, undefined, undefined, toolContext);
  return { nested, events, hold, started, run };
}

test("AM/PM U+202F fallback read precedes a write through an existing file alias", { timeout: 10000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "rqw-ampm-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const actual = "Screen 1.30\u202fPM.txt";
  const user = "Screen 1.30 PM.txt";
  await writeFile(join(dir, actual), "OLD\n");
  try {
    await symlink(join(dir, actual), join(dir, "alias.txt"), "file");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes((error as NodeJS.ErrnoException).code ?? "")) {
      return t.skip("cannot create a file symlink here");
    }
    throw error;
  }
  const readScope = scopeOf("read", { path: user }, dir);
  const writeScope = scopeOf("write", { path: "alias.txt", content: "NEW\n" }, dir);
  assert.ok(readScope.keys.includes(writeScope.keys[0]), "fallback spelling must survive canonicalization");
  assert.equal(pathKey(actual, dir), pathKey(user, dir), "stock user-space normalization is unchanged");
  const h = harness(dir, "read");
  const read = h.run("read", "read", { path: user });
  const write = h.run("write", "write", { path: "alias.txt", content: "NEW\n" });
  try {
    await h.started.open;
    await tick();
    assert.deepEqual(h.events, ["read:start"]);
  } finally {
    h.hold.release();
    await Promise.all([read, write]);
  }
  assert.equal(text(await read), "OLD\n");
  assert.equal(await readFile(join(dir, actual), "utf8"), "NEW\n");
});

test("same-batch bash retarget resolves later paths after all, directly and inside codemode", { timeout: 10000 }, async (t) => {
  for (const grouped of [false, true]) {
    const dir = await mkdtemp(join(tmpdir(), "rqw-retarget-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    await mkdir(join(dir, "old"));
    await mkdir(join(dir, "next"));
    await writeFile(join(dir, "old/f.txt"), "OLD TARGET\n");
    await writeFile(join(dir, "next/f.txt"), "BEFORE\n");
    const linkType = process.platform === "win32" ? "junction" : "dir";
    try {
      await symlink(join(dir, "old"), join(dir, "link"), linkType);
    } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes((error as NodeJS.ErrnoException).code ?? "")) {
        return t.skip("cannot create a directory link here");
      }
      throw error;
    }
    assert.notEqual(pathKey("link/f.txt", dir), pathKey("next/f.txt", dir), "old scopes would not conflict");
    const prefix = grouped ? "c0/" : "";
    const h = harness(dir, `${prefix}write`);
    const script = `const fs = require('node:fs'); fs.unlinkSync('link'); fs.symlinkSync(${JSON.stringify(join(dir, "next"))}, 'link', '${linkType}');`;
    const batch = () => Promise.all([
      h.run("bash", `${prefix}bash`, { command: `${quote(process.execPath)} -e ${quote(script)}`, timeout: 5 }),
      h.run("write", `${prefix}write`, { path: "link/f.txt", content: "NEW\n" }),
      h.run("read", `${prefix}read`, { path: "next/f.txt" }),
    ]);
    const done = grouped ? h.nested.group("c0", batch) : batch();
    const outside = grouped ? h.run("read", "later", { path: "next/f.txt" }) : undefined;
    try {
      await h.started.open;
      await tick();
      assert.deepEqual(h.events, [`${prefix}bash:start`, `${prefix}bash:end`, `${prefix}write:start`],
        "read waits for the retargeted write; a group never waits for its own outer all entry");
      assert.equal(pathKey("link/f.txt", dir), pathKey("next/f.txt", dir), "bash actually retargeted the link");
    } finally {
      h.hold.release();
      await Promise.all([done, outside]);
    }
    assert.equal(text((await done)[2]), "NEW\n");
    if (outside) assert.equal(text(await outside), "NEW\n");
    assert.equal(await readFile(join(dir, "next/f.txt"), "utf8"), "NEW\n");
    assert.equal(await readFile(join(dir, "old/f.txt"), "utf8"), "OLD TARGET\n");
  }
});
