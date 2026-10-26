import { readdirSync, readFileSync, writeFileSync, existsSync, realpathSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const START = "<!-- repo-index:start -->";
const END = "<!-- repo-index:end -->";

const purposes = {
  "RQW-settings": "Harness defaults, tool selection and GPT Fast settings",
  "RQW-prompt": "System prompt replacement and environment context",
  "RQW-tools": "Base tools and background jobs",
  "RQW-context": "Context window and compaction reserve policy",
  "RQW-agent": "Recursive subagents, profiles and persisted sessions",
  "RQW-review": "Reviewer profiles and native Agent Skills",
  "RQW-statusbar": "Terminal footer, editor borders and activity display",
  "RQW-models": "Model and reasoning draft picker",
  "RQW-anthropic": "Anthropic subscription authentication and transport",
  "RQW-scroll": "Escape returns a scrolled transcript to the latest message",
  "RQW-session": "Copy session ID and confirmed permanent session removal",
  "RQW-send-now": "Enter sends queued steering from an empty editor",
  "RQW-mouse": "Windows fullscreen mouse reporting recovery",
  "RQW-providers": "Provider visibility without credential removal",
  "RQW-codex": "Codex subscription authentication and protocol overlay",
  "RQW-web": "Subscription web search and public URL reading",
  "RQW-naming": "Background native session name generation",
  "RQW-agent-ui": "Compact delivered agent result cards",
  "RQW-tool-ui": "Compact tool calls and output rendering",
  "RQW-theme": "Native Pi colour theme data, not an extension",
};

const modules = {
  activity: "Activity state and event integration", coordinator: "Subagent lifecycle and orchestration",
  counts: "Running agent counts", "fast-gpt": "GPT Fast state and request settings",
  persistence: "Child session storage and restoration", profiles: "Codex TOML profile discovery and resolution",
  "prompt-files": "Prompt file loading and caller message inclusion", prompt: "Child prompt composition",
  card: "Delivered result card parsing and rendering", "child-wait": "Delivered child wait message rendering",
  fit: "Card layout fitting", review: "Reviewer card identification", self: "Expanded wait cards inside tool-owned call rendering",
  wait: "Wait result cards", "auth-boundary": "Authentication request boundary",
  auth: "Subscription credentials and OAuth recovery", cache: "Prompt cache policy",
  lifecycle: "Installation and teardown lifecycle", registration: "Provider registration overlay",
  retry: "Transport retry classification and waiting", transport: "Subscription request transport",
  wire: "Provider request and response conversion", "auth-runtime": "Authentication runtime integration",
  "compaction-wire": "Compaction wire request conversion", compaction: "Compaction protocol handling",
  compression: "Request body compression", continuation: "Response continuation state",
  cookies: "Transport cookie handling", display: "Display metadata bridge and declarations",
  errors: "Transport error conversion", headers: "Subscription request headers",
  history: "Conversation history conversion", metadata: "Request metadata",
  "portable-history": "Portable conversation history representation", profile: "Pinned native protocol profile",
  "session-compaction": "Stock session compaction integration", "session-history": "Session history integration",
  "session-metadata": "Session request metadata", "session-prefix": "Session startup prefix",
  session: "Session transport lifecycle", sse: "Server-sent event parsing",
  streaming: "Streaming response conversion", "tool-sampling": "Tool sampling request settings",
  "web-alpha": "Native web protocol definitions", "web-commands": "Web command conversion",
  "web-engine": "Native web request execution", "web-native-tools": "Native web tool schemas",
  "web-types": "Web protocol types", websocket: "WebSocket connection and response transport",
  picker: "Draft model and effort chooser", core: "Name candidate generation and selection",
  artifacts: "Session artifact discovery and deletion boundaries", "cache-warming": "Disable generic background cache warming",
  selection: "Tool selection and reload handling", branch: "Session branch display",
  editor: "Custom editor borders and activity integration", git: "Repository status collection",
  render: "Terminal row and component rendering", changes: "Tool change summary extraction",
  classify: "Tool call classification", fallback: "Stock output rendering fallback",
  groups: "Tool call grouping", live: "Live tool output state", summary: "Collapsed tool summaries",
  codemode: "Built-in codemode integration",
  edit: "Multi-file exact text edits", hint: "Tool usage hints", jobs: "Background job lifecycle and notifications",
  keys: "Multi-file filesystem identities",
  write: "Multi-file writes",
  tool: "Web tool schema and registration", batch: "Parallel web request batches",
  credentials: "Read-only saved subscription credential loading", engine: "Web search and URL request execution",
  "model-map": "Caller model and reasoning mapping", pool: "Web request concurrency pool",
  report: "Web result report assembly", "safe-text": "Untrusted web text handling",
  truncate: "Web result length handling", types: "Web request and result types",
  "capture-oracle": "Capture native Codex protocol evidence",
  "oracle-diagnostic": "Diagnose native protocol evidence",
};

function description(file, name) {
  const base = file.split("/").at(-1);
  if (file === "index.ts") return `Pi extension entrypoint: ${purposes[name] ?? name}`;
  if (file === "README.md") return "Hand-written contract and generated file map";
  if (name === "RQW-tools" && file === "retry.ts") return "Windows filesystem retries for EBUSY, EPERM and EACCES";
  if (file === "theme.json") return "Native pi.themes colour tokens; no runtime entrypoint";
  if (base.startsWith("LICENSE")) return "Third-party licence text";
  if (base.includes("THIRD-PARTY-NOTICES")) return "Third-party attribution and provenance";
  if (file.startsWith("descriptions/")) return `Agent-facing ${base.replace(/\.md$/, "")} tool instructions`;
  if (file.startsWith("profiles/")) return `${base.replace(/\.toml$/, "")} reviewer profile and role`;
  if (base === "SKILL.md") return `${file.split("/").at(-2)} native Agent Skill instructions`;
  if (base === "SYSTEM.md") return "Replacement system prompt text";
  if (base === "description.md") return "Agent-facing web tool instructions";
  const stem = base.replace(/\.d\.ts$|\.[^.]+$/g, "");
  return modules[stem] ?? `${stem.replaceAll("-", " ")} module or resource`;
}

function inventory(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = resolve(dir, entry.name);
    return entry.isDirectory() ? inventory(file) : [file];
  }).sort();
}

