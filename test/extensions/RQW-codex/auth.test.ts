import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	CLIENT_ID,
	DEVICE_REDIRECT_URI,
	DEVICE_TOKEN_URL,
	DEVICE_USER_CODE_URL,
	DEVICE_VERIFICATION_URL,
	TOKEN_URL,
	credentialIdentity,
	defaultCodexIdentity,
	loginDevice,
	needsRefresh,
	refreshCredential,
	validateCredential,
} from "../../../extensions/RQW-codex/auth.ts";
import { localPlatform, userAgent } from "../../../extensions/RQW-codex/metadata.ts";

const DAY = 24 * 60 * 60 * 1000;
const START = Date.parse("2026-10-22T12:00:00Z");
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const jwt = (payload: Record<string, unknown>) => `${b64({ alg: "none" })}.${b64(payload)}.signature`;
const accessFor = (account: string, expMs: number) =>
	jwt({ exp: Math.floor(expMs / 1000), "https://api.openai.com/auth": { chatgpt_account_id: account } });
const SECRET = "SECRET-token-body-1234";
const IDENTITY = { originator: "codex_cli_rs", userAgent: "codex_cli_rs/0.163.0 (Darwin 25.0; arm64) fixture" };

type Call = { url: string; init: RequestInit };

function clock() {
	let now = START;
	const sleeps: number[] = [];
	return {
		now: () => now,
		sleeps,
		sleep: async (ms: number) => {
			sleeps.push(ms);
			now += ms;
		},
	};
}

function fakeInteraction() {
	const events: unknown[] = [];
	return {
		events,
		notify: (event: unknown) => events.push(event),
		prompt: () => {
			throw new Error("selector forbidden: device login must not prompt");
		},
	};
}

