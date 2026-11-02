import { after, test } from "node:test";

test("passing test", () => {});
after(() => { throw new Error("cleanup failed"); });
