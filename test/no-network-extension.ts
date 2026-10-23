// Test-only root guard for the compiled pi.exe (RQW_CODEX_EXE): the binary cannot take Node --import, so this extension
// is loaded first with -e and installs the same network guard as test/no-network.mjs. It registers no tools or providers.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import "./no-network.mjs";

export default function noNetworkExtension(_pi: ExtensionAPI): void {}
