// Adapted from oh-my-pi 18.8.9 (browser/aria/aria-snapshot.ts and browser/tab-worker.ts), MIT; see THIRD-PARTY-NOTICES.md.

const LEGACY_SELECTOR_PREFIXES = ["p-aria/", "p-text/", "p-xpath/", "p-pierce/"] as const;

const SELECTOR_HANDLER_PREFIXES = [
	"aria/",
	"text/",
	"xpath/",
	"pierce/",
	"label/",
	"placeholder/",
	"testid/",
	"alt/",
	"title/",
	"role/",
	"aria-ref=",
	"aria-ref/",
	"ariaref/",
	"p-",
] as const;

const ARIA_REF_PREFIXES = ["aria-ref=", "aria-ref/", "ariaref/"];

/**
 * Playwright-only selector engines/pseudos no backend can parse. Without this guard a
 * selector such as `:has-text(...)` would wait the full timeout and fail opaquely;
 * fail fast instead with a pointer to the supported alternative. Callers skip it for
 * explicit query-handler prefixes (`text/`, `aria/`, ...) whose payload is literal text.
 */
const PLAYWRIGHT_ONLY_SELECTOR_RE =
	/:has-text\(|:text\(|:text-is\(|:text-matches\(|:visible\b|:hidden\b|:nth-match\(|:near\(|:above\(|:below\(|:right-of\(|:left-of\(/;

export function assertSelectorString(selector: unknown): asserts selector is string {
	if (typeof selector === "string") return;
	const kind = selector !== null && typeof selector === "object" ? "an object" : `a ${typeof selector}`;
	throw new Error(`Browser selector must be a string; got ${kind}. Use tab.id(n) or tab.ref(id) for element handles.`);
}

/**
 * Recognize a snapshot-ref selector and return the bare ref id, else null.
 * Accepts `aria-ref=e5`, `aria-ref/e5`, `ariaref/e5`, and bare `e5`/`@e5`: agents copy ids
 * straight out of the snapshot YAML (`[ref=e5]`), so a bare id must act on the ref instead of
 * falling through to a CSS tag selector that can never match.
 */
export function parseAriaRefSelector(selector: string): string | null {
	assertSelectorString(selector);
	const trimmed = selector.trim();
	for (const prefix of ARIA_REF_PREFIXES) {
		if (trimmed.startsWith(prefix)) {
			const id = trimmed.slice(prefix.length).trim();
			return /^e\d+$/.test(id) ? id : null;
		}
	}
	const bare = /^@?(e\d+)$/.exec(trimmed);
	return bare ? bare[1]! : null;
}

export function normalizeSelector(selector: string): string {
	assertSelectorString(selector);
	if (!selector) return selector;
	if (
		!SELECTOR_HANDLER_PREFIXES.some(prefix => selector.startsWith(prefix)) &&
		PLAYWRIGHT_ONLY_SELECTOR_RE.test(selector)
	) {
		throw new Error(
			`Playwright-only selector ${JSON.stringify(selector)} is not supported by the browser tool. ` +
				`Use a puppeteer text selector ("text/Allow all"), an aria selector ("aria/Name"), CSS, or "xpath/...".`,
		);
	}
	if (selector.startsWith("p-") && !LEGACY_SELECTOR_PREFIXES.some(prefix => selector.startsWith(prefix))) {
		throw new Error(
			`Unsupported selector prefix. Use CSS or puppeteer query handlers (aria/, text/, xpath/, pierce/). Got: ${selector}`,
		);
	}
	if (selector.startsWith("p-text/")) return `text/${selector.slice("p-text/".length)}`;
	if (selector.startsWith("p-xpath/")) return `xpath/${selector.slice("p-xpath/".length)}`;
	if (selector.startsWith("p-pierce/")) return `pierce/${selector.slice("p-pierce/".length)}`;
	if (selector.startsWith("p-aria/")) {
		const rest = selector.slice("p-aria/".length);
		const nameMatch = rest.match(/\[\s*name\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\]]+))\s*\]/);
		const name = nameMatch?.[1] ?? nameMatch?.[2] ?? nameMatch?.[3];
		if (name) return `aria/${name.trim()}`;
		return `aria/${rest}`;
	}
	return selector;
}
