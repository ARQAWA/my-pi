type Part = { words: string[]; piped: boolean; input: boolean };
type Frame = { part: Part; word: string; started: boolean; quote: string; redirect: string; heredocs: { end: string; tabs: boolean }[] };

const listing = new Set(["find", "fd", "fdfind", "ls", "tree"]);
const searching = new Set(["grep", "egrep", "fgrep", "rg"]);
const reading = new Set(["cat", "tac", "head", "tail", "sed", "awk", "gawk", "less", "more", "nl", "bat"]);
const scripts = new Set(["grep", "egrep", "fgrep", "rg", "sed", "awk", "gawk"]);

function lex(command: string): Part[] {
	const text = command.replace(/\r\n/g, "\n").replace(/\\\n/g, "");
	const parts: Part[] = [];
	const frame = (piped = false): Frame => ({ part: { words: [], piped, input: false }, word: "", started: false, quote: "", redirect: "", heredocs: [] });
	const stack = [frame()];
	let current = stack[0];
	const word = () => {
		if (!current.started) return;
		if (current.redirect) {
			if (current.redirect === "<" && current.word !== "-") current.part.input = true;
			if (current.redirect.startsWith("<<") && current.redirect !== "<<<") current.heredocs.push({ end: current.word, tabs: current.redirect === "<<-" });
			current.redirect = "";
		} else current.part.words.push(current.word);
		current.word = "";
		current.started = false;
	};
	const finish = (piped = false) => {
		word();
		if (current.part.words.length) parts.push(current.part);
		current.part = { words: [], piped, input: false };
	};
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		const next = text[i + 1];
		if (current.quote === "'" || current.quote === "$'") {
			if (c === "'") current.quote = "";
			else current.word += c;
			continue;
		}
		if (c === "\\") {
			current.started = true;
			if (next !== undefined) current.word += text[++i];
			continue;
		}
		if (c === '"') { current.started = true; current.quote = current.quote ? "" : '"'; continue; }
		if (!current.quote && c === "'") { current.started = true; current.quote = "'"; continue; }
		if (!current.quote && c === "$" && next === "'") { current.started = true; current.quote = "$'"; i++; continue; }
		const substitution = (c === "$" || (!current.quote && (c === "<" || c === ">"))) && next === "(";
		if (substitution || c === "`" || (!current.quote && c === "(")) {
			if (c === "`" && stack.length > 1 && (current as Frame & { backtick?: boolean }).backtick) {
				finish(); stack.pop(); current = stack[stack.length - 1]; continue;
			}
			current.started = true;
			const child = frame();
			if (c === "`") (child as Frame & { backtick?: boolean }).backtick = true;
			stack.push(child); current = child;
			if (substitution) i++;
			continue;
		}
		if (!current.quote && c === ")" && stack.length > 1) { finish(); stack.pop(); current = stack[stack.length - 1]; continue; }
		if (current.quote) { current.started = true; current.word += c; continue; }
		if (c === "#" && !current.started) { while (i + 1 < text.length && text[i + 1] !== "\n") i++; continue; }
		if (c === " " || c === "\t") { word(); continue; }
		if (c === "\n" || c === ";" || c === "|" || (c === "&" && next !== ">")) {
			finish(c === "|" && next !== "|");
			if ((c === "|" && (next === "|" || next === "&")) || (c === "&" && next === "&") || (c === ";" && next === ";")) i++;
			if (c === "\n" && current.heredocs.length) {
				for (const doc of current.heredocs.splice(0)) {
					while (i + 1 < text.length) {
						const end = text.indexOf("\n", i + 1);
						const lineEnd = end < 0 ? text.length : end;
						const line = text.slice(i + 1, lineEnd);
						i = lineEnd;
						if ((doc.tabs ? line.replace(/^\t+/, "") : line) === doc.end) break;
					}
				}
			}
			continue;
		}
		if (c === "<" || c === ">" || (c === "&" && next === ">")) {
			if (current.started && /^\d+$/.test(current.word)) { current.word = ""; current.started = false; } else word();
			let op = c;
			if (c === "&") { op += ">"; i++; }
			else if (next === c) { op += c; i++; if (c === "<" && text[i + 1] === "<") { op += "<"; i++; } else if (c === "<" && text[i + 1] === "-") { op += "-"; i++; } }
			else if (c === ">" && (next === "|" || next === "&")) { op += next; i++; }
			current.redirect = op;
			continue;
		}
		current.started = true; current.word += c;
	}
	while (stack.length) { finish(); stack.pop(); current = stack[stack.length - 1]; }
	return parts;
}

function name(word: string): string { return word.replace(/^\\/, "").split("/").pop()!.replace(/\.exe$/i, "").toLowerCase(); }