describe("device login", () => {
	it("notifies device_code directly, polls immediately, sleeps only after 403, exchanges the exact redirect", async () => {
		const log: string[] = [];
		const calls: Call[] = [];
		const polls = [new Response("{}", { status: 403 }), Response.json({ authorization_code: "AUTHCODE", code_challenge: "CH", code_verifier: "VERIFIER" })];
		const interaction = fakeInteraction();
		const time = clock();
		const fetch = async (url: string | URL | Request, init?: RequestInit) => {
			const target = String(url);
			calls.push({ url: target, init: init ?? {} });
			log.push(target);
			if (target === DEVICE_USER_CODE_URL) return Response.json({ device_auth_id: "dev-1", usercode: "ABCD-1234", interval: " 2 " });
			if (target === DEVICE_TOKEN_URL) return polls.shift()!;
			if (target === TOKEN_URL) return Response.json({ access_token: accessFor("acct-1", START + DAY), refresh_token: "RT-1", id_token: "ID-1" });
			throw new Error(`unexpected ${target}`);
		};
		const originalNotify = interaction.notify;
		interaction.notify = (event: unknown) => {
			log.push("notify");
			originalNotify(event);
		};
		const credential = await loginDevice(interaction, { fetch: fetch as typeof globalThis.fetch, now: time.now, sleep: time.sleep });
		assert.deepEqual(interaction.events, [{ type: "device_code", userCode: "ABCD-1234", verificationUri: DEVICE_VERIFICATION_URL, intervalSeconds: 2, expiresInSeconds: 900 }]);
		assert.deepEqual(log, [DEVICE_USER_CODE_URL, "notify", DEVICE_TOKEN_URL, DEVICE_TOKEN_URL, TOKEN_URL]);
		assert.equal(calls.length, 4);
		assert.deepEqual(time.sleeps, [2000]);
		for (const call of calls.slice(0, 3)) {
			assert.deepEqual(Object.keys(call.init.headers as Record<string, string>), ["content-type"], "raw auth client: no Codex headers");
		}
		assert.equal(JSON.parse(String(calls[0]!.init.body)).client_id, CLIENT_ID);
		assert.equal(calls[3]!.url, TOKEN_URL);
		assert.deepEqual(JSON.parse(String(calls[2]!.init.body)), { device_auth_id: "dev-1", user_code: "ABCD-1234" });
		const form = new URLSearchParams(String(calls[3]!.init.body));
		assert.equal(form.get("grant_type"), "authorization_code");
		assert.equal(form.get("code"), "AUTHCODE");
		assert.equal(form.get("code_verifier"), "VERIFIER");
		assert.equal(form.get("redirect_uri"), DEVICE_REDIRECT_URI);
		assert.equal(DEVICE_REDIRECT_URI, "https://auth.openai.com/deviceauth/callback");
		assert.equal(credential.refresh, "RT-1");
		assert.equal(credential.accountId, "acct-1");
		assert.equal(credential.expires, START + DAY);
		assert.equal((credential as Record<string, unknown>).id_token, "ID-1");
	});

	it("absent interval means zero and a non-string interval is rejected", async () => {
		const time = clock();
		const polls = [new Response("{}", { status: 403 }), Response.json({ authorization_code: "A", code_challenge: "C", code_verifier: "V" })];
		const fetch = async (url: string | URL | Request) => {
			const target = String(url);
			if (target === DEVICE_USER_CODE_URL) return Response.json({ device_auth_id: "d", user_code: "U" });
			if (target === DEVICE_TOKEN_URL) return polls.shift()!;
			return Response.json({ access_token: accessFor("acct", START + DAY), refresh_token: "R" });
		};
		await loginDevice(fakeInteraction(), { fetch: fetch as typeof globalThis.fetch, now: time.now, sleep: time.sleep });
		assert.deepEqual(time.sleeps, [0]);
		const numeric = async (url: string | URL | Request) => String(url) === DEVICE_USER_CODE_URL
			? Response.json({ device_auth_id: "d", user_code: "U", interval: 2 })
			: new Response("{}", { status: 500 });
		await assert.rejects(loginDevice(fakeInteraction(), { fetch: numeric as typeof globalThis.fetch, now: time.now, sleep: time.sleep }), /invalid/);
	});

	it("times out after the 15-minute pending budget and saves nothing", async () => {
		const time = clock();
		let polls = 0;
		const fetch = async (url: string | URL | Request) => {
			const target = String(url);
			if (target === DEVICE_USER_CODE_URL) return Response.json({ device_auth_id: "d", user_code: "U", interval: "300" });
			polls += 1;
			return new Response("{}", { status: 403 });
		};
		await assert.rejects(loginDevice(fakeInteraction(), { fetch: fetch as typeof globalThis.fetch, now: time.now, sleep: time.sleep }), /timed out after 15 minutes/);
		assert.equal(polls, 4);
		assert.deepEqual(time.sleeps, [300_000, 300_000, 300_000]);
	});

	it("stops promptly on cancellation and never reaches the token exchange", async () => {
		const time = clock();
		const controller = new AbortController();
		const hits: string[] = [];
		const fetch = async (url: string | URL | Request) => {
			hits.push(String(url));
			if (String(url) === DEVICE_USER_CODE_URL) return Response.json({ device_auth_id: "d", user_code: "U", interval: "5" });
			return new Response("{}", { status: 403 });
		};
		const sleep = async (_ms: number, signal: AbortSignal) => {
			controller.abort();
			signal.throwIfAborted();
		};
		await assert.rejects(loginDevice(fakeInteraction(), { fetch: fetch as typeof globalThis.fetch, now: time.now, sleep, signal: controller.signal }));
		assert.equal(hits.includes(TOKEN_URL), false);
	});

	it("maps a 404 start to a safe message and never echoes response bodies", async () => {
		const time = clock();
		const bodies = [
			async (url: string | URL | Request) => String(url) === DEVICE_USER_CODE_URL ? new Response(`{"error":"${SECRET}"}`, { status: 500 }) : new Response("", { status: 500 }),
			async (url: string | URL | Request) => String(url) === DEVICE_USER_CODE_URL ? new Response(SECRET, { status: 404 }) : new Response("", { status: 500 }),
			async (url: string | URL | Request) => String(url) === DEVICE_USER_CODE_URL
				? Response.json({ device_auth_id: "d", user_code: "U", interval: "0" })
				: new Response(`{"access_token":"${SECRET}"}`, { status: 500 }),
		];
		for (const fetch of bodies) {
			await assert.rejects(loginDevice(fakeInteraction(), { fetch: fetch as typeof globalThis.fetch, now: time.now, sleep: time.sleep }), (error: Error) => {
				assert.equal(error.message.includes(SECRET), false);
				return true;
			});
		}
		const exchange = async (url: string | URL | Request) => {
			const target = String(url);
			if (target === DEVICE_USER_CODE_URL) return Response.json({ device_auth_id: "d", user_code: "U" });
			if (target === DEVICE_TOKEN_URL) return Response.json({ authorization_code: "A", code_challenge: "C", code_verifier: "V" });
			return new Response(`{"error":"${SECRET}","access_token":"${SECRET}"}`, { status: 400 });
		};
		await assert.rejects(loginDevice(fakeInteraction(), { fetch: exchange as typeof globalThis.fetch, now: time.now, sleep: time.sleep }), (error: Error) => {
			assert.equal(error.message.includes(SECRET), false);
			assert.match(error.message, /status 400/);
			return true;
		});
	});
});

