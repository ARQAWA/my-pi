// Screen capture for the real InteractiveMode tests. It interprets terminal cursor/erase/SGR output,
// rather than treating text that was subsequently erased as visible UI.
import { visibleWidth } from "@earendil-works/pi-tui";

export class Screen {
	grid: string[][];
	fg: string[][];
	row = 0;
	col = 0;
	pending = "";
	pen = "";
	overflow = 0;
	rows: number;
	cols: number;
	constructor(rows: number, cols: number) {
		this.rows = rows;
		this.cols = cols;
		this.grid = this.blank();
		this.fg = this.blank("");
	}
	private blank(fill = " ") { return Array.from({ length: this.rows }, () => Array<string>(this.cols).fill(fill)); }
	lines() { return this.grid.map(line => line.join("").trimEnd()); }
	resize(cols: number) {
		this.cols = cols;
		this.grid = this.blank();
		this.fg = this.blank("");
		this.row = Math.min(this.row, this.rows - 1);
		this.col = Math.min(this.col, cols - 1);
		this.overflow = 0;
	}
	feed(input: string) {
		const text = this.pending + input;
		this.pending = "";
		for (let i = 0; i < text.length;) {
			const ch = String.fromCodePoint(text.codePointAt(i)!);
			if (ch === "\x1b") {
				if (i + 1 === text.length) { this.pending = text.slice(i); return; }
				const kind = text[i + 1];
				if (kind === "[") {
					let end = i + 2;
					while (end < text.length && !(text[end] >= "@" && text[end] <= "~")) end++;
					if (end === text.length) { this.pending = text.slice(i); return; }
					this.csi(text.slice(i + 2, end), text[end]);
					i = end + 1;
				} else if ("]_P^".includes(kind)) {
					const ends = [text.indexOf("\x07", i + 2), text.indexOf("\x1b\\", i + 2)].filter(n => n >= 0);
					if (!ends.length) { this.pending = text.slice(i); return; }
					const end = Math.min(...ends);
					i = end + (text[end] === "\x07" ? 1 : 2);
				} else i += 2;
				continue;
			}
			if (ch === "\r") this.col = 0;
			else if (ch === "\n") {
				if (this.row === this.rows - 1) {
					this.grid.shift(); this.grid.push(Array(this.cols).fill(" "));
					this.fg.shift(); this.fg.push(Array(this.cols).fill(""));
				} else this.row++;
			} else if (ch === "\b") this.col = Math.max(0, this.col - 1);
			else if (ch >= " ") {
				const width = visibleWidth(ch);
				if (width > 0) {
					if (this.col + width > this.cols) this.overflow++;
					else {
						this.grid[this.row][this.col] = ch;
						this.fg[this.row][this.col] = this.pen;
						if (width === 2) this.grid[this.row][this.col + 1] = "";
					}
					this.col = Math.min(this.cols, this.col + width);
				}
			}
			i += ch.length;
		}
	}
	private csi(params: string, final: string) {
		if (/^[?<>]/u.test(params)) return;
		const p = params ? params.split(";").map(Number) : [0];
		const n = p[0] || 1;
		if (final === "m") {
			for (let k = 0; k < p.length; k++) {
				if (p[k] === 0 || p[k] === 39) this.pen = "";
				else if (p[k] === 38 && p[k + 1] === 2) { this.pen = p.slice(k + 2, k + 5).join(";"); k += 4; }
				else if (p[k] === 38 && p[k + 1] === 5) { this.pen = `5;${p[k + 2]}`; k += 2; }
				else if (p[k] === 48) k += p[k + 1] === 2 ? 4 : 2;
				else if ((p[k] >= 30 && p[k] <= 37) || (p[k] >= 90 && p[k] <= 97)) this.pen = `c${p[k]}`;
			}
		} else if (final === "A") this.row = Math.max(0, this.row - n);
		else if (final === "B") this.row = Math.min(this.rows - 1, this.row + n);
		else if (final === "C") this.col = Math.min(this.cols - 1, this.col + n);
		else if (final === "D") this.col = Math.max(0, this.col - n);
		else if (final === "G") this.col = Math.min(this.cols - 1, n - 1);
		else if (final === "H" || final === "f") {
			this.row = Math.min(this.rows - 1, (p[0] || 1) - 1);
			this.col = Math.min(this.cols - 1, (p[1] || 1) - 1);
		} else if (final === "K") {
			const from = p[0] === 0 ? this.col : 0;
			const to = p[0] === 1 ? this.col + 1 : this.cols;
			for (let k = from; k < to; k++) { this.grid[this.row][k] = " "; this.fg[this.row][k] = ""; }
		} else if (final === "J") {
			if (p[0] === 2 || p[0] === 3) { this.grid = this.blank(); this.fg = this.blank(""); }
			else if (p[0] === 0) {
				this.csi("0", "K");
				for (let r = this.row + 1; r < this.rows; r++) {
					this.grid[r] = Array(this.cols).fill(" "); this.fg[r] = Array(this.cols).fill("");
				}
			}
		}
	}
}

export class ScriptedTerminal {
	onInput: ((data: string) => void) | undefined;
	onResize: (() => void) | undefined;
	screen = new Screen(70, 100);
	raw = "";
	writes = 0;
	private changed: () => void;
	constructor(changed: () => void) { this.changed = changed; }
	start(input: (data: string) => void, resize: () => void) { this.onInput = input; this.onResize = resize; }
	stop() {}
	async drainInput() {}
	write(data: string) { this.raw += data; this.screen.feed(data); this.writes++; this.changed(); }
	get columns() { return this.screen.cols; }
	get rows() { return this.screen.rows; }
	get kittyProtocolActive() { return false; }
	moveBy() {}
	hideCursor() {}
	showCursor() {}
	clearLine() {}
	clearFromCursor() {}
	clearScreen() {}
	setTitle() {}
	setProgress() {}
	setProgramStatus() {}
	type(text: string) { for (const ch of text) this.onInput!(ch); }
	key(data: string) { this.onInput!(data); }
	resize(cols: number) { this.screen.resize(cols); this.onResize!(); }
}
