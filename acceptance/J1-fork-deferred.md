# J1-fork-deferred. Deferred chat tools in children, and the first request of a fork

## Current result

The earlier Codex attempt below is historical. A later real Codex fork passed: `/Users/arkadijcukavin/ai-project/my-pi-evidence/designs/joint-consensus/acceptance`/`J1-codex-fork-live.md`. Seven copied input items plus exactly one task; the source branch had 12 entries. Raw captures remain in `/Users/arkadijcukavin/ai-project/my-pi-evidence/designs/joint-consensus/acceptance`/`raw/2026-11-04-live-tail/`.

## Historical runs


Build: `/private/tmp/srp-d2`, HEAD `f4d10f3b` (contains `027f0f34`). Pi 1.5.0. Model: `anthropic/claude-opus-5-5` (medium), main and children. CORRECTION: I passed `--model anthropic/claude-sonnet-5-5 --thinking low`, but the harness ignores both for a new session (Opus medium); the wire bodies and the session files show `claude-opus-5-5` in every run below. Nothing else changes.
Setup: `PI_CODING_AGENT_DIR=/private/tmp/j1-fork-live/agent` (copied `auth.json` and `models-store.json`, `auth.json` deleted at the end), cwd `/private/tmp/j1-fork-live/work`,
`pi -e /private/tmp/srp-d2 -e /private/tmp/j1-fork-live/observe.ts --mode json -p '<prompt>'`, WITHOUT `--no-extensions`, so `tool_search` exists. Scripts: `run.py`, `run2.py`, `an.py`, `cmp3.py` in that folder.

## Cell A. Chat tools stay deferred

Task text of each child (as in SA3-fix.md run 2): step 1 `list_chats` before any `tool_search`; step 2 `tool_search {"query":"rqwchat"}`; step 3 `list_chats` again.
Payloads come from `before_provider_request` (`payloads-<label>.jsonl`, `an.py`), results from the child session files.

| Child | Session file (under `/private/tmp/j1-fork-live/`) | Declared tools before search | Step 1 | Step 2 | Step 3 |
|---|---|---|---|---|---|
| worker (`agent_type worker`) | `sessions-worker/...527ab85629ab.jsonl.children/agent-1/...527f7b59331b.jsonl` | 14, `tool_search` yes, chat tools none | `Tool list_chats not found`, isError true | `Loaded 4 tools` | `{"chats":[],"nextCursor":null,...}`, isError false |
| grandchild (main -> child -> grandchild, no fork) | `sessions-grandchild/...b438f3bedca3.jsonl.children/agent-1/...b43cd75cfb74.jsonl.children/agent-1/...b43eafdf0f8f.jsonl` | 14, `tool_search` yes, chat tools none | same | same, after it 18 tools incl. the four | same |
| fork_turns all (depth 1 and depth 2 in `sessions-fork/`) | `sessions-fork/...e16b3878f453.jsonl.children/agent-1/...e16ee60fe038.jsonl` (+ `.children/agent-1/...e1711a2165a4.jsonl`) | 14, `tool_search` yes, chat tools none (also in the caller) | `Tool list_chats not found` (depth 1 and depth 2) | `Loaded 4 tools` (depth 2) | `{"chats":[],...}`, isError false (depth 2) |

After `tool_search` the next request of the worker, grandchild and depth-2 fork declares 18 tools including `list_chats`, `send_message_to_chat`, `read_chat`, `wait_answer`. Pass for all three.
Note on the fork run: the first fork inherited the main prompt ("call bash, start a fork") and repeated it once, so a depth-2 fork existed. This was my prompt design, harmless, and it gave one more fork for the check.
In the later clean run (cell B) the fork skipped step 1 itself; its first wire request still declared no chat tool, and after `tool_search` the declared tools went from 14 to 18 and `list_chats` returned `{"chats":[]...}`.

## Cell B. First request of a `fork_turns: "all"` child vs decision (b), byte copy

Important: `before_provider_request` is NOT the wire for the fork. `fork-payload.ts` / `index.ts:1312-1327` replace the payload in a wrapper `onPayload` after the child's own handlers ran, so the observer saw the child's native request (messages `[prompt, task, marker]`, different cache_control), not the sent copy. I therefore patched `globalThis.fetch` in `observe2.ts` and recorded the real request bodies sent to `/v1/messages` (`wire.jsonl`).
Run: `run2.py`, main prompt: `bash date` alone, then `agent start fork_turns "all"` with a task that starts "You are the forked child ... Do not start any agent." plus the three steps. Session: `sessions-fork2/` (main `...ae53721a...jsonl`, fork `.children/agent-1/...c6d3721a...jsonl`).

