import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { blockedGit } from "../git-guard.ts";

const mutations = [
	"commit -m done", "add .", "rm file.ts", "mv old.ts new.ts", "restore file.ts", "reset --hard",
	"checkout main", "switch main", "branch new", "branch -d old", "branch -D old", "branch -m renamed",
	"branch -M old new", "branch -c copy", "branch --create-reflog new", "merge topic", "rebase main",
	"cherry-pick abc123", "revert abc123", "am patch.mbox", "apply patch.diff", "stash", "stash pop",
	"tag v1", "tag -a v1 -m release", "tag -d v1", "tag --delete v1", "tag -f v1", "push",
	"pull", "fetch", "clean -fd", "worktree add ../copy", "submodule update --init",
	"submodule add https://example.test/repo", "config user.name Reviewer", "config --global user.name Reviewer",
	"config --add remote.origin.url somewhere", "config --unset user.name", "config --edit",
	"config set user.name Reviewer", "gc", "update-ref refs/heads/main abc123",
];

const reads = [
	"status", "status --short", "diff", "diff --cached", "log -5 --oneline", "show HEAD", "blame file.ts",
	"ls-files", "rev-parse --show-toplevel", "grep needle", "branch", "branch -a", "branch -r", "branch -avv",
	"branch --list 'topic*'", "branch --show-current", "branch --contains HEAD", "branch --merged main",
	"branch --no-merged=main", "branch --format='%(refname:short)'", "remote -v", "config --get user.name",
	"config --global --get user.name", "config --file .git/config --get remote.origin.url",
	"config --get-all remote.origin.fetch", "config --list", "config get user.name", "tag", "tag --list 'v*'",
	"tag -l", "submodule status", "submodule summary", "--version", "--help",
];

