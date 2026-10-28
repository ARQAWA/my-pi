import type { Model } from "@earendil-works/pi-ai";
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";

export type ChatModel = Model<string>;
export type Step = "up" | "down" | "right" | "left";
/** Draft = the transactional choice shown in the chooser; live Pi state is untouched until Enter. */
export type Draft = { model: ChatModel | undefined; effort: string | undefined };
/** Rules supplied by index.ts (pickerModels, familyOf, levelsFor, nearestLevel), so this file imports nothing back. */
export type PickerSpec = {
	models: ChatModel[];
	family: (model: ChatModel) => number;
	rank: (effort: string) => number;
	levels: (model: ChatModel | undefined) => string[];
	nearest: (model: ChatModel, effort: string) => string | undefined;
};

export const STEP_KEYS: readonly [string, Step][] = [
	["up", "up"], ["down", "down"], ["right", "right"], ["left", "left"],
	["shift+up", "up"], ["shift+down", "down"], ["shift+right", "right"], ["shift+left", "left"],
];
// Pi's own thinking-level theme roles; low stays ordinary and is never bolded.
export const EFFORT_TOKEN: Record<string, ThemeColor> = {
	off: "thinkingOff", minimal: "thinkingMinimal", low: "thinkingLow", medium: "thinkingMedium",
	high: "thinkingHigh", xhigh: "thinkingXhigh", max: "thinkingMax",
};
const WINDOW = 2;
const WIDE = 44;
const MIN_NAME = 4;

export const sameModel = (a: { provider: string; id: string } | undefined, b: { provider: string; id: string } | undefined) =>
	!!a && !!b && a.provider === b.provider && a.id === b.id;

/** One arrow step on the draft. Model: no wrap, effort clamped by the nearest-lower rule. Effort: next supported level. */
export function stepDraft(spec: PickerSpec, draft: Draft, step: Step): Draft {
	if (step === "up" || step === "down") {
		const direction = step === "up" ? 1 : -1;
		const family = draft.model ? spec.family(draft.model) : -1;
		const index = spec.models.findIndex((model) => spec.family(model) === family);
		const next = index < 0 ? (direction > 0 ? 0 : spec.models.length - 1) : Math.max(0, Math.min(spec.models.length - 1, index - direction));
		const model = spec.models[next];
		if (next === index || !model) return draft;
		return { model, effort: spec.nearest(model, draft.effort ?? "off") };
	}
	const levels = spec.levels(draft.model);
	if (!levels.length) return draft;
	const current = spec.rank(draft.effort ?? "off");
	const effort = step === "right"
		? levels.find((level) => spec.rank(level) > current) ?? levels.at(-1)
		: levels.findLast((level) => spec.rank(level) < current) ?? levels[0];
	return { model: draft.model, effort };
}

const sanitize = (text: string) => text.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/gu, " ");
const modelLabel = (model: ChatModel) => {
	const name = sanitize(model.name || model.id || "no-model").replace(/ +/g, " ").trim();
	return name.startsWith("Claude ") ? name.slice(7) : name;
};

export class ModelEffortPicker implements Component {
	private current: Draft;
	private closed = false;
	private readonly spec: PickerSpec;
	private readonly theme: Theme;
	private readonly done: (result: Draft | undefined) => void;
	private readonly tui: { requestRender(force?: boolean): void } | undefined;

	constructor(spec: PickerSpec, initial: Draft, theme: Theme, done: (result: Draft | undefined) => void, tui?: { requestRender(force?: boolean): void }) {
		this.spec = spec;
		this.current = initial;
		this.theme = theme;
		this.done = done;
		this.tui = tui;
	}

	get draft(): Draft { return this.current; }

	/** Used by the owning extension for a repeated shortcut while this dialog is open. */
	step(step: Step): void {
		if (this.closed) return;
		const next = stepDraft(this.spec, this.current, step);
		if (next === this.current) return;
		this.current = next;
		this.tui?.requestRender();
	}

