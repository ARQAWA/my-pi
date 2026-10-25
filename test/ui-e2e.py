"""The compact UI in the real Pi CLI in a PTY (UI port P11, T19): the whole package through its real manifest and the
RQW-theme chosen by name in an isolated settings file; prompts typed into Pi's own input loop.

Proves: native loaded extension order, thinking hiding with Ctrl+T, grouped tools and four-row live output,
Ctrl+O originals, agent and child_wait cards, separate activity/idle chrome, narrow fitting, native compaction
success/cancel/error cleanup, Escape abort, session switch, package-filter stock restoration and clean exit.
Artifacts persist under /tmp/p11-resumed-*; physical font, display and animation appearance are not verified.
Only a scripted faux provider answers (a driver extension in the temp folder); no network, no real model, never ~/.pi.
The faux replies that must hold wait for flag files the script creates, so every wait is an event, not a sleep.
Usage: python3 test/ui-e2e.py [node executable]
"""
import codecs
from contextlib import nullcontext
import errno
import fcntl
import json
import os
import pty
import re
import select
import signal
import shutil
import struct
import subprocess
import sys
import tempfile
import termios
import time
import unicodedata
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
CLI = REPO / "node_modules/@earendil-works/pi-coding-agent/dist/cli.js"
PI_AI = REPO / "node_modules/@earendil-works/pi-ai/dist/index.js"
NO_NETWORK = REPO / "test/no-network.mjs"
ROWS, COLS = 50, 100
RULE = "\u2500"
SUMMARY_MARK = "Read 2 files"
DRIVER = '''import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import %(no_network)s;
import { fauxAssistantMessage, fauxProvider, fauxText, fauxThinking, fauxToolCall } from %(pi_ai)s;

const WORK = %(work)s;
/** Resolves once the test creates the flag file in the work folder. */
async function flag(name: string, signal?: AbortSignal) {
	const deadline = Date.now() + 20000;
	while (!existsSync(join(WORK, name)) && !signal?.aborted) {
		if (Date.now() > deadline) throw new Error(`Gate timed out: ${name}`);
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}
const text = (content: any): string => typeof content === "string" ? content
	: Array.isArray(content) ? content.map((c: any) => (c?.type === "text" ? c.text : "")).join("\\n") : "";
const toolUse = (...calls: any[]) => fauxAssistantMessage(calls, { stopReason: "toolUse" });
const MAIN: Record<string, (() => Promise<any> | any)[]> = {
	"after-compaction": [() => fauxAssistantMessage("Noted. after-compaction\\n" + "checkpoint ".repeat(200))],
	"ready-compact": [() => fauxAssistantMessage("Ready for native compaction.")],
	"go": [
		async () => { await flag("plan.flag"); return toolUse(fauxToolCall("read", { path: "a.txt" }, { id: "r1" }), fauxToolCall("read", { path: "b.txt" }, { id: "r2" })); },
		() => toolUse(fauxToolCall("bash", { command: "bash wait-flag.sh" }, { id: "b1" })),
		() => fauxAssistantMessage([fauxThinking("SECRET_REASONING_P11"), fauxText("All done.")]),
	],
	"wait-agents": [
		() => toolUse(fauxToolCall("agent", { action: "start", task: "CHILD_W task", system: "You are a test child.", tools: [], model: "openai-codex/gpt-6.1-sol", thinking: "low" }, { id: "a2" })),
		() => toolUse(fauxToolCall("agent", { action: "wait", ids: ["agent#2"], timeout_ms: 20000 }, { id: "w2" })),
		() => fauxAssistantMessage("Wait settled."),
	],
	"agents": [
		() => toolUse(fauxToolCall("agent", { action: "start", task: "CHILD_P task", system: "You are a test child.", tools: [], model: "openai-codex/gpt-6.1-sol", thinking: "low" }, { id: "a1" })),
		() => fauxAssistantMessage(fauxText("Main answered.")),
	],
};

let compact = 0;
async function route(context: any, options: any) {
	const messages = context.messages as any[];
	const system = messages.filter((m) => m.role === "system").map((m) => [text(m.content), ...Object.values(m.sections ?? {})].join("\\n")).join("\\n");
	const users = messages.filter((m) => m.role === "user").map((m) => text(m.content));
	if (system.includes("You are a context summarization assistant")) {
		const n = compact;
		writeFileSync(join(WORK, `compact-${n}.started`), "");
		await flag(`compact-${n}.flag`, options?.signal);
		if (n === 3) throw new Error("P11 faux summary failure");
		return fauxAssistantMessage("## Goal\\nExercise compact UI.\\n## Progress\\nIntegration complete.");
	}
	if (users.at(-1) === "abort-probe") {
		await flag("abort.flag", options?.signal);
		return fauxAssistantMessage("Must not complete after abort.");
	}
	if ((users[0] ?? "").includes("CHILD_W")) {
		await flag("wait-child.flag", options?.signal);
		return fauxAssistantMessage("Wait first line.\\nWait second line.");
	}
	if ((users[0] ?? "").includes("CHILD_P")) {
		await flag("child.flag");
		return fauxAssistantMessage("Первая строка P.\\nВторая строка P.");
	}
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role !== "user") continue;
		const steps = MAIN[text(messages[i].content).trim()];
		if (!steps) continue;
		const step = messages.slice(i + 1).filter((m) => m.role === "assistant").length;
		return step < steps.length ? steps[step]() : fauxAssistantMessage("Noted.");
	}
	return fauxAssistantMessage(`Noted. ${users.at(-1)}`);
}

// Naming is filtered out; every actual request, including native compaction, uses this faux provider.
const faux = fauxProvider({ api: "faux-ui-e2e-pty", provider: "openai-codex",
	models: [{ id: "gpt-6.1-sol", reasoning: true }] });
faux.setResponses(Array.from({ length: 100 }, () => route));
const naming = fauxProvider({ api: "faux-ui-e2e-naming", provider: "kimi-coding",
	models: [{ id: "kimi-for-coding", reasoning: true }] });

export default function (pi: ExtensionAPI) {
	pi.registerProvider(faux.provider as any);
	pi.registerProvider(naming.provider as any);
	// Reassert the faux transports on session start as well. Naming remains explicitly filtered out.
	pi.on("session_start", () => {
		pi.registerProvider(faux.provider as any);
		pi.registerProvider(naming.provider as any);
	});
	pi.on("message_end", (event) => {
		const message = event.message as any;
		if (message.role === "assistant" && message.content?.some((c: any) => c.type === "thinking" && c.thinking === "SECRET_REASONING_P11"))
			writeFileSync(join(WORK, "thinking.stored"), JSON.stringify(message));
	});
	pi.on("tool_execution_end", (event) => {
		if (event.toolCallId === "w2") writeFileSync(join(WORK, "wait.owned"), JSON.stringify(event.result.details));
	});
	pi.on("session_before_compact", () => { compact++; });
	pi.on("session_compact", () => { writeFileSync(join(WORK, "compact.done"), ""); });
	pi.on("session_compact_failed", (event) => { writeFileSync(join(WORK, "compact.failed"), JSON.stringify(event)); });
}
'''


