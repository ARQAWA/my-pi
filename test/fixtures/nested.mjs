import { test } from "node:test";

test("parent", async t => {
  await t.test("child", () => {});
  for (;;);
});
