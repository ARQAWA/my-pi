// RQW-agent-ui: result cards for subagents (README.md). Two wirings, both display only:
//  - the custom messages `[<name>#<id>] ...` RQW-agent delivers get the card (Pi message renderers);
//  - the results of an agent `wait` call show one card per delivered result;
//  - RQW-agent's `child_wait` notification with delivered results shows the same cards (other `child_wait` stay stock).
// Ctrl+O shows the full answer: expanded cards over tool-ui, original result text standalone. Only per-call public
// renderer state is kept; no subscription, timer, process or session reference survives a switch or /reload.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CARD_TYPES, type CardDetails, createAgentCard } from "./card.ts";
import { createChildWaitCard } from "./child-wait.ts";
import { createReviewCard } from "./review.ts";
import { WAIT_TOOLS, waitResultRenderer } from "./wait.ts";
import { selfShellWaitRenderers } from "./self.ts";

export default function agentUi(pi: ExtensionAPI): void {
	for (const type of CARD_TYPES) pi.registerMessageRenderer<CardDetails>(type, createAgentCard);
	pi.registerMessageRenderer("child_wait", createChildWaitCard);
	pi.registerMessageRenderer("review", createReviewCard);
	pi.registerToolRenderer((toolName, next) => {
		const inner = next();
		if (!inner || !(WAIT_TOOLS as readonly string[]).includes(toolName)) return inner;
		if (inner.renderShell === "self") return selfShellWaitRenderers(toolName, inner);
		return { ...inner, renderResult: waitResultRenderer(toolName, inner) };
	});
}
