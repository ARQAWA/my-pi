import assert from "node:assert/strict";
import { it } from "node:test";
import { InMemoryCredentialStore, type Credential } from "@earendil-works/pi-ai";

import { AuthRecoveryError, DEVICE_TOKEN_URL, DEVICE_USER_CODE_URL, TOKEN_URL, loginDevice } from "../../../extensions/RQW-codex/auth.ts";
import { resolveStoredCredential } from "../../../extensions/RQW-codex/auth-boundary.ts";

const START = Date.parse("2026-10-22T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const jwt = (payload: Record<string, unknown>) => `${b64({ alg: "none" })}.${b64(payload)}.signature`;
const accessFor = (account: string, expMs: number) => jwt({ exp: Math.floor(expMs / 1000), "https://api.openai.com/auth": { chatgpt_account_id: account } });
const idToken = (fedramp: boolean) => jwt({ "https://api.openai.com/auth": { chatgpt_account_id: "acct-1", chatgpt_account_is_fedramp: fedramp } });

function stored(id?: string): Credential {
	return { type: "oauth", access: accessFor("acct-1", START + 4 * 60_000), refresh: "RT", expires: START + 4 * 60_000, accountId: "acct-1", ...(id ? { id_token: id } : {}) } as Credential;
}

async function storeWith(value: Credential) {
	const store = new InMemoryCredentialStore();
	await store.modify("openai-codex", async () => value);
	return store;
}

it("device login polls, exchanges the code and returns the grant", async () => {
	const calls: string[] = [];
	const sleeps: number[] = [];
	const notices: unknown[] = [];
	const polls = [new Response("{}", { status: 403 }), Response.json({ authorization_code: "A", code_challenge: "C", code_verifier: "V" })];
	const credential = await loginDevice({ notify: (event) => notices.push(event) }, {
		now: () => START,
		sleep: async (ms) => { sleeps.push(ms); },
		fetch: (async (url: string | URL | Request) => {
			const target = String(url);
			calls.push(target);
			if (target === DEVICE_USER_CODE_URL) return Response.json({ device_auth_id: "d", user_code: "U", interval: "2" });
			if (target === DEVICE_TOKEN_URL) return polls.shift()!;
			return Response.json({ access_token: accessFor("acct-1", START + DAY), refresh_token: "RT-1" });
		}) as typeof fetch,
	});
	assert.equal(credential.accountId, "acct-1");
	assert.equal(credential.refresh, "RT-1");
	assert.deepEqual(calls, [DEVICE_USER_CODE_URL, DEVICE_TOKEN_URL, DEVICE_TOKEN_URL, TOKEN_URL]);
	assert.deepEqual(sleeps, [2000]);
	assert.equal(notices.length, 1);
});

it("regression: excluded FedRAMP grants are rejected without replacing ordinary grants", async () => {
	const excluded = stored(idToken(true));
	const store = await storeWith(excluded);
	await assert.rejects(resolveStoredCredential(store, new AbortController().signal, { now: () => START }), (error: unknown) =>
		error instanceof AuthRecoveryError && error.permanent && /FedRAMP/.test(error.message));
	assert.equal(await store.read("openai-codex"), excluded);
	const ordinary = stored(idToken(false));
	assert.equal((await resolveStoredCredential(await storeWith(ordinary), new AbortController().signal, { now: () => START })).credential, ordinary);
});

it("regression: failed proactive refresh returns the still-valid bearer", async () => {
	const value = stored();
	const store = await storeWith(value);
	let fetches = 0;
	const result = await resolveStoredCredential(store, new AbortController().signal, {
		now: () => START,
		fetch: (async () => { fetches++; return new Response("down", { status: 503 }); }) as typeof fetch,
	});
	assert.equal(result.credential, value);
	assert.equal(fetches, 1);
	assert.equal(await store.read("openai-codex"), value);
});
