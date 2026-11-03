// True when NO_PROXY names the target: a host or parent domain, with an optional port ("*" names everything; a leading
// dot or "*." is ignored).
function bypassesProxy(target: URL, noProxy: string | undefined): boolean {
	const port = target.port || "443";
	for (const item of (noProxy ?? "").split(",")) {
		const [, name = "", entryPort] = /^(.*?)(?::(\d+))?$/.exec(item.trim().toLowerCase()) ?? [];
		const host = name.replace(/^\*?\./, "");
		if (host === "*") return true;
		if (entryPort && entryPort !== port) continue;
		if (host && (target.hostname === host || target.hostname.endsWith(`.${host}`))) return true;
	}
	return false;
}

// Proxy URL for a secure target (wss, or https that ws upgrades) from the variables Pi's tab gets (PCLI exports
// HTTPS_PROXY, HTTP_PROXY, ALL_PROXY, NO_PROXY).
function proxyFromEnv(target: URL, env: NodeJS.ProcessEnv): string | undefined {
	if ((target.protocol !== "wss:" && target.protocol !== "https:") || bypassesProxy(target, env.NO_PROXY || env.no_proxy)) return undefined;
	return env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy || env.ALL_PROXY || env.all_proxy || undefined;
}

export { bypassesProxy, proxyFromEnv };
