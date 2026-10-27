# Post-edit Oxlint

Repository-local development tooling, not a shipped `RQW-*` extension and not listed in `pi.extensions`.
It uses the checkout's own Oxlint binary and `.oxlintrc.json`.

After every successful `edit` or `write`, one Oxlint process checks all changed supported source files.
Multi-file results use only their successful `details.files[]` entries. Background job handoffs and failed files are skipped.
Paths resolve against the session's `ctx.cwd`. Concurrent checks discard stale results for paths edited again, and cancellation stops the process.

Clean results stay unchanged. Findings append only `oxlint:` and up to five deduplicated `path:line:column: message` lines, within 2,000 bytes.
Original content, structured content and details remain intact; source findings never make the edit an error.
A checker failure appends a short `oxlint check failed:` diagnostic instead of looking clean.

For executor coverage, the extension offers its inline factory on `rqw-agent:subagent-extension-factories`.
The factory installs the checker on the child and reoffers itself for nested children. No other project extension is loaded.
A trusted checkout loads this extension at startup or `/reload`; executor coverage also requires the shipped RQW-agent version with the generic child-factory channel.
