# Install my-pi

Give this file to a coding agent on a new machine: it rebuilds the working Pi from scratch.

1. Install Node.js 22.19 or newer if `node --version` is older or missing.
2. Install Pi: `npm install -g --ignore-scripts @earendil-works/pi-coding-agent@1.3.0`. Check with `pi --version`.
3. Install this package: `pi install git:github.com/ARQAWA/my-pi`. It is written to `~/.pi/agent/settings.json` under `packages`.
4. Check: `pi list` shows `git:github.com/ARQAWA/my-pi`.
5. Log in to a provider inside Pi with `/login` if `~/.pi/agent/auth.json` has none.

Update later with `pi update --extensions`.
