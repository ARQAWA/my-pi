Find files and directories by glob pattern; directories end with "/". Returns paths relative to the search directory, unsorted. Respects .gitignore; hidden files are included.
- A pattern without "/" matches file names at any depth, e.g. "*.ts"; a pattern with "/" matches the end of the path at any depth, e.g. "src/**/*.spec.ts". Braces list alternatives in one pattern, e.g. "{*compose*,Dockerfile*,Makefile,main.*}". A directory name matches the directory alone: "{app,tests}" returns "app/" and "tests/"; "{app/**,tests/**}" returns the files under them.
- No result count cap by default; output is cut at 50KB. If cut, narrow the pattern or path.
- Use find for file names and grep for file contents.
- Several searches in one response run in parallel. Run every search that may be useful in one response.
