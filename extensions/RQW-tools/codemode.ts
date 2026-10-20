// Pi's built-in `codemode` as a call of the ordered barrier (see nested.ts and notes/settings-codemode.md).
import { createCodemodeExtension, type ExtensionAPI, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { NestedBarrier } from "./nested.ts";

/** The same definition with `execute` registered as one group of the barrier. Everything else is kept as it is. */
export function groupCodemode(definition: ToolDefinition<any, any, any>, nested: NestedBarrier): ToolDefinition<any, any, any> {
  return {
    ...definition,
    execute: (id, params, signal, onUpdate, ctx) => nested.group(() => definition.execute(id, params, signal, onUpdate, ctx)),
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
export function takeOverBuiltinCodemode(pi: ExtensionAPI, nested: NestedBarrier): boolean {
  const registered = pi.getAllTools().find((tool) => tool.name === "codemode");
  if (registered?.sourceInfo.source !== "builtin") return false;
  let definition: ToolDefinition<any, any, any> | undefined;
  // The built-in factory only calls `registerTool`; the rest of the API stays the real one for its callbacks.
  const capture = Object.assign(Object.create(pi), {
    registerTool: (tool: ToolDefinition<any, any, any>) => void (definition = tool),
  });
  createCodemodeExtension()(capture);
  if (!definition) return false;
  pi.registerTool(groupCodemode(definition, nested));
  return true;
}
