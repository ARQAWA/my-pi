import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { projectTurns, readChat } from "../../../extensions/RQW-tabs-link/history.ts";

const entry = (id: string, value: object) => ({ id, parentId: null, timestamp: "2026-01-01T00:00:00Z", ...value }) as SessionEntry;

describe("turn projection", () => {
  it("returns empty tool output details at zero limit and records truncation", () => {
    const result = readChat({
      status: "open", chat: { id: "chat", title: null, cwd: "/", status: "open" }, generation: "1", inProgress: false,
      entries: [
        entry("u", { type: "message", message: { role: "user", content: "question" } }),
        entry("t", { type: "message", message: { role: "toolResult", content: [{ type: "text", text: "output" }], details: { value: "details" } } }),
      ],
    }, { includeOutputs: true, maxOutputCharsPerItem: 0 });
    assert.ok("turns" in result && result.turns);
    const item = result.turns[0].items[1];
    const message = item.message as { content: { text: string }[]; details: unknown };
    assert.equal(message.content[0].text, "");
    assert.equal(message.details, "");
    assert.equal(item.truncated, true);
    assert.ok(typeof item.originalChars === "number" && item.originalChars > 0);
  });

  it("keeps historical turns across compaction, applies edits, and retains tool cycles in the current turn", () => {
    const turns = projectTurns([
      entry("u1", { type: "message", message: { role: "user", content: "secret" } }),
      entry("a1", { type: "message", message: { role: "assistant", content: [{ type: "text", text: "old" }] } }),
      entry("c", { type: "compaction", summary: "summary", firstKeptEntryId: "u2", tokensBefore: 5 }),
      entry("u2", { type: "message", message: { role: "user", content: "next" } }),
      entry("a2", { type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "t", name: "test", arguments: {} }] } }),
      entry("t", { type: "message", message: { role: "toolResult", content: [{ type: "text", text: "result" }] } }),
      entry("e1", { type: "context_edit", targetId: "u1", replacement: { content: "redacted" } }),
      entry("e2", { type: "context_edit", targetId: "a1", replacement: null }),
    ], true);
    assert.equal(turns.length, 2);
    assert.doesNotMatch(JSON.stringify(turns), /secret|"old"/);
    assert.match(JSON.stringify(turns), /redacted/);
    assert.equal(turns[1].status, "inProgress");
    assert.deepEqual(turns[1].items.map((item) => item.id), ["u2", "a2", "t"]);
  });

  it("keeps the boundary of a deleted user entry without its content", () => {
    const turns = projectTurns([
      entry("u1", { type: "message", message: { role: "user", content: "first" } }),
      entry("u2", { type: "message", message: { role: "user", content: "hidden-user" } }),
      entry("a2", { type: "message", message: { role: "assistant", content: [{ type: "text", text: "reply" }] } }),
      entry("e", { type: "context_edit", targetId: "u2", replacement: null }),
    ], false);
    assert.deepEqual(turns.map((turn) => turn.id), ["u1", "u2"]);
    assert.equal(turns[1].items[0].deleted, true);
    assert.doesNotMatch(JSON.stringify(turns), /hidden-user/);
    assert.deepEqual(turns[1].items.map((item) => item.id), ["u2", "a2"]);
  });

  it("hides a compaction summary only when a later edit targets covered content", () => {
    const base = [
      entry("u1", { type: "message", message: { role: "user", content: "q" } }),
      entry("c", { type: "compaction", summary: "leaks-secret", firstKeptEntryId: "u1", tokensBefore: 5 }),
    ];
    assert.match(JSON.stringify(projectTurns(base, false)), /leaks-secret/);
    const edited = projectTurns([...base, entry("e", { type: "context_edit", targetId: "u1", replacement: null })], false);
    assert.doesNotMatch(JSON.stringify(edited), /leaks-secret/);
    assert.match(JSON.stringify(edited), /summary hidden/);
  });
});
