import { test } from "node:test";

test("fast one", () => {});
test("slow one", () => {
  const end = Date.now() + 150;
  while (Date.now() < end);
});
