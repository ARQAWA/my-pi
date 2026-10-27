import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default {
  workspaces: {
    ".": {
      entry: [
        ...manifest.pi.extensions.map((path) => `${path}!`),
        "scripts/**/*.mjs!",
        "extensions/*/scripts/*.mjs!",
        ".pi/extensions/*/index.ts!",
        "test/**/*.test.ts",
        "test/no-network-extension.ts",
      ],
      project: ["extensions/**/*.{ts,mjs}", "test/**/*.ts", "scripts/**/*.mjs", ".pi/extensions/**/*.ts"],
      // These packages are supplied by the Pi host, not installed by extensions.
      ignoreDependencies: [
        "@earendil-works/pi-tui",
        "@earendil-works/pi-agent-core",
        "@anthropic-ai/sdk",
      ],
    },
    "pcli-vscode": {
      entry: ["extension.js!", "fetch-pi.mjs!", "test/**/*.{mjs,cjs}", "test/harness/main.js"],
      project: ["**/*.{js,mjs,cjs}"],
      // VS Code provides this module when it loads the extension and test suites.
      ignoreDependencies: ["vscode"],
    },
  },
};
