import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Credential, CredentialStore } from "@earendil-works/pi-ai";

import { AuthRecoveryError, TOKEN_URL, loginDevice } from "../../../extensions/RQW-codex/auth.ts";
import { recoverCredential, resolveStoredCredential, validateSubscriptionEndpoint } from "../../../extensions/RQW-codex/auth-boundary.ts";

const DAY = 24 * 60 * 60 * 1000;
const START = Date.parse("2026-10-22T12:00:00Z");
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const jwt = (payload: Record<string, unknown>) => `${b64({ alg: "none" })}.${b64(payload)}.signature`;
const accessFor = (account: string, expMs: number, tag = "") =>
	jwt({ exp: Math.floor(expMs / 1000), tag, "https://api.openai.com/auth": { chatgpt_account_id: account } });
const SECRET = "SECRET-rotation-body-9";

/** In-memory CredentialStore with a serialized modify, honouring the wait signal like the file lock. */
class MemoryStore implements CredentialStore {
	value: Credential | undefined;
	modifies = 0;
	private lock: Promise<void> = Promise.resolve();
	constructor(value?: Credential) { this.value = value; }
	async read(): Promise<Credential | undefined> { return this.value; }
	async list() { return []; }
	async delete() { this.value = undefined; }
	modify(providerId: string, fn: (current: Credential | undefined) => Promise<Credential | undefined>, options?: { signal?: AbortSignal }) {
		const run = this.lock.then(async () => {
			options?.signal?.throwIfAborted();
			this.modifies += 1;
			const next = await fn(this.value);
			if (next !== undefined) this.value = next;
			return this.value;
		});
		this.lock = run.then(() => undefined, () => undefined);
		return run;
	}
}

const credential = (access: string, refresh = "RT-OLD"): Credential => ({
	type: "oauth", access, refresh, expires: START + 60_000, accountId: "acct-1", profile: "work",
});

const tokenResponse = (body: unknown, status = 200) => Response.json(body, { status });
const neverFetch = async () => { throw new Error("network forbidden in this test"); };

describe("FedRAMP grant eligibility", () => {
	const idToken = (fedramp: boolean) => jwt({ "https://api.openai.com/auth": { chatgpt_account_id: "acct-1", chatgpt_account_is_fedramp: fedramp } });
	const signal = () => new AbortController().signal;
	const excluded = (error: unknown) => error instanceof AuthRecoveryError && error.permanent && /FedRAMP.*not supported/.test(error.message);

	it("rejects a saved excluded grant without network or mutation and preserves ordinary controls", async () => {
		for (const fedramp of [true, false, undefined]) {
			const stored = { ...credential(accessFor("acct-1", START + DAY)), ...(fedramp !== undefined ? { id_token: idToken(fedramp) } : {}) } as Credential;
			const store = new MemoryStore(stored);
			let fetches = 0;
			const dependencies = { now: () => START, fetch: (async () => { fetches++; throw new Error("network forbidden"); }) as typeof fetch };
			if (fedramp === true) await assert.rejects(resolveStoredCredential(store, signal(), dependencies), excluded);
			else assert.equal((await resolveStoredCredential(store, signal(), dependencies)).credential, stored);
			assert.equal(store.value, stored);
			assert.equal(store.modifies, 0);
			assert.equal(fetches, 0);
		}
		const invalid = { ...credential(accessFor("acct-1", START + DAY)), accountId: "other" } as Credential;
		await assert.rejects(resolveStoredCredential(new MemoryStore(invalid), signal(), { now: () => START }), /does not match/);
	});

	it("rejects an excluded refresh result transactionally while ordinary rotation remains usable", async () => {
		for (const fedramp of [true, false]) {
			const stored = credential(accessFor("acct-1", START - 1000));
			const store = new MemoryStore(stored);
			const dependencies = { now: () => START, fetch: (async () => tokenResponse({ access_token: accessFor("acct-1", START + DAY), refresh_token: "RT-NEW", id_token: idToken(fedramp) })) as typeof fetch };
			if (fedramp) {
				await assert.rejects(resolveStoredCredential(store, signal(), dependencies), excluded);
				assert.equal(store.value, stored);
			} else {
				const result = await resolveStoredCredential(store, signal(), dependencies);
				assert.equal(result.credential.refresh, "RT-NEW");
				assert.equal(store.value, result.credential);
			}
		}
	});

	it("rejects an excluded device grant before it can be saved, allowing the ordinary grant", async () => {
		for (const fedramp of [true, false]) {
			const responses = [tokenResponse({ device_auth_id: "device", user_code: "CODE" }), tokenResponse({ authorization_code: "code", code_challenge: "challenge", code_verifier: "verifier" }), tokenResponse({ access_token: accessFor("acct-1", START + DAY), refresh_token: "RT", id_token: idToken(fedramp) })];
			const pending = loginDevice({ notify: () => {} }, { now: () => START, fetch: (async () => responses.shift()!) as typeof fetch });
			if (fedramp) await assert.rejects(pending, excluded);
			else assert.equal((await pending).accountId, "acct-1");
			assert.equal(responses.length, 0);
		}
	});
});

