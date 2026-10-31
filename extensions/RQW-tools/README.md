# RQW-tools

Base tools and background jobs.

The model reads and searches with our own `rqw_readfile`, `rqw_glob` and `rqw_rg`, which carry Cursor-based tool descriptions with our own limits and paths, plus a search funnel in `rqw_rg`; stock `read`, `find` and `grep` stay hidden as the fallback. With the new search tools visible, the prompt gets one `getting_work_done` line that prefers them over shell search. Read, write, edit, search tools use stock parallel execution. Bash and codemode run independently without ordering, claims, snapshots or effects reports. Multi-file edit and write, bounded Windows retry and our descriptions remain.

Text returned by `rqw_readfile` prefixes every tenth absolute line with its right-aligned number and `|`.

A call still running after 12 seconds returns `job#N`. The `job` tool waits, checks status and kills process jobs. Notification waits deliver one completion message. Counts expose handed-off running jobs through `rqw:running-counts:*`.
