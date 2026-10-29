import { createHash } from "node:crypto";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

/** readChat(target, options): target supplies open branch and generation, or a closed chat's ID and open hint. */

export type HistoryItem = Record<string, unknown>;
export interface HistoryTurn {
  id: string;
  status: "completed" | "inProgress" | "failed";
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  items: HistoryItem[];
}

/** Project the full active branch, including entries before compaction. */
export function projectTurns(entries: readonly SessionEntry[], inProgress: boolean): HistoryTurn[] {
  const edits = new Map(entries.filter((entry) => entry.type === "context_edit").map((entry) => [entry.targetId, entry.replacement]));
  const position = new Map(entries.map((entry, index) => [entry.id, index]));
  const turns: HistoryTurn[] = [];
  let current: HistoryTurn | undefined;
  for (const [index, entry] of entries.entries()) {
    if (entry.type === "context_edit") continue;
    const edit = edits.get(entry.id);
    let item: HistoryItem = { ...entry };
    if (edit) {
      if (entry.type === "message") item = { ...entry, message: { ...entry.message, content: edit.content } };
      else if (entry.type === "custom_message") item = { ...entry, content: edit.content };
    }
    const startsTurn = (entry.type === "message" && entry.message.role === "user") ||
      (entry.type === "custom_message" && entry.customType === "rqw-tabs-link");
    if (startsTurn) {
      current = { id: entry.id, status: "completed", error: null, startedAt: entry.timestamp || null, completedAt: null, durationMs: null, items: [] };
      turns.push(current);
    }
    if (edit === null && startsTurn) item = { id: entry.id, type: entry.type, parentId: entry.parentId, timestamp: entry.timestamp, deleted: true };
    // A summary written before a later edit of an entry it covered may still carry the edited content.
    if (entry.type === "compaction" && entries.some((later, i) => i > index && later.type === "context_edit" && (position.get(later.targetId) ?? Infinity) <= index)) {
      item = { ...entry, summary: "[summary hidden: covered content was edited later]" };
    }
    if (!current || (edit === null && !startsTurn)) continue;
    current.items.push(item);
    if (entry.type === "message" && entry.message.role === "assistant" && (entry.message.stopReason === "error" || entry.message.stopReason === "aborted")) {
      current.status = "failed";
      current.error = entry.message.errorMessage ?? entry.message.stopReason;
    }
  }
  if (inProgress && current) current.status = "inProgress";
  return turns;
}

export type ReadTarget =
  | { status: "open"; chat: { id: string; title: string | null; cwd: string; status: "open" }; generation: string; entries: readonly SessionEntry[]; inProgress: boolean }
  | { status: "closed"; chatId: string; openHint: string };
export interface ReadOptions {
  cursor?: string;
  turnLimit?: number;
  includeOutputs?: boolean;
  maxOutputCharsPerItem?: number;
}

function prefixHash(entries: readonly SessionEntry[], index: number): string {
  return createHash("sha256").update(JSON.stringify(entries.slice(0, index + 1).map((entry) => entry.id))).digest("hex");
}

function safeContent(value: unknown, limit: number, visible: boolean, state = { remaining: limit, original: 0 }): unknown {
  if (typeof value === "string") {
    const chars = [...value];
    state.original += chars.length;
    const text = visible ? chars.slice(0, state.remaining).join("") : "";
    state.remaining = Math.max(0, state.remaining - chars.length);
    return text;
  }
  if (Array.isArray(value)) return value.map((part) => safeContent(part, limit, visible, state));
  if (!value || typeof value !== "object") return value;
  const obj = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, part] of Object.entries(obj)) {
    if (key === "data" && (obj.type === "image" || obj.type === "audio")) continue;
    if ((key === "text" || key === "thinking") && typeof part === "string") result[key] = safeContent(part, limit, visible, state);
    else result[key] = part;
  }
  return result;
}

const DETAILS_TRUNCATED = "...[details truncated]";

function displayItem(item: HistoryItem, includeOutputs: boolean, outputLimit: number): HistoryItem {
  const result = structuredClone(item);
  const outputs = { remaining: outputLimit, original: 0 };
  const text = { remaining: 2000, original: 0 };
  if (result.type === "message" && result.message && typeof result.message === "object") {
    const message = result.message as Record<string, unknown>;
    if (message.role === "toolResult") {
      message.content = safeContent(message.content, outputLimit, includeOutputs, outputs);
      if (!includeOutputs) delete message.details;
      else if (message.details !== undefined) {
        // Keep the stored structured value when its JSON fits the remaining item budget. Only an
        // over-limit value becomes cut text with an explicit truncation marker (item.truncated is set below too).
        const json = JSON.stringify(message.details) ?? "";
        const length = [...json].length;
        if (length <= outputs.remaining) {
          outputs.original += length;
          outputs.remaining -= length;
        } else message.details = `${safeContent(json, outputLimit, true, outputs)}${outputLimit === 0 ? "" : DETAILS_TRUNCATED}`;
      }
    } else if (message.role === "user") message.content = safeContent(message.content, 2000, true, text);
    else if (Array.isArray(message.content)) message.content = message.content.map((part: unknown) => {
      if (!part || typeof part !== "object") return part;
      const type = (part as Record<string, unknown>).type;
      return type === "thinking" ? safeContent(part, outputLimit, includeOutputs, outputs) : part;
    });
  } else if (result.type === "custom_message") result.content = safeContent(result.content, 2000, true, text);
  if ((includeOutputs && outputs.original > outputLimit) || text.original > 2000) {
    result.truncated = true;
    result.originalChars = outputs.original > outputLimit && includeOutputs ? outputs.original : text.original;
  }
  return result;
}

export function readChat(target: ReadTarget, options: ReadOptions = {}) {
  if (target.status === "closed") return { error: "closed", chatId: target.chatId, openHint: target.openHint, message: "Chat is closed. Ask the user to open it." };
  const limit = Math.min(10, Math.max(1, Math.trunc(options.turnLimit ?? 1)));
  const outputLimit = Math.min(20000, Math.max(0, Math.trunc(options.maxOutputCharsPerItem ?? 2000)));
  const turns = projectTurns(target.entries, target.inProgress);
  let end = turns.length;
  if (options.cursor !== undefined) {
    try {
      const cursor = JSON.parse(Buffer.from(options.cursor, "base64url").toString("utf8"));
      const anchor = target.entries.findIndex((entry) => entry.id === cursor.anchor);
      const boundary = turns.findIndex((turn) => turn.id === cursor.before);
      if (cursor.generation !== target.generation || anchor < 0 || boundary < 0 || prefixHash(target.entries, anchor) !== cursor.hash || target.entries.findIndex((entry) => entry.id === cursor.before) > anchor) throw new Error();
      end = boundary;
    } catch {
      return { error: "cursor_invalid", message: "Invalid cursor." };
    }
  }
  const start = Math.max(0, end - limit);
  const selected = turns.slice(start, end).reverse().map((turn) => ({
    ...turn,
    items: turn.items.slice(-20).map((item) => displayItem(item, options.includeOutputs === true, outputLimit)),
  }));
  const hasMore = start > 0;
  const anchorIndex = target.entries.length - 1;
  const nextCursor = hasMore ? Buffer.from(JSON.stringify({ generation: target.generation, anchor: target.entries[anchorIndex].id, hash: prefixHash(target.entries, anchorIndex), before: turns[start].id })).toString("base64url") : null;
  return { schemaVersion: 1, chat: target.chat, page: { order: "newest_first", limit, hasMore, nextCursor }, turns: selected };
}
