"""The compact UI in the real Pi CLI in a PTY (UI port P11, T19): the whole package through its real manifest and the
RQW-theme chosen by name in an isolated settings file; prompts typed into Pi's own input loop.

Proves: Planning next moves, the tool action phrase, the live block under the summary line, the summary before the
answer, `Waiting for 1 agent` after the answer, the agent card and Ctrl+O original, the continuous idle rule, /quit
with exit code 0 and no process left in the process group, and no network attempt.
Only a scripted faux provider answers (a driver extension in the temp folder); no network, no real model, never ~/.pi.
The faux replies that must hold wait for flag files the script creates, so every wait is an event, not a sleep.
Usage: python3 test/ui-e2e.py [node executable]
"""
import codecs
import errno
import fcntl
import json
import os
import pty
import re
import select
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
SUMMARY_MARK = "\u21b3"
NAMES = [
    "pty-theme-startup-idle",
    "pty-planning",
    "pty-action-live-summary",
    "pty-summary-before-answer",
    "pty-waiting-agent-card",
    "pty-card-ctrl-o",
    "pty-idle-rule",
    "pty-clean-exit",
]

DRIVER = '''import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import %(no_network)s;
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from %(pi_ai)s;

const WORK = %(work)s;
/** Resolves once the test creates the flag file in the work folder. */
async function flag(name: string) {
	while (!existsSync(join(WORK, name))) await new Promise((resolve) => setTimeout(resolve, 20));
}
const text = (content: any): string => typeof content === "string" ? content
	: Array.isArray(content) ? content.map((c: any) => (c?.type === "text" ? c.text : "")).join("\\n") : "";
const toolUse = (...calls: any[]) => fauxAssistantMessage(calls, { stopReason: "toolUse" });
const MAIN: Record<string, (() => Promise<any> | any)[]> = {
	"go": [
		async () => { await flag("plan.flag"); return toolUse(fauxToolCall("read", { path: "a.txt" }, { id: "r1" }), fauxToolCall("read", { path: "b.txt" }, { id: "r2" })); },
		() => toolUse(fauxToolCall("bash", { command: "bash wait-flag.sh" }, { id: "b1" })),
		() => fauxAssistantMessage(fauxText("All done.")),
	],
	"agents": [
		() => toolUse(fauxToolCall("agent", { action: "start", task: "CHILD_P task", system: "You are a test child.", tools: [], model: "openai-codex/gpt-6.1-sol" }, { id: "a1" })),
		() => fauxAssistantMessage(fauxText("Main answered.")),
	],
};

async function route(context: any) {
	const messages = context.messages as any[];
	const system = messages.filter((m) => m.role === "system").map((m) => [text(m.content), ...Object.values(m.sections ?? {})].join("\\n")).join("\\n");
	const users = messages.filter((m) => m.role === "user").map((m) => text(m.content));
	if (system.includes("You name chat sessions")) {
		return fauxAssistantMessage((users[0] ?? "").startsWith("Choose the candidate name") ? "0"
			: JSON.stringify(Array.from({ length: 10 }, (_, i) => `PTY check ${i + 1}`)));
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
	return fauxAssistantMessage("Noted.");
}

// A listed RQW-models ID for the main agent; gpt-6-luna is the naming fallback without Anthropic credentials.
const faux = fauxProvider({ api: "faux-ui-e2e-pty", provider: "openai-codex",
	models: [{ id: "gpt-6.1-sol", reasoning: true }, { id: "gpt-6-luna", reasoning: true }] });
faux.setResponses(Array.from({ length: 500 }, () => route));

export default function (pi: ExtensionAPI) {
	pi.registerProvider(faux.provider as any);
}
'''


