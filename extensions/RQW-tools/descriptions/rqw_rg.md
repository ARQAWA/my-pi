Search the workspace with ripgrep.

- Use this tool instead of shell rg; respects .gitignore
- Default scope is the current working directory; set path (relative or absolute path) to narrow it
- Supply a regex pattern; escape metacharacters, e.g. "functionCall\(", "\{", "\}"
- Prefer type over broad glob; wildcard globs like * bypass ignore rules and slow searches
- Enable multiline only when a match spans lines—it can degrade performance
- Context flags (-A, -B, -C) only affect content output
- Output is limited to 2000 entries by default and 50KiB; head_limit=0 removes only the entry limit. Truncation is marked; tighten the query or use offset and head_limit. Content lines are limited to 1000 characters.
- Broad searches skip .git, dependencies and common caches; explicitly name a skipped directory in path or glob to inspect it.
