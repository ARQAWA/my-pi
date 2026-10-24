Read a file from the local filesystem. Text files and images (jpg, png, gif, webp, bmp); images are sent as attachments.
- Without offset and limit a file comes back whole up to 2000 lines or 50KB; a longer file returns its first part and ends with "Use offset=N to continue". Read a file you need beyond one spot whole in one call, not in ranges; use offset and limit only to read around one hit.
- Several reads in one response run in parallel. In one response, read every file you will need next: the files the answer rests on, the files you will change, their tests and the code they call. A new file the task fully specifies needs no read of the files around it, only of the code it imports or extends.
- Use read to examine files instead of cat, head or sed through bash, unless a tool result tells you to use them.
- A repeat of the same unchanged range soon after your last read of it returns a one-line note instead of the text. Set force to true to get the content anyway.
