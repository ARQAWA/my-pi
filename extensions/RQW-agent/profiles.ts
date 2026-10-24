import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { parse } from "smol-toml";

export type ProfileRef = { name: string; path: string; sha256: string };
export type Profile = ProfileRef & {
	description: string;
	developer_instructions?: string;
	model?: string;
	model_reasoning_effort?: string;
	nickname_candidates?: string[];
	error?: string;
};
export type ProfileOptions = {
	cwd: string;
	agentDir: string;
	codexHome?: string;
	extensionPaths: string[];
};

type Table = Record<string, unknown>;
type Document = { sha256: string; data?: Table; error?: string };
type Draft = Omit<Profile, "description"> & { description?: string; hasFile: boolean };
const fields = ["name", "description", "developer_instructions", "model", "model_reasoning_effort", "nickname_candidates"] as const;
const declarationFields = ["description", "nickname_candidates"] as const;
const lifecycle = new Set(["enabled", "max_threads", "max_concurrent_threads_per_session", "max_depth",
	"default_subagent_model", "default_subagent_reasoning_effort", "job_max_runtime_seconds", "interrupt_message"]);
const hash = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const table = (value: unknown): value is Table => value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);
const own = (value: Table, key: string) => Object.hasOwn(value, key);
const fallbackName = (path: string) => basename(path, ".toml");

/** Native Codex role files, layered from extension resources to local config. */
export class ProfileCatalogue {
	private profiles = new Map<string, Profile>();
	private cache = new Map<string, { stamp: string; document: Document }>();
	get(name: string): Profile | undefined { return this.profiles.get(name); }