describe("resolveStoredCredential", () => {
	it("leaves a valid legacy grant untouched without any store write", async () => {
		const stored = { type: "oauth" as const, access: accessFor("acct-1", START + DAY), refresh: "RT", expires: START + DAY, accountId: "acct-1" };
		const store = new MemoryStore(stored);
		const result = await resolveStoredCredential(store, new AbortController().signal, { fetch: neverFetch as typeof fetch, now: () => START });
		assert.equal(result.credential, stored);
		assert.equal(result.accountId, "acct-1");
		assert.equal(store.modifies, 0);
		assert.equal(store.value, stored);
	});

	it("refreshes an expiring grant once under the store lock for concurrent callers", async () => {
		const store = new MemoryStore(credential(accessFor("acct-1", START + 60_000)));
		let fetches = 0;
		const fetch = async () => {
			fetches += 1;
			await new Promise(resolve => setTimeout(resolve, 5));
			return tokenResponse({ access_token: accessFor("acct-1", START + DAY, "new") });
		};
		const signal = new AbortController().signal;
		const [a, b] = await Promise.all([
			resolveStoredCredential(store, signal, { fetch: fetch as typeof globalThis.fetch, now: () => START }),
			resolveStoredCredential(store, signal, { fetch: fetch as typeof globalThis.fetch, now: () => START }),
		]);
		assert.equal(fetches, 1);
		assert.equal(store.modifies, 2);
		assert.equal(a.credential.access, b.credential.access);
		assert.equal(store.value?.type === "oauth" && store.value.profile, "work");
	});

	it("keeps an unexpired bearer after proactive failure, then preserves expiry and 401 recovery ordering", async () => {
		let now = START;
		const stored = credential(accessFor("acct-1", START + 4 * 60_000));
		const store = new MemoryStore(stored);
		let fetches = 0;
		const fetch = async () => {
			fetches += 1;
			if (fetches < 3) return tokenResponse({ error: "temporarily_unavailable" }, 503);
			return tokenResponse({ access_token: accessFor("acct-1", START + DAY, "recovered"), refresh_token: "RT-RECOVERED" });
		};
		const dependencies = { fetch: fetch as typeof globalThis.fetch, now: () => now };
		const signal = new AbortController().signal;

		const proactive = await resolveStoredCredential(store, signal, dependencies);
		assert.equal(proactive.credential, stored, "the still-valid bearer reaches the request");
		assert.equal(store.value, stored, "proactive failure neither rotates nor removes the grant");
		assert.equal(fetches, 1);

		now = START + 4 * 60_000;
		await assert.rejects(resolveStoredCredential(store, signal, dependencies), /Refresh failed \(HTTP 503\)/);
		assert.equal(fetches, 2, "genuine expiry does not use the proactive fallback");
		assert.equal(store.value, stored);

		const rejected = { accountId: "acct-1", access: stored.type === "oauth" ? stored.access : "" };
		const reloaded = await recoverCredential(store, rejected, "reload", signal, dependencies);
		assert.equal(reloaded, stored);
		assert.equal(fetches, 2, "401 reload does not refresh");
		const recovered = await recoverCredential(store, rejected, "refresh", signal, dependencies);
		assert.equal(fetches, 3);
		assert.equal(recovered.access, accessFor("acct-1", START + DAY, "recovered"));
		assert.equal(store.value, recovered, "successful rotation is persisted before recovery returns");
		assert.equal(recovered.type === "oauth" && recovered.refresh, "RT-RECOVERED");
	});

	it("fails for a missing or non-OAuth slot", async () => {
		await assert.rejects(resolveStoredCredential(new MemoryStore(undefined), new AbortController().signal, { now: () => START }), /No saved openai-codex login/);
		await assert.rejects(resolveStoredCredential(new MemoryStore({ type: "api_key", key: "x" }), new AbortController().signal, { now: () => START }), /No saved openai-codex login/);
	});
});

