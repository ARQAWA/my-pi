import assert from "node:assert/strict";
import test from "node:test";
import { createTools } from "../../../extensions/RQW-tools/index.ts";

function bash(legacy = false): any {
	return createTools(process.cwd(), () => ({ shellPath: "/nonexistent/rqw-guard-shell" }), { legacy }).find(tool => tool.name === "bash");
}

function message(part: string, legacy = false): string {
	const names = legacy ? ["grep", "find", "read"] : ["rqw_rg", "rqw_glob", "rqw_readfile"];
	return `Blocked: bash does not search, list or read files, so the whole command was not run. Refused part: \`${part}\`. Use ${names[0]} to search file contents, ${names[1]} to find or list files, ${names[2]} to read files. Filtering another command's output through a pipe stays allowed, e.g. git log | grep x.`;
}

const blocked: [string, string][] = [
	["grep -rn x src", "grep -rn x src"], ["rg foo", "rg foo"],
	["cd d && sed -n 1,5p f", "sed -n 1,5p f"], ["git status && cat f", "cat f"],
	["npm test > l && tail l", "tail l"], ["echo \"$(cat f)\"", "cat f"],
	["git ls-files | xargs grep x", "xargs grep x"], ["git log | fd x", "fd x"],
	["ls", "ls"], ["ls -la dist", "ls -la dist"], ["find . -name '*.ts'", "find . -name *.ts"],
	["grep x < f", "grep x"], ["/usr/bin/grep x f", "/usr/bin/grep x f"], ["grep.exe x f", "grep.exe x f"],
	["for f in *.ts; do cat $f; done", "do cat $f"], ["git log | grep -f pats.txt", "grep -f pats.txt"],
	["rg --file=pats.txt", "rg --file=pats.txt"], ["awk -f prog.awk f", "awk -f prog.awk f"],
	["git log | sed -f script.sed", "sed -f script.sed"], ["sed -i -f s.sed f", "sed -i -f s.sed f"],
	["find . -exec printf '%s\\n' {} \\;", "find . -exec printf %s\\n {} ;"],
	["find . -name x -exec rm {} \\;", "find . -name x -exec rm {} ;"],
	["find . -name x -delete -print", "find . -name x -delete -print"],
	["echo $(cat f)", "cat f"], ["echo `cat f`", "cat f"], ["echo <(cat f)", "cat f"],
	["env X=1 timeout 5 grep x f", "env X=1 timeout 5 grep x f"],
	["git log | rg --files", "rg --files"], ["grep -e x f", "grep -e x f"],
	["git log | sed --file=script", "sed --file=script"], ["git log | awk --file prog", "awk --file prog"],
	["git log | grep -r x", "grep -r x"], ["head 3<file", "head"], ["echo ok\r\ncat f", "cat f"],
	["git log | rg -g '*.ts' x src", "rg -g *.ts x src"], ["git log | head --lines 3 f", "head --lines 3 f"],
];

const allowed = [
	"git log | grep x", "npm test 2>&1 | tail -20", "git diff | sed -n 1,5p",
	"cat > f <<'EOF'\ngrep x f\nEOF", "sed -i 's/a/b/' f", "sed -i '' 's/a/b/' f",
	"find . -name '*.pyc' -delete", "echo \"grep x f\"", "# cat f\necho ok", "node x.js < f",
	"git log | rg x", "git log | grep -f -", "git log | awk -f - ",
	"git log | grep -e x", "git log | awk '{print $1}'", "git log | head -n 5",
	"git log | grep -eerror", "git log | sed --expression 's/a/b/'", "git log | rg -g '*.ts' x",
	"git log | awk -v name=value '{print name}'", "echo ok &> file", "cat <<< value",
	"cat > f <<-EOF\n\tgrep x f\n\tEOF\necho ok", "echo ok \\\n| grep x",
];

for (const [command, part] of blocked) {
	test(`refuses ${command}`, async () => {
		await assert.rejects(bash().execute("call/1", { command }), { message: message(part) });
	});
}

for (const command of allowed) {
	test(`allows ${command}`, async () => {
		await assert.rejects(bash().execute("call/1", { command }), /Custom shell path not found/);
	});
}

test("sed combined options recognize in-place writes", async () => {
	await assert.rejects(bash().execute("call/1", { command: "sed -ni 's/a/b/p' file" }), /Custom shell path not found/);
});

test("sed combined file option is refused even with in-place editing", async () => {
	const command = "sed -i -nf script.sed file";
	await assert.rejects(bash().execute("call/1", { command }), { message: message(command) });
});

test("background path and fallback names use the same guard", async () => {
	await assert.rejects(bash().execute("bash-1", { command: "cat f" }), { message: message("cat f") });
	await assert.rejects(bash(true).execute("call/1", { command: "cat f" }), { message: message("cat f", true) });
});
