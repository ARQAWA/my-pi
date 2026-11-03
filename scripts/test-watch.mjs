import { ftruncateSync, openSync, writeSync } from "node:fs";
import { afterEach, beforeEach } from "node:test";

// Preloaded by scripts/check.mjs. The hooks run in the test's own tick, so this file names the test even when it
// then blocks the event loop or never ends, where no reporter event could get out. check.mjs reads it from outside
// and kills the run when one test has gone past the limit; a test that returns late fails here by name.
// Node's own --test-timeout is not used: it also times out whole suites, whose tests add up to more than one limit.
if (process.env.RQW_CHECK_LOG) {
  const now = Date.now; // tests mock Date; the clock here must stay real, as check.mjs compares it with its own
  const fd = openSync(process.env.RQW_CHECK_LOG, "w");
  const limitMs = Number(process.env.RQW_TEST_LIMIT_MS);
  const running = [];
  const publish = () => {
    ftruncateSync(fd, 0);
    writeSync(fd, JSON.stringify({ current: running.at(-1) }), 0);
  };
  beforeEach(test => {
    running.push({ file: test.filePath, name: test.fullName, at: now() });
    publish();
  });
  afterEach(test => {
    const [{ at }] = running.splice(running.findLastIndex(entry => entry.name === test.fullName), 1);
    // A parent test is timed from its last subtest, so its subtests do not add up against it.
    if (running.length) running.at(-1).at = now();
    publish();
    if (now() - at > limitMs) throw new Error(`the test ran ${now() - at} ms, over the ${limitMs} ms limit`);
  });
}
