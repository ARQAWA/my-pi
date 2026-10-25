import type { Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";
import { readStoredCredential } from "@earendil-works/pi-coding-agent";

const PROVIDER = "openai-codex";

export const READ_ONLY_MESSAGE =
	"rqw-search reads the saved openai-codex login read-only and never refreshes or rewrites it. "
	+ "If the login is missing or about to expire, run /login openai-codex in Pi and retry.";

/**
 * A credential store over Pi's public `readStoredCredential`. It serves only a saved openai-codex OAuth login,
 * so no API key, environment value or other provider can become the bearer. Every write is refused: the CLI never
 * touches the auth file, and an expiring login ends in a clear hint instead of a refresh.
 */
export function createReadOnlyCredentialStore(authPath?: string): CredentialStore {
	const saved = (): Credential | undefined => {
		const stored = readStoredCredential(PROVIDER, authPath);
		return stored?.type === "oauth" ? stored : undefined;
	};
	return {
		async read(providerId, options) {
			options?.signal?.throwIfAborted();
			return providerId === PROVIDER ? saved() : undefined;
		},
		async list(options): Promise<readonly CredentialInfo[]> {
			options?.signal?.throwIfAborted();
			return saved() ? [{ providerId: PROVIDER, type: "oauth" }] : [];
		},
		async modify() {
			throw new Error(READ_ONLY_MESSAGE);
		},
		async delete() {
			throw new Error(READ_ONLY_MESSAGE);
		},
	};
}
