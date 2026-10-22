// A shell syntax guard, not a sandbox: it does not interpret scripts, aliases or computed command names.
// Keep this independent of the runtime so callers and tests use the same policy.
type Token = { word: string } | { separator: string } | { redirection: string };
type ShellInput = "piped" | "heredoc-fed" | undefined;

/** Quote removal for a literal heredoc delimiter, without expanding it or reading into the body. */
function heredocDelimiter(command: string, start: number): { delimiter: string; quoted: boolean; end: number } | undefined {
	let i = start;
	while (command[i] === " " || command[i] === "\t") i++;
	let delimiter = "", quote = "", quoted = false, active = false;
	for (; i < command.length; i++) {
		const c = command[i];
		if (c === "\n" || (!quote && /[\s;&|()<>]/.test(c))) break;
		if (c === "\\" && quote !== "'") {
			const next = command[++i];
			if (next === undefined) return;
			if (next === "\n") continue;
			if (quote === '"' && !/[\\$`"]/.test(next)) delimiter += "\\";
			delimiter += next; quoted = true; active = true; continue;
		}
		if (quote) {
			if (c === quote) quote = "";
			else delimiter += c;
		} else if (c === "'" || c === '"') { quote = c; quoted = true; }
		else {
			// ANSI-C/locale quoting and executable-looking delimiters need a fuller shell parser.
			if ((c === "$" && /['"(]/.test(command[i + 1] ?? "")) || c === "`" || (c === "#" && !active)) return;
			delimiter += c;
		}
		active = true;
	}
	if (!active || quote) return;
	return { delimiter, quoted, end: i };
}

/** Split shell words without mistaking quoted prose for commands; inspect executable substitutions separately. */
function shellWords(command: string, expandingBody = false): { tokens: Token[]; substitutions: string[]; unchecked?: string } {
	const tokens: Token[] = [];
	const substitutions: string[] = [];
	const heredocs: { delimiter: string; quoted: boolean; stripTabs: boolean }[] = [];
	const unchecked = (reason: string) => ({ tokens, substitutions, unchecked: reason });
	let word = "";
	let active = false;
	let plain = true;
	let quote = "";
	const flush = () => { if (active) tokens.push({ word }); word = ""; active = false; plain = true; };
	for (let i = 0; i < command.length; i++) {
		const c = command[i];
		if (c === "\n" && !quote && !expandingBody) {
			flush(); tokens.push({ separator: "\n" });
			let next = i + 1;
			for (const here of heredocs.splice(0)) {
				let terminated = false, body = "";
				while (next < command.length) {
					let line = "";
					do {
						const newline = command.indexOf("\n", next);
						line += command.slice(next, newline < 0 ? command.length : newline);
						next = newline < 0 ? command.length : newline + 1;
						// Unquoted heredocs join an odd trailing backslash and newline before delimiter matching.
						if (!here.quoted && newline >= 0 && ((/\\+$/.exec(line)?.[0].length ?? 0) % 2 === 1)) {
							line = line.slice(0, -1);
							continue;
						}
						break;
					} while (next < command.length);
					if (here.stripTabs) line = line.replace(/^\t+/, "");
					if (line === here.delimiter) { terminated = true; break; }
					if (!here.quoted) body += `${line}\n`;
				}
				if (!terminated) return unchecked("unterminated heredoc body");
				if (!here.quoted) {
					const expanded = shellWords(body, true);
					if (expanded.unchecked) return unchecked(expanded.unchecked);
					substitutions.push(...expanded.substitutions);
				}
			}
			i = next - 1;
			continue;
		}
		if (c === "\\" && quote !== "'") {
			if (command[i + 1] === "\n") { i++; continue; }
			active = true;
			plain = false;
			word += command[++i] ?? "";
			continue;
		}
		if (quote !== "'" && c === "$" && command[i + 1] === "{") {
			let depth = 1, end = i + 2;
			for (; end < command.length; end++) {
				if (command[end] === "\\") { end++; continue; }
				if (command[end] === "{") depth++;
				if (command[end] === "}" && --depth === 0) break;
			}
			// Parameter expansion is one word, not a brace separator followed by a # comment.
			// Its fallback may still contain executable command substitutions.
			const inner = shellWords(command.slice(i + 2, end), expandingBody);
			if (inner.unchecked) return unchecked(inner.unchecked);
			substitutions.push(...inner.substitutions);
			word += command.slice(i, end + 1);
			active = true;
			plain = false;
			i = end;
			continue;
		}
		if (quote !== "'" && (c === "`" || (c === "$" && command[i + 1] === "("))) {
			const backtick = c === "`";
			const start = i + (backtick ? 1 : 2);
			let depth = 1;
			let innerQuote = "";
			let end = start;
			for (; end < command.length; end++) {
				const ch = command[end];
				if (ch === "\\") { end++; continue; }
				if (backtick) { if (ch === "`") break; continue; }
				if (innerQuote) { if (ch === innerQuote) innerQuote = ""; continue; }
				if (ch === "'" || ch === '"') { innerQuote = ch; continue; }
				if (ch === "(") depth++;
				if (ch === ")" && --depth === 0) break;
			}
			if (end >= command.length && (expandingBody || command.slice(start, end).includes("<<"))) return unchecked("cannot delimit heredoc substitution");
			if (!backtick && command[start] === "(" && command[end - 1] === ")") {
				// Arithmetic is data, but a nested $(command) or backtick still executes.
				const arithmetic = shellWords(command.slice(start + 1, end - 1), true);
				if (arithmetic.unchecked) return unchecked(arithmetic.unchecked);
				substitutions.push(...arithmetic.substitutions);
			} else substitutions.push(command.slice(start, end));
			word += "$(substitution)";
			active = true;
			plain = false;
			i = end;
			continue;
		}
		// Quotes, git words and shell operators in an expanding body are literal text, not shell syntax.
		if (expandingBody) { word += c; active = true; continue; }
		if (quote) {
			if (c === quote) quote = "";
			else word += c;
			continue;
		}
		if (c === "'" || c === '"') { quote = c; active = true; plain = false; continue; }
		if (c === "<" || c === ">" || (c === "&" && command[i + 1] === ">")) {
			const redirection = /^(?:&>>?|<<<|<<-|<<|>>|<>|[<>][&|]|[<>])/.exec(command.slice(i))![0];
			// &> and &>> never take an IO number: in 2&>out, 2 is still a command argument.
			if (c !== "&" && plain && /^\d+$/.test(word)) { word = ""; active = false; }
			else flush();
			tokens.push({ redirection });
			if (redirection === "<<" || redirection === "<<-") {
				const here = heredocDelimiter(command, i + redirection.length);
				if (!here) return unchecked("missing or unsupported heredoc delimiter");
				heredocs.push({ ...here, stripTabs: redirection === "<<-" });
				tokens.push({ word: here.delimiter });
				i = here.end - 1;
				continue;
			}
			i += redirection.length - 1;
			continue;
		}
		if (c === "#" && !active && (i === 0 || /[\s;&|(]/.test(command[i - 1]))) {
			while (i < command.length && command[i] !== "\n") i++;
			i--; continue; // Let the newline handler consume pending heredoc bodies.
		}
		const brace = /[{}]/.test(c) && !active && (i + 1 === command.length || /[\s;&|]/.test(command[i + 1]));
		if (/[;&|()\n]/.test(c) || brace) {
			flush();
			let separator = c;
			if ((c === "|" && /[|&]/.test(command[i + 1] ?? "")) || (c === "&" && command[i + 1] === "&")) separator += command[++i];
			tokens.push({ separator }); continue;
		}
		if (/\s/.test(c)) { flush(); continue; }
		word += c;
		active = true;
	}
	flush();
	if (heredocs.length) return unchecked("missing heredoc body");
	return { tokens, substitutions };
}

const READ_ONLY = new Set(["status", "diff", "log", "show", "blame", "ls-files", "rev-parse", "grep"]);
const GLOBAL_VALUE = new Set(["-C", "--git-dir", "--work-tree", "--namespace"]);
const GLOBAL_FLAG = new Set(["--no-pager", "-P", "--bare", "--no-replace-objects", "--literal-pathspecs", "--glob-pathspecs", "--noglob-pathspecs", "--icase-pathspecs", "--no-optional-locks"]);
const executable = (word: string) => word.split(/[\\/]/).at(-1)?.toLowerCase().replace(/\.exe$/, "");
const denied = (detail: string) => `Workers may not change git state: ${detail}. Ask the caller to run it.`;
const assignment = (word: string) => /^([A-Za-z_][A-Za-z_0-9]*)=/.exec(word);
const dangerousEnv = (name: string) => /^GIT_(?:EXTERNAL_DIFF|SSH_COMMAND|EDITOR|CONFIG_(?:COUNT|KEY_.*|VALUE_.*|PARAMETERS))$/.test(name);

/** Consume listing-option values before looking for positional names or state-changing flags. */
function isListing(args: string[], kind: "branch" | "tag"): boolean {
	let listing = false, positional = false;
	const values = new Set(["--sort", "--format", "--contains", "--no-contains", "--merged", "--no-merged", "--points-at"]);
	const flags = new Set(["--list", "--all", "--remotes", "--verbose", "--show-current", "--color", "--no-color", "--column", "--no-column", "--abbrev", "--no-abbrev", "--ignore-case", "--omit-empty"]);
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--") { positional ||= i + 1 < args.length; break; }
		const option = arg.split("=")[0];
		if (values.has(option)) {
			if (!arg.includes("=")) {
				const optional = ["--contains", "--no-contains", "--merged", "--no-merged"].includes(option);
				if (!optional) { if (++i >= args.length) return false; }
				else if (args[i + 1] && !args[i + 1].startsWith("-")) i++;
			}
			if (kind === "branch" && option !== "--sort" && option !== "--format") listing = true;
			continue;
		}
		if (flags.has(option)) { if (option === "--list") listing = true; continue; }
		if (kind === "branch" && /^-[arvliqt]+$/.test(arg)) {
			if (arg.includes("l")) listing = true;
			continue;
		}
		if (kind === "tag" && (/^-[li]+$/.test(arg) || /^-n\d*$/.test(arg))) {
			if (arg.includes("l")) listing = true;
			continue;
		}
		if (arg.startsWith("-")) return false;
		positional = true;
	}
	return !positional || listing;
}

function gitReason(args: string[], environment: string[]): string | undefined {
	if (environment.some(dangerousEnv)) return denied("git with executable environment overrides");
	let i = 0;
	for (; i < args.length; i++) {
		const arg = args[i];
		if (arg === "-c" || arg.startsWith("-c") || arg === "--config-env" || arg.startsWith("--config-env=") || arg === "-p" || arg === "--paginate")
			return denied(`git ${arg} can execute configured commands`);
		if (GLOBAL_VALUE.has(arg)) { i++; continue; }
		if (GLOBAL_FLAG.has(arg) || /^(?:--(?:git-dir|work-tree|namespace)=|-C.)/.test(arg)) continue;
		break;
	}
	const sub = args[i];
	const rest = args.slice(i + 1);
	const blocked = () => denied(`git ${sub ?? "(unknown command)"}`);
	if (!sub || sub === "--version" || sub === "--help") return undefined;
	if (READ_ONLY.has(sub)) return undefined;
	if (sub === "branch" || sub === "tag") return isListing(rest, sub) ? undefined : blocked();
	if (sub === "remote") return rest.length === 1 && ["-v", "--verbose"].includes(rest[0]) ? undefined : blocked();
	if (sub === "submodule") return ["status", "summary"].includes(rest[0]) ? undefined : blocked();
	if (sub === "config") {
		const reads = new Set(["--get", "--get-all", "--get-regexp", "--get-urlmatch", "--list", "-l", "get", "list"]);
		const writes = /^(?:--(?:add|replace-all|unset|unset-all|rename-section|remove-section|edit)|-e|set|unset|rename-section|remove-section)(?:=|$)/;
		return rest.some(a => reads.has(a)) && !rest.some(a => writes.test(a)) ? undefined : blocked();
	}
	// Unknown commands may be configured aliases that mutate state.
	return blocked();
}

// Options with separate values on launchers. Attached short values and long --key=value stay one word.
const LAUNCH_VALUES: Record<string, readonly string[]> = {
	time: ["-f", "--format", "-o", "--output"], nohup: [], nice: ["-n", "--adjustment"],
	ionice: ["-c", "--class", "-n", "--classdata", "-p", "--pid", "-P", "--pgid", "-u", "--uid"],
	setsid: [], stdbuf: ["-i", "-o", "-e", "--input", "--output", "--error"],
	watch: ["-n", "--interval"], command: [], exec: ["-a"],
	sudo: ["-u", "--user", "-g", "--group", "-h", "--host", "-p", "--prompt", "-C", "--close-from", "-T", "--command-timeout", "-R", "--chroot", "-D", "--chdir"],
	timeout: ["-s", "--signal", "-k", "--kill-after"],
	xargs: ["-a", "--arg-file", "-d", "--delimiter", "-E", "-I", "-L", "-n", "--max-args", "-P", "--max-procs", "-s", "--max-chars", "--process-slot-var"],
};

function inspect(words: string[], input: ShellInput, inherited: string[]): string | undefined {
	let i = 0;
	let environment = [...inherited];
	while (i < words.length) {
		const prefix = assignment(words[i]);
		if (prefix) { environment.push(prefix[1]); i++; }
		else if (["!", "if", "then", "elif", "else", "while", "until", "do"].includes(words[i])) i++;
		else break;
	}
	const name = executable(words[i] ?? "");
	const args = words.slice(i + 1);
	if (name === "env") {
		let n = 0;
		for (; n < args.length; n++) {
			const arg = args[n];
			if (arg === "--") { n++; break; }
			if (arg === "-i" || arg === "--ignore-environment") { environment = []; continue; }
			if (arg === "-u" || arg === "--unset") {
				const unset = args[++n];
				environment = environment.filter(key => key !== unset);
				continue;
			}
			if (arg === "-C" || arg === "--chdir") { n++; continue; }
			if (arg.startsWith("--unset=")) { environment = environment.filter(key => key !== arg.slice(8)); continue; }
			if (arg.startsWith("-")) continue;
			const prefix = assignment(arg);
			if (prefix) { environment.push(prefix[1]); continue; }
			break;
		}
		return inspect(args.slice(n), input, environment);
	}
	if (name === "git" || name === "git.exe") return gitReason(args, environment);
	if (["bash", "sh", "zsh", "dash"].includes(name ?? "")) {
		let stdin = false, script = false;
		for (let n = 0; n < args.length; n++) {
			const arg = args[n];
			if (arg === "--") { script = !stdin && args[n + 1] !== undefined && args[n + 1] !== "-"; break; }
			if (arg === "-" || !/^[+-]/.test(arg)) { script = !stdin && arg !== "-"; break; }
			if (/^-[^-]*c/.test(arg)) {
				if (args[n + 1] !== undefined) return checkShell(args[n + 1], environment, input);
				break;
			}
			if (/^[+-][^-]*s/.test(arg)) stdin = arg.startsWith("-");
			if (/^[+-][^-]*[oO]$/.test(arg) || ["--rcfile", "--init-file"].includes(arg)) n++;
		}
		// A script operand is an external file, not commands from stdin; do not inspect its arguments as flags.
		if (script) return undefined;
		if (input) return `Workers may not execute an unchecked ${input} shell without -c. Ask the caller to run it.`;
		return undefined;
	}
	if (name === "eval") return checkShell(args.join(" "), environment, input);
	if (name === "find") {
		for (let n = 0; n < args.length; n++) if (["-exec", "-execdir", "-ok", "-okdir"].includes(args[n])) {
			let end = n + 1;
			while (end < args.length && args[end] !== ";" && args[end] !== "+") end++;
			const reason = inspect(args.slice(n + 1, end), input, environment);
			if (reason) return reason;
			n = end;
		}
		return undefined;
	}
	if (name && Object.hasOwn(LAUNCH_VALUES, name)) {
		let n = 0;
		while (n < args.length && args[n].startsWith("-")) {
			const arg = args[n++];
			if (arg === "--") break;
			if (name === "command" && /^-[^-]*[vV]/.test(arg)) return undefined; // lookup, not execution
			if (LAUNCH_VALUES[name].includes(arg)) n++;
		}
		if (name === "timeout") n++; // duration precedes the command
		const command = args.slice(n);
		return name === "watch" ? checkShell(command.join(" "), environment, input) : inspect(command, input, environment);
	}
	return undefined;
}

function checkShell(command: string, environment: string[], input?: ShellInput): string | undefined {
	const { tokens, substitutions, unchecked } = shellWords(command);
	if (unchecked) return `Workers may not execute an unchecked heredoc (${unchecked}). Ask the caller to run it.`;
	for (const sub of substitutions) {
		const reason = checkShell(sub, environment);
		if (reason) return reason;
	}
	let words: string[] = [], source = input;
	let redirectionTarget = false, heredocInput = false;
	const scopes: ShellInput[] = [input];
	for (const token of [...tokens, { separator: "" } as Token]) {
		// Shell redirections can occur anywhere in a simple command, including among launcher options.
		// Substitutions in their operands were inspected above; literal targets are not executable words.
		if ("redirection" in token) {
			redirectionTarget = true;
			if (["<<", "<<-", "<<<"].includes(token.redirection)) heredocInput = true;
			continue;
		}
		if ("word" in token) {
			if (!redirectionTarget) words.push(token.word);
			redirectionTarget = false;
		} else {
			redirectionTarget = false;
			const reason = inspect(words, heredocInput ? "heredoc-fed" : source, environment);
			if (reason) return reason;
			words = []; heredocInput = false;
			if (token.separator === "(" || token.separator === "{") scopes.push(source);
			if (token.separator === ")" || token.separator === "}") scopes.pop();
			source = token.separator === "|" || token.separator === "|&" ? "piped" : scopes.at(-1);
		}
	}
	return undefined;
}

/** Return a tool-error reason for a non-read-only git invocation anywhere in a shell command line. */
export function blockedGit(command: string): string | undefined {
	return checkShell(command, []);
}