Wire requests: 0 naming (no tools), 1-2 main, 3 fork first, 4-6 fork, 7 main final. Caller's last real request before the fork = wire 2 (6 messages, after the `bash` result). Fork's first request = wire 3 (7 messages). `cmp3.py`:
- Raw JSON text of the fork body equals the caller body text with exactly one message inserted at the end of `messages`: `B raw == A raw with task inserted at end of messages: True` (+415 bytes = the task message).
- Identical byte for byte: `model`, `max_tokens`, `stream`, `system` (3 blocks), `tools` (14 tools, same order, `tool_search` present, no chat tool, also the same SA3 wildcard state), `thinking`, `output_config`, `metadata`, top-level key order, all 6 earlier messages, all cache_control marks (tools[12], system[1], system[2], message[4], all `ephemeral 1h`).
- Differs: (1) the appended last message `{"role":"user","content":[{"type":"text","text":"<fork task>"}]}`, no cache_control; (2) HTTP header `x-client-request-id` (a fresh id per request). Other headers equal.
- Tool list difference from the SA3 wildcard or anything else: none. The caller's own tool list has no chat tool either.
- Observation, not a defect: the last element of the caller's `messages` is `{"role":"system","content":[],"output_config":{"effort":"medium"}}`, and the fork's task message is placed after it. That is what the copy does (`copy.messages.push`).
Result: pass, the first request corresponds to decision (b), a byte copy plus the task.

Cleanup: copied `auth.json` removed from `/private/tmp/j1-fork-live/agent`; `/private/tmp/srp-d2` and `~/.pi/agent` untouched.

## Cell B2. Fork with explicit `tools: ["bash"]` (decision (b): still a byte copy)

Run: `run3.py bashA` (observer `observe2.ts` wrapping `fetch`, as in cell B), build `f4d10f3b`, `anthropic/claude-opus-5-5` medium. Main: `bash date` alone, then `agent start` with `fork_turns "all"`, `tools ["bash"]`, task: "You are the forked child ... Step 1: call tool_search rqwchat ... Step 2: call bash echo forkok". Wire file `wire-bashA.jsonl`; session `sessions-bashA/...b030...jsonl` with the fork under `.children/agent-1/...c7f3...jsonl`. Compare script: `cmp4.py bashA`.
- Caller's last real request = wire 2 (6 messages, 14 tools); fork's first request = wire 3 (7 messages, 14 tools).
- Raw JSON of the fork body equals the caller body with exactly one message inserted at the end of `messages`: `B raw == A raw + last item inserted at end of array: True` (63150 -> 63426 bytes, +276 = the task message).
- Identical: top-level key order, `model`, `max_tokens`, `stream`, `system`, `tools` (the same 14 declarations in the same order: `rqw_readfile, Bash, Edit, Write, agent, web, rename_session, browser, codemode, tool_search, rqw_rg, rqw_glob, job, __pi_deferred_placeholder__`), `thinking`, `output_config`, `metadata`, the first 6 messages, all cache_control marks.
- Differs: only the appended user message with the task (no cache_control) and the header `x-client-request-id`. The copy keeps the caller's tool list although `tools: ["bash"]` was requested: so `rqw_readfile`, `Edit`, `Write` etc. are declared in the fork's first request, but the fork has only `bash`.
- Later requests (wire 5, 6) use the fork's own tools: `Bash, agent, web, rename_session, browser, codemode, tool_search, job` (+ the four chat tools after `tool_search`, + the placeholder). No `rqw_*`, `Edit`, `Write`.
- Fork results: `tool_search rqwchat` -> `Loaded 4 tools` (the fork's `tool_search` exists), `bash echo forkok` -> `forkok`, no error. The fork never called a missing tool, so a `Tool ... not found` was not exercised in this run (covered by `fork-anthropic.test.ts:149`). Pass.
- Same run three times: the two attempts meant for Codex (below) fell back to Opus and gave the identical result (`wire-bashC.jsonl`, same 6 -> 7 items, 63150 -> 63426 bytes, raw-insert check True), so Anthropic was observed three times.

## Codex: not run
A Codex main could not be started: in print mode a new session always starts on `anthropic/claude-opus-5-5`; `--model openai-codex/gpt-6.1-terra` and `defaultProvider/defaultModel` in the isolated `settings.json` were both ignored (two attempts, `run-bashC.jsonl` shows `anthropic`). The Codex fork path (`index.ts:1319-1326`, `delete copy.previous_response_id`, push of an `input_text` message) was not observed on the wire.

Cleanup: copied `auth.json` removed from `/private/tmp/j1-fork-live/agent` and `agent-cx`.
