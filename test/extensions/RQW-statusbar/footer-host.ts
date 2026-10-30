import { InteractiveMode, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { TestContext } from "node:test";
import { tmpdir } from "node:os";

// Bind the real Pi host before exercising a fake external footer and data provider.
export function bindTestHost(t: TestContext, command: unknown) {
	const manager = SessionManager.inMemory(tmpdir());
	const session = {
		settingsManager: SettingsManager.inMemory(), sessionManager: manager, model: undefined, thinkingLevel: "off",
		resourceLoader: { getThemes: () => ({ themes: [] }), getExtensions: () => ({ extensions: [{ commands: new Map([["statusbar", command]]) }] }) },
	};
	const runtime = { session, setBeforeSessionInvalidate() {}, setRebindSession() {} };
	const terminal = { columns: 80, rows: 24, kittyProtocolActive: false, start() {}, stop() {}, write() {}, showCursor() {}, hideCursor() {}, setTitle() {}, setProgress() {}, setProgramStatus() {} };
	const host: any = new InteractiveMode(runtime as never, { terminal: terminal as never, tuiMode: "fullscreen" });
	host.renderSessionItems = () => {};
	host.renderSessionEntries([]);
	t.after(() => { host.stop(); host.themeController.dispose(); host.footerDataProvider.dispose(); host.renderer.stop(); });
}