	async refresh(options: ProfileOptions): Promise<Profile[]> {
		const roles = new Map<string, Draft>();
		const apply = (draft: Draft) => {
			const lower = roles.get(draft.name);
			if (lower) {
				draft.description ??= lower.description;
				draft.nickname_candidates ??= lower.nickname_candidates;
				// A declaration without config_file keeps the previously selected role file.
				if (!draft.hasFile && lower.hasFile) {
					for (const key of ["developer_instructions", "model", "model_reasoning_effort"] as const) draft[key] ??= lower[key];
					draft.path = lower.path;
					draft.sha256 = lower.sha256;
					draft.hasFile = true;
					draft.error ??= lower.error;
				}
			}
			roles.set(draft.name, draft);
		};
		for (const path of options.extensionPaths) {
			if (!isAbsolute(path)) continue;
			const absolute = resolve(path);
			const info = await fs.stat(absolute).catch(() => undefined);
			if (info?.isDirectory()) {
				const layer = new Map<string, Draft>();
				for (const file of await this.collect(absolute)) this.first(layer, await this.profile(file));
				for (const draft of layer.values()) apply(draft);
			} else apply(await this.profile(absolute));
		}
		const directories = [resolve(options.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), ".codex")), resolve(options.agentDir)];
		for (const directory of await this.projectDirectories(options.cwd)) directories.push(join(directory, ".codex"), join(directory, ".pi"));
		for (const directory of directories) {
			const layer = new Map<string, Draft>();
			const declared = new Set<string>();
			const configPath = join(directory, "config.toml");
			const config = await this.document(configPath, true);
			if (config?.error) {
				this.first(layer, this.draft(configPath, config, "config", false));
			} else if (config?.data && own(config.data, "agents")) {
				if (!table(config.data.agents)) {
					this.first(layer, { ...this.draft(configPath, config, "agents", false), error: "agents must be a table" });
				} else {
					for (const name of Object.keys(config.data.agents).sort()) {
						const value = config.data.agents[name];
						if (lifecycle.has(name)) continue;
						if (!table(value)) {
							this.first(layer, this.draft(configPath, { sha256: config.sha256, error: "Agent role declaration must be a table" }, name, false));
							continue;
						}
						let draft = this.draft(configPath, { ...config, data: value }, name, false, true);
						if (own(value, "config_file")) {
							if (typeof value.config_file !== "string" || !value.config_file.trim() || value.config_file.includes("\0")) {
								draft.error ??= "config_file must name a file";
							} else {
								const file = resolve(directory, value.config_file);
								declared.add(file);
								const loaded = await this.profile(file, name);
								loaded.description ??= draft.description;
								loaded.nickname_candidates ??= draft.nickname_candidates;
								loaded.error ??= draft.error;
								draft = loaded;
							}
						}
						this.first(layer, draft);
					}
				}
			}
			for (const file of await this.collect(join(directory, "agents"))) {
				if (!declared.has(file)) this.first(layer, await this.profile(file));
			}
			for (const draft of layer.values()) apply(draft);
		}
		this.profiles.clear();
		for (const draft of [...roles.values()].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
			draft.error ??= draft.description === undefined ? "description is required" : undefined;
			const { hasFile: _file, ...profile } = draft;
			const description = profile.description ?? profile.name;
			const result: Profile = { ...profile, description: profile.error ? `${description} [unavailable: ${profile.error}]` : description };
			this.profiles.set(result.name, result);
		}
		return [...this.profiles.values()];
	}

	private first(layer: Map<string, Draft>, draft: Draft): void {
		if (!layer.has(draft.name)) layer.set(draft.name, draft);
	}

	private async profile(path: string, hint?: string): Promise<Draft> {
		return this.draft(path, (await this.document(path))!, hint ?? fallbackName(path), true, hint !== undefined);
	}

	private draft(path: string, document: Document, hint: string, hasFile: boolean, declared = false): Draft {
		const result: Draft = { name: hint, path, sha256: document.sha256, hasFile };
		if (document.error) { result.error = document.error; return result; }
		const data = document.data!;
		const supported: readonly typeof fields[number][] = hasFile ? fields : declarationFields;
		for (const key of supported) {
			if (!own(data, key)) continue;
			const value = data[key];
			if (key === "nickname_candidates") {
				if (!Array.isArray(value) || value.some(item => typeof item !== "string")) {
					result.error ??= "nickname_candidates must be an array of strings";
				} else {
					const names = value.map(item => item.trim());
					if (!names.length || names.some(name => !name || !/^[A-Za-z0-9 _-]+$/.test(name)) || new Set(names).size !== names.length) result.error ??= "nickname_candidates must contain distinct non-empty ASCII names";
					else result.nickname_candidates = names;
				}
			} else if (typeof value !== "string") result.error ??= `${key} must be a string`;
			else if (["description", "developer_instructions"].includes(key) && !value.trim()) result.error ??= `${key} cannot be blank`;
			else if (key === "name") {
				if (value.trim()) result.name = value.trim();
				else if (!declared) result.error ??= "name is required";
			} else result[key] = key === "description" ? value.trim() : value;
		}
		if (hasFile && !declared) {
			if (!own(data, "name")) result.error ??= "name is required";
			if (!own(data, "developer_instructions")) result.error ??= "developer_instructions is required";
		}
		return result;
	}

	private async document(path: string, optional = false): Promise<Document | undefined> {
		let stamp: string;
		try {
			const info = await fs.stat(path, { bigint: true });
			if (!info.isFile()) return { sha256: hash(""), error: "TOML path must be a regular file" };
			stamp = `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
		} catch (error) {
			this.cache.delete(path);
			if (optional && (error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
			return { sha256: hash(""), error: "Cannot read TOML file" };
		}
		const cached = this.cache.get(path);
		if (cached?.stamp === stamp) return cached.document;
		let document: Document;
		try {
			const bytes = await fs.readFile(path);
			document = { sha256: hash(bytes) };
			try { document.data = parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as Table; }
			catch { document.error = "Invalid TOML syntax or UTF-8"; }
		} catch { document = { sha256: hash(""), error: "Cannot read TOML file" }; }
		this.cache.set(path, { stamp, document });
		return document;
	}

	private async collect(directory: string): Promise<string[]> {
		let entries;
		try { entries = await fs.readdir(directory, { withFileTypes: true }); }
		catch { return []; }
		const files: string[] = [];
		for (const entry of entries) {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) files.push(...await this.collect(path));
			else if ((entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith(".toml")) files.push(path);
		}
		return files.sort();
	}

	private async projectDirectories(cwd: string): Promise<string[]> {
		const directories: string[] = [];
		let directory = resolve(cwd);
		while (true) {
			directories.push(directory);
			if (await fs.stat(join(directory, ".git")).then(() => true, () => false)) break;
			const parent = dirname(directory);
			if (parent === directory) break;
			directory = parent;
		}
		return directories.reverse();
	}
}