function fileMap(root, folder, name) {
  const files = inventory(resolve(root, folder)).map(file => relative(resolve(root, folder), file).replaceAll("\\", "/"));
  if (!files.includes("README.md")) files.push("README.md");
  files.sort();
  return [START, "## File map", "", "Generated by `node scripts/repo-index.mjs --write` from the repository root.", "",
    "| File | Responsibility |", "| --- | --- |",
    ...files.map(file => `| [\`${file}\`](${file}) | ${description(file, name)} |`), "",
    `Tests: [\`test/extensions/${name}/\`](../../test/extensions/${name}/).`, END].join("\n");
}

function readme(existing, map, name) {
  const start = existing.indexOf(START);
  const closing = existing.indexOf(END);
  if (start !== -1 || closing !== -1) {
    const uniquePair = start !== -1 && closing > start
      && existing.indexOf(START, start + START.length) === -1
      && existing.indexOf(END, closing + END.length) === -1;
    if (!uniquePair) throw new Error(`${name}/README.md: generated file map must contain one ordered START/END marker pair; repair the markers before regenerating.`);
    const end = closing + END.length;
    return existing.slice(0, start) + map + existing.slice(end);
  }
  const prose = existing || `# ${name}\n\n${purposes[name] ?? name}.\n\nModules and resources live beside \`index.ts\`; subfolders group needed resources.\n`;
  return prose + (prose.endsWith("\n") ? "\n" : "\n\n") + map + "\n";
}

