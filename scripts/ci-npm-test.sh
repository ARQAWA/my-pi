#!/usr/bin/env bash
# CI only: runs package.json's `test` script with the log output Node gives by default and a TAP copy in the file $1.
# A test file whose process dies (crash, signal, exit) shows in the spec output only as 'test failed'; the TAP copy
# carries its exitCode and signal. Node 23+ logs spec by default, Node 22 logs TAP when stdout is not a terminal.
set -euo pipefail
tap=$1
script=$(node -p 'require("./package.json").scripts.test')
prefix='node --test '
[[ $script == "$prefix"* ]] || { echo "scripts.test does not start with '$prefix': $script" >&2; exit 1; }
node -e 'require("fs").mkdirSync(require("path").dirname(process.argv[1]), { recursive: true })' "$tap"
default=tap
if [[ -t 1 ]] || (( $(node -p 'process.versions.node.split(".")[0]') >= 23 )); then default=spec; fi
echo "> $script (TAP copy: $tap)"
# eval keeps the quoting of the test globs in the script.
eval "node --test --test-reporter=$default --test-reporter-destination=stdout --test-reporter=tap --test-reporter-destination=\"\$tap\" ${script#"$prefix"}"
