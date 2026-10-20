Find files and directories by glob pattern; directories end with "/". Returns paths relative to the search directory, unsorted. Respects .gitignore; hidden files are included.
- A pattern without "/" matches file and directory names at any depth, e.g. "*.ts"; "app" returns "app/" only, not its files. A pattern with "/" matches the end of the path at any depth, e.g. "src/**/*.spec.ts"; "app/**" returns everything under app. Braces list alternatives in one pattern, e.g. "{app/**,*.toml,*compose*,Dockerfile*}".
- No result count cap by default; output is cut at 50KB. If cut, narrow the pattern or path.
- Use find for file names and grep for file contents.
- Several searches in one response run in parallel. Run every search that may be useful in one response.