class Screen:
    """Just enough of a terminal to replay Pi's output: text, CR/LF with scrolling, cursor moves and erases."""

    def __init__(self, rows, cols):
        self.rows, self.cols = rows, cols
        self.grid = [[" "] * cols for _ in range(rows)]
        self.row = self.col = 0
        self.pending = ""
        self.overflow = 0

    def resize(self, rows, cols):
        self.grid = [(line + [" "] * cols)[:cols] for line in self.grid[-rows:]]
        self.rows, self.cols = rows, cols
        self.row, self.col = min(self.row, rows - 1), min(self.col, cols - 1)

    def lines(self):
        return ["".join(c for c in line if c).rstrip() for line in self.grid]

    def newline(self):
        if self.row == self.rows - 1:
            self.grid = self.grid[1:] + [[" "] * self.cols]
        else:
            self.row += 1

    def feed(self, text):
        text = self.pending + text
        self.pending = ""
        i = 0
        while i < len(text):
            ch = text[i]
            if ch == "\x1b":
                if i + 1 >= len(text):
                    self.pending = text[i:]
                    return
                kind = text[i + 1]
                if kind == "[":
                    j = i + 2
                    while j < len(text) and not ("@" <= text[j] <= "~"):
                        j += 1
                    if j >= len(text):
                        self.pending = text[i:]
                        return
                    self.csi(text[i + 2:j], text[j])
                    i = j + 1
                elif kind in "]_P^":
                    ends = [k for k in (text.find("\x07", i + 2), text.find("\x1b\\", i + 2)) if k >= 0]
                    if not ends:
                        self.pending = text[i:]
                        return
                    end = min(ends)
                    i = end + (1 if text[end] == "\x07" else 2)
                else:
                    i += 2
                continue
            if ch == "\r":
                self.col = 0
            elif ch == "\n":
                self.newline()
            elif ch == "\b":
                self.col = max(0, self.col - 1)
            elif ch >= " " and unicodedata.category(ch) not in ("Mn", "Me", "Cf"):
                wide = unicodedata.east_asian_width(ch) in "WF"
                if self.col < self.cols:
                    self.grid[self.row][self.col] = ch
                    if wide and self.col + 1 < self.cols:
                        self.grid[self.row][self.col + 1] = ""
                else:
                    self.overflow += 1
                self.col = min(self.cols, self.col + (2 if wide else 1))
            i += 1

    def csi(self, params, final):
        if params.startswith("?") or params.startswith(">") or params.startswith("<"):
            return
        nums = [int(p) if p.isdigit() else 0 for p in params.split(";")] if params else []
        n = nums[0] if nums and nums[0] > 0 else 1
        if final == "A":
            self.row = max(0, self.row - n)
        elif final == "B":
            self.row = min(self.rows - 1, self.row + n)
        elif final == "C":
            self.col = min(self.cols - 1, self.col + n)
        elif final == "D":
            self.col = max(0, self.col - n)
        elif final == "G":
            self.col = min(self.cols - 1, n - 1)
        elif final in "Hf":
            self.row = min(self.rows - 1, (nums[0] if nums and nums[0] else 1) - 1)
            self.col = min(self.cols - 1, (nums[1] if len(nums) > 1 and nums[1] else 1) - 1)
        elif final == "K":
            mode = nums[0] if nums else 0
            line = self.grid[self.row]
            span = range(self.col, self.cols) if mode == 0 else range(0, self.col + 1) if mode == 1 else range(self.cols)
            for k in span:
                line[k] = " "
        elif final == "J":
            mode = nums[0] if nums else 0
            if mode == 0:
                self.csi("0", "K")
                for r in range(self.row + 1, self.rows):
                    self.grid[r] = [" "] * self.cols
            elif mode in (2, 3):
                self.grid = [[" "] * self.cols for _ in range(self.rows)]


