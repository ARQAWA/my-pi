Run a command in a fresh bash shell in the working directory; returns stdout and stderr together.
- One fact per command or pipeline; chain dependent steps with `&&`. Nothing carries over between calls: `cd`, exported variables and functions last only for that command.
- Without `timeout` (seconds) a command has no deadline. Set it for builds, tests, installs and anything that may hang. A command that does not exit, such as a server or watcher, holds this call and every later call until its timeout kills it with all its child processes; never run one without `timeout`. Processes left running in the background after the command ends are not tracked.
- Search and read with the grep, find and read tools, not with rg, grep, find, cat, head or sed in the shell, unless a tool result tells you to. Use bash for git, builds, tests and running programs.
- Only the last 2000 lines or 50KB of output are shown; the full output is then saved to a file named in the result. Read that file with read or grep instead of running the command again.
- A non-zero exit code marks the result as an error and is reported with the output.