function refused(part: Part): boolean {
	const words = part.words;
	let i = 0;
	while (i < words.length) {
		const w = words[i];
		if (/^[a-zA-Z_][\w]*=/.test(w) || ["if", "then", "do", "while", "until", "elif", "else", "!", "{", "command", "builtin", "exec", "env", "time", "nice", "nohup", "sudo"].includes(w)) { i++; continue; }
		if (w === "timeout") { i += 2; continue; }
		break;
	}
	let cmd = name(words[i] ?? "");
	if (cmd === "xargs") {
		for (let j = i + 1; j < words.length; j++) {
			cmd = name(words[j]);
			if (listing.has(cmd) || searching.has(cmd) || reading.has(cmd)) return true;
		}
		return false;
	}
	const args = words.slice(i + 1);
	if (cmd === "find") {
		const actions = new Set(["-print", "-print0", "-printf", "-fprint", "-fprint0", "-fprintf", "-ls", "-fls", "-exec", "-execdir", "-ok", "-okdir"]);
		return !args.includes("-delete") || args.some(arg => actions.has(arg));
	}
	if (listing.has(cmd)) return true;
	if (!searching.has(cmd) && !reading.has(cmd)) return false;
	let pattern = scripts.has(cmd);
	let file = part.input;
	let inplace = false;
	let scriptFile = false;
	let endOptions = false;
	const shortValues = cmd === "rg" ? "efgtTmABCMjErd" : searching.has(cmd) ? "efmABCdD" : cmd === "sed" ? "ef" : cmd === "awk" || cmd === "gawk" ? "Fvf" : cmd === "head" || cmd === "tail" ? "nc" : "";
	const longValues = new Set(cmd === "rg" ? ["regexp", "file", "glob", "type", "type-not", "max-count", "after-context", "before-context", "context", "max-columns", "threads", "encoding", "replace", "max-depth"] : searching.has(cmd) ? ["regexp", "file", "max-count", "after-context", "before-context", "context", "directories", "devices"] : cmd === "sed" || cmd === "awk" || cmd === "gawk" ? ["file", "expression"] : ["lines", "bytes"]);
	for (let j = 0; j < args.length; j++) {
		const arg = args[j];
		if (!endOptions && arg === "--") { endOptions = true; continue; }
		if (!endOptions && arg.startsWith("-") && arg !== "-") {
			if (cmd === "rg" && arg === "--files") return true;
			if (cmd !== "rg" && searching.has(cmd) && (arg === "--recursive" || arg === "--dereference-recursive")) return true;
			if (cmd === "sed" && (arg === "--in-place" || arg.startsWith("--in-place="))) { inplace = true; continue; }
			let key = ""; let value: string | undefined;
			if (arg.startsWith("--")) {
				const [long, ...rest] = arg.slice(2).split("=");
				if (longValues.has(long)) { key = long; value = rest.length ? rest.join("=") : args[++j]; }
			} else {
				for (let k = 1; k < arg.length; k++) {
					if (cmd !== "rg" && searching.has(cmd) && (arg[k] === "r" || arg[k] === "R")) return true;
					if (cmd === "sed" && arg[k] === "i") {
						inplace = true;
						if (k === arg.length - 1 && args[j + 1] === "") j++;
						break;
					}
					if (shortValues.includes(arg[k])) { key = arg[k]; value = arg.slice(k + 1) || args[++j]; break; }
				}
			}
			if (key === "f" || key === "file") { pattern = false; if (value !== "-") { file = true; scriptFile = true; } }
			if (key === "e" || key === "regexp" || key === "expression") pattern = false;
			continue;
		}
		if (!endOptions && (cmd === "head" || cmd === "tail") && /^\+\d+$/.test(arg)) continue;
		if (pattern) { pattern = false; continue; }
		if (arg === "-" || ((cmd === "awk" || cmd === "gawk") && /^[a-zA-Z_][\w]*=/.test(arg))) continue;
		file = true;
	}
	if (cmd === "sed" && inplace) return scriptFile;
	return file || (cmd === "rg" && !part.piped);
}

export function guardBash(command: string, legacy = false): void {
	const part = lex(command).find(refused);
	if (!part) return;
	let text = part.words.join(" ");
	if (text.length > 200) text = text.slice(0, 197) + "...";
	const [grep, find, read] = legacy ? ["grep", "find", "read"] : ["rqw_rg", "rqw_glob", "rqw_readfile"];
	throw new Error(`Blocked: bash does not search, list or read files, so the whole command was not run. Refused part: \`${text}\`. Use ${grep} to search file contents, ${find} to find or list files, ${read} to read files. Filtering another command's output through a pipe stays allowed, e.g. git log | grep x.`);
}
