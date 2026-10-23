// The session's original first branch and the sibling number of the branch the leaf is on, from the public session
// tree (`ctx.sessionManager.getTree()` / `getLeafId()`) and, when given, the creation order of the entries
// (`ctx.sessionManager.getEntries()` ids in file order). Pure: no session access here.

export interface TreeNodeLike {
	entry: { id: string; type?: string; message?: { role?: string } };
	children: TreeNodeLike[];
}

type Rank = Map<string, number>;

const isUserMessage = (node: TreeNodeLike) => node.entry.type === "message" && node.entry.message?.role === "user";

/**
 * The original first branch: the path from the root to the first user message (the first one in creation order),
 * then the earliest child at every fork below it. Returns N (1-based) when the leaf is off that branch, where N is the
 * position of the branch's first node among its fork's children in creation order; undefined on the original branch
 * (ancestors of it included) or without a leaf. `order` is the entry ids in creation order; without it the tree's own
 * child order is used.
 */
export function branchNumber(roots: readonly TreeNodeLike[], leafId: string | null, order?: readonly string[]): number | undefined {
	if (!leafId || roots.length === 0) return undefined;
	const rank = order ? rankOf(order) : undefined;
	const original = originalIds(roots, rank);
	const path = pathTo(roots, leafId);
	if (!path) return undefined;
	for (let i = 0; i < path.length; i++) {
		if (original.has(path[i].entry.id)) continue;
		const fork = path[i - 1];
		// Separate roots are siblings under the virtual session root (e.g. replacing the first user message).
		return inOrder(fork ? fork.children : roots, rank).indexOf(path[i]) + 1;
	}
	return undefined;
}

function rankOf(order: readonly string[]): Rank {
	const rank: Rank = new Map();
	order.forEach((id, i) => { if (!rank.has(id)) rank.set(id, i); });
	return rank;
}

/** Nodes in creation order when the ranks are known; a node without a rank keeps the tree's order after the ranked ones. */
function inOrder(nodes: readonly TreeNodeLike[], rank: Rank | undefined): readonly TreeNodeLike[] {
	if (!rank) return nodes;
	const value = (node: TreeNodeLike) => rank.get(node.entry.id) ?? Number.MAX_SAFE_INTEGER;
	return [...nodes].sort((a, b) => value(a) - value(b));
}

/** The ids of the original branch: root to the first user message, then the earliest children. */
function originalIds(roots: readonly TreeNodeLike[], rank: Rank | undefined): Set<string> {
	const ids = new Set<string>();
	const first = firstUserMessage(roots, rank);
	const start = first ? pathTo(roots, first.entry.id) : undefined;
	for (const node of start ?? []) ids.add(node.entry.id);
	for (let node: TreeNodeLike | undefined = start ? start[start.length - 1] : inOrder(roots, rank)[0];
		node; node = inOrder(node.children, rank)[0]) {
		ids.add(node.entry.id);
	}
	return ids;
}

/**
 * The first user message in creation order: the user message with the lowest rank when the order is known; otherwise
 * the first one met by a depth-first walk that visits earlier children first.
 */
function firstUserMessage(roots: readonly TreeNodeLike[], rank: Rank | undefined): TreeNodeLike | undefined {
	let best: TreeNodeLike | undefined;
	let bestRank = Number.MAX_SAFE_INTEGER;
	const stack = [...inOrder(roots, rank)].reverse();
	while (stack.length > 0) {
		const node = stack.pop() as TreeNodeLike;
		if (isUserMessage(node)) {
			const value = rank?.get(node.entry.id) ?? Number.MAX_SAFE_INTEGER;
			if (!best || value < bestRank) {
				best = node;
				bestRank = value;
			}
		}
		const children = inOrder(node.children, rank);
		for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
	}
	return best;
}

/** The nodes from a root down to the node with `id`, found without recursion. */
function pathTo(roots: readonly TreeNodeLike[], id: string): TreeNodeLike[] | undefined {
	const stack: TreeNodeLike[][] = roots.map((root) => [root]);
	while (stack.length > 0) {
		const path = stack.pop() as TreeNodeLike[];
		const node = path[path.length - 1];
		if (node.entry.id === id) return path;
		for (const child of node.children) stack.push([...path, child]);
	}
	return undefined;
}
