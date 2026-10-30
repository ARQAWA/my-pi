// Dollar-prefixed skill mentions in Pi's editor, using only extension and autocomplete APIs.
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { stripFrontmatter, type ExtensionAPI,
	type SlashCommandInfo } from "@earendil-works/pi-coding-agent";
import { installHost } from "./host.ts";
import {
	fuzzyFilter,
	type AutocompleteItem,
	type AutocompleteProvider,
	type AutocompleteSuggestions,
	type EditorComponent,
	type TUI,
} from "@earendil-works/pi-tui";

const MAX_VISIBLE_ROWS = 4;
const WIDGET_KEY = "rqw-skill-dollar-editor-access";

type Skill = {
	name: string;
	description?: string;
	filePath: string;
	baseDir: string;
};

/**
 * Optional filter, offered on `pi.events` (see FILTER_CHANNEL): returns the skills that may be listed and expanded.
 * `submit` is true when a message is sent and false for each autocomplete request, which must stay cheap.
 */
type SkillFilter = (skills: Skill[], submit?: boolean) => Skill[];
const FILTER_CHANNEL = "rqw-skill-dollar:filter";

function loadedSkills(commands: SlashCommandInfo[]): Skill[] {
	return commands.flatMap(command => command.source === "skill" && command.name.startsWith("skill:")
		? [{
			name: command.name.slice("skill:".length),
			description: command.description,
			filePath: command.sourceInfo.path,
			baseDir: dirname(command.sourceInfo.path),
		}]
		: [])
		.filter(skill => skill.name.length > 0 && !/\s/.test(skill.name));
}

const SKILL_PATH_PREFIX = "skill://";
const skillLink = (skill: Skill) => `[$${skill.name}](${SKILL_PATH_PREFIX}${skill.filePath})`;

function skillToken(textBeforeCursor: string): string | undefined {
	return textBeforeCursor.match(/(?:^|\s)\$([^\s]*)$/)?.[1];
}

function skillProvider(
	current: AutocompleteProvider,
	getSkills: () => Skill[],
	showSkills: (matchCount: number) => void,
	restoreRows: () => void,
): AutocompleteProvider {
	return {
		triggerCharacters: ["$"],

		async getSuggestions(lines, cursorLine, cursorCol, options): Promise<AutocompleteSuggestions | null> {
			const line = lines[cursorLine] ?? "";
			const token = skillToken(line.slice(0, cursorCol));
			if (token === undefined) {
				restoreRows();
				return current.getSuggestions(lines, cursorLine, cursorCol, options);
			}

			const skills = getSkills();
			const items: AutocompleteItem[] = fuzzyFilter(skills, token, skill => skill.name)
				.map(skill => {
					// Same-name skills stay apart: the first of a name keeps `$name`, the others insert a link to their path.
					const shared = skills.filter(other => other.name === skill.name);
					const shadowed = shared[0] !== skill;
					return {
						value: shadowed ? skillLink(skill) : `$${skill.name}`,
						label: `$${skill.name}`,
						description: shared.length > 1 ? `${skill.description ?? ""} (${skill.filePath})`.trim() : skill.description,
					};
				});
			if (items.length === 0) {
				restoreRows();
				return current.getSuggestions(lines, cursorLine, cursorCol, options);
			}
			showSkills(items.length);
			return { items, prefix: `$${token}` };
		},

		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			if (!prefix.startsWith("$") || !/^(\[)?\$/.test(item.value)) {
				return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
			}
			const line = lines[cursorLine] ?? "";
			const before = line.slice(0, cursorCol - prefix.length);
			const after = line.slice(cursorCol).replace(/^\S*/, "");
			const suffix = /^[ \t]/.test(after) ? "" : " ";
			const nextLines = [...lines];
			nextLines[cursorLine] = `${before}${item.value}${suffix}${after}`;
			const result = {
				lines: nextLines,
				cursorLine,
				cursorCol: before.length + item.value.length + suffix.length,
			};
			restoreRows();
			return result;
		},

		shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
			return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
		},
	};
}

type RowEditor = EditorComponent & { getAutocompleteMaxVisible?(): number };

function focusedEditor(tui: TUI | undefined): RowEditor | null | undefined {
	return (tui as (TUI & { getFocusedComponent(): unknown }) | undefined)?.getFocusedComponent() as RowEditor | null | undefined;
}

