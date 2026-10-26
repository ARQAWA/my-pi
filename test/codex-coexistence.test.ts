import assert from "node:assert/strict";
import { AgentSession } from "@earendil-works/pi-coding-agent";
import { it } from "node:test";
import { installLifecycle as installAnthropic } from "../extensions/RQW-anthropic/lifecycle.ts";
import { installLifecycle as installCodex, SESSION_BIND } from "../extensions/RQW-codex/lifecycle.ts";
import { CODEX_RETRY_OWNED_DIAGNOSTIC } from "../extensions/RQW-codex/retry.ts";

type Handler = (event: unknown, ctx: unknown) => void;
const ownedError = { role: "assistant", stopReason: "error", provider: "openai-codex", api: "openai-codex-responses",
	diagnostics: [{ type: CODEX_RETRY_OWNED_DIAGNOSTIC }] };

function fakeSession(modelRuntime: object) {
	return {
		modelRuntime,
		sessionId: "session",
		resourceLoader: { getExtensions: () => ({ extensions: [] }) },
		extensionRunner: { createContext: () => ({}) },
		agent: { streamFunction: async () => { throw new Error("unused"); } },
		subscribe: () => () => undefined,
		_isRetryableError: () => true,
		dispose: () => undefined,
	} as unknown as AgentSession;
}

it("releasing Anthropic preserves Codex retry policy for a same-runtime child", () => {
	const prototype = AgentSession.prototype as unknown as Record<string, unknown>;
	const native = Object.getOwnPropertyDescriptor(prototype, "_bindExtensionCore")!;
	Object.defineProperty(prototype, "_bindExtensionCore", { ...native, value: function () { return "native"; } });
	const handlers = new Map<string, Handler[]>();
	const pi = { on(name: string, handler: Handler) { handlers.set(name, [...(handlers.get(name) ?? []), handler]); } };
	const anthropic = installAnthropic(() => undefined);
	const codex = installCodex(pi as never, () => ({}));
	const runtime = {};
	const main = fakeSession(runtime);
	const child = fakeSession(runtime);
	try {
		for (const handler of handlers.get(SESSION_BIND) ?? []) handler({ session: main }, {});
		anthropic.bindSession({}, main);
		assert.equal((main as any)._isRetryableError(ownedError), false);
		anthropic.release();
		(prototype._bindExtensionCore as Function).call(child, undefined);
		assert.equal((child as any)._isRetryableError(ownedError), false);
		codex.release();
		assert.equal((child as any)._isRetryableError(ownedError), true);
	} finally {
		codex.release();
		anthropic.release();
		Object.defineProperty(prototype, "_bindExtensionCore", native);
	}
});
