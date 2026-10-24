// RQW-agent-ui: result cards for subagents and workers (README.md). Two wirings, both display only:
//  - the custom messages `[<name>#<id>] ...` RQW-agent delivers get the card (Pi message renderers);
//  - the results of a `wait` call of agent / code_writer / shell_runner show one card per delivered result.
// Ctrl+O shows the full answer: expanded cards over tool-ui, original result text standalone. Only per-call public
// renderer state is kept; no subscription, timer, process or session reference survives a switch or /reload.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CARD_TYPES, type CardDetails, createAgentCard } from "./card.ts";
import { createReviewCard } from "./review.ts";
import { WAIT_TOOLS, waitResultRenderer } from "./wait.ts";
import { selfShellWaitRenderers } from "./self.ts";

export default function agentUi(pi: ExtensionAPI): void {
	for (const type of CARD_TYPES) pi.registerMessageRenderer<CardDetails>(type, createAgentCard);
	pi.registerMessageRenderer("review", createReviewCard);
	pi.registerToolRenderer((toolName, next) => {
		const inner = next();
		if (!inner || !(WAIT_TOOLS as readonly string[]).includes(toolName)) return inner;
		if (inner.renderShell === "self") return selfShellWaitRenderers(toolName, inner);
		return { ...inner, renderResult: waitResultRenderer(toolName, inner) };
	});
}
