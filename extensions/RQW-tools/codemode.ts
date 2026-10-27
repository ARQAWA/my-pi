import { createCodemodeExtension, type ExtensionAPI, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { commandOf, type Jobs } from "./jobs.ts";

export const CODEMODE_BACKGROUND_LINE =
	"A script still running after 12 seconds continues in the background as a job; see the job tool. Tool calls inside a script never do.";

/** Keep Pi's codemode definition and add only the background-job lifecycle. */
export function groupCodemode(definition: ToolDefinition<any, any, any>, jobs: Jobs): ToolDefinition<any, any, any> {
	return {
		...definition,
		description: `${definition.description}\n\n${CODEMODE_BACKGROUND_LINE}`,
		// Pi replaces the description at activation, so append the line in its loadout hook too.
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
		execute: (id, params, signal, onUpdate, ctx) => jobs.run({
			tool: "codemode",
			command: commandOf("codemode", params),
			signal,
			onUpdate,
			process: true,
		}, (job) => definition.execute(id, params, job.signal, job.onUpdate, ctx)) as any,
	};
}

/** Replace Pi's built-in codemode with the same definition plus background jobs. */
export function takeOverBuiltinCodemode(pi: ExtensionAPI, jobs: Jobs): boolean {
	const registered = pi.getAllTools().find((tool) => tool.name === "codemode");
	if (registered?.sourceInfo.source !== "builtin") return false;
	let definition: ToolDefinition<any, any, any> | undefined;
	const capture = Object.assign(Object.create(pi), {
		registerTool: (tool: ToolDefinition<any, any, any>) => void (definition = tool),
	});
	createCodemodeExtension()(capture);
	if (!definition) return false;
	pi.registerTool(groupCodemode(definition, jobs));
	return true;
}
