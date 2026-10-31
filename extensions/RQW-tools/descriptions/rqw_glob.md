Tool to search for files matching a glob pattern

- Works fast with codebases of any size
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns
- You have the capability to call multiple tools in a single response. It is always better to speculatively perform multiple searches that are potentially useful as a batch.
- Output is limited to 2000 paths or 50KiB. Truncation is marked; narrow the pattern or target_directory.
- Broad searches skip .git, dependencies and common caches; explicitly name a skipped directory in glob_pattern or target_directory to inspect it.
