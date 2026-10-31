import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CHROME_BUILD = "150.0.7871.24";
let installation: Promise<string> | undefined;

export function systemChrome(): string | undefined {
	const candidates = process.platform === "darwin"
		? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", join(homedir(), "Applications/Google Chrome.app/Contents/MacOS/Google Chrome")]
		: process.platform === "win32"
			? [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA]
				.filter((root): root is string => !!root).map(root => join(root, "Google/Chrome/Application/chrome.exe"))
			: ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
	return candidates.find(path => existsSync(path));
}

export async function executable(deps: { findSystemChrome?: () => string | undefined; loadManager?: () => Promise<typeof import("@puppeteer/browsers")> } = {}): Promise<string> {
	const installed = (deps.findSystemChrome ?? systemChrome)();
	if (installed) return installed;
	if (!installation) {
		installation = (async () => {
			const browsers = await (deps.loadManager ?? (() => import("@puppeteer/browsers")))();
			const platform = browsers.detectBrowserPlatform();
			if (!platform) throw new Error("No supported Chrome download for this platform.");
			const cacheDir = process.platform === "win32"
				? join(process.env.LOCALAPPDATA || homedir(), "my-pi", "browser")
				: join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "my-pi", "browser");
			try {
				const browser = await browsers.install({ browser: browsers.Browser.CHROME, buildId: CHROME_BUILD, cacheDir, platform });
				return browser.executablePath;
			} catch (error) {
				throw new Error(`System Chrome was not found and the Chrome download failed. Check network, proxy and certificates, or set app.path to an allowed browser. ${error instanceof Error ? error.message : String(error)}`, { cause: error });
			}
		})().finally(() => { installation = undefined; });
	}
	return installation;
}