describe("recoverCredential", () => {
	const rejectedA = { accountId: "acct-1", access: accessFor("acct-1", START + DAY) };

	it("never borrows a login of another account after an account switch", async () => {
		const store = new MemoryStore(credential(accessFor("acct-2", START + DAY), "RT-B"));
		store.value = { ...store.value!, accountId: "acct-2" } as Credential;
		let fetches = 0;
		const fetch = async () => { fetches += 1; return tokenResponse({}); };
		await assert.rejects(recoverCredential(store, rejectedA, "refresh", new AbortController().signal, { fetch: fetch as typeof globalThis.fetch, now: () => START }), /another account/);
		assert.equal(fetches, 0);
		assert.equal((store.value as { refresh: string }).refresh, "RT-B");
	});

	it("reload stage returns a changed same-account login without refreshing", async () => {
		const changed = credential(accessFor("acct-1", START + DAY, "changed"), "RT-CHANGED");
		const store = new MemoryStore(changed);
		let fetches = 0;
		const result = await recoverCredential(store, rejectedA, "reload", new AbortController().signal, { fetch: (async () => { fetches += 1; return tokenResponse({}); }) as typeof fetch, now: () => START });
		assert.equal(result, changed);
		assert.equal(fetches, 0);
	});

	it("reload stage returns an unchanged same-account login with zero network and no write; the next refresh stage emits exactly one refresh", async () => {
		const rejected = credential(rejectedA.access, "RT-OLD");
		const store = new MemoryStore(rejected);
		let fetches = 0;
		const fetch = async () => { fetches += 1; return tokenResponse({ access_token: accessFor("acct-1", START + DAY, `fresh-${fetches}`), refresh_token: `RT-NEW-${fetches}` }); };
		const reloaded = await recoverCredential(store, rejectedA, "reload", new AbortController().signal, { fetch: fetch as typeof globalThis.fetch, now: () => START });
		assert.equal(reloaded, rejected);
		assert.equal(reloaded.access, rejectedA.access);
		assert.equal(fetches, 0);
		assert.equal(store.value, rejected);
		const refreshed = await recoverCredential(store, rejectedA, "refresh", new AbortController().signal, { fetch: fetch as typeof globalThis.fetch, now: () => START });
		assert.equal(fetches, 1);
		assert.equal(refreshed.refresh, "RT-NEW-1");
		assert.equal(store.value, refreshed);
		const again = await recoverCredential(store, { accountId: "acct-1", access: refreshed.access }, "refresh", new AbortController().signal, { fetch: fetch as typeof globalThis.fetch, now: () => START });
		assert.equal(fetches, 2);
		assert.equal(again.refresh, "RT-NEW-2");
	});

	it("leaves a wrong grant untouched when the refresh is rejected", async () => {
		const stored = credential(rejectedA.access, "RT-WRONG");
		const store = new MemoryStore(stored);
		const fetch = async () => tokenResponse({ error: { code: "refresh_token_invalidated" }, refresh_token: SECRET }, 401);
		await assert.rejects(recoverCredential(store, rejectedA, "refresh", new AbortController().signal, { fetch: fetch as typeof globalThis.fetch, now: () => START }), (error: Error) => {
			assert.match(error.message, /revoked/);
			assert.equal(error.message.includes(SECRET), false);
			return true;
		});
		assert.equal(store.value, stored);
	});

	it("persists a rotated refresh token even when the access token did not change, then fails", async () => {
		const store = new MemoryStore(credential(rejectedA.access, "RT-OLD"));
		const fetch = async () => tokenResponse({ refresh_token: "RT-ROTATED" });
		await assert.rejects(recoverCredential(store, rejectedA, "refresh", new AbortController().signal, { fetch: fetch as typeof globalThis.fetch, now: () => START }), /did not replace/);
		assert.equal((store.value as { refresh: string }).refresh, "RT-ROTATED");
	});

	it("does not start a refresh for an already aborted caller", async () => {
		const store = new MemoryStore(credential(rejectedA.access));
		const controller = new AbortController();
		controller.abort();
		let fetches = 0;
		await assert.rejects(recoverCredential(store, rejectedA, "refresh", controller.signal, { fetch: (async () => { fetches += 1; return tokenResponse({}); }) as typeof fetch }));
		assert.equal(fetches, 0);
		assert.equal(store.modifies, 0);
	});

	it("preserves a rotation after the caller aborts once the refresh has started", async () => {
		const store = new MemoryStore(credential(rejectedA.access, "RT-OLD"));
		const controller = new AbortController();
		let release!: (response: Response) => void;
		let started!: () => void;
		const startedPromise = new Promise<void>(resolve => { started = resolve; });
		const fetch = () => {
			started();
			return new Promise<Response>(resolve => { release = resolve; });
		};
		const pending = recoverCredential(store, rejectedA, "refresh", controller.signal, { fetch: fetch as typeof fetch, now: () => START });
		await startedPromise;
		controller.abort();
		await assert.rejects(pending, (error: Error) => error.name === "AbortError");
		release(tokenResponse({ access_token: accessFor("acct-1", START + DAY, "late"), refresh_token: "RT-SURVIVES" }));
		for (let i = 0; i < 50 && (store.value as { refresh: string }).refresh !== "RT-SURVIVES"; i++) {
			await new Promise(resolve => setTimeout(resolve, 2));
		}
		assert.equal((store.value as { refresh: string }).refresh, "RT-SURVIVES");
	});

	it("stops waiting for a held store lock on abort and leaves the saved login unchanged", async () => {
		const stored = credential(rejectedA.access, "RT-HELD");
		const store = new MemoryStore(stored);
		// The lock is never granted: the caller must still return promptly on abort.
		store.modify = (() => new Promise<Credential | undefined>(() => undefined)) as typeof store.modify;
		const controller = new AbortController();
		const pending = recoverCredential(store, rejectedA, "refresh", controller.signal, { fetch: neverFetch as typeof fetch, now: () => START });
		controller.abort();
		await assert.rejects(pending, (error: Error) => error.name === "AbortError");
		assert.equal(store.value, stored);
	});
});

