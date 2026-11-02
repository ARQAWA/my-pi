import { compose } from "node:stream";
import { spec } from "node:test/reporters";

export default async function* report(source) {
  async function* monitor() {
    for await (const event of source) {
      if (event.type === "test:fail" && event.data.nesting === 0 && event.data.todo === undefined && event.data.skip === undefined) {
        process.exitCode = 1;
      }
      yield event;
    }
  }
  yield* compose(monitor(), new spec());
}
