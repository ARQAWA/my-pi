// Renders skills as a line inside the user's message card instead of Pi's separate blue block.
// This patches Pi's component prototypes at runtime (not a public API). Any mismatch with the expected shape
// leaves stock rendering untouched.
import {
	getMarkdownTheme,
	keyText,
	SkillInvocationMessageComponent,
	UserMessageComponent,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import { Container, Markdown, visibleWidth } from "@earendil-works/pi-tui";

// Pi parses only the first skill block; further blocks Pi prepended stay raw at the start of the user text.
const LEADING_SKILL = /^<skill name="([^"]+)" location="[^"]+">\n([\s\S]*?)\n<\/skill>(?:\n\n|$)/;
const ZONE_START = "\x1b]133;A\x07";
const ZONE_END = "\x1b]133;B\x07\x1b]133;C\x07";
const PREFIX = "└ skill  ";

type Spacer = { lines: number; setLines(lines: number): void };
type Entry = { name: string; content: string };
type Cached = { rqwLines?: { width: number; expanded: boolean; pad: number; lines: string[] } };
type Skill = Cached & {
	expanded: boolean;
	skillBlock: Entry & { userMessage?: string };
	rqwCard?: Card;
	rqwSpacer?: { spacer: Spacer; lines: number };
};
type Card = Cached & {
	text: string;
	outputPad: number;
	rebuild(): void;
	rqwSkills?: Entry[];
	rqwExpanded?: boolean;
	rqwOriginal?: string;
};

const ACTIVE = Symbol.for("rqw-skill-dollar.card");

export function installSkillCard(getTheme: () => Theme): () => void {
	// A reload or a second instance must not stack wrappers.
	(globalThis as any)[ACTIVE]?.();
	const container = Container.prototype as any;
	const skillProto = SkillInvocationMessageComponent.prototype as any;
	const cardProto = UserMessageComponent.prototype as any;
	if (
		typeof container.addChild !== "function" ||
		typeof skillProto.render !== "function" ||
		typeof skillProto.setExpanded !== "function" ||
		typeof skillProto.invalidate !== "function" ||
		typeof cardProto.render !== "function" ||
		typeof cardProto.invalidate !== "function" ||
		typeof cardProto.rebuild !== "function"
	) return () => {};
	const linked: WeakRef<Skill>[] = [];
	const { addChild } = container;
	const { render: skillRender, setExpanded, invalidate: skillInvalidate } = skillProto;
	const { render: cardRender, invalidate: cardInvalidate } = cardProto;
	const { handleMouse: skillMouse } = skillProto;

	// Rows that follow the card's text: the skills line, and under it the skill texts when expanded. Cached per width.
	const rows = (owner: Cached, skills: Entry[], expanded: boolean, pad: number, width: number): string[] => {
		if (owner.rqwLines?.width !== width || owner.rqwLines.expanded !== expanded || owner.rqwLines.pad !== pad) {
			const theme = getTheme();
			const bg = (text: string) => theme.bg("userMessageBg", text);
			const lines = footer(theme, skills.map(skill => skill.name), pad, width);
			if (expanded) {
				const body = skills.map(skill => `**${skill.name}**\n\n${skill.content}`).join("\n\n");
				lines.push(...new Markdown(body, pad, 0, getMarkdownTheme(), {
					color: text => theme.fg("userMessageText", text),
					bgColor: bg,
				}).render(width), bg(" ".repeat(width)));
			} else {
				lines.push(bg(" ".repeat(width)));
			}
			owner.rqwLines = { width, expanded, pad, lines };
		}
		return owner.rqwLines.lines;
	};

	// Pi adds [Spacer, skill block, Spacer, user message]; link them when the user message arrives.
	const link = (children: unknown[]) => {
		const [candidate, spacer, card] = children.slice(-3) as [unknown, Spacer, Card];
		if (!(candidate instanceof SkillInvocationMessageComponent)) return;
		// Pi's private component fields are accessed by this runtime patch.
		const skill = candidate as unknown as Skill;
		if (!skill.skillBlock.userMessage) return;
		// Check everything before changing anything.
		if (typeof spacer?.setLines !== "function" || typeof spacer.lines !== "number" || typeof card?.text !== "string") return;
		if (typeof skill.skillBlock.name !== "string" || typeof skill.skillBlock.content !== "string") return;
		const skills: Entry[] = [{ name: skill.skillBlock.name, content: skill.skillBlock.content }];
		const original = card.text;
		let rest = original;
		for (let match = LEADING_SKILL.exec(rest); match; match = LEADING_SKILL.exec(rest)) {
			skills.push({ name: match[1], content: match[2] });
			rest = rest.slice(match[0].length);
		}
		const text = rest.trim();
		const height = spacer.lines;
		// The first step that can throw changes nothing visible; later failures undo it.
		spacer.setLines(0);
		try {
			card.text = text;
			card.rebuild();
		} catch (error) {
			spacer.setLines(height);
			card.text = original;
			card.rebuild();
			throw error;
		}
		card.rqwSkills = skills;
		card.rqwOriginal = original;
		card.rqwExpanded = skill.expanded;
		skill.rqwCard = card;
		skill.rqwSpacer = { spacer, lines: height };
		linked.push(new WeakRef(skill));
	};

	container.addChild = function (this: Container, child: unknown) {
		addChild.call(this, child);
		if (child instanceof UserMessageComponent) {
			try { link(this.children); } catch { /* stock rendering */ }
		}
	};
	skillProto.setExpanded = function (this: Skill, expanded: boolean) {
		setExpanded.call(this, expanded);
		if (this.rqwCard) {
			this.rqwCard.rqwExpanded = expanded;
			this.rqwCard.rqwLines = undefined;
		}
	};
	// Linked, the skills live in the user card. A skill without user text becomes its own small card.
	skillProto.render = function (this: Skill, width: number) {
		if (this.rqwCard) return [];
		if (this.skillBlock.userMessage) return skillRender.call(this, width);
		try {
			const pad = (this as any).paddingX ?? 1;
			const blank = getTheme().bg("userMessageBg", " ".repeat(width));
			return [blank, ...rows(this, [this.skillBlock], this.expanded, pad, width)];
		} catch {
			return skillRender.call(this, width);
		}
	};
	skillProto.invalidate = function (this: Skill) {
		this.rqwLines = undefined;
		skillInvalidate.call(this);
	};
	// Ctrl+O is the only way to see the skill text: the skill shown in the card has no click target.
	skillProto.handleMouse = function (this: Skill, event: unknown) {
		return this.rqwCard || !this.skillBlock.userMessage ? undefined : skillMouse?.call(this, event);
	};
	cardProto.invalidate = function (this: Card) {
		this.rqwLines = undefined;
		cardInvalidate.call(this);
	};
	cardProto.render = function (this: Card, width: number) {
		const lines: string[] = cardRender.call(this, width);
		if (!this.rqwSkills) return lines;
		try {
			const extra = rows(this, this.rqwSkills, !!this.rqwExpanded, this.outputPad, width);
			// The text's bottom padding row becomes the skills rows; skills without text get a blank row above them.
			if (lines.length === 0) return [ZONE_START + getTheme().bg("userMessageBg", " ".repeat(width)), ZONE_END + extra[0], ...extra.slice(1)];
			lines.splice(-1, 1, ZONE_END + extra[0], ...extra.slice(1));
		} catch { /* theme not available yet: text only */ }
		return lines;
	};

	const restore = () => {
		delete (globalThis as any)[ACTIVE];
		// Unlink: give every spacer its original height back.
		for (const ref of linked) {
			const skill = ref.deref();
			if (skill?.rqwSpacer) skill.rqwSpacer.spacer.setLines(skill.rqwSpacer.lines);
			const card = skill?.rqwCard;
			if (skill) skill.rqwCard = undefined;
			if (card?.rqwOriginal !== undefined) {
				card.text = card.rqwOriginal;
				card.rqwSkills = undefined;
				card.rebuild();
			}
		}
		container.addChild = addChild;
		skillProto.setExpanded = setExpanded;
		skillProto.render = skillRender;
		skillProto.invalidate = skillInvalidate;
		cardProto.invalidate = cardInvalidate;
		cardProto.render = cardRender;
		skillProto.handleMouse = skillMouse;
	};
	(globalThis as any)[ACTIVE] = restore;
	return restore;
}

// `└ skill  a · b`, expand key at the right of the first row; names wrap onto more rows, none is cut off.
// A narrow row drops the hint first, then the prefix.
function footer(theme: Theme, names: string[], pad: number, width: number): string[] {
	const room = Math.max(1, width - 2 * pad);
	const hint = keyText("app.tools.expand");
	const hintWidth = visibleWidth(hint);
	const lead = room > PREFIX.length ? PREFIX.length : 0;
	const showHint = hintWidth > 0 && room - lead - hintWidth - 1 >= 1 && lead > 0;
	const avail = Math.max(1, room - lead - (showHint ? hintWidth + 1 : 0));
	const groups: string[][] = [[]];
	let used = lead;
	for (const name of names) {
		// A name wider than a row is split across rows, never cut.
		if (visibleWidth(name) > avail) {
			const chunks = [""];
			for (const char of name) {
				if (visibleWidth(chunks.at(-1)! + char) > avail && chunks.at(-1)) chunks.push("");
				chunks[chunks.length - 1] += char;
			}
			for (const chunk of chunks) {
				if (groups.at(-1)!.length) groups.push([chunk]);
				else groups.at(-1)!.push(chunk);
			}
			used = lead + visibleWidth(chunks.at(-1)!);
			continue;
		}
		const group = groups.at(-1)!;
		const add = (group.length ? 3 : 0) + visibleWidth(name);
		// The first row keeps space for the expand key.
		if (group.length && used + add > lead + avail + (groups.length === 1 || !showHint ? 0 : hintWidth + 1)) {
			groups.push([name]);
			used = lead + visibleWidth(name);
		} else {
			group.push(name);
			used += add;
		}
	}
	return groups.map((group, index) => {
		const names = group.map(name => theme.fg("customMessageLabel", name)).join(theme.fg("dim", " · "));
		let body = (index === 0 ? theme.fg("dim", PREFIX.slice(0, lead)) : " ".repeat(lead)) + names;
		const gap = room - visibleWidth(body) - hintWidth;
		if (index === 0 && showHint && gap >= 1) body += " ".repeat(gap) + theme.fg("dim", hint);
		const line = " ".repeat(pad) + body;
		return theme.bg("userMessageBg", line + " ".repeat(Math.max(0, width - visibleWidth(line))));
	});
}
