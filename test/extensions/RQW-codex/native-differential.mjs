// Shared projection of one ordered Responses request sequence for the adapter-vs-native differential.
// The SAME function projects the pinned native oracle captures (scripts/pin-native-differential.mjs) and the requests
// the adapter sends in test/native-differential.test.ts, so both sides go through one normalization.
//
// Server-originated values (response ids, turn-state tokens, output items) are compared literally. Client-originated
// values that cannot be equal by construction (UUIDs, timestamps, prompt text, tool output text) are compared
// relationally: same-turn grouping, exact-body retry identity, and conversation items by type, role and call id.
import { isDeepStrictEqual } from 'node:util';

const TURN_STATE = 'x-codex-turn-state';
const WS_START = 'x-codex-ws-stream-request-start-ms';
// Fields a client adds to a replayed server item (native: ids and internal passthrough metadata; null placeholders).
const REPLAY_ONLY_FIELDS = new Set(['id', 'status', 'internal_chat_message_metadata_passthrough']);

function canonicalItem(item) {
  if (item === null || typeof item !== 'object' || Array.isArray(item)) return item;
  const out = {};
  for (const key of Object.keys(item).sort()) {
    if (REPLAY_ONLY_FIELDS.has(key) || item[key] === null) continue;
    out[key] = item[key];
  }
  return out;
}

/** Output items of every scripted response, in order: [[scriptIndex, itemIndex, canonical item], ...]. */
function serverItems(scripts) {
  const items = [];
  scripts.forEach((events, scriptIndex) => {
    let itemIndex = 0;
    for (const event of events) {
      if (event?.type === 'response.output_item.done' && event.item) {
        items.push([scriptIndex, itemIndex, canonicalItem(event.item)]);
        itemIndex += 1;
      }
    }
  });
  return items;
}

function messageText(item) {
  if (typeof item.content === 'string') return item.content;
  if (!Array.isArray(item.content)) return '';
  return item.content.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('');
}

/**
 * Conversation tail: the input after the client's own context prefix. The prefix ends at the first item that is
 * neither a developer message, an additional_tools item, nor a user message that is not one of the case prompts
 * (native environment context and permissions; the adapter's developer base item).
 */
function conversation(input, prompts, known) {
  const items = Array.isArray(input) ? input : [];
  let start = 0;
  while (start < items.length) {
    const item = items[start];
    const prefix =
      item?.type === 'additional_tools' ||
      (item?.type === 'message' && item.role === 'developer') ||
      (item?.type === 'message' && item.role === 'user' && !prompts.includes(messageText(item)));
    if (!prefix) break;
    start += 1;
  }
  return items.slice(start).map((item) => {
    const canonical = canonicalItem(item);
    const hit = known.find(([, , candidate]) => isDeepStrictEqual(candidate, canonical));
    if (hit) return `server:${hit[0]}.${hit[1]}`;
    if (item?.type === 'message' && item.role === 'user') return `user:${messageText(item)}`;
    if (item?.type === 'function_call_output' || item?.type === 'custom_tool_call_output') return `${item.type}:${item.call_id}`;
    if (item?.type === 'message') return `message:${item.role}`;
    return String(item?.type);
  });
}

function header(headers, name) {
  const hit = headers.find(([key]) => String(key).toLowerCase() === name);
  return hit ? hit[1] : null;
}

function turnMetadata(body) {
  const raw = body?.client_metadata?.['x-codex-turn-metadata'];
  if (typeof raw !== 'string') return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/** Body without the per-send WebSocket start stamp (the only field native restamps on a resend). */
function retryIdentity(body) {
  const clone = structuredClone(body ?? {});
  if (clone.client_metadata) delete clone.client_metadata[WS_START];
  return clone;
}

/**
 * @param {Array<{transport: 'http'|'ws', url: string, headers: Array<[string, string]>, body: object}>} requests ordered
 * @param {{scripts: object[][], prompts: string[]}} context scripted server events (in serve order) and case prompts
 */
export function projectSequence(requests, { scripts, prompts }) {
  const known = serverItems(scripts);
  const turnIds = [];
  const identities = [];
  return requests.map((request, index) => {
    const body = request.body ?? {};
    const meta = turnMetadata(body);
    const turnId = typeof meta.turn_id === 'string' ? meta.turn_id : null;
    let turnGroup = turnIds.indexOf(turnId);
    if (turnId === null || turnGroup === -1) turnGroup = index;
    turnIds.push(turnId);
    const identity = retryIdentity(body);
    const retryOf = identities.findIndex((earlier) => isDeepStrictEqual(earlier, identity));
    identities.push(identity);
    const path = new URL(request.url, 'http://localhost').pathname;
    const turnState = request.transport === 'ws' ? body.client_metadata?.[TURN_STATE] ?? null : header(request.headers, TURN_STATE);
    return {
      transport: request.transport,
      endpoint: path.endsWith('/responses') ? 'responses' : path,
      accept: request.transport === 'http' ? header(request.headers, 'accept') : null,
      turnState,
      type: body.type ?? null,
      generate: body.generate ?? null,
      previousResponseId: body.previous_response_id ?? null,
      requestKind: meta.request_kind ?? null,
      compaction: meta.compaction ?? null,
      turnGroup,
      retryOf: retryOf === -1 ? null : retryOf,
      conversation: conversation(body.input, prompts, known),
    };
  });
}

/** Native sse(events) wire text (core/tests/common/responses.rs `sse`): `event:` line, then `data:` unless type-only. */
export function nativeSseText(events) {
  let out = '';
  for (const event of events) {
    out += `event: ${event.type}\n`;
    if (Object.keys(event).length === 1) out += '\n';
    else out += `data: ${JSON.stringify(event)}\n\n`;
  }
  return out;
}
