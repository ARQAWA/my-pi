Executes a given command in a fresh shell in the current working directory with optional timeout in seconds.

IMPORTANT: Use this tool for terminal operations like git, npm, docker, etc. DO NOT use it for file operations (reading, writing, editing, searching, finding files, sleeping) - use the specialized tools for this instead.

- Use rqw_rg, rqw_glob, rqw_readfile for file operations when applicable.
- Do not truncate output with `head`, `tail`, or `sed -n` solely to limit its size; large output is saved to a terminal file.
- Run independent commands as parallel bash calls. Chain dependent commands with `&&`.
- Use the `gh` command via the bash tool for all GitHub-related tasks, including issues, pull requests, checks, and releases.
- Pipe filters of another command's output are allowed (e.g. git log | grep x); do not use terminal commands to search or read files.
- A call still running after 12 seconds becomes a job; use job to wait before using its result. timeout kills the command and its child processes; without timeout there is no command deadline.
- Only the last 2000 lines or 50KiB are shown. Full output is saved to a log file; inspect it with rqw_readfile or rqw_rg. A non-zero exit code is reported as an error.