class Screen:
    """Just enough of a terminal to replay Pi's output: text, CR/LF with scrolling, cursor moves and erases."""

    def __init__(self, rows, cols):
        self.rows, self.cols = rows, cols
        self.grid = [[" "] * cols for _ in range(rows)]
        self.row = self.col = 0
        self.pending = ""

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
    with tempfile.TemporaryDirectory(prefix="rqw-ui-e2e-pty-") as tmp_name:
        tmp = Path(tmp_name)
        work = tmp / "work"
        work.mkdir()
        (work / "a.txt").write_text("alpha\nbeta\n")
        (work / "b.txt").write_text("one\ntwo\n")
        (work / "wait-flag.sh").write_text("while [ -d \"$PWD\" ] && [ ! -f go.flag ]; do sleep 0.05; done\nprintf 'l1\\nl2\\nl3\\nl4\\nl5\\n'\n")
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
        # takes that place, so it is the one extension of the package that is switched off.
        (agent / "settings.json").write_text(json.dumps({
            "quietStartup": True, "checkForUpdates": False, "lastChangelogVersion": "1.4.0", "theme": "RQW-theme",
            "retry": {"enabled": False}, "packages": [{"source": str(REPO), "extensions": ["-extensions/RQW-codex/index.ts"]}]}))

        env = {**os.environ, "PI_CODING_AGENT_DIR": str(agent), "PI_SKIP_VERSION_CHECK": "1", "PI_OFFLINE": "1",
               "TERM": "xterm-256color", "COLORTERM": "truecolor"}
        for key in list(env):
            if re.search(r"(_API_KEY|_TOKEN|_SECRET)$", key):
                del env[key]

        master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", ROWS, COLS, 0, 0))
        command = [node, str(CLI), "--no-skills", "--no-prompt-templates", "--no-session", "-e", str(driver),
                   "--provider", "openai-codex", "--model", "gpt-6.1-sol"]
        proc = subprocess.Popen(command, cwd=work, env=env, stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
        os.close(slave)
        output = bytearray()
        screen = Screen(ROWS, COLS)
        decoder = codecs.getincrementaldecoder("utf8")("replace")

        def drain(seconds):
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
                    # Answer only terminal capability queries, never a model prompt.
                    if b"\x1b[6n" in data:
                        os.write(master, b"\x1b[1;1R")
                    if b"\x1b[c" in data:
                        os.write(master, b"\x1b[?1;2c")

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
            return top()[1]

        def summary_rows():
            return [i for i, line in enumerate(lines()) if line.lstrip().startswith(SUMMARY_MARK)]

        def type_line(text):
            os.write(master, text.encode() + b"\r")

        try:
            # pty-theme-startup-idle: the statusbar's editor with the session ID; fully idle is the bare rule.
            wait_for("pty-theme-startup-idle", lambda: status() == "", timeout=30)
            r, _ = top()
            if not re.search(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12} ──$", lines()[r]):
                fail("pty-theme-startup-idle", "no session ID at the right end of the top border", screen)
            print("PASS pty-theme-startup-idle")

            # pty-planning: the first model request holds until plan.flag.
            drain(0.5)
            type_line("go")
            wait_for("pty-planning", lambda: status() == "Planning next moves")
            # The typed prompt sits on RQW-theme's user message surface (userMessageBg #232120).
            if b"\x1b[48;2;35;33;32m" not in output:
                fail("pty-planning", "RQW-theme's user message background is not drawn", screen)
            print("PASS pty-planning")
            (work / "plan.flag").write_text("")

            # pty-action-live-summary: bash holds until go.flag; the summary line is above its live block.
            wait_for("pty-action-live-summary", lambda: (status() or "").startswith("Running bash wait-flag.sh")
                     and has("$ bash wait-flag.sh"))
            rows = lines()
            live = next(i for i, line in enumerate(rows) if "$ bash wait-flag.sh" in line)
            summaries = summary_rows()
            if len(summaries) != 1 or summaries[0] >= live or "Read 2 files" not in rows[summaries[0]]:
                fail("pty-action-live-summary", f"summary rows {summaries}, live block row {live}", screen)
            print("PASS pty-action-live-summary")
            (work / "go.flag").write_text("")

            # pty-summary-before-answer: the live block folds on the answer.
            wait_for("pty-summary-before-answer", lambda: has("All done.") and status() == "")
            rows = lines()
            answer = next(i for i, line in enumerate(rows) if "All done." in line)
            summaries = summary_rows()
            if len(summaries) != 1 or summaries[0] >= answer or "Read 2 files · ran 1 command" not in rows[summaries[0]]:
                fail("pty-summary-before-answer", f"summary rows {summaries}, answer row {answer}", screen)
            if has("$ bash wait-flag.sh") or has("running"):
                fail("pty-summary-before-answer", "the live block did not fold", screen)
            print("PASS pty-summary-before-answer")

            # pty-waiting-agent-card: the child holds until child.flag; the main agent has answered meanwhile.
            type_line("agents")
            wait_for("pty-waiting-agent-card", lambda: has("Main answered.") and status() == "Waiting for 1 agent")
            (work / "child.flag").write_text("")
            wait_for("pty-waiting-agent-card", lambda: any(re.search(r"agent#1 finished · gpt-6\.1-sol \w+ · [\d.]+s", line)
                                                           for line in lines()) and has("Первая строка P."))
            if has("Вторая строка P."):
                fail("pty-waiting-agent-card", "the card shows more than the first answer line", screen)
            print("PASS pty-waiting-agent-card")

            # pty-card-ctrl-o: Ctrl+O shows the whole original text, again folds it.
            wait_for("pty-card-ctrl-o", lambda: status() == "" and has("Noted."))
            os.write(master, b"\x0f")
            wait_for("pty-card-ctrl-o", lambda: has("Вторая строка P."))
            os.write(master, b"\x0f")
            wait_for("pty-card-ctrl-o", lambda: not has("Вторая строка P.") and has("Первая строка P."))
            print("PASS pty-card-ctrl-o")

            # pty-idle-rule: fully idle again, the top border is the bare rule with the ID.
            if status() != "":
                fail("pty-idle-rule", f"status {status()!r}", screen)
            print("PASS pty-idle-rule")

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
            print("PASS pty-clean-exit")
        finally:
            # The held bash tool runs in a process group of its own, which killing Pi does not reach: release it first.
            (work / "go.flag").touch()
            if proc.poll() is None:
                proc.kill()
                proc.wait()
            os.close(master)
    print("ALL PASS " + ", ".join(NAMES))


if __name__ == "__main__":
    main()
