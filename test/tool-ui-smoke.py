"""RQW-tool-ui in the real Pi CLI in a PTY: live card, summary line, Ctrl+O, width fit, switch off + /reload, clean exit.

Only the faux provider answers (a driver extension in the temp folder); no network, no real model.
Usage: python3 test/tool-ui-smoke.py [node executable]
"""
import codecs
import errno
import fcntl
import json
import os
import pty
import select
import shutil
import signal
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
TOOL_UI = REPO / "extensions/RQW-tool-ui"
SUMMARY = "Edited 1 file +1 -1 \u00b7 read 2 files \u00b7 ran 1 command"
SUMMARY_MARK = "Edited 1 file"
STATUS_MARKS = ("running", "\u2713", "\u2717")
# Stock Pi rows of the calls (expanded view); refined from the observed Ctrl+O screen.
STOCK_READ_A = "read a.txt"
STOCK_READ_B = "read b.txt"
STOCK_BASH = "$ printf"
NAMES = [
    "smoke-live-while-working",
    "smoke-summary-before-answer",
    "smoke-live-folds-on-answer",
    "smoke-ctrl-o-original",
    "smoke-width-fit",
    "smoke-off-reload-stock",
    "smoke-clean-exit",
]

DRIVER = '''import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from %(pi_ai)s;

// /reload evaluates this file again: the one faux queue lives on globalThis, so the replies go on in order.
const shared = globalThis as { rqwToolUiFaux?: ReturnType<typeof fauxProvider> };
if (!shared.rqwToolUiFaux) {
	const faux = fauxProvider();
	shared.rqwToolUiFaux = faux;
	const CODE = %(code)s;
	faux.setResponses([
	fauxAssistantMessage([fauxToolCall("read", { path: "a.txt" }, { id: "r1" }), fauxToolCall("read", { path: "b.txt" }, { id: "r2" })], { stopReason: "toolUse" }),
	fauxAssistantMessage([fauxToolCall("edit", { path: "a.txt", edits: [{ oldText: "alpha", newText: "ALPHA" }] }, { id: "e1" })], { stopReason: "toolUse" }),
	fauxAssistantMessage([fauxToolCall("bash", { command: %(bash)s }, { id: "b1" })], { stopReason: "toolUse" }),
	fauxAssistantMessage([fauxToolCall("codemode", { code: CODE }, { id: "k1" })], { stopReason: "toolUse" }),
	fauxAssistantMessage(fauxText("All done.")),
	fauxAssistantMessage([fauxToolCall("read", { path: "b.txt" }, { id: "r3" })], { stopReason: "toolUse" }),
	fauxAssistantMessage(fauxText("Fine.")),
	]);
}

export default function (pi: ExtensionAPI) {
	pi.registerProvider(shared.rqwToolUiFaux!.provider as any);
}
'''


def display_width(text):
    return sum(2 if unicodedata.east_asian_width(c) in "WF" else 1 for c in text)


class Screen:
    """Just enough of a terminal to replay Pi's output: text, CR/LF with scrolling, cursor moves and erases.
    `overflow` counts printable characters written past the right edge (a row wider than the terminal)."""

    def __init__(self, rows, cols):
        self.rows, self.cols = rows, cols
        self.grid = [[" "] * cols for _ in range(rows)]
        self.row = self.col = 0
        self.pending = ""
        self.overflow = 0
        # Rows that scrolled off the top, so the whole transcript can be read (erase of scrollback clears them).
        self.history = []

    def resize(self, rows, cols):
        self.grid = [(line + [" "] * cols)[:cols] for line in self.grid[-rows:]]
        self.grid = [[" "] * cols for _ in range(rows - len(self.grid))] + self.grid
        self.rows, self.cols = rows, cols
        self.row, self.col = min(self.row, rows - 1), min(self.col, cols - 1)

    def lines(self):
        return ["".join(c for c in line if c).rstrip() for line in self.grid]

    def all_lines(self):
        return self.history + self.lines()

    def newline(self):
        if self.row == self.rows - 1:
            self.history.append("".join(c for c in self.grid[0] if c).rstrip())
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
                if mode == 3:
                    self.history = []


def fail(name, message, screen):
    print(f"FAIL {name}: {message}", file=sys.stderr)
    print("--- screen ---", file=sys.stderr)
    for i, line in enumerate(screen.lines()):
        print(f"{i:2d}|{line}", file=sys.stderr)
    sys.exit(1)