def fail(name, message, screen):
    print(f"FAIL {name}: {message}", file=sys.stderr)
    print("--- screen ---", file=sys.stderr)
    for i, line in enumerate(screen.lines()):
        print(f"{i:2d}|{line}", file=sys.stderr)
    sys.exit(1)


CONTEXT_BAR = re.compile(r"(?:\d+% [\d.]+k|\?)/[\d.]+k$")


def main():
    node = sys.argv[1] if len(sys.argv) > 1 else shutil.which("node")
    manifest = json.loads((REPO / "package.json").read_text())["pi"]
    for name in ("RQW-statusbar", "RQW-thinking", "RQW-agent-ui", "RQW-tool-ui"):
        if f"./extensions/{name}/index.ts" not in manifest["extensions"]:
            print(f"FAIL manifest: {name} is not in pi.extensions", file=sys.stderr)
            sys.exit(1)
    if "./extensions/RQW-theme/theme.json" not in manifest.get("themes", []):
        print("FAIL manifest: RQW-theme is not in pi.themes", file=sys.stderr)
        sys.exit(1)
    # Keep artifacts on success and failure for the combined review.
    enabled = [path for path in manifest["extensions"]
               if path not in ("./extensions/RQW-codex/index.ts", "./extensions/RQW-naming/index.ts")]
    with nullcontext(tempfile.mkdtemp(prefix="p11-resumed-", dir="/tmp")) as tmp_name:
        print(f"ARTIFACTS {tmp_name}", flush=True)
        tmp = Path(tmp_name)
        work = tmp / "work"
        work.mkdir()
        (work / "a.txt").write_text("alpha\nbeta\n")
        (work / "b.txt").write_text("one\ntwo\n")
        os.mkfifo(work / "go.pipe")
        (work / "wait-flag.sh").write_text("printf 'l1\\nl2\\nl3\\nl4\\nl5\\n'\nread -t 20 gate < go.pipe\n")
        driver_dir = tmp / "driver"
        driver_dir.mkdir()
        driver = driver_dir / "faux-driver.ts"
        driver.write_text(DRIVER % {"pi_ai": json.dumps(str(PI_AI)), "no_network": json.dumps(str(NO_NETWORK)),
                                    "work": json.dumps(str(work))})
        agent = tmp / "agent"
        agent.mkdir()
        cached_fd = Path.home() / ".pi/agent/bin/fd"
        if cached_fd.is_file():
            (agent / "bin").mkdir()
            shutil.copy2(cached_fd, agent / "bin/fd")
        # The package as a user installs it: the repository folder, read through its manifest; the theme chosen by name.
        # RQW-codex owns the openai-codex provider with its real network transport; the faux provider of the driver
        # takes that place. Naming is unrelated here and disabled to avoid a second provider.
        (agent / "settings.json").write_text(json.dumps({
            "quietStartup": True, "checkForUpdates": False, "lastChangelogVersion": "1.4.0", "theme": "RQW-theme",
            "compaction": {"keepRecentTokens": 50}, "retry": {"enabled": False}, "packages": [{"source": str(REPO), "extensions": [path.removeprefix("./") for path in enabled]}]}))

        env = {**os.environ, "PI_CODING_AGENT_DIR": str(agent), "PI_SKIP_VERSION_CHECK": "1", "PI_OFFLINE": "1",
               "TERM": "xterm-256color", "COLORTERM": "truecolor",
               "NODE_OPTIONS": f"--import={NO_NETWORK}"}
        for key in list(env):
            if re.search(r"(_API_KEY|_TOKEN|_SECRET)$", key):
                del env[key]

        # Exercise the public native loader with the exact same package settings and driver as the CLI.
        # Inspect loaded extensions, not just manifest declarations or display-sorted startup labels.
        probe = f"""
import {{ DefaultResourceLoader }} from {json.dumps(str(CLI.parent / 'index.js'))};
const loader = new DefaultResourceLoader({{
  cwd: {json.dumps(str(work))}, agentDir: {json.dumps(str(agent))},
  additionalExtensionPaths: [{json.dumps(str(driver))}], noSkills: true, noPromptTemplates: true
}});
await loader.reload();
const result = loader.getExtensions();
console.log(JSON.stringify({{paths: result.extensions.map(e => e.path), errors: result.errors}}));
"""
        loaded = subprocess.run([node, "--input-type=module", "-e", probe], cwd=work, env=env,
                                capture_output=True, text=True, timeout=30)
        (tmp / "loader.log").write_text(loaded.stdout + loaded.stderr)
        if loaded.returncode:
            raise AssertionError(f"native loader failed: {loaded.stderr}")
        result = json.loads(loaded.stdout.strip().splitlines()[-1])
        expected = [str(driver), *[str(REPO / path) for path in enabled]]
        if result["errors"] or result["paths"] != expected:
            raise AssertionError(f"native loaded order mismatch: {result!r}; expected {expected!r}")
        (tmp / "loaded-extensions.json").write_text(json.dumps(result, indent=2))

        master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", ROWS, COLS, 0, 0))
        command = [node, str(CLI), "--no-skills", "--no-prompt-templates", "--no-session", "-e", str(driver),
                   "--provider", "openai-codex", "--model", "gpt-6.1-sol"]
        proc = subprocess.Popen(command, cwd=work, env=env, stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
        os.close(slave)
        output = bytearray()
        screen = Screen(ROWS, COLS)
        decoder = codecs.getincrementaldecoder("utf8")("replace")
        negotiated = False
        query_tail = b""
        scenarios = []

        def passed(name):
            scenarios.append(name)
            (tmp / "scenarios.json").write_text(json.dumps(scenarios, indent=2))
            (tmp / f"{name}.txt").write_text("\n".join(screen.lines()))
            print(f"PASS {name}", flush=True)

        def drain(seconds):
            nonlocal negotiated, query_tail
            deadline = time.monotonic() + seconds
            while time.monotonic() < deadline:
                ready, _, _ = select.select([master], [], [], min(0.05, max(0, deadline - time.monotonic())))
                if ready:
                    try:
                        data = os.read(master, 65536)
                    except OSError as exc:
                        if exc.errno == errno.EIO:
                            return
                        raise
                    if not data:
                        return
                    output.extend(data)
                    screen.feed(decoder.decode(data))
                    # Pi 1.4 uses DA as the finite keyboard-negotiation sentinel. Handle split queries too.
                    queries = query_tail + data
                    if b"\x1b[6n" in queries:
                        os.write(master, b"\x1b[1;1R")
                    if b"\x1b[c" in queries:
                        os.write(master, b"\x1b[?1;2c")
                    if b"\x1b[>4;2m" in queries:
                        negotiated = True
                    query_tail = queries[-3:]

        def lines():
            return screen.lines()

        def has(text):
            return any(text in line for line in lines())

        def wait_for(name, check, timeout=30):
            deadline = time.monotonic() + timeout
            while True:
                drain(0.05)
                if check():
                    return
                if proc.poll() is not None:
                    fail(name, f"Pi exited early with {proc.returncode}", screen)
                if time.monotonic() > deadline:
                    fail(name, "timed out", screen)

        def top():
            """(row index, status text without rules and ID) of the editor's top border, or (None, None)."""
            rows = lines()
            bottom = next((i for i in range(len(rows) - 1, -1, -1) if CONTEXT_BAR.search(rows[i])), None)
            if bottom is None:
                return None, None
            r = next((i for i in range(bottom - 1, -1, -1) if rows[i].startswith(RULE)), None)
            if r is None:
                return None, None
            status = re.sub(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", "", rows[r])
            return r, re.sub(f"[{RULE}\\s]+", " ", status).strip()

        def status():
            r, _ = top()
            if r is None:
                return None
            candidate = lines()[r - 2] if r >= 2 else ""
            return candidate.strip() if re.match(r"^ (Planning next moves|Running |Reading |Waiting for |Compacting context)", candidate) else ""

        def check_activity(expected):
            r, _ = top()
            rows = lines()
            if status() != expected or r is None:
                fail("activity-layout", f"expected {expected!r}, got {status()!r}", screen)
            if expected and (rows[r - 1] or rows[r - 3] or not rows[r - 2].startswith(" ")):
                fail("activity-layout", "activity must have one blank row above and below", screen)
            if top()[1]:
                fail("activity-layout", "activity leaked into title border", screen)

        def summary_rows():
            return [i for i, line in enumerate(lines()) if line.lstrip().startswith(SUMMARY_MARK)]

        def release_bash():
            try:
                fd = os.open(work / "go.pipe", os.O_WRONLY | os.O_NONBLOCK)
            except OSError as exc:
                if exc.errno == errno.ENXIO:
                    return
                raise
            with os.fdopen(fd, "w") as pipe:
                pipe.write("go\n")

        def type_line(text):
            os.write(master, text.encode() + b"\r")

        try:
            passed("native-loaded-manifest-order")
            # pty-theme-startup-idle: the statusbar's editor with the session ID; fully idle is the bare rule.
            wait_for("pty-theme-startup-idle", lambda: negotiated and status() == "", timeout=30)
            r, _ = top()
            if not re.search(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12} ──$", lines()[r]):
                fail("pty-theme-startup-idle", "no session ID at the right end of the top border", screen)
            passed("pty-theme-startup-idle")

            # pty-planning: the first model request holds until plan.flag.
            type_line("go")
            wait_for("pty-planning", lambda: status() == "Planning next moves")
            # The typed prompt sits on RQW-theme's user message surface (userMessageBg #232120).
            if b"\x1b[48;2;35;33;32m" not in output:
                fail("pty-planning", "RQW-theme's user message background is not drawn", screen)
            check_activity("Planning next moves")
            passed("pty-planning")
            (work / "plan.flag").write_text("")

            # pty-action-live-summary: bash holds until go.flag; the summary line is above its live block.
            wait_for("pty-action-live-summary", lambda: (status() or "").startswith("Running bash wait-flag.sh")
                     and has("$ bash wait-flag.sh") and has("l5"))
            rows = lines()
            live = next(i for i, line in enumerate(rows) if "$ bash wait-flag.sh" in line)
            summaries = summary_rows()
            if len(summaries) != 1 or summaries[0] >= live or "Read 2 files" not in rows[summaries[0]]:
                fail("pty-action-live-summary", f"summary rows {summaries}, live block row {live}", screen)
            if [row.strip() for row in rows[live + 1:live + 5]] != ["l2", "l3", "l4", "l5"] or has("l1"):
                fail("pty-action-live-summary", "live output is not exactly the last four rows", screen)
            check_activity("Running bash wait-flag.sh")
            passed("pty-action-live-summary")
            release_bash()

            # pty-summary-before-answer: the live block folds on the answer.
            wait_for("pty-summary-before-answer", lambda: has("All done.") and status() == "")
            rows = lines()
            answer = next(i for i, line in enumerate(rows) if "All done." in line)
            summaries = summary_rows()
            if len(summaries) != 1 or summaries[0] >= answer or "Read 2 files · ran 1 command" not in rows[summaries[0]]:
                fail("pty-summary-before-answer", f"summary rows {summaries}, answer row {answer}", screen)
            if has("$ bash wait-flag.sh") or has("running"):
                fail("pty-summary-before-answer", "the live block did not fold", screen)
            passed("pty-summary-before-answer")
            if not (work / "thinking.stored").exists():
                fail("pty-thinking-hidden", "no actual stored thinking block", screen)
            if has("SECRET_REASONING_P11") or any(line.strip() == "Thinking..." for line in lines()):
                fail("pty-thinking-hidden", "reasoning or hidden label visible", screen)
            os.write(master, b"\x14")
            type_line("echo-ready")
            wait_for("pty-thinking-ctrl-t", lambda: has("Thinking blocks: hidden") and has("Noted.") and status() == "")
            if b"SECRET_REASONING_P11" in output or any(line.strip() == "Thinking..." for line in lines()):
                fail("pty-thinking-ctrl-t", "Ctrl+T exposed reasoning or label", screen)
            passed("pty-thinking-hidden-ctrl-t")
            os.write(master, b"\x0f")
            wait_for("pty-tool-originals", lambda: has("$ bash wait-flag.sh") and has("l5"))
            if not has("read a.txt") or not has("read b.txt"):
                fail("pty-tool-originals", "read originals missing", screen)
            os.write(master, b"\x0f")
            wait_for("pty-tool-originals", lambda: not has("$ bash wait-flag.sh") and has("All done."))
            passed("pty-tool-originals")

            # pty-waiting-agent-card: the child holds until child.flag; the main agent has answered meanwhile.
            type_line("agents")
            wait_for("pty-waiting-agent-card", lambda: has("Main answered.") and status() == "Waiting for 1 agent")
            check_activity("Waiting for 1 agent")
            (work / "child.flag").write_text("")
            wait_for("pty-waiting-agent-card", lambda: any(re.search(r"agent#1 finished · gpt-6\.1-sol \w+ · [\d.]+s", line)
                                                           for line in lines()) and has("Первая строка P."))
            if has("Вторая строка P."):
                fail("pty-waiting-agent-card", "the card shows more than the first answer line", screen)
            passed("pty-waiting-agent-card")

            # pty-card-ctrl-o: Ctrl+O shows the whole original text, again folds it.
            wait_for("pty-card-ctrl-o", lambda: status() == "" and has("Noted."))
            os.write(master, b"\x0f")
            wait_for("pty-card-ctrl-o", lambda: has("Вторая строка P."))
            os.write(master, b"\x0f")
            wait_for("pty-card-ctrl-o", lambda: not has("Вторая строка P.") and has("Первая строка P."))
            passed("pty-card-ctrl-o")

            # pty-idle-rule: fully idle again, the top border is the bare rule with the ID.
            if status() != "":
                fail("pty-idle-rule", f"status {status()!r}", screen)
            passed("pty-idle-rule")

            # Resize through the real SIGWINCH path, gated by the repainted editor rule.
            for cols in (40, 24, COLS):
                fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", ROWS, cols, 0, 0))
                screen.resize(ROWS, cols)
                screen.overflow = 0
                os.kill(proc.pid, signal.SIGWINCH)
                wait_for("pty-narrow-fit", lambda: top()[0] is not None and len(lines()[top()[0]]) == cols
                         and (cols == COLS or lines()[top()[0]] == RULE * cols))
                if screen.overflow:
                    fail("pty-narrow-fit", f"{screen.overflow} writes past edge at {cols}", screen)
            passed("pty-narrow-fit")

            type_line("wait-agents")
            wait_for("pty-wait-delivery", lambda: has("Waited for 1 agent") and (work / "wait.owned").exists())
            (work / "wait-child.flag").touch()
            wait_for("pty-wait-delivery", lambda: has("agent#2 finished") and has("Wait first line.") and status() == "")
            if has("Wait second line."):
                fail("pty-wait-delivery", "collapsed delivered wait shows full body", screen)
            os.write(master, b"\x0f")
            wait_for("pty-wait-originals", lambda: has("Wait second line."))
            os.write(master, b"\x0f")
            wait_for("pty-wait-originals", lambda: not has("Wait second line.") and has("Wait first line."))
            passed("pty-wait-delivery-originals")

            # Real native summary compaction, then Escape cancellation, all through the faux transport.
            type_line("/compact")
            wait_for("pty-compaction-complete", lambda: (work / "compact-1.started").exists() and status() == "Compacting context")
            (work / "compact-1.flag").touch()
            wait_for("pty-compaction-complete", lambda: (work / "compact.done").exists() and status() == "")
            passed("pty-compaction-complete")
            type_line("after-compaction")
            wait_for("pty-compaction-new-turn", lambda: has("Noted. after-compaction") and status() == "")
            type_line("ready-compact")
            wait_for("pty-compaction-eligible", lambda: has("Ready for native compaction.") and status() == "")
            type_line("/compact")
            wait_for("pty-compaction-cancel", lambda: (work / "compact-2.started").exists() and status() == "Compacting context")
            os.write(master, b"\x1b")
            wait_for("pty-compaction-cancel", lambda: (work / "compact.failed").exists() and status() == "")
            if not json.loads((work / "compact.failed").read_text())["aborted"]:
                fail("pty-compaction-cancel", "native failure event was not aborted", screen)
            passed("pty-compaction-cancel")
            (work / "compact.failed").unlink()
            type_line("/compact")
            wait_for("pty-compaction-error", lambda: (work / "compact-3.started").exists() and status() == "Compacting context")
            (work / "compact-3.flag").touch()
            wait_for("pty-compaction-error", lambda: (work / "compact.failed").exists() and status() == "")
            error = json.loads((work / "compact.failed").read_text())
            if error["aborted"] or "P11 faux summary failure" not in error.get("errorMessage", ""):
                fail("pty-compaction-error", "wrong native error event", screen)
            passed("pty-compaction-error")
            type_line("abort-probe")
            wait_for("pty-abort-cleanup", lambda: status() == "Planning next moves")
            os.write(master, b"\x1b")
            wait_for("pty-abort-cleanup", lambda: status() == "")
            if has("Must not complete after abort."):
                fail("pty-abort-cleanup", "aborted request completed", screen)
            passed("pty-abort-cleanup")
            old_border = lines()[top()[0]]
            type_line("/new")
            wait_for("pty-session-switch", lambda: top()[0] is not None and lines()[top()[0]] != old_border
                     and status() == "" and not has("agent#1 finished"))
            passed("pty-session-switch")
            settings = json.loads((agent / "settings.json").read_text())
            settings["packages"][0]["extensions"] = []
            (agent / "settings.json").write_text(json.dumps(settings))
            type_line("/reload")
            wait_for("pty-stock-restored", lambda: has("Reloaded") and not has("cmp 0")
                     and sum(line == RULE * COLS for line in lines()) >= 2)
            passed("pty-stock-restored")

            # pty-clean-exit
            type_line("/quit")
            deadline = time.monotonic() + 10
            while proc.poll() is None and time.monotonic() < deadline:
                drain(0.1)
            if proc.poll() is None:
                fail("pty-clean-exit", "Pi did not exit on /quit", screen)
            if proc.returncode != 0:
                fail("pty-clean-exit", f"exit code {proc.returncode} (a network attempt sets 1)", screen)
            try:
                os.killpg(proc.pid, 0)
            except ProcessLookupError:
                pass
            else:
                fail("pty-clean-exit", "processes survived in the process group", screen)
            if b"Isolation network blocked" in output:
                fail("pty-clean-exit", "a network attempt was blocked", screen)
            passed("pty-clean-exit")
        finally:
            # The held bash tool runs in a process group of its own, which killing Pi does not reach: release it first.
            release_bash()
            if proc.poll() is None:
                proc.kill()
                proc.wait()
            (tmp / "terminal.ansi").write_bytes(output)
            (tmp / "screen.txt").write_text("\n".join(lines()))
            os.close(master)
    print("ALL PASS " + ", ".join(scenarios))


if __name__ == "__main__":
    main()
