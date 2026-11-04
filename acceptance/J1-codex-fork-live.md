# J1-codex-fork-live. First fork request on real Codex

Result: PASS. Date: 2026-11-04 UTC.
Build: installed clone `/Users/arkadijcukavin/.pi/agent/git/github.com/ARQAWA/my-pi`, clean HEAD `e65532c9113998c6cfc67ab191b2d4fbde1ce27a`. `pi list` identifies this clone as the loaded `git:github.com/ARQAWA/my-pi@release` package. Pi 1.5.0.
Main and child: `openai-codex/gpt-6.1-terra`, low.

## Setup and exact commands

Working folder: `/private/tmp/srp-live-20261104/work`. Isolated agent settings and copied credentials: `/private/tmp/srp-live-20261104/agent`. Credentials were deleted after each process. Product checkout and installed clone were not modified.

```sh
python3 /private/tmp/srp-live-20261104/run.py fork
python3 /private/tmp/srp-live-20261104/verify-fork.py
python3 /private/tmp/srp-live-20261104/verify-include.py
python3 /private/tmp/srp-live-20261104/archive.py
```

Driver launches the exact process below, with `PI_CODING_AGENT_DIR=/private/tmp/srp-live-20261104/agent` and `LIVE_LOG=/private/tmp/srp-live-20261104/capture-fork.jsonl`:

```sh
pi --mode rpc --no-context-files --no-skills --no-prompt-templates --session-dir /private/tmp/srp-live-20261104/sessions-fork -e /Users/arkadijcukavin/.pi/agent/git/github.com/ARQAWA/my-pi -e /private/tmp/srp-live-20261104/observe.ts
```

New-session RQW-models selects Opus regardless of CLI model flags. Initial RPC `set_model` returned `Model not found: openai-codex/gpt-6.1-terra`, before any scenario ran. The temporary observer therefore uses public `session_start`, `ctx.modelRegistry.find`, and `pi.setModel` after package initialization. RPC `get_state` and actual transmitted requests verify Terra. No product patch or bypass of fork logic was used.
The observer records `before_provider_request` and final `ws` send frames, plus HTTP request bodies if used. It never records authorization headers.

## Evidence

Permanent raw folder: `/Users/arkadijcukavin/ai-project/my-pi-evidence/designs/joint-consensus/acceptance/raw/2026-11-04-live-tail/`. It contains the driver, observer, verification scripts, command transcripts, full request captures, session trees and `SHA256SUMS.txt`; no copied agent configuration or credentials. `verify-fork.txt` and `verify-include.txt` contain the computed results.

Parent session under the raw folder:
`sessions-fork/2026-11-04T22-20-18-821Z_01a1a8a6-1405-779f-b9ee-08fb690afd0e.jsonl`.
Child session:
`sessions-fork/2026-11-04T22-20-18-821Z_01a1a8a6-1405-779f-b9ee-08fb690afd0e.jsonl.children/agent-1/2026-11-04T22-20-24-177Z_01a1a8a6-28f1-779f-b9ee-08fe70696a14.jsonl`.

Actual parent call:
```json
{"action":"start","fork_turns":"all","title":"Live fork check","task":"You are the forked child. Do not start any agents or call tools. Reply exactly CODEX_FORK_CHILD_OK."}
```

`capture-fork.jsonl`, line 7: source logical parent request. Line 12: first generating child WebSocket request. Native prewarm frames with `generate:false` are excluded. Parent's transport continuation sends a delta, so compare the complete captured logical parent input to the actual child's complete transmitted input, not the parent's delta frame.

```text
source_input_items 7 child_input_items 8
source_branch_entries 12 source_branch_message_entries 4
copied_input_exact True task_appended_exact True
previous_response_id_absent True
copied_input_sha256 146d37213dbe281a29241aa1edb0c45aa48a9e286da7ff677d2621bbf2dd776f
```

The source branch has 12 entries; nine non-custom, non-session-info entries retain their original IDs in the durable child before its own additions. The request proof is stronger: all seven source input items are structurally identical and in the same order. The eighth and only extra item is:

```json
{"type":"message","role":"user","content":[{"type":"input_text","text":"You are the forked child. Do not start any agents or call tools. Reply exactly CODEX_FORK_CHILD_OK."}]}
```

Every other logical body field matches except native `client_metadata.x-codex-ws-stream-request-start-ms`, refreshed by transport before sending. The WebSocket envelope also adds `type:"response.create"`. This is not a claim of byte equality for timestamp-bearing whole wire frames. The copied branch input and exactly one task are proven on the real outgoing child frame. Child response: `CODEX_FORK_CHILD_OK`; parent response: `DONE`.
