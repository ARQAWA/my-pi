Replace exact text in files. For one file give path and edits: [{oldText, newText}, ...]. For several files use one call and put a path on each edits[] entry; the top-level path is the default for entries without their own.
- All edits of one file are matched against the original file, not one after another. Each oldText must occur exactly once in that file and must not overlap another edit of it. A name that occurs several times, as in a rename, needs one edit per occurrence with enough of its line to be unique, or one edit whose oldText spans all of them.
- Each file changes all-or-nothing: if any of its edits fails, that file stays untouched and the other files are still edited; resend only the failed files.
- Read a file before editing it.
- The result has one line per file; when text is not found, it may show the nearest matching lines with line numbers.
