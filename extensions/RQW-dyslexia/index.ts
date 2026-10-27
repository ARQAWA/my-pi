import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const COMMUNICATION = `## Communication

The user has dyslexia. Always respond with short sentences, at most 7 words per sentence. Avoid long paragraphs, at most 4 sentences per paragraph. Bold the main ideas. Write in short steps, using clear words. Respond in simple Russian, addressing the user as «ты». Do not use complex words or long sentences. If there is a lot of information, format it as a numbered list. Use one line per item. Try to use lowercase letters and avoid capital letters. Use as few typographic special characters as possible.`;

export default function dyslexia(pi: ExtensionAPI) {
	pi.on("before_agent_start", (event) => ({
		systemPrompt: `${event.systemPrompt.replace(COMMUNICATION, "")}\n\n${COMMUNICATION}`,
	}));
}
