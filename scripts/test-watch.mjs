import { ftruncateSync, openSync, writeSync } from "node:fs";
import { afterEach, beforeEach } from "node:test";

// Preloaded by scripts/check.mjs. The hooks run in the test's own tick, so this file names the test even when it
// then blocks the event loop, where no reporter event could get out. check.mjs reads it from outside.
// A test that blocks and then returns is not timed out by node, so it fails here when it ran past the limit.
if (process.env.RQW_CHECK_LOG) {
  const now = Date.now; // tests mock Date; the clock here must stay real, as check.mjs compares it with its own
  const fd = openSync(process.env.RQW_CHECK_LOG, "w");
  const limitMs = Number(process.env.RQW_TEST_LIMIT_MS);
  const running = [];
  const timedOut = [];
  const publish = () => {
    ftruncateSync(fd, 0);
    writeSync(fd, JSON.stringify({ current: running.at(-1), timedOut }), 0);
  };
  beforeEach(test => {
    running.push({ file: test.filePath, name: test.fullName, at: now() });
    publish();
  });
  afterEach(test => {
    const [{ at }] = running.splice(running.findLastIndex(entry => entry.name === test.fullName), 1);
    if (test.signal.aborted) timedOut.push({ file: test.filePath, name: test.fullName });
    publish();
    if (!test.signal.aborted && now() - at > limitMs) throw new Error(`the test ran ${now() - at} ms, over the ${limitMs} ms limit`);
  });
}