describe("refresh grant", () => {
	const legacy = () => ({
		type: "oauth" as const,
		access: accessFor("acct-1", START + 60_000),
		refresh: "RT-OLD",
		expires: START + 60_000,
		accountId: "acct-1",
		profile: "work",
	});

	it("sends the ordered JSON body with Codex identity headers and redirect errors", async () => {
		const calls: Call[] = [];
		const fetch = async (url: string | URL | Request, init?: RequestInit) => {
			calls.push({ url: String(url), init: init ?? {} });
			return Response.json({ access_token: accessFor("acct-1", START + DAY) });
		};
		await refreshCredential(legacy(), new AbortController().signal, fetch as typeof globalThis.fetch, { identity: IDENTITY, now: () => START });
		assert.equal(calls.length, 1);
		assert.equal(calls[0]!.url, TOKEN_URL);
		assert.equal(calls[0]!.init.method, "POST");
		assert.equal(calls[0]!.init.redirect, "error");
		assert.equal(calls[0]!.init.body, `{"client_id":"${CLIENT_ID}","grant_type":"refresh_token","refresh_token":"RT-OLD"}`);
		const headers = calls[0]!.init.headers as Record<string, string>;
		assert.equal(headers.originator, "codex_cli_rs");
		assert.equal(headers["user-agent"], IDENTITY.userAgent);
	});

	it("keeps omitted fields and unrelated fields, and derives expiry from the JWT exp", async () => {
		const fetch = async () => Response.json({ access_token: accessFor("acct-1", START + DAY) });
		const next = await refreshCredential(legacy(), new AbortController().signal, fetch as typeof globalThis.fetch, { identity: IDENTITY, now: () => START });
		assert.equal(next.refresh, "RT-OLD");
		assert.equal(next.profile, "work");
		assert.equal(next.accountId, "acct-1");
		assert.equal(next.expires, START + DAY);
		assert.equal(next.last_refresh, START);
		assert.equal("id_token" in next, false);
	});

	it("records a rotated refresh token and id_token when returned", async () => {
		const fetch = async () => Response.json({ access_token: accessFor("acct-1", START + DAY), refresh_token: "RT-NEW", id_token: "ID-2" });
		const next = await refreshCredential(legacy(), new AbortController().signal, fetch as typeof globalThis.fetch, { identity: IDENTITY, now: () => START });
		assert.equal(next.refresh, "RT-NEW");
		assert.equal((next as Record<string, unknown>).id_token, "ID-2");
	});

	it("uses 8 days from last refresh when the new access token has no exp", async () => {
		const fetch = async () => Response.json({ access_token: jwt({ "https://api.openai.com/auth": { chatgpt_account_id: "acct-1" } }) });
		const next = await refreshCredential(legacy(), new AbortController().signal, fetch as typeof globalThis.fetch, { identity: IDENTITY, now: () => START });
		assert.equal(next.expires, START + 8 * DAY);
	});

	it("rejects a token of another account without changing the input", async () => {
		const input = legacy();
		const before = JSON.stringify(input);
		const fetch = async () => Response.json({ access_token: accessFor("acct-OTHER", START + DAY) });
		await assert.rejects(refreshCredential(input, new AbortController().signal, fetch as typeof globalThis.fetch, { identity: IDENTITY, now: () => START }), /saved account/);
		assert.equal(JSON.stringify(input), before);
	});

	it("reports known refresh codes with fixed text and never echoes bodies", async () => {
		const fetch = async () => Response.json({ error: { code: "refresh_token_reused" }, access_token: SECRET, refresh_token: SECRET }, { status: 400 });
		await assert.rejects(refreshCredential(legacy(), new AbortController().signal, fetch as typeof globalThis.fetch, { identity: IDENTITY }), (error: Error) => {
			assert.match(error.message, /already used/);
			assert.equal(error.message.includes(SECRET), false);
			return true;
		});
	});

	it("makes exactly one attempt on server errors and marks them transient", async () => {
		let attempts = 0;
		const fetch = async () => {
			attempts += 1;
			return new Response(SECRET, { status: 503 });
		};
		await assert.rejects(refreshCredential(legacy(), new AbortController().signal, fetch as typeof globalThis.fetch, { identity: IDENTITY }), (error: Error) => {
			assert.match(error.message, /503/);
			assert.equal(error.message.includes(SECRET), false);
			return true;
		});
		assert.equal(attempts, 1);
	});
});

