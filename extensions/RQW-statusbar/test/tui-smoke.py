"""Run the real Pi CLI in an isolated PTY, with no prompt or model request.
Usage: python3 extensions/RQW-statusbar/test/tui-smoke.py [node executable]
"""
import errno
import fcntl
import json
import os
from pathlib import Path
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

repo = Path(__file__).resolve().parents[3]
node = sys.argv[1] if len(sys.argv) > 1 else shutil.which("node")
with tempfile.TemporaryDirectory(prefix="rqw-status-pty-") as tmp:
    agent = Path(tmp) / "agent"
    agent.mkdir()
    cached_fd = Path.home() / ".pi/agent/bin/fd"
    if cached_fd.is_file():
        (agent / "bin").mkdir()
        shutil.copy2(cached_fd, agent / "bin/fd")
    (agent / "settings.json").write_text(json.dumps({"quietStartup": True, "checkForUpdates": False}))
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 32, 80, 0, 0))
    env = {**os.environ, "PI_CODING_AGENT_DIR": str(agent), "PI_SKIP_VERSION_CHECK": "1", "TERM": "xterm-256color"}
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
                # Answer only terminal capability queries, never a model prompt.
                if b"\x1b[6n" in data:
                    os.write(master, b"\x1b[1;1R")
                if b"\x1b[c" in data:
                    os.write(master, b"\x1b[?1;2c")

    try:
        deadline = time.monotonic() + 20
        while b"cmp 0" not in output and time.monotonic() < deadline and proc.poll() is None:
            drain(0.25)
        initial = bytes(output).decode("utf8", "replace")
        assert "cmp 0" in initial, initial[-8000:]
        assert "no-model" in initial or "unknown" in initial, initial[-8000:]
        os.write(master, b"/statusbar off\r")
        drain(1)
        os.write(master, b"/statusbar on\r")
        drain(1)
        assert bytes(output).decode("utf8", "replace").count("cmp 0") >= 2
        fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", 32, 24, 0, 0))
        os.kill(proc.pid, signal.SIGWINCH)
        drain(0.5)
        os.write(master, b"/quit\r")
        drain(1)
        proc.wait(timeout=5)
        assert proc.returncode == 0, proc.returncode
        print("PTY PASS: real Pi CLI, no-available-model footer (Pi unknown sentinel), off/on, resize 80 -> 24, clean exit; no prompt sent")
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait()
        os.close(master)
