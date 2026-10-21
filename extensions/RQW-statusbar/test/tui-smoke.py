"""Run the real Pi CLI in an isolated PTY, with no prompt or model request.
Usage: python3 extensions/RQW-statusbar/test/tui-smoke.py [node executable]
"""
import errno
import fcntl
import json
import os
from pathlib import Path
import pty
import re
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



class Screen:
    """Just enough of a terminal to replay Pi's output: text, CR/LF with scrolling, cursor moves and erases."""

    def __init__(self, rows, cols):
        self.rows, self.cols = rows, cols
        self.grid = [[" "] * cols for _ in range(rows)]
        self.row = self.col = 0
        self.pending = ""

    def resize(self, rows, cols):
        self.grid = [(line + [" "] * cols)[:cols] for line in self.grid[-rows:]]
        self.grid = [[" "] * cols for _ in range(rows - len(self.grid))] + self.grid
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


repo = Path(__file__).resolve().parents[3]
node = sys.argv[1] if len(sys.argv) > 1 else shutil.which("node")
with tempfile.TemporaryDirectory(prefix="rqw-status-pty-") as tmp:
    agent = Path(tmp) / "agent"
    agent.mkdir()
    cached_fd = Path.home() / ".pi/agent/bin/fd"
    if cached_fd.is_file():
        (agent / "bin").mkdir()
        shutil.copy2(cached_fd, agent / "bin/fd")
    # A local model description gives Pi a context window; it is never called (no prompt is sent).
    (agent / "models.json").write_text(json.dumps({"providers": {"smoke": {
        "baseUrl": "http://127.0.0.1:9/v1", "api": "openai-completions", "apiKey": "fake-local-only",
        "models": [{"id": "smoke-model", "contextWindow": 200000, "maxTokens": 1000}]}}}))
    (agent / "settings.json").write_text(json.dumps({"quietStartup": True, "checkForUpdates": False,
                                                     "defaultProvider": "smoke", "defaultModel": "smoke-model"}))
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 32, 80, 0, 0))
    env = {**os.environ, "PI_CODING_AGENT_DIR": str(agent), "PI_SKIP_VERSION_CHECK": "1", "PI_OFFLINE": "1",
           "TERM": "xterm-256color"}
    # This isolated agent has no credentials; only slash commands are sent.
    for key in list(env):
        if "API_KEY" in key or "AUTH_TOKEN" in key:
            del env[key]
    command = [node, str(repo / "node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
               "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-session",
               "-e", str(repo / "extensions/RQW-statusbar/index.ts")]
    proc = subprocess.Popen(command, cwd=tmp, env=env, stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
    os.close(slave)
    output = bytearray()
    screen = Screen(32, 80)
    decoder = __import__("codecs").getincrementaldecoder("utf8")("replace")

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

    label = "0% 0k/183.6k"  # 200k window minus Pi's default 16384-token reserve
    # The editor's top border ends with the session ID (a UUIDv7 even with --no-session) between rule cells.
    top_with_id = re.compile("^\u2500{2,} ([0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}) \u2500\u2500$")
    session_ids = set()

    def show():
        return "\n".join(screen.lines())

    def bar_layout(hint=None):
        """The context bar is the editor's bottom border, directly above the model row of a two-row footer."""
        lines = screen.lines()
        bars = [i for i, line in enumerate(lines) if label in line]
        assert len(bars) == 1, show()
        bar = bars[0]
        assert lines[bar][0] in "\u2500\u2501" + ("\u2193" if hint else ""), show()
        if hint:
            assert lines[bar].startswith(hint), show()
        assert "smoke-model" in lines[bar + 1] and "cmp 0" in lines[bar + 1], show()
        assert lines[bar + 2].strip() and not any(c in lines[bar + 2] for c in "\u2500\u2501"), show()
        assert bar + 3 == len(lines) or not lines[bar + 3].strip(), show()
        tops = [i for i in range(bar) if len(lines[i]) == screen.cols and top_with_id.match(lines[i])]
        assert tops, show()
        session_ids.add(top_with_id.match(lines[tops[-1]]).group(1))
        assert len(session_ids) == 1, session_ids
        return bar

    try:
        deadline = time.monotonic() + 20
        while b"cmp 0" not in output and time.monotonic() < deadline and proc.poll() is None:
            drain(0.25)
        drain(0.5)
        initial = bytes(output).decode("utf8", "replace")
        assert "cmp 0" in initial, initial[-8000:]
        bar_layout()
        os.write(master, b"/statusbar off\r")
        drain(1)
        stock = screen.lines()
        assert not any(label in line or "cmp 0" in line for line in stock), show()
        borders = [i for i, line in enumerate(stock) if line == "\u2500" * screen.cols]
        assert len(borders) >= 2, show()  # Pi's stock editor: plain top and bottom rules
        os.write(master, b"/statusbar on\r")
        drain(1)
        bar_layout()
        # 15 input lines (ctrl+j inserts a newline) in a 32-row terminal: 9 visible; from the top, 6 hidden below.
        os.write(master, b"\n".join(b"line %d" % i for i in range(15)))
        drain(0.5)
        os.write(master, b"\x1b[A" * 14)
        drain(1)
        bar_layout(hint="\u2193 6 more ")
        os.write(master, b"\x03")  # Pi clears the editor
        drain(0.5)
        bar_layout()
        fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", 32, 24, 0, 0))
        screen.resize(32, 24)
        os.kill(proc.pid, signal.SIGWINCH)
        drain(0.5)
        # 24 columns cannot hold the 36-character ID: it is dropped, never cut, and the top border is a plain rule.
        narrow = screen.lines()
        bar = [i for i, line in enumerate(narrow) if line.startswith("\u2500") and "/183.6k" in line]
        assert bar and narrow[bar[-1] - 2] == "\u2500" * 24, show()
        assert not any(next(iter(session_ids))[:8] in line for line in narrow), show()
        os.write(master, b"/quit\r")
        drain(1)
        proc.wait(timeout=5)
        assert proc.returncode == 0, proc.returncode
        print("PTY PASS: real Pi CLI, context bar as the editor's bottom border above a two-row footer, stock editor and "
              "footer when off, back on, '\u2193 6 more' hint with the bar, session ID at the end of the top border, "
              "resize 80 -> 24 drops the ID, clean exit; no prompt sent")
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait()
        os.close(master)