describe("refresh identity", () => {
	const opaqueLegacy = () => ({
		type: "oauth" as const,
		access: "opaque-old",
		refresh: "RT-OLD",
		expires: START + 60_000,
		accountId: "acct-1",
		profile: "work",
	});

	it("opaque access refresh keeps the same owner, and an opaque returned access keeps the saved account", async () => {
		const fetch = async () => Response.json({ access_token: "opaque-new", refresh_token: "RT-NEW" });
		const next = await refreshCredential(opaqueLegacy(), new AbortController().signal, fetch as typeof globalThis.fetch, { identity: IDENTITY, now: () => START });
		assert.equal(next.access, "opaque-new");
		assert.equal(next.accountId, "acct-1");
		assert.equal(next.profile, "work");
		assert.equal(next.expires, START + 8 * DAY);
	});

	it("explicit mismatched JWT account fails even when the saved grant is opaque", async () => {
		const fetch = async () => Response.json({ access_token: accessFor("acct-OTHER", START + DAY) });
		await assert.rejects(refreshCredential(opaqueLegacy(), new AbortController().signal, fetch as typeof globalThis.fetch, { identity: IDENTITY, now: () => START }), /saved account/);
	});

	it("sends the refresh with redirect error and the identity user agent from the native helper", async () => {
		let init: RequestInit | undefined;
		const fetch = async (_url: string | URL | Request, value?: RequestInit) => {
			init = value;
			return Response.json({ access_token: "opaque-new" });
		};
		await refreshCredential(opaqueLegacy(), new AbortController().signal, fetch as typeof globalThis.fetch, { now: () => START });
		assert.equal(init?.redirect, "error");
		assert.equal((init?.headers as Record<string, string>)["user-agent"], defaultCodexIdentity().userAgent);
	});
});

