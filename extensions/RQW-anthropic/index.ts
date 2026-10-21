import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CredentialStore, OAuthCredential } from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { getAgentDir, VERSION, type ExtensionAPI, type ProviderConfig } from "@earendil-works/pi-coding-agent";
import { LOGIN_HELP, refreshCredential, validateCredential } from "./auth.ts";
import { createOverlay } from "./transport.ts";
import { installVisibility, BIND_STORE } from "./visibility.ts";
import { versionState } from "./wire.ts";

export default function anthropic(pi: ExtensionAPI) {
	if (VERSION !== "1.3.0") throw new Error("RQW-anthropic requires Pi 1.3.0; nothing was changed");
	const base = builtinProviders().find(provider => provider.id === "anthropic");
	if (!base?.auth.oauth) throw new Error("RQW-anthropic: Pi's built-in Anthropic OAuth provider is missing");
	const version = versionState();
	const dir = getAgentDir();
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	const idPath = join(dir, "rqw-anthropic-install-id");
	try { writeFileSync(idPath, randomBytes(32).toString("hex"), { flag: "wx", mode: 0o600 }); }
	catch (error) { if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error; }
	const installId = readFileSync(idPath, "utf8");
	if (!/^[a-f0-9]{64}$/.test(installId)) throw new Error("RQW-anthropic: invalid rqw-anthropic-install-id; request not sent");
	const deviceId = createHash("sha256").update(`omp-claude-device-id-v1:${installId}`).digest("hex");
	let store: CredentialStore | undefined;
	const overlay = createOverlay(base, () => store, deviceId, version);
	Object.assign(overlay.streamSimple, { [BIND_STORE]: (credentials: CredentialStore) => { store = credentials; } });
	const release = installVisibility();
	try {
		pi.registerProvider("anthropic", {
			...overlay,
			oauth: {
				name: "Anthropic (Claude Pro/Max)", isSubscription: true,
				async login(callbacks) {
					try {
						const result = await base.auth.oauth!.login({
							signal: callbacks.signal ?? new AbortController().signal,
							notify(event) {
								if (event.type === "auth_url") callbacks.onAuth(event);
								else if (event.type === "progress" || event.type === "info") callbacks.onProgress?.(event.message);
							},
							prompt(prompt) {
								if (prompt.type === "select" && callbacks.onSelect) return callbacks.onSelect(prompt);
								if (prompt.type === "manual_code" && callbacks.onManualCodeInput) return callbacks.onManualCodeInput();
								return callbacks.onPrompt({ message: prompt.message, placeholder: "placeholder" in prompt ? prompt.placeholder : undefined });
							},
						});
						return validateCredential(result);
					} catch {
						callbacks.signal?.throwIfAborted();
						throw new Error("RQW-anthropic: login failed or was cancelled. Retry /login anthropic. Existing credentials were not changed.");
					}
				},
				refreshToken: (credential, signal) => refreshCredential({ ...credential, type: "oauth" } as OAuthCredential,
					signal ?? AbortSignal.timeout(15_000)),
				getApiKey: credential => credential.access,
			},
		} as ProviderConfig);
		pi.on("session_start", (_event, ctx) => {
			if (!store || ctx.modelRegistry.getRegisteredProviderConfig("anthropic")?.streamSimple !== overlay.streamSimple) {
				if (ctx.modelRegistry.getRegisteredProviderConfig("anthropic")?.streamSimple === overlay.streamSimple) pi.unregisterProvider("anthropic");
				release();
				store = undefined;
				throw new Error(`${LOGIN_HELP} Adapter registration is unavailable.`);
			}
		});
		pi.on("session_shutdown", (_event, ctx) => {
			try {
				// Shutdown also runs after an SDK reload that emitted no session_start.
				if (ctx.modelRegistry.getRegisteredProviderConfig("anthropic")?.streamSimple === overlay.streamSimple) pi.unregisterProvider("anthropic");
			} finally { release(); store = undefined; }
		});
	} catch (error) { release(); throw error; }
}
