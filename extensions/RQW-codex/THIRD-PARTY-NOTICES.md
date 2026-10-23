# Third-party notices

RQW-codex ports application-protocol mechanics from OpenAI Codex, stable `rust-v0.163.0`, commit `83086188ae0614bd882818ff1aa23f3194962012`, Copyright OpenAI. Upstream is licensed under Apache License 2.0: https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/LICENSE . The TypeScript adapter is a separately maintained implementation, not an OpenAI product or Pi fork. Source-file attribution and reproducibility digests are in `test/fixtures/oracle-source.json`; ported mechanics are identified in source comments and the decision ledger.

Pi 1.4.0 is consumed unmodified through its npm package exports. The packaged WebSocket connector dependency retains its own license. No upstream binaries are copied into the product by the oracle CI harness.

The full upstream Apache License 2.0 is included in `LICENSE-CODEX`.

`tool-sampling.ts` ports Pi 1.4.0 constrained-sampling normalization; `session-prefix.ts` ports its pure run-option and system-section projection used for idle history prewarm. Source locations, versions and available hashes are identified in their headers. These minimal MIT compatibility helpers are covered by `LICENSE-PI`; no installed Pi file is modified and no private npm source path is imported.

`display.mjs` is a minimal display-only compatibility port of the Pi-ai 1.4.0 Responses stream parser (MIT), with pinned source hashes in its header. Pi 1.4.0's extension loader cannot resolve that exported subpath; the local carrier keeps the extension loadable under Node and embedded Bun without modifying Pi or importing runtime code from outside this folder. The upstream MIT license is included in `LICENSE-PI` (source: https://raw.githubusercontent.com/earendil-works/pi/v1.4.0/LICENSE). No Pi transport or package is forked.
