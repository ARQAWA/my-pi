# SA8-compaction-live. Root owner include after real compaction

Result: PASS. Date: 2026-11-04 UTC.
Build: installed clone `/Users/arkadijcukavin/.pi/agent/git/github.com/ARQAWA/my-pi`, clean HEAD `e65532c9113998c6cfc67ab191b2d4fbde1ce27a`. Pi 1.5.0. Main and ordinary child: `openai-codex/gpt-6.1-terra`, low.

## Setup and exact commands

Temporary observer, isolated credentials, public main-model selection and permanent raw storage are described in `J1-codex-fork-live.md`. No product code changed.
Isolated `settings.json` uses `compaction:{enabled:true,keepRecentTokens:64,reserveTokens:1024}`. Early owner prompt:

```text
Early owner words: ROOTSA8QXZNOVEMBER. This exact sentence belongs to the root owner before compaction. Reply READY and do not call tools.
```

A second prompt contains 400 repetitions of `padding` and requests `READY2`. Two initial short-session setup attempts returned `Nothing to compact (session too small)` before reaching the child scenario; adding inert padding made native compaction possible. These attempts are retained in raw session trees. No runtime include failure occurred.

```sh
python3 /private/tmp/srp-live-20261104/run.py include
python3 /private/tmp/srp-live-20261104/verify-include.py
python3 /private/tmp/srp-live-20261104/archive.py
```

Driver launches this exact process from `/private/tmp/srp-live-20261104/work`, with `PI_CODING_AGENT_DIR=/private/tmp/srp-live-20261104/agent` and `LIVE_LOG=/private/tmp/srp-live-20261104/capture-include.jsonl`:

```sh
pi --mode rpc --no-context-files --no-skills --no-prompt-templates --session-dir /private/tmp/srp-live-20261104/sessions-include -e /Users/arkadijcukavin/.pi/agent/git/github.com/ARQAWA/my-pi -e /private/tmp/srp-live-20261104/observe.ts
```

Actual manual RPC compaction command:
```json
{"id":"6","type":"compact","customInstructions":"Summarize the brief conversation. Do not preserve the unique marker word or quote the early owner sentence. Keep only that a live include acceptance check will follow."}
```

## Evidence

Permanent raw folder: `/Users/arkadijcukavin/ai-project/my-pi-evidence/designs/joint-consensus/acceptance/raw/2026-11-04-live-tail/`.
Parent:
`sessions-include/2026-11-04T22-21-20-772Z_01a1a8a7-0604-712c-b307-da227d361084.jsonl`.
Child:
`sessions-include/2026-11-04T22-21-20-772Z_01a1a8a7-0604-712c-b307-da227d361084.jsonl.children/agent-1/2026-11-04T22-21-33-014Z_01a1a8a7-35d6-712c-b307-da28c1305f25.jsonl`.

`compact-result.json`: RPC success true. Parent JSONL line 16 contains real native compaction `529ce743`, timestamp `2026-11-04T22:21:29.682Z`, `fromHook:false`, `firstKeptEntryId:f9bb5a93`, `tokensBefore:12720`. Summary uses a real Codex response, usage input 346 / output 109 tokens. It contains neither the marker nor the early owner sentence.

Actual subsequent parent tool call:
```json
{"action":"start","model":"openai-codex/gpt-6.1-terra","thinking":"low","include":["user_messages"],"title":"Live root include","task":"Do not call tools or start agents. Find the unique word beginning ROOTSA8 in the included root owner words and reply with that word only."}
```

`capture-include.jsonl` line 27 is the first parent request after compaction. Its payload does not contain the marker. The child first user message contains exactly one occurrence of the marker, inside the included original root owner words:

```text
Do not call tools or start agents. Find the unique word beginning ROOTSA8 in the included root owner words and reply with that word only.

<user_messages>
Blocks <skill ...> inside these messages are skill text, not the user's words.
Early owner words: ROOTSA8QXZNOVEMBER. This exact sentence belongs to the root owner before compaction. Reply READY and do not call tools.
```

The full included task, including closing tag, is in the child JSONL and transmitted request capture. `verify-include.txt` key lines:

```text
marker_in_compaction_summary False
first_post_compaction_request_capture_line 27 marker_in_parent_request False
child_task_contains_marker True marker_occurrences 1 child_user_message_count 1
child_response ['ROOTSA8QXZNOVEMBER']
```

The child received root owner words absent from the compacted parent's request and replied with the exact marker. Parent completed with `DONE`. Copied credentials were removed; authorization headers were never captured.