describe("validateSubscriptionEndpoint", () => {
	it("accepts only the official chatgpt.com backend paths and returns the Codex responses URL", () => {
		const expected = "https://chatgpt.com/backend-api/codex/responses";
		assert.equal(validateSubscriptionEndpoint("https://chatgpt.com/backend-api"), expected);
		assert.equal(validateSubscriptionEndpoint("https://chatgpt.com/backend-api/codex/responses/"), expected);
		assert.equal(validateSubscriptionEndpoint("https://chatgpt.com/backend-api", { redirect: "error", env: { OPENAI_API_KEY: "" } }), expected);
	});

	it("rejects foreign origins, non-https, credentials, ports, queries and other paths", () => {
		for (const url of [
			"http://chatgpt.com/backend-api",
			"https://api.openai.com/v1",
			"https://chatgpt.com.evil.test/backend-api",
			"https://user:pw@chatgpt.com/backend-api",
			"https://chatgpt.com:8443/backend-api",
			"https://chatgpt.com/backend-api?x=1",
			"https://chatgpt.com/other",
			"not a url",
		]) {
			assert.throws(() => validateSubscriptionEndpoint(url), /Request not sent/, url);
		}
	});

	it("ignores an unrelated ambient OPENAI_API_KEY: it never refuses or becomes a bearer", () => {
		const base = "https://chatgpt.com/backend-api";
		const expected = "https://chatgpt.com/backend-api/codex/responses";
		assert.equal(validateSubscriptionEndpoint(base, { env: { OPENAI_API_KEY: "sk-ambient-poison" } }), expected);
		assert.equal(validateSubscriptionEndpoint(base, { env: { OPENAI_API_KEY: "sk-ambient-poison" }, redirect: "error" }), expected);
	});

	it("rejects followed redirects and explicit API keys", () => {
		const base = "https://chatgpt.com/backend-api";
		assert.throws(() => validateSubscriptionEndpoint(base, { redirect: "follow" }), /redirect/);
		assert.throws(() => validateSubscriptionEndpoint(base, { apiKey: "sk-explicit" }), /API keys/);
		assert.throws(() => validateSubscriptionEndpoint(base, { apiKey: "sk-explicit", env: { OPENAI_API_KEY: "" } }), /API keys/);
	});

	it("uses the token endpoint constant from the native client", () => {
		assert.equal(TOKEN_URL, "https://auth.openai.com/oauth/token");
	});
});
