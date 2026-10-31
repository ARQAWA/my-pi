Search the workspace with ripgrep.

- Use this tool instead of shell rg; respects .gitignore
- Default scope is the current working directory; set path (relative or absolute path) to narrow it
- Supply a regex pattern; escape metacharacters, e.g. "functionCall\(", "\{", "\}"
- Prefer type over broad glob; wildcard globs like * bypass ignore rules and slow searches
- Enable multiline only when a match spans lines—it can degrade performance
- Context flags (-A, -B, -C) only affect content output
- Output is limited to 2000 entries by default and 50KiB; head_limit=0 removes only the entry limit. Truncation is marked; tighten the query or use offset and head_limit. Content lines are limited to 1000 characters.
- Broad searches skip .git, dependencies and common caches; explicitly name a skipped directory in path or glob to inspect it.

- Search a topic wide and deep in as few responses as possible. Each response is one wave with all its independent calls; never one read per response, never a response only to plan or to wait.
- Wave 1, map and read, in one codemode call with max_output_tokens set to the wave budget and independent calls in Promise.all: rqw_rg output_mode "count" with -i for each facet of the subject, each an alternation of every spelling (snake_case, CamelCase, UPPER_CASE, kebab-case, the words of the question), plus rqw_glob for name fragments and run files; rank files by facets hit, then hits; read the top files whole while their bytes fit the budget, return a digest (matching lines with line numbers, definitions, imports) for the next ones and only paths for the tail; store the ranking. In the same response read the run and deploy files and the files the question names.
- Any footer that says a result is cut, partial or incomplete ("Output cut", "Showing … more", "Use offset=", "Scan incomplete", "Some paths could not be searched", "is larger than the output budget", "Some lines were cut", "is not shown in full") means the result is incomplete: page with offset, narrow by path, type, glob_pattern or target_directory, or rerun before ranking; otherwise name the coverage gap in the answer.
- Wave 2: rqw_rg content with -C 2 for every exact identifier the reads revealed (callers, config keys, env vars, tables, topics), together with whole reads of files earlier waves justified but did not read whole.
- Wave 3 and later: read the files the previous wave's searches revealed; a read that depends on a search always goes to the next wave.
- Whole text only for the strongest files; never reread unless a compaction removed the text. Each wave stores compact state with codemode store: paths with score and read mode, pending files and connections, facts as path:line plus at most 200 characters; split keys per wave and keep each value under 262144 characters of JSON; when all values near 1048576, write the full state to a file in the system temp folder and keep only its path and the pending list in store. After a compaction, load the state and continue from the pending ones. Size each wave to fit the room left before compaction. When the relevant text is larger than one context window, start subagents on slices of the ranking in the same response as your next wave.
- Keep each wave short with narrow path and type; if a call or script returns job#N, call job wait on that id in your next response and start the next wave from its result.
- Stop only when every part of the question has a file and line, every implementation is found and the run files show which one runs, and no relevant file or connection found so far is left unexamined; only a real technical limit stops earlier (a scan that stays incomplete after splitting, an unreadable file), and then the answer names the gap.
