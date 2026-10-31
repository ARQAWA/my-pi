# RQW-tools

Base tools and background jobs.

Read, write, edit, find and grep use stock parallel execution. Bash and codemode run independently without ordering, claims, snapshots or effects reports. Multi-file edit and write, bounded Windows retry and our descriptions remain.

A call still running after 12 seconds returns `job#N`. The `job` tool waits, checks status and kills process jobs. Notification waits deliver one completion message. Counts expose handed-off running jobs through `rqw:running-counts:*`.

Hidden matches: grep and find skip paths from `.gitignore`. Beside each search, `search.ts` lists the matching files with and without ignore rules (`rg -l`, `fd`), in parallel. When the second list has more, the answer ends with `Also N files in ignored paths: dir/ n. Set path to a listed directory to search it.` (find says `entries`), on empty and non-empty answers. A listed directory is one where the same search with `path` set to it really finds the matches (checked with one more listing per shown directory); other hidden paths are named one by one. Each listing stops after 10000 paths; then the note says `at least N`, and a cut-off visible list gives no note. A listing that fails (rg exit above 1, fd exit above 0) or is not found adds no note and never fails the search; a missing program is retried once after the search, when Pi has downloaded it. Cost on a 218MB `node_modules`: up to 0.21 s for grep, 0.02 s for find.