function skillBlock(skill: Skill): string {
	const content = readFileSync(skill.filePath, "utf-8");
	const body = stripFrontmatter(content).trim();
	return `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
}

/**
 * A plain `$name` or a Codex link `[$name](skill://path)`; the link selects exactly that path. The path may hold
 * one level of balanced parentheses, as in `C:\Program Files (x86)\...`.
 */
const MENTION = /(?:^|\s)(?:\[\$([^\]\s]+)\]\(((?:[^()]|\([^()]*\))*)\)|\$([^\s]+))(?=\s|$)/g;

function expandMentions(text: string, skills: Skill[]): string | undefined {
	// The first skill of a name wins, as in Codex: the list is in its selection order.
	const byName = new Map<string, Skill>();
	for (const skill of skills) if (!byName.has(skill.name)) byName.set(skill.name, skill);
	const blocks: string[] = [];
	const seenPaths = new Set<string>();
	let rest = "";
	let last = 0;
	let found = false;

	for (const match of text.matchAll(MENTION)) {
		const linked = match[2]?.trim();
		const path = linked?.startsWith(SKILL_PATH_PREFIX) ? linked.slice(SKILL_PATH_PREFIX.length) : linked;
		const skill = linked === undefined ? byName.get(match[3]) : skills.find(candidate => candidate.filePath === path);
		if (!skill) continue;
		found = true;
		const end = match.index + match[0].length;
		rest += text.slice(last, match.index + match[0].length - match[0].trimStart().length);
		// Consume one horizontal separator with the mention so prose does not gain a double space.
		last = end + (/^[ \t]/.test(text.slice(end)) ? 1 : 0);
		if (!seenPaths.has(skill.filePath)) {
			seenPaths.add(skill.filePath);
			blocks.push(skillBlock(skill));
		}
	}
	if (!found) return undefined;
	rest += text.slice(last);
	const args = rest.trim();
	return [...blocks, ...(args ? [args] : [])].join("\n\n");
}

export default function skillDollar(pi: ExtensionAPI): void {
	let filter: SkillFilter | undefined;
	// Pi's loaded skills, narrowed by an optional filter (for example skills a Codex config disables).
	const getSkills = (submit = false) => {
		if (!filter) pi.events.emit(FILTER_CHANNEL, { offer(next: SkillFilter) { filter = next; } });
		const loaded = loadedSkills(pi.getCommands());
		return filter ? filter(loaded, submit) : loaded;
	};
	let tui: TUI | undefined;
	let limitedEditor: RowEditor | undefined;
	let previousRows: number | undefined;
	// The card remains active while Pi replaces the session runtime.
	const host = installHost();

	const restoreRows = () => {
		if (limitedEditor && previousRows !== undefined) {
			limitedEditor.setAutocompleteMaxVisible?.(previousRows);
		}
		limitedEditor = undefined;
		previousRows = undefined;
	};
	const showSkills = (matchCount: number) => {
		const editor = focusedEditor(tui);
		if (!editor?.setAutocompleteMaxVisible) {
			restoreRows();
			return;
		}
		if (editor !== limitedEditor) {
			restoreRows();
			limitedEditor = editor;
			previousRows = editor.getAutocompleteMaxVisible?.() ?? 5;
		}
		// SelectList adds one scroll row when matches overflow its item window.
		editor.setAutocompleteMaxVisible(matchCount > MAX_VISIBLE_ROWS ? MAX_VISIBLE_ROWS - 1 : MAX_VISIBLE_ROWS);
	};

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		// A transient zero-row widget exposes the public TUI; removing it leaves no layout or factory change.
		ctx.ui.setWidget(WIDGET_KEY, currentTui => {
			tui = currentTui;
			return { render: () => [], invalidate() {} };
		});
		ctx.ui.setWidget(WIDGET_KEY, undefined);
		ctx.ui.addAutocompleteProvider(current => skillProvider(current, getSkills, showSkills, restoreRows));
	});

	pi.on("session_shutdown", () => {
		restoreRows();
		if (host && !host.seen) host.dispose();
		tui = undefined;
	});
	pi.on("input", event => {
		restoreRows();
		// A mention needs a dollar; skip building the skill catalog for every other message.
		if (event.source !== "interactive" || !event.text.includes("$")) return;
		const text = expandMentions(event.text, getSkills(true));
		return text === undefined ? undefined : { action: "transform", text };
	});
}
