// Adapted from extensions/RQW-codex/auth-boundary.ts at git commit a85b810e924010f35387045fc0cbbd9a1e7173cc.
// Narrowed extraction: read-only saved-grant validation and one same-owner bearer reload; no refresh or login APIs.
import type { CredentialStore, OAuthCredential } from "@earendil-works/pi-ai";
import { AuthRecoveryError, LOGIN_HELP, PROVIDER_ID, credentialIdentity, needsRefresh, validateCredential } from "./auth.ts";

/** The supplied store is Pi's public read-only credential seam. Never refresh or persist a grant. */
export async function resolveStoredCredential(
	store: CredentialStore,
	signal: AbortSignal,
): Promise<{ credential: OAuthCredential; accountId: string }> {
	signal.throwIfAborted();
	try {
		const credential = validateCredential(await store.read(PROVIDER_ID, { signal }));
		signal.throwIfAborted();
		if (needsRefresh(credential, Date.now())) throw new AuthRecoveryError();
		return { credential, accountId: credentialIdentity(credential) };
	} catch {
		signal.throwIfAborted();
		throw new AuthRecoveryError();
	}
}

/** A changed same-owner access token can be reloaded; an unchanged rejected token needs login in Pi. */
export async function recoverCredential(
	store: CredentialStore,
	rejected: { accountId: string; access: string },
	signal: AbortSignal,
): Promise<OAuthCredential> {
	signal.throwIfAborted();
	const { credential, accountId } = await resolveStoredCredential(store, signal);
	if (accountId !== rejected.accountId) {
		throw new AuthRecoveryError(`${LOGIN_HELP} The saved login belongs to another account; it was not used for this request.`);
	}
	if (credential.access === rejected.access) throw new AuthRecoveryError();
	return credential;
}
