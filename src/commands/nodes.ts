// What the commands that run on the view's rows share.
import type { FolderNode, GroupNode, Node, ResourceNode } from '#types/extension.ts'
import type { Change } from '#types/git.ts'
import type { GroupKind } from '#types/shared.ts'

/** A command that runs on these kinds of rows, and does nothing on any other. */
export function forNodes<K extends Node['type']>(
	types: readonly K[],
	run: (node: Extract<Node, { type: K }>) => unknown,
): (node: Node | undefined) => unknown {
	return node => (node && types.includes(node.type as K) ? run(node as Extract<Node, { type: K }>) : undefined)
}

/**
 * A command that runs on the rows of these kinds it's given: the selected rows, when its row is one of
 * them, or else its row alone. It does nothing when none of them are of these kinds.
 */
export function forSelected<K extends Node['type']>(
	types: readonly K[],
	run: (nodes: Extract<Node, { type: K }>[]) => unknown,
): (node: Node | undefined, selected?: readonly Node[]) => unknown {
	return (node, selected) => {
		const nodes = (selected ?? (node ? [node] : [])).filter((n): n is Extract<Node, { type: K }> =>
			types.includes(n.type as K),
		)

		return nodes.length > 0 ? run(nodes) : undefined
	}
}

/** The changes in the groups, folders and files, in groups of these kinds, as one node per group with only those. */
export function groupsOf(
	nodes: readonly (GroupNode | FolderNode | ResourceNode)[],
	kinds: readonly GroupKind[],
): GroupNode[] {
	const groups = new Map<string, GroupNode>()

	for (const node of nodes.filter(n => kinds.includes(n.kind))) {
		const { repository, kind, changelist } = node
		const key = JSON.stringify([repository.rootUri.toString(), kind, changelist])
		// A file can be selected along with its folder or group.
		const changes = new Map((groups.get(key)?.changes ?? []).map(c => [c.uri.toString(), c]))

		for (const change of changesOf(node)) {
			changes.set(change.uri.toString(), change)
		}

		groups.set(key, { type: 'group', repository, kind, changelist, changes: [...changes.values()] })
	}

	return [...groups.values()]
}

/** A file's change, or the changes in a group or folder. */
export function changesOf(node: GroupNode | FolderNode | ResourceNode): readonly Change[] {
	return node.type === 'resource' ? [node.change] : node.changes
}

/** The changes' paths, which the Git API's add, revert and clean take. */
export function paths(changes: readonly Change[]): string[] {
	return changes.map(c => c.uri.fsPath)
}
