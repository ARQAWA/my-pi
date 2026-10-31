# Third-party notices for RQW-browser

## Playwright ARIA snapshot (Apache-2.0)

`aria-snapshot.bundle.txt` is Playwright v1.61.0's injected ARIA-snapshot code, bundled by oh-my-pi 18.8.9
(`packages/coding-agent/src/tools/browser/aria/aria-snapshot.bundle.txt`) and copied byte for byte. Its own header
keeps the origin: "Bundled from Playwright's injected ARIA-snapshot sources (Apache-2.0, (c) Microsoft)".

Copyright (c) Microsoft Corporation. Licensed under the Apache License, Version 2.0. The full text is in
`LICENSE-APACHE-2.0.txt`. The file is not modified; the extension only runs it.

## Puppeteer (Apache-2.0)

`puppeteer-core` 25.3.0 and `@puppeteer/browsers` 3.0.6 are by the Chromium Authors.
Their source files carry Google copyright notices and SPDX identifier Apache-2.0; the license text is in
`LICENSE-APACHE-2.0.txt`. Their bundled third-party code retains its own notices in the installed packages.
Other npm dependencies retain their licenses in their installed package files.

## oh-my-pi (MIT)

`snapshot-plus.ts` and `query-handlers.ts` are copied from oh-my-pi 18.8.9, with the small change noted at the top of
`query-handlers.ts`. `selectors.ts`, `frames.ts` and `observe.ts` are adapted from its browser tool
(`aria/aria-snapshot.ts`, `frames.ts`, `tab-worker.ts`). `actions.ts`, `dialogs.ts`, `interactions.ts`, `navigation.ts`,
`ops.ts`, `screenshot.ts` and `waits.ts` are adapted from its `tab-worker.ts`, `dialogs.ts`, `interactions.ts`,
`navigation.ts`, `op-timeouts.ts`, `screenshot.ts`, `queries.ts` and `tern/keys.ts`. `storage.ts` and `downloads.ts` are adapted from its
`storage-state.ts` and `downloads.ts`, and the upload in `interactions.ts` from its `uploadFilesToElement`. The tool description reuses its wording.

```
MIT License

Copyright (c) 2025 Mario Zechner
Copyright (c) 2025-2026 Can Bölük
Copyright (c) 2026 Stencil Labs, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
