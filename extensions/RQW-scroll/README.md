# RQW-scroll

Escape returns a scrolled transcript to the latest message while the main turn is idle and no background work runs (counts offered on `rqw:running-counts:offer`). While a turn or background works, Escape stays Pi's turn control (interrupt; double press stops the background, see RQW-send-now).

Modules and resources live beside `index.ts`; subfolders group needed resources.
