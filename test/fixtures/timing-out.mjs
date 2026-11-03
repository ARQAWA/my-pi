import { test } from "node:test";

// The interval keeps the process alive: with an empty event loop node would cancel the pending test and exit.
test("held forever", () => new Promise(() => setInterval(() => {}, 1000)));