	cancel(): void { this.close(undefined); }

	handleInput(data: string): void {
		if (this.closed) return;
		const step = STEP_KEYS.find(([key]) => matchesKey(data, key as never))?.[1];
		if (step) return this.step(step);
		if (matchesKey(data, "enter")) return this.close(this.current);
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) this.close(undefined);
	}

	invalidate(): void {}

	private close(result: Draft | undefined) {
		if (this.closed) return;
		this.closed = true;
		this.done(result);
	}

	render(width: number): string[] {
		if (width <= 0) return [];
		const theme = this.theme;
		const lines: string[] = [theme.bold(theme.fg("accent", "Model / effort")), ""];
		const models = this.spec.models;
		const { model } = this.current;
		const effort = this.current.effort;
		const index = model ? models.findIndex((candidate) => this.spec.family(candidate) === this.spec.family(model)) : -1;
		const levels = this.spec.levels(model);
		const efforts = this.effortsText(levels, effort);
		// The efforts share the selected row with the name; the name gives way, but never below MIN_NAME columns.
		const effortsWidth = visibleWidth(efforts);
		const required = effortsWidth ? 2 + MIN_NAME + 1 + effortsWidth : 0;
		if (required > width) {
			const message = `Effort needs ${required} columns`;
			const constraint: string[] = [];
			for (let at = 0; at < message.length; at += width) constraint.push(theme.fg("error", message.slice(at, at + width)));
			return constraint;
		}
		const withEfforts = (cell: string) => efforts ? `${cell} ${efforts}` : cell;
		if (!models.length) lines.push(theme.fg("muted", "No authenticated RQW models"));
		else {
			const centre = index < 0 ? -1 : index;
			for (let row = -WINDOW; row <= WINDOW; row++) {
				const at = centre < 0 ? row + WINDOW : centre + row;
				const left = models[at];
				if (!left) { lines.push(""); continue; }
				const selected = row === 0 && centre >= 0;
				if (!selected) {
					lines.push(this.cell(modelLabel(left), width, false, (text) => theme.fg("muted", text)));
					continue;
				}
				// Selected model: bold, in the status bar's model colour (the `text` role).
				const room = Math.max(MIN_NAME, width - 2 - (effortsWidth ? effortsWidth + 1 : 0));
				const name = truncateToWidth(sanitize(modelLabel(left)), room, "…");
				lines.push(withEfforts(`${theme.fg("accent", "› ")}${theme.bold(theme.fg("text", name))}`));
			}
			if (index < 0 && model) lines.push(withEfforts(theme.fg("muted", `Current ${modelLabel(model)} is not in the RQW list`)));
		}
		lines.push(width < WIDE
			? theme.bold("Enter") + theme.fg("dim", " OK · ") + theme.bold("Esc") + theme.fg("dim", " cancel")
			: theme.fg("dim", "↑↓ model · ←→ effort · ") + theme.bold("Enter") + theme.fg("dim", " OK · ") + theme.bold("Esc") + theme.fg("dim", " cancel"));
		return lines.map((line) => truncateToWidth(line, width));
	}

	/** Inactive efforts dim, the active one bold in its thinking-level colour; no marker. */
	private effortsText(levels: string[], active: string | undefined): string {
		const theme = this.theme;
		return levels.map((level) => level === active
			? theme.bold(theme.fg(EFFORT_TOKEN[level] ?? "muted", level))
			: theme.fg("dim", level)).join(" ");
	}

	private cell(text: string, width: number, selected: boolean, style: (text: string, selected: boolean) => string): string {
		const room = Math.max(0, width - 2);
		const plain = truncateToWidth(sanitize(text), room, "…");
		const marker = selected ? this.theme.fg("accent", "› ") : "  ";
		return `${marker}${style(plain, selected)}${" ".repeat(Math.max(0, room - visibleWidth(plain)))}`;
	}

}
