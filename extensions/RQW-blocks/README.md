# RQW-blocks

Independent runtime UI patches for compact chat blocks. Pi files stay unchanged; an incompatible shape falls back to stock.

Compaction, branch summary, bash and thinking styles are ready before Pi builds the history. They use the host's live theme,
not a session context. On a compatible Pi 1.4.0 startup, the first history is built after the viewport exists and before the
terminal starts, without waiting for session-start handlers. Pi subscribes before those handlers, and the usual later history
redraw is skipped once. The editor's input history is transferred when the editor changes during startup or a session rebind,
only for the displayed session. An incompatible startup shape keeps Pi's usual sequence. During a session switch the visible blocks keep their style until
the new history is built; pending older history stops loading. On quit, the exit transcript prints only what is drawn, so quitting stays instant on a long branch.
The host releases its patches after Pi stops. Reload and a newly disabled extension are resolved against the current host's
loaded extension paths.

## History (`history.ts`, `lazy.ts`)

Pi 1.4.0 draws only the compaction-aware context after a compaction, on resume, on `/tree` and on `/reload`. This extension
draws the whole active branch instead, each compaction at its chronological place. The model context is untouched.

Fullscreen view: the chat starts at the latest compaction's kept range. The older part waits and is drawn above, one interval per compaction
(from its kept range to the next), when you scroll to the top: wheel, Page Up, Ctrl+Home, or a scrollbar drag to the top (one interval per arrival). The rows you read
stay in place; Pi's header moves above the loaded history. 
On the way back down the loaded intervals that are entirely above the screen are removed again, oldest first: wheel, Page Down and the
scrollbar keep one screen of margin; Escape, Ctrl+End and Jump to latest have no margin. The floor (the latest compaction's range) is always
kept, and an older interval that is partly visible stays loaded. An input up only loads, an input down only unloads.

- Only user scroll inputs load. `ScrollView.scrollTo` is not wrapped, because the search calls it inside a frame: a search jump to the top
  shows the loaded top and the next scroll up loads. Search sees only drawn rows.
- A compaction while you are not at the bottom keeps the drawn start, so your rows do not move. At the bottom the chat starts at the new range.
- Heights are taken again at the input (Ctrl+O, thinking and resize change them); after a resize nothing unloads before the next frame.
- Unloading resets the text selection and the cached row layout. RQW-tool-ui keeps its redraw callbacks by tool call ID weakly, so unloaded tool components can be collected.
- An older interval is drawn into Pi's own chat container with the drawn part set aside, so the worked-for folds of RQW-tool-ui (which track the chat by position) work in loaded intervals: they start closed, and closed again after an unload and a new load.
- Switching to inline mode draws everything first. The exit transcript does not: it prints the drawn part only, as Pi's own draws the compacted context.
- Inline mode, a changed Pi shape and any failure draw the whole branch at once, as before.
- The interval starts are 0 and each compaction's `firstKeptEntryId`; they must be found and strictly ascending, otherwise the whole branch is drawn at once.
- RQW-tool-ui breaks tool groups at every compaction's cut, so "Read 5 files" splits there into "Read 3 files" and "Read 2 files".

Measured on 10018 entries in 18 compactions, with Pi's real InteractiveMode, TuiAltScreen and ScrollView: start (build plus first frame)
222 to 226 ms before, 6.6 to 8.1 ms after; the one-time load of everything 179 to 183 ms (task 1); with intervals, 18 steps of 10 to 32 ms (median 15 to 17 ms); a cached frame 0.1 ms at start, 3.9 to 5.1 ms after the load.
Unloading, with all 18 intervals loaded: one interval per input 0.19 to 2.1 ms, all 18 on Escape 7.1 to 7.4 ms, a downward input with
nothing to unload 0.17 to 0.18 ms; the cached frame falls from 3.4 to 3.7 ms to 0.07 to 0.08 ms.

Contract: `DECISIONS.md` `[D-UI-HISTORY]`. Tests: `test/extensions/RQW-blocks/`.
