# Prompt/tools isolation

Scope: only ownership of RQW-tools-specific runtime instructions. No manifesto edits, tool execution changes,
model calls, cross-extension imports or process patches. RQW-prompt/index.ts is unchanged.

Owner: «Когда мы делаем эти отдельные модули, они должны быть полностью изолированы, самодостаточны, чтобы мы могли включать и выключать, как feature флаги».

## Exact effective prompt diff, both extensions on with default tools

Removed from the RQW-prompt preamble, verbatim:

```text
; a shell command waits for the calls before it and holds the calls after it
; a long file written in parts is the one exception
; a long file still goes in parts
```

The first two were suffixes of the parallel-calls bullet; the third was a suffix of the specified-new-files bullet.
The rest of those bullets is byte-for-byte unchanged, including their final periods.

Removed the following block and its following blank line from between `</general>` and `<editing_constraints>`:

```text
<search_method>
- Search with the grep and find tools and read files with read, following the method in the grep description.
</search_method>
```

Appended after Pi's `<cwd>` section, in this order:

```text
<search_method>
- Search with the grep and find tools and read files with read, following the method in the grep description.
</search_method>

<rqw_tools_execution>
- A shell command waits for the calls before it and holds the calls after it.
</rqw_tools_execution>
```

Thus the search block is unchanged except for position. The barrier clause becomes its own bullet, with an uppercase
initial A and a final period. The two partial-write reminders are removed, not replaced by new prompt text.
Every other preamble byte, the workstation/critical/environment/date blocks, and all tool descriptions are unchanged.
Pi may append other extensions' custom sections too; this change makes no claim about their relative order.

## Why only one new hook

`extensions/RQW-tools/index.ts` mutates `event.systemPromptOptions.sections` in `before_agent_start`.
Pi 1.3.0's `dist/core/extensions/runner.js:1121-1163` normalizes the input once and gives every handler that same
object. RQW-prompt only writes `customPrompt`, so the handlers commute in either order.
`dist/core/system-prompt.js:78-114` retains custom sections after cwd even with customPrompt. In contrast,
`promptGuidelines`, `toolGuidelines` and `promptSnippet` participate only in the stock-prefix branch. A guideline
would silently disappear with RQW-prompt on. No internal method patch is needed.

The search method itself is already in `extensions/RQW-tools/descriptions/grep.md`, but the removed SYSTEM line
instructs the model to use it. Preserve that line rather than silently dropping a measured instruction.

The descriptions do NOT explain the shell barrier. `bash.md` says a non-exiting command holds later calls, but that
is not the general shell ordering rule. Preserve the existing clause in the tools-owned execution section.
This changes instruction ownership and position, not the barrier implementation.

The partial-write reminders ARE redundant. `extensions/RQW-tools/descriptions/write.md` already says:

```text
A response has an output limit: write a file over about 400 lines in parts, each part in its own response: the first with write, then each next with edit whose oldText is the unique last lines of the file and whose newText is those lines plus the next part.
```

That description contains the threshold, exception to a single write, response separation and append mechanism.
It remains unchanged. No extra hook repeats it.

## Toggles and selection

- Prompt off: tools still append the same two instruction sections to Pi's stock prefix.
- Tools off: prompt has no search block, shell-order clause or partial-write reminders.
- Search section: only when read, grep and find are in `selectedTools` and none is in `hiddenTools`.
- Execution section: only when bash is selected and not hidden.
- Each new turn starts from fresh base options; changing active tools removes obsolete sections.
- Package disable plus reload drops the tools handler and its sections. Pi's transcript contains historical prompt
  patches; the current effective system prompt no longer contains those sections.

## Proof and remaining risks

`test/prompt-tools-isolation.test.ts` uses real Pi sessions, a real package filter and a faux provider, replaying
system section and tool declaration patches. It tests each extension alone, both orders, five `--tools` selections,
active-tool changes and disabling either extension through package settings plus reload. No live model calls.
The normal `npm test` command includes these package integration tests on the existing OS/Node CI matrix.

Local results on macOS: `npm test` on Node 26.7.0: 307 tests, 306 passed, one Windows-only skip, zero failures.
`npm exec --offline --package=node@22 -- node --test test/prompt-tools-isolation.test.ts` on Node 22.23.3:
13 passed. `bun test test/prompt-tools-isolation.test.ts` on Bun 1.4.3: 13 passed. `git diff --check` passed.
Windows/Linux runs and an independent review were not performed in this local implementation report.
This proof boundary does not override the workflow's independent-review requirement.

Position and repetition can affect a model even when the remaining instructions are identical. The search and
barrier text now appears later; two partial-write reminders disappear. GPT benchmarks must measure that change
separately from the four manifesto edits. This task does not claim measured model equivalence.

Stock Pi preserves the active tool set across reload. Disabling RQW-tools can therefore leave stock grep/find active;
this task removes our instructions, not Pi's retained selection. A fresh session has the stock four defaults.
An extension returning a forced `systemPrompt` bypasses all structured sections by Pi's design, including these;
RQW-prompt uses customPrompt, not a forced prompt.

The shell barrier still covers our six tools and the wrapped codemode, not arbitrary third-party tools or stock ls.
This is the existing instruction's scope limitation, not a new execution guarantee. Other extensions mutating tool
selection after this hook can make its instructions stale for that turn, as with any before_agent_start selection
consumer; there is no cross-extension finalization API. No dependency on RQW-prompt order is introduced.