def main():
    node = sys.argv[1] if len(sys.argv) > 1 else shutil.which("node")
    with tempfile.TemporaryDirectory(prefix="rqw-tool-ui-pty-") as tmp_name:
        tmp = Path(tmp_name)
        # The extension alone, as a temporary package without its test folder (loaded through settings `packages`).
        pkg = tmp / "pkg"
        shutil.copytree(TOOL_UI, pkg / "extensions/RQW-tool-ui", ignore=shutil.ignore_patterns("test"))
        (pkg / "package.json").write_text(json.dumps({"name": "tool-ui-smoke", "private": True,
                                                       "pi": {"extensions": ["./extensions/RQW-tool-ui/index.ts"]}}))
        work = tmp / "work"
        work.mkdir()
        (work / "a.txt").write_text("alpha\nbeta\n")
        (work / "b.txt").write_text("one\ntwo\n")
        driver_dir = tmp / "driver"
        driver_dir.mkdir()
        code = 'await tools.read({ path: "a.txt" }); await tools.read({ path: "b.txt" }); return "ok";'
        bash = "printf 'l1\\nl2\\nl3\\nl4\\nl5\\n'; sleep 2"
        driver = driver_dir / "faux-driver.ts"
        driver.write_text(DRIVER % {"pi_ai": json.dumps(str(PI_AI)), "code": json.dumps(code), "bash": json.dumps(bash)})
        agent = tmp / "agent"
        agent.mkdir()
        cached_fd = Path.home() / ".pi/agent/bin/fd"
        if cached_fd.is_file():
            (agent / "bin").mkdir()
            shutil.copy2(cached_fd, agent / "bin/fd")

        def write_settings(packages):
            (agent / "settings.json").write_text(json.dumps({"quietStartup": True, "checkForUpdates": False,
                                                             "packages": packages}))

        write_settings([str(pkg)])

        env = {**os.environ, "PI_CODING_AGENT_DIR": str(agent), "PI_SKIP_VERSION_CHECK": "1", "PI_OFFLINE": "1",
               "TERM": "xterm-256color"}
        for key in list(env):
            if "API_KEY" in key or "AUTH_TOKEN" in key:
                del env[key]

        master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 80, 0, 0))
        command = [node, str(CLI), "--no-skills", "--no-prompt-templates", "--no-session", "-e", "builtin:codemode",
                   "-e", str(driver), "--tools", "+codemode", "--provider", "faux", "--model", "faux-1"]
        proc = subprocess.Popen(command, cwd=work, env=env, stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
        os.close(slave)
        output = bytearray()
        screen = Screen(40, 80)
        decoder = codecs.getincrementaldecoder("utf8")("replace")

        def drain(seconds):
            deadline = time.monotonic() + seconds
            while time.monotonic() < deadline:
                ready, _, _ = select.select([master], [], [], min(0.1, max(0, deadline - time.monotonic())))
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

        def wait_for(name, check, timeout=20):
            deadline = time.monotonic() + timeout
            while True:
                drain(0.1)
                if check():
                    return
                if proc.poll() is not None:
                    fail(name, f"Pi exited early with {proc.returncode}", screen)
                if time.monotonic() > deadline:
                    fail(name, "timed out", screen)

        def summary_rows():
            return [i for i, line in enumerate(lines()) if line.lstrip().startswith(SUMMARY_MARK)]

        def card():
            """(header row, status row, body rows) of the live card, or None."""
            rows = lines()
            heads = [i for i, line in enumerate(rows) if STOCK_BASH in line]
            if not heads:
                return None
            h = heads[-1]
            s = next((i for i in range(h + 1, len(rows)) if rows[i].strip().startswith(STATUS_MARKS)), None)
            if s is None:
                return None
            return h, s, [r.strip() for r in rows[h + 1:s]]

        def answered():
            return any("All done." in line for line in lines())

        try:
            # Pi draws its editor after startup; the keys go in once it has been quiet for a second.
            wait_for("startup output", lambda: len(output) > 0, timeout=20)
            drain(1.5)
            os.write(master, b"go\r")

            # smoke-live-while-working: the summary line, then the live card of b1 while it sleeps.
            def live_ready():
                c = card()
                return c is not None and c[1] is not None and "running" in lines()[c[1]] and "l5" in c[2]
            wait_for("live card with l5", live_ready, timeout=20)
            h, s, body = card()
            rows = lines()
            summaries = summary_rows()
            if not summaries or summaries[0] >= h:
                fail("smoke-live-while-working", "summary line is not above the live card", screen)
            if "running" not in rows[s]:
                fail("smoke-live-while-working", f"status row is {rows[s]!r}", screen)
            if len(body) > 4 or not {"l2", "l3", "l4", "l5"} <= set(body):
                fail("smoke-live-while-working", f"output rows are {body!r}", screen)
            print("PASS smoke-live-while-working")

            # smoke-summary-before-answer
            wait_for("answer text", answered, timeout=20)
            rows = lines()
            summaries = summary_rows()
            answer = next(i for i, line in enumerate(rows) if "All done." in line)
            if len(summaries) != 1 or summaries[0] >= answer:
                fail("smoke-summary-before-answer", f"summary rows {summaries}, answer row {answer}", screen)
            if SUMMARY not in rows[summaries[0]]:
                fail("smoke-summary-before-answer", f"summary is {rows[summaries[0]]!r}", screen)
            print("PASS smoke-summary-before-answer")

            # smoke-live-folds-on-answer
            rows = lines()
            if any("running" in line for line in rows):
                fail("smoke-live-folds-on-answer", "a row still says running", screen)
            if any(STOCK_BASH in line for line in rows):
                fail("smoke-live-folds-on-answer", "a live or stock bash header is visible", screen)
            if any(STOCK_READ_A in line or STOCK_READ_B in line for line in rows):
                fail("smoke-live-folds-on-answer", "a stock read row is visible", screen)
            print("PASS smoke-live-folds-on-answer")

            # smoke-ctrl-o-original: Ctrl+O shows Pi's stock rows in place, no summary; again folds back.
            os.write(master, b"\x0f")
            wait_for("expanded view", lambda: not summary_rows() and any(STOCK_BASH in line for line in lines()), timeout=10)
            # Pi repaints only the 40-row viewport here (rows scrolled above it keep what they showed), so the stock
            # rows are checked where Pi draws them: bash with its output, codemode and the answer, in order.
            rows = lines()
            places = [next((i for i, line in enumerate(rows) if mark in line), None) for mark in (STOCK_BASH, "codemode", "All done.")]
            if None in places or places != sorted(places):
                fail("smoke-ctrl-o-original", f"stock rows in order: {places}", screen)
            if not any(line.strip() == "l5" for line in rows):
                fail("smoke-ctrl-o-original", "stock bash output missing", screen)
            os.write(master, b"\x0f")
            wait_for("folded again", lambda: len(summary_rows()) == 1 and not any(STOCK_BASH in line for line in lines()), timeout=10)
            if any(STOCK_READ_A in line for line in lines()):
                fail("smoke-ctrl-o-original", "stock read row still visible after folding back", screen)
            print("PASS smoke-ctrl-o-original")

            # smoke-width-fit: no row wider than the terminal, at 40 and 24 columns; Pi still alive.
            for cols in (40, 24):
                fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", 40, cols, 0, 0))
                screen.resize(40, cols)
                screen.overflow = 0
                os.kill(proc.pid, signal.SIGWINCH)
                drain(1.0)
                if proc.poll() is not None:
                    fail("smoke-width-fit", f"Pi exited at {cols} columns with {proc.returncode}", screen)
                if screen.overflow:
                    fail("smoke-width-fit", f"{screen.overflow} characters past the right edge at {cols} columns", screen)
                too_wide = [line for line in lines() if display_width(line) > cols]
                if too_wide:
                    fail("smoke-width-fit", f"rows wider than {cols}: {too_wide[:2]!r}", screen)
                if len(summary_rows()) != 1:
                    fail("smoke-width-fit", f"summary rows at {cols} columns: {summary_rows()}", screen)
            fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 80, 0, 0))
            screen.resize(40, 80)
            os.kill(proc.pid, signal.SIGWINCH)
            drain(1.0)
            print("PASS smoke-width-fit")

            # smoke-off-reload-stock: the package filter switches the extension off; /reload; the next call is stock.
            write_settings([{"source": str(pkg), "extensions": ["-extensions/RQW-tool-ui/index.ts"]}])
            os.write(master, b"/reload\r")
            wait_for("Reloaded", lambda: any("Reloaded" in line for line in lines()), timeout=20)
            rows = lines()
            if summary_rows():
                fail("smoke-off-reload-stock", "a summary row is still drawn after switching off", screen)
            if not any(STOCK_BASH in line for line in rows):
                fail("smoke-off-reload-stock", "old calls are not stock rows after /reload", screen)
            os.write(master, b"again\r")
            wait_for("second answer", lambda: any("Fine." in line for line in lines()), timeout=20)
            rows = lines()
            if summary_rows():
                fail("smoke-off-reload-stock", "the new call is drawn as a summary", screen)
            again = next((i for i, line in enumerate(rows) if line.strip() == "again"), None)
            read_b = [i for i, line in enumerate(rows) if STOCK_READ_B in line]
            if again is None or not read_b or read_b[-1] <= again:
                fail("smoke-off-reload-stock", "the new read b.txt is not a stock row after its prompt", screen)
            print("PASS smoke-off-reload-stock")

            # smoke-clean-exit
            os.write(master, b"/quit\r")
            drain(1.0)
            proc.wait(timeout=5)
            if proc.returncode != 0:
                fail("smoke-clean-exit", f"exit code {proc.returncode}", screen)
            try:
                os.killpg(proc.pid, 0)
            except ProcessLookupError:
                pass
            else:
                fail("smoke-clean-exit", "processes survived in the process group", screen)
            print("PASS smoke-clean-exit")
        finally:
            if proc.poll() is None:
                proc.kill()
                proc.wait()
            os.close(master)
    print("ALL PASS " + ", ".join(NAMES))


if __name__ == "__main__":
    main()
