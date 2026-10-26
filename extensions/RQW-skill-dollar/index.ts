// Dollar-prefixed skill mentions in Pi's editor, using only extension and autocomplete APIs.
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { stripFrontmatter, type ExtensionAPI, type SlashCommandInfo } from "@earendil-works/pi-coding-agent";
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

			const items: AutocompleteItem[] = fuzzyFilter(getSkills(), token, skill => skill.name)
				.map(skill => ({
					value: `$${skill.name}`,
					label: `$${skill.name}`,
					description: skill.description,
				}));
			if (items.length === 0) {
				restoreRows();
				return current.getSuggestions(lines, cursorLine, cursorCol, options);
			}
			showSkills(items.length);
			return { items, prefix: `$${token}` };
		},

		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			if (!prefix.startsWith("$") || !item.value.startsWith("$")) {
				return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
			}
			const line = lines[cursorLine] ?? "";
			const before = line.slice(0, cursorCol - prefix.length);
			const after = line.slice(cursorCol);
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
	return tui?.getFocusedComponent() as RowEditor | null | undefined;
}

function skillBlock(skill: Skill): string {
	const content = readFileSync(skill.filePath, "utf-8");
	const body = stripFrontmatter(content).trim();
	return `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
}

function expandMentions(text: string, skills: Skill[]): string | undefined {
	const byName = new Map(skills.map(skill => [skill.name, skill]));
	const blocks: string[] = [];
	const seenPaths = new Set<string>();
	let rest = "";
	let last = 0;
	let found = false;

	for (const match of text.matchAll(/(?:^|\s)\$([^\s]+)(?=\s|$)/g)) {
		const skill = byName.get(match[1]);
		if (!skill) continue;
		found = true;
		const start = match.index + match[0].indexOf("$");
		const end = start + skill.name.length + 1;
		rest += text.slice(last, start);
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
	const getSkills = () => loadedSkills(pi.getCommands());
	let tui: TUI | undefined;
	let limitedEditor: RowEditor | undefined;
	let previousRows: number | undefined;

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
		tui = undefined;
	});
	pi.on("input", event => {
		restoreRows();
		if (event.source !== "interactive") return;
		const text = expandMentions(event.text, getSkills());
		return text === undefined ? undefined : { action: "transform", text };
	});
}
