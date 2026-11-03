import { mock, test } from "node:test";

test("moves the clock far ahead", () => {
  mock.timers.enable({ apis: ["Date"], now: 4e12 });
});
