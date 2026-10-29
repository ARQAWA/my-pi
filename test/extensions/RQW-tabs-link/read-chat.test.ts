import { it } from "node:test";
import assert from "node:assert/strict";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { readChat } from "../../../extensions/RQW-tabs-link/history.ts";

const entry = (id: string, message: object) => ({ id, type: "message", parentId: null, timestamp: "2026-01-01T00:00:00Z", message }) as SessionEntry;
const target = { status: "open" as const, chat: { id: "chat", title: null, cwd: "/work", status: "open" as const }, generation: "g", inProgress: false, entries: [
  entry("u1", { role: "user", content: "first" }),
  entry("u2", { role: "user", content: "second" }),
  entry("a", { role: "assistant", content: [{ type: "text", text: "plan" }, { type: "thinking", thinking: "reason" }] }),
  entry("t", { role: "toolResult", content: [{ type: "text", text: "output" }] }),
] };

it("paginates stable turn boundaries and gates output", () => {
  const first = readChat(target);
  assert.ok(first.turns && first.page);
  assert.equal(first.turns[0].id, "u2");
  assert.match(JSON.stringify(first), /plan/);
  assert.doesNotMatch(JSON.stringify(first), /reason|output/);
  assert.ok(first.page.nextCursor);
  const older = readChat({ ...target, entries: [...target.entries, entry("u3", { role: "user", content: "new" })] }, { cursor: first.page.nextCursor });
  assert.ok(older.turns);
  assert.equal(older.turns[0].id, "u1");
  assert.equal(readChat({ ...target, generation: "different" }, { cursor: first.page.nextCursor }).error, "cursor_invalid");
  const full = readChat(target, { includeOutputs: true, maxOutputCharsPerItem: 0, turnLimit: 10 });
  assert.ok(full.turns);
  assert.equal(full.turns.length, 2);
  assert.match(JSON.stringify(full), /originalChars/);
  assert.doesNotMatch(JSON.stringify(full), /reason|output/);
  const visible = readChat(target, { includeOutputs: true });
  assert.match(JSON.stringify(visible), /reason/);
  assert.match(JSON.stringify(visible), /output/);
});

it("returns only the closed chat hint", () => {
  const result = readChat({ status: "closed", chatId: "x", openHint: "/resume" });
  assert.equal(result.error, "closed");
  assert.equal(result.openHint, "/resume");
  assert.ok(!("turns" in result));
});

it("returns only the last twenty items", () => {
  const entries = [entry("u", { role: "user", content: "start" }), ...Array.from({ length: 25 }, (_, i) => entry(`a${i}`, { role: "assistant", content: [{ type: "text", text: `item${i}` }] }))];
  const result = readChat({ ...target, entries });
  assert.ok(result.turns);
  assert.equal(result.turns[0].items.length, 20);
  assert.equal(result.turns[0].items[0].id, "a5");
});

it("does not cut assistant text", () => {
  const text = "x".repeat(2500);
  const entries = [entry("u", { role: "user", content: "start" }), entry("a", { role: "assistant", content: [{ type: "text", text }] })];
  const result = readChat({ ...target, entries });
  assert.ok(result.turns);
  const part = (result.turns[0].items[1].message as { content: { text: string }[] }).content[0];
  assert.equal(part.text.length, 2500);
  assert.ok(!("truncated" in result.turns[0].items[1]));
});

it("limits tool result details like other outputs", () => {
  const entries = [entry("u", { role: "user", content: "start" }), entry("t", { role: "toolResult", content: [{ type: "text", text: "ok" }], details: { big: "y".repeat(500) } })];
  const result = readChat({ ...target, entries }, { includeOutputs: true, maxOutputCharsPerItem: 10 });
  assert.ok(result.turns);
  const item = result.turns[0].items[1];
  const details = (item.message as { details: unknown }).details;
  assert.equal(typeof details, "string");
  assert.match(details as string, /\[details truncated\]$/);
  assert.equal(item.truncated, true);
  assert.ok((item.originalChars as number) > 500);
});

it("keeps structured tool result details within the limit", () => {
  const value = { ok: true, nested: { n: 1 } };
  const entries = [entry("u", { role: "user", content: "start" }), entry("t", { role: "toolResult", content: [{ type: "text", text: "ok" }], details: value })];
  const result = readChat({ ...target, entries }, { includeOutputs: true });
  assert.ok(result.turns);
  const item = result.turns[0].items[1];
  assert.deepEqual((item.message as { details: unknown }).details, value);
  assert.ok(!("truncated" in item));
});

it("limits user text parts in array content to 2000 characters", () => {
  const entries = [entry("u", { role: "user", content: [{ type: "text", text: "u".repeat(2500) }] })];
  const result = readChat({ ...target, entries });
  assert.ok(result.turns);
  const item = result.turns[0].items[0];
  assert.equal((item.message as { content: { text: string }[] }).content[0].text.length, 2000);
  assert.equal(item.truncated, true);
  assert.equal(item.originalChars, 2500);
});