describe("reviewer git guard", () => {
	for (const args of mutations) it(`blocks git ${args}`, () => {
		assert.match(blockedGit(`git ${args}`) ?? "", /may not change git state/);
	});
	for (const args of reads) it(`allows git ${args}`, () => {
		assert.equal(blockedGit(`git ${args}`), undefined);
	});

	const forms = [
		(args: string) => `printf ready && git ${args}`,
		(args: string) => `printf ready; git ${args}`,
		(args: string) => `false || git ${args}`,
		(args: string) => `printf ready | git ${args}`,
		(args: string) => `printf ready & git ${args}`,
		(args: string) => `printf ready\ngit ${args}`,
		(args: string) => `(git ${args})`,
		(args: string) => `{ git ${args}; }`,
		(args: string) => `git -C 'a repo' ${args}`,
		(args: string) => `git -Ca-repo --no-pager ${args}`,
		(args: string) => `git --git-dir=.git --work-tree . ${args}`,
		(args: string) => `FOO=bar GIT_TERMINAL_PROMPT=0 git ${args}`,
		(args: string) => `env FOO=bar git ${args}`,
		(args: string) => `env -u FOO -- GIT_TERMINAL_PROMPT=0 git ${args}`,
		(args: string) => `command git ${args}`,
		(args: string) => `if git ${args}; then printf done; fi`,
		(args: string) => `printf '%s' "$(git ${args})"`,
		(args: string) => `printf '%s' \`git ${args}\``,
		(args: string) => `bash -lc 'git ${args}'`,
		(args: string) => `sh -c 'git ${args}'`,
		(args: string) => `/usr/bin/git ${args}`,
		(args: string) => `'C:\\Program Files\\Git\\cmd\\git.exe' ${args}`,
		(args: string) => `g"i"t ${args}`,
		(args: string) => `gi\\t ${args}`,
		(args: string) => `git \\\n${args}`,
	];
	for (const form of forms) it(`finds mutations and permits reads in ${form("...")}`, () => {
		for (const args of mutations) assert.ok(blockedGit(form(args)), form(args));
		for (const args of ["status", "diff", "branch --list", "config --get user.name"])
			assert.equal(blockedGit(form(args)), undefined, form(args));
	});

	it("does not confuse literal text or comments with executable git", () => {
		for (const command of [
			"echo git commit", "printf '%s' 'git push'", 'printf "%s" "git reset --hard"',
			"# git commit\ngit status", "echo done # git push", "printf '%s' '$(git push)'",
			"git grep 'git commit'", "git log --grep='git push'", "npm test",
		]) assert.equal(blockedGit(command), undefined, command);
	});
	it("inspects every chained command and nested executable substitution", () => {
		for (const command of [
			"git status && git diff; git commit -m done", "git log | git push", "echo $(echo $(git push))",
			"printf '%s' \"$(printf '%s' x; git reset --hard)\"", "bash -c 'git status && git push'",
			"git status\n# ignored\ngit push",
		]) assert.ok(blockedGit(command), command);
	});
	it("listing flags cannot hide branch, tag or config writes", () => {
		for (const command of [
			"git branch --list -d topic", "git branch --list --delete topic", "git branch --list --move topic",
			"git tag --list -d v1", "git tag --list --force v1", "git branch --contains -d topic",
			"git tag --contains -d v1", "git tag --merged --delete v1", "git config --get --unset user.name",
			"git config --list --add user.name Reviewer", "git config get --edit",
		]) assert.ok(blockedGit(command), command);
	});
	it("unwraps launchers recursively before inspecting git", () => {
		for (const launcher of [
			"time", "time -p", "time -f %C -o /tmp/time-log", "nohup", "nice -n 5", "nice --adjustment=5",
			"ionice -c 2 -n 7", "setsid -f", "stdbuf -oL", "stdbuf --output L", "watch -n 1",
			"command -p", "sudo -u reviewer", "sudo --user=reviewer", "timeout -k 1s -s TERM 3s", "/usr/bin/timeout.exe 3s",
			"timeout --foreground --kill-after=1s -- 3s", "xargs -0 -r", "xargs -n 1 -P 2", "xargs -I{}", "xargs --replace", "xargs --replace={}",
			"env FOO=bar timeout 3s nice -n 2 sudo -u reviewer command -p",
		]) {
			assert.ok(blockedGit(`${launcher} git add .`), launcher);
			assert.equal(blockedGit(`${launcher} git status`), undefined, launcher);
		}
		assert.ok(blockedGit('watch -n 1 "git add ."'));
		assert.ok(blockedGit("eval 'git add .'"));
		assert.ok(blockedGit("eval git add ."));
		assert.equal(blockedGit("eval 'git status'"), undefined);
	});
	it("command lookup options do not execute git or its redirections", () => {
		for (const command of [
			"command -v git >/dev/null 2>&1 || echo missing", "command -v git 2>/dev/null",
			"command -V git 2>/dev/null", "command -pv git", "command -pV git", "command -p -v git",
			"command -v git add .", "printf text | command -v bash",
		]) assert.equal(blockedGit(command), undefined, command);
		assert.ok(blockedGit("command -v git || git add ."), "a lookup cannot hide later executed git");
		assert.ok(blockedGit("command -p git add ."), "execution still re-inspects the command");
	});
	it("skips redirections and operands when locating git through assignments and launchers", () => {
		for (const redirection of [
			">/tmp/reviewer-git.log", "> /tmp/reviewer-git.log", ">>/tmp/log", ">> /tmp/log",
			"</tmp/input", "< /tmp/input", "2>/tmp/log", "2> /tmp/log", "&>/tmp/log", "&> /tmp/log",
			"&>>/tmp/log", "&>> /tmp/log", "2>&1", "2>& 1", "9>&8", "0<&3", "0<& 3", "2>&-",
			"<<<input", "<<< input", "<<<'git reset --hard'",
			"3<>/tmp/input", "3<> /tmp/input", ">|/tmp/log", ">| /tmp/log",
		]) for (const form of [
			(args: string) => `${redirection} git ${args}`,
			(args: string) => `FOO=bar ${redirection} BAR=baz nohup git ${args}`,
			(args: string) => `env FOO=bar ${redirection} timeout ${redirection} 3s command ${redirection} -p ${redirection} git ${args}`,
			(args: string) => `git ${redirection} ${args}`,
		]) {
			for (const args of ["reset --hard", "add .", "branch new", "tag v1"])
				assert.ok(blockedGit(form(args)), form(args));
			for (const args of ["status", "diff", "branch --list", "config --get user.name"])
				assert.equal(blockedGit(form(args)), undefined, form(args));
		}
	});
	it("redirection targets remain distinct from command separators and literal arguments", () => {
		for (const command of [
			"git>/tmp/log reset --hard", "git 2>/tmp/log branch new", ">/tmp/out 2>/tmp/err git push",
			"printf ready && >/tmp/log git reset --hard", "(2>&1 git add .)",
			"bash -c '> /tmp/log git reset --hard'", "watch -n 1 '> /tmp/log git add .'",
			">/tmp/log GIT_EDITOR=unsafe git status", "FOO=bar 2>/tmp/log GIT_EDITOR=unsafe git status",
			"git branch '2'>/tmp/log", 'git branch "2">/tmp/log', "git branch \\2>/tmp/log", "git branch 2''>/tmp/log",
			"git branch '>'", "git branch '2>&1'", ">$(git push) git status", '> "$(git reset --hard)" git status',
			"<<'END' git reset --hard\npayload\nEND",
		]) assert.ok(blockedGit(command), command);
		for (const command of [
			"git>/tmp/log status", "git 2>/tmp/log branch --list", ">/tmp/out 2>/tmp/err git diff",
			"2>&1 git status && git diff", "printf ready | &>/tmp/log git status",
			"command > /tmp/log -v git", "git grep '>'", "git grep '2>&1'",
			"printf '%s' '>log git reset --hard'", "printf '%s' \\>log git reset --hard",
			">'$(git reset --hard)' git status", ">$(git status) git diff",
			"<<'END' git status\npayload\nEND", "<<<'git reset --hard' git status",
		]) assert.equal(blockedGit(command), undefined, command);
	});
	it("heredoc bodies cannot hide later git commands or turn literal quotes/git words into commands", () => {
		assert.ok(blockedGit("cat <<'END'\ndon't\nEND\ngit reset --hard"));
		for (const marker of ["<<END", "<< END", "<<'END'", "<< 'END'", '<<"END"', "<<\\END", "<<E'N'D", "<<'END' # comment"]) {
			const input = `cat ${marker}\ndon't\ngit push\n\"\nEND\n`;
			assert.ok(blockedGit(`${input}git reset --hard`), marker);
			assert.equal(blockedGit(`${input}git status`), undefined, marker);
		}
		for (const marker of ["<<-END", "<<- END", "<<-'END'", '<<- "END"']) {
			const input = `cat ${marker}\n\tdon't\n\tgit push\n\t\tEND\n`;
			assert.ok(blockedGit(`${input}git reset --hard`), marker);
			assert.equal(blockedGit(`${input}git status`), undefined, marker);
		}
		assert.equal(blockedGit("cat <<''\ngit push\ndon't\n\ngit status"), undefined);
		assert.equal(blockedGit("cat <<'END'\n$(git reset --hard)\n`git push`\nEND\ngit status"), undefined);
	});
	it("consumes multiple heredoc bodies in declaration order before resuming shell parsing", () => {
		const input = "cat <<'FIRST' <<-SECOND\ndon't\nSECOND\ngit push\nFIRST\n\tisn't\n\tgit reset --hard\n\tSECOND\n";
		assert.ok(blockedGit(`${input}git reset --hard`));
		assert.equal(blockedGit(`${input}git status`), undefined);
		for (const marker of ["<<END", "<< END", "<<'END'", "<< 'END'", "<<-'END'", "<<- 'END'"]) {
			for (const args of ["reset --hard", "status"]) for (const input of [
				`${marker} git ${args}\npayload\nEND`,
				`FOO=bar ${marker} BAR=baz nohup git ${args}\npayload\nEND`,
				`env FOO=bar ${marker} command ${marker} -p git ${args}\npayload\nEND\npayload\nEND`,
				`git ${marker} ${args}\npayload\nEND`,
			]) {
				if (args === "status") assert.equal(blockedGit(input), undefined, input);
				else assert.ok(blockedGit(input), input);
			}
		}
	});
	it("blocks unterminated or unsupported heredocs as unchecked", () => {
		for (const input of [
			"cat <<END", "cat <<END\ndon't\ngit status", "cat <<'END\npayload\nEND\ngit status",
			"cat <<\npayload\nEND\ngit status", "cat <<A <<B\npayload\nA\nmissing B",
			"cat <<END\npayload\n END\ngit status", "cat <<-END\npayload\n END\ngit status",
			"cat <<$'END'\npayload\nEND\ngit status", "cat <<$(printf END)\npayload\nEND\ngit status",
			"cat <<END\nbody\\\nEND\ngit status",
			"printf '%s' \"$(cat <<'END'\ndon't\nEND\n)\"\ngit reset --hard",
		]) assert.match(blockedGit(input) ?? "", /unchecked heredoc/, input);
	});
	it("heredoc data cannot become an unchecked bare shell script", () => {
		for (const shell of ["sh", "bash", "command -p sh", "env FOO=bar timeout 3s bash -s", "sh -c bash"]) {
			assert.match(blockedGit(`${shell} <<'END'\ngit reset --hard\nEND`) ?? "", /unchecked heredoc-fed shell/, shell);
			assert.match(blockedGit(`${shell} <<<'git reset --hard'`) ?? "", /unchecked heredoc-fed shell/, shell);
		}
		assert.match(blockedGit("cat <<'END' | sh\ngit reset --hard\nEND") ?? "", /unchecked piped shell/);
		assert.equal(blockedGit("sh -c 'git status' <<'END'\ndon't\ngit reset --hard\nEND"), undefined);
	});
	it("expanding heredoc bodies inspect substitutions while arithmetic and ordinary quotes stay data", () => {
		for (const command of [
			"cat <<EOF > config.env\nROOT=$(pwd)\nPORT=$((BASE_PORT + 1))\nEOF",
			"cat <<EOF\ndon't\nROOT=$(git rev-parse --show-toplevel)\nPORT=$((2 * (BASE_PORT + 1)))\nEOF\ngit status",
			"cat <<EOF\nROOT=`pwd`\nLITERAL=\\$(git reset --hard)\nEOF",
			"cat <<EOF\nROOT=$(printf '%s' \"$(pwd)\")\nPORT=$((BASE_PORT + $(printf 1)))\nEOF",
			"cat <<EOF\nROOT=${ROOT:-$(pwd)}\nEOF",
		]) assert.equal(blockedGit(command), undefined, command);
		for (const command of [
			"cat <<EOF\nROOT=$(git reset --hard)\nEOF", "cat <<EOF\nROOT=`git reset --hard`\nEOF",
			"cat <<EOF\nPORT=$((BASE_PORT + $(git reset --hard)))\nEOF",
			"cat <<EOF\nROOT=$(printf '%s' \"$(git reset --hard)\")\nEOF",
			"cat <<EOF\nROOT=${ROOT:-$(git reset --hard)}\nEOF",
		]) assert.match(blockedGit(command) ?? "", /may not change git state/, command);
	});
	it("heredoc backslash-newline joining permits plain data and preserves real terminator boundaries", () => {
		for (const command of [
			"cat <<EOF\npath=C:\\\nsubdir\nEOF\ngit status",
			"cat <<EOF\npath=C:\\\\\nEOF\ngit status",
			"cat <<'EOF'\npath=C:\\\nEOF\ngit status",
			"cat <<EOF\nROOT=$\\\n(pwd)\nEOF\ngit status",
		]) assert.equal(blockedGit(command), undefined, command);
		for (const command of [
			"cat <<EOF\nEO\\\nF\ngit reset --hard",
			"cat <<EOF\nROOT=$\\\n(git reset --hard)\nEOF",
		]) assert.match(blockedGit(command) ?? "", /may not change git state/, command);
		assert.match(blockedGit("cat <<EOF\nbody\\\nEOF\ngit status") ?? "", /unchecked heredoc/);
	});
	it("shell script operands accept stdin data without allowing bare or -s shells", () => {
		for (const shell of [
			"bash scripts/check.sh", "bash -eu scripts/check.sh", "bash -- scripts/check.sh",
			"bash -o pipefail scripts/check.sh", "bash --rcfile shell.rc scripts/check.sh",
			"sh scripts/check.sh", "command -p bash scripts/check.sh", "env FOO=bar bash scripts/check.sh",
			"bash scripts/check.sh -c 'git reset --hard'", "bash scripts/check.sh -s",
		]) {
			assert.equal(blockedGit(`${shell} <<'INPUT'\nyes\nINPUT`), undefined, shell);
			assert.equal(blockedGit(`printf yes | ${shell}`), undefined, shell);
		}
		for (const shell of ["bash", "sh -s", "sh -s ignored-arg", "bash -o pipefail", "bash --", "bash -", "bash -s -- scripts/check.sh"]) {
			assert.match(blockedGit(`${shell} <<INPUT\nyes\nINPUT`) ?? "", /unchecked heredoc-fed shell/, shell);
			assert.match(blockedGit(`printf yes | ${shell}`) ?? "", /unchecked piped shell/, shell);
		}
	});
	it("numeric arguments before combined-output redirections are not IO descriptors", () => {
		for (const command of ["git branch 2&>/tmp/log", "git tag 2&>>/tmp/log", "git branch 2&>>/tmp/log", "git tag 2&>/tmp/log"])
			assert.ok(blockedGit(command), command);
		for (const command of ["git status 2&>/tmp/log", "git diff 2&>>/tmp/log", "git branch 2>/tmp/log", "git tag 2>>/tmp/log"])
			assert.equal(blockedGit(command), undefined, command);
	});
	it("inspects find executable actions including chained launchers", () => {
		for (const action of ["-exec", "-execdir", "-ok", "-okdir"]) for (const end of ["\\;", "+"]) {
			assert.ok(blockedGit(`find . ${action} git add {} ${end}`));
			assert.ok(blockedGit(`find . ${action} timeout 3s sudo -u reviewer git add {} ${end}`));
			assert.equal(blockedGit(`find . ${action} git status ${end}`), undefined);
		}
		assert.ok(blockedGit("find . -exec echo {} \\; -exec git add . \\;"));
		assert.ok(blockedGit("find . -exec bash -c 'git add .' \\;"));
	});
	it("blocks piped bare shells but not explicit read-only shell commands or OR lists", () => {
		for (const shell of ["sh", "bash", "zsh", "dash", "command -p sh", "timeout 3s bash -s", "xargs sh", "(bash)", "{ echo ready; bash; }", "sh -c bash"]) {
			const reason = blockedGit(`printf 'git add .' | ${shell}`) ?? "";
			assert.match(reason, /unchecked piped shell/, shell);
			assert.doesNotMatch(reason, /may not change git state/, shell);
		}
		assert.match(blockedGit("printf 'echo ready' | sh") ?? "", /unchecked piped shell/);
		assert.equal(blockedGit("printf text | sh -c 'git status'"), undefined);
		assert.equal(blockedGit("false || bash"), undefined);
		assert.equal(blockedGit("printf text | cat"), undefined);
	});
	it("parameter-length expansions cannot hide later git behind a false comment", () => {
		for (const expansion of ["${#PATH}", "${#arr[@]}", "${var:-${#PATH}}", '"${#PATH}"']) {
			assert.ok(blockedGit(`echo ${expansion}; git add .`), expansion);
			assert.equal(blockedGit(`echo ${expansion}; git status`), undefined, expansion);
		}
		assert.ok(blockedGit("echo ${var:-$(git add .)}"));
		assert.equal(blockedGit("echo ${#PATH} # git add ."), undefined);
	});
	it("blocks git execution overrides in global options and environment prefixes", () => {
		for (const option of ["-c alias.s=!touch", "-calias.s=!touch", "--config-env alias.s=COMMAND", "--config-env=alias.s=COMMAND", "-p", "--paginate"])
			assert.ok(blockedGit(`git ${option} status`), option);
		for (const name of ["GIT_EXTERNAL_DIFF", "GIT_SSH_COMMAND", "GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0", "GIT_CONFIG_PARAMETERS", "GIT_EDITOR"]) {
			for (const form of [`${name}=unsafe git status`, `env ${name}=unsafe timeout 3s git diff`, `${name}=unsafe bash -c 'git log'`])
				assert.ok(blockedGit(form), form);
			assert.equal(blockedGit(`${name}=value echo git status`), undefined, name);
		}
		assert.equal(blockedGit("env -u GIT_PAGER git status"), undefined);
		assert.equal(blockedGit("GIT_PAGER=unsafe env -u GIT_PAGER git status"), undefined);
		assert.equal(blockedGit("git --no-pager status"), undefined);
	});
	it("allows pager and non-injecting git config environment settings", () => {
		for (const command of [
			"GIT_PAGER=cat git log", "PAGER=cat git diff", "GIT_CONFIG_NOSYSTEM=1 git status",
			"GIT_CONFIG_GLOBAL=/dev/null git status", "env GIT_PAGER=cat PAGER=cat git log",
		]) assert.equal(blockedGit(command), undefined, command);
		assert.ok(blockedGit("GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.pager GIT_CONFIG_VALUE_0=unsafe git log"));
		assert.ok(blockedGit("GIT_PAGER=cat git -p log"), "forced pagination remains blocked");
		assert.ok(blockedGit("PAGER=cat git --paginate diff"));
	});
	it("permits branch and tag listing flags with separately consumed option values", () => {
		for (const args of [
			"branch -l", "branch -l 'topic*'", "branch -li 'topic*'", "branch -i", "branch -q", "branch -t", "branch -liqt", "branch --sort -committerdate",
			"branch --sort -committerdate --list 'topic*'", "branch --contains HEAD --sort -refname",
			"tag -n", "tag -n5", "tag --sort -version:refname", "tag --contains HEAD", "tag --contains", "branch --contains", "tag --merged", "tag --points-at HEAD",
			"tag -l", "tag -n --sort -refname --contains HEAD --points-at HEAD", "tag --sort -refname -l 'v*'",
		]) assert.equal(blockedGit(`git ${args}`), undefined, args);
		for (const args of ["branch -t new", "branch -l -d new", "branch --sort -refname new", "tag -n new", "tag --contains HEAD new", "tag --sort -refname -a new"])
			assert.ok(blockedGit(`git ${args}`), args);
	});
	it("fails closed for git aliases and unknown global options", () => {
		assert.ok(blockedGit("git publish"));
		assert.ok(blockedGit("git --unknown push"));
	});
});
