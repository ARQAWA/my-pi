import { describe, test } from "node:test";

const spin = ms => {
  const end = Date.now() + ms;
  while (Date.now() < end);
};

describe("suite", () => {
  for (const n of [1, 2, 3]) test(`part ${n}`, () => spin(150));
});

test("parent", async t => {
  for (const n of [1, 2, 3]) await t.test(`sub ${n}`, () => spin(150));
});
