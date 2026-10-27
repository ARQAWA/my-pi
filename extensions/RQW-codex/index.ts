// RQW-codex stage 3 entrypoint: the owned Codex extension as Pi loads it.
// Wires the installation id (extension-owned file under getAgentDir()), the per-session controller (session.ts) and the
// request-local direct transport (transport.ts) into registerCodex (registration.ts). Production defaults use the real
// transport; tests inject installationId and dependencies through createCodexExtension only.
// Imports: this folder, Pi SDK types/runtime and npm packages only.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CredentialStore } from "@earendil-works/pi-ai";
import { getAgentDir, VERSION, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { uuidv7 } from "./compaction.ts";
import { newInstallationId } from "./metadata.ts";
import { registerCodex, type CreateControllerOptions, type DirectTransport } from "./registration.ts";
import { createSessionController, type SessionDependencies } from "./session.ts";
import { CodexThreadTransport, type CodexStreamOptions } from "./transport.ts";

/** Name of the extension-owned installation id file inside the agent directory. */
export const INSTALLATION_ID_FILE = "rqw-codex-installation-id";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type CodexExtensionOptions = {
	installationId?: string;
	dependencies?: SessionDependencies;
	/** Pi version to check; defaults to the loaded Pi. Tests use it to prove the refusal happens before any file is written. */
	piVersion?: string;
	/** Agent directory of the installation id file; defaults to Pi's agent directory. */
	agentDir?: string;
};

/** Exact Pi 1.4.0 guard, run before anything is read or written. */
export function assertSupportedPi(version: string): void {
	if (version !== "1.4.0") throw new Error(`RQW-codex: incompatible Pi ${version}; requires Pi 1.4.0. Nothing was written or registered.`);
}

/**
 * Reads the stable UUIDv4 installation id from `<agentDir>/rqw-codex-installation-id`, creating it when absent.
 * Creation is an exclusive write with mode 0600. A valid stored id is preserved; an invalid one throws and is never overwritten.
 */
export function resolveInstallationId(agentDir: string = getAgentDir()): string {
	const path = join(agentDir, INSTALLATION_ID_FILE);
	let text: string;
	try {
		text = readFileSync(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		mkdirSync(agentDir, { recursive: true });
		const created = newInstallationId();
		try {
			writeFileSync(path, created, { flag: "wx", mode: 0o600 });
			return created;
		} catch (writeError) {
			if ((writeError as NodeJS.ErrnoException).code !== "EEXIST") throw writeError;
			text = readFileSync(path, "utf8");
		}
	}
	const id = text.trim();
	if (!UUID_V4.test(id)) throw new Error(`RQW-codex: installation id file ${path} does not hold a valid UUIDv4. It was not overwritten.`);
	return id;
}

/**
 * Builds the Pi extension factory. The installation id is resolved at load time (not at import), so importing this
 * module never touches the agent directory.
 */
export function createCodexExtension(options: CodexExtensionOptions = {}): (pi: ExtensionAPI) => void {
	return (pi: ExtensionAPI) => {
		assertSupportedPi(options.piVersion ?? VERSION);
		const installationId = options.installationId ?? resolveInstallationId(options.agentDir);
		const dependencies: SessionDependencies = options.dependencies ?? {};
		// The credential store captured from the last bound session; used only by sessionless direct requests.
		let boundStore: CredentialStore | undefined;
		const release = registerCodex(pi, {
			installationId,
			createController: (created: CreateControllerOptions) => {
				if (boundStore !== undefined && created.store !== boundStore) {
					throw new Error("RQW-codex: sessions are bound to more than one credential store; the direct transport cannot follow. Session not bound.");
				}
				boundStore = created.store;
				return createSessionController({ ...created, dependencies });
			},
			createDirectTransport: (): DirectTransport => {
				const store = boundStore;
				if (store === undefined) throw new Error("RQW-codex: no bound credential store for a request without a session id. Request not sent.");
				return {
					stream(model, context, streamOptions?: CodexStreamOptions) {
						const threadId = uuidv7();
						// Request-local: a fresh thread, root and window; the transport is disposed when its stream settles.
						// Native shape (oracle capture): window id is `${thread}:0`, window number 0, and the bare UUIDv7 is the separate context window id.
						const transport = new CodexThreadTransport({
							identity: { installationId, windowId: `${threadId}:0`, windowNumber: 0, contextWindowId: uuidv7(), rootSessionId: threadId, threadId },
							store,
							dependencies,
						});
						const stream = transport.stream(model, context, streamOptions);
						const dispose = () => transport.dispose();
						void stream.result().then(dispose, dispose);
						return stream;
					},
				};
			},
		});
		pi.on("session_shutdown", () => release());
	};
}

/** Pi entrypoint with production defaults (real transport, installation id under the agent directory). */
export default function rqwCodex(pi: ExtensionAPI): void {
	createCodexExtension()(pi);
}