function rootIndex(manifest) {
  const rows = manifest.pi.extensions.map((entry, i) => {
    const path = entry.replace(/^\.\//, "");
    const folder = dirname(path);
    const name = folder.split("/").at(-1);
    return `| ${i + 1} | [${name}](${folder}/README.md) | [\`${path}\`](${path}) | [tests](test/extensions/${name}/) | ${purposes[name] ?? name} |`;
  });
  return ["# Repository index", "", "Start here to find code; each extension README maps its actual files and resources.", "",
    "## Repository navigation", "",
    "- [AGENTS.md](AGENTS.md): repository orientation and agent instructions.",
    "- [PROCESS.md](PROCESS.md): mandatory development procedure; [process/](process/) holds task-loaded rules.",
    "- [DECISIONS.md](DECISIONS.md): accepted choices; [BACKLOG.md](BACKLOG.md): open and held work.",
    "- [extensions/](extensions/): independent package extensions and native theme data.",
    "- [test/extensions/](test/extensions/): mirrored extension tests; [test/](test/): repository tests.",
    "- [scripts/](scripts/): repository development and delivery tooling.",
    "- [pcli-vscode/](pcli-vscode/): bundled Windows VS Code terminal extension, outside pi.extensions.",
    "- [.pi/](.pi/): repository-only agent profiles and development extensions.",
    "- [.github/workflows/](.github/workflows/): CI and quality notifications.",
    "- [INSTALL.md](INSTALL.md): installation.", "",
    "## Extension load order", "", "Derived from `package.json` -> `pi.extensions`. Each extension uses `index.ts` with meaning-named modules and resources beside it. Subfolders group needed resources; there is no `src/` layer. Large files are mapped, not split by this index.", "",
    "| Order | Extension and file map | Entrypoint | Tests | Purpose |", "| --- | --- | --- | --- | --- |", ...rows, "",
    "## Native theme resources", "",
    ...manifest.pi.themes.map(entry => {
      const path = entry.replace(/^\.\//, "");
      return `- [\`${path}\`](${path}): native \`pi.themes\` data, not an extension and no fake entrypoint. [File map](${dirname(path)}/README.md).`;
    }), "", "## Keep this index current", "",
    "After changing the manifest or adding, removing or renaming extension files, run `node scripts/repo-index.mjs --write`. Update the generator's short descriptions when responsibilities change. Hand-written README content outside generated markers is preserved.",
    "Run `node scripts/repo-index.mjs --check` to detect stale maps.", ""].join("\n");
}

export function generate(root = ROOT, mode = "--check") {
  const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  const folders = [...new Set([...manifest.pi.extensions, ...manifest.pi.themes].map(entry => dirname(entry)))];
  const outputs = new Map([["INDEX.md", rootIndex(manifest)]]);
  for (const folder of folders) {
    const name = folder.split("/").at(-1);
    const path = `${folder}/README.md`;
    const existing = existsSync(resolve(root, path)) ? readFileSync(resolve(root, path), "utf8") : "";
    outputs.set(path, readme(existing, fileMap(root, folder, name), name));
  }
  const stale = [];
  for (const [path, content] of outputs) {
    const target = resolve(root, path);
    if (existsSync(target) && readFileSync(target, "utf8") === content) continue;
    stale.push(path);
    if (mode === "--write") writeFileSync(target, content);
  }
  return stale;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  if (!["--write", "--check"].includes(mode) || process.argv.length !== 3) {
    console.error("Usage: node scripts/repo-index.mjs --write|--check");
    process.exitCode = 1;
  } else {
    const stale = generate(ROOT, mode);
    if (mode === "--check" && stale.length) {
      console.error(`Stale repository maps: ${stale.join(", ")}. Run node scripts/repo-index.mjs --write.`);
      process.exitCode = 1;
    } else console.log(mode === "--write" ? `Updated ${stale.length} repository maps.` : "Repository maps are current.");
  }
}