describe("default identity", () => {
	it("uses the native metadata helper for the pinned OS fixture", () => {
		assert.equal(userAgent({ osType: "Mac OS", osVersion: "15.5.0", arch: "arm64", terminal: "iTerm.app/3.5" }),
			"codex_cli_rs/0.163.0 (Mac OS 15.5.0; arm64) iTerm.app/3.5");
		const identity = defaultCodexIdentity();
		assert.equal(identity.originator, "codex_cli_rs");
		assert.equal(identity.userAgent, userAgent(localPlatform()));
		assert.match(identity.userAgent, /^codex_cli_rs\/0\.163\.0 \(/);
	});
});

describe("device grant identity", () => {
	const idToken = (account: string) => jwt({ "https://api.openai.com/auth": { chatgpt_account_id: account } });
	const deviceFetch = (tokens: Record<string, unknown>) => async (url: string | URL | Request) => {
		const target = String(url);
		if (target === DEVICE_USER_CODE_URL) return Response.json({ device_auth_id: "d", user_code: "U" });
		if (target === DEVICE_TOKEN_URL) return Response.json({ authorization_code: "A", code_challenge: "C", code_verifier: "V" });
		return Response.json(tokens);
	};

	it("takes the account from the id_token claim when the access token is opaque", async () => {
		const time = clock();
		const credential = await loginDevice(fakeInteraction(), { fetch: deviceFetch({ access_token: "opaque", refresh_token: "RT", id_token: idToken("acct-id") }) as typeof globalThis.fetch, now: time.now, sleep: time.sleep });
		assert.equal(credential.accountId, "acct-id");
		assert.equal(credential.expires, START + 8 * DAY);
	});

	it("falls back to the access token claim when the id_token has no claim", async () => {
		const time = clock();
		const credential = await loginDevice(fakeInteraction(), { fetch: deviceFetch({ access_token: accessFor("acct-at", START + DAY), refresh_token: "RT", id_token: jwt({ sub: "x" }) }) as typeof globalThis.fetch, now: time.now, sleep: time.sleep });
		assert.equal(credential.accountId, "acct-at");
	});

	it("never invents an account: no claim anywhere is rejected", async () => {
		const time = clock();
		await assert.rejects(loginDevice(fakeInteraction(), { fetch: deviceFetch({ access_token: "opaque", refresh_token: "RT" }) as typeof globalThis.fetch, now: time.now, sleep: time.sleep }), /no account identity/);
	});

	it("rejects id_token and access token claims that name different accounts", async () => {
		const time = clock();
		await assert.rejects(loginDevice(fakeInteraction(), { fetch: deviceFetch({ access_token: accessFor("acct-a", START + DAY), refresh_token: "RT", id_token: idToken("acct-b") }) as typeof globalThis.fetch, now: time.now, sleep: time.sleep }), /different accounts/);
	});

	it("device start and poll use redirect error and sanitized status-only failures", async () => {
		const time = clock();
		const inits: RequestInit[] = [];
		const fetch = async (url: string | URL | Request, init?: RequestInit) => {
			inits.push(init ?? {});
			if (String(url) === DEVICE_USER_CODE_URL) return Response.json({ device_auth_id: "d", user_code: "U" });
			return new Response(SECRET, { status: 302 });
		};
		await assert.rejects(loginDevice(fakeInteraction(), { fetch: fetch as typeof globalThis.fetch, now: time.now, sleep: time.sleep }), (error: Error) => {
			assert.match(error.message, /status 302/);
			assert.equal(error.message.includes(SECRET), false);
			return true;
		});
		assert.equal(inits.length, 2);
		for (const init of inits) assert.equal(init.redirect, "error");
	});
});

describe("credential validation", () => {
	it("returns a valid legacy grant as the same object, untouched", () => {
		const value = { type: "oauth", access: accessFor("acct-1", START + DAY), refresh: "RT", expires: START + DAY, accountId: "acct-1", extra: { kept: true } };
		const snapshot = structuredClone(value);
		assert.equal(validateCredential(value), value);
		assert.deepEqual(value, snapshot);
	});

	it("rejects a stored accountId that disagrees with the JWT claim", () => {
		const value = { type: "oauth", access: accessFor("acct-1", START + DAY), refresh: "RT", expires: START + DAY, accountId: "acct-2" };
		assert.throws(() => validateCredential(value), /does not match the access token/);
		assert.throws(() => credentialIdentity(value), /does not match/);
	});

	it("keeps an opaque legacy grant with a saved accountId unchanged, without JWT exp fallback", () => {
		const value = { type: "oauth", access: "opaque-bearer", refresh: "RT", expires: START + DAY, accountId: "acct-1", profile: "work" };
		const snapshot = structuredClone(value);
		assert.equal(validateCredential(value), value);
		assert.deepEqual(value, snapshot);
		assert.equal(credentialIdentity(value), "acct-1");
		assert.equal(needsRefresh({ ...value, last_refresh: START - DAY } as never, START), false);
	});

	it("keeps a JWT without an account claim when a saved accountId exists", () => {
		const value = { type: "oauth", access: jwt({ exp: Math.floor((START + DAY) / 1000) }), refresh: "RT", expires: START + DAY, accountId: "acct-1" };
		assert.equal(validateCredential(value), value);
		assert.equal(credentialIdentity(value), "acct-1");
	});

	it("rejects a grant with no account identity, a non-oauth grant, or an unparseable access token without identity", () => {
		assert.throws(() => validateCredential({ type: "oauth", access: "opaque", refresh: "RT", expires: START }), /no account identity/);
		assert.throws(() => validateCredential({ type: "oauth", access: jwt({ exp: 1 }), refresh: "RT", expires: START }), /no account identity/);
		assert.throws(() => validateCredential({ type: "api_key", key: "x" }));
	});

	it("JWT account claim disagreement fails when the claim is present", () => {
		const value = { type: "oauth", access: accessFor("acct-1", START + DAY), refresh: "RT", expires: START + DAY, accountId: "acct-2" };
		assert.throws(() => validateCredential(value), /does not match the access token/);
	});

	it("identity comes from the JWT claim when present, else the stored accountId", () => {
		assert.equal(credentialIdentity({ access: accessFor("acct-1", START + DAY), accountId: "acct-1" }), "acct-1");
		assert.equal(credentialIdentity({ access: jwt({ exp: 1 }), accountId: "stored" }), "stored");
	});

	it("without a usable exp, a missing last_refresh never triggers a proactive refresh", () => {
		const base = { type: "oauth" as const, refresh: "RT", expires: 0, accountId: "a" };
		assert.equal(needsRefresh({ ...base, access: "opaque" }, START), false);
		assert.equal(needsRefresh({ ...base, access: jwt({ exp: "soon" }) }, START), false);
		assert.equal(needsRefresh({ ...base, access: "opaque", last_refresh: START - 9 * DAY }, START), true);
	});

	it("applies the native proactive rule: exp within 5 minutes, or 8 days since last refresh without exp", () => {
		const base = { type: "oauth" as const, refresh: "RT", expires: 0 };
		assert.equal(needsRefresh({ ...base, access: accessFor("a", START + 4 * 60_000) }, START), true);
		assert.equal(needsRefresh({ ...base, access: accessFor("a", START + 10 * 60_000) }, START), false);
		const noExp = jwt({ "https://api.openai.com/auth": { chatgpt_account_id: "a" } });
		assert.equal(needsRefresh({ ...base, access: noExp, last_refresh: START - 9 * DAY }, START), true);
		assert.equal(needsRefresh({ ...base, access: noExp, last_refresh: START - 7 * DAY }, START), false);
	});
});
