# Install my-pi into this Pi

You are running inside Pi. Install the my-pi package into this Pi installation, then report the result in one short message.

0. Run `pi --version`. The package is built and tested for Pi 1.3.0. If the version differs, tell the user and stop:
   the tools wrap Pi's own tool code, which may change between versions.
1. Run `pi list`. If it already shows `git:github.com/ARQAWA/my-pi`, run `pi update git:github.com/ARQAWA/my-pi` and skip step 2.
2. Run `pi install git:github.com/ARQAWA/my-pi`. It writes the package to `~/.pi/agent/settings.json` under `packages`.
3. Run `pi list` again and check that it shows `git:github.com/ARQAWA/my-pi`.
4. Tell the user to run `/reload` in this session, or to restart Pi, so the package's extensions load.

Change nothing else: no other packages, settings or files.
