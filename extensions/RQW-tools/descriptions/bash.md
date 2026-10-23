Run a command in a fresh bash shell in the working directory; returns stdout and stderr together.
- One fact per command or pipeline; chain dependent steps with `&&`. Nothing carries over between calls: `cd`, exported variables and functions last only for that command.
- A command still running after 12 seconds continues in the background as a job; the result then gives its job id, the output so far and a log file. Use the job tool to wait for it, check it or kill it, and wait for a job before anything that needs its result. Esc kills your jobs.
- `timeout` (seconds) kills the command with all its child processes, also in the background; without it a command has no deadline. Processes a command leaves running after it ends are not tracked.
- Search and read with the grep, find and read tools, not with rg, grep, find, cat, head or sed in the shell, unless a tool result tells you to. Use bash for git, builds, tests and running programs.
- Only the last 2000 lines or 50KB of output are shown; the full output is then saved to a file named in the result. Read that file with read or grep instead of running the command again.
- A non-zero exit code marks the result as an error and is reported with the output.
