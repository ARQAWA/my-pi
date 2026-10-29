import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Who holds a chat: the process, the extension instance, a random token of this session start and the port the
 * holder already listens on, so anyone can ask the holder itself whether it is still there.
 */
export type Owner = { pid: number; instanceId: string; generation: string; port: number };
export type Liveness = "alive" | "dead" | "unknown";
export type Check = (owner: Owner) => Promise<Liveness>;
export type Claim = { ok: true } | { ok: false; reason: "duplicate" | "unknown" | "corrupt"; owner?: Owner };

export const lockDir = (dir: string, id: string) => join(dir, "locks", id);
const epochPath = (dir: string, id: string, epoch: number) => join(lockDir(dir, id), String(epoch));

/** Lock epochs of a chat, highest first. A lock is a folder named by its epoch that holds owner.json. */
function epochsOf(dir: string, id: string): number[] {
	try {
		return readdirSync(lockDir(dir, id)).filter(name => /^\d+$/.test(name)).map(Number).sort((a, b) => b - a);
	} catch { return []; }
}

function readEpoch(path: string): Owner | "corrupt" | "gone" {
	let text: string;
	try { text = readFileSync(join(path, "owner.json"), "utf8"); }
	catch (error) { return (error as NodeJS.ErrnoException).code === "ENOENT" && !existsSync(path) ? "gone" : "corrupt"; }
	try {
		const value = JSON.parse(text) as Partial<Owner>;
		if (typeof value.pid === "number" && typeof value.instanceId === "string" && typeof value.generation === "string" && typeof value.port === "number") {
			return { pid: value.pid, instanceId: value.instanceId, generation: value.generation, port: value.port };
		}
	} catch {}
	return "corrupt";
}

/** The newest lock of a chat: its owner, or "corrupt"; undefined when nobody holds it. */
export function topOwner(dir: string, id: string): Owner | "corrupt" | undefined {
	const [top] = epochsOf(dir, id);
	if (top === undefined) return undefined;
	const held = readEpoch(epochPath(dir, id, top));
	return held === "gone" ? undefined : held;
}

/** `dead` when the lock may be replaced; otherwise the claim failure to report. */
async function judge(dir: string, id: string, epoch: number, me: Owner, check: Check): Promise<"dead" | Claim> {
	const held = readEpoch(epochPath(dir, id, epoch));
	if (held === "gone") return "dead";
	if (held === "corrupt") return { ok: false, reason: "corrupt" };
	if (held.instanceId === me.instanceId) return "dead";
	const verdict = await check(held);
	return verdict === "dead" ? "dead" : { ok: false, reason: verdict === "alive" ? "duplicate" : "unknown", owner: held };
}

/** The lock appears with its owner already inside, or not at all: a rename onto an existing lock fails. */
function place(dir: string, id: string, epoch: number, owner: Owner): boolean {
	const temp = join(dir, "locks", `.tmp-${randomBytes(8).toString("hex")}`);
	try {
		mkdirSync(temp, { mode: 0o700 });
		writeFileSync(join(temp, "owner.json"), JSON.stringify(owner), { mode: 0o600 });
		renameSync(temp, epochPath(dir, id, epoch));
		return true;
	} catch {
		rmSync(temp, { recursive: true, force: true });
		return false;
	}
}

const heldBy = (dir: string, id: string, epoch: number, owner: Owner) => {
	const held = readEpoch(epochPath(dir, id, epoch));
	return typeof held === "object" && held.instanceId === owner.instanceId && held.generation === owner.generation;
};

/** True while the newest lock of the chat is this exact owner's. */
export function holds(dir: string, id: string, owner: Owner): boolean {
	const [top] = epochsOf(dir, id);
	return top !== undefined && heldBy(dir, id, top, owner);
}

/**
 * Takes a chat. A lock is replaced by the next epoch only when its holder is confirmed dead, and only one rename to
 * that epoch can win. After winning, every other lock must be confirmed dead and none may be newer; otherwise this
 * claim is withdrawn. Deletion rule: an epoch is removed only by the owner that still holds a higher one, checked in
 * the same synchronous step as the removal, and an owner removes its own number only while that number is still its.
 * Epoch numbers can be reused after a release, so no delayed step may delete by number alone.
 */
export async function acquire(dir: string, id: string, owner: Owner, check: Check): Promise<Claim> {
	mkdirSync(lockDir(dir, id), { recursive: true, mode: 0o700 });
	for (let attempt = 0; attempt < 4; attempt++) {
		const [top] = epochsOf(dir, id);
		if (top !== undefined) {
			const verdict = await judge(dir, id, top, owner, check);
			if (verdict !== "dead") return verdict;
		}
		const mine = (top ?? 0) + 1;
		if (!place(dir, id, mine, owner)) continue;
		const withdraw = () => { if (heldBy(dir, id, mine, owner)) rmSync(epochPath(dir, id, mine), { recursive: true, force: true }); };
		let retry = false;
		for (const epoch of epochsOf(dir, id)) {
			if (epoch === mine) continue;
			const verdict = epoch > mine ? "newer" : await judge(dir, id, epoch, owner, check);
			if (verdict === "dead") {
				if (heldBy(dir, id, mine, owner)) rmSync(epochPath(dir, id, epoch), { recursive: true, force: true });
				continue;
			}
			withdraw();
			if (verdict === "newer") { retry = true; break; }
			return verdict;
		}
		if (!retry && heldBy(dir, id, mine, owner)) return { ok: true };
	}
	return { ok: false, reason: "unknown" };
}

/** Frees the chat only when the lock belongs to this exact generation. */
export function release(dir: string, id: string, owner: Owner): void {
	for (const epoch of epochsOf(dir, id)) {
		const held = readEpoch(epochPath(dir, id, epoch));
		if (typeof held === "object" && held.instanceId === owner.instanceId && held.generation === owner.generation) {
			rmSync(epochPath(dir, id, epoch), { recursive: true, force: true });
		}
	}
}
