# Third-party notices

The Claude Code billing format, fingerprint salt, version recovery policy and refresh header constants
in this extension are adapted from [oh-my-pi](https://github.com/can1357/oh-my-pi), inspected at the owner's local
checkout: `packages/ai/src/providers/anthropic.ts`, `claude-code-fingerprint.ts`, and
`packages/catalog/src/compat/rules/auth/anthropic.kdl`.
The Anthropic login implementation is delegated to the installed Pi, not copied here.

The installed edxeth/pi-claude-auth 1.3.0 was a read-only research source. None of its source is vendored.
Its README declares MIT, but the installed checkout has no LICENSE file. Its SDK-specific request transformations
are deliberately not used: the reference for this extension is omp's CLI behavior.

## oh-my-pi MIT License

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
