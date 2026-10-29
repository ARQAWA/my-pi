import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** The one fixed line the model sees; it never changes, so the cached prompt prefix stays stable. */
export const CHAT_TOOLS_HINT = 'Chat tools for other open Pi chats: list_chats, read_chat, send_message_to_chat. Load them with tool_search query "rqwchat".';
export const CHAT_TOOL_NAMES = ["list_chats", "read_chat", "send_message_to_chat"];

/**
 * With `tool_search` active the three deferred tools are announced by one prompt section and found by their shared
 * search key. Without it nothing could load them, so they are activated directly. Only while the tools are registered.
 */
export function attachVisibility(pi: ExtensionAPI, registered: () => boolean): void {
	pi.on("before_agent_start", (event) => {
		if (!registered()) return;
		const active = pi.getActiveTools();
		if (active.includes("tool_search")) {
			event.systemPromptOptions.sections.chat_tools = CHAT_TOOLS_HINT;
			return;
		}
		const missing = CHAT_TOOL_NAMES.filter(name => !active.includes(name));
		if (missing.length > 0) pi.setActiveTools([...active, ...missing]);
	});
}
