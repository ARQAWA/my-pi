type AuthModel = {
	provider: string;
	api: string;
	baseUrl: string;
	headers?: Record<string, string | null | undefined>;
};
type AuthOptions = {
	apiKey?: string;
	headers?: Record<string, string | null | undefined>;
};

// Match Pi's classifier before deciding whether a token has a supported form.
export const isOAuth = (key?: string): boolean => key?.includes("sk-ant-oat") === true;

/** Only Anthropic's canonical key path can enter the subscription transport. */
export function assertAnthropicAuthBoundary(model: AuthModel, options?: AuthOptions, sdkCustomHeaders?: string): boolean {
	if (model.provider !== "anthropic") return false;
	const rejectHeader = () => {
		throw new Error("RQW-anthropic: OAuth Authorization headers and other OAuth-bearing headers, including ANTHROPIC_AUTH_TOKEN, are unsupported. Use /login anthropic or ANTHROPIC_OAUTH_TOKEN; request not sent.");
	};
	for (const source of [model.headers, options?.headers]) {
		if (Object.values(source ?? {}).some(value => typeof value === "string" && isOAuth(value))) rejectHeader();
	}
	// The Anthropic SDK reads this process variable independently of Pi's auth resolver.
	if (model.api === "anthropic-messages") {
		for (const line of sdkCustomHeaders?.split("\n") ?? []) {
			const colon = line.indexOf(":");
			if (colon >= 0 && isOAuth(line.substring(colon + 1).trim())) rejectHeader();
		}
	}
	if (!isOAuth(options?.apiKey)) return false;
	if (!/^sk-ant-oat\S+$/.test(options!.apiKey!)) {
		throw new Error("RQW-anthropic: noncanonical OAuth API key is unsupported; request not sent.");
	}
	let official = false;
	try { official = new URL(model.baseUrl).origin === "https://api.anthropic.com"; } catch { /* Reject invalid subscription endpoints without exposing their contents. */ }
	if (!official || model.api !== "anthropic-messages") {
		throw new Error("RQW-anthropic: subscription tokens may only be sent to https://api.anthropic.com using anthropic-messages; request not sent.");
	}
	return true;
}
