import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const ROOT = dirname(fileURLToPath(import.meta.url));

export default function reviewProfiles(pi: ExtensionAPI) {
	const stopOffering = pi.events.on("rqw-agent:profiles", (request) => {
		(request as { offer(paths: string[]): void }).offer([
			join(ROOT, "profiles", "spotty.toml"),
			join(ROOT, "profiles", "bossy.toml"),
		]);
	});
	pi.on("session_shutdown", stopOffering);
	pi.on("resources_discover", () => ({
		skillPaths: ["reviewer", "blindreview", "highreview", "selfcheck"].map((name) => join(ROOT, "skills", name, "SKILL.md")),
	}));
}
