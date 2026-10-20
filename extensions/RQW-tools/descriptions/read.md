Read a file from the local filesystem. Text files and images (jpg, png, gif, webp, bmp); images are sent as attachments.
- Without offset and limit a file comes back whole up to 2000 lines or 50KB; a longer file returns its first part and ends with "Use offset=N to continue". Prefer this whole-file read.
- Several reads in one response run in parallel. Read every file that may relate to the subject in one response.
- Use read to examine files instead of cat, head or sed through bash.
