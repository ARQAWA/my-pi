// Pi's built-in `codemode` as a call of the ordered barrier (see nested.ts and notes/settings-codemode.md).
import { createCodemodeExtension, type ExtensionAPI, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { commandOf, type Jobs } from "./jobs.ts";
import { codemodeInUse, codemodeLimit, codemodeSlot } from "./ledger.ts";
import type { NestedBarrier } from "./nested.ts";

/** Appended to the built-in description. */
export const CODEMODE_BACKGROUND_LINE =
  "A script still running after 12 seconds continues in the background as a job; see the job tool. Tool calls inside a script never do. When every codemode worker of this process is busy, a new script waits for one as a queued job.";

/** N1: a pending note goes into the script's result (or its handoff) like into any other top-level result. */
function withNote(result: any, note: string | undefined): any {
  if (!note || !result || typeof result !== "object" || !Array.isArray(result.content)) return result;
  return { ...result, content: [...result.content, { type: "text", text: note }] };
}

/**
 * The same definition with `execute` registered as one group of the barrier, under its tool call id: the calls of
 * the script get ids `<id>/<n>` from Pi and find the group by that prefix. Everything else is kept as it is.
 */
export function groupCodemode(definition: ToolDefinition<any, any, any>, nested: NestedBarrier, jobs?: Jobs): ToolDefinition<any, any, any> {
  if (!jobs) {
    return {
      ...definition,
      execute: (id, params, signal, onUpdate, ctx) => nested.group(id, () => definition.execute(id, params, signal, onUpdate, ctx)),
    };
  }
  // The whole script is one job: after 12 s the call returns and the script keeps running under the job's signal.
  return {
    ...definition,
    description: `${definition.description}\n\n${CODEMODE_BACKGROUND_LINE}`,
    // Pi replaces the description at activation with the one its loadout hook builds; append the line there too.
    ...(definition.prepareLoadout ? {
      prepareLoadout: (loadout: any) => {
        const append = (result: any) => {
          const text = result?.descriptions?.[definition.name];
          if (typeof text === "string") result.descriptions[definition.name] = `${text}\n\n${CODEMODE_BACKGROUND_LINE}`;
          return result;
        };
        const result: any = (definition.prepareLoadout as any)(loadout);
        return typeof result?.then === "function" ? result.then(append) : append(result);
      },
    } : {}),
    execute: (id, params, signal, onUpdate, ctx) =>
      jobs.run({ tool: "codemode", command: commandOf("codemode", params), signal, onUpdate, process: true, cwd: ctx?.cwd || process.cwd() }, (job) =>
        nested.group(id, async () => {
          // S1: Pi fails a script that gets no worker within 60 s; here it waits as a queued job for a free slot.
          job.waitingOn(() => [`a free codemode worker (${codemodeInUse()} of ${codemodeLimit()} in use)`]);
          let release: (() => void) | undefined;
          try {
            release = await codemodeSlot(job.signal);
          } catch {
            throw new Error("Operation aborted");
          }
          try {
            await job.begin();
            return await definition.execute(id, params, job.signal, job.onUpdate, ctx);
          } finally {
            release();
            // The effects scan ends before the barrier releases the calls queued behind the script.
            await job.settle();
          }
        }, job.barrier)).then((result: any) => withNote(result, jobs.piggyback())) as any,
  };
}

/**
 * Replaces the built-in `codemode` of this load with the grouped definition. Call it from `session_start`, when the
 * registry is readable. Does nothing when no built-in `codemode` is registered (the user turned `builtin:codemode`
 * off, or excluded the tool) or when this extension already replaced it. Returns whether it replaced it.
 *
 * The definition comes from Pi's own factory, `createCodemodeExtension()`, which the built-in extension also uses
 * with no options, so description, parameters, loadout hook, renderers and the rest are the built-in's. A tool
 * registered by another extension under the same name (a third-party `codemode`) is left alone.
 *
 * The registry keeps the first registration per name, in load order, and Pi loads its built-in extensions after every
 * file and package extension (`resourcePrecedenceRank`: "Built-in extensions load after file and package extensions,
 * whichever scope enables them"), so this registration wins over the built-in one.
 */
export function takeOverBuiltinCodemode(pi: ExtensionAPI, nested: NestedBarrier, jobs?: Jobs): boolean {
  const registered = pi.getAllTools().find((tool) => tool.name === "codemode");
  if (registered?.sourceInfo.source !== "builtin") return false;
  let definition: ToolDefinition<any, any, any> | undefined;
  // The built-in factory only calls `registerTool`; the rest of the API stays the real one for its callbacks.
  const capture = Object.assign(Object.create(pi), {
    registerTool: (tool: ToolDefinition<any, any, any>) => void (definition = tool),
  });
  createCodemodeExtension()(capture);
  if (!definition) return false;
  pi.registerTool(groupCodemode(definition, nested, jobs));
  return true;
}
