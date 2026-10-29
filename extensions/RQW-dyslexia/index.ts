import type { ContextEvent, ExtensionAPI } from "@earendil-works/pi-coding-agent";

const HEADING = "## Communication";
const BODY = `The user has dyslexia. Always respond with short sentences, at most 7 words per sentence. Avoid long paragraphs, at most 4 sentences per paragraph. Bold the main ideas. Write in short steps, using clear words. Respond in simple Russian, addressing the user as «ты». Do not use complex words or long sentences. If there is a lot of information, format it as a numbered list. Use one line per item. Try to use lowercase letters and avoid capital letters. Use as few typographic special characters as possible.`;
const OVERRIDE = "This rule overrides every other rule about communication: message form, length and style.";

// The owner's rule stays contiguous and byte-identical; the override sentence follows it.
const RULE = `${HEADING}\n\n${BODY}`;
const BLOCK = `${RULE}\n\n${OVERRIDE}`;

export default function dyslexia(pi: ExtensionAPI) {
	pi.on("before_agent_start", (event) => {
		const systemPrompt = event.systemPrompt.replace(`${BLOCK}\n\n`, "").replace(BLOCK, "").replace(RULE, "");
		return systemPrompt !== event.systemPrompt ? { systemPrompt } : undefined;
	});
	pi.on("context", event => ({
		messages: event.messages.flatMap<ContextEvent["messages"][number]>(message => message.role === "user"
			? [message, { role: "custom" as const, customType: "rqw-dyslexia", content: BLOCK, display: false, timestamp: 0 }]
			: [message]),
	}));
}
